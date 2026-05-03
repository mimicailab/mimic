/**
 * Marshallers for Attio's polymorphic record envelope.
 *
 * Attio records are served from `/v2/objects/{object}/records`, but their
 * content lives in a `values: { <attribute_slug>: [...] }` map whose slugs
 * vary by object type. The persona generator can't fill an opaque
 * `values: {}`, so the codegen declares three flat pseudo-resources —
 * `record_person`, `record_company`, `record_deal` — with explicit content
 * fields the LLM populates.
 *
 * Each marshaller wraps one pseudo-type into Attio's record envelope
 * (compound id + values map keyed by the right slugs + web_url) and writes
 * the result to `attio:records:{people|companies|deals}` so the runtime
 * query handler at `overrides/records.ts` finds it.
 */

import type { Marshaller, Body } from '@mimicai/adapter-sdk';
import { defaultRecord, DEFAULT_WORKSPACE_ID } from '../generated/schemas.js';
import { uuid, nowIso } from './_shared.js';

const OBJECT_ID_FOR_SLUG = {
  people: '97052eb9-e65e-443f-a297-f2d9a4a7f795',
  companies: '4f5b3adf-bf28-4d3f-9e6e-aaaaaaaaaaaa',
  deals: '8b3e0be4-0a0a-4d1e-9b3f-bbbbbbbbbbbb',
} as const;

export function buildAttioRecordMarshallers(
  workspaceId: string = DEFAULT_WORKSPACE_ID,
): Marshaller[] {
  return [
    {
      kind: 'standalone',
      contentResource: 'record_person',
      namespace: 'attio:records:people',
      generateId: () => uuid(),
      wrap: (body, recordId) =>
        wrapRecord(body, recordId, 'people', personValues(body), workspaceId),
      storageKey: extractRecordId,
    },
    {
      kind: 'standalone',
      contentResource: 'record_company',
      namespace: 'attio:records:companies',
      generateId: () => uuid(),
      wrap: (body, recordId) =>
        wrapRecord(body, recordId, 'companies', companyValues(body), workspaceId),
      storageKey: extractRecordId,
    },
    {
      kind: 'standalone',
      contentResource: 'record_deal',
      namespace: 'attio:records:deals',
      generateId: () => uuid(),
      wrap: (body, recordId) =>
        wrapRecord(body, recordId, 'deals', dealValues(body), workspaceId),
      storageKey: extractRecordId,
    },
  ];
}

function wrapRecord(
  body: Body,
  recordId: string,
  slug: keyof typeof OBJECT_ID_FOR_SLUG,
  values: Record<string, unknown[]>,
  workspaceId: string,
): Body {
  return defaultRecord({
    id: {
      workspace_id: workspaceId,
      object_id: OBJECT_ID_FOR_SLUG[slug],
      record_id: recordId,
    },
    created_at: (body.created_at as string) ?? nowIso(),
    web_url: `https://app.attio.com/mimic/${slug}/${recordId}`,
    values,
  });
}

function extractRecordId(wrapped: Body): string {
  const id = wrapped.id as Record<string, string> | undefined;
  return id?.record_id ?? '';
}

// ---------------------------------------------------------------------------
// Per-type value builders — produce the `values: { <slug>: [...] }` map.
// ---------------------------------------------------------------------------

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
    v.name = [
      {
        full_name: fullName || `${firstName} ${lastName}`.trim(),
        first_name: firstName || fullName.split(' ')[0] || '',
        last_name: lastName || fullName.split(' ').slice(1).join(' ') || '',
      },
    ];
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
