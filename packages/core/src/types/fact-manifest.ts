// ---------------------------------------------------------------------------
// Fact Manifest — bridge between data generation and test generation
// ---------------------------------------------------------------------------

export type FactType =
  | 'anomaly'
  | 'overdue'
  | 'pending'
  | 'integrity'
  | 'growth'
  | 'risk'
  | 'dispute'
  | 'churn'
  | 'fraud'
  | 'compliance'
  | 'refund'
  | 'upgrade'
  | 'downgrade'
  | 'payment'
  | 'cancellation';

export type FactSeverity = 'info' | 'warn' | 'critical';

export interface Fact {
  id: string;
  type: FactType;
  platform: string;
  severity: FactSeverity;
  detail: string;
  data: Record<string, unknown>;
}

export interface FactManifest {
  persona: string;
  domain: string;
  generated: string;
  seed: number;
  facts: Fact[];
}

// ---------------------------------------------------------------------------
// Mimic Scenario — internal representation, exported to platform formats
// ---------------------------------------------------------------------------

export type ScenarioTier = 'smoke' | 'functional' | 'adversarial';

export interface MimicScenario {
  name: string;
  tier: ScenarioTier;
  source_fact: string;
  goal: string;
  input: string;
  expect: {
    response_contains: string[];
    response_excludes: string[];
    numeric_range?: { field: string; min: number; max: number };
    max_latency_ms: number;
  };
  metadata: {
    persona: string;
    platform: string;
    severity: string;
    generated: string;
  };
}
