"""Adaptive Instance Normalisation (AdaIN) for arbitrary texture style transfer.

Reference: Huang & Belongie, "Arbitrary Style Transfer in Real-time with
Adaptive Instance Normalization", ICCV 2017.

Applies style from the child's drawing to each UV texture extracted from the
.glb, then reinjects the styled textures.

Prototype note:
    Uses optimization-based reconstruction (Adam, 100 steps) rather than a
    pre-trained decoder.  This avoids external weight downloads and is
    sufficient for the Tier 2 prototype; a trained feed-forward decoder
    (see neural/feedforward.py) would replace this for production.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from PIL import Image
from torchvision import models

from style_transfer.config import DEVICE

# ImageNet normalization constants
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD  = [0.229, 0.224, 0.225]

# Lazy singleton encoder cache — keyed by device string to avoid repeated VGG loads
_encoder_cache: dict[str, "VGGEncoder"] = {}


def _get_encoder(device: str) -> "VGGEncoder":
    """Return a cached VGGEncoder on *device*, loading once if absent."""
    if device not in _encoder_cache:
        enc = VGGEncoder().to(device)
        enc.eval()
        _encoder_cache[device] = enc
    return _encoder_cache[device]


def _norm_tensors(device: str) -> tuple[torch.Tensor, torch.Tensor]:
    mean = torch.tensor(_IMAGENET_MEAN, device=device).view(1, 3, 1, 1)
    std  = torch.tensor(_IMAGENET_STD,  device=device).view(1, 3, 1, 1)
    return mean, std


def _preprocess(img_uint8: np.ndarray, size: int, device: str) -> torch.Tensor:
    """Resize → float tensor → ImageNet-normalize → (1, 3, H, W) on *device*."""
    pil = Image.fromarray(img_uint8[..., :3]).resize((size, size), Image.LANCZOS)
    arr = np.array(pil, dtype=np.float32) / 255.0
    t   = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).to(device)
    mean, std = _norm_tensors(device)
    return (t - mean) / std


def _deprocess(tensor: torch.Tensor, device: str) -> np.ndarray:
    """Undo ImageNet normalisation → clamp [0,1] → uint8 (H, W, 3)."""
    mean, std = _norm_tensors(device)
    t = tensor.detach() * std + mean
    t = t.squeeze(0).permute(1, 2, 0).clamp(0.0, 1.0)
    return (t.cpu().numpy() * 255.0).astype(np.uint8)


def _gram_matrix(feat: torch.Tensor) -> torch.Tensor:
    """Normalised Gram matrix of (1, C, H, W) feature map → (1, C, C)."""
    b, c, h, w = feat.shape
    f = feat.reshape(b, c, h * w)
    return torch.bmm(f, f.transpose(1, 2)) / (c * h * w)


# ---------------------------------------------------------------------------
# Core AdaIN operation
# ---------------------------------------------------------------------------

def adain(content_feat: torch.Tensor, style_feat: torch.Tensor) -> torch.Tensor:
    """Apply AdaIN: transfer channel-wise statistics from style to content.

    Formula: σ(style) × (content − μ(content)) / σ(content) + μ(style)

    Args:
        content_feat: (N, C, H, W) content feature map.
        style_feat:   (N, C, H, W) style feature map (from the drawing).

    Returns:
        Stylised feature map, same shape as content_feat.
    """
    eps = 1e-5
    c_mean = content_feat.mean(dim=[2, 3], keepdim=True)
    c_std  = content_feat.std( dim=[2, 3], keepdim=True).clamp(min=eps)
    s_mean = style_feat.mean(  dim=[2, 3], keepdim=True)
    s_std  = style_feat.std(   dim=[2, 3], keepdim=True).clamp(min=eps)
    return s_std * (content_feat - c_mean) / c_std + s_mean


# ---------------------------------------------------------------------------
# VGG-19 encoder
# ---------------------------------------------------------------------------

class VGGEncoder(nn.Module):
    """VGG-19 encoder up to relu4_1, pretrained ImageNet, all weights frozen."""

    def __init__(self) -> None:
        super().__init__()
        vgg   = models.vgg19(weights=models.VGG19_Weights.IMAGENET1K_V1)
        feats = list(vgg.features.children())
        self.slice1 = nn.Sequential(*feats[:2])     # → relu1_1
        self.slice2 = nn.Sequential(*feats[2:7])    # → relu2_1
        self.slice3 = nn.Sequential(*feats[7:12])   # → relu3_1
        self.slice4 = nn.Sequential(*feats[12:21])  # → relu4_1
        for p in self.parameters():
            p.requires_grad_(False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Return relu4_1 feature map (512 ch, H/8 spatial)."""
        return self.slice4(self.slice3(self.slice2(self.slice1(x))))

    def multi_scale(self, x: torch.Tensor) -> list[torch.Tensor]:
        """Return [relu1_1, relu2_1, relu3_1, relu4_1] feature maps."""
        r1 = self.slice1(x)
        r2 = self.slice2(r1)
        r3 = self.slice3(r2)
        r4 = self.slice4(r3)
        return [r1, r2, r3, r4]


# ---------------------------------------------------------------------------
# AdaIN decoder (mirror architecture — suitable for trained weights)
# ---------------------------------------------------------------------------

class AdaINDecoder(nn.Module):
    """Lightweight decoder mirroring VGGEncoder structure.

    Accepts 512-channel relu4_1 features and upsamples back to image
    resolution.  Designed for pre-trained weights; without them the
    output is perceptually rough — use stylize_texture() (optimization-based)
    for the prototype instead.
    """

    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            # 512 ch, H/8 → H/4
            nn.ReflectionPad2d(1), nn.Conv2d(512, 256, 3), nn.ReLU(inplace=True),
            nn.Upsample(scale_factor=2, mode="nearest"),
            nn.ReflectionPad2d(1), nn.Conv2d(256, 256, 3), nn.ReLU(inplace=True),
            nn.ReflectionPad2d(1), nn.Conv2d(256, 128, 3), nn.ReLU(inplace=True),
            nn.Upsample(scale_factor=2, mode="nearest"),
            # 128 ch, H/2 → H
            nn.ReflectionPad2d(1), nn.Conv2d(128, 64, 3), nn.ReLU(inplace=True),
            nn.Upsample(scale_factor=2, mode="nearest"),
            # 64 ch → 3 ch image
            nn.ReflectionPad2d(1), nn.Conv2d(64, 3, 3),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


# ---------------------------------------------------------------------------
# Full stylize_texture: optimization-based AdaIN (no trained decoder needed)
# ---------------------------------------------------------------------------

def stylize_texture(
    texture: np.ndarray,
    style_image: np.ndarray,
    intensity: float = 0.8,
    encoder: nn.Module | None = None,
    decoder: nn.Module | None = None,
    device: str = DEVICE,
    process_size: int = 256,
    n_steps: int = 100,
    content_weight: float = 1.0,
    style_weight: float = 1e4,
) -> np.ndarray:
    """AdaIN texture stylisation via gradient-based image optimisation.

    Encodes *texture* and *style_image* with frozen VGG-19, aligns content
    features to style statistics via AdaIN, then reconstructs the image by
    optimising a canvas to match those aligned features.  No pre-trained
    decoder weights are required.

    Args:
        texture:        RGB uint8 (H, W, 3) — UV texture atlas from .glb.
        style_image:    RGB uint8 — child's drawing.
        intensity:      0 = keep original, 1 = fully stylised.
        encoder:        Pre-loaded VGGEncoder (reused across calls). None = auto.
        decoder:        Unused in optimisation mode; reserved for future upgrade.
        device:         Torch device ('mps' / 'cpu').
        process_size:   Both images are resized to this for VGG encoding.
        n_steps:        Adam iterations for image reconstruction.
        content_weight: Loss weight for AdaIN-feature MSE.
        style_weight:   Loss weight for multi-scale Gram-matrix style loss.

    Returns:
        Stylised RGB uint8 array (H, W, 3) at original texture resolution.
    """
    original_h, original_w = texture.shape[:2]
    enc = encoder if encoder is not None else _get_encoder(device)

    with torch.no_grad():
        content_t      = _preprocess(texture,     process_size, device)
        style_t        = _preprocess(style_image, process_size, device)
        content_feat   = enc(content_t)
        style_feats_ms = enc.multi_scale(style_t)
        target_feat    = adain(content_feat, style_feats_ms[-1])
        style_grams    = [_gram_matrix(f) for f in style_feats_ms]

    canvas = content_t.clone().detach().requires_grad_(True)
    optimizer = optim.Adam([canvas], lr=0.01)

    for _ in range(n_steps):
        optimizer.zero_grad()
        canvas_feats = enc.multi_scale(canvas)

        c_loss = nn.functional.mse_loss(canvas_feats[-1], target_feat)
        s_loss = sum(
            nn.functional.mse_loss(_gram_matrix(canvas_feats[i]), style_grams[i])
            for i in range(4)
        )
        (content_weight * c_loss + style_weight * s_loss).backward()
        optimizer.step()

    styled_small = _deprocess(canvas, device)
    styled = np.array(
        Image.fromarray(styled_small).resize((original_w, original_h), Image.LANCZOS),
        dtype=np.uint8,
    )
    return np.clip(
        intensity * styled.astype(np.float32) + (1.0 - intensity) * texture[..., :3].astype(np.float32),
        0, 255,
    ).astype(np.uint8)
