/**
 * Shared types for the OpenAPI-driven mock adapter infrastructure.
 * These types are used by both the codegen script and the runtime adapter.
 */

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

export interface GeneratedRoute {
  /** HTTP method */
  method: RouteMethod;
  /** Fastify route path with colon params and /stripe prefix */
  fastifyPath: string;
  /** Original Stripe path for documentation */
  stripePath: string;
  /** Top-level resource name (plural, e.g. 'customers') */
  resource: string;
  /** CRUD operation classification */
  operation: RouteOperation;
  /** Human-readable description from the spec */
  description: string;
  /** Query param names that can be used to filter list results */
  queryFilters: string[];
  /** Path param name holding the resource ID (retrieve/update/delete) */
  idParam?: string;
  /** Object type string for delete confirmation responses */
  objectType?: string;
}
