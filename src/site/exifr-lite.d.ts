// exifr ships typings for its package entry only; the "lite" ESM build (JPEG + HEIC,
// TIFF/EXIF/GPS dictionaries) has the same API.
declare module 'exifr/dist/lite.esm.mjs' {
  export { parse, gps, orientation, rotation, thumbnail } from 'exifr';
}
