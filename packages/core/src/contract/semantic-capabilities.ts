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

const PRODUCT_USER_TABLES = new Set(['users']);

const PRODUCT_USER_FREE_HINT = /\bfree(?:-|\s)tier\b|\bfree users?\b|\bfree plan\b/i;
const PRODUCT_USER_PAYING_HINT =
  /\bpaying (?:customers?|users?)\b|\bpaid (?:customers?|users?)\b|\bpaid plan\b|\bbilling history\b|\bmrr\b|\brevenue\b/i;
const PRODUCT_USER_UNLINKED_HINT =
  /\bno corresponding billing(?: platform)? record\b|\bno billing(?: platform)? record\b|\bmissing billing(?: platform)? record\b|\bwithout (?:a )?billing(?: platform)? record\b/i;

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
    case 'product_user_cohort': {
      const filter: Filter = {};
      const tier = normalised.facets?.tier;
      const billingState = normalised.facets?.billingState;
      if (tier) {
        filter.plan = tier;
      } else if (billingState === 'free') {
        filter.plan = 'free';
      } else if (billingState === 'paying') {
        filter.plan = { neq: 'free' };
      }
      if (normalised.facets?.linkage === 'unlinked') {
        filter.billing_platform = null;
      } else if (normalised.facets?.linkage === 'linked') {
        filter.billing_platform = { is_null: false };
      }
      return {
        target: {
          surface: 'db',
          name: normalised.table,
          ...(Object.keys(filter).length > 0 ? { filter } : {}),
        },
        explanation:
          tier != null
            ? `Semantic product user cohort lowered via db.${normalised.table} filtered to tier=${tier}.`
            : `Semantic product user cohort lowered via db.${normalised.table}.`,
      };
    }
  }
}

export function normaliseSemanticTarget(target: SemanticTarget): SemanticTarget {
  if (target.kind === 'billing_customer_cohort') {
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

  const tier = target.facets?.tier;
  const canonicalTier = tier == null ? undefined : canonicaliseBillingTierValue(tier) ?? tier;
  const billingState = canonicalTier === 'free' ? 'free' : target.facets?.billingState;
  const facets = {
    ...(billingState ? { billingState } : {}),
    ...(canonicalTier != null && canonicalTier !== 'free' ? { tier: canonicalTier } : {}),
    ...(target.facets?.linkage ? { linkage: target.facets.linkage } : {}),
  };
  return {
    ...target,
    table: target.table.trim().toLowerCase(),
    facets: Object.keys(facets).length > 0 ? facets : undefined,
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
    case 'product_user_cohort': {
      const parts = [`table=${target.table}`];
      if (target.facets?.billingState) parts.push(`billingState=${target.facets.billingState}`);
      if (target.facets?.tier) parts.push(`tier=${target.facets.tier}`);
      if (target.facets?.linkage) parts.push(`linkage=${target.facets.linkage}`);
      return `product_user_cohort(${parts.join(', ')})`;
    }
  }
}

export function canonicaliseSemanticClauses(clauses: Clause[]): number {
  let changed = 0;

  for (const clause of clauses) {
    changed += canonicaliseProductUserClause(clause);

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
  if (target.kind === 'product_user_cohort' && field === 'tier') {
    const candidates = [getNested(row, 'plan'), getNested(row, 'tier')];
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

function canonicaliseProductUserClause(clause: Clause): number {
  const target = getPrimaryTarget(clause);
  if (!target || !isProductUserTarget(target)) return 0;

  const semantics = inferProductUserSemantics(clause, target);
  if (!semantics) return 0;

  let changed = normaliseProductUserTarget(target, semantics);
  if (!hasSemanticTarget(clause)) {
    clause.semanticTarget = {
      kind: 'product_user_cohort',
      table: target.name,
      ...(Object.keys(semantics).length > 0 ? { facets: semantics } : {}),
    };
    changed++;
  }
  if (clause.family === 'distribution' && detectsBillingTierField(clause.field) && clause.semanticField !== 'tier') {
    clause.semanticField = 'tier';
    changed++;
  }
  return changed;
}

interface ProductUserSemantics {
  tier?: string;
  billingState?: 'paying' | 'free';
  linkage?: 'linked' | 'unlinked';
}

function inferProductUserSemantics(
  clause: Clause,
  target: ResourceTarget,
): ProductUserSemantics | null {
  const quote = clause.quote.toLowerCase();
  const tier = readProductUserTier(target.filter);
  const linkage = readProductUserLinkage(target.filter)
    ?? (PRODUCT_USER_UNLINKED_HINT.test(quote) ? 'unlinked' : undefined);
  let billingState: ProductUserSemantics['billingState'];

  if (tier === 'free') {
    billingState = 'free';
  } else if (tier) {
    billingState = 'paying';
  } else if (PRODUCT_USER_FREE_HINT.test(quote)) {
    billingState = 'free';
  } else if (linkage === 'unlinked' || PRODUCT_USER_PAYING_HINT.test(quote) || clauseSignalsRevenue(clause)) {
    billingState = 'paying';
  }

  const semantics: ProductUserSemantics = {
    ...(tier && tier !== 'free' ? { tier } : {}),
    ...(billingState ? { billingState } : {}),
    ...(linkage ? { linkage } : {}),
  };
  return Object.keys(semantics).length > 0 ? semantics : null;
}

function clauseSignalsRevenue(clause: Clause): boolean {
  if (clause.family === 'aggregate') {
    return /(mrr|arr|revenue)/i.test(clause.field);
  }
  if (clause.family === 'distribution') {
    return /(mrr|arr|revenue|billing_platform)/i.test(clause.field);
  }
  return false;
}

function normaliseProductUserTarget(
  target: ResourceTarget,
  semantics: ProductUserSemantics,
): number {
  let changed = 0;
  const filter = (target.filter ??= {});
  const planField = pickExistingPlanField(filter);

  if (planField) {
    const current = filter[planField];
    if (typeof current === 'string') {
      const canonical = canonicaliseBillingTierValue(current) ?? current;
      const next = canonical === 'free' ? 'free' : canonical;
      if (next !== current) {
        filter[planField] = next;
        changed++;
      }
    }
  } else if (semantics.tier) {
    filter.plan = semantics.tier;
    changed++;
  } else if (semantics.billingState === 'free') {
    filter.plan = 'free';
    changed++;
  } else if (semantics.billingState === 'paying') {
    filter.plan = { neq: 'free' };
    changed++;
  }

  if (semantics.linkage === 'unlinked') {
    const current = filter.billing_platform;
    const isExplicitNull = current === null;
    const isNullOp =
      current != null
      && typeof current === 'object'
      && !Array.isArray(current)
      && 'is_null' in current
      && (current as { is_null?: boolean }).is_null === true;
    if (!isExplicitNull || isNullOp) {
      filter.billing_platform = null;
      changed++;
    }
  }

  return changed;
}

function readProductUserTier(filter: Filter | undefined): string | undefined {
  if (!filter) return undefined;

  for (const key of ['plan', 'tier']) {
    const candidate = extractFilterValue(filter[key]);
    const canonical = canonicaliseBillingTierValue(candidate);
    if (canonical) return canonical;
  }

  return undefined;
}

function readProductUserLinkage(
  filter: Filter | undefined,
): ProductUserSemantics['linkage'] | undefined {
  if (!filter || !('billing_platform' in filter)) return undefined;
  const predicate = filter.billing_platform;
  if (predicate === null) return 'unlinked';
  if (typeof predicate === 'string' || typeof predicate === 'number') return 'linked';
  if (predicate == null || typeof predicate !== 'object' || Array.isArray(predicate)) return undefined;
  const op = predicate as FilterOp;
  if ('is_null' in op) return op.is_null ? 'unlinked' : 'linked';
  if ('eq' in op) return op.eq == null ? 'unlinked' : 'linked';
  return undefined;
}

function isProductUserTarget(target: ResourceTarget): boolean {
  return target.surface === 'db' && PRODUCT_USER_TABLES.has(target.name.trim().toLowerCase());
}

function pickExistingPlanField(filter: Filter): 'plan' | 'tier' | null {
  if ('plan' in filter) return 'plan';
  if ('tier' in filter) return 'tier';
  return null;
}

function getPrimaryTarget(clause: Clause): ResourceTarget | undefined {
  switch (clause.family) {
    case 'count':
    case 'aggregate':
    case 'distribution':
      return clause.target;
    case 'temporal':
      return clause.kind === 'window' ? clause.target : undefined;
    default:
      return undefined;
  }
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