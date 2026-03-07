import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EndpointDefinition, ExpandedData } from '@mimicai/core';
import type { StateStore } from '@mimicai/core';
import { BaseApiMockAdapter, generateId } from '@mimicai/adapter-sdk';
import type { RevenueCatConfig } from './config.js';
import { notFound } from './revenuecat-errors.js';
import { registerRevenueCatTools } from './mcp.js';

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const NS = {
  projects: 'rc_projects',
  offerings: 'rc_offerings',
  products: 'rc_products',
  entitlements: 'rc_entitlements',
  packages: 'rc_packages',
  priceExperiments: 'rc_price_experiments',
  customers: 'rc_customers',
  customerAttributes: 'rc_customer_attributes',
  customerAliases: 'rc_customer_aliases',
  purchases: 'rc_purchases',
  invoices: 'rc_invoices',
  subscriptions: 'rc_subscriptions',
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/revenuecat/v2';

function rcId(prefix: string): string {
  return `${prefix}_${generateId('', 16)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  return isoNow();
}

function toProjectId(personaId: string): string {
  const slug = personaId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `proj_${slug || 'default'}`;
}

function ensureProject(
  store: StateStore,
  projectId: string,
  displayName: string,
  createdAt: string,
): void {
  const existing = store.get<Record<string, unknown>>(NS.projects, projectId);
  if (existing) return;

  store.set(NS.projects, projectId, {
    id: projectId,
    name: displayName,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

/** RevenueCat cursor pagination */
function paginateCursor<T>(items: T[], cursor?: string, limit: number = 20) {
  const startIdx = cursor ? parseInt(cursor, 10) : 0;
  const page = items.slice(startIdx, startIdx + limit);
  const nextIdx = startIdx + limit;
  return {
    items: page,
    next_cursor: nextIdx < items.length ? String(nextIdx) : null,
  };
}

// ---------------------------------------------------------------------------
// RevenueCat Adapter
// ---------------------------------------------------------------------------

export class RevenueCatAdapter extends BaseApiMockAdapter<RevenueCatConfig> {
  readonly id = 'revenuecat';
  readonly name = 'RevenueCat API';
  readonly basePath = '/revenuecat/v2';
  readonly versions = ['v2'];

  registerMcpTools(mcpServer: McpServer, mockBaseUrl: string): void {
    registerRevenueCatTools(mcpServer, mockBaseUrl);
  }

  resolvePersona(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const match = auth.match(/^Bearer\s+sk_test_([a-z0-9-]+)_/);
    return match ? match[1] : null;
  }

  async registerRoutes(
    server: FastifyInstance,
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): Promise<void> {
    this.seedFromApiResponses(data, store);

    // ── Projects ──────────────────────────────────────────────────────

    server.get(`${BP}/projects`, async (_req, reply) => {
      const projects = store.list(NS.projects);
      if (projects.length === 0) {
        // Return a default project
        const defaultProject = { id: 'proj_default', name: 'Default Project', created_at: isoNow() };
        store.set(NS.projects, defaultProject.id, defaultProject);
        return reply.code(200).send({ items: [defaultProject], next_cursor: null });
      }
      return reply.code(200).send({ items: projects, next_cursor: null });
    });

    server.get(`${BP}/projects/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      let project = store.get(NS.projects, id);
      if (!project) {
        // Auto-create project on first access
        project = { id, name: `Project ${id}`, created_at: isoNow() };
        store.set(NS.projects, id, project);
      }
      return reply.code(200).send(project);
    });

    // ── Offerings ─────────────────────────────────────────────────────

    server.post(`${BP}/projects/:projectId/offerings`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const offering = {
        id: rcId('ofr'),
        project_id: projectId,
        lookup_key: body.lookup_key ?? null,
        display_name: body.display_name ?? '',
        is_current: body.is_current ?? false,
        packages: [],
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.offerings, offering.id, offering);
      return reply.code(201).send(offering);
    });

    server.get(`${BP}/projects/:projectId/offerings`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const query = req.query as Record<string, string>;
      const offerings = store.filter<Record<string, unknown>>(NS.offerings, (o) => o.project_id === projectId);
      return reply.code(200).send(paginateCursor(offerings, query.cursor));
    });

    server.get(`${BP}/projects/:projectId/offerings/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const offering = store.get(NS.offerings, id);
      if (!offering) return reply.code(404).send(notFound('Offering', id));
      return reply.code(200).send(offering);
    });

    server.patch(`${BP}/projects/:projectId/offerings/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.offerings, id);
      if (!existing) return reply.code(404).send(notFound('Offering', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.offerings, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/projects/:projectId/offerings/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get(NS.offerings, id);
      if (!existing) return reply.code(404).send(notFound('Offering', id));
      store.delete(NS.offerings, id);
      return reply.code(204).send();
    });

    // ── Products ──────────────────────────────────────────────────────

    server.post(`${BP}/projects/:projectId/products`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const product = {
        id: rcId('prod'),
        project_id: projectId,
        store_identifier: body.store_identifier ?? null,
        type: body.type ?? 'subscription',
        display_name: body.display_name ?? '',
        app_id: body.app_id ?? null,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.products, product.id, product);
      return reply.code(201).send(product);
    });

    server.get(`${BP}/projects/:projectId/products`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const query = req.query as Record<string, string>;
      const products = store.filter<Record<string, unknown>>(NS.products, (p) => p.project_id === projectId);
      return reply.code(200).send(paginateCursor(products, query.cursor));
    });

    server.get(`${BP}/projects/:projectId/products/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const product = store.get(NS.products, id);
      if (!product) return reply.code(404).send(notFound('Product', id));
      return reply.code(200).send(product);
    });

    server.patch(`${BP}/projects/:projectId/products/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.products, id);
      if (!existing) return reply.code(404).send(notFound('Product', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.products, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/projects/:projectId/products/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get(NS.products, id);
      if (!existing) return reply.code(404).send(notFound('Product', id));
      store.delete(NS.products, id);
      return reply.code(204).send();
    });

    // ── Entitlements (global, not project-scoped) ─────────────────────

    server.post(`${BP}/entitlements`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const entitlement = {
        id: rcId('entl'),
        lookup_key: body.lookup_key ?? null,
        display_name: body.display_name ?? '',
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.entitlements, entitlement.id, entitlement);
      return reply.code(201).send(entitlement);
    });

    server.get(`${BP}/entitlements`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      const entitlements = store.list(NS.entitlements);
      return reply.code(200).send(paginateCursor(entitlements, query.cursor));
    });

    server.get(`${BP}/entitlements/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const entitlement = store.get(NS.entitlements, id);
      if (!entitlement) return reply.code(404).send(notFound('Entitlement', id));
      return reply.code(200).send(entitlement);
    });

    server.patch(`${BP}/entitlements/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.entitlements, id);
      if (!existing) return reply.code(404).send(notFound('Entitlement', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.entitlements, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/entitlements/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.entitlements, id);
      if (!existing) return reply.code(404).send(notFound('Entitlement', id));
      store.delete(NS.entitlements, id);
      return reply.code(204).send();
    });

    // ── Packages (global, not project-scoped) ─────────────────────────

    server.post(`${BP}/packages`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const pkg = {
        id: rcId('pkg'),
        lookup_key: body.lookup_key ?? null,
        display_name: body.display_name ?? '',
        position: body.position ?? null,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.packages, pkg.id, pkg);
      return reply.code(201).send(pkg);
    });

    server.get(`${BP}/packages`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      const packages = store.list(NS.packages);
      return reply.code(200).send(paginateCursor(packages, query.cursor));
    });

    server.get(`${BP}/packages/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const pkg = store.get(NS.packages, id);
      if (!pkg) return reply.code(404).send(notFound('Package', id));
      return reply.code(200).send(pkg);
    });

    server.put(`${BP}/packages/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.packages, id);
      if (!existing) return reply.code(404).send(notFound('Package', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.packages, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/packages/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.packages, id);
      if (!existing) return reply.code(404).send(notFound('Package', id));
      store.delete(NS.packages, id);
      return reply.code(204).send();
    });

    // ── Price Experiments ──────────────────────────────────────────────

    server.post(`${BP}/price-experiments`, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const experiment = {
        id: rcId('exp'),
        display_name: body.display_name ?? '',
        status: 'draft',
        treatment_percentage: body.treatment_percentage ?? 50,
        offering_id: body.offering_id ?? null,
        created_at: now,
        updated_at: now,
        ...body,
      };
      store.set(NS.priceExperiments, experiment.id, experiment);
      return reply.code(201).send(experiment);
    });

    server.get(`${BP}/price-experiments`, async (req, reply) => {
      const query = req.query as Record<string, string>;
      const experiments = store.list(NS.priceExperiments);
      return reply.code(200).send(paginateCursor(experiments, query.cursor));
    });

    server.get(`${BP}/price-experiments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const experiment = store.get(NS.priceExperiments, id);
      if (!experiment) return reply.code(404).send(notFound('Price experiment', id));
      return reply.code(200).send(experiment);
    });

    server.put(`${BP}/price-experiments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get<Record<string, unknown>>(NS.priceExperiments, id);
      if (!existing) return reply.code(404).send(notFound('Price experiment', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = { ...existing, ...body, updated_at: isoNow() };
      store.set(NS.priceExperiments, id, updated);
      return reply.code(200).send(updated);
    });

    server.delete(`${BP}/price-experiments/:id`, async (req, reply) => {
      const { id } = req.params as { id: string };
      const existing = store.get(NS.priceExperiments, id);
      if (!existing) return reply.code(404).send(notFound('Price experiment', id));
      store.delete(NS.priceExperiments, id);
      return reply.code(204).send();
    });

    // ── Customers ─────────────────────────────────────────────────────

    server.get(`${BP}/projects/:projectId/customers/:customerId`, async (req, reply) => {
      const { projectId, customerId } = req.params as { projectId: string; customerId: string };
      let customer = store.get<Record<string, unknown>>(NS.customers, customerId);
      if (!customer) {
        // Auto-create customer on first access (app user IDs are developer-defined)
        customer = {
          id: customerId,
          project_id: projectId,
          first_seen: isoNow(),
          last_seen: isoNow(),
          entitlements: {},
          subscriber_attributes: {},
        };
        store.set(NS.customers, customerId, customer);
      }
      return reply.code(200).send(customer);
    });

    server.delete(`${BP}/projects/:projectId/customers/:customerId`, async (req, reply) => {
      const { customerId } = req.params as { projectId: string; customerId: string };
      store.delete(NS.customers, customerId);
      return reply.code(204).send();
    });

    server.get(`${BP}/projects/:projectId/customers/:customerId/active_entitlements`, async (req, reply) => {
      const { customerId } = req.params as { projectId: string; customerId: string };
      const customer = store.get<Record<string, unknown>>(NS.customers, customerId);
      const entitlements = customer?.entitlements ?? {};
      return reply.code(200).send({ items: Object.values(entitlements), next_cursor: null });
    });

    server.get(`${BP}/projects/:projectId/customers/:customerId/aliases`, async (req, reply) => {
      const { customerId } = req.params as { projectId: string; customerId: string };
      const aliases = store.filter<Record<string, unknown>>(NS.customerAliases, (a) => a.customer_id === customerId);
      return reply.code(200).send({ items: aliases, next_cursor: null });
    });

    server.post(`${BP}/projects/:projectId/customers/:customerId/attributes`, async (req, reply) => {
      const { customerId } = req.params as { projectId: string; customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const customer = store.get<Record<string, unknown>>(NS.customers, customerId);
      if (customer) {
        const existing = (customer.subscriber_attributes ?? {}) as Record<string, unknown>;
        const updated = { ...customer, subscriber_attributes: { ...existing, ...body.attributes as Record<string, unknown> } };
        store.set(NS.customers, customerId, updated);
      }
      return reply.code(200).send({ subscriber_attributes: body.attributes });
    });

    // ── Purchases ─────────────────────────────────────────────────────

    server.get(`${BP}/projects/:projectId/purchases`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const query = req.query as Record<string, string>;
      const purchases = store.filter<Record<string, unknown>>(NS.purchases, (p) => p.project_id === projectId);
      return reply.code(200).send(paginateCursor(purchases, query.cursor));
    });

    server.get(`${BP}/projects/:projectId/purchases/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const purchase = store.get(NS.purchases, id);
      if (!purchase) return reply.code(404).send(notFound('Purchase', id));
      return reply.code(200).send(purchase);
    });

    server.post(`${BP}/projects/:projectId/customers/:customerId/purchases/google`, async (req, reply) => {
      const { projectId, customerId } = req.params as { projectId: string; customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const purchase = {
        id: rcId('purch'),
        project_id: projectId,
        customer_id: customerId,
        store: 'play_store',
        product_id: body.product_id ?? null,
        purchase_token: body.purchase_token ?? null,
        is_sandbox: body.is_sandbox ?? true,
        purchased_at: now,
        created_at: now,
        ...body,
      };
      store.set(NS.purchases, purchase.id, purchase);
      return reply.code(201).send(purchase);
    });

    server.post(`${BP}/projects/:projectId/customers/:customerId/purchases/stripe`, async (req, reply) => {
      const { projectId, customerId } = req.params as { projectId: string; customerId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;
      const now = isoNow();
      const purchase = {
        id: rcId('purch'),
        project_id: projectId,
        customer_id: customerId,
        store: 'stripe',
        stripe_checkout_session_id: body.stripe_checkout_session_id ?? null,
        is_sandbox: body.is_sandbox ?? true,
        purchased_at: now,
        created_at: now,
        ...body,
      };
      store.set(NS.purchases, purchase.id, purchase);
      return reply.code(201).send(purchase);
    });

    // ── Invoices ──────────────────────────────────────────────────────

    server.get(`${BP}/projects/:projectId/customers/:customerId/invoices`, async (req, reply) => {
      const { customerId } = req.params as { projectId: string; customerId: string };
      const query = req.query as Record<string, string>;
      const invoices = store.filter<Record<string, unknown>>(NS.invoices, (i) => i.customer_id === customerId);
      return reply.code(200).send(paginateCursor(invoices, query.cursor));
    });

    // ── Subscriptions ─────────────────────────────────────────────────

    server.get(`${BP}/projects/:projectId/subscriptions`, async (req, reply) => {
      const { projectId } = req.params as { projectId: string };
      const query = req.query as Record<string, string>;
      const subs = store.filter<Record<string, unknown>>(NS.subscriptions, (s) => s.project_id === projectId);
      return reply.code(200).send(paginateCursor(subs, query.cursor));
    });

    server.get(`${BP}/projects/:projectId/subscriptions/:id`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const sub = store.get(NS.subscriptions, id);
      if (!sub) return reply.code(404).send(notFound('Subscription', id));
      return reply.code(200).send(sub);
    });

    server.post(`${BP}/projects/:projectId/subscriptions/:id/cancel`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'cancelled', cancelled_at: isoNow(), updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.post(`${BP}/projects/:projectId/subscriptions/:id/refund`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const updated = { ...existing, status: 'refunded', refunded_at: isoNow(), updated_at: isoNow() };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });

    server.post(`${BP}/projects/:projectId/subscriptions/:id/defer`, async (req, reply) => {
      const { id } = req.params as { projectId: string; id: string };
      const existing = store.get<Record<string, unknown>>(NS.subscriptions, id);
      if (!existing) return reply.code(404).send(notFound('Subscription', id));
      const body = (req.body ?? {}) as Record<string, unknown>;
      const updated = {
        ...existing,
        expiration_at_date: body.expiry_time_ms ? new Date(Number(body.expiry_time_ms)).toISOString() : existing.expiration_at_date,
        updated_at: isoNow(),
      };
      store.set(NS.subscriptions, id, updated);
      return reply.code(200).send(updated);
    });
  }

  getEndpoints(): EndpointDefinition[] {
    return [
      // Projects
      { method: 'GET', path: `${BP}/projects`, description: 'List projects' },
      { method: 'GET', path: `${BP}/projects/:id`, description: 'Get project' },

      // Offerings
      { method: 'POST', path: `${BP}/projects/:projectId/offerings`, description: 'Create offering' },
      { method: 'GET', path: `${BP}/projects/:projectId/offerings`, description: 'List offerings' },
      { method: 'GET', path: `${BP}/projects/:projectId/offerings/:id`, description: 'Get offering' },
      { method: 'PATCH', path: `${BP}/projects/:projectId/offerings/:id`, description: 'Update offering' },
      { method: 'DELETE', path: `${BP}/projects/:projectId/offerings/:id`, description: 'Delete offering' },

      // Products
      { method: 'POST', path: `${BP}/projects/:projectId/products`, description: 'Create product' },
      { method: 'GET', path: `${BP}/projects/:projectId/products`, description: 'List products' },
      { method: 'GET', path: `${BP}/projects/:projectId/products/:id`, description: 'Get product' },
      { method: 'PATCH', path: `${BP}/projects/:projectId/products/:id`, description: 'Update product' },
      { method: 'DELETE', path: `${BP}/projects/:projectId/products/:id`, description: 'Delete product' },

      // Entitlements
      { method: 'POST', path: `${BP}/entitlements`, description: 'Create entitlement' },
      { method: 'GET', path: `${BP}/entitlements`, description: 'List entitlements' },
      { method: 'GET', path: `${BP}/entitlements/:id`, description: 'Get entitlement' },
      { method: 'PATCH', path: `${BP}/entitlements/:id`, description: 'Update entitlement' },
      { method: 'DELETE', path: `${BP}/entitlements/:id`, description: 'Delete entitlement' },

      // Packages
      { method: 'POST', path: `${BP}/packages`, description: 'Create package' },
      { method: 'GET', path: `${BP}/packages`, description: 'List packages' },
      { method: 'GET', path: `${BP}/packages/:id`, description: 'Get package' },
      { method: 'PUT', path: `${BP}/packages/:id`, description: 'Update package' },
      { method: 'DELETE', path: `${BP}/packages/:id`, description: 'Delete package' },

      // Price Experiments
      { method: 'POST', path: `${BP}/price-experiments`, description: 'Create price experiment' },
      { method: 'GET', path: `${BP}/price-experiments`, description: 'List price experiments' },
      { method: 'GET', path: `${BP}/price-experiments/:id`, description: 'Get price experiment' },
      { method: 'PUT', path: `${BP}/price-experiments/:id`, description: 'Update price experiment' },
      { method: 'DELETE', path: `${BP}/price-experiments/:id`, description: 'Delete price experiment' },

      // Customers
      { method: 'GET', path: `${BP}/projects/:projectId/customers/:customerId`, description: 'Get customer' },
      { method: 'DELETE', path: `${BP}/projects/:projectId/customers/:customerId`, description: 'Delete customer' },
      { method: 'GET', path: `${BP}/projects/:projectId/customers/:customerId/active_entitlements`, description: 'Get active entitlements' },
      { method: 'GET', path: `${BP}/projects/:projectId/customers/:customerId/aliases`, description: 'List customer aliases' },
      { method: 'POST', path: `${BP}/projects/:projectId/customers/:customerId/attributes`, description: 'Set customer attributes' },

      // Purchases
      { method: 'GET', path: `${BP}/projects/:projectId/purchases`, description: 'List purchases' },
      { method: 'GET', path: `${BP}/projects/:projectId/purchases/:id`, description: 'Get purchase' },
      { method: 'POST', path: `${BP}/projects/:projectId/customers/:customerId/purchases/google`, description: 'Grant Google purchase' },
      { method: 'POST', path: `${BP}/projects/:projectId/customers/:customerId/purchases/stripe`, description: 'Grant Stripe purchase' },

      // Invoices
      { method: 'GET', path: `${BP}/projects/:projectId/customers/:customerId/invoices`, description: 'List customer invoices' },

      // Subscriptions
      { method: 'GET', path: `${BP}/projects/:projectId/subscriptions`, description: 'List subscriptions' },
      { method: 'GET', path: `${BP}/projects/:projectId/subscriptions/:id`, description: 'Get subscription' },
      { method: 'POST', path: `${BP}/projects/:projectId/subscriptions/:id/cancel`, description: 'Cancel subscription' },
      { method: 'POST', path: `${BP}/projects/:projectId/subscriptions/:id/refund`, description: 'Refund subscription' },
      { method: 'POST', path: `${BP}/projects/:projectId/subscriptions/:id/defer`, description: 'Defer subscription billing' },
    ];
  }

  // ── Cross-surface seeding ───────────────────────────────────────────────

  private readonly RESOURCE_NS: Record<string, string> = {
    projects: NS.projects,
    offerings: NS.offerings,
    products: NS.products,
    entitlements: NS.entitlements,
    packages: NS.packages,
    price_experiments: NS.priceExperiments,
    customers: NS.customers,
    purchases: NS.purchases,
    invoices: NS.invoices,
    subscriptions: NS.subscriptions,
  };

  private seedFromApiResponses(
    data: Map<string, ExpandedData>,
    store: StateStore,
  ): void {
    for (const [, expanded] of data) {
      const rcData = expanded.apiResponses?.revenuecat;
      if (!rcData) continue;

      const projectId = toProjectId(expanded.personaId);
      const projectName = `${expanded.personaId} RevenueCat`;

      for (const [resourceType, responses] of Object.entries(rcData.responses)) {
        if (resourceType === 'offerings') {
          for (const response of responses) {
            const body = response.body as Record<string, unknown>;
            const offeringId =
              typeof body.id === 'string'
                ? body.id
                : typeof body.identifier === 'string'
                  ? body.identifier
                  : null;
            if (!offeringId) continue;

            const createdAt = toIsoTimestamp(body.created_at ?? body.created);
            const resolvedProjectId =
              typeof body.project_id === 'string' ? body.project_id : projectId;

            ensureProject(store, resolvedProjectId, projectName, createdAt);

            const packages = Array.isArray(body.packages) ? body.packages : [];
            const enriched = {
              id: offeringId,
              project_id: resolvedProjectId,
              display_name:
                body.display_name ??
                body.description ??
                body.identifier ??
                offeringId,
              lookup_key: body.lookup_key ?? body.identifier ?? null,
              is_current: body.is_current ?? body.identifier === 'default',
              packages,
              created_at: createdAt,
              updated_at: toIsoTimestamp(body.updated_at ?? body.created_at ?? body.created),
              ...body,
            };

            store.set(NS.offerings, offeringId, enriched);

            for (const pkg of packages) {
              if (typeof pkg !== 'object' || !pkg) continue;
              const packageData = pkg as Record<string, unknown>;
              const packageId =
                typeof packageData.id === 'string'
                  ? packageData.id
                  : typeof packageData.identifier === 'string'
                    ? packageData.identifier
                    : null;
              if (packageId) {
                store.set(NS.packages, packageId, {
                  id: packageId,
                  offering_id: offeringId,
                  display_name:
                    packageData.display_name ??
                    packageData.identifier ??
                    packageId,
                  lookup_key: packageData.lookup_key ?? packageData.identifier ?? null,
                  created_at: createdAt,
                  updated_at: createdAt,
                  ...packageData,
                });
              }

              const productId =
                typeof packageData.platform_product_identifier === 'string'
                  ? packageData.platform_product_identifier
                  : typeof packageData.product_id === 'string'
                    ? packageData.product_id
                    : null;
              if (productId) {
                store.set(NS.products, productId, {
                  id: productId,
                  project_id: resolvedProjectId,
                  type: 'subscription',
                  display_name: productId,
                  store_identifier: productId,
                  created_at: createdAt,
                  updated_at: createdAt,
                });
              }
            }
          }
          continue;
        }

        if (resourceType === 'subscribers') {
          for (const response of responses) {
            const body = response.body as Record<string, unknown>;
            const customerId =
              typeof body.id === 'string'
                ? body.id
                : typeof body.original_app_user_id === 'string'
                  ? body.original_app_user_id
                  : null;
            if (!customerId) continue;

            const createdAt = toIsoTimestamp(body.created_at ?? body.created);
            const resolvedProjectId =
              typeof body.project_id === 'string' ? body.project_id : projectId;
            const entitlements =
              typeof body.entitlements === 'object' && body.entitlements
                ? (body.entitlements as Record<string, unknown>)
                : {};

            ensureProject(store, resolvedProjectId, projectName, createdAt);

            store.set(NS.customers, customerId, {
              id: customerId,
              project_id: resolvedProjectId,
              original_app_user_id: customerId,
              first_seen: createdAt,
              last_seen: toIsoTimestamp(body.last_seen ?? body.updated_at ?? body.created_at ?? body.created),
              entitlements,
              subscriber_attributes:
                typeof body.subscriber_attributes === 'object' && body.subscriber_attributes
                  ? body.subscriber_attributes
                  : {},
              created_at: createdAt,
              updated_at: toIsoTimestamp(body.updated_at ?? body.created_at ?? body.created),
              ...body,
            });

            for (const [entitlementId, entitlementValue] of Object.entries(entitlements)) {
              const entitlement =
                typeof entitlementValue === 'object' && entitlementValue
                  ? (entitlementValue as Record<string, unknown>)
                  : {};
              const productId =
                typeof entitlement.product_identifier === 'string'
                  ? entitlement.product_identifier
                  : null;
              const subscriptionId = `sub_${customerId}_${entitlementId}`;

              store.set(NS.entitlements, entitlementId, {
                id: entitlementId,
                lookup_key: entitlementId,
                display_name: entitlementId,
                created_at: createdAt,
                updated_at: createdAt,
              });

              store.set(NS.subscriptions, subscriptionId, {
                id: subscriptionId,
                project_id: resolvedProjectId,
                customer_id: customerId,
                entitlement_id: entitlementId,
                product_id: productId,
                store: entitlement.store ?? null,
                status: 'active',
                current_period_started_at: createdAt,
                created_at: createdAt,
                updated_at: createdAt,
              });

              if (productId) {
                store.set(NS.products, productId, {
                  id: productId,
                  project_id: resolvedProjectId,
                  type: 'subscription',
                  display_name: productId,
                  store_identifier: productId,
                  created_at: createdAt,
                  updated_at: createdAt,
                });
              }
            }
          }
          continue;
        }

        const namespace = this.RESOURCE_NS[resourceType];
        if (!namespace) continue;

        for (const response of responses) {
          const body = response.body as Record<string, unknown>;
          if (!body.id) continue;

          const createdAt = toIsoTimestamp(body.created_at ?? body.created);
          const updatedAt = toIsoTimestamp(
            body.updated_at ?? body.created_at ?? body.created,
          );
          const resolvedProjectId =
            resourceType === 'projects'
              ? String(body.id)
              : typeof body.project_id === 'string'
                ? body.project_id
                : projectId;

          if (
            resourceType === 'projects' ||
            resourceType === 'offerings' ||
            resourceType === 'products' ||
            resourceType === 'customers' ||
            resourceType === 'subscriptions' ||
            resourceType === 'purchases'
          ) {
            ensureProject(
              store,
              resolvedProjectId,
              projectName,
              createdAt,
            );
          }

          const enriched = {
            project_id:
              resourceType === 'projects' ? undefined : resolvedProjectId,
            created_at: createdAt,
            updated_at: updatedAt,
            ...body,
          };

          store.set(namespace, String(body.id), enriched);
        }
      }
    }
  }
}
