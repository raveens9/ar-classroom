"""Feed-forward style network for fast, fixed-style texture transfer.

A single forward pass replaces the iterative optimisation of AdaIN, making
it suitable for real-time serving. One network per style preset is trained
offline on Colab and saved to models/<style_name>.pt.

If weights exist for the requested preset, _run_tier2 in pipeline.py uses
this path; otherwise it falls back to optimization-based AdaIN.

Reference: Johnson et al., "Perceptual Losses for Real-Time Style Transfer
and Super-Resolution", ECCV 2016. arXiv:1603.08155.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

from style_transfer.config import DEVICE, MODELS_DIR


# ---------------------------------------------------------------------------
# Architecture
# ---------------------------------------------------------------------------

class ResidualBlock(nn.Module):
    """Conv → IN → ReLU → Conv → IN with residual skip connection."""

    def __init__(self, channels: int = 128) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.ReflectionPad2d(1),
            nn.Conv2d(channels, channels, kernel_size=3),
            nn.InstanceNorm2d(channels),
            nn.ReLU(inplace=True),
            nn.ReflectionPad2d(1),
            nn.Conv2d(channels, channels, kernel_size=3),
            nn.InstanceNorm2d(channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.net(x)


class StyleNetwork(nn.Module):
    """Feed-forward style transfer network (encoder – residuals – decoder).

    Architecture matches the Ubuntu training script (train_tier2_ubuntu.py):
        Encoder:   3→32 (9×9 s1) → 32→64 (3×3 s2) → 64→128 (3×3 s2)
        Residuals: 5× ResidualBlock(128)
        Decoder:   128→64 ConvT(s2) → 64→32 ConvT(s2) → 32→3 (9×9 s1) → Sigmoid

    Output range: [0, 1] (Sigmoid).
    """

    def __init__(self) -> None:
        super().__init__()
        self.net = nn.Sequential(
            # encoder
            nn.ReflectionPad2d(4),
            nn.Conv2d(3, 32, kernel_size=9, stride=1),
            nn.InstanceNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, kernel_size=3, stride=2, padding=1),
            nn.InstanceNorm2d(64),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 128, kernel_size=3, stride=2, padding=1),
            nn.InstanceNorm2d(128),
            nn.ReLU(inplace=True),
            # residual blocks
            ResidualBlock(128), ResidualBlock(128), ResidualBlock(128),
            ResidualBlock(128), ResidualBlock(128),
            # decoder
            nn.ConvTranspose2d(128, 64, kernel_size=3, stride=2, padding=1, output_padding=1),
            nn.InstanceNorm2d(64),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(64, 32, kernel_size=3, stride=2, padding=1, output_padding=1),
            nn.InstanceNorm2d(32),
            nn.ReLU(inplace=True),
            nn.ReflectionPad2d(4),
            nn.Conv2d(32, 3, kernel_size=9, stride=1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


# ---------------------------------------------------------------------------
# Weight loading
# ---------------------------------------------------------------------------

def load_style_network(style_name: str) -> StyleNetwork:
    """Load a pretrained StyleNetwork for the given style preset.

    Weights must be stored at models/<style_name>.pt (gitignored).

    Args:
        style_name: One of the named style presets (e.g. "watercolor").

    Returns:
        StyleNetwork in eval mode on DEVICE.

    Raises:
        FileNotFoundError: If no weights file exists for this style.
    """
    weights_path = MODELS_DIR / f"{style_name}.pt"
    if not weights_path.exists():
        raise FileNotFoundError(f"No pretrained weights found at {weights_path}")
    net = StyleNetwork()
    net.load_state_dict(
        torch.load(weights_path, map_location=DEVICE, weights_only=True)
    )
    return net.to(DEVICE).eval()


# ---------------------------------------------------------------------------
# Inference
# ---------------------------------------------------------------------------

def stylize_texture(
    texture: np.ndarray,
    style_name: str,
    intensity: float = 0.8,
    network: StyleNetwork | None = None,
) -> np.ndarray:
    """Apply a feed-forward style transfer to a single texture image.

    Args:
        texture:   RGB uint8 array (H, W, 3).
        style_name: Preset name — used to load weights if network is None.
        intensity: Blend strength (0.0 = original, 1.0 = fully styled).
        network:   Pre-loaded StyleNetwork (avoids reloading weights per call).

    Returns:
        Stylised RGB uint8 array (H, W, 3).

    Raises:
        FileNotFoundError: If network is None and no weights exist for style_name.
    """
    if network is None:
        network = load_style_network(style_name)

    from PIL import Image as _Image

    H, W = texture.shape[:2]
    original_full = texture.astype(np.float32) / 255.0

    # Resize to half the texture size before stylizing.
    # The network trained at 256×256; applying it to 2048×2048 directly makes
    # style strokes 8× too large. Half-size (1024) gives proportional strokes
    # while preserving fine details better than resizing all the way to 256.
    proc_size = max(256, min(W, H) // 2)
    small = np.array(
        _Image.fromarray(texture).resize((proc_size, proc_size), _Image.LANCZOS),
        dtype=np.float32,
    ) / 255.0

    net_device = next(network.parameters()).device
    x = torch.from_numpy(small).permute(2, 0, 1).unsqueeze(0).to(net_device)

    with torch.no_grad():
        out = network(x)

    styled_small = np.clip(out.squeeze(0).permute(1, 2, 0).cpu().numpy(), 0.0, 1.0)

    styled_full = np.array(
        _Image.fromarray((styled_small * 255).astype(np.uint8)).resize((W, H), _Image.LANCZOS),
        dtype=np.float32,
    ) / 255.0

    blended = intensity * styled_full + (1.0 - intensity) * original_full
    return (np.clip(blended, 0.0, 1.0) * 255).astype(np.uint8)
