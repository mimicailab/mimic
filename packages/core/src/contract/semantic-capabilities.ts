import type {
  Clause,
  DistributionClause,
  SemanticFieldHint,
  SemanticTarget,
  TargetBearingClause,
} from './clause-types.js';
import type { Filter, FilterOp, ResourceTarget } from '../types/claim.js';

export interface ResolvedSemanticTarget {
  target: ResourceTarget;
  explanation: string;
}

const STRIPE_ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];

const BILLING_TIER_FILTER_KEYS = new Set([
  'plan',
  'tier',
  'lookup_key',
  'plan_lookup_key',
  'price_lookup_key',
  'nickname',
  'plan_nickname',
  'price_nickname',
  'items.data.price.lookup_key',
  'items.data.price.nickname',
]);

const BILLING_TIER_FIELD_KEYS = new Set([
  'plan',
  'tier',
  'lookup_key',
  'plan_lookup_key',
  'price_lookup_key',
  'nickname',
  'plan_nickname',
  'price_nickname',
  'items.data.price.lookup_key',
  'items.data.price.nickname',
]);

export function resolveSemanticTarget(target: SemanticTarget): ResolvedSemanticTarget | null {
  const normalised = normaliseSemanticTarget(target);

  switch (normalised.kind) {
    case 'billing_customer_cohort': {
      if (normalised.adapter !== 'stripe') {
        return null;
      }

      const filter: Filter = {
        status: { in: [...STRIPE_ACTIVE_SUBSCRIPTION_STATUSES] },
      };

      const tier = normalised.facets?.tier;
      if (tier) {
        filter['items.data.price.lookup_key'] = { in: buildBillingTierAliases(tier) };
      }

      return {
        target: {
          surface: 'api',
          name: 'stripe.subscription',
          filter,
        },
        explanation:
          tier != null
            ? `Semantic billing customer cohort lowered via Stripe subscriptions filtered to tier=${tier}.`
            : 'Semantic billing customer cohort lowered via Stripe subscriptions.',
      };
    }
  }
}

export function normaliseSemanticTarget(target: SemanticTarget): SemanticTarget {
  if (target.kind !== 'billing_customer_cohort') return target;

  const tier = target.facets?.tier;
  return {
    ...target,
    adapter: target.adapter.trim().toLowerCase(),
    facets:
      tier == null
        ? target.facets
        : {
            ...target.facets,
            tier: canonicaliseBillingTierValue(tier) ?? tier,
          },
  };
}

export function describeSemanticTarget(target: SemanticTarget): string {
  switch (target.kind) {
    case 'billing_customer_cohort': {
      const parts = [`adapter=${target.adapter}`];
      if (target.facets?.billingState) parts.push(`billingState=${target.facets.billingState}`);
      if (target.facets?.tier) parts.push(`tier=${target.facets.tier}`);
      return `billing_customer_cohort(${parts.join(', ')})`;
    }
  }
}

export function canonicaliseSemanticClauses(clauses: Clause[]): number {
  let changed = 0;

  for (const clause of clauses) {
    if (hasSemanticTarget(clause)) {
      const normalised = normaliseSemanticTarget(clause.semanticTarget);
      if (JSON.stringify(normalised) !== JSON.stringify(clause.semanticTarget)) {
        clause.semanticTarget = normalised;
        changed++;
      }
    }

    switch (clause.family) {
      case 'count':
      case 'aggregate': {
        const semanticTarget = liftBillingCustomerTierTarget(clause);
        if (semanticTarget && !hasSemanticTarget(clause)) {
          clause.semanticTarget = semanticTarget;
          changed++;
        }
        break;
      }
      case 'distribution': {
        if (!hasSemanticTarget(clause) && detectsBillingTierField(clause.field)) {
          const semanticTarget = liftBillingCustomerBaseTarget(clause);
          if (semanticTarget) {
            clause.semanticTarget = semanticTarget;
            clause.semanticField = 'tier';
            changed++;
          }
        }
        if (clause.semanticField === 'tier') {
          changed += normaliseDistributionBuckets(clause);
        }
        break;
      }
      default:
        break;
    }
  }

  return changed;
}

export function supportsSemanticDistribution(
  target: SemanticTarget | undefined,
  field: SemanticFieldHint | undefined,
): boolean {
  if (!target || field !== 'tier') return false;
  return resolveSemanticTarget(target) != null;
}

export function extractSemanticFieldValue(
  row: Record<string, unknown>,
  target: SemanticTarget,
  field: SemanticFieldHint,
): string | null {
  if (target.kind === 'billing_customer_cohort' && field === 'tier') {
    const candidates = [
      getNested(row, 'items.data.price.lookup_key'),
      getNested(row, 'items.data.price.nickname'),
      getNested(row, 'plan.lookup_key'),
      getNested(row, 'plan.nickname'),
    ];
    for (const candidate of candidates) {
      const canonical = canonicaliseBillingTierValue(candidate);
      if (canonical) return canonical;
    }
  }
  return null;
}

export function canonicaliseBillingTierValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  raw = raw.replace(/[_\s]+/g, '-');
  raw = raw.replace(
    /(?:-(?:monthly|month|annual|annually|yearly|year|plan|tier|subscription|price))+$/g,
    '',
  );
  raw = raw.replace(/^-+|-+$/g, '');
  return raw || null;
}

export function buildBillingTierAliases(tier: string): string[] {
  const canonical = canonicaliseBillingTierValue(tier) ?? tier.trim().toLowerCase();
  const variants = new Set<string>();
  const stems = [canonical, canonical.replace(/-/g, '_'), canonical.replace(/-/g, ' ')];
  const suffixes = ['', '-monthly', '-annual', '-yearly', '_monthly', '_annual', '_yearly'];

  for (const stem of stems) {
    variants.add(stem);
    for (const suffix of suffixes) {
      variants.add(`${stem}${suffix}`);
    }
  }

  return [...variants];
}

function hasSemanticTarget(clause: Clause): clause is Clause & { semanticTarget: SemanticTarget } {
  return 'semanticTarget' in clause && clause.semanticTarget != null;
}

function liftBillingCustomerTierTarget(clause: TargetBearingClause): SemanticTarget | null {
  const target = clause.target;
  if (!target || target.surface !== 'api') return null;
  const parsed = splitApiTargetName(target.name);
  if (!parsed || parsed.resource !== 'subscription') return null;

  const tier = readBillingTierFromFilter(target.filter);
  if (!tier) return null;

  return {
    kind: 'billing_customer_cohort',
    adapter: parsed.adapter,
    facets: {
      billingState: 'paying',
      tier,
    },
  };
}

function liftBillingCustomerBaseTarget(clause: DistributionClause): SemanticTarget | null {
  const target = clause.target;
  if (!target || target.surface !== 'api') return null;
  const parsed = splitApiTargetName(target.name);
  if (!parsed || parsed.resource !== 'subscription') return null;
  return {
    kind: 'billing_customer_cohort',
    adapter: parsed.adapter,
    facets: {
      billingState: 'paying',
    },
  };
}

function readBillingTierFromFilter(filter: Filter | undefined): string | null {
  if (!filter) return null;

  for (const [key, predicate] of Object.entries(filter)) {
    if (!BILLING_TIER_FILTER_KEYS.has(key)) continue;
    const candidate = extractFilterValue(predicate);
    const canonical = canonicaliseBillingTierValue(candidate);
    if (canonical) return canonical;
  }

  return null;
}

function normaliseDistributionBuckets(clause: DistributionClause): number {
  const next: Record<string, number> = {};
  let changed = 0;
  for (const [key, value] of Object.entries(clause.values)) {
    const canonical = canonicaliseBillingTierValue(key) ?? key;
    if (canonical !== key) changed++;
    next[canonical] = (next[canonical] ?? 0) + value;
  }
  clause.values = next;
  return changed;
}

function detectsBillingTierField(field: string): boolean {
  return BILLING_TIER_FIELD_KEYS.has(field);
}

function splitApiTargetName(name: string): { adapter: string; resource: string } | null {
  const dot = name.indexOf('.');
  if (dot < 0) return null;
  return {
    adapter: name.slice(0, dot).trim().toLowerCase(),
    resource: name.slice(dot + 1).trim().toLowerCase(),
  };
}

function extractFilterValue(predicate: unknown): unknown {
  if (predicate == null || typeof predicate !== 'object' || Array.isArray(predicate)) {
    return predicate;
  }

  const op = predicate as FilterOp;
  if ('eq' in op) return op.eq;
  if ('in' in op) return op.in[0];
  return null;
}

function getNested(value: unknown, path: string): unknown {
  return getNestedParts(value, path.split('.'));
}

function getNestedParts(value: unknown, parts: string[]): unknown {
  if (parts.length === 0) return value;
  const [head, ...rest] = parts;

  if (Array.isArray(value)) {
    const mapped = value
      .map((item) => getNestedParts(item, parts))
      .filter((item) => item !== undefined);
    if (mapped.length === 0) return undefined;
    return mapped.length === 1 ? mapped[0] : mapped;
  }

  if (!value || typeof value !== 'object') return undefined;
  return getNestedParts((value as Record<string, unknown>)[head], rest);
}