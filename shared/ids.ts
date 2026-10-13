/**
 * Short random ids. Uses crypto.getRandomValues (available in browsers on plain
 * http LAN origins too, unlike crypto.randomUUID) and in Node.
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}
