// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-hubspot generate
import { generateId } from '@mimicai/adapter-sdk';
import type { DefaultFactory } from '@mimicai/adapter-sdk';

/**
 * Hand-tuned factories for the most-used HubSpot CRM objects, plus a
 * generic factory (`defaultHubSpotObject`) used as a fallback for any
 * resource the codegen sees but we haven't typed explicitly.
 *
 * HubSpot's universal CRM-object shape is:
 *   { id, properties: {...}, createdAt, updatedAt, archived }
 * Properties are flat string→value bags — even numeric/date values are
 * stringified per HubSpot convention.
 */

/** Generic factory for any "CRM object" — contacts, companies, deals, etc. */
export function defaultHubSpotObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 18),
    properties: (o.properties as Record<string, unknown>) ?? {},
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    archived: (o.archived as boolean) ?? false,
    ...overrides,
  };
}

export function defaultContact(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      firstname: '',
      lastname: '',
      email: '',
      lifecyclestage: 'lead',
      hs_lead_status: 'NEW',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultCompany(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      domain: '',
      industry: '',
      lifecyclestage: 'lead',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultDeal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      dealname: '',
      amount: '0',
      dealstage: 'qualifiedtobuy',
      pipeline: 'default',
      closedate: null,
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      subject: '',
      content: '',
      hs_pipeline: '0',
      hs_pipeline_stage: '1',
      hs_ticket_priority: 'MEDIUM',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_note_body: '',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_task_subject: '',
      hs_task_body: '',
      hs_task_status: 'NOT_STARTED',
      hs_task_priority: 'MEDIUM',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultCall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_call_title: '',
      hs_call_body: '',
      hs_call_duration: '0',
      hs_call_disposition: '',
      hs_call_status: 'COMPLETED',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_meeting_title: '',
      hs_meeting_body: '',
      hs_meeting_outcome: 'COMPLETED',
      hs_meeting_start_time: new Date().toISOString(),
      hs_meeting_end_time: new Date(Date.now() + 30 * 60_000).toISOString(),
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultEmail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      hs_email_subject: '',
      hs_email_text: '',
      hs_email_status: 'SENT',
      hs_email_direction: 'EMAIL',
      hs_timestamp: new Date().toISOString(),
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      quantity: '1',
      price: '0',
      amount: '0',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return defaultHubSpotObject({
    properties: {
      name: '',
      price: '0',
      hs_sku: '',
      ...((overrides.properties as Record<string, unknown>) ?? {}),
    },
    ...overrides,
  });
}

export function defaultOwner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 8),
    email: (o.email as string) ?? '',
    firstName: (o.firstName as string) ?? '',
    lastName: (o.lastName as string) ?? '',
    userId: (o.userId as number) ?? Math.floor(Math.random() * 100_000_000),
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    archived: (o.archived as boolean) ?? false,
    teams: (o.teams as unknown[]) ?? [],
    ...overrides,
  };
}

export function defaultPipeline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    id: (o.id as string) ?? generateId('', 12),
    label: (o.label as string) ?? '',
    displayOrder: (o.displayOrder as number) ?? 0,
    stages: (o.stages as unknown[]) ?? [],
    archived: (o.archived as boolean) ?? false,
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}

export function defaultProperty(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    name: (o.name as string) ?? '',
    label: (o.label as string) ?? '',
    type: (o.type as string) ?? 'string',
    fieldType: (o.fieldType as string) ?? 'text',
    groupName: (o.groupName as string) ?? '',
    options: (o.options as unknown[]) ?? [],
    hubspotDefined: (o.hubspotDefined as boolean) ?? false,
    modificationMetadata: (o.modificationMetadata as Record<string, unknown> | null) ?? null,
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}

export function defaultList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = new Date().toISOString();
  const o = overrides as Record<string, unknown>;
  return {
    listId: (o.listId as string) ?? String(Math.floor(Math.random() * 1_000_000)),
    name: (o.name as string) ?? '',
    objectTypeId: (o.objectTypeId as string) ?? '0-1',
    processingType: (o.processingType as string) ?? 'MANUAL',
    processingStatus: (o.processingStatus as string) ?? 'COMPLETED',
    createdAt: (o.createdAt as string) ?? now,
    updatedAt: (o.updatedAt as string) ?? now,
    ...overrides,
  };
}

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "contact": defaultContact,
  "contacts": defaultContact,
  "crm_contacts": defaultContact,
  "company": defaultCompany,
  "companies": defaultCompany,
  "crm_companies": defaultCompany,
  "deal": defaultDeal,
  "deals": defaultDeal,
  "crm_deals": defaultDeal,
  "ticket": defaultTicket,
  "tickets": defaultTicket,
  "crm_tickets": defaultTicket,
  "note": defaultNote,
  "notes": defaultNote,
  "crm_notes": defaultNote,
  "task": defaultTask,
  "tasks": defaultTask,
  "crm_tasks": defaultTask,
  "call": defaultCall,
  "calls": defaultCall,
  "crm_calls": defaultCall,
  "meeting": defaultMeeting,
  "meetings": defaultMeeting,
  "crm_meetings": defaultMeeting,
  "email": defaultEmail,
  "emails": defaultEmail,
  "crm_emails": defaultEmail,
  "line_item": defaultLineItem,
  "line_items": defaultLineItem,
  "crm_line_items": defaultLineItem,
  "product": defaultProduct,
  "products": defaultProduct,
  "crm_products": defaultProduct,
  "owner": defaultOwner,
  "owners": defaultOwner,
  "crm_owners": defaultOwner,
  "crm_crm_owners": defaultOwner,
  "pipeline": defaultPipeline,
  "pipelines": defaultPipeline,
  "crm_pipelines": defaultPipeline,
  "property": defaultProperty,
  "properties": defaultProperty,
  "crm_properties": defaultProperty,
  "list": defaultList,
  "lists": defaultList,
  "crm_lists": defaultList,
  "crm_objects": defaultHubSpotObject,
};

/** Fallback factory for any resource not in SCHEMA_DEFAULTS. */
export const GENERIC_FACTORY: DefaultFactory = defaultHubSpotObject;
