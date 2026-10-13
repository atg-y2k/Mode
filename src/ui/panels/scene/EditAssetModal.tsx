/** Edit the details of one of the user's own (uploaded / AI) library items. */
import { useState } from 'react';
import type { AssetDef } from '../../../../shared/types';
import { useStore } from '../../../state/store';
import { Button, Modal } from '../../common';
import { AssetDetailsForm } from './AssetDetailsForm';
import { AssetThumb } from './AssetThumb';
import { detailsFromAsset, detailsToFields, hasErrors, validateDetails, type AssetDetails } from './assetForm';
import { Callout } from './controls';
import { useMountedRef, useStableCallback } from './hooks';

export function EditAssetModal({ asset, onClose }: { asset: AssetDef | null; onClose: () => void }) {
  if (!asset) return null;
  return <EditBody key={asset.id} asset={asset} onClose={onClose} />;
}

function EditBody({ asset, onClose }: { asset: AssetDef; onClose: () => void }) {
  const mounted = useMountedRef();
  const [details, setDetails] = useState<AssetDetails>(() => detailsFromAsset(asset));
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = showErrors ? validateDetails(details) : {};

  const safeClose = useStableCallback(() => {
    if (!saving) onClose();
  });

  const save = async () => {
    setShowErrors(true);
    if (saving || hasErrors(validateDetails(details))) return;
    setSaving(true);
    setError(null);
    try {
      await useStore.getState().updateLibraryAsset(asset.id, detailsToFields(details, asset));
      if (!mounted.current) return;
      useStore.getState().notify(`Saved “${details.name.trim()}”`, 'success');
      onClose();
    } catch (err) {
      if (!mounted.current) return;
      setError(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={safeClose}
      title={`Edit “${asset.name}”`}
      size="md"
      footer={
        <>
          <Button onClick={safeClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <AssetThumb asset={asset} className="size-20 shrink-0 border border-line" />
          <p className="text-xs text-muted">
            The name and price update everywhere. Height and light settings apply to new placements — ones already on your photos keep
            their size and color.
          </p>
        </div>
        {error && <Callout tone="warning">{error}</Callout>}
        <AssetDetailsForm value={details} onChange={setDetails} errors={errors} disabled={saving} />
      </div>
    </Modal>
  );
}
