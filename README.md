# ShelfScan

An installable web app for retailers and sales reps. Take a photo of a shelf, and the app:

1. **finds every product facing** on the shelf,
2. **identifies each SKU** by comparing it with your catalogue photos,
3. draws **green boxes on top sellers**, **red boxes on delist candidates** and **amber boxes where it isn't sure**,
4. lists **missing top sellers**, **slow sellers to remove**, **facing changes** and **empty spaces**.

It runs entirely on the phone (ONNX Runtime Web, WebGPU with WASM fallback). Once loaded, it works offline in-store, and photos never leave the device. There are no accounts.

## How recognition works (and why it isn't OCR)

```
photo ──► 1. DETECT: where is every pack?      ──► 2. RECOGNISE: which SKU is each pack?  ──► 3. ADVISE
          YOLO product detector (ONNX), run         image embedding of each crop compared       sales rank →
          on overlapping tiles so small packs       with your catalogue photos (nearest         green / red / amber,
          on dense shelves are not lost             neighbour + colour histogram)              missing top sellers
```

- **OCR** reads text, but energy-drink and soft-drink cans use stylised logos on curved surfaces, and flavours of the same brand share the same words. That's why OCR-based apps are unreliable on shelves like these.
- **A stock YOLO model** (trained on COCO) only knows generic classes such as "bottle" or "cup". It misses most cans and can't tell one SKU from another.
- **The two-stage approach** used here separates the problems. The detector only learns "this is a pack". Identification compares how the pack looks with reference photos. **Adding a new SKU means adding a folder of photos, with no retraining.** Colour is blended into the score because many SKUs, such as flavour variants of the same brand, differ mainly by colour.
- **ONNX is how the models run, not where accuracy comes from.** It lets the same trained model run in the browser, on a server or natively, with GPU acceleration and quantisation. Accuracy comes from the detector's training data and the quality of your catalogue photos.

Low-confidence matches are shown in **amber** rather than guessed. When a rep taps a box and confirms or corrects it, that crop is saved and **immediately added to the catalogue**, so the app recognises that product better on the next scan. Corrections can be exported as a ZIP in the same folder layout as the bucket.

## Using the app

| Tab | What it does |
|---|---|
| **Scan** | Take or choose a photo. A quality check catches blur, darkness and low resolution. You then see boxes, a legend (tap to hide categories), summary stats, recommendations and a product table. Tap any box to confirm or correct it. |
| **Catalogue** | Sync product photos from your Cloudflare Worker URL, or pick a local folder. Upload the sales CSV. Export corrections. |
| **Settings** | Model URLs, detector input size and confidence, match thresholds, and top-seller and delist percentages. |

**Photo tips for reps:** shoot one bay at a time, square-on, with the whole bay in frame. Avoid glare from lights and fridge doors, and use the camera rather than screenshots.

### Install on a phone

Open the deployed URL, then:

- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*

## Your catalogue (Cloudflare R2)

Put one folder per product in an R2 bucket. The folder name is the product name the app shows, and it must match the name in the sales CSV.

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
product,units
Monster Energy Original 500ml,18250
Red Bull Sugarfree 250ml,15400
Monster Ultra White 500ml,14980
```

Header names are flexible (`product`/`name`/`sku`, `units`/`sales`/`value`, or a `rank` column). By default, the top 20% of products are top sellers and the bottom 15% are delist candidates. Both can be changed in Settings. Products in the CSV with no catalogue folder are listed on the Catalogue tab. They can't be recognised, so they're never reported as "missing".

### Deploy the catalogue Worker

The app can't list an R2 bucket directly, so a small Worker (`worker/`) serves `/manifest.json` and the files with CORS:

```bash
cd worker
npm install
# edit wrangler.toml → bucket_name (and optionally PREFIX / ALLOWED_ORIGIN)
npx wrangler deploy
```

Paste the Worker URL into **Catalogue → From your image bucket** and tap **Sync**. The first sync downloads the recognition model (~90 MB) and processes every image. Results are cached on the device, so later syncs only process new images.

## Deploy the app (Cloudflare Pages)

```bash
npm install
npm run build        # outputs dist/
npx wrangler pages deploy dist --project-name shelfscan
```

Or connect the GitHub repo in the Cloudflare Pages dashboard with build command `npm run build` and output directory `dist`. `public/_headers` turns on cross-origin isolation, which enables multi-threaded WASM (2–4× faster on phones without WebGPU).

Local development: `npm run dev`, then open the printed URL. `--host` is set, so you can open it from your phone on the same Wi-Fi.

## Models

| Model | Default | Notes |
|---|---|---|
| Detector | *none*: built-in shelf-grid fallback | Train your own (below) and upload it as `models/detector.onnx` |
| Recognition | CLIP ViT-B/32 vision encoder (quantised, Hugging Face) | Any ONNX image encoder works: `[batch,3,224,224]` in, `[batch,dim]` or `[batch,tokens,dim]` out. DINOv2-small is a good alternative for fine-grained packs |

### The built-in fallback detector

Until a trained detector is configured, the app uses a classical computer-vision fallback. It finds product rows by colour and edge density, then splits each row into packs using the regular spacing of pack edges. It works reasonably on neat, front-facing rows of same-size packs and also flags empty gaps, but it is **not** reliable on mixed pack sizes, angled photos or untidy shelves. It exists so the full flow works on day one.

### Train the real detector (recommended next step)

Everything is in `training/`. A free Google Colab T4 GPU is enough.

```bash
cd training
pip install -r requirements.txt
# 1. pre-train on SKU-110K (11k dense retail-shelf photos, auto-downloaded)
python train_detector.py --data SKU-110K.yaml --epochs 50 --name sku110k
# 2. fine-tune on your own labelled photos (copy my_shelves.example.yaml)
python train_detector.py --data my_shelves.yaml --weights runs/detect/sku110k/weights/best.pt --name mine
# 3. upload runs/detect/mine/weights/best.onnx to the bucket as models/detector.onnx
```

The detector is single-class ("product"), so labelling is quick: draw a box round every facing. Tools such as CVAT, Label Studio or Roboflow export YOLO format directly. Even 50–100 of your own photos on top of SKU-110K makes a noticeable difference.

**Licences:** Ultralytics YOLO11 is **AGPL-3.0**. Using it in a closed-source commercial product requires an Ultralytics Enterprise licence. The app accepts any YOLO-format ONNX output (`[1, 4+classes, N]` or NMS-free `[1, N, 6]`), so Apache-2.0 detectors such as YOLOX, RT-DETR or D-FINE can be swapped in. Check the SKU-110K dataset terms before commercial use as well.

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
  components/               React UI
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
