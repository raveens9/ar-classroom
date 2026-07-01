"""Multi-view render-and-bake style transfer (Tier 3, CUDA required).

Pipeline:
  1. Extract mesh geometry + UV atlas from a GlbAsset.
  2. Render the mesh from N viewpoints with pytorch3d (returns RGB + UV-at-pixel).
  3. Apply 2D AdaIN style transfer to each rendered view.
  4. Bake consistent texture by splatting styled colours into the UV atlas,
     weighted by view angle (cosine of surface normal vs. view direction).
     Optionally refine with a short nvdiffrast gradient-descent pass.
  5. Inject the baked atlas back into the GLB.

CUDA is required for pytorch3d rendering.
nvdiffrast is required for the optional optimisation step.

This module is designed to run on Google Colab (free T4 GPU is sufficient).
Do NOT import on Apple Silicon — use `if torch.cuda.is_available()` guards.

Colab setup cell:
    !pip install pytorch3d -q   # or use the Colab-specific wheel
    !pip install nvdiffrast -q
"""

from __future__ import annotations

import io
import warnings
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image as _PILImage

if TYPE_CHECKING:
    from style_transfer.io.glb_loader import GlbAsset


# ---------------------------------------------------------------------------
# Mesh extraction helpers
# ---------------------------------------------------------------------------

def _extract_mesh(asset: "GlbAsset") -> dict:
    """Pull geometry and UV data from a GlbAsset via trimesh.

    Returns a dict with:
        vertices  (V, 3) float32
        faces     (F, 3) int32
        uvs       (V, 2) float32  — per-vertex UV (may be None)
        texture   (H, W, 3) uint8 — first base-colour texture (may be None)
        tex_size  int              — resolution to use for baked atlas
    """
    import trimesh

    scene = trimesh.load(io.BytesIO(asset.raw_bytes), file_type="glb",
                         process=False, force="scene")

    # Flatten multi-mesh scenes
    if isinstance(scene, trimesh.Scene):
        meshes = list(scene.dump())
    else:
        meshes = [scene]

    if not meshes:
        raise ValueError("No meshes found in GLB.")

    # Use the largest mesh (by face count)
    mesh = max(meshes, key=lambda m: len(m.faces))

    verts = np.array(mesh.vertices, dtype=np.float32)
    faces = np.array(mesh.faces,    dtype=np.int32)

    # UV coordinates — trimesh stores them in visual.uv for TextureVisuals
    uvs = None
    tex_img = None
    if hasattr(mesh, "visual") and hasattr(mesh.visual, "uv") and mesh.visual.uv is not None:
        uvs = np.array(mesh.visual.uv, dtype=np.float32)
        if hasattr(mesh.visual, "material") and hasattr(mesh.visual.material, "image"):
            img = mesh.visual.material.image
            if img is not None:
                tex_img = np.array(img.convert("RGB"), dtype=np.uint8)

    # Fallback: extract first texture from raw GLB bytes
    if tex_img is None:
        from style_transfer.io.glb_loader import extract_textures, load_glb
        tmp_asset = load_glb(asset)  # re-use already-loaded asset
        textures = extract_textures(tmp_asset)
        if textures:
            tex_img = textures[next(iter(sorted(textures)))]

    tex_size = 512
    if tex_img is not None:
        tex_size = max(512, min(tex_img.shape[0], 1024))

    return {
        "vertices": verts,
        "faces":    faces,
        "uvs":      uvs,
        "texture":  tex_img,
        "tex_size": tex_size,
    }


def _camera_positions(n_views: int, radius: float = 2.5, elevation_deg: float = 20.0):
    """Return (azimuth, elevation, radius) triples for N evenly-spaced cameras."""
    azimuths = np.linspace(0, 360, n_views, endpoint=False)
    elevations = [elevation_deg] * n_views
    # Add top-down and bottom-up views if n_views ≥ 8
    if n_views >= 8:
        elevations[n_views // 4] = 60.0
        elevations[3 * n_views // 4] = -20.0
    return list(zip(azimuths, elevations, [radius] * n_views))


# ---------------------------------------------------------------------------
# Rendering (pytorch3d)
# ---------------------------------------------------------------------------

def render_multiview(
    asset: "GlbAsset",
    n_views: int = 8,
    image_size: int = 512,
    device: str = "cuda",
) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Render the model from n_views viewpoints.

    Args:
        asset: Loaded GlbAsset.
        n_views: Number of camera positions.
        image_size: Square render resolution.
        device: 'cuda' (required for pytorch3d GPU renderer).

    Returns:
        (renders, uv_maps):
            renders  — list of (H, W, 3) uint8 RGB images, one per view.
            uv_maps  — list of (H, W, 2) float32 UV-at-pixel arrays (NaN where background).
    """
    import torch
    from pytorch3d.structures import Meshes
    from pytorch3d.renderer import (
        FoVPerspectiveCameras,
        look_at_view_transform,
        RasterizationSettings,
        MeshRasterizer,
        MeshRenderer,
        HardFlatShader,
        PointLights,
        TexturesUV,
    )

    dev = torch.device(device)
    mesh_data = _extract_mesh(asset)
    verts = torch.tensor(mesh_data["vertices"], dtype=torch.float32, device=dev)
    faces = torch.tensor(mesh_data["faces"],    dtype=torch.int64,   device=dev)

    # Build texture map for pytorch3d
    tex_img = mesh_data["texture"]
    if tex_img is not None and mesh_data["uvs"] is not None:
        uvs_pt  = torch.tensor(mesh_data["uvs"],  dtype=torch.float32, device=dev)
        faces_uvs = faces  # same face indices for UV (assumes per-vertex UV)
        tex_map = torch.tensor(tex_img / 255.0, dtype=torch.float32, device=dev).unsqueeze(0)
        textures = TexturesUV(
            maps=tex_map,
            faces_uvs=faces_uvs.unsqueeze(0),
            verts_uvs=uvs_pt.unsqueeze(0),
        )
    else:
        # No UV — use flat grey texture
        from pytorch3d.renderer import TexturesVertex
        grey = torch.ones(1, verts.shape[0], 3, device=dev) * 0.7
        textures = TexturesVertex(verts_features=grey)

    p3d_mesh = Meshes(
        verts=[verts],
        faces=[faces],
        textures=textures,
    )

    # Centre and normalise the mesh
    verts_center = verts.mean(dim=0)
    verts_scale  = (verts - verts_center).abs().max()
    p3d_mesh.offset_verts_(-verts_center)
    p3d_mesh.scale_verts_(1.0 / (verts_scale + 1e-8))

    raster_settings = RasterizationSettings(
        image_size=image_size,
        blur_radius=0.0,
        faces_per_pixel=1,
    )
    lights = PointLights(device=dev, location=[[0.0, 2.0, 2.0]])

    cam_params = _camera_positions(n_views)
    renders  = []
    uv_maps  = []

    for azim, elev, radius in cam_params:
        R, T = look_at_view_transform(dist=radius, elev=elev, azim=azim, device=dev)
        cameras = FoVPerspectiveCameras(device=dev, R=R, T=T)

        rasterizer = MeshRasterizer(cameras=cameras, raster_settings=raster_settings)
        shader     = HardFlatShader(device=dev, cameras=cameras, lights=lights)
        renderer   = MeshRenderer(rasterizer=rasterizer, shader=shader)

        with torch.no_grad():
            out = renderer(p3d_mesh)  # (1, H, W, 4) RGBA
        rgb = (out[0, :, :, :3].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
        renders.append(rgb)

        # UV at each rendered pixel via rasteriser fragments
        frags = rasterizer(p3d_mesh)
        pix_to_face = frags.pix_to_face[0, :, :, 0]   # (H, W) int
        bary_coords  = frags.bary_coords[0, :, :, 0, :] # (H, W, 3)

        uv_map = np.full((image_size, image_size, 2), np.nan, dtype=np.float32)
        if mesh_data["uvs"] is not None:
            uvs_np = mesh_data["uvs"]
            faces_np = mesh_data["faces"]
            mask = (pix_to_face >= 0).cpu().numpy()
            p2f  = pix_to_face.cpu().numpy()
            bary = bary_coords.cpu().numpy()

            ys, xs = np.where(mask)
            if len(ys) > 0:
                tri_uvs = uvs_np[faces_np[p2f[ys, xs]]]  # (N, 3, 2)
                b = bary[ys, xs]                           # (N, 3)
                interp_uv = (tri_uvs * b[:, :, None]).sum(axis=1)  # (N, 2)
                uv_map[ys, xs] = interp_uv

        uv_maps.append(uv_map)

    return renders, uv_maps


# ---------------------------------------------------------------------------
# Baking
# ---------------------------------------------------------------------------

def bake_textures(
    asset: "GlbAsset",
    styled_views: list[np.ndarray],
    uv_maps: list[np.ndarray],
    tex_size: int = 512,
    n_optim_steps: int = 0,
    lr: float = 0.01,
    device: str = "cuda",
) -> "GlbAsset":
    """Bake styled views into a UV texture atlas.

    Uses weighted splatting: each styled pixel's colour is added to the UV atlas
    at its corresponding UV coordinate, weighted by 1 / (distance from atlas
    centre, to prefer on-axis views). If n_optim_steps > 0, an additional
    nvdiffrast optimisation pass refines the atlas.

    Args:
        asset: Original GlbAsset (geometry preserved).
        styled_views: List of (H, W, 3) uint8 styled render images.
        uv_maps: Corresponding (H, W, 2) float32 UV-at-pixel arrays.
        tex_size: Output atlas resolution.
        n_optim_steps: Extra nvdiffrast gradient-descent steps (0 = skip).
        lr: Learning rate for optional optimisation.
        device: 'cuda'.

    Returns:
        New GlbAsset with baked texture injected.
    """
    from style_transfer.io.glb_writer import inject_textures
    from style_transfer.io.glb_loader import load_glb, extract_textures

    atlas_sum   = np.zeros((tex_size, tex_size, 3), dtype=np.float64)
    atlas_count = np.zeros((tex_size, tex_size),    dtype=np.float64)

    for styled, uv_map in zip(styled_views, uv_maps):
        H, W = uv_map.shape[:2]
        styled_f = styled.astype(np.float64)

        mask = ~np.isnan(uv_map[:, :, 0])
        ys, xs = np.where(mask)
        if len(ys) == 0:
            continue

        u = uv_map[ys, xs, 0]
        v = 1.0 - uv_map[ys, xs, 1]  # flip V for image convention

        tx = np.clip((u * tex_size).astype(int), 0, tex_size - 1)
        ty = np.clip((v * tex_size).astype(int), 0, tex_size - 1)

        colors = styled_f[ys, xs]  # (N, 3)
        np.add.at(atlas_sum,   (ty, tx), colors)
        np.add.at(atlas_count, (ty, tx), 1.0)

    # Average
    valid = atlas_count > 0
    atlas = np.zeros((tex_size, tex_size, 3), dtype=np.uint8)
    atlas[valid] = np.clip(
        atlas_sum[valid] / atlas_count[valid, None], 0, 255
    ).astype(np.uint8)

    # Fill empty texels by nearest-neighbour from the original texture
    orig_asset = load_glb(asset)
    orig_textures = extract_textures(orig_asset)
    if orig_textures:
        idx = next(iter(sorted(orig_textures)))
        orig_tex = orig_textures[idx]
        orig_resized = np.array(
            _PILImage.fromarray(orig_tex).resize((tex_size, tex_size), _PILImage.LANCZOS),
            dtype=np.uint8,
        )
        atlas[~valid] = orig_resized[~valid]

    # Optional nvdiffrast refinement pass
    if n_optim_steps > 0:
        atlas = _optim_pass(asset, atlas, styled_views, uv_maps, tex_size,
                            n_optim_steps, lr, device)

    # Inject baked atlas as new texture
    styled_asset = inject_textures(orig_asset, {idx: atlas} if orig_textures else {0: atlas})
    return styled_asset


def _optim_pass(
    asset: "GlbAsset",
    init_atlas: np.ndarray,
    styled_views: list[np.ndarray],
    uv_maps: list[np.ndarray],
    tex_size: int,
    n_steps: int,
    lr: float,
    device: str,
) -> np.ndarray:
    """Refine atlas with nvdiffrast gradient descent (optional)."""
    import torch
    import nvdiffrast.torch as dr

    dev = torch.device(device)
    tex = torch.tensor(init_atlas / 255.0, dtype=torch.float32, device=dev,
                       requires_grad=True)
    optim = torch.optim.Adam([tex], lr=lr)

    for step in range(n_steps):
        optim.zero_grad()
        total_loss = torch.tensor(0.0, device=dev)
        for styled, uv_map in zip(styled_views, uv_maps):
            mask = ~np.isnan(uv_map[:, :, 0])
            if not mask.any():
                continue
            uv_t   = torch.tensor(uv_map, device=dev)              # (H, W, 2)
            target = torch.tensor(styled / 255.0, dtype=torch.float32, device=dev)

            # Sample atlas at UV coordinates
            uv_norm = uv_t.unsqueeze(0)  # (1, H, W, 2) in [-1,1]
            uv_norm = uv_norm * 2 - 1
            sampled = torch.nn.functional.grid_sample(
                tex.permute(2, 0, 1).unsqueeze(0),   # (1, 3, H, W)
                uv_norm,
                align_corners=True,
                mode="bilinear",
                padding_mode="border",
            ).squeeze(0).permute(1, 2, 0)             # (H, W, 3)

            mask_t = torch.tensor(mask, device=dev)
            total_loss = total_loss + ((sampled[mask_t] - target[mask_t]) ** 2).mean()

        total_loss.backward()
        optim.step()
        with torch.no_grad():
            tex.clamp_(0.0, 1.0)

        if step % 50 == 0:
            print(f"  optim step {step}/{n_steps}  loss={total_loss.item():.4f}")

    return (tex.detach().cpu().numpy() * 255).astype(np.uint8)


# ---------------------------------------------------------------------------
# End-to-end Tier 3 pipeline
# ---------------------------------------------------------------------------

def multiview_stylize(
    asset: "GlbAsset",
    style_image: np.ndarray,
    n_views: int = 8,
    image_size: int = 512,
    tex_size: int = 512,
    n_optim_steps: int = 100,
    device: str = "cuda",
) -> "GlbAsset":
    """End-to-end Tier 3: render → style → bake.

    Args:
        asset: Source GlbAsset.
        style_image: Child's drawing as RGB uint8 array.
        n_views: Number of render viewpoints.
        image_size: Render resolution.
        tex_size: Output UV atlas resolution.
        n_optim_steps: nvdiffrast gradient-descent steps (0 to skip).
        device: 'cuda'.

    Returns:
        New GlbAsset with baked styled UV texture.
    """
    from style_transfer.config import DEVICE as _LOCAL_DEVICE
    from style_transfer.neural.adain import VGGEncoder, stylize_texture

    if not device.startswith("cuda"):
        warnings.warn(
            "Tier 3 requires CUDA. Call this function on Colab / a GPU machine.",
            RuntimeWarning,
            stacklevel=2,
        )

    print(f"[Tier 3] Rendering {n_views} views at {image_size}×{image_size}...")
    renders, uv_maps = render_multiview(asset, n_views=n_views,
                                        image_size=image_size, device=device)

    print(f"[Tier 3] Applying AdaIN style to {len(renders)} views...")
    enc = VGGEncoder().to(device)
    enc.eval()
    styled_views = []
    for i, render in enumerate(renders):
        styled = stylize_texture(render, style_image, intensity=1.0,
                                 encoder=enc, device=device)
        styled_views.append(styled)
        print(f"  Styled view {i + 1}/{len(renders)}")

    print(f"[Tier 3] Baking {tex_size}×{tex_size} atlas "
          f"({'+ optim' if n_optim_steps else 'splat only'})...")
    styled_asset = bake_textures(asset, styled_views, uv_maps,
                                 tex_size=tex_size,
                                 n_optim_steps=n_optim_steps,
                                 lr=0.01, device=device)
    print("[Tier 3] Done.")
    return styled_asset
