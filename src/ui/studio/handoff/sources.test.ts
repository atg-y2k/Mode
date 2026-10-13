import { describe, expect, it } from 'vitest';
import { fullSizeImageUrl, transferFiles, transferImageUrl } from './sources';

/** Minimal DataTransfer stand-in (node has none). */
function dt(data: Record<string, string>, files: File[] = [], items: { kind: string; type: string; file?: File }[] = []): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })) as unknown as DataTransferItemList,
    types: Object.keys(data),
    getData: (type: string) => data[type] ?? '',
  } as unknown as DataTransfer;
}

describe('returned-image sources', () => {
  it('prefers files, then file items', () => {
    const png = new File(['x'], 'result.png', { type: 'image/png' });
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });
    expect(transferFiles(dt({}, [png, txt]))).toEqual([png]);
    expect(transferFiles(dt({}, [], [{ kind: 'file', type: 'image/webp', file: png }, { kind: 'string', type: 'text/plain' }]))).toEqual([png]);
    expect(transferFiles(null)).toEqual([]);
  });

  it('finds the URL of an image dragged from another tab', () => {
    expect(transferImageUrl(dt({ 'text/uri-list': '# comment\r\nhttps://files.example/img.png\r\n' }))).toBe('https://files.example/img.png');
    expect(transferImageUrl(dt({ 'text/html': '<p><img alt="x" src="https://lh3.googleusercontent.com/abc=s1024-rj?a=1&amp;b=2"></p>' }))).toBe(
      'https://lh3.googleusercontent.com/abc=s1024-rj?a=1&b=2',
    );
    expect(transferImageUrl(dt({ 'text/plain': 'https://example.com/a.jpg' }))).toBe('https://example.com/a.jpg');
    expect(transferImageUrl(dt({ 'text/plain': 'just text' }))).toBeNull();
    expect(transferImageUrl(dt({ 'text/uri-list': 'javascript:alert(1)' }))).toBeNull();
  });

  it('asks Google image hosts for the full-size original instead of the 1024 px preview', () => {
    expect(fullSizeImageUrl('https://lh3.googleusercontent.com/gg/abc=s1024-rj')).toBe('https://lh3.googleusercontent.com/gg/abc=s0');
    expect(fullSizeImageUrl('https://lh3.googleusercontent.com/gg/abc=w800-h600')).toBe('https://lh3.googleusercontent.com/gg/abc=s0');
    expect(fullSizeImageUrl('https://example.com/abc=s1024-rj')).toBe('https://example.com/abc=s1024-rj');
    expect(fullSizeImageUrl('not a url')).toBe('not a url');
  });
});
