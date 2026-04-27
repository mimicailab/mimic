import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { NS, getParam, send404, sendData } from './_shared.js';

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (_req, reply) => {
    const items = store.list<Record<string, unknown>>(NS.workspaceMembers);
    return sendData(reply, items);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const id = getParam(req, 'workspace_member_id');
    const member = store.get<Record<string, unknown>>(NS.workspaceMembers, id);
    if (!member) return send404(reply, 'Workspace member', id);
    return sendData(reply, member);
  };
}
