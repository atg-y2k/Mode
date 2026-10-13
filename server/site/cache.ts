/**
 * Tiny JSON file cache for the site profile (`.cache/site/` by default,
 * gitignored). Writes are atomic (temp file + rename); every disk failure is
 * logged once and otherwise ignored, so a read-only checkout still works with
 * the in-memory cache alone.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Default cache folder: <server working directory>/.cache/site. */
export function defaultSiteCacheDir(cwd: string = process.cwd()): string {
  return resolve(cwd, '.cache', 'site');
}

export class JsonFileCache {
  private warned = false;

  /** `dir` null = disabled (memory only). */
  constructor(
    readonly dir: string | null,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  private file(name: string): string | null {
    if (!this.dir) return null;
    if (!/^[A-Za-z0-9._,-]+$/.test(name) || name.includes('..')) throw new Error(`Invalid cache file name: ${name}`);
    return join(this.dir, name);
  }

  async read<T = unknown>(name: string): Promise<T | null> {
    const file = this.file(name);
    if (!file) return null;
    try {
      return JSON.parse(await readFile(file, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.warn(`couldn't read ${name}`, err);
      return null;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    const file = this.file(name);
    if (!file || !this.dir) return;
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(tmp, JSON.stringify(value));
      await rename(tmp, file);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      this.warn(`couldn't write ${name}`, err);
    }
  }

  private warn(what: string, err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    this.log(`[site] cache ${what} in ${this.dir}: ${err instanceof Error ? err.message : String(err)} (continuing without the disk cache)`);
  }
}
