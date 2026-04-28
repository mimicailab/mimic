/**
 * HubSpot MCP tools.
 *
 * Designed for the Briefing Agent's flow: `find_hubspot_contact_by_email`
 * is Step 1 (alongside `find_attio_contact_by_email`), then deal/notes/
 * tasks/meetings/calls/emails lookup feeds Steps 2-4. General-purpose
 * tools for common HubSpot queries are also included.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import meta from './adapter-meta.js';

function makeCall(baseUrl: string) {
  return async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  };
}

const VERSION = '2026-03';

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function json(payload: unknown) {
  return text(JSON.stringify(payload, null, 2));
}

export function registerHubSpotTools(server: McpServer, baseUrl: string): void {
  const call = makeCall(baseUrl);

  // ── 1. find_hubspot_contact_by_email ──────────────────────────────────────
  server.tool(
    'find_hubspot_contact_by_email',
    "Find a HubSpot contact by email. Briefing-agent Step 1: maps a meeting attendee email to their CRM identity. Returns matching contact(s) with id, properties (firstname/lastname/email/lifecyclestage/jobtitle), and the HubSpot record url. Use BEFORE any deal/note lookup.",
    {
      email: z.string().describe('Email address to match exactly, e.g. "priya@northwind.com"'),
      properties: z.array(z.string()).optional().describe("Properties to return. Default includes: firstname, lastname, email, jobtitle, company, lifecyclestage."),
    },
    async ({ email, properties }) => {
      const props = properties && properties.length > 0
        ? properties
        : ['firstname', 'lastname', 'email', 'jobtitle', 'company', 'lifecyclestage', 'hs_lead_status'];
      const data = await call('POST', `/crm/contacts/${VERSION}/contacts/search`, {
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: props,
        limit: 5,
      });
      return json(data);
    },
  );

  // ── 2. get_hubspot_record ──────────────────────────────────────────────────
  server.tool(
    'get_hubspot_record',
    "Fetch a HubSpot CRM record by object type and id. Use after `find_hubspot_contact_by_email` to pull full attributes, or to retrieve a deal/company/ticket directly.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets', 'notes', 'tasks', 'calls', 'meetings', 'emails', 'line_items', 'products']),
      record_id: z.string().describe('HubSpot record id (numeric string)'),
      properties: z.array(z.string()).optional().describe('Properties to project'),
    },
    async ({ object_type, record_id, properties }) => {
      const qs = properties && properties.length > 0 ? `?properties=${properties.join(',')}` : '';
      const data = await call('GET', `/crm/objects/${VERSION}/${object_type}/${encodeURIComponent(record_id)}${qs}`);
      return json(data);
    },
  );

  // ── 3. search_hubspot_records ──────────────────────────────────────────────
  server.tool(
    'search_hubspot_records',
    "HubSpot's filterGroups search across any CRM object type. Supports operators EQ, NEQ, LT/LTE/GT/GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN. filterGroups OR together; filters within a group AND together.",
    {
      object_type: z.string().describe('e.g. "contacts", "deals", "companies"'),
      filterGroups: z.array(z.object({
        filters: z.array(z.object({
          propertyName: z.string(),
          operator: z.string(),
          value: z.unknown().optional(),
          values: z.array(z.unknown()).optional(),
          highValue: z.unknown().optional(),
        })),
      })).optional(),
      query: z.string().optional().describe('Free-text search across all properties'),
      properties: z.array(z.string()).optional(),
      sorts: z.array(z.union([z.string(), z.object({ propertyName: z.string(), direction: z.enum(['ASCENDING', 'DESCENDING']) })])).optional(),
      limit: z.number().int().min(1).max(100).optional().default(10),
    },
    async ({ object_type, filterGroups, query, properties, sorts, limit }) => {
      const data = await call('POST', `/crm/objects/${VERSION}/${object_type}/search`, {
        filterGroups, query, properties, sorts, limit,
      });
      return json(data);
    },
  );

  // ── 4. list_hubspot_deals_for_contact ──────────────────────────────────────
  server.tool(
    'list_hubspot_deals_for_contact',
    "List deals associated with a HubSpot contact. Returns deal records with stage, amount, closedate, owner. Use to assemble the 'DEAL' line of the briefing.",
    {
      contact_id: z.string().describe('Contact id (the HubSpot record id, not the email)'),
      properties: z.array(z.string()).optional(),
    },
    async ({ contact_id, properties }) => {
      const props = properties ?? ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'hubspot_owner_id'];
      const data = await call('POST', `/crm/objects/${VERSION}/deals/search`, {
        filterGroups: [{ filters: [{ propertyName: 'associations.contact', operator: 'EQ', value: contact_id }] }],
        properties: props,
        limit: 10,
      });
      return json(data);
    },
  );

  // ── 5. list_hubspot_notes_for_record ───────────────────────────────────────
  server.tool(
    'list_hubspot_notes_for_record',
    "List engagement notes attached to a HubSpot record (contact, company, deal, or ticket). Returns hs_note_body, hs_timestamp, owner. Newest first when sorted by hs_timestamp DESC.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets']),
      record_id: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object_type, record_id, limit }) => {
      const data = await call('POST', `/crm/objects/${VERSION}/notes/search`, {
        filterGroups: [{ filters: [{ propertyName: `associations.${object_type.replace(/s$/, '')}`, operator: 'EQ', value: record_id }] }],
        properties: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        limit,
      });
      return json(data);
    },
  );

  // ── 6. list_hubspot_tasks_for_record ───────────────────────────────────────
  server.tool(
    'list_hubspot_tasks_for_record',
    "List tasks linked to a record. Filter by status to find open follow-ups. Returns hs_task_subject, hs_task_status, hs_timestamp.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets']),
      record_id: z.string(),
      status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'COMPLETED', 'DEFERRED']).optional(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object_type, record_id, status, limit }) => {
      const filters: Array<Record<string, unknown>> = [
        { propertyName: `associations.${object_type.replace(/s$/, '')}`, operator: 'EQ', value: record_id },
      ];
      if (status) filters.push({ propertyName: 'hs_task_status', operator: 'EQ', value: status });
      const data = await call('POST', `/crm/objects/${VERSION}/tasks/search`, {
        filterGroups: [{ filters }],
        properties: ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority', 'hs_timestamp', 'hubspot_owner_id'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        limit,
      });
      return json(data);
    },
  );

  // ── 7. list_hubspot_meetings_for_record ────────────────────────────────────
  server.tool(
    'list_hubspot_meetings_for_record',
    "List meetings linked to a record. Returns hs_meeting_title, hs_meeting_start_time, hs_meeting_outcome, owner. Useful for 'recent calls with this contact'.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets']),
      record_id: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object_type, record_id, limit }) => {
      const data = await call('POST', `/crm/objects/${VERSION}/meetings/search`, {
        filterGroups: [{ filters: [{ propertyName: `associations.${object_type.replace(/s$/, '')}`, operator: 'EQ', value: record_id }] }],
        properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_outcome', 'hubspot_owner_id'],
        sorts: [{ propertyName: 'hs_meeting_start_time', direction: 'DESCENDING' }],
        limit,
      });
      return json(data);
    },
  );

  // ── 8. list_hubspot_calls_for_record ───────────────────────────────────────
  server.tool(
    'list_hubspot_calls_for_record',
    "List calls (call engagements) linked to a record. Returns hs_call_title, hs_call_duration, hs_call_disposition, hs_timestamp. Useful for the 'last call' line.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets']),
      record_id: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object_type, record_id, limit }) => {
      const data = await call('POST', `/crm/objects/${VERSION}/calls/search`, {
        filterGroups: [{ filters: [{ propertyName: `associations.${object_type.replace(/s$/, '')}`, operator: 'EQ', value: record_id }] }],
        properties: ['hs_call_title', 'hs_call_body', 'hs_call_duration', 'hs_call_disposition', 'hs_call_status', 'hs_timestamp', 'hubspot_owner_id'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        limit,
      });
      return json(data);
    },
  );

  // ── 9. list_hubspot_emails_for_record ──────────────────────────────────────
  server.tool(
    'list_hubspot_emails_for_record',
    "List email engagements linked to a record. Returns hs_email_subject, hs_email_text, hs_email_status, hs_email_direction, hs_timestamp.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets']),
      record_id: z.string(),
      limit: z.number().int().min(1).max(100).optional().default(20),
    },
    async ({ object_type, record_id, limit }) => {
      const data = await call('POST', `/crm/objects/${VERSION}/emails/search`, {
        filterGroups: [{ filters: [{ propertyName: `associations.${object_type.replace(/s$/, '')}`, operator: 'EQ', value: record_id }] }],
        properties: ['hs_email_subject', 'hs_email_text', 'hs_email_status', 'hs_email_direction', 'hs_timestamp', 'hubspot_owner_id'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        limit,
      });
      return json(data);
    },
  );

  // ── 10. list_hubspot_pipelines ─────────────────────────────────────────────
  server.tool(
    'list_hubspot_pipelines',
    "List pipelines for a HubSpot object type (deals, tickets). Each pipeline has labelled stages with displayOrder + isClosed metadata — use to translate `dealstage` ids to human-readable names.",
    {
      object_type: z.enum(['deals', 'tickets']),
    },
    async ({ object_type }) => {
      const data = await call('GET', `/crm/pipelines/${VERSION}/pipelines/${object_type}`);
      return json(data);
    },
  );

  // ── 11. list_hubspot_owners ────────────────────────────────────────────────
  server.tool(
    'list_hubspot_owners',
    "List workspace owners (HubSpot users — AEs, CSMs, admins). Use to resolve a deal's `hubspot_owner_id` to a name/email.",
    {
      email: z.string().optional().describe('Filter by email'),
      limit: z.number().int().min(1).max(100).optional().default(50),
    },
    async ({ email, limit }) => {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (email) qs.set('email', email);
      const data = await call('GET', `/crm/owners/${VERSION}/owners?${qs.toString()}`);
      return json(data);
    },
  );

  // ── 12. list_hubspot_properties ────────────────────────────────────────────
  server.tool(
    'list_hubspot_properties',
    "List HubSpot properties (custom + system) for an object type. Use to discover MEDDPICC-style custom fields, deal stage, slip-history, etc.",
    {
      object_type: z.enum(['contacts', 'companies', 'deals', 'tickets', 'notes', 'tasks']),
    },
    async ({ object_type }) => {
      const data = await call('GET', `/crm/properties/${VERSION}/properties/${object_type}`);
      return json(data);
    },
  );

  // ── 13. get_hubspot_account_info ───────────────────────────────────────────
  server.tool(
    'get_hubspot_account_info',
    "Identify the HubSpot account behind the current access token. Returns portalId, accountType, timeZone, currency. Useful for grounding 'whose CRM am I reading'.",
    {},
    async () => {
      const data = await call('GET', `/account-info/${VERSION}/details`);
      return json(data);
    },
  );
}

export function createHubSpotMcpServer(baseUrl = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: meta.mcp.serverName,
    version: meta.mcp.serverVersion,
  });
  registerHubSpotTools(server, baseUrl);
  return server;
}

export async function startHubSpotMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL ?? 'http://localhost:4100';
  const server = createHubSpotMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
