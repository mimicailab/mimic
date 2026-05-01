/**
 * Custom seeder for Attio records.
 *
 * Attio's `record` resource is polymorphic: every record (person, company,
 * deal, …) is served from `/v2/objects/{object}/records`, but its content
 * lives inside a `values: { <attribute_slug>: [...] }` map whose slugs
 * depend on the object type. The persona generator can't fill an opaque
 * `values: {}`, so the codegen declares three flat pseudo-resources —
 * `record_person`, `record_company`, `record_deal` — with explicit content
 * fields the LLM populates.
 *
 * This seeder takes those flat entities, wraps each in Attio's record
 * envelope (compound id + values map keyed by the right slugs + web_url),
 * and writes them under `attio:records:{people|companies|deals}` so the
 * runtime query handler at `overrides/records.ts` finds them.
 *
 * Without this step, generated record content lands in a namespace the
 * runtime never reads, and `attio_find_contact` returns nothing.
 */

import type { ExpandedData, StateStore } from '@mimicai/core';
import { DEFAULT_WORKSPACE_ID, defaultRecord } from '../generated/schemas.js';
import { NS, nowIso, uuid } from './_shared.js';

const OBJECT_ID_FOR_SLUG: Record<string, string> = {
  people: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
  companies: '4f5b3adf-bf28-4d3f-9e6e-aaaaaaaaaaaa',
  deals: '8b3e0be4-0a0a-4d1e-9b3f-bbbbbbbbbbbb',
};

const PSEUDO_TO_SLUG: Record<string, keyof typeof OBJECT_ID_FOR_SLUG> = {
  record_person: 'people',
  record_company: 'companies',
  record_deal: 'deals',
};

type Body = Record<string, unknown>;

export function seedAttioRecords(
  data: Map<string, ExpandedData>,
  store: StateStore,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): void {
  for (const [, expanded] of data) {
    const responses = expanded.apiResponses?.attio?.responses;
    if (!responses) continue;

    for (const [pseudoType, slug] of Object.entries(PSEUDO_TO_SLUG)) {
      const entries = responses[pseudoType];
      if (!entries) continue;

      for (const resp of entries) {
        const body = (resp.body ?? {}) as Body;
        const recordId = uuid();
        const values = buildValues(pseudoType, body);
        const record = defaultRecord({
          id: {
            workspace_id: workspaceId,
            object_id: OBJECT_ID_FOR_SLUG[slug],
            record_id: recordId,
          },
          created_at: (body.created_at as string) ?? nowIso(),
          web_url: `https://app.attio.com/mimic/${slug}/${recordId}`,
          values,
        });
        store.set(NS.records(slug), recordId, record);
      }
    }
  }
}

function buildValues(pseudoType: string, body: Body): Record<string, unknown[]> {
  switch (pseudoType) {
    case 'record_person':
      return personValues(body);
    case 'record_company':
      return companyValues(body);
    case 'record_deal':
      return dealValues(body);
    default:
      return {};
  }
}

function personValues(b: Body): Record<string, unknown[]> {
  const fullName = (b.full_name as string) ?? '';
  const firstName = (b.first_name as string) ?? '';
  const lastName = (b.last_name as string) ?? '';
  const email = (b.primary_email as string) ?? '';
  const jobTitle = (b.job_title as string) ?? '';
  const companyDomain = (b.company_domain as string) ?? '';
  const description = (b.description as string) ?? '';

  const v: Record<string, unknown[]> = {};
  if (fullName || firstName || lastName) {
    v.name = [{
      full_name: fullName || `${firstName} ${lastName}`.trim(),
      first_name: firstName || fullName.split(' ')[0] || '',
      last_name: lastName || fullName.split(' ').slice(1).join(' ') || '',
    }];
  }
  if (email) v.email_addresses = [{ email_address: email }];
  if (jobTitle) v.job_title = [{ value: jobTitle }];
  if (companyDomain) v.company = [{ target_object: 'companies', target_record_id: companyDomain }];
  if (description) v.description = [{ value: description }];
  return v;
}

function companyValues(b: Body): Record<string, unknown[]> {
  const name = (b.name as string) ?? '';
  const domain = (b.domain as string) ?? '';
  const industry = (b.industry as string) ?? '';
  const employeeCount = b.employee_count as number | undefined;
  const description = (b.description as string) ?? '';

  const v: Record<string, unknown[]> = {};
  if (name) v.name = [{ value: name }];
  if (domain) v.domains = [{ domain }];
  if (industry) v.categories = [{ option: { title: industry } }];
  if (typeof employeeCount === 'number' && employeeCount > 0) {
    v.estimated_arr_usd = [{ value: employeeCount }];
    v.employee_range = [{ option: { title: bucketEmployees(employeeCount) } }];
  }
  if (description) v.description = [{ value: description }];
  return v;
}

function dealValues(b: Body): Record<string, unknown[]> {
  const name = (b.name as string) ?? '';
  const amount = b.value_amount as number | undefined;
  const currency = ((b.value_currency as string) ?? 'usd').toLowerCase();
  const stage = (b.stage as string) ?? '';
  const contactEmail = (b.primary_contact_email as string) ?? '';
  const companyDomain = (b.associated_company_domain as string) ?? '';
  const closeDate = (b.expected_close_date as string) ?? '';

  const v: Record<string, unknown[]> = {};
  if (name) v.name = [{ value: name }];
  if (typeof amount === 'number' && amount > 0) {
    v.value = [{ currency_value: amount, currency_code: currency.toUpperCase() }];
  }
  if (stage) v.stage = [{ status: { title: stage } }];
  if (contactEmail) v.associated_people = [{ target_object: 'people', target_record_email: contactEmail }];
  if (companyDomain) v.associated_company = [{ target_object: 'companies', target_record_domain: companyDomain }];
  if (closeDate) v.expected_close_date = [{ value: closeDate }];
  return v;
}

function bucketEmployees(n: number): string {
  if (n < 10) return '1-10';
  if (n < 50) return '11-50';
  if (n < 200) return '51-200';
  if (n < 1000) return '201-1000';
  return '1000+';
}
