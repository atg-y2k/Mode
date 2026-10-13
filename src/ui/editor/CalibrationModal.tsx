/**
 * Asks for the real length of the line drawn with the calibrate tool and
 * stores the photo calibration (px ↔ feet) used for sizes and areas.
 */
import { useEffect, useState } from 'react';
import type { Photo } from '../../../shared/types';
import { pxPerFoot } from '../../assetList/area';
import { useStore } from '../../state/store';
import { Button, Field, Modal, NumberInput, Segmented } from '../common';
import { dist, formatFeet, LENGTH_UNITS, toFeet, type LengthUnit } from './geometry';
import type { CalibrationDraft } from './StageController';

const PRESETS: { label: string; value: number; unit: LengthUnit }[] = [
  { label: 'Interior door · 6′ 8″', value: 80, unit: 'in' },
  { label: 'Garage door · 7′', value: 7, unit: 'ft' },
  { label: 'Ceiling · 8′', value: 8, unit: 'ft' },
  { label: 'Countertop height · 36″', value: 36, unit: 'in' },
  { label: 'Fence panel · 8′', value: 8, unit: 'ft' },
  { label: 'Brick + mortar · 8″', value: 8, unit: 'in' },
];

export function CalibrationModal({
  photo,
  draft,
  onClose,
}: {
  photo: Photo;
  draft: CalibrationDraft | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState<number | undefined>(undefined);
  const [unit, setUnit] = useState<LengthUnit>('ft');

  useEffect(() => {
    if (draft) setValue(undefined);
  }, [draft]);

  const px = draft ? dist(draft.a, draft.b) : 0;
  const current = pxPerFoot(photo.calibration);
  const valid = value !== undefined && Number.isFinite(value) && value > 0;
  const feet = valid ? toFeet(value, unit) : 0;

  const save = () => {
    if (!draft || !valid) return;
    const s = useStore.getState();
    s.setCalibration(photo.id, { a: draft.a, b: draft.b, lengthFt: feet });
    const ppf = px / feet;
    s.notify(`Photo calibrated — 1 ft ≈ ${Math.round(ppf)} px. Sizes and areas now use real measurements.`, 'success');
    onClose();
  };

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title="How long is that line?"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} onClick={save}>
            Set scale
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="text-sm text-muted">
          You drew a line {Math.round(px)} px long. Enter its real-world length so plants, fixtures and surface areas are sized
          correctly. Measuring something long and flat-on to the camera gives the best accuracy.
        </p>
        <div className="flex items-end gap-2">
          <Field label="Real length" className="flex-1">
            <NumberInput value={value} onValueChange={setValue} min={0} step="any" placeholder="e.g. 6.67" />
          </Field>
          <Segmented<LengthUnit>
            value={unit}
            onChange={setUnit}
            options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))}
            className="mb-0.5"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Common references</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setValue(p.value);
                  setUnit(p.unit);
                }}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-text transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {valid && (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
            {formatFeet(feet)} → 1 ft ≈ <span className="font-semibold text-text">{Math.round(px / feet)} px</span>
            {current ? <> (currently {Math.round(current)} px)</> : null}
          </p>
        )}
        {!valid && current ? (
          <p className="text-xs text-subtle">This replaces the current scale of about {Math.round(current)} px per foot.</p>
        ) : null}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
