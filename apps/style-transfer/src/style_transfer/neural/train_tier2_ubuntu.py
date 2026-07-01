"""
Tier 2 feed-forward NST training script — Ubuntu / CUDA (RTX 2060).
Run: python train_tier2_ubuntu.py --style watercolor
"""

import argparse
import time
from pathlib import Path

import torch
import torch.nn as nn
import torchvision.transforms as T
from torch.utils.data import DataLoader, Dataset
from torchvision import models
from PIL import Image
import numpy as np
from tqdm import tqdm

# ── paths ──────────────────────────────────────────────────────────────────────
ROOT       = Path.home() / 'fyp'
COCO_DIR   = ROOT / 'data' / 'coco2017'
STYLES_DIR = ROOT / 'data' / 'styles'
MODELS_DIR = ROOT / 'models'
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── hyper-params ───────────────────────────────────────────────────────────────
IMAGE_SIZE   = 256
BATCH_SIZE   = 4        # safe for RTX 2060 6 GB
NUM_WORKERS  = 4        # i7-9700 has 8 cores
N_EPOCHS     = 2
LR           = 1e-3
STYLE_WEIGHT = 1e5
CONTENT_WEIGHT = 1.0
LOG_EVERY    = 100      # print loss every N steps
CKPT_EVERY   = 1000     # save checkpoint every N steps

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f"Device: {DEVICE}")
if DEVICE.type == 'cuda':
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")


# ── dataset ────────────────────────────────────────────────────────────────────
class COCODataset(Dataset):
    def __init__(self, folder: Path, size: int):
        self.files = sorted(folder.glob('*.jpg'))
        self.tf = T.Compose([
            T.Resize((size, size)),
            T.ToTensor(),
        ])

    def __len__(self):
        return len(self.files)

    def __getitem__(self, idx):
        img = Image.open(self.files[idx]).convert('RGB')
        return self.tf(img)


# ── VGG loss ───────────────────────────────────────────────────────────────────
class VGGLoss(nn.Module):
    STYLE_LAYERS   = ['relu1_2', 'relu2_2', 'relu3_3', 'relu4_3']
    CONTENT_LAYER  = 'relu2_2'

    def __init__(self):
        super().__init__()
        vgg = models.vgg16(weights=models.VGG16_Weights.DEFAULT).features
        self.slices = nn.ModuleDict({
            'relu1_2': nn.Sequential(*list(vgg)[:4]),
            'relu2_2': nn.Sequential(*list(vgg)[4:9]),
            'relu3_3': nn.Sequential(*list(vgg)[9:16]),
            'relu4_3': nn.Sequential(*list(vgg)[16:23]),
        })
        for p in self.parameters():
            p.requires_grad_(False)
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        std  = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
        self.register_buffer('mean', mean)
        self.register_buffer('std',  std)

    def forward(self, x):
        h = (x - self.mean) / self.std  # normalise once
        feats, prev = {}, h
        for name, layer in self.slices.items():
            prev = layer(prev)
            feats[name] = prev
        return feats

    @staticmethod
    def gram(f):
        B, C, H, W = f.shape
        f = f.view(B, C, H * W)
        return torch.bmm(f, f.transpose(1, 2)) / (C * H * W)


# ── style network (Johnson et al. 2016) ────────────────────────────────────────
class ResBlock(nn.Module):
    def __init__(self, ch):
        super().__init__()
        self.net = nn.Sequential(
            nn.ReflectionPad2d(1),
            nn.Conv2d(ch, ch, 3), nn.InstanceNorm2d(ch), nn.ReLU(True),
            nn.ReflectionPad2d(1),
            nn.Conv2d(ch, ch, 3), nn.InstanceNorm2d(ch),
        )

    def forward(self, x):
        return x + self.net(x)


class StyleNetwork(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            # encoder
            nn.ReflectionPad2d(4),
            nn.Conv2d(3, 32, 9, 1), nn.InstanceNorm2d(32), nn.ReLU(True),
            nn.Conv2d(32, 64, 3, 2, 1), nn.InstanceNorm2d(64), nn.ReLU(True),
            nn.Conv2d(64, 128, 3, 2, 1), nn.InstanceNorm2d(128), nn.ReLU(True),
            # residual blocks
            ResBlock(128), ResBlock(128), ResBlock(128),
            ResBlock(128), ResBlock(128),
            # decoder
            nn.ConvTranspose2d(128, 64, 3, 2, 1, 1), nn.InstanceNorm2d(64), nn.ReLU(True),
            nn.ConvTranspose2d(64, 32, 3, 2, 1, 1), nn.InstanceNorm2d(32), nn.ReLU(True),
            nn.ReflectionPad2d(4),
            nn.Conv2d(32, 3, 9, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.net(x)


# ── checkpoint helpers ─────────────────────────────────────────────────────────
def save_checkpoint(style_name, epoch, step, model, optimizer):
    path = MODELS_DIR / f'{style_name}_epoch{epoch:02d}_step{step}.pt'
    torch.save({
        'epoch': epoch + 1,   # next epoch to start
        'step':  step,
        'model': model.state_dict(),
        'optim': optimizer.state_dict(),
    }, path)
    return path


def load_latest_checkpoint(style_name, model, optimizer):
    ckpts = sorted(MODELS_DIR.glob(f'{style_name}_epoch*.pt'))
    if not ckpts:
        return 0, 0
    ckpt = torch.load(ckpts[-1], map_location=DEVICE)
    model.load_state_dict(ckpt['model'])
    optimizer.load_state_dict(ckpt['optim'])
    print(f"Resumed from {ckpts[-1].name}")
    return ckpt['epoch'], ckpt['step']


# ── load style image ───────────────────────────────────────────────────────────
def load_style_tensor(style_name: str) -> torch.Tensor:
    for ext in ('.jpg', '.jpeg', '.png'):
        p = STYLES_DIR / f'{style_name}{ext}'
        if p.exists():
            img = Image.open(p).convert('RGB').resize((IMAGE_SIZE, IMAGE_SIZE))
            return T.ToTensor()(img).unsqueeze(0).to(DEVICE)
    raise FileNotFoundError(f"Style image not found for '{style_name}' in {STYLES_DIR}")


# ── training loop ──────────────────────────────────────────────────────────────
def train(style_name: str):
    print(f"\n=== Training style: {style_name} ===")

    dataset = COCODataset(COCO_DIR, IMAGE_SIZE)
    print(f"COCO images: {len(dataset)}")
    loader  = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True,
                         num_workers=NUM_WORKERS, pin_memory=True,
                         drop_last=True)

    net    = StyleNetwork().to(DEVICE)
    vgg    = VGGLoss().to(DEVICE)
    optim  = torch.optim.Adam(net.parameters(), lr=LR)

    start_epoch, step = load_latest_checkpoint(style_name, net, optim)

    style_img = load_style_tensor(style_name)
    with torch.no_grad():
        style_feats = vgg(style_img.expand(BATCH_SIZE, -1, -1, -1))
    style_grams = {k: VGGLoss.gram(v) for k, v in style_feats.items()}

    total_steps = N_EPOCHS * len(loader)
    print(f"Starting epoch {start_epoch} / {N_EPOCHS}")

    for epoch in range(start_epoch, N_EPOCHS):
        net.train()
        epoch_start = time.time()

        for batch_idx, content in enumerate(tqdm(loader, desc=f'Epoch {epoch+1}/{N_EPOCHS}')):
            content = content.to(DEVICE, non_blocking=True)
            styled  = net(content)

            c_feats = vgg(content)
            s_feats = vgg(styled)

            # content loss
            c_loss = nn.functional.mse_loss(
                s_feats[VGGLoss.CONTENT_LAYER],
                c_feats[VGGLoss.CONTENT_LAYER].detach()
            )

            # style loss
            s_loss = sum(
                nn.functional.mse_loss(VGGLoss.gram(s_feats[l]),
                                       style_grams[l][:content.size(0)])
                for l in VGGLoss.STYLE_LAYERS
            )

            loss = CONTENT_WEIGHT * c_loss + STYLE_WEIGHT * s_loss

            optim.zero_grad()
            loss.backward()
            optim.step()

            step += 1
            if step % LOG_EVERY == 0:
                print(f"  step {step}/{total_steps} | "
                      f"content={c_loss.item():.4f} | "
                      f"style={s_loss.item():.4f} | "
                      f"total={loss.item():.4f}")

            if step % CKPT_EVERY == 0:
                p = save_checkpoint(style_name, epoch, step, net, optim)
                print(f"  Checkpoint saved: {p.name}")

        # end of epoch checkpoint
        p = save_checkpoint(style_name, epoch, step, net, optim)
        elapsed = time.time() - epoch_start
        print(f"Epoch {epoch+1} done in {elapsed/60:.1f} min — saved {p.name}")

    # save final model
    final = MODELS_DIR / f'{style_name}_final.pt'
    torch.save(net.state_dict(), final)
    print(f"\nFinal model saved: {final}")


# ── main ───────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--style', required=True,
                        help='Style name matching a file in data/styles/ (e.g. watercolor)')
    args = parser.parse_args()
    train(args.style)
