# ShelfScan

An installable phone app for retailers and sales reps. Its one job: **take a photo of a bay and find the top-selling SKUs that aren't on it.**

1. It **finds every product facing** on the shelf (SKU-110K YOLO11 detector).
2. It **identifies each SKU** by comparing it with reference photos (DINOv3 image recognition plus colour).
3. It works out **which category the bay is** (energy, sports, cola…) and checks it against **that category's top sellers**.
4. It shows **"N top sellers missing"** first, then the shelf with **green boxes on top sellers**, **red boxes on slow sellers** and **amber boxes where it isn't sure**, then secondary advice (slow sellers taking space, facings, empty gaps).

Field users only ever see the Scan screen. The product library, sales ranking and models are managed by the admin and sync to every phone automatically. Everything runs on the phone (ONNX Runtime Web, WebGPU with WASM fallback). After the first run it works offline in-store, and photos never leave the device.

## Get it on your phone

### Option A: Android APK (built by GitHub, no hosting needed)

Every push builds an APK with GitHub Actions (`.github/workflows/android.yml`) and publishes it as a GitHub Release.

1. On the Android phone, open **https://github.com/pmoppy/matthew/releases/latest/download/shelfscan.apk** (or the repo's **Releases** page) and download the APK.
2. Open the downloaded file. The first time, Android asks you to allow your browser or Files app to **install unknown apps**. Allow it, go back, and tap **Install**.
3. Open **ShelfScan**. The first launch downloads the recognition models (about 125 MB, ideally on Wi-Fi), then it works offline.

**Updates:** when a newer build exists, the app shows a **"New version available → Download"** banner on launch. Tap it and install over the top. Your data and downloaded models are kept, because every build is signed with the same test key (`android/keystore`, testing only). **Admin mode in the APK:** tap the ShelfScan logo 7 times.

### Option B: install from the browser (iPhone and Android)

ShelfScan is a **web app you install from the browser**, not an APK. There's nothing to download from GitHub: you host it once (free) and open the link on each phone.

**1. Host it on Cloudflare Pages (one-off, about 5 minutes)**

1. Merge this branch into `main` on GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick `pmoppy/matthew`.
3. Build settings: framework preset **None**, build command `npm run build`, output directory `dist`.
4. *(Optional, once your R2 catalogue exists)* under **Environment variables**, add `VITE_CATALOG_URL = https://<your-catalogue-worker>.workers.dev`. Without it the app uses the built-in starter library.
5. **Save and Deploy.** You get a URL such as `https://shelfscan.pages.dev`. Every push to `main` redeploys automatically.

**2. Install on each phone**

- **iPhone (Safari):** open the URL → Share button → **Add to Home Screen**.
- **Android (Chrome):** open the URL → ⋮ menu → **Install app** (or **Add to Home screen**).

It then opens full-screen from its own icon like a normal app. The first launch downloads the models (about 125 MB, so ideally on Wi-Fi). After that it works offline.

> **Need a real APK / Play Store listing later?** Paste the Pages URL into [PWABuilder](https://www.pwabuilder.com), which packages the same app as an Android APK/AAB (and an iOS project) without code changes.

**Admin mode:** open `https://<your-app>/?admin=1` once on your own phone or computer to show the **Catalogue** and **Settings** screens (`?admin=0` or the "Admin · exit" button hides them). This is a convenience switch, not security. To restrict it properly, put the site behind Cloudflare Access.

## How recognition works (and why it isn't OCR)

```
photo ──► 1. DETECT: where is every pack?      ──► 2. RECOGNISE: which SKU is each pack?  ──► 3. ADVISE
          SKU-110K YOLO11 detector (ONNX),          DINOv3 embedding of each crop compared      bay category + sales rank →
          on overlapping tiles so small packs       with the library photos (nearest            missing top sellers,
          on dense shelves are not lost             neighbour + colour histogram)              green / red / amber
```

- **OCR** reads text, but energy-drink and soft-drink cans use stylised logos on curved surfaces, and flavours of the same brand share the same words. That's why OCR-based apps are unreliable on shelves like these.
- **A stock YOLO model** (trained on COCO) only knows generic classes such as "bottle" or "cup". It misses most cans and can't tell one SKU from another.
- **The two-stage approach** used here separates the problems. The detector only learns "this is a pack". Identification compares how the pack looks with reference photos. **Adding a new SKU means adding a folder of photos, with no retraining.** Colour is blended into the score because many SKUs, such as flavour variants of the same brand, differ mainly by colour.
- **ONNX is how the models run, not where accuracy comes from.** It lets the same trained model run in the browser, on a server or natively, with GPU acceleration and quantisation. Accuracy comes from the detector's training data and the quality of your catalogue photos.

Low-confidence matches are shown in **amber** rather than guessed. If a missing top seller could be one of the amber boxes, it's listed as **"Check"** instead of "Not on shelf", so reps aren't sent after false alarms. Reps can tap a box to confirm it. The crop is kept on their phone and exported from the admin Catalogue screen as labelled photos.

## Using the app

| Screen | Who | What it does |
|---|---|---|
| **Scan** | Everyone | **Take photo** (camera) or **Upload photo** (gallery/files; drag & drop or paste on desktop). It shows the top-seller check first, then the annotated shelf, then secondary advice. Tap any box to see or confirm what it is |
| **Catalogue** | Admin | Library source URL and sync status, sales ranking (with an on-device override), and an export of in-store corrections |
| **Settings** | Admin | Detector and recognition model, the confident-match rule, and top-seller and delist percentages |

**Photo tips for reps:** one bay per photo, square-on, whole bay in frame, no glare.

## Your catalogue (Cloudflare R2)

Put one folder per product in an R2 bucket. The folder name is the product name the app shows, and it must match the name in the sales CSV.

> **Include every product in the category, not just the top sellers.** If a slow seller isn't in the library, the app may confidently mistake it for its closest look-alike. That could hide a missing top seller. In testing, about a third of out-of-library products were matched to a look-alike, versus none of the in-library ones. Products with photos but no sales row simply show as "Other product".

```
shelfscan-catalogue/
├── Monster Energy Original 500ml/
│   ├── front.jpg
│   ├── shelf-1.jpg
│   └── shelf-2.jpg
├── Monster Ultra White 500ml/
│   └── …
├── Red Bull Sugarfree 250ml/
│   └── …
├── sales.csv                 (optional – picked up automatically)
└── models/
    └── detector.onnx         (optional – picked up automatically)
```

**Photo guidance (this matters most for accuracy):**

- 3–10 images per product. **Crops from real shelf photos work much better than clean pack shots**, because they match how products look in-store (lighting, angle, glare). The app's correction export produces exactly these.
- Include the front face, plus slightly angled views if packs are often turned.
- Keep separate folders for different sizes (250ml and 500ml) and multipacks.

### Sales CSV

```csv
product,units,category,status
Red Bull Energy Drink 250ml,18250,Energy,
Monster Energy Original 500ml,15400,Energy,
Monster Ultra White 500ml,14980,Energy,
Coca-Cola Original Taste 500ml,22100,Cola,
Some Must-Stock Line 500ml,900,Energy,top
```

- `product` must match the folder name. Use `units` (or `sales`/`value`) and/or `rank`.
- `category` (optional, recommended): each bay is judged only against the top sellers of the categories detected on it, so an energy bay never reports Coca-Cola as missing. Percentages apply within each category.
- `status` (optional): `top` / `core` / `delist` overrides the percentages, which is useful for must-stock lines and planned delists.
- Defaults: top 25% of each category are top sellers and the bottom 15% are delist candidates (Settings).

Ranked products with no photos are listed on the admin Catalogue screen. They can't be recognised, so they're never reported as missing.

### Built-in starter library

Until your R2 catalogue is live, the app uses `public/starter/` (48 products, 104 photos, 1.5 MB). It's built with `scripts/starter/build_starter.py`:

- **87 products / 170 photos**, including **25 ranked lines** in four categories (Energy, Sports, Cola, Flavoured), e.g. Red Bull 250ml, Red Bull Sugarfree 250ml, Monster Original/Ultra White/Mango Loco/Pipeline Punch, Lucozade Sport Orange/Raspberry, Coca-Cola 500ml and 330ml, Pepsi Max, Diet Coke, Coke Zero, Fanta, Dr Pepper.
- **62 other products** so they're recognised as themselves instead of being mistaken for a top seller: more Monster, Red Bull Edition, Lucozade (Energy, Zero, Alert), Prime, Boost, Relentless, Carabao, Reign, Rockstar, Emerge and C4 lines, plus own-label cans seen on the sample chiller.
- Pack shots come from [Open Food Facts](https://world.openfoodfacts.org) (CC BY-SA, credits in `public/starter/ATTRIBUTION.md`), hand-checked and auto-cropped, plus crops from a real chiller photo.

**The starter ranking is an estimate, not sales data.** Published UK convenience data is mostly at brand level (e.g. Coca-Cola is the #1 soft drink brand; Red Bull is the top sports & energy brand and holds that sub-category's top three SKUs; energy is convenience's biggest soft-drinks segment). SKU-level rankings (NIQ/Circana) are paywalled, so the order within each category is a judgement call. **Replace `sales.csv` with your EPOS data.** The starter list has no delist candidates, because red boxes need real sales data.

### Deploy the catalogue Worker

The app can't list an R2 bucket directly, so a small Worker (`worker/`) serves `/manifest.json` and the files with CORS:

```bash
cd worker
npm install
# edit wrangler.toml → bucket_name (and optionally PREFIX / ALLOWED_ORIGIN)
npx wrangler deploy
```

Then point the app at the Worker URL. For everyone: set `VITE_CATALOG_URL` in Cloudflare Pages and redeploy. Just for your device: **Admin → Catalogue → Library source → Sync**. Phones re-check the library every 6 hours (and on launch), and only learn new photos. Recognition results are cached on the device.

## Deploy the app from the command line (alternative)

```bash
npm install
npm run build        # outputs dist/
npx wrangler pages deploy dist --project-name shelfscan
```

Set `VITE_CATALOG_URL` in the environment before `npm run build` to bake in your catalogue. `public/_headers` turns on cross-origin isolation, which enables multi-threaded WASM (2–4× faster on phones without WebGPU).

Local development: `npm run dev`, then open the printed URL. `--host` is set, so you can open it from your phone on the same Wi-Fi.

## Models

| Model | Default | Notes |
|---|---|---|
| Detector | **YOLO11s trained on SKU-110K** ([`chistopat/sku110k-yolo11-object-detector`](https://huggingface.co/chistopat/sku110k-yolo11-object-detector), `sku110k-yolo11-s640.onnx`, 38 MB) | Single "object" class, fixed 640×640 input. SKU-110K test set (2,935 images): precision 0.913, recall 0.867, mAP50 0.927, mAP50-95 0.577. A `models/detector.onnx` in your bucket replaces it on sync |
| Recognition | **DINOv3 ViT-S/16** ([`onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX`](https://huggingface.co/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX), 86 MB) + colour histogram | Chosen by benchmark (below). SigLIP2 and CLIP are selectable in admin Settings |

Both are downloaded by the phone on first use and cached for offline use.

### Why this recognition model

Benchmarked on 33 pairs of identical SKUs labelled from a real UK chiller photo, including the hardest cases: Red Bull Editions (same can, different colour), Monster Juiced/Punch flavours, Boost and Lucozade Sport flavours. 19 extra look-alike products were added as distractors. **"Other-photo"** degrades the reference photos (lower resolution, lighting, white balance, blur, JPEG, tilt) to mimic matching against photos from a different store.

| Model (+ colour histogram) | Same-photo top-1 | Other-photo top-1 | Size |
|---|---|---|---|
| **DINOv3-S/16 (chosen)** | **98.5%** | **94.4%** | 86 MB |
| SigLIP2-B/16 | 98.5% | 88.9% | 95 MB |
| CLIP B/32 (previous default) | 97.0% | 83.3% | 89 MB |
| SigLIP2 + DINOv3 ensemble | 100% | 92.9% | 181 MB |

Without the colour histogram, the other-photo scores are DINOv3 85.9%, SigLIP2 81.3%, DINOv2-S 64.1%, CLIP B/16 59.6% and CLIP B/32 64.6%. The confident-match rule (score ≥ 0.68 and a 0.03 lead over the runner-up) accepts about 91% of correct matches, with no confident wrong matches among in-library products. Licence: DINOv3 is under Meta's DINOv3 License. Read it before a commercial launch; SigLIP2 (Apache-2.0) is the fallback.

### Why this detector

Public SKU-110K detectors compared (November 2026):

| Candidate | Arch | SKU-110K test mAP50 / mAP50-95 | Format | Notes |
|---|---|---|---|---|
| **chistopat YOLO11s** (chosen) | YOLO11s | **0.927 / 0.577** | ONNX + .pt | Full test split, ready-made ONNX that the app can load directly |
| chistopat YOLO11n | YOLO11n | 0.906 / 0.550 | ONNX + .pt | 10 MB alternative for older phones |
| samusafe/YOLOv8 "Nano SKU-110K v3.0" | YOLOv8n | 0.900 / 0.555 | .pt | Academic-use only, no licence |
| Htet-ThuAung/sku110k-yolov8-shelf-detector | YOLOv8n | 0.876 / 0.548 | .pt | 20 epochs at batch 2 |

On the sample energy-drink chiller photo, YOLO11s boxed nearly every can and bottle (110 facings) in about 5 s on a laptop CPU without WebGPU. Zooming tiles in further (2 tiles across) made results worse because it broke packs into fragments, so the app keeps the model's native scale. The model card describes the weights as research and development artifacts. Validate them on your own shelves before relying on them, and fine-tune with your photos (below) for production.

### The built-in fallback detector

If the detector URL is cleared, or the model can't be downloaded, the app uses a classical computer-vision fallback. It finds product rows by colour and edge density, then splits each row into packs using the regular spacing of pack edges. It works reasonably on neat, front-facing rows of same-size packs and also flags empty gaps, but it is **not** reliable on mixed pack sizes, angled photos or untidy shelves. It exists so the full flow works on day one.

### Fine-tune the detector on your own shelves

Everything is in `training/`. A free Google Colab T4 GPU is enough.

```bash
cd training
pip install -r requirements.txt
# start from the published SKU-110K YOLO11s weights (skips the multi-hour pre-training)
wget https://huggingface.co/chistopat/sku110k-yolo11-object-detector/resolve/main/weights/sku110k-yolo11-s640.pt
# fine-tune on your own labelled photos (copy my_shelves.example.yaml); keep imgsz 640 or set the app to match
python train_detector.py --data my_shelves.yaml --weights sku110k-yolo11-s640.pt --imgsz 640 --name mine
# (or pre-train from scratch: python train_detector.py --data SKU-110K.yaml --epochs 50 --name sku110k)
# 3. upload runs/detect/mine/weights/best.onnx to the bucket as models/detector.onnx
```

The detector is single-class ("product"), so labelling is quick: draw a box round every facing. Tools such as CVAT, Label Studio or Roboflow export YOLO format directly. Even 50–100 of your own photos on top of SKU-110K makes a noticeable difference.

**Licences:** Ultralytics YOLO11 is **AGPL-3.0**, and the default detector's model card lists its licence as "other", deferring to the SKU-110K dataset terms. Using it in a closed-source commercial product requires an Ultralytics Enterprise licence. The app accepts any YOLO-format ONNX output (`[1, 4+classes, N]` or NMS-free `[1, N, 6]`), so Apache-2.0 detectors such as YOLOX, RT-DETR or D-FINE can be swapped in. Check the SKU-110K dataset terms before commercial use as well.

## Project layout

```
src/
  lib/detect/heuristic.ts   built-in shelf-grid detector
  lib/detect/yolo.ts        ONNX YOLO detector with SAHI-style tiling + NMS
  lib/embed.ts              crop embeddings + colour histograms
  lib/catalog.ts            catalogue sync, embedding cache, matching, corrections
  lib/sales.ts              sales CSV parsing + top-seller classification
  lib/recommend.ts          box status + recommendations
  lib/analyse.ts            pipeline: detect → recognise → classify
  lib/sync.ts               keeps the on-device library in step with the published catalogue
  lib/admin.ts              hidden admin mode (?admin=1)
  components/               React UI
public/starter/             built-in starter library (manifest.json, photos, sales.csv)
scripts/starter/            builds the starter library (Open Food Facts + shelf crops)
worker/                     Cloudflare Worker for the R2 catalogue
training/                   detector training + ONNX export
```

`npm test` runs the unit tests (decoding, tiling, NMS, CSV, recommendations, fallback detector).

## Roadmap ideas

- Read shelf-edge price labels (OCR) as a tie-breaker for look-alike sizes.
- Compare against a target planogram (expected SKU positions), not just top sellers.
- Share of shelf by brand; history of scans per store.
- Optional server inference for larger models when the store has signal.
- Fine-tune the recognition model on your corrected crops for higher accuracy.
