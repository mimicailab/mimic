/**
 * Default fixtures seeded into the StateStore on adapter start. Provides
 * just-enough state for `/v2/self`, `/v2/objects`, and the SCIM schema list
 * to answer without an explicit `mimic seed` call.
 *
 * Real persona data flows in via `seedExpandedData()` (run by the base class
 * before `mountOverrides`), which adds records, notes, tasks, etc.
 */

import type { StateStore } from '@mimicai/core';
import type { AttioConfig } from '../config.js';
import { DEFAULT_WORKSPACE_ID, NS, nowIso, uuid } from './_shared.js';
import {
  defaultObject,
  defaultWorkspaceMember,
} from '../generated/schemas.js';

const DEFAULT_OBJECT_SLUGS = ['people', 'companies', 'deals', 'workspaces', 'users'] as const;

const SCIM_SCHEMAS = [
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    name: 'User',
    description: 'User account',
    attributes: [],
    meta: { resourceType: 'Schema', location: '/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User' },
  },
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
    name: 'Group',
    description: 'Workspace group',
    attributes: [],
    meta: { resourceType: 'Schema', location: '/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group' },
  },
];

export function seedDefaultFixtures(store: StateStore, config?: AttioConfig): void {
  const workspaceId = config?.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const workspaceName = config?.workspaceName ?? 'Mimic Workspace';
  const workspaceSlug = config?.workspaceSlug ?? 'mimic';

  // /v2/self payload
  if (!store.get(NS.self, 'self')) {
    store.set(NS.self, 'self', {
      active: true,
      scope: 'comment:read comment:read-write list_configuration:read list_configuration:read-write list_entry:read list_entry:read-write note:read note:read-write object_configuration:read object_configuration:read-write record_permission:read record_permission:read-write task:read task:read-write user_management:read user_management:read-write webhook:read webhook:read-write',
      client_id: uuid(),
      token_type: 'Bearer',
      exp: null,
      iat: Math.floor(Date.now() / 1000),
      sub: uuid(),
      aud: 'mimic',
      iss: 'attio',
      authorized_by_workspace_member_id: uuid(),
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      workspace_slug: workspaceSlug,
      workspace_logo_url: null,
    });
  }

  // Standard CRM objects (people, companies, deals, workspaces, users).
  for (const slug of DEFAULT_OBJECT_SLUGS) {
    if (store.get(NS.objects, slug)) continue;
    store.set(
      NS.objects,
      slug,
      defaultObject({
        id: { workspace_id: workspaceId, object_id: deterministicObjectId(slug) },
        api_slug: slug,
        singular_noun: singularize(slug),
        plural_noun: slug,
        created_at: nowIso(),
      }),
    );
  }

  // Bot workspace member — so `attio_find_contact`'s lookup-by-email works
  // even before a persona is loaded.
  if (store.get(NS.workspaceMembers, 'bot') === undefined) {
    store.set(
      NS.workspaceMembers,
      'bot',
      defaultWorkspaceMember({
        id: { workspace_id: workspaceId, workspace_member_id: 'bot' },
        first_name: 'Mimic',
        last_name: 'Bot',
        email_address: 'bot@mimic.example',
        access_level: 'admin',
      }),
    );
  }

  // Static SCIM schemas
  for (const schema of SCIM_SCHEMAS) {
    if (store.get(NS.scimSchemas, schema.id) === undefined) {
      store.set(NS.scimSchemas, schema.id, schema);
    }
  }
}

const OBJECT_ID_FOR_SLUG: Record<string, string> = {
  people: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
  companies: '4f5b3adf-bf28-4d3f-9e6e-aaaaaaaaaaaa',
  deals: '8b3e0be4-0a0a-4d1e-9b3f-bbbbbbbbbbbb',
  workspaces: '21c2c4d8-cccc-4cdc-9c4f-cccccccccccc',
  users: '4d2dec55-dddd-4ded-aded-dddddddddddd',
};

function deterministicObjectId(slug: string): string {
  return OBJECT_ID_FOR_SLUG[slug] ?? uuid();
}

const IRREGULAR_SINGULARS: Record<string, string> = {
  people: 'person',
  companies: 'company',
};

function singularize(slug: string): string {
  if (IRREGULAR_SINGULARS[slug]) return IRREGULAR_SINGULARS[slug]!;
  if (slug.endsWith('ies')) return slug.slice(0, -3) + 'y';
  if (slug.endsWith('s')) return slug.slice(0, -1);
  return slug;
}
