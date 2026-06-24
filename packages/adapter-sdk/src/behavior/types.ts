/**
 * Behavior DSL — declarative state-machine specification for API mock adapters.
 *
 * A behavior pack expresses the per-platform "residue" that an OpenAPI spec
 * cannot describe: lifecycle transitions, guards, cross-resource side effects,
 * and webhook emits. The generic interpreter (`interpreter.ts`) executes a pack
 * against the StateStore, replacing hand-written override handlers.
 *
 * Packs are authored as YAML and loaded as plain objects — see
 * `behavior/*.yaml` in each adapter.
 */

/** Reference to a resource instance in the StateStore. */
export interface TargetRef {
  /** StateStore namespace, e.g. "stripe:payment_intents". */
  namespace: string;
  /** Template resolving to the resource id, e.g. "{{ params.intent }}". */
  id: string;
}

/** Error response emitted when a guard fails or a target is missing. */
export interface ErrorSpec {
  status: number;
  code: string;
  /** Template — may interpolate scope, e.g. "No such payment_intent: '{{ params.intent }}'". */
  message: string;
  /** Optional platform error-kind hint passed to the adapter's error factory. */
  kind?: string;
  param?: string;
}

/** Create a new sibling resource as a side effect. */
export interface CreateEffect {
  create: string;            // resource label (for readability)
  namespace: string;         // StateStore namespace to write into
  idPrefix: string;          // id prefix, e.g. "ch_"
  idLength?: number;
  /** Bind the new id into the scope under this name for later effects. */
  bind?: string;
  fields: Record<string, unknown>;  // templated field map
}

/** Patch fields on the action's target resource. */
export interface SetEffect {
  set: Record<string, unknown>;     // templated field map merged onto `self`
}

/** Shallow-merge a resolved object onto the target (e.g. the request body). */
export interface MergeEffect {
  merge: unknown;                   // template resolving to an object, spread onto `self`
}

/** Patch fields on another existing resource. */
export interface UpdateEffect {
  update: { namespace: string; id: string; set: Record<string, unknown> };
}

/** Bind a computed value into scope for later effects/templates. */
export interface VarEffect {
  var: Record<string, unknown>;     // name -> template
}

/** Conditionally run nested effects. */
export interface WhenEffect {
  when: string;                     // expression
  then: Effect[];
  else?: Effect[];
}

/** Abort with an error response. */
export interface ErrorEffect {
  error: ErrorSpec;
}

export type Effect =
  | CreateEffect | SetEffect | MergeEffect | UpdateEffect | VarEffect | WhenEffect | ErrorEffect;

/** Webhook emit on a state transition (consumed by the delivery engine). */
export interface EmitSpec {
  /** Expression gating the emit, evaluated after effects. */
  when?: string;
  event: string;
  /** Template producing the event payload; defaults to the target resource. */
  data?: unknown;
}

/** A single routed action — one override handler. */
export interface ActionSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Fastify-style path relative to the adapter base, e.g. "/v1/payment_intents/:intent/confirm". */
  path: string;
  /** Resource this action operates on. If set, `self` is loaded and re-stored. */
  target?: TargetRef;
  /** Error when `target` cannot be found. */
  notFound?: ErrorSpec;
  /** Boolean guard expression; when false, `guardError` is returned. */
  guard?: string;
  guardError?: ErrorSpec;
  /** Ordered side effects. */
  effects?: Effect[];
  /** Template for the response body. Defaults to the (updated) target `self`. */
  respond?: unknown;
  /** HTTP status for a successful response (default 200). */
  status?: number;
  /** When true, delete the target from the store instead of re-storing it. */
  delete?: boolean;
  /** Webhook emits triggered by this action. */
  emit?: EmitSpec[];
}

/** A behavior pack for one adapter. */
export interface BehaviorPack {
  /** Adapter id this pack belongs to, e.g. "stripe". */
  adapter: string;
  /** Default id length for generated ids. */
  idLength?: number;
  actions: ActionSpec[];
}
