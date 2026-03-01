import { readFile, writeFile, mkdir, access, constants } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
