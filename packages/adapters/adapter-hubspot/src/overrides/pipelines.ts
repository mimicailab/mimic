/**
 * Pipelines overrides.
 *
 * `/crm/pipelines/<version>/:objectType` is conceptually "list pipelines for
 * this object type" but the codegen sees the trailing path param and
 * classifies it as `retrieve`. Override the listing behaviour explicitly so
 * `GET /crm/pipelines/2026-03/deals` returns the deal pipelines envelope.
 */

import type { StateStore } from '@mimicai/core';
import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { getParam, nsFor, sendList } from './_shared.js';

export function buildListByObjectTypeHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = getParam(req, 'objectType');
    const all = store.list<Record<string, unknown>>(nsFor('crm_pipelines'));
    const filtered = all.filter((p) => p.objectType === objectType);
    return sendList(reply, filtered);
  };
}

/** GET .../:objectType/:pipelineId — retrieve single pipeline. */
export function buildRetrieveHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = getParam(req, 'objectType');
    const pipelineId = getParam(req, 'pipelineId');
    const all = store.list<Record<string, unknown>>(nsFor('crm_pipelines'));
    const found = all.find((p) => p.objectType === objectType && p.id === pipelineId);
    if (!found) return reply.code(404).send({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Pipeline ${pipelineId} not found for ${objectType}`, correlationId: '00000000-0000-4000-8000-000000000000' });
    return reply.code(200).send(found);
  };
}

/** GET .../:objectType/:pipelineId/stages — list stages of a pipeline. */
export function buildListStagesHandler(store: StateStore): OverrideHandler {
  return async (req, reply) => {
    const objectType = getParam(req, 'objectType');
    const pipelineId = getParam(req, 'pipelineId');
    const all = store.list<Record<string, unknown>>(nsFor('crm_pipelines'));
    const pipeline = all.find((p) => p.objectType === objectType && p.id === pipelineId);
    if (!pipeline) return reply.code(404).send({ status: 'error', category: 'OBJECT_NOT_FOUND', message: `Pipeline ${pipelineId} not found for ${objectType}`, correlationId: '00000000-0000-4000-8000-000000000000' });
    const stages = (pipeline.stages as unknown[] | undefined) ?? [];
    return sendList(reply, stages);
  };
}
