"""
Automatic quality control for the Open Food Facts sweep.

For each candidate: download (cached), crop to the pack with the SKU-110K
detector, reject blurry / tiny images, then use DINOv3 fingerprints to reject
photos that don't look like the rest of their category (nutrition labels,
kitchen shots, wrong items) and near-identical duplicate photos.

Usage: python scripts/starter/qc_sweep.py <sku110k-yolo11-s640.onnx>
Writes off_sweep.json (accepted) and off_sweep_rejected.json (with reasons).
"""
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
sys.path.insert(0, HERE)
from build_index import cached_model, to_tensor, EMBEDDERS  # noqa: E402
from build_starter import detect_main_pack  # noqa: E402

CACHE = os.path.join(os.path.expanduser('~'), '.cache', 'shelfscan', 'off')
UA = {'User-Agent': 'ShelfScan/0.1 (starter catalogue builder)'}


def fetch(c):
    path = os.path.join(CACHE, f"{c['code']}.jpg")
    if not os.path.exists(path):
        for _ in range(3):
            try:
                data = urllib.request.urlopen(urllib.request.Request(c['image'], headers=UA), timeout=60).read()
                open(path, 'wb').write(data)
                break
            except Exception:  # noqa: BLE001
                time.sleep(2)
    return path if os.path.exists(path) else None


def sharpness(im):
    g = im.convert('L').resize((256, int(256 * im.height / im.width)) if im.width > 0 else (256, 256))
    a = np.asarray(g.filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    return float(a.var())


def main(detector):
    os.makedirs(CACHE, exist_ok=True)
    cands = json.load(open(os.path.join(HERE, 'off_sweep_candidates.json')))
    with ThreadPoolExecutor(6) as ex:
        paths = list(ex.map(fetch, cands))
    det = ort.InferenceSession(detector)
    emb_sess = ort.InferenceSession(cached_model('dinov3-s'))
    spec = EMBEDDERS['dinov3-s']
    accepted, rejected, crops = [], [], []
    for c, p in zip(cands, paths):
        if not p:
            rejected.append({**c, 'reason': 'download failed'}); continue
        try:
            im = Image.open(p).convert('RGB')
        except Exception:  # noqa: BLE001
            rejected.append({**c, 'reason': 'unreadable'}); continue
        if min(im.size) < 90 or max(im.size) < 200:
            rejected.append({**c, 'reason': 'too small'}); continue
        crop = detect_main_pack(det, im)
        if sharpness(crop) < 120:
            rejected.append({**c, 'reason': 'blurry'}); continue
        crop.thumbnail((384, 384))
        crops.append(crop); accepted.append(c)
    # Fingerprints
    E = []
    for i in range(0, len(crops), 16):
        x = np.stack([to_tensor(im, spec['mean'], spec['std']) for im in crops[i:i + 16]])
        e = emb_sess.run(['pooler_output'], {'pixel_values': x})[0]
        E.append(e / np.linalg.norm(e, axis=1, keepdims=True))
    E = np.concatenate(E)
    S = E @ E.T
    np.fill_diagonal(S, -1)
    keep = np.ones(len(accepted), bool)
    # Typicality: mean similarity to the 8 most similar photos in the same category.
    cats = np.array([c['category'] for c in accepted])
    typ = np.zeros(len(accepted))
    for cat in set(cats):
        idx = np.where(cats == cat)[0]
        sub = S[np.ix_(idx, idx)]
        k = min(8, len(idx) - 1)
        typ[idx] = np.sort(sub, axis=1)[:, -k:].mean(1)
        # Only extreme outliers: real packs vary a lot within a category, so a
        # stricter cut rejects good products (measured: good 0.28-0.47, bad 0.31-0.39).
        cut = 0.25
        for i in idx:
            if typ[i] < cut:
                keep[i] = False
                rejected.append({**accepted[i], 'reason': f'atypical photo ({typ[i]:.2f})'})
    # Near-identical photos listed under different names: keep the most-scanned.
    order = sorted(range(len(accepted)), key=lambda i: -accepted[i]['scans'])
    for a_i, i in enumerate(order):
        if not keep[i]:
            continue
        for j in order[a_i + 1:]:
            if keep[j] and S[i, j] > 0.985:
                keep[j] = False
                rejected.append({**accepted[j], 'reason': f'duplicate photo of {accepted[i]["name"]}'})
    final = [{**c, 'typicality': round(float(typ[i]), 3)} for i, c in enumerate(accepted) if keep[i]]
    json.dump(final, open(os.path.join(HERE, 'off_sweep.json'), 'w'), indent=1)
    json.dump(rejected, open(os.path.join(HERE, 'off_sweep_rejected.json'), 'w'), indent=1)
    from collections import Counter
    print(len(final), 'accepted', dict(Counter(c['category'] for c in final)))
    print(len(rejected), 'rejected', dict(Counter(r['reason'].split(' (')[0].split(' of ')[0] for r in rejected)))


if __name__ == '__main__':
    main(sys.argv[1])
