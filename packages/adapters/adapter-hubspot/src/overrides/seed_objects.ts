/**
 * Custom seeder for HubSpot CRM objects.
 *
 * HubSpot's CRM-object wire shape is `{id, properties: {...}, createdAt,
 * updatedAt, archived}` — every property (firstname, dealname, amount,
 * dealstage, ...) lives inside the polymorphic `properties` map, whose
 * keys depend on the object type. The persona generator can't fill an
 * opaque `properties: {}`, so the codegen declares four pseudo-resources
 * — `crm_contact`, `crm_company`, `crm_deal`, `crm_ticket` — with explicit
 * content fields the LLM populates.
 *
 * This seeder takes those flat entities, wraps each in HubSpot's CRM-object
 * envelope (id + property bag with the right slug names + standard
 * timestamps), and writes them under `hubspot:crm_objects:{contacts|
 * companies|deals|tickets}` so the runtime crm_objects override at
 * `overrides/crm_objects.ts` finds them.
 *
 * Without this step, generated CRM-object content lands in a namespace
 * the runtime never reads, and `GET /crm/objects/{version}/{type}` returns [].
 */

import type { ExpandedData, StateStore } from '@mimicai/core';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultHubSpotObject } from '../generated/schemas.js';

/** Maps each pseudo-resource key to the canonical CRM object slug used in URLs. */
const PSEUDO_TO_CANONICAL: Record<string, 'contacts' | 'companies' | 'deals' | 'tickets'> = {
  crm_contact: 'contacts',
  crm_company: 'companies',
  crm_deal: 'deals',
  crm_ticket: 'tickets',
};

type Body = Record<string, unknown>;

export function seedHubSpotCrmObjects(
  data: Map<string, ExpandedData>,
  store: StateStore,
): void {
  for (const [, expanded] of data) {
    const responses = expanded.apiResponses?.hubspot?.responses;
    if (!responses) continue;

    for (const [pseudoType, canonical] of Object.entries(PSEUDO_TO_CANONICAL)) {
      const entries = responses[pseudoType];
      if (!entries) continue;

      for (const resp of entries) {
        const body = (resp.body ?? {}) as Body;
        const id = (body.id as string) ?? generateId('', 18);
        const createdAt = (body.createdAt as string) ?? new Date().toISOString();
        const properties = buildProperties(pseudoType, body);
        const obj = defaultHubSpotObject({
          id,
          properties,
          createdAt,
          updatedAt: createdAt,
          archived: false,
        });
        store.set(`hubspot:crm_objects:${canonical}`, id, obj);
      }
    }
  }
}

function buildProperties(pseudoType: string, body: Body): Record<string, string> {
  switch (pseudoType) {
    case 'crm_contact':
      return contactProperties(body);
    case 'crm_company':
      return companyProperties(body);
    case 'crm_deal':
      return dealProperties(body);
    case 'crm_ticket':
      return ticketProperties(body);
    default:
      return {};
  }
}

/** HubSpot serializes every property value as a string — even numbers and dates. */
function s(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  return String(v);
}

function contactProperties(b: Body): Record<string, string> {
  const p: Record<string, string> = {};
  if (s(b.firstname)) p.firstname = s(b.firstname)!;
  if (s(b.lastname)) p.lastname = s(b.lastname)!;
  if (s(b.email)) p.email = s(b.email)!;
  if (s(b.jobtitle)) p.jobtitle = s(b.jobtitle)!;
  if (s(b.company_domain)) p.company = s(b.company_domain)!;
  if (s(b.phone)) p.phone = s(b.phone)!;
  if (s(b.lifecyclestage)) p.lifecyclestage = s(b.lifecyclestage)!;
  if (s(b.hs_lead_status)) p.hs_lead_status = s(b.hs_lead_status)!;
  if (s(b.createdAt)) p.createdate = s(b.createdAt)!;
  return p;
}

function companyProperties(b: Body): Record<string, string> {
  const p: Record<string, string> = {};
  if (s(b.name)) p.name = s(b.name)!;
  if (s(b.domain)) p.domain = s(b.domain)!;
  if (s(b.industry)) p.industry = s(b.industry)!;
  if (s(b.numberofemployees)) p.numberofemployees = s(b.numberofemployees)!;
  if (s(b.annualrevenue)) p.annualrevenue = s(b.annualrevenue)!;
  if (s(b.description)) p.description = s(b.description)!;
  if (s(b.lifecyclestage)) p.lifecyclestage = s(b.lifecyclestage)!;
  if (s(b.createdAt)) p.createdate = s(b.createdAt)!;
  return p;
}

function dealProperties(b: Body): Record<string, string> {
  const p: Record<string, string> = {};
  if (s(b.dealname)) p.dealname = s(b.dealname)!;
  if (s(b.amount)) p.amount = s(b.amount)!;
  if (s(b.deal_currency_code)) p.deal_currency_code = String(b.deal_currency_code).toUpperCase();
  if (s(b.dealstage)) p.dealstage = s(b.dealstage)!;
  if (s(b.pipeline)) p.pipeline = s(b.pipeline)!;
  if (s(b.closedate)) p.closedate = s(b.closedate)!;
  // primary_contact_email and associated_company_domain are persona-side join keys —
  // HubSpot stores associations in a separate Associations API, but for read-only
  // briefing flows it's helpful to have the values on the deal record itself.
  if (s(b.primary_contact_email)) p.primary_contact_email = s(b.primary_contact_email)!;
  if (s(b.associated_company_domain)) p.associated_company_domain = s(b.associated_company_domain)!;
  if (s(b.description)) p.description = s(b.description)!;
  if (s(b.createdAt)) p.createdate = s(b.createdAt)!;
  return p;
}

function ticketProperties(b: Body): Record<string, string> {
  const p: Record<string, string> = {};
  if (s(b.subject)) p.subject = s(b.subject)!;
  if (s(b.content)) p.content = s(b.content)!;
  if (s(b.hs_pipeline)) p.hs_pipeline = s(b.hs_pipeline)!;
  if (s(b.hs_pipeline_stage)) p.hs_pipeline_stage = s(b.hs_pipeline_stage)!;
  if (s(b.hs_ticket_priority)) p.hs_ticket_priority = s(b.hs_ticket_priority)!;
  if (s(b.primary_contact_email)) p.primary_contact_email = s(b.primary_contact_email)!;
  if (s(b.associated_company_domain)) p.associated_company_domain = s(b.associated_company_domain)!;
  if (s(b.createdAt)) p.createdate = s(b.createdAt)!;
  return p;
}
