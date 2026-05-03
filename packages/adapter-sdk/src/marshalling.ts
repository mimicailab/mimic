import type { ApiResponse, ExpandedData, StateStore } from '@mimicai/core';

// ---------------------------------------------------------------------------
// Marshalling — declarative LLM-content → wire-shape transform
//
// Adapters declare what flat content they accept (the LLM's output) and how it
// becomes the platform's wire envelope. The runner handles ID assignment,
// label registration, cross-resource label resolution, polymorphic wrapping,
// and writing to the StateStore.
//
// Two resource shapes:
//   - standalone: own row in store, own ID, optionally registers a label.
//   - embedded:   appended to a parent's array field, no own ID; references
//                 the parent by label.
//
// See marshall.md for the design rationale.
// ---------------------------------------------------------------------------

export type Body = Record<string, unknown>;

/**
 * Context passed to each marshaller's `wrap` / `generateId` / `namespace` fn.
 * One context exists per persona — there is no cross-persona resolution.
 */
export interface MarshalContext {
  /** All flat content responses for this persona (the input). */
  readonly responses: Record<string, ApiResponse[]>;
  /** Resolve a label registered earlier in pass 1 to its assigned id. */
  lookupId(contentResource: string, label: string): string | undefined;
  /** Read previously-stored wrapped entities. */
  readonly store: Pick<StateStore, 'get' | 'list'>;
  /** Persona id — useful when marshalling needs to namespace by persona. */
  readonly personaId: string;
  /**
   * Adapter-scratch slot for derived data computed by `precomputeMarshalContext`.
   * Adapters define their own keys (Gmail uses 'threadMap', HubSpot might use
   * 'pipelineByObjectType', etc.).
   */
  readonly extras: Map<string, unknown>;
}

export interface StandaloneMarshaller {
  kind: 'standalone';
  /** Content key in apiResponses (e.g. 'crm_deal', 'note_content'). */
  contentResource: string;
  /**
   * Storage namespace. String for static; function for per-body
   * (e.g. `attio:records:deals` vs `:people` keyed off body.record_type).
   */
  namespace: string | ((body: Body, ctx: MarshalContext) => string);
  /** Generate an id for this entity. Default: `crypto.randomUUID()`. */
  generateId?: (body: Body, ctx: MarshalContext) => string;
  /** Field on `body` whose value registers a label → id mapping. Optional. */
  labelField?: string;
  /** Wrap flat content into wire envelope. Receives content + assigned id + ctx. */
  wrap: (body: Body, id: string, ctx: MarshalContext) => Body;
  /** Storage key for the wrapped entity. Default: `wrapped.id`. */
  storageKey?: (wrapped: Body) => string;
}

export interface EmbeddedMarshaller {
  kind: 'embedded';
  /** Content key in apiResponses (e.g. 'transcript_entry_content'). */
  contentResource: string;
  /** Parent's contentResource (e.g. 'note_content'). */
  parentResource: string;
  /** Field on this entity's body that names the parent's label. */
  parentLabelField: string;
  /** Field on the wrapped parent where this embedded entity is appended. */
  arrayField: string;
  /** Wrap flat content into wire shape. No id is assigned — children don't own one. */
  wrap: (body: Body, ctx: MarshalContext) => Body;
}

export type Marshaller = StandaloneMarshaller | EmbeddedMarshaller;

export type PrecomputeMarshalContext = (
  responses: Record<string, ApiResponse[]>,
  ctx: MarshalContext,
  store: StateStore,
) => void;

/** Internal: per-persona ctx with the mutating registerLabel exposed. */
interface InternalMarshalContext extends MarshalContext {
  registerLabel(contentResource: string, label: string, id: string): void;
}

function makeContext(
  responses: Record<string, ApiResponse[]>,
  store: StateStore,
  personaId: string,
): InternalMarshalContext {
  const labels = new Map<string, Map<string, string>>();
  return {
    responses,
    store,
    personaId,
    extras: new Map(),
    lookupId(contentResource: string, label: string): string | undefined {
      return labels.get(contentResource)?.get(label);
    },
    registerLabel(contentResource: string, label: string, id: string): void {
      let inner = labels.get(contentResource);
      if (!inner) {
        inner = new Map();
        labels.set(contentResource, inner);
      }
      const existing = inner.get(label);
      if (existing && existing !== id) {
        throw new Error(
          `Label collision in persona '${personaId}': contentResource '${contentResource}' has label '${label}' registered with two ids ('${existing}' and '${id}'). Each label within a contentResource must map to exactly one entity.`,
        );
      }
      inner.set(label, id);
    },
  };
}

function defaultGenerateId(): string {
  return crypto.randomUUID();
}

/**
 * Run all marshallers across every persona's responses.
 *
 * Three passes per persona:
 *   1. Assign ids and register labels for every standalone.
 *   1.5. Run `precompute` (if provided) — adapter-level hook for derived data.
 *   2. Wrap + store all standalones.
 *   3. Wrap embedded children, resolve parent by label, append to parent's array.
 *
 * Throws on label collision (within a persona, within a contentResource).
 * Silently skips orphaned embedded children (parent label not found).
 */
export async function runMarshallers(opts: {
  marshallers: readonly Marshaller[];
  data: Map<string, ExpandedData>;
  store: StateStore;
  adapterId: string;
  precompute?: PrecomputeMarshalContext;
}): Promise<void> {
  assertUniqueContentResources(opts.marshallers);

  for (const [, expanded] of opts.data) {
    const responses = expanded.apiResponses?.[opts.adapterId]?.responses;
    if (!responses) continue;

    const ctx = makeContext(responses, opts.store, expanded.personaId);

    // Pass 1 — assign ids, register labels.
    const assignments: Array<{
      marshaller: StandaloneMarshaller;
      body: Body;
      id: string;
    }> = [];
    for (const m of opts.marshallers) {
      if (m.kind !== 'standalone') continue;
      for (const resp of responses[m.contentResource] ?? []) {
        const body = (resp.body ?? {}) as Body;
        const id = (m.generateId ?? defaultGenerateId)(body, ctx);
        assignments.push({ marshaller: m, body, id });
        if (m.labelField) {
          const label = body[m.labelField];
          if (typeof label === 'string' && label) {
            ctx.registerLabel(m.contentResource, label, id);
          }
        }
      }
    }

    // Pass 1.5 — adapter-level precompute (Gmail thread map, etc.).
    opts.precompute?.(responses, ctx, opts.store);

    // Pass 2 — wrap + store standalones. Track each entity's location so
    // pass 3 can find its parent without re-deriving the namespace from a
    // child body (parent and child may not share the discriminator field).
    const parentLocations = new Map<string, { namespace: string; key: string }>();
    for (const { marshaller: m, body, id } of assignments) {
      const wrapped = m.wrap(body, id, ctx);
      const namespace = typeof m.namespace === 'function' ? m.namespace(body, ctx) : m.namespace;
      const key = m.storageKey
        ? m.storageKey(wrapped)
        : typeof wrapped.id === 'string' && wrapped.id.length > 0
          ? wrapped.id
          : id;
      opts.store.set(namespace, key, wrapped);
      parentLocations.set(parentLocationKey(m.contentResource, id), { namespace, key });
    }

    // Pass 3 — embedded children. Look up parent by label → id → location.
    for (const m of opts.marshallers) {
      if (m.kind !== 'embedded') continue;
      for (const resp of responses[m.contentResource] ?? []) {
        const body = (resp.body ?? {}) as Body;
        const label = body[m.parentLabelField];
        if (typeof label !== 'string' || !label) continue;
        const parentId = ctx.lookupId(m.parentResource, label);
        if (!parentId) continue; // orphan — silent skip per design.
        const loc = parentLocations.get(parentLocationKey(m.parentResource, parentId));
        if (!loc) continue;
        const parent = opts.store.get<Body>(loc.namespace, loc.key);
        if (!parent) continue;
        const existing = parent[m.arrayField];
        const arr = Array.isArray(existing) ? [...existing] : [];
        arr.push(m.wrap(body, ctx));
        opts.store.set(loc.namespace, loc.key, { ...parent, [m.arrayField]: arr });
      }
    }
  }
}

function parentLocationKey(contentResource: string, id: string): string {
  return `${contentResource} ${id}`;
}

function assertUniqueContentResources(marshallers: readonly Marshaller[]): void {
  const seen = new Set<string>();
  for (const m of marshallers) {
    if (seen.has(m.contentResource)) {
      throw new Error(
        `Marshaller collision: contentResource '${m.contentResource}' is declared by more than one marshaller. Each contentResource may have at most one marshaller.`,
      );
    }
    seen.add(m.contentResource);
  }
}
