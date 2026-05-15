import type { Fact } from './fact-manifest.js';
import type { PersonaProfile } from '../contract/persona-contract.js';

/**
 * Expanded dataset emitted by the V5 pipeline and read by the seed / host /
 * test commands. Mirrors the world-state projection's `MaterialisedDataset`
 * plus a thin persona carrier (`personaId` + `persona`) and the empty-slot
 * fields (`documents`, `files`, `events`, `facts`) the older downstream
 * features still expect to exist on disk.
 *
 * V4.5 note: the previous `blueprint: Blueprint` field was deleted in the
 * V5 cleanup. Downstream code that needs the persona profile reads
 * `expanded.persona` directly.
 */
export interface ExpandedData {
  personaId: string;
  persona: PersonaProfile;
  tables: Record<string, Row[]>;
  documents: Record<string, DocumentRecord[]>;
  apiResponses: Record<string, ApiResponseSet>;
  files: GeneratedFile[];
  events: EventRecord[];
  facts: Fact[];
}

export type Row = Record<string, unknown>;

export interface DocumentRecord {
  _id?: string;
  [field: string]: unknown;
}

export interface ApiResponseSet {
  adapterId: string;
  responses: Record<string, ApiResponse[]>;
}

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  personaId: string;
  stateKey?: string;
}

export interface GeneratedFile {
  path: string;
  type: 'pdf' | 'csv' | 'xlsx' | 'json' | 'txt';
  content: Buffer | string;
  metadata: Record<string, unknown>;
}

export interface EventRecord {
  topic: string;
  key?: string;
  value: unknown;
  timestamp: Date;
  headers?: Record<string, string>;
}
