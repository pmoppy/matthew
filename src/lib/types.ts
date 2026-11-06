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
  /** Optional category (e.g. "Energy", "Cola") so a bay is only checked against its own top sellers. */
  category?: string;
  /** Optional explicit role from a "status" column: top (must stock), core or delist. */
  status?: 'top' | 'core' | 'delist';
}

export interface Settings {
  /** Base URL of the catalogue Worker (serves /manifest.json + images from R2). */
  catalogUrl: string;
  /** ONNX product detector (YOLO export). Empty = built-in shelf-grid detector. */
  detectorUrl: string;
  detectorInputSize: number;
  detectorConfidence: number;
  /** Image-embedding model used to recognise SKUs (see EMBEDDERS). */
  embedderId: string;
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
  embedderId: 'dinov3-s',
  // Calibrated for DINOv3-S + colour on real shelf crops: ~91% of correct
  // matches accepted, no confident wrong matches among catalogued products.
  matchThreshold: 0.68,
  marginThreshold: 0.03,
  topSellerPercent: 25,
  delistPercent: 15,
};

export interface EmbedderSpec {
  id: string;
  label: string;
  url: string;
  /** Weights stored outside the .onnx graph (ONNX external data). */
  dataUrl?: string;
  mean: [number, number, number];
  std: [number, number, number];
  sizeMb: number;
  licence: string;
  /** Calibrated defaults for the confident-match rule. */
  matchThreshold: number;
  marginThreshold: number;
}

const HF = 'https://huggingface.co';
const IMAGENET = { mean: [0.485, 0.456, 0.406] as [number, number, number], std: [0.229, 0.224, 0.225] as [number, number, number] };

/**
 * Benchmarked on 33 labelled SKU pairs from a real UK chiller (incl. Red Bull
 * editions, Monster/Boost/Lucozade flavours), matching against references that
 * were degraded to look like photos from a different store:
 *   DINOv3-S + colour 94.4% · CLIP B/32 + colour 83.3% · SigLIP2 + colour 88.9%
 */
export const EMBEDDERS: EmbedderSpec[] = [
  {
    id: 'dinov3-s',
    label: 'DINOv3 small (recommended)',
    url: `${HF}/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/resolve/main/onnx/model.onnx`,
    dataUrl: `${HF}/onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX/resolve/main/onnx/model.onnx_data`,
    ...IMAGENET,
    sizeMb: 86,
    licence: 'DINOv3 License (Meta)',
    matchThreshold: 0.68,
    marginThreshold: 0.03,
  },
  {
    id: 'siglip2-b',
    label: 'SigLIP2 base (Apache-2.0)',
    url: `${HF}/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/onnx/vision_model_quantized.onnx`,
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    sizeMb: 95,
    licence: 'Apache-2.0',
    matchThreshold: 0.8,
    marginThreshold: 0.02,
  },
  {
    id: 'clip-b32',
    label: 'CLIP ViT-B/32 (previous default)',
    url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx`,
    mean: [0.48145466, 0.4578275, 0.40821073],
    std: [0.26862954, 0.26130258, 0.27577711],
    sizeMb: 89,
    licence: 'MIT',
    matchThreshold: 0.8,
    marginThreshold: 0.015,
  },
];

export function getEmbedder(id: string): EmbedderSpec {
  return EMBEDDERS.find((e) => e.id === id) ?? EMBEDDERS[0];
}
