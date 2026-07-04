"""Repack a modified GlbAsset back into a valid binary glTF (.glb) file.

Only materials and texture images are ever written back — mesh geometry is
copied verbatim from the source GlbAsset.
"""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
from PIL import Image
from pygltflib import GLTF2

from style_transfer.io.glb_loader import GlbAsset, MaterialInfo


def update_material_colors(
    asset: GlbAsset,
    material_colors: dict[int, tuple[float, float, float, float]],
) -> GlbAsset:
    """Overwrite baseColorFactor for flat-colour materials (or diffuseFactor for KHR_SPEC).

    Args:
        asset: Source GlbAsset.
        material_colors: Dict mapping material index → RGBA tuple (0.0–1.0 each).

    Returns:
        New GlbAsset with updated material JSON but identical geometry and textures.
    """
    gltf = GLTF2().load_from_bytes(asset.raw_bytes)

    for mat_idx, rgba in material_colors.items():
        mat = gltf.materials[mat_idx]
        exts = mat.extensions or {}
        if mat.pbrMetallicRoughness is not None:
            mat.pbrMetallicRoughness.baseColorFactor = list(rgba)
        elif "KHR_materials_pbrSpecularGlossiness" in exts:
            exts["KHR_materials_pbrSpecularGlossiness"]["diffuseFactor"] = list(rgba)

    updated_bytes = b"".join(gltf.save_to_bytes())

    updated_infos = []
    for m in asset.material_infos:
        if m.index in material_colors:
            updated_infos.append(MaterialInfo(
                index=m.index,
                name=m.name,
                mat_type=m.mat_type,
                base_color_factor=tuple(material_colors[m.index]),
                base_color_texture_index=m.base_color_texture_index,
            ))
        else:
            updated_infos.append(m)

    return GlbAsset(
        raw_bytes=updated_bytes,
        material_infos=updated_infos,
        image_bytes=asset.image_bytes,
        asset_material_type=asset.asset_material_type,
    )


def inject_textures(asset: GlbAsset, textures: dict[int, np.ndarray]) -> GlbAsset:
    """Replace texture images in the asset with new numpy arrays.

    Rebuilds the entire binary buffer with correct 4-byte-aligned offsets so
    that all mesh data accessors remain valid. Mesh geometry is unchanged.

    Args:
        asset: Source GlbAsset (from load_glb).
        textures: Dict mapping glTF image index → new RGB or RGBA uint8 array.

    Returns:
        New GlbAsset with updated texture bytes but identical geometry.
    """
    if not textures:
        # Nothing to do — avoid an unnecessary round-trip
        return GlbAsset(
            raw_bytes=asset.raw_bytes,
            material_infos=asset.material_infos,
            image_bytes=dict(asset.image_bytes),
            asset_material_type=asset.asset_material_type,
        )

    gltf = GLTF2().load_from_bytes(asset.raw_bytes)

    # Build image index → bufferView index map
    img_to_bv: dict[int, int] = {
        img_idx: img.bufferView
        for img_idx, img in enumerate(gltf.images or [])
        if img.bufferView is not None
    }

    # Encode replacement arrays to PNG bytes keyed by bufferView index
    replacement: dict[int, bytes] = {}
    for img_idx, arr in textures.items():
        bv_idx = img_to_bv.get(img_idx)
        if bv_idx is None:
            continue
        if arr.ndim == 3 and arr.shape[2] == 4:
            pil_img = Image.fromarray(arr, "RGBA")
        else:
            pil_img = Image.fromarray(arr[..., :3], "RGB")
        buf = io.BytesIO()
        pil_img.save(buf, format="PNG")
        replacement[bv_idx] = buf.getvalue()

    old_blob = gltf.binary_blob() or b""

    # Rebuild the binary blob: process bufferViews in byte-offset order so the
    # relative ordering of mesh data chunks and image chunks is preserved.
    indexed_bvs = sorted(enumerate(gltf.bufferViews or []), key=lambda x: x[1].byteOffset)

    new_blob = bytearray()
    for bv_idx, bv in indexed_bvs:
        # glTF spec requires bufferView starts at a multiple of 4 bytes
        pad = (4 - len(new_blob) % 4) % 4
        new_blob.extend(b"\x00" * pad)

        chunk = replacement.get(bv_idx, bytes(old_blob[bv.byteOffset: bv.byteOffset + bv.byteLength]))

        gltf.bufferViews[bv_idx].byteOffset = len(new_blob)
        gltf.bufferViews[bv_idx].byteLength = len(chunk)
        new_blob.extend(chunk)

    if gltf.buffers:
        gltf.buffers[0].byteLength = len(new_blob)

    gltf.set_binary_blob(bytes(new_blob))
    updated_bytes = b"".join(gltf.save_to_bytes())

    # Keep image_bytes in sync with what was injected
    updated_image_bytes = dict(asset.image_bytes)
    for img_idx in textures:
        bv_idx = img_to_bv.get(img_idx)
        if bv_idx is not None and bv_idx in replacement:
            updated_image_bytes[img_idx] = replacement[bv_idx]

    return GlbAsset(
        raw_bytes=updated_bytes,
        material_infos=asset.material_infos,
        image_bytes=updated_image_bytes,
        asset_material_type=asset.asset_material_type,
    )


def save_glb(asset: GlbAsset, path: str | Path) -> None:
    """Write a GlbAsset to disk as a .glb file.

    Args:
        asset: The (possibly modified) asset to write.
        path: Destination file path. Parent directories are created if absent.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(asset.raw_bytes)
