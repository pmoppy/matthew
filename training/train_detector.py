"""
Train the ShelfScan product detector and export it to ONNX for the app.

The detector has ONE class, "product": its only job is to draw a tight box
around every pack on the shelf. Working out *which* SKU each box is happens
in the app by comparing the crop with your catalogue photos, so you never
retrain when products change.

Typical use (Google Colab with a free T4 GPU works well):

    pip install -r requirements.txt

    # 1) Pre-train on SKU-110K (11k dense retail-shelf photos, ~1.7M boxes).
    #    Ultralytics downloads the dataset automatically (~13 GB).
    python train_detector.py --data SKU-110K.yaml --epochs 50 --name sku110k

    # 2) Fine-tune on your own labelled shelf photos (YOLO format, class 0 = product).
    python train_detector.py --data my_shelves.yaml --weights runs/detect/sku110k/weights/best.pt \
        --epochs 60 --name mine

    # 3) Upload the exported runs/detect/mine/weights/best.onnx to your bucket as
    #    models/detector.onnx – the app picks it up on the next catalogue sync.

Licences: Ultralytics YOLO is AGPL-3.0 (commercial closed-source use needs an
Ultralytics Enterprise licence). Check the SKU-110K dataset terms before
commercial use too. See README for Apache-licensed alternatives.
"""

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="SKU-110K.yaml", help="dataset yaml (SKU-110K.yaml or your own)")
    ap.add_argument("--weights", default="yolo11s.pt", help="starting weights (yolo11n/s/m.pt or a previous best.pt)")
    ap.add_argument("--imgsz", type=int, default=1024, help="training/inference size; shelves need >= 1024")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--name", default="shelfscan")
    ap.add_argument("--export-only", action="store_true", help="skip training, just export --weights")
    args = ap.parse_args()

    model = YOLO(args.weights)
    if not args.export_only:
        model.train(
            data=args.data,
            imgsz=args.imgsz,
            epochs=args.epochs,
            batch=args.batch,
            name=args.name,
            single_cls=True,  # everything is "product"
            max_det=1000,  # dense shelves have hundreds of packs
            # Shelf photos are taken upright; avoid augmentations that don't occur in-store.
            fliplr=0.5,
            flipud=0.0,
            degrees=3.0,
            perspective=0.0005,
            mosaic=1.0,
            close_mosaic=10,
            patience=20,
        )
        best = Path(model.trainer.best)
        model = YOLO(best)

    # Fixed-size, single-image export for onnxruntime-web. The app tiles large
    # photos into imgsz x imgsz squares, so set "Detector input size" in the app
    # to the same value.
    out = model.export(format="onnx", imgsz=args.imgsz, opset=17, simplify=True, dynamic=False, nms=False)
    print(f"\nExported: {out}\nUpload it to your bucket as models/detector.onnx")
    print(f"In the app, set Settings → Detector input size = {args.imgsz}")


if __name__ == "__main__":
    main()
