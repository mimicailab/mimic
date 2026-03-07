import type { Blueprint } from './blueprint.js';
import type { Fact } from './fact-manifest.js';

/** The expanded dataset — ready to seed/serve */
export interface ExpandedData {
  personaId: string;
  blueprint: Blueprint;
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
