/**
 * Attribute / select-option / status configuration.
 *
 * The endpoint structure is:
 *   /v2/{target}/{identifier}/attributes
 *   /v2/{target}/{identifier}/attributes/{attribute}/options
 *   /v2/{target}/{identifier}/attributes/{attribute}/statuses
 *
 * `{target}` is "objects" or "lists"; `{identifier}` is the slug or UUID of
 * the object/list. We use both axes to namespace the StateStore.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { defaultAttribute, defaultSelectOption, defaultStatus } from '../generated/schemas.js';
import { NS, buildId, getParam, nowIso, parseBody, send404, sendData } from './_shared.js';

// Attributes -----------------------------------------------------------------

export function buildListHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const items = store.list<Record<string, unknown>>(NS.attributes(target, identifier));
    return sendData(reply, items);
  };
}

export function buildCreateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'attribute_id');
    const attr = defaultAttribute({
      ...data,
      id,
      api_slug: (data.api_slug as string) ?? `attr_${id.attribute_id!.slice(0, 8)}`,
      created_at: nowIso(),
    });
    store.set(NS.attributes(target, identifier), attr.api_slug as string, attr);
    return sendData(reply, attr);
  };
}

export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const attr = store.get<Record<string, unknown>>(NS.attributes(target, identifier), attribute);
    if (!attr) return send404(reply, 'Attribute', attribute);
    return sendData(reply, attr);
  };
}

export function buildUpdateHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const existing = store.get<Record<string, unknown>>(NS.attributes(target, identifier), attribute);
    if (!existing) return send404(reply, 'Attribute', attribute);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.attributes(target, identifier), attribute, updated);
    return sendData(reply, updated);
  };
}

// Select options -------------------------------------------------------------

export function buildListOptionsHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const items = store.list<Record<string, unknown>>(NS.selectOptions(target, identifier, attribute));
    return sendData(reply, items);
  };
}

export function buildCreateOptionHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'option_id');
    const option = defaultSelectOption({ ...data, id });
    store.set(NS.selectOptions(target, identifier, attribute), id.option_id!, option);
    return sendData(reply, option);
  };
}

export function buildUpdateOptionHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const optionId = getParam(req, 'option');
    const existing = store.get<Record<string, unknown>>(NS.selectOptions(target, identifier, attribute), optionId);
    if (!existing) return send404(reply, 'Select option', optionId);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.selectOptions(target, identifier, attribute), optionId, updated);
    return sendData(reply, updated);
  };
}

// Statuses -------------------------------------------------------------------

export function buildListStatusesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const items = store.list<Record<string, unknown>>(NS.statuses(target, identifier, attribute));
    return sendData(reply, items);
  };
}

export function buildCreateStatusHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const body = parseBody(req);
    const data = (body.data ?? body) as Record<string, unknown>;
    const id = buildId(data.id as Record<string, string> | undefined, 'status_id');
    const status = defaultStatus({ ...data, id });
    store.set(NS.statuses(target, identifier, attribute), id.status_id!, status);
    return sendData(reply, status);
  };
}

export function buildUpdateStatusHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const target = getParam(req, 'target');
    const identifier = getParam(req, 'identifier');
    const attribute = getParam(req, 'attribute');
    const statusId = getParam(req, 'status');
    const existing = store.get<Record<string, unknown>>(NS.statuses(target, identifier, attribute), statusId);
    if (!existing) return send404(reply, 'Status', statusId);
    const body = parseBody(req);
    const patch = (body.data ?? body) as Record<string, unknown>;
    const updated = { ...existing, ...patch };
    store.set(NS.statuses(target, identifier, attribute), statusId, updated);
    return sendData(reply, updated);
  };
}
