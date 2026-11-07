"""
Pre-compute the recognition "fingerprints" for a product library.

Instead of every phone downloading every reference photo and running the
recognition model on it, the fingerprints are computed once here and
published as a small binary file next to manifest.json. Phones then download
~0.4 KB per photo instead of ~20 KB and skip the slow on-device step, so the
library can grow to thousands of products without bloating the app.

Works on either layout:
  * a bucket folder:  <root>/<Product>/<photo>.jpg  (what you upload to R2)
  * the starter app library: public/starter/manifest.json + public/starter/file/<Product>/...

Output (written next to the product folders):
  index-<embedder>.bin   per photo: <dim> int8 embedding values + 40 uint8 colour-histogram values
  index-<embedder>.json  {"file", "dim", "hist", "images": [photo paths in .bin order]}
  manifest.json          (starter layout only) gains the same entry under "indexes"

Upload both index files to the bucket root with the photos; the catalogue
Worker advertises them automatically. Photos added later without re-running
this script are simply learned on the phone, so a stale index is harmless.

The pre-processing mirrors src/lib/image.ts + src/lib/embed.ts (letterbox to
224, ImageNet normalisation, central-crop hue/saturation histogram).

Usage:
  python scripts/build_index.py <library or bucket folder> [--model path/to/model.onnx]
  (the DINOv3-S model is downloaded and cached automatically if --model is omitted)
"""
import argparse
import colorsys
import json
import os
import urllib.request

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageEnhance, ImageFilter

EMBEDDERS = {
    'dinov3-s': {
        'url': 'https://huggingface.co/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/resolve/main/onnx/model.onnx',
        'data': 'https://huggingface.co/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/resolve/main/onnx/model.onnx_data',
        'mean': [0.485, 0.456, 0.406],
        'std': [0.229, 0.224, 0.225],
    },
    'siglip2-b': {
        'url': 'https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/onnx/vision_model_quantized.onnx',
        'mean': [0.5, 0.5, 0.5],
        'std': [0.5, 0.5, 0.5],
    },
    'clip-b32': {
        'url': 'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx',
        'mean': [0.48145466, 0.4578275, 0.40821073],
        'std': [0.26862954, 0.26130258, 0.27577711],
    },
}
HIST_BINS = 40


def cached_model(embedder):
    spec = EMBEDDERS[embedder]
    d = os.path.join(os.path.expanduser('~'), '.cache', 'shelfscan', embedder)
    os.makedirs(d, exist_ok=True)
    for key in ('url', 'data'):
        if spec.get(key):
            dest = os.path.join(d, spec[key].split('/')[-1])
            if not os.path.exists(dest):
                print('downloading', spec[key])
                urllib.request.urlretrieve(spec[key], dest)
    return os.path.join(d, spec['url'].split('/')[-1])


def load(path):
    im = Image.open(path).convert('RGB')
    im.thumbnail((512, 512), Image.Resampling.LANCZOS)  # loadImageToCanvas(blob, 512)
    return im


def to_tensor(im, mean, std, size=224):
    s = size / max(im.size)
    dw, dh = max(1, round(im.width * s)), max(1, round(im.height * s))
    t = Image.new('RGB', (size, size), (124, 116, 104))
    t.paste(im.resize((dw, dh), Image.Resampling.LANCZOS), ((size - dw) >> 1, (size - dh) >> 1))
    a = np.asarray(t, dtype=np.float32) / 255
    return ((a - np.array(mean, dtype=np.float32)) / np.array(std, dtype=np.float32)).transpose(2, 0, 1)


def color_hist(im):
    """Mirror of colorHist() in src/lib/embed.ts: strided sample of the central region's original pixels."""
    a = np.asarray(im, dtype=np.float32) / 255
    H, W = a.shape[:2]
    x0, y0 = int(W * 0.15), int(H * 0.1)
    w, h = max(1, int(W * 0.7)), max(1, int(H * 0.8))
    step = max(1, int(((w * h) / 4096) ** 0.5))
    px = a[y0:y0 + h:step, x0:x0 + w:step].reshape(-1, 3)
    hist = np.zeros(HIST_BINS, dtype=np.float32)
    for r, g, b in px:
        mx, mn = max(r, g, b), min(r, g, b)
        sat = (mx - mn) / mx if mx else 0
        if sat < 0.2 or mx < 0.12:
            hist[36 + min(3, int(mx * 4))] += 1
            continue
        hue = colorsys.rgb_to_hsv(r, g, b)[0]
        hist[min(11, int(hue * 12)) * 3 + (0 if sat < 0.45 else 1 if sat < 0.75 else 2)] += 1
    return hist / max(1, len(px))


def _inner(im, fx=0.08, fy=0.05):
    w, h = im.size
    return im.crop((int(w * fx), int(h * fy), int(w * (1 - fx)), int(h * (1 - fy))))


VARIANTS = ['original', 'inner', 'darker', 'flat', 'soft']
VARIANT_FNS = {
    'original': lambda im: im,
    'inner': _inner,
    'darker': lambda im: ImageEnhance.Brightness(im).enhance(0.8),
    'flat': lambda im: ImageEnhance.Contrast(ImageEnhance.Brightness(im).enhance(1.15)).enhance(0.85),
    'soft': lambda im: im.filter(ImageFilter.GaussianBlur(1.2)),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('library')
    ap.add_argument('--embedder', default='dinov3-s')
    ap.add_argument('--model')
    ap.add_argument('--no-augment', action='store_true', help='one fingerprint per photo (smaller index)')
    args = ap.parse_args()
    spec = EMBEDDERS[args.embedder]
    sess = ort.InferenceSession(args.model or cached_model(args.embedder))
    outs = [o.name for o in sess.get_outputs()]
    out_name = next((n for n in ('image_embeds', 'pooler_output') if n in outs), outs[0])  # same choice as src/lib/embed.ts

    manifest_path = os.path.join(args.library, 'manifest.json')
    files_dir = os.path.join(args.library, 'file') if os.path.isdir(os.path.join(args.library, 'file')) else args.library
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else None
    if manifest:
        paths = [img for p in manifest['products'] for img in p['images']]
    else:  # bucket layout: every image inside a product folder
        exts = ('.jpg', '.jpeg', '.png', '.webp', '.avif')
        paths = sorted(
            os.path.relpath(os.path.join(d, f), files_dir).replace(os.sep, '/')
            for d, _, fs in os.walk(files_dir)
            for f in fs
            if f.lower().endswith(exts) and d != files_dir and not os.path.relpath(d, files_dir).startswith(('models', '_', '.'))
        )
    # Each reference photo also gets fingerprinted under shelf-like variations
    # (tighter crop, darker, flatter/brighter, softer focus). Measured on a real
    # chiller photo with Open Food Facts references only: correct confident
    # matches 9 -> 14 of 21 at zero extra cost on the phone.
    augment = not args.no_augment and args.embedder == 'dinov3-s'
    jobs = [(p, v) for p in paths for v in (VARIANTS if augment else VARIANTS[:1])]
    rows, row_paths = [], []
    B = 16
    for i in range(0, len(jobs), B):
        ims = [VARIANT_FNS[v](load(os.path.join(files_dir, p))) for p, v in jobs[i:i + B]]
        row_paths += [p for p, _ in jobs[i:i + B]]
        x = np.stack([to_tensor(im, spec['mean'], spec['std']) for im in ims])
        e = sess.run([out_name], {'pixel_values': x})[0]
        if e.ndim == 3:
            e = e[:, 0]
        e = e / np.linalg.norm(e, axis=1, keepdims=True)
        for k, im in enumerate(ims):
            q = np.clip(np.round(e[k] * 127), -127, 127).astype(np.int8)
            hq = np.clip(np.round(color_hist(im) * 255), 0, 255).astype(np.uint8)
            rows.append(q.tobytes() + hq.tobytes())
        print(f'{min(i + B, len(jobs))}/{len(jobs)}', end='\r')
    dim = int(e.shape[1])
    fname = f'index-{args.embedder}.bin'
    with open(os.path.join(files_dir, fname), 'wb') as f:
        f.write(b''.join(rows))
    info = {'file': fname, 'dim': dim, 'hist': HIST_BINS, 'images': row_paths}  # one entry per row; photos repeat when augmented
    json.dump(info, open(os.path.join(files_dir, f'index-{args.embedder}.json'), 'w'))
    if manifest:
        manifest.setdefault('indexes', {})[args.embedder] = info
        import time
        manifest['generated'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())  # phones re-sync on change
        json.dump(manifest, open(manifest_path, 'w'), indent=1)
    print(f'\n{len(rows)} fingerprints -> {fname} ({len(rows) * (dim + HIST_BINS) / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
