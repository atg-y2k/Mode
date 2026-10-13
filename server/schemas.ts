/**
 * Server-only structured-output schemas (the public HTTP contract lives in
 * shared/api.ts). Same structured-output rules: every field required,
 * `.nullable()` instead of `.optional()`, ranges described rather than enforced.
 */
import { z } from 'zod';
import { GeneratedAssetMetaSchema } from '../shared/api';

/** generate-asset, mode 'vector': metadata + the drawing. */
export const VectorAssetOutputSchema = GeneratedAssetMetaSchema.extend({
  svg: z
    .string()
    .describe(
      'One standalone <svg> element with xmlns and viewBox; transparent background; base of the object on the bottom edge',
    ),
});
export type VectorAssetOutput = z.infer<typeof VectorAssetOutputSchema>;

/** generate-asset, mode 'photo': metadata + a prompt for the image provider. */
export const PhotoAssetPlanSchema = GeneratedAssetMetaSchema.extend({
  imagePrompt: z.string().describe('Prompt for the image model describing only the object (one paragraph)'),
  orientation: z
    .enum(['portrait', 'square', 'landscape'])
    .describe('Canvas shape that best fits the object: portrait for tall, landscape for wide'),
});
export type PhotoAssetPlan = z.infer<typeof PhotoAssetPlanSchema>;

/** render: Claude writes the edit prompt for the image provider. */
export const RenderPromptSchema = z.object({
  prompt: z.string().describe('The image-edit prompt, 80-200 words of plain sentences'),
});
export type RenderPrompt = z.infer<typeof RenderPromptSchema>;
