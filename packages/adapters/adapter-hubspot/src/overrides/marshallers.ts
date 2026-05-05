/**
 * Marshallers for HubSpot's polymorphic CRM-object envelope.
 *
 * HubSpot's CRM-object wire shape is `{id, properties: {...}, createdAt,
 * updatedAt, archived}` — every property (firstname, dealname, amount,
 * dealstage, ...) lives inside a polymorphic `properties` map whose keys
 * depend on the object type. The persona generator can't fill an opaque
 * `properties: {}`, so the codegen declares four pseudo-resources —
 * `crm_contact`, `crm_company`, `crm_deal`, `crm_ticket` — with explicit
 * content fields the LLM populates.
 *
 * Each marshaller wraps one pseudo-type into HubSpot's CRM-object envelope
 * and writes the result to `hubspot:crm_objects:{contacts|companies|deals|
 * tickets}` so the runtime crm_objects override finds it.
 *
 * For engagement / inventory CRM objects (calls, meetings, emails, notes,
 * tasks, line_items, products) the persona generator emits records already
 * in wire shape (the `properties` map for these types is small enough that
 * the LLM can populate it directly). Without a marshaller, the generic
 * auto-seeder would store them under `hubspot:<resource>` (e.g.
 * `hubspot:call`), but the unified CRM-objects list endpoint reads from
 * `hubspot:crm_objects:<plural>` (e.g. `hubspot:crm_objects:calls`). The
 * passthrough marshallers below route them to the correct namespace.
 */

import type { Body, Marshaller } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { defaultHubSpotObject } from '../generated/schemas.js';

export function buildHubSpotCrmMarshallers(): Marshaller[] {
  return [
    {
      kind: 'standalone',
      contentResource: 'crm_contact',
      namespace: 'hubspot:crm_objects:contacts',
      generateId: (body) => (body.id as string | undefined) ?? generateId('', 18),
      wrap: (body, id) => wrapCrmObject(id, body, contactProperties(body)),
    },
    {
      kind: 'standalone',
      contentResource: 'crm_company',
      namespace: 'hubspot:crm_objects:companies',
      generateId: (body) => (body.id as string | undefined) ?? generateId('', 18),
      wrap: (body, id) => wrapCrmObject(id, body, companyProperties(body)),
    },
    {
      kind: 'standalone',
      contentResource: 'crm_deal',
      namespace: 'hubspot:crm_objects:deals',
      generateId: (body) => (body.id as string | undefined) ?? generateId('', 18),
      wrap: (body, id) => wrapCrmObject(id, body, dealProperties(body)),
    },
    {
      kind: 'standalone',
      contentResource: 'crm_ticket',
      namespace: 'hubspot:crm_objects:tickets',
      generateId: (body) => (body.id as string | undefined) ?? generateId('', 18),
      wrap: (body, id) => wrapCrmObject(id, body, ticketProperties(body)),
    },
    passthroughCrmObject('call', 'calls'),
    passthroughCrmObject('meeting', 'meetings'),
    passthroughCrmObject('email', 'emails'),
    passthroughCrmObject('note', 'notes'),
    passthroughCrmObject('task', 'tasks'),
    passthroughCrmObject('line_item', 'line_items'),
    passthroughCrmObject('product', 'products'),
  ];
}

/**
 * Routes already-wire-shaped CRM objects (calls, meetings, line_items, etc.)
 * to `hubspot:crm_objects:<plural>` so the unified list endpoint can find
 * them. The body's `properties` map is preserved as-is.
 */
function passthroughCrmObject(contentResource: string, plural: string): Marshaller {
  return {
    kind: 'standalone',
    contentResource,
    namespace: `hubspot:crm_objects:${plural}`,
    generateId: (body) => (body.id as string | undefined) ?? generateId('', 18),
    wrap: (body, id) => {
      const createdAt = (body.createdAt as string) ?? new Date().toISOString();
      return defaultHubSpotObject({
        id,
        properties: (body.properties as Record<string, unknown>) ?? {},
        createdAt,
        updatedAt: (body.updatedAt as string) ?? createdAt,
        archived: Boolean(body.archived),
      });
    },
  };
}

function wrapCrmObject(id: string, body: Body, properties: Record<string, string>): Body {
  const createdAt = (body.createdAt as string) ?? new Date().toISOString();
  return defaultHubSpotObject({
    id,
    properties,
    createdAt,
    updatedAt: createdAt,
    archived: false,
  });
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
  // primary_contact_email + associated_company_domain are persona-side join
  // keys. HubSpot stores associations in a separate Associations API, but
  // for read-only briefing flows it's helpful to have the values on the
  // deal record itself.
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
