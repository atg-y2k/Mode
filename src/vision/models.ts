/**
 * The on-device models, their licenses and download sizes per backend.
 * Sizes are the exact ONNX (+ tokenizer) bytes of the Hugging Face repos at
 * the time of writing; config / preprocessor files add a few KB.
 */

export type ModelKey = 'edgetam' | 'segformer' | 'clipseg';
export type Backend = 'webgpu' | 'wasm';
export type ModelDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export interface ModelInfo {
  key: ModelKey;
  id: string;
  name: string;
  /** What Mode uses it for (UI copy). */
  purpose: string;
  license: string;
  licenseUrl: string;
  /** True when the weights' license restricts commercial use. */
  nonCommercial: boolean;
  /** dtype per backend (WebGPU with / without shader-f16, WASM). */
  dtype: { webgpuF16: ModelDtype; webgpu: ModelDtype; wasm: ModelDtype };
  /** Download size in bytes per dtype. */
  bytes: Partial<Record<ModelDtype, number>>;
}

export const MODELS: Record<ModelKey, ModelInfo> = {
  edgetam: {
    key: 'edgetam',
    id: 'onnx-community/EdgeTAM-ONNX',
    name: 'EdgeTAM',
    purpose: 'exact outlines from clicks and boxes',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/onnx-community/EdgeTAM-ONNX',
    nonCommercial: false,
    dtype: { webgpuF16: 'fp16', webgpu: 'fp32', wasm: 'fp32' },
    bytes: {
      fp32: 192_225 + 19_532_576 + 213_114 + 20_958_208,
      fp16: 167_617 + 9_739_536 + 229_799 + 10_454_016,
      q8: 347_220 + 4_914_560 + 290_415 + 8_662_016,
    },
  },
  segformer: {
    key: 'segformer',
    id: 'Xenova/segformer-b2-finetuned-ade-512-512',
    name: 'SegFormer-B2 (ADE20K)',
    purpose: 'checks what each area is (lawn, wall, sky…)',
    license: 'NVIDIA Source Code License for SegFormer (non-commercial)',
    licenseUrl: 'https://github.com/NVlabs/SegFormer/blob/master/LICENSE',
    nonCommercial: true,
    dtype: { webgpuF16: 'fp16', webgpu: 'fp32', wasm: 'q8' },
    bytes: { fp32: 110_445_327, fp16: 55_721_117, q8: 28_939_869 },
  },
  clipseg: {
    key: 'clipseg',
    id: 'Xenova/clipseg-rd64-refined',
    name: 'CLIPSeg',
    purpose: 'finds roofs, driveways, patios and mulched beds',
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/CIDAS/clipseg-rd64-refined',
    nonCommercial: false,
    dtype: { webgpuF16: 'q4f16', webgpu: 'q4', wasm: 'q8' },
    bytes: { q4f16: 115_520_184 + 3_612_000, q4: 174_887_416 + 3_612_000, q8: 139_115_836 + 3_612_000 },
  },
};

export function dtypeFor(key: ModelKey, backend: Backend, f16: boolean): ModelDtype {
  const d = MODELS[key].dtype;
  return backend === 'wasm' ? d.wasm : f16 ? d.webgpuF16 : d.webgpu;
}

export function modelBytes(key: ModelKey, backend: Backend, f16: boolean): number {
  return MODELS[key].bytes[dtypeFor(key, backend, f16)] ?? 0;
}

/** "44 MB" style size (decimal megabytes, rounded). */
export function formatMB(bytes: number): string {
  const mb = bytes / 1e6;
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Models each task needs. */
export const TASK_MODELS = {
  refine: ['edgetam', 'segformer'],
  select: ['edgetam'],
  mapExterior: ['segformer', 'clipseg', 'edgetam'],
  mapInterior: ['segformer', 'edgetam'],
} as const satisfies Record<string, readonly ModelKey[]>;
export type VisionTask = keyof typeof TASK_MODELS;
