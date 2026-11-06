/** Raw RGBA pixels, compatible with the browser's ImageData. */
export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A detected box in source-image pixel coordinates. */
export interface Det {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
  /** 'gap' = empty shelf space (possible out-of-stock). */
  kind: 'product' | 'gap';
}

export type Status = 'top' | 'delist' | 'core' | 'nodata' | 'unsure' | 'unknown' | 'gap';

export interface Facing extends Det {
  id: number;
  /** Best matching catalogue product, if any. */
  product: string | null;
  confidence: number;
  /** Runner-up product + score, used to show alternatives when correcting. */
  candidates: { product: string; score: number }[];
  status: Status;
  /** True once a person has confirmed or corrected the label. */
  corrected?: boolean;
}

export interface SalesRow {
  product: string;
  units: number;
  rank: number;
}

export interface Settings {
  /** Base URL of the catalogue Worker (serves /manifest.json + images from R2). */
  catalogUrl: string;
  /** ONNX product detector (YOLO export). Empty = built-in shelf-grid detector. */
  detectorUrl: string;
  detectorInputSize: number;
  detectorConfidence: number;
  /** Image-embedding ONNX model used to recognise SKUs. */
  embedderUrl: string;
  /** Minimum similarity for a confident SKU match (0–1). */
  matchThreshold: number;
  /** Required lead over the next-best product. */
  marginThreshold: number;
  /** Top X% of products by sales count as top sellers. */
  topSellerPercent: number;
  /** Bottom X% of products by sales are delist candidates. */
  delistPercent: number;
}

export const DEFAULT_DETECTOR_URL =
  'https://huggingface.co/chistopat/sku110k-yolo11-object-detector/resolve/main/weights/sku110k-yolo11-s640.onnx';

export const DEFAULT_SETTINGS: Settings = {
  catalogUrl: '',
  // YOLO11s trained on SKU-110K (single "product" class, fixed 640x640 input),
  // test mAP50 0.927 / mAP50-95 0.577. Downloaded once (~38 MB) and cached.
  detectorUrl: DEFAULT_DETECTOR_URL,
  detectorInputSize: 640,
  detectorConfidence: 0.35,
  embedderUrl:
    'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx',
  matchThreshold: 0.8,
  marginThreshold: 0.015,
  topSellerPercent: 20,
  delistPercent: 15,
};
