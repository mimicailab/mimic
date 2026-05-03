/**
 * SCIM 2.0 user/group provisioning. Returns SCIM-shaped envelopes
 * (`schemas`, `Resources`, etc.) — distinct from the v2 `{ data: ... }` shape.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { NS, getParam, getQuery, parseBody, sendScimList, uuid } from './_shared.js';
import { attioNotFound } from '../attio-errors.js';

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';

function scimNotFound(reply: Parameters<OverrideHandler>[1], detail: string) {
  return reply.code(404).send({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail,
    status: '404',
  });
}

// Schemas list ---------------------------------------------------------------

export function buildListSchemasHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const items = store.list<Record<string, unknown>>(NS.scimSchemas);
    return sendScimList(reply, items);
  };
}

// Users ----------------------------------------------------------------------

export function buildListUsersHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.scimUsers);
    if (q.filter) {
      // Minimal SCIM filter support: `userName eq "x"` style.
      const m = q.filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/);
      if (m) {
        const [, attr, val] = m;
        items = items.filter((u) => (u as Record<string, unknown>)[attr!] === val);
      }
    }
    return sendScimList(reply, items);
  };
}

export function buildCreateUserHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const id = (body.id as string) ?? uuid();
    const user = {
      schemas: [SCIM_USER_SCHEMA],
      id,
      userName: body.userName ?? '',
      name: body.name ?? { givenName: '', familyName: '' },
      emails: body.emails ?? [],
      active: body.active ?? true,
      meta: {
        resourceType: 'User',
        location: `/scim/v2/Users/${id}`,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
      ...body,
    };
    store.set(NS.scimUsers, id, user);
    return reply.code(201).send(user);
  };
}

export function buildRetrieveUserHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'user_id');
    const user = store.get<Record<string, unknown>>(NS.scimUsers, id);
    if (!user) return scimNotFound(reply, attioNotFound('SCIM user', id).message);
    return reply.code(200).send(user);
  };
}

export function buildPatchUserHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'user_id');
    const existing = store.get<Record<string, unknown>>(NS.scimUsers, id);
    if (!existing) return scimNotFound(reply, attioNotFound('SCIM user', id).message);
    const body = parseBody(req);
    const ops = (body.Operations as Array<Record<string, unknown>> | undefined) ?? [];
    const patched = { ...existing };
    for (const op of ops) {
      const path = op.path as string | undefined;
      const value = op.value;
      const operation = ((op.op as string) ?? '').toLowerCase();
      if (!path) {
        if (operation === 'replace' && typeof value === 'object' && value) {
          Object.assign(patched, value);
        }
        continue;
      }
      if (operation === 'replace' || operation === 'add') {
        patched[path] = value;
      } else if (operation === 'remove') {
        delete patched[path];
      }
    }
    store.set(NS.scimUsers, id, patched);
    return reply.code(200).send(patched);
  };
}

export function buildReplaceUserHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'user_id');
    if (!store.get(NS.scimUsers, id)) return scimNotFound(reply, attioNotFound('SCIM user', id).message);
    const body = parseBody(req);
    const replaced = { ...body, id };
    store.set(NS.scimUsers, id, replaced);
    return reply.code(200).send(replaced);
  };
}

export function buildDeleteUserHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'user_id');
    if (!store.get(NS.scimUsers, id)) return scimNotFound(reply, attioNotFound('SCIM user', id).message);
    store.delete(NS.scimUsers, id);
    return reply.code(204).send();
  };
}

// Groups ---------------------------------------------------------------------

export function buildListGroupsHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const q = getQuery(req);
    let items = store.list<Record<string, unknown>>(NS.scimGroups);
    if (q.filter) {
      const m = q.filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/);
      if (m) {
        const [, attr, val] = m;
        items = items.filter((g) => (g as Record<string, unknown>)[attr!] === val);
      }
    }
    return sendScimList(reply, items);
  };
}

export function buildCreateGroupHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const id = (body.id as string) ?? uuid();
    const group = {
      schemas: [SCIM_GROUP_SCHEMA],
      id,
      displayName: body.displayName ?? '',
      members: body.members ?? [],
      meta: {
        resourceType: 'Group',
        location: `/scim/v2/Groups/${id}`,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
      },
      ...body,
    };
    store.set(NS.scimGroups, id, group);
    return reply.code(201).send(group);
  };
}

export function buildRetrieveGroupHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'workspace_team_id');
    const group = store.get<Record<string, unknown>>(NS.scimGroups, id);
    if (!group) return scimNotFound(reply, attioNotFound('SCIM group', id).message);
    return reply.code(200).send(group);
  };
}

export function buildPatchGroupHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'workspace_team_id');
    const existing = store.get<Record<string, unknown>>(NS.scimGroups, id);
    if (!existing) return scimNotFound(reply, attioNotFound('SCIM group', id).message);
    const body = parseBody(req);
    const ops = (body.Operations as Array<Record<string, unknown>> | undefined) ?? [];
    const patched: Record<string, unknown> = { ...existing };
    for (const op of ops) {
      const path = op.path as string | undefined;
      const value = op.value;
      const operation = ((op.op as string) ?? '').toLowerCase();
      if (!path) continue;
      if (operation === 'replace' || operation === 'add') patched[path] = value;
      else if (operation === 'remove') delete patched[path];
    }
    store.set(NS.scimGroups, id, patched);
    return reply.code(200).send(patched);
  };
}

export function buildReplaceGroupHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'workspace_team_id');
    if (!store.get(NS.scimGroups, id)) return scimNotFound(reply, attioNotFound('SCIM group', id).message);
    const body = parseBody(req);
    const replaced = { ...body, id };
    store.set(NS.scimGroups, id, replaced);
    return reply.code(200).send(replaced);
  };
}

export function buildDeleteGroupHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'workspace_team_id');
    if (!store.get(NS.scimGroups, id)) return scimNotFound(reply, attioNotFound('SCIM group', id).message);
    store.delete(NS.scimGroups, id);
    return reply.code(204).send();
  };
}
