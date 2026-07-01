"""Load a binary glTF (.glb) file and expose its mesh, materials, and textures.

Never modifies geometry — read-only access to the mesh data.

Four material types are present in the asset library (see data/glb/catalog.json):
  TEXTURED  — pbrMetallicRoughness.baseColorTexture  (most assets)
  FLAT      — pbrMetallicRoughness.baseColorFactor only (clouds, rainbow, etc.)
  MIXED     — some materials textured, some flat
  KHR_SPEC  — KHR_materials_pbrSpecularGlossiness extension (legacy, some trees/butterfly)
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Literal

import numpy as np
from PIL import Image
from pygltflib import GLTF2


class MaterialType(str, Enum):
    TEXTURED = "TEXTURED"
    FLAT     = "FLAT"
    MIXED    = "MIXED"
    KHR_SPEC = "KHR_SPEC"  # legacy KHR_materials_pbrSpecularGlossiness
    UNKNOWN  = "UNKNOWN"


@dataclass
class MaterialInfo:
    """Normalised view of one glTF material regardless of which PBR variant it uses.

    Attributes:
        index: Position in gltf.materials list.
        name: Material name from the glTF JSON.
        mat_type: TEXTURED / FLAT / KHR_SPEC / UNKNOWN.
        base_color_factor: RGBA (0–1) — set for FLAT materials and as fallback.
        base_color_texture_index: glTF *image* index for the colour texture, or None.
    """
    index: int
    name: str
    mat_type: MaterialType
    base_color_factor: tuple[float, float, float, float]
    base_color_texture_index: int | None


@dataclass
class GlbAsset:
    """In-memory representation of a loaded .glb.

    Attributes:
        raw_bytes: Original file bytes — used for pass-through and round-trip.
        material_infos: Normalised list of MaterialInfo (one per glTF material).
        image_bytes: Mapping from glTF image index → raw PNG/JPEG bytes.
        asset_material_type: Overall type of the asset (TEXTURED/FLAT/MIXED/KHR_SPEC).
    """
    raw_bytes: bytes
    material_infos: list[MaterialInfo] = field(default_factory=list)
    image_bytes: dict[int, bytes] = field(default_factory=dict)
    asset_material_type: MaterialType = MaterialType.UNKNOWN


def load_glb(path: str | Path) -> GlbAsset:
    """Parse a .glb file and return a GlbAsset.

    Handles all four material types found in the asset library. Extracts
    materials and embedded texture bytes without touching mesh geometry.

    Args:
        path: Filesystem path to the .glb file.

    Returns:
        Populated GlbAsset with raw bytes, material infos, and image bytes.
    """
    path = Path(path)
    raw_bytes = path.read_bytes()
    gltf = GLTF2().load(str(path))

    # --- Extract raw image bytes from the binary buffer ---
    image_bytes: dict[int, bytes] = {}
    for img_idx, img in enumerate(gltf.images or []):
        if img.bufferView is not None:
            bv = gltf.bufferViews[img.bufferView]
            blob = gltf.binary_blob()
            image_bytes[img_idx] = blob[bv.byteOffset: bv.byteOffset + bv.byteLength]
        # uri-based images (external files) are not expected in these assets;
        # skip silently if encountered.

    # --- Normalise each material ---
    material_infos: list[MaterialInfo] = []
    for mat_idx, mat in enumerate(gltf.materials or []):
        pbr   = mat.pbrMetallicRoughness
        exts  = mat.extensions or {}
        name  = mat.name or f"material_{mat_idx}"

        if pbr is not None:
            factor = tuple(pbr.baseColorFactor) if pbr.baseColorFactor else (1.0, 1.0, 1.0, 1.0)
            if pbr.baseColorTexture is not None:
                # Resolve texture → image index
                tex   = gltf.textures[pbr.baseColorTexture.index]
                img_i = tex.source
                material_infos.append(MaterialInfo(
                    index=mat_idx, name=name, mat_type=MaterialType.TEXTURED,
                    base_color_factor=factor, base_color_texture_index=img_i,
                ))
            else:
                material_infos.append(MaterialInfo(
                    index=mat_idx, name=name, mat_type=MaterialType.FLAT,
                    base_color_factor=factor, base_color_texture_index=None,
                ))

        elif "KHR_materials_pbrSpecularGlossiness" in exts:
            sg = exts["KHR_materials_pbrSpecularGlossiness"]
            factor = tuple(sg.get("diffuseFactor", [1.0, 1.0, 1.0, 1.0]))
            diffuse_tex = sg.get("diffuseTexture")
            img_i = None
            if diffuse_tex is not None:
                tex   = gltf.textures[diffuse_tex["index"]]
                img_i = tex.source
            material_infos.append(MaterialInfo(
                index=mat_idx, name=name, mat_type=MaterialType.KHR_SPEC,
                base_color_factor=factor, base_color_texture_index=img_i,
            ))

        else:
            material_infos.append(MaterialInfo(
                index=mat_idx, name=name, mat_type=MaterialType.UNKNOWN,
                base_color_factor=(1.0, 1.0, 1.0, 1.0), base_color_texture_index=None,
            ))

    # --- Derive overall asset material type ---
    types = {m.mat_type for m in material_infos}
    if len(types) == 1:
        asset_type = next(iter(types))
    elif MaterialType.TEXTURED in types and MaterialType.FLAT in types:
        asset_type = MaterialType.MIXED
    elif types:
        asset_type = MaterialType.MIXED
    else:
        asset_type = MaterialType.UNKNOWN

    return GlbAsset(
        raw_bytes=raw_bytes,
        material_infos=material_infos,
        image_bytes=image_bytes,
        asset_material_type=asset_type,
    )


def extract_textures(asset: GlbAsset) -> dict[int, np.ndarray]:
    """Decode all embedded colour texture images to numpy arrays (H, W, C) uint8.

    Only returns the *colour* (baseColor / diffuse) textures — the ones that
    style transfer will modify. Normal/roughness maps are left untouched.

    Args:
        asset: A GlbAsset produced by load_glb.

    Returns:
        Dict mapping glTF image index → RGB uint8 numpy array (H, W, 3).
    """
    result: dict[int, np.ndarray] = {}
    colour_image_indices = {
        m.base_color_texture_index
        for m in asset.material_infos
        if m.base_color_texture_index is not None
    }
    for img_idx in colour_image_indices:
        raw = asset.image_bytes.get(img_idx)
        if raw is None:
            continue
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        result[img_idx] = np.array(img, dtype=np.uint8)
    return result
