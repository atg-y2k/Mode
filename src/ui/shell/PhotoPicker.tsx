/** The shared hidden photo input behind pickPhotos(spaceId). Mounted once by the workspace. */
import { useStore } from '../../state/store';
import { importPhotosToSpace, registerPhotoPicker, takePickerTarget } from './photoImport';

export function PhotoPicker() {
  return (
    <input
      ref={registerPhotoPicker}
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      className="hidden"
      aria-hidden
      tabIndex={-1}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        const spaceId = takePickerTarget() ?? useStore.getState().selection.spaceId;
        if (spaceId && files.length) void importPhotosToSpace(spaceId, files);
      }}
    />
  );
}
