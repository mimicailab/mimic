// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-granola generate

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';

export interface GeneratedRoute {
  method: RouteMethod;
  fastifyPath: string;
  /** Original Granola spec path (field name is historical across adapters) */
  stripePath: string;
  resource: string;
  operation: RouteOperation;
  description: string;
  queryFilters: string[];
  idParam?: string;
  objectType?: string;
}

export const GENERATED_ROUTES: GeneratedRoute[] = [
  {
    method: "GET",
    fastifyPath: "/v1/folders",
    stripePath: "/v1/folders",
    resource: "folders",
    operation: "list",
    description: "List folders",
    queryFilters: ["cursor","page_size"],
    objectType: "folder",
  },
  {
    method: "GET",
    fastifyPath: "/v1/notes",
    stripePath: "/v1/notes",
    resource: "notes",
    operation: "list",
    description: "List notes",
    queryFilters: ["created_before","created_after","updated_after","cursor","page_size"],
    objectType: "note",
  },
  {
    method: "GET",
    fastifyPath: "/v1/notes/:note_id",
    stripePath: "/v1/notes/{note_id}",
    resource: "notes",
    operation: "retrieve",
    description: "Get note",
    queryFilters: ["include"],
    idParam: "note_id",
    objectType: "note",
  }
];
