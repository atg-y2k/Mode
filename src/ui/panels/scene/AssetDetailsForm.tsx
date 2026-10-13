/**
 * Name / category / height / price / link / notes (+ light color for
 * fixtures) — shared by the Add, Generate and Edit asset modals.
 */
import { ASSET_CATEGORIES, type AssetCategory, type LightBeam } from '../../../../shared/types';
import { cn, Field, NumberInput, Select, TextArea, TextInput } from '../../common';
import { DEFAULT_HEIGHT_FT, MAX_NAME_LENGTH, type AssetDetails, type DetailErrors } from './assetForm';
import { ASSET_CATEGORY_LABELS, BEAM_HINTS, BEAM_LABELS, KELVIN_PRESETS, lampColorName } from './format';
import { kelvinCss } from './lights';

const FORM_BEAMS: LightBeam[] = ['omni', 'down', 'up', 'spot'];

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <span role="alert" className="text-xs text-danger">
      {children}
    </span>
  );
}

export function AssetDetailsForm({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: AssetDetails;
  onChange: (next: AssetDetails) => void;
  /** Shown only after the first save attempt. */
  errors: DetailErrors;
  disabled?: boolean;
}) {
  const set = <K extends keyof AssetDetails>(k: K, v: AssetDetails[K]) => onChange({ ...value, [k]: v });

  const changeCategory = (category: AssetCategory) => {
    // Keep a height the user typed; otherwise follow the new category's typical height.
    const typical = DEFAULT_HEIGHT_FT[value.category];
    const realHeightFt = value.realHeightFt === undefined || value.realHeightFt === typical ? DEFAULT_HEIGHT_FT[category] : value.realHeightFt;
    onChange({ ...value, category, realHeightFt });
  };

  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <TextInput
          value={value.name}
          maxLength={MAX_NAME_LENGTH}
          placeholder="e.g. Blue glazed planter"
          disabled={disabled}
          aria-invalid={!!errors.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <Select value={value.category} disabled={disabled} onChange={(e) => changeCategory(e.target.value as AssetCategory)}>
            {ASSET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {ASSET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Real height">
          <NumberInput
            value={value.realHeightFt}
            min={0.1}
            max={150}
            step={0.5}
            suffix="ft"
            disabled={disabled}
            aria-invalid={!!errors.realHeightFt}
            onValueChange={(v) => set('realHeightFt', v)}
          />
        </Field>
      </div>
      {errors.realHeightFt ? (
        <FieldError>{errors.realHeightFt}</FieldError>
      ) : (
        <p className="-mt-1 text-xs text-subtle">Used to size it on photos where you’ve set the scale.</p>
      )}

      {value.category === 'lighting' && (
        <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-3">
          <Field label="Light spread" hint={BEAM_HINTS[value.beam]}>
            <Select value={value.beam} disabled={disabled} onChange={(e) => set('beam', e.target.value as LightBeam)}>
              {FORM_BEAMS.map((b) => (
                <option key={b} value={b}>
                  {BEAM_LABELS[b]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Bulb color · {lampColorName(value.kelvin)}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Bulb color">
              {KELVIN_PRESETS.map((p) => (
                <button
                  key={p.kelvin}
                  type="button"
                  disabled={disabled}
                  aria-pressed={value.kelvin === p.kelvin}
                  onClick={() => set('kelvin', p.kelvin)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors',
                    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                    value.kelvin === p.kelvin ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line bg-surface text-muted hover:text-text',
                  )}
                >
                  <span aria-hidden className="size-3 rounded-full ring-1 ring-black/15" style={{ backgroundColor: kelvinCss(p.kelvin) }} />
                  {p.kelvin} K
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Price from">
          <NumberInput
            value={value.costLow}
            min={0}
            step={1}
            suffix="USD"
            placeholder="Optional"
            disabled={disabled}
            onValueChange={(v) => set('costLow', v)}
          />
        </Field>
        <Field label="Price to">
          <NumberInput
            value={value.costHigh}
            min={0}
            step={1}
            suffix="USD"
            placeholder="Optional"
            disabled={disabled}
            onValueChange={(v) => set('costHigh', v)}
          />
        </Field>
      </div>
      <FieldError>{errors.cost}</FieldError>

      <Field label="Where to buy">
        <TextInput
          type="url"
          inputMode="url"
          value={value.vendorUrl}
          placeholder="https://… (optional)"
          disabled={disabled}
          aria-invalid={!!errors.vendorUrl}
          onChange={(e) => set('vendorUrl', e.target.value)}
        />
        <FieldError>{errors.vendorUrl}</FieldError>
      </Field>

      <Field label="Notes">
        <TextArea
          rows={2}
          className="min-h-16"
          value={value.description}
          maxLength={500}
          placeholder="Optional — size, color, where you saw it…"
          disabled={disabled}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>
    </div>
  );
}
