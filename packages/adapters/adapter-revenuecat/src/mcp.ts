import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BP = '/revenuecat/v2';

function makeCall(baseUrl: string) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`RevenueCat mock error ${res.status}: ${text}`);
    }
    if (res.status === 204) return {};
    return res.json();
  };
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (e): e is [string, string | number] => e[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

function text(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }] };
}

function json(data: unknown) {
  return text(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Factory — RevenueCat MCP tools (Tier 2: PascalCase community convention)
// ---------------------------------------------------------------------------

export function registerRevenueCatTools(server: McpServer, baseUrl: string = 'http://localhost:4100'): void {
  const call = makeCall(baseUrl);

  // ── Projects ────────────────────────────────────────────────────

  server.tool('ListProjects', 'List RevenueCat projects', {}, async () => {
    const data = await call('GET', `${BP}/projects`) as any;
    if (!data.items?.length) return text('No projects found.');
    const lines = data.items.map((p: any) => `• ${p.id} — ${p.name}`);
    return text(`Projects (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetProject', 'Get a RevenueCat project by ID', {
    project_id: z.string().describe('Project ID'),
  }, async ({ project_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}`);
    return json(data);
  });

  // ── Offerings ───────────────────────────────────────────────────

  server.tool('CreateOffering', 'Create a RevenueCat offering', {
    project_id: z.string().describe('Project ID'),
    display_name: z.string().describe('Display name'),
    lookup_key: z.string().optional().describe('Lookup key'),
    is_current: z.boolean().optional().describe('Set as current offering'),
  }, async ({ project_id, ...rest }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/offerings`, rest) as any;
    return text(`Created offering ${data.id}: ${data.display_name}`);
  });

  server.tool('ListOfferings', 'List offerings for a project', {
    project_id: z.string().describe('Project ID'),
  }, async ({ project_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/offerings`) as any;
    if (!data.items?.length) return text('No offerings found.');
    const lines = data.items.map((o: any) => `• ${o.id} — ${o.display_name}${o.is_current ? ' (current)' : ''}`);
    return text(`Offerings (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetOffering', 'Get a RevenueCat offering by ID', {
    project_id: z.string().describe('Project ID'),
    offering_id: z.string().describe('Offering ID'),
  }, async ({ project_id, offering_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/offerings/${offering_id}`);
    return json(data);
  });

  server.tool('UpdateOffering', 'Update a RevenueCat offering', {
    project_id: z.string().describe('Project ID'),
    offering_id: z.string().describe('Offering ID'),
    display_name: z.string().optional().describe('Display name'),
    is_current: z.boolean().optional().describe('Set as current offering'),
  }, async ({ project_id, offering_id, ...rest }) => {
    await call('PATCH', `${BP}/projects/${project_id}/offerings/${offering_id}`, rest);
    return text(`Updated offering ${offering_id}`);
  });

  server.tool('DeleteOffering', 'Delete a RevenueCat offering', {
    project_id: z.string().describe('Project ID'),
    offering_id: z.string().describe('Offering ID'),
  }, async ({ project_id, offering_id }) => {
    await call('DELETE', `${BP}/projects/${project_id}/offerings/${offering_id}`);
    return text(`Deleted offering ${offering_id}`);
  });

  // ── Products ────────────────────────────────────────────────────

  server.tool('CreateProduct', 'Create a RevenueCat product', {
    project_id: z.string().describe('Project ID'),
    display_name: z.string().describe('Display name'),
    store_identifier: z.string().optional().describe('Store identifier'),
    type: z.enum(['subscription', 'non_consumable', 'consumable']).optional().describe('Product type'),
    app_id: z.string().optional().describe('App ID'),
  }, async ({ project_id, ...rest }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/products`, rest) as any;
    return text(`Created product ${data.id}: ${data.display_name}`);
  });

  server.tool('ListProducts', 'List products for a project', {
    project_id: z.string().describe('Project ID'),
  }, async ({ project_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/products`) as any;
    if (!data.items?.length) return text('No products found.');
    const lines = data.items.map((p: any) => `• ${p.id} — ${p.display_name} (${p.type})`);
    return text(`Products (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetProduct', 'Get a RevenueCat product by ID', {
    project_id: z.string().describe('Project ID'),
    product_id: z.string().describe('Product ID'),
  }, async ({ project_id, product_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/products/${product_id}`);
    return json(data);
  });

  server.tool('UpdateProduct', 'Update a RevenueCat product', {
    project_id: z.string().describe('Project ID'),
    product_id: z.string().describe('Product ID'),
    display_name: z.string().optional().describe('Display name'),
  }, async ({ project_id, product_id, ...rest }) => {
    await call('PATCH', `${BP}/projects/${project_id}/products/${product_id}`, rest);
    return text(`Updated product ${product_id}`);
  });

  server.tool('DeleteProduct', 'Delete a RevenueCat product', {
    project_id: z.string().describe('Project ID'),
    product_id: z.string().describe('Product ID'),
  }, async ({ project_id, product_id }) => {
    await call('DELETE', `${BP}/projects/${project_id}/products/${product_id}`);
    return text(`Deleted product ${product_id}`);
  });

  // ── Entitlements ────────────────────────────────────────────────

  server.tool('CreateEntitlement', 'Create a RevenueCat entitlement', {
    display_name: z.string().describe('Display name'),
    lookup_key: z.string().optional().describe('Lookup key'),
  }, async (params) => {
    const data = await call('POST', `${BP}/entitlements`, params) as any;
    return text(`Created entitlement ${data.id}: ${data.display_name}`);
  });

  server.tool('ListEntitlements', 'List RevenueCat entitlements', {}, async () => {
    const data = await call('GET', `${BP}/entitlements`) as any;
    if (!data.items?.length) return text('No entitlements found.');
    const lines = data.items.map((e: any) => `• ${e.id} — ${e.display_name}`);
    return text(`Entitlements (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetEntitlement', 'Get a RevenueCat entitlement by ID', {
    entitlement_id: z.string().describe('Entitlement ID'),
  }, async ({ entitlement_id }) => {
    const data = await call('GET', `${BP}/entitlements/${entitlement_id}`);
    return json(data);
  });

  server.tool('UpdateEntitlement', 'Update a RevenueCat entitlement', {
    entitlement_id: z.string().describe('Entitlement ID'),
    display_name: z.string().optional().describe('Display name'),
  }, async ({ entitlement_id, ...rest }) => {
    await call('PATCH', `${BP}/entitlements/${entitlement_id}`, rest);
    return text(`Updated entitlement ${entitlement_id}`);
  });

  server.tool('DeleteEntitlement', 'Delete a RevenueCat entitlement', {
    entitlement_id: z.string().describe('Entitlement ID'),
  }, async ({ entitlement_id }) => {
    await call('DELETE', `${BP}/entitlements/${entitlement_id}`);
    return text(`Deleted entitlement ${entitlement_id}`);
  });

  // ── Packages ────────────────────────────────────────────────────

  server.tool('CreatePackage', 'Create a RevenueCat package', {
    display_name: z.string().describe('Display name'),
    lookup_key: z.string().optional().describe('Lookup key'),
    position: z.number().int().optional().describe('Display position'),
  }, async (params) => {
    const data = await call('POST', `${BP}/packages`, params) as any;
    return text(`Created package ${data.id}: ${data.display_name}`);
  });

  server.tool('ListPackages', 'List RevenueCat packages', {}, async () => {
    const data = await call('GET', `${BP}/packages`) as any;
    if (!data.items?.length) return text('No packages found.');
    const lines = data.items.map((p: any) => `• ${p.id} — ${p.display_name}`);
    return text(`Packages (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetPackage', 'Get a RevenueCat package by ID', {
    package_id: z.string().describe('Package ID'),
  }, async ({ package_id }) => {
    const data = await call('GET', `${BP}/packages/${package_id}`);
    return json(data);
  });

  server.tool('UpdatePackage', 'Update a RevenueCat package', {
    package_id: z.string().describe('Package ID'),
    display_name: z.string().optional().describe('Display name'),
    position: z.number().int().optional().describe('Display position'),
  }, async ({ package_id, ...rest }) => {
    await call('PUT', `${BP}/packages/${package_id}`, rest);
    return text(`Updated package ${package_id}`);
  });

  server.tool('DeletePackage', 'Delete a RevenueCat package', {
    package_id: z.string().describe('Package ID'),
  }, async ({ package_id }) => {
    await call('DELETE', `${BP}/packages/${package_id}`);
    return text(`Deleted package ${package_id}`);
  });

  // ── Price Experiments ───────────────────────────────────────────

  server.tool('CreatePriceExperiment', 'Create a RevenueCat price experiment', {
    display_name: z.string().describe('Experiment name'),
    offering_id: z.string().optional().describe('Offering ID'),
    treatment_percentage: z.number().optional().describe('Treatment group percentage (0-100)'),
  }, async (params) => {
    const data = await call('POST', `${BP}/price-experiments`, params) as any;
    return text(`Created price experiment ${data.id}: ${data.display_name}`);
  });

  server.tool('ListPriceExperiments', 'List RevenueCat price experiments', {}, async () => {
    const data = await call('GET', `${BP}/price-experiments`) as any;
    if (!data.items?.length) return text('No price experiments found.');
    const lines = data.items.map((e: any) => `• ${e.id} — ${e.display_name} [${e.status}]`);
    return text(`Price experiments (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetPriceExperiment', 'Get a RevenueCat price experiment by ID', {
    experiment_id: z.string().describe('Experiment ID'),
  }, async ({ experiment_id }) => {
    const data = await call('GET', `${BP}/price-experiments/${experiment_id}`);
    return json(data);
  });

  server.tool('UpdatePriceExperiment', 'Update a RevenueCat price experiment', {
    experiment_id: z.string().describe('Experiment ID'),
    display_name: z.string().optional().describe('Experiment name'),
    treatment_percentage: z.number().optional().describe('Treatment percentage'),
  }, async ({ experiment_id, ...rest }) => {
    await call('PUT', `${BP}/price-experiments/${experiment_id}`, rest);
    return text(`Updated price experiment ${experiment_id}`);
  });

  server.tool('DeletePriceExperiment', 'Delete a RevenueCat price experiment', {
    experiment_id: z.string().describe('Experiment ID'),
  }, async ({ experiment_id }) => {
    await call('DELETE', `${BP}/price-experiments/${experiment_id}`);
    return text(`Deleted price experiment ${experiment_id}`);
  });

  // ── Customers ───────────────────────────────────────────────────

  server.tool('GetCustomer', 'Get a RevenueCat customer (subscriber)', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer/app user ID'),
  }, async ({ project_id, customer_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/customers/${customer_id}`);
    return json(data);
  });

  server.tool('DeleteCustomer', 'Delete a RevenueCat customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer/app user ID'),
  }, async ({ project_id, customer_id }) => {
    await call('DELETE', `${BP}/projects/${project_id}/customers/${customer_id}`);
    return text(`Deleted customer ${customer_id}`);
  });

  server.tool('GetCustomerActiveEntitlements', 'Get active entitlements for a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer/app user ID'),
  }, async ({ project_id, customer_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/customers/${customer_id}/active_entitlements`) as any;
    if (!data.items?.length) return text('No active entitlements.');
    return json(data);
  });

  server.tool('ListCustomerAliases', 'List aliases for a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer/app user ID'),
  }, async ({ project_id, customer_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/customers/${customer_id}/aliases`) as any;
    if (!data.items?.length) return text('No aliases found.');
    return json(data);
  });

  server.tool('SetCustomerAttributes', 'Set attributes on a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer/app user ID'),
    attributes: z.record(z.unknown()).describe('Attributes to set'),
  }, async ({ project_id, customer_id, attributes }) => {
    await call('POST', `${BP}/projects/${project_id}/customers/${customer_id}/attributes`, { attributes });
    return text(`Set attributes on customer ${customer_id}`);
  });

  // ── Purchases ───────────────────────────────────────────────────

  server.tool('ListPurchases', 'List purchases for a project', {
    project_id: z.string().describe('Project ID'),
  }, async ({ project_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/purchases`) as any;
    if (!data.items?.length) return text('No purchases found.');
    const lines = data.items.map((p: any) => `• ${p.id} — ${p.store} (${p.customer_id})`);
    return text(`Purchases (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetPurchase', 'Get a purchase by ID', {
    project_id: z.string().describe('Project ID'),
    purchase_id: z.string().describe('Purchase ID'),
  }, async ({ project_id, purchase_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/purchases/${purchase_id}`);
    return json(data);
  });

  server.tool('GrantGooglePurchase', 'Grant a Google Play purchase to a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer ID'),
    product_id: z.string().describe('Google product ID'),
    purchase_token: z.string().describe('Google purchase token'),
    is_sandbox: z.boolean().optional().describe('Sandbox purchase'),
  }, async ({ project_id, customer_id, ...rest }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/customers/${customer_id}/purchases/google`, rest) as any;
    return text(`Granted Google purchase ${data.id} to ${customer_id}`);
  });

  server.tool('GrantStripePurchase', 'Grant a Stripe purchase to a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer ID'),
    stripe_checkout_session_id: z.string().describe('Stripe checkout session ID'),
    is_sandbox: z.boolean().optional().describe('Sandbox purchase'),
  }, async ({ project_id, customer_id, ...rest }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/customers/${customer_id}/purchases/stripe`, rest) as any;
    return text(`Granted Stripe purchase ${data.id} to ${customer_id}`);
  });

  // ── Invoices ────────────────────────────────────────────────────

  server.tool('ListCustomerInvoices', 'List invoices for a customer', {
    project_id: z.string().describe('Project ID'),
    customer_id: z.string().describe('Customer ID'),
  }, async ({ project_id, customer_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/customers/${customer_id}/invoices`) as any;
    if (!data.items?.length) return text('No invoices found.');
    return json(data);
  });

  // ── Subscriptions ───────────────────────────────────────────────

  server.tool('ListSubscriptions', 'List subscriptions for a project', {
    project_id: z.string().describe('Project ID'),
  }, async ({ project_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/subscriptions`) as any;
    if (!data.items?.length) return text('No subscriptions found.');
    const lines = data.items.map((s: any) => `• ${s.id} — [${s.status}]`);
    return text(`Subscriptions (${data.items.length}):\n${lines.join('\n')}`);
  });

  server.tool('GetSubscription', 'Get a subscription by ID', {
    project_id: z.string().describe('Project ID'),
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ project_id, subscription_id }) => {
    const data = await call('GET', `${BP}/projects/${project_id}/subscriptions/${subscription_id}`);
    return json(data);
  });

  server.tool('CancelSubscription', 'Cancel a subscription', {
    project_id: z.string().describe('Project ID'),
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ project_id, subscription_id }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/subscriptions/${subscription_id}/cancel`) as any;
    return text(`Cancelled subscription ${subscription_id}`);
  });

  server.tool('RefundSubscription', 'Refund a subscription', {
    project_id: z.string().describe('Project ID'),
    subscription_id: z.string().describe('Subscription ID'),
  }, async ({ project_id, subscription_id }) => {
    const data = await call('POST', `${BP}/projects/${project_id}/subscriptions/${subscription_id}/refund`) as any;
    return text(`Refunded subscription ${subscription_id}`);
  });

  server.tool('DeferSubscription', 'Defer subscription billing', {
    project_id: z.string().describe('Project ID'),
    subscription_id: z.string().describe('Subscription ID'),
    expiry_time_ms: z.number().optional().describe('New expiry time in milliseconds'),
  }, async ({ project_id, subscription_id, ...rest }) => {
    await call('POST', `${BP}/projects/${project_id}/subscriptions/${subscription_id}/defer`, rest);
    return text(`Deferred subscription ${subscription_id}`);
  });
}

/**
 * Create a standalone Mimic MCP server for RevenueCat.
 */
export function createRevenueCatMcpServer(baseUrl: string = 'http://localhost:4100'): McpServer {
  const server = new McpServer({
    name: 'mimic-revenuecat',
    version: '0.5.0',
    description: 'Mimic MCP server for RevenueCat — mobile subscriptions, in-app purchases, entitlements, offerings',
  });
  registerRevenueCatTools(server, baseUrl);
  return server;
}

/**
 * Start the RevenueCat MCP server on stdio transport.
 */
export async function startRevenueCatMcpServer(): Promise<void> {
  const baseUrl = process.env.MIMIC_BASE_URL || 'http://localhost:4100';
  const server = createRevenueCatMcpServer(baseUrl);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Mimic RevenueCat MCP server running on stdio');
}
