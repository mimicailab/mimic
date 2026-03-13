/**
 * Adapter metadata loaded from adapter.json at the package root.
 * Edit adapter.json to change the adapter's id, name, versions, MCP config, etc.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

export interface AdapterMeta {
  id: string;
  name: string;
  description: string;
  type: string;
  basePath: string;
  versions: string[];
  logoFile: string;
  documentationUrl: string;
  specUrl: string;
  specFile: string;
  mcp: {
    serverName: string;
    serverVersion: string;
    description: string;
  };
}

// Works in both src/ (dev) and dist/ (bundled): ../adapter.json resolves to the package root
const _dir = dirname(fileURLToPath(import.meta.url));
const meta: AdapterMeta = JSON.parse(readFileSync(resolve(_dir, '../adapter.json'), 'utf-8'));

export default meta;
