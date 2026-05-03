/**
 * Default fixtures seeded into the StateStore on adapter start.
 *
 * Provides just-enough state for `/account-info`, the standard CRM pipelines
 * (contacts/companies/deals/tickets), the default deal stages, and a single
 * workspace owner — so an unseeded adapter still answers reasonably.
 */

import type { StateStore } from '@mimicai/core';
import type { HubSpotConfig } from '../config.js';
import { defaultOwner, defaultPipeline } from '../generated/schemas.js';
import { nsFor } from './_shared.js';

const DEFAULT_PORTAL_ID = 12345678;
const DEFAULT_PORTAL_NAME = 'Mimic Portal';
const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

const DEFAULT_DEAL_STAGES = [
  { id: 'appointmentscheduled', label: 'Appointment scheduled', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
  { id: 'qualifiedtobuy', label: 'Qualified to buy', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.4' } },
  { id: 'presentationscheduled', label: 'Presentation scheduled', displayOrder: 2, metadata: { isClosed: 'false', probability: '0.6' } },
  { id: 'decisionmakerboughtin', label: 'Decision maker bought-in', displayOrder: 3, metadata: { isClosed: 'false', probability: '0.7' } },
  { id: 'contractsent', label: 'Contract sent', displayOrder: 4, metadata: { isClosed: 'false', probability: '0.9' } },
  { id: 'closedwon', label: 'Closed won', displayOrder: 5, metadata: { isClosed: 'true', probability: '1.0' } },
  { id: 'closedlost', label: 'Closed lost', displayOrder: 6, metadata: { isClosed: 'true', probability: '0.0' } },
];

const DEFAULT_TICKET_STAGES = [
  { id: '1', label: 'New', displayOrder: 0, metadata: { ticketState: 'OPEN' } },
  { id: '2', label: 'Waiting on contact', displayOrder: 1, metadata: { ticketState: 'OPEN' } },
  { id: '3', label: 'Waiting on us', displayOrder: 2, metadata: { ticketState: 'OPEN' } },
  { id: '4', label: 'Closed', displayOrder: 3, metadata: { ticketState: 'CLOSED' } },
];

export function seedDefaultFixtures(store: StateStore, config?: HubSpotConfig): void {
  const portalId = config?.portalId ?? DEFAULT_PORTAL_ID;
  const portalName = config?.portalName ?? DEFAULT_PORTAL_NAME;
  const timeZone = config?.timeZone ?? DEFAULT_TIME_ZONE;

  // /account-info payload
  if (!store.get(nsFor('account_info'), 'self')) {
    store.set(nsFor('account_info'), 'self', {
      portalId,
      accountType: 'STANDARD',
      timeZone,
      companyCurrency: 'USD',
      additionalCurrencies: [],
      utcOffset: '-08:00',
      utcOffsetMilliseconds: -28800000,
      uiDomain: 'app.hubspot.com',
      dataHostingLocation: 'NA1',
      portalName,
    });
  }

  // Default sales pipeline. Routes for /crm/pipelines/{version}/{objectType}
  // use resource `crm_pipelines` — but the per-objectType filter happens via
  // the URL path param, not namespacing. We seed all pipelines into the
  // shared `hubspot:crm_pipelines` namespace and stamp `objectType` as a
  // property so the override (or a custom list filter) can split.
  if (!store.get(nsFor('crm_pipelines'), 'deals:default')) {
    store.set(
      nsFor('crm_pipelines'),
      'deals:default',
      defaultPipeline({
        id: 'default',
        objectType: 'deals',
        label: 'Sales Pipeline',
        displayOrder: 0,
        stages: DEFAULT_DEAL_STAGES,
      }),
    );
  }

  // Default support pipeline (tickets)
  if (!store.get(nsFor('crm_pipelines'), 'tickets:0')) {
    store.set(
      nsFor('crm_pipelines'),
      'tickets:0',
      defaultPipeline({
        id: '0',
        objectType: 'tickets',
        label: 'Support Pipeline',
        displayOrder: 0,
        stages: DEFAULT_TICKET_STAGES,
      }),
    );
  }

  // Bot owner — so /crm/owners/<version> returns at least one entry
  if (!store.get(nsFor('crm_owners'), 'bot')) {
    store.set(
      nsFor('crm_owners'),
      'bot',
      defaultOwner({
        id: 'bot',
        email: 'bot@mimic.example',
        firstName: 'Mimic',
        lastName: 'Bot',
        userId: 1,
      }),
    );
  }
}
