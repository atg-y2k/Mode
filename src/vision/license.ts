/**
 * Opt-in for the SegFormer-B2 weights (NVIDIA Source Code License for
 * SegFormer, §3.3: "may be used… non-commercially… for research or
 * evaluation purposes only"). Personal use of a home-design app is a grey
 * area, so Mode shows the licence summary before SegFormer is first used and
 * only downloads / runs it after an explicit "Use it". Declining keeps every
 * feature working with the Apache-2.0 models:
 * - sharpening (EdgeTAM) validates masks by outline overlap only;
 * - the offline scene map uses CLIPSeg prompts only.
 * The choice is remembered on this device (localStorage) and can be changed
 * under "Models & licenses".
 */
import { MODELS } from './models';

export type SegformerChoice = 'accepted' | 'declined';

export const SEGFORMER_CHOICE_KEY = 'mode.vision.segformer';

/** The licence in plain words (shown before the first download). */
export const SEGFORMER_LICENSE = {
  name: 'NVIDIA Source Code License for SegFormer',
  url: MODELS.segformer.licenseUrl,
  summary: 'Non-commercial, research or evaluation use only.',
  detail:
    'NVIDIA allows these weights to be used “non-commercially… for research or evaluation purposes only” (§3.3). Redesigning your own home is not commercial work, but personal use isn’t named — so it’s your call. Don’t use it for paid or client work.',
  without: 'Without it, outlines are still sharpened (checked against the AI’s outline only) and the offline map uses CLIPSeg (Apache-2.0).',
} as const;

const listeners = new Set<() => void>();
let memory: SegformerChoice | null = null;

function read(): SegformerChoice | null {
  try {
    const v = globalThis.localStorage?.getItem(SEGFORMER_CHOICE_KEY);
    if (v === 'accepted' || v === 'declined') return v;
  } catch {
    // storage blocked: fall back to this session's answer
  }
  return memory;
}

/** The remembered choice, or null when the user hasn't decided yet. */
export function segformerChoice(): SegformerChoice | null {
  return read();
}

/** True when SegFormer may be downloaded and run. */
export function segformerAllowed(): boolean {
  return read() === 'accepted';
}

/** Remembers (or with null, forgets) the choice and notifies listeners. */
export function setSegformerChoice(choice: SegformerChoice | null): void {
  memory = choice;
  try {
    if (choice) globalThis.localStorage?.setItem(SEGFORMER_CHOICE_KEY, choice);
    else globalThis.localStorage?.removeItem(SEGFORMER_CHOICE_KEY);
  } catch {
    // keep the in-memory answer
  }
  for (const l of [...listeners]) l();
}

export function onSegformerChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
