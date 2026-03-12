#!/usr/bin/env node
/**
 * Lemon Squeezy → Mimic codegen
 *
 * Since Lemon Squeezy has no official OpenAPI spec, this codegen embeds all
 * resource definitions directly (scraped from https://docs.lemonsqueezy.com/api).
 *
 * Generates four TypeScript source files into src/generated/:
 *
 *   resource-specs.ts  – AdapterResourceSpecs for all resources
 *   schemas.ts         – defaultXxx() factory functions
 *   routes.ts          – GeneratedRoute[] for all endpoints
 *   meta.ts            – version + generated timestamp
 *
 * Lemon Squeezy-specific patterns:
 *   - JSON:API response format: { data: { type, id, attributes, relationships } }
 *   - Page-based pagination: page[number], page[size]
 *   - PATCH for updates (not PUT/POST)
 *   - DELETE returns 204 No Content
 *   - Hyphenated resource types (order-items, license-keys)
 *   - Bearer token auth
 *   - All amounts in cents (integers)
 *   - ISO 8601 timestamps
 *
 * Usage:
 *   pnpm --filter @mimicai/adapter-lemonsqueezy generate
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '../src/generated');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array';

interface FieldDef {
  type: FieldType;
  nullable?: boolean;
  description?: string;
  enum?: string[];
  isAmount?: boolean;
  isTimestamp?: boolean;
  default?: unknown;
}

interface EndpointDef {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;  // e.g. /v1/stores/:id
  operation: 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';
  description: string;
  idParam?: string;
  queryFilters?: string[];
}

interface ResourceDef {
  type: string;           // JSON:API type, e.g. 'stores'
  resourceKey: string;    // StateStore key, e.g. 'stores'
  idPrefix: string;       // For mock ID generation
  volumeHint: 'entity' | 'reference' | 'skip';
  attributes: Record<string, FieldDef>;
  relationships: string[];
  endpoints: EndpointDef[];
}

// ---------------------------------------------------------------------------
// Resource definitions (from Lemon Squeezy docs)
// ---------------------------------------------------------------------------

const RESOURCES: ResourceDef[] = [
  // ── Users ──────────────────────────────────────────────────────────────
  {
    type: 'users',
    resourceKey: 'users',
    idPrefix: '',
    volumeHint: 'skip',
    attributes: {
      name: { type: 'string' },
      email: { type: 'string' },
      color: { type: 'string', default: '#898FA9' },
      avatar_url: { type: 'string' },
      has_custom_avatar: { type: 'boolean', default: false },
      createdAt: { type: 'string', isTimestamp: true },
      updatedAt: { type: 'string', isTimestamp: true },
    },
    relationships: [],
    endpoints: [
      { method: 'GET', path: '/v1/users/me', operation: 'retrieve', description: 'Retrieve the authenticated user', idParam: 'me' },
    ],
  },

  // ── Stores ─────────────────────────────────────────────────────────────
  {
    type: 'stores',
    resourceKey: 'stores',
    idPrefix: 'store_',
    volumeHint: 'reference',
    attributes: {
      name: { type: 'string' },
      slug: { type: 'string' },
      domain: { type: 'string' },
      url: { type: 'string' },
      avatar_url: { type: 'string' },
      plan: { type: 'string', default: 'fresh' },
      country: { type: 'string', default: 'US' },
      country_nicename: { type: 'string', default: 'United States' },
      currency: { type: 'string', default: 'USD' },
      total_sales: { type: 'integer', default: 0 },
      total_revenue: { type: 'integer', default: 0, isAmount: true },
      thirty_day_sales: { type: 'integer', default: 0 },
      thirty_day_revenue: { type: 'integer', default: 0, isAmount: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['products', 'orders', 'subscriptions', 'discounts', 'license-keys', 'webhooks'],
    endpoints: [
      { method: 'GET', path: '/v1/stores/:id', operation: 'retrieve', description: 'Retrieve a store', idParam: 'id' },
      { method: 'GET', path: '/v1/stores', operation: 'list', description: 'List all stores' },
    ],
  },

  // ── Customers ──────────────────────────────────────────────────────────
  {
    type: 'customers',
    resourceKey: 'customers',
    idPrefix: 'cust_',
    volumeHint: 'entity',
    attributes: {
      store_id: { type: 'integer' },
      name: { type: 'string' },
      email: { type: 'string' },
      status: { type: 'string', enum: ['subscribed', 'unsubscribed', 'archived', 'requires_verification', 'invalid_email', 'bounced'], default: 'subscribed' },
      city: { type: 'string', nullable: true },
      region: { type: 'string', nullable: true },
      country: { type: 'string', nullable: true },
      total_revenue_currency: { type: 'integer', default: 0, isAmount: true },
      mrr: { type: 'integer', default: 0, isAmount: true },
      status_formatted: { type: 'string', default: 'Subscribed' },
      country_formatted: { type: 'string', nullable: true },
      total_revenue_currency_formatted: { type: 'string', default: '$0.00' },
      mrr_formatted: { type: 'string', default: '$0.00' },
      urls: { type: 'object', default: { customer_portal: null } },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'orders', 'subscriptions', 'license-keys'],
    endpoints: [
      { method: 'POST', path: '/v1/customers', operation: 'create', description: 'Create a customer' },
      { method: 'GET', path: '/v1/customers/:id', operation: 'retrieve', description: 'Retrieve a customer', idParam: 'id' },
      { method: 'PATCH', path: '/v1/customers/:id', operation: 'update', description: 'Update a customer', idParam: 'id' },
      { method: 'GET', path: '/v1/customers', operation: 'list', description: 'List all customers', queryFilters: ['store_id', 'email'] },
    ],
  },

  // ── Products ───────────────────────────────────────────────────────────
  {
    type: 'products',
    resourceKey: 'products',
    idPrefix: 'prod_',
    volumeHint: 'reference',
    attributes: {
      store_id: { type: 'integer' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string', default: '' },
      status: { type: 'string', enum: ['draft', 'published'], default: 'published' },
      status_formatted: { type: 'string', default: 'Published' },
      thumb_url: { type: 'string', nullable: true },
      large_thumb_url: { type: 'string', nullable: true },
      price: { type: 'integer', default: 0, isAmount: true },
      price_formatted: { type: 'string', default: '$0.00' },
      from_price: { type: 'integer', nullable: true, isAmount: true },
      from_price_formatted: { type: 'string', nullable: true },
      to_price: { type: 'integer', nullable: true, isAmount: true },
      to_price_formatted: { type: 'string', nullable: true },
      pay_what_you_want: { type: 'boolean', default: false },
      buy_now_url: { type: 'string' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'variants'],
    endpoints: [
      { method: 'GET', path: '/v1/products/:id', operation: 'retrieve', description: 'Retrieve a product', idParam: 'id' },
      { method: 'GET', path: '/v1/products', operation: 'list', description: 'List all products', queryFilters: ['store_id'] },
    ],
  },

  // ── Variants ───────────────────────────────────────────────────────────
  {
    type: 'variants',
    resourceKey: 'variants',
    idPrefix: 'var_',
    volumeHint: 'reference',
    attributes: {
      product_id: { type: 'integer' },
      name: { type: 'string' },
      slug: { type: 'string' },
      description: { type: 'string', default: '' },
      has_license_keys: { type: 'boolean', default: false },
      license_activation_limit: { type: 'integer', default: 5 },
      is_license_limit_unlimited: { type: 'boolean', default: false },
      license_length_value: { type: 'integer', default: 1 },
      license_length_unit: { type: 'string', enum: ['days', 'months', 'years'], default: 'years' },
      is_license_length_unlimited: { type: 'boolean', default: false },
      sort: { type: 'integer', default: 0 },
      status: { type: 'string', enum: ['pending', 'draft', 'published'], default: 'published' },
      status_formatted: { type: 'string', default: 'Published' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['product', 'files', 'price-model'],
    endpoints: [
      { method: 'GET', path: '/v1/variants/:id', operation: 'retrieve', description: 'Retrieve a variant', idParam: 'id' },
      { method: 'GET', path: '/v1/variants', operation: 'list', description: 'List all variants', queryFilters: ['product_id', 'status'] },
    ],
  },

  // ── Prices ─────────────────────────────────────────────────────────────
  {
    type: 'prices',
    resourceKey: 'prices',
    idPrefix: 'pri_',
    volumeHint: 'reference',
    attributes: {
      variant_id: { type: 'integer' },
      category: { type: 'string', enum: ['one_time', 'subscription', 'lead_magnet', 'pwyw'], default: 'one_time' },
      scheme: { type: 'string', enum: ['standard', 'package', 'graduated', 'volume'], default: 'standard' },
      usage_aggregation: { type: 'string', nullable: true, enum: ['sum', 'last_during_period', 'last_ever', 'max'] },
      unit_price: { type: 'integer', nullable: true, isAmount: true },
      unit_price_decimal: { type: 'string', nullable: true },
      setup_fee_enabled: { type: 'boolean', nullable: true },
      setup_fee: { type: 'integer', nullable: true, isAmount: true },
      package_size: { type: 'integer', default: 1 },
      tiers: { type: 'array', nullable: true },
      renewal_interval_unit: { type: 'string', nullable: true, enum: ['day', 'week', 'month', 'year'] },
      renewal_interval_quantity: { type: 'integer', nullable: true },
      trial_interval_unit: { type: 'string', nullable: true, enum: ['day', 'week', 'month', 'year'] },
      trial_interval_quantity: { type: 'integer', nullable: true },
      min_price: { type: 'integer', nullable: true, isAmount: true },
      suggested_price: { type: 'integer', nullable: true, isAmount: true },
      tax_code: { type: 'string', enum: ['eservice', 'ebook', 'saas'], default: 'eservice' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['variant', 'subscription-items', 'usage-records'],
    endpoints: [
      { method: 'GET', path: '/v1/prices/:id', operation: 'retrieve', description: 'Retrieve a price', idParam: 'id' },
      { method: 'GET', path: '/v1/prices', operation: 'list', description: 'List all prices', queryFilters: ['variant_id'] },
    ],
  },

  // ── Orders ─────────────────────────────────────────────────────────────
  {
    type: 'orders',
    resourceKey: 'orders',
    idPrefix: 'ord_',
    volumeHint: 'entity',
    attributes: {
      store_id: { type: 'integer' },
      customer_id: { type: 'integer' },
      identifier: { type: 'string' },
      order_number: { type: 'integer', default: 1 },
      user_name: { type: 'string' },
      user_email: { type: 'string' },
      currency: { type: 'string', default: 'USD' },
      currency_rate: { type: 'string', default: '1.0000' },
      subtotal: { type: 'integer', default: 0, isAmount: true },
      setup_fee: { type: 'integer', default: 0, isAmount: true },
      discount_total: { type: 'integer', default: 0, isAmount: true },
      tax: { type: 'integer', default: 0, isAmount: true },
      total: { type: 'integer', default: 0, isAmount: true },
      refunded_amount: { type: 'integer', default: 0, isAmount: true },
      subtotal_usd: { type: 'integer', default: 0, isAmount: true },
      setup_fee_usd: { type: 'integer', default: 0, isAmount: true },
      discount_total_usd: { type: 'integer', default: 0, isAmount: true },
      tax_usd: { type: 'integer', default: 0, isAmount: true },
      total_usd: { type: 'integer', default: 0, isAmount: true },
      refunded_amount_usd: { type: 'integer', default: 0, isAmount: true },
      tax_name: { type: 'string', nullable: true },
      tax_rate: { type: 'string', default: '0.00' },
      tax_inclusive: { type: 'boolean', default: false },
      status: { type: 'string', enum: ['pending', 'failed', 'paid', 'refunded', 'partial_refund', 'fraudulent'], default: 'paid' },
      status_formatted: { type: 'string', default: 'Paid' },
      refunded: { type: 'boolean', default: false },
      refunded_at: { type: 'string', nullable: true, isTimestamp: true },
      subtotal_formatted: { type: 'string', default: '$0.00' },
      setup_fee_formatted: { type: 'string', default: '$0.00' },
      discount_total_formatted: { type: 'string', default: '$0.00' },
      tax_formatted: { type: 'string', default: '$0.00' },
      total_formatted: { type: 'string', default: '$0.00' },
      refunded_amount_formatted: { type: 'string', default: '$0.00' },
      first_order_item: { type: 'object', nullable: true },
      urls: { type: 'object', default: { receipt: null } },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'customer', 'order-items', 'subscriptions', 'license-keys', 'discount-redemptions'],
    endpoints: [
      { method: 'POST', path: '/v1/orders', operation: 'create', description: 'Create an order (mock)' },
      { method: 'GET', path: '/v1/orders/:id', operation: 'retrieve', description: 'Retrieve an order', idParam: 'id' },
      { method: 'GET', path: '/v1/orders', operation: 'list', description: 'List all orders', queryFilters: ['store_id', 'user_email'] },
    ],
  },

  // ── Subscriptions ──────────────────────────────────────────────────────
  {
    type: 'subscriptions',
    resourceKey: 'subscriptions',
    idPrefix: 'sub_',
    volumeHint: 'entity',
    attributes: {
      store_id: { type: 'integer' },
      customer_id: { type: 'integer' },
      order_id: { type: 'integer' },
      order_item_id: { type: 'integer' },
      product_id: { type: 'integer' },
      variant_id: { type: 'integer' },
      product_name: { type: 'string' },
      variant_name: { type: 'string' },
      user_name: { type: 'string' },
      user_email: { type: 'string' },
      status: { type: 'string', enum: ['on_trial', 'active', 'paused', 'past_due', 'unpaid', 'cancelled', 'expired'], default: 'active' },
      status_formatted: { type: 'string', default: 'Active' },
      card_brand: { type: 'string', nullable: true },
      card_last_four: { type: 'string', nullable: true },
      payment_processor: { type: 'string', default: 'stripe' },
      pause: { type: 'object', nullable: true },
      cancelled: { type: 'boolean', default: false },
      trial_ends_at: { type: 'string', nullable: true, isTimestamp: true },
      billing_anchor: { type: 'integer', default: 1 },
      first_subscription_item: { type: 'object', nullable: true },
      urls: { type: 'object', default: { update_payment_method: '', customer_portal: '', update_customer_portal: '' } },
      renews_at: { type: 'string', isTimestamp: true },
      ends_at: { type: 'string', nullable: true, isTimestamp: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'customer', 'order', 'order-item', 'product', 'variant', 'subscription-invoices', 'subscription-items'],
    endpoints: [
      { method: 'POST', path: '/v1/subscriptions', operation: 'create', description: 'Create a subscription (mock — real LS creates via checkout)' },
      { method: 'GET', path: '/v1/subscriptions/:id', operation: 'retrieve', description: 'Retrieve a subscription', idParam: 'id' },
      { method: 'PATCH', path: '/v1/subscriptions/:id', operation: 'update', description: 'Update a subscription', idParam: 'id' },
      { method: 'DELETE', path: '/v1/subscriptions/:id', operation: 'delete', description: 'Cancel a subscription', idParam: 'id' },
      { method: 'GET', path: '/v1/subscriptions', operation: 'list', description: 'List all subscriptions', queryFilters: ['store_id', 'order_id', 'order_item_id', 'product_id', 'variant_id', 'user_email', 'status'] },
    ],
  },

  // ── Discounts ──────────────────────────────────────────────────────────
  {
    type: 'discounts',
    resourceKey: 'discounts',
    idPrefix: 'dsc_',
    volumeHint: 'reference',
    attributes: {
      store_id: { type: 'integer' },
      name: { type: 'string' },
      code: { type: 'string' },
      amount: { type: 'integer', default: 0, isAmount: true },
      amount_type: { type: 'string', enum: ['percent', 'fixed'], default: 'percent' },
      is_limited_to_products: { type: 'boolean', default: false },
      is_limited_redemptions: { type: 'boolean', default: false },
      max_redemptions: { type: 'integer', default: 0 },
      starts_at: { type: 'string', nullable: true, isTimestamp: true },
      expires_at: { type: 'string', nullable: true, isTimestamp: true },
      duration: { type: 'string', enum: ['once', 'repeating', 'forever'], default: 'once' },
      duration_in_months: { type: 'integer', default: 0 },
      status: { type: 'string', enum: ['draft', 'published'], default: 'published' },
      status_formatted: { type: 'string', default: 'Published' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'discount-redemptions', 'variants'],
    endpoints: [
      { method: 'POST', path: '/v1/discounts', operation: 'create', description: 'Create a discount' },
      { method: 'GET', path: '/v1/discounts/:id', operation: 'retrieve', description: 'Retrieve a discount', idParam: 'id' },
      { method: 'DELETE', path: '/v1/discounts/:id', operation: 'delete', description: 'Delete a discount', idParam: 'id' },
      { method: 'GET', path: '/v1/discounts', operation: 'list', description: 'List all discounts', queryFilters: ['store_id'] },
    ],
  },

  // ── Checkouts ──────────────────────────────────────────────────────────
  {
    type: 'checkouts',
    resourceKey: 'checkouts',
    idPrefix: 'chk_',
    volumeHint: 'skip',
    attributes: {
      store_id: { type: 'integer' },
      variant_id: { type: 'integer' },
      custom_price: { type: 'integer', nullable: true, isAmount: true },
      product_options: { type: 'object', default: {} },
      checkout_options: { type: 'object', default: {} },
      checkout_data: { type: 'object', default: {} },
      preview: { type: 'object', nullable: true },
      expires_at: { type: 'string', nullable: true, isTimestamp: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
      url: { type: 'string' },
    },
    relationships: ['store', 'variant'],
    endpoints: [
      { method: 'POST', path: '/v1/checkouts', operation: 'create', description: 'Create a checkout' },
      { method: 'GET', path: '/v1/checkouts/:id', operation: 'retrieve', description: 'Retrieve a checkout', idParam: 'id' },
      { method: 'GET', path: '/v1/checkouts', operation: 'list', description: 'List all checkouts', queryFilters: ['store_id', 'variant_id'] },
    ],
  },

  // ── Files ──────────────────────────────────────────────────────────────
  {
    type: 'files',
    resourceKey: 'files',
    idPrefix: 'file_',
    volumeHint: 'skip',
    attributes: {
      variant_id: { type: 'integer' },
      identifier: { type: 'string' },
      name: { type: 'string' },
      extension: { type: 'string' },
      download_url: { type: 'string' },
      size: { type: 'integer', default: 0 },
      size_formatted: { type: 'string', default: '0 B' },
      version: { type: 'string', default: '1.0.0' },
      sort: { type: 'integer', default: 0 },
      status: { type: 'string', enum: ['draft', 'published'], default: 'published' },
      createdAt: { type: 'string', isTimestamp: true },
      updatedAt: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['variant'],
    endpoints: [
      { method: 'GET', path: '/v1/files/:id', operation: 'retrieve', description: 'Retrieve a file', idParam: 'id' },
      { method: 'GET', path: '/v1/files', operation: 'list', description: 'List all files', queryFilters: ['variant_id'] },
    ],
  },

  // ── Order Items ────────────────────────────────────────────────────────
  {
    type: 'order-items',
    resourceKey: 'order-items',
    idPrefix: 'oi_',
    volumeHint: 'skip',
    attributes: {
      order_id: { type: 'integer' },
      product_id: { type: 'integer' },
      variant_id: { type: 'integer' },
      product_name: { type: 'string' },
      variant_name: { type: 'string' },
      price: { type: 'integer', default: 0, isAmount: true },
      quantity: { type: 'integer', default: 1 },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['order', 'product', 'variant'],
    endpoints: [
      { method: 'GET', path: '/v1/order-items/:id', operation: 'retrieve', description: 'Retrieve an order item', idParam: 'id' },
      { method: 'GET', path: '/v1/order-items', operation: 'list', description: 'List all order items', queryFilters: ['order_id', 'product_id', 'variant_id'] },
    ],
  },

  // ── Subscription Invoices ──────────────────────────────────────────────
  {
    type: 'subscription-invoices',
    resourceKey: 'subscription-invoices',
    idPrefix: 'si_',
    volumeHint: 'entity',
    attributes: {
      store_id: { type: 'integer' },
      subscription_id: { type: 'integer' },
      customer_id: { type: 'integer' },
      user_name: { type: 'string' },
      user_email: { type: 'string' },
      billing_reason: { type: 'string', enum: ['initial', 'renewal', 'updated'], default: 'initial' },
      card_brand: { type: 'string', default: '' },
      card_last_four: { type: 'string', default: '' },
      currency: { type: 'string', default: 'USD' },
      currency_rate: { type: 'string', default: '1.0000' },
      status: { type: 'string', enum: ['pending', 'paid', 'void', 'refunded', 'partial_refund'], default: 'paid' },
      status_formatted: { type: 'string', default: 'Paid' },
      refunded: { type: 'boolean', default: false },
      refunded_at: { type: 'string', nullable: true, isTimestamp: true },
      subtotal: { type: 'integer', default: 0, isAmount: true },
      discount_total: { type: 'integer', default: 0, isAmount: true },
      tax: { type: 'integer', default: 0, isAmount: true },
      tax_inclusive: { type: 'boolean', default: false },
      total: { type: 'integer', default: 0, isAmount: true },
      refunded_amount: { type: 'integer', default: 0, isAmount: true },
      subtotal_usd: { type: 'integer', default: 0, isAmount: true },
      discount_total_usd: { type: 'integer', default: 0, isAmount: true },
      tax_usd: { type: 'integer', default: 0, isAmount: true },
      total_usd: { type: 'integer', default: 0, isAmount: true },
      refunded_amount_usd: { type: 'integer', default: 0, isAmount: true },
      subtotal_formatted: { type: 'string', default: '$0.00' },
      discount_total_formatted: { type: 'string', default: '$0.00' },
      tax_formatted: { type: 'string', default: '$0.00' },
      total_formatted: { type: 'string', default: '$0.00' },
      refunded_amount_formatted: { type: 'string', default: '$0.00' },
      urls: { type: 'object', default: { invoice_url: null } },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store', 'subscription', 'customer'],
    endpoints: [
      { method: 'GET', path: '/v1/subscription-invoices/:id', operation: 'retrieve', description: 'Retrieve a subscription invoice', idParam: 'id' },
      { method: 'GET', path: '/v1/subscription-invoices', operation: 'list', description: 'List all subscription invoices', queryFilters: ['store_id', 'status', 'refunded', 'subscription_id'] },
    ],
  },

  // ── Subscription Items ─────────────────────────────────────────────────
  {
    type: 'subscription-items',
    resourceKey: 'subscription-items',
    idPrefix: 'subi_',
    volumeHint: 'skip',
    attributes: {
      subscription_id: { type: 'integer' },
      price_id: { type: 'integer' },
      quantity: { type: 'integer', default: 1 },
      is_usage_based: { type: 'boolean', default: false },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['subscription', 'price', 'usage-records'],
    endpoints: [
      { method: 'GET', path: '/v1/subscription-items/:id', operation: 'retrieve', description: 'Retrieve a subscription item', idParam: 'id' },
      { method: 'PATCH', path: '/v1/subscription-items/:id', operation: 'update', description: 'Update a subscription item', idParam: 'id' },
      { method: 'GET', path: '/v1/subscription-items', operation: 'list', description: 'List all subscription items', queryFilters: ['subscription_id', 'price_id'] },
    ],
  },

  // ── Usage Records ──────────────────────────────────────────────────────
  {
    type: 'usage-records',
    resourceKey: 'usage-records',
    idPrefix: 'ur_',
    volumeHint: 'skip',
    attributes: {
      subscription_item_id: { type: 'integer' },
      quantity: { type: 'integer', default: 0 },
      action: { type: 'string', enum: ['increment', 'set'], default: 'increment' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['subscription-item'],
    endpoints: [
      { method: 'POST', path: '/v1/usage-records', operation: 'create', description: 'Create a usage record' },
      { method: 'GET', path: '/v1/usage-records/:id', operation: 'retrieve', description: 'Retrieve a usage record', idParam: 'id' },
      { method: 'GET', path: '/v1/usage-records', operation: 'list', description: 'List all usage records', queryFilters: ['subscription_item_id'] },
    ],
  },

  // ── Discount Redemptions ───────────────────────────────────────────────
  {
    type: 'discount-redemptions',
    resourceKey: 'discount-redemptions',
    idPrefix: 'dr_',
    volumeHint: 'skip',
    attributes: {
      discount_id: { type: 'integer' },
      order_id: { type: 'integer' },
      discount_name: { type: 'string' },
      discount_code: { type: 'string' },
      discount_amount: { type: 'integer', default: 0, isAmount: true },
      discount_amount_type: { type: 'string', enum: ['percent', 'fixed'], default: 'percent' },
      amount: { type: 'integer', default: 0, isAmount: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['discount', 'order'],
    endpoints: [
      { method: 'GET', path: '/v1/discount-redemptions/:id', operation: 'retrieve', description: 'Retrieve a discount redemption', idParam: 'id' },
      { method: 'GET', path: '/v1/discount-redemptions', operation: 'list', description: 'List all discount redemptions', queryFilters: ['discount_id', 'order_id'] },
    ],
  },

  // ── License Keys ───────────────────────────────────────────────────────
  {
    type: 'license-keys',
    resourceKey: 'license-keys',
    idPrefix: 'lk_',
    volumeHint: 'reference',
    attributes: {
      store_id: { type: 'integer' },
      customer_id: { type: 'integer' },
      order_id: { type: 'integer' },
      order_item_id: { type: 'integer' },
      product_id: { type: 'integer' },
      user_name: { type: 'string' },
      user_email: { type: 'string' },
      key: { type: 'string' },
      key_short: { type: 'string' },
      activation_limit: { type: 'integer', default: 5 },
      instances_count: { type: 'integer', default: 0 },
      disabled: { type: 'boolean', default: false },
      status: { type: 'string', enum: ['inactive', 'active', 'expired', 'disabled'], default: 'inactive' },
      status_formatted: { type: 'string', default: 'Inactive' },
      expires_at: { type: 'string', nullable: true, isTimestamp: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['store', 'customer', 'order', 'order-item', 'product', 'license-key-instances'],
    endpoints: [
      { method: 'GET', path: '/v1/license-keys/:id', operation: 'retrieve', description: 'Retrieve a license key', idParam: 'id' },
      { method: 'PATCH', path: '/v1/license-keys/:id', operation: 'update', description: 'Update a license key', idParam: 'id' },
      { method: 'GET', path: '/v1/license-keys', operation: 'list', description: 'List all license keys', queryFilters: ['store_id', 'order_id', 'order_item_id', 'product_id', 'status'] },
    ],
  },

  // ── License Key Instances ──────────────────────────────────────────────
  {
    type: 'license-key-instances',
    resourceKey: 'license-key-instances',
    idPrefix: 'lki_',
    volumeHint: 'skip',
    attributes: {
      license_key_id: { type: 'integer' },
      identifier: { type: 'string' },
      name: { type: 'string' },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
    },
    relationships: ['license-key'],
    endpoints: [
      { method: 'GET', path: '/v1/license-key-instances/:id', operation: 'retrieve', description: 'Retrieve a license key instance', idParam: 'id' },
      { method: 'GET', path: '/v1/license-key-instances', operation: 'list', description: 'List all license key instances', queryFilters: ['license_key_id'] },
    ],
  },

  // ── Webhooks ───────────────────────────────────────────────────────────
  {
    type: 'webhooks',
    resourceKey: 'webhooks',
    idPrefix: 'wh_',
    volumeHint: 'skip',
    attributes: {
      store_id: { type: 'integer' },
      url: { type: 'string' },
      events: { type: 'array', default: [] },
      last_sent_at: { type: 'string', nullable: true, isTimestamp: true },
      created_at: { type: 'string', isTimestamp: true },
      updated_at: { type: 'string', isTimestamp: true },
      test_mode: { type: 'boolean', default: false },
    },
    relationships: ['store'],
    endpoints: [
      { method: 'POST', path: '/v1/webhooks', operation: 'create', description: 'Create a webhook' },
      { method: 'GET', path: '/v1/webhooks/:id', operation: 'retrieve', description: 'Retrieve a webhook', idParam: 'id' },
      { method: 'PATCH', path: '/v1/webhooks/:id', operation: 'update', description: 'Update a webhook', idParam: 'id' },
      { method: 'DELETE', path: '/v1/webhooks/:id', operation: 'delete', description: 'Delete a webhook', idParam: 'id' },
      { method: 'GET', path: '/v1/webhooks', operation: 'list', description: 'List all webhooks', queryFilters: ['store_id'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Code generators
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str
    .split(/[_\s\-\.]+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toUnderscoreKey(str: string): string {
  return str.replace(/-/g, '_');
}

function generateMetaTs(): string {
  const generatedAt = new Date().toISOString();
  return `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-lemonsqueezy generate
// Lemon Squeezy API docs: https://docs.lemonsqueezy.com/api
// Generated at: ${generatedAt}

export const LEMONSQUEEZY_SPEC_VERSION = 'v1';
export const LEMONSQUEEZY_SPEC_GENERATED_AT = ${JSON.stringify(generatedAt)};
`;
}

function generateResourceSpecsTs(): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-lemonsqueezy generate`,
    `import type { AdapterResourceSpecs } from '@mimicai/core';`,
    ``,
    `export const lemonsqueezyResourceSpecs: AdapterResourceSpecs = {`,
    `  platform: {`,
    `    timestampFormat: 'iso8601',`,
    `    amountFormat: 'integer_cents',`,
    `    idPrefix: '',`,
    `  },`,
    `  resources: {`,
  ];

  for (const res of RESOURCES) {
    if (res.volumeHint === 'skip') continue;

    const resKey = JSON.stringify(toUnderscoreKey(res.type));
    lines.push(`    ${resKey}: {`);
    lines.push(`      objectType: ${JSON.stringify(res.type)},`);
    lines.push(`      volumeHint: ${JSON.stringify(res.volumeHint)},`);
    lines.push(`      refs: ${JSON.stringify(res.relationships)},`);
    lines.push(`      fields: {`);

    for (const [fieldName, field] of Object.entries(res.attributes)) {
      const parts: string[] = [`type: ${JSON.stringify(field.type)}`];
      parts.push(`required: false`);
      if (field.nullable) parts.push(`nullable: true`);
      if (field.default !== undefined) parts.push(`default: ${JSON.stringify(field.default)}`);
      if (field.enum) parts.push(`enum: ${JSON.stringify(field.enum)}`);
      if (field.isTimestamp) parts.push(`auto: true`);
      if (field.isAmount) parts.push(`isAmount: true`);
      lines.push(`        ${JSON.stringify(fieldName)}: { ${parts.join(', ')} },`);
    }

    lines.push(`      },`);
    lines.push(`    },`);
  }

  lines.push(`  },`);
  lines.push(`};`);
  lines.push(``);
  return lines.join('\n');
}

function generateSchemasTs(): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-lemonsqueezy generate`,
    `import { generateId } from '@mimicai/adapter-sdk';`,
    ``,
    `function isoNow(): string { return new Date().toISOString(); }`,
    ``,
  ];

  for (const res of RESOURCES) {
    const fnName = 'default' + toPascalCase(res.type);
    lines.push(`export function ${fnName}(overrides: Record<string, unknown> = {}): Record<string, unknown> {`);
    lines.push(`  return {`);
    lines.push(`    id: generateId(${JSON.stringify(res.idPrefix)}, 14),`);

    for (const [fieldName, field] of Object.entries(res.attributes)) {
      let val: string;
      if (field.isTimestamp && !field.nullable) {
        val = `isoNow()`;
      } else if (field.isTimestamp && field.nullable) {
        val = `null`;
      } else if (field.default !== undefined) {
        val = JSON.stringify(field.default);
      } else if (field.nullable) {
        val = `null`;
      } else if (field.type === 'string') {
        val = `''`;
      } else if (field.type === 'integer' || field.type === 'number') {
        val = `0`;
      } else if (field.type === 'boolean') {
        val = `false`;
      } else if (field.type === 'array') {
        val = `[]`;
      } else if (field.type === 'object') {
        val = `{}`;
      } else {
        val = `null`;
      }
      lines.push(`    ${JSON.stringify(fieldName)}: ${val},`);
    }

    lines.push(`    ...overrides,`);
    lines.push(`  };`);
    lines.push(`}`);
    lines.push(``);
  }

  // Export lookup map
  lines.push(`// ---------------------------------------------------------------------------`);
  lines.push(`// Lookup map: resourceKey → default factory`);
  lines.push(`// ---------------------------------------------------------------------------`);
  lines.push(``);
  lines.push(`export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;`);
  lines.push(``);
  lines.push(`export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {`);

  for (const res of RESOURCES) {
    const fnName = 'default' + toPascalCase(res.type);
    lines.push(`  ${JSON.stringify(res.resourceKey)}: ${fnName},`);
    // Also map underscore version for seeding lookups
    const underscored = toUnderscoreKey(res.resourceKey);
    if (underscored !== res.resourceKey) {
      lines.push(`  ${JSON.stringify(underscored)}: ${fnName},`);
    }
    // Map singular type too
    const singular = res.type.replace(/s$/, '');
    if (singular !== res.resourceKey && singular !== underscored) {
      lines.push(`  ${JSON.stringify(singular)}: ${fnName},`);
    }
  }

  lines.push(`};`);
  lines.push(``);
  return lines.join('\n');
}

function generateRoutesTs(): string {
  const lines: string[] = [
    `// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-lemonsqueezy generate`,
    ``,
    `export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';`,
    `export type RouteOperation = 'list' | 'create' | 'retrieve' | 'update' | 'delete' | 'action';`,
    ``,
    `export interface GeneratedRoute {`,
    `  method: RouteMethod;`,
    `  fastifyPath: string;`,
    `  stripePath: string;`,
    `  resource: string;`,
    `  operation: RouteOperation;`,
    `  description: string;`,
    `  queryFilters: string[];`,
    `  idParam?: string;`,
    `  objectType?: string;`,
    `}`,
    ``,
    `export const GENERATED_ROUTES: GeneratedRoute[] = [`,
  ];

  for (const res of RESOURCES) {
    for (const ep of res.endpoints) {
      const fastifyPath = '/lemonsqueezy' + ep.path;
      lines.push(`  {`);
      lines.push(`    method: ${JSON.stringify(ep.method)},`);
      lines.push(`    fastifyPath: ${JSON.stringify(fastifyPath)},`);
      lines.push(`    stripePath: ${JSON.stringify(ep.path)},`);
      lines.push(`    resource: ${JSON.stringify(res.resourceKey)},`);
      lines.push(`    operation: ${JSON.stringify(ep.operation)},`);
      lines.push(`    description: ${JSON.stringify(ep.description)},`);
      lines.push(`    queryFilters: ${JSON.stringify(ep.queryFilters ?? [])},`);
      if (ep.idParam) lines.push(`    idParam: ${JSON.stringify(ep.idParam)},`);
      lines.push(`    objectType: ${JSON.stringify(res.type)},`);
      lines.push(`  },`);
    }
  }

  lines.push(`];`);
  lines.push(``);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('Lemon Squeezy codegen (from embedded resource definitions)');
  console.log(`  ${RESOURCES.length} resources defined`);

  const totalFields = RESOURCES.reduce((sum, r) => sum + Object.keys(r.attributes).length, 0);
  const totalEndpoints = RESOURCES.reduce((sum, r) => sum + r.endpoints.length, 0);
  console.log(`  ${totalFields} total fields`);
  console.log(`  ${totalEndpoints} total endpoints`);

  mkdirSync(OUT_DIR, { recursive: true });
  console.log('Generating files...');

  writeFileSync(`${OUT_DIR}/meta.ts`, generateMetaTs());
  console.log('  ✓ meta.ts');

  writeFileSync(`${OUT_DIR}/resource-specs.ts`, generateResourceSpecsTs());
  console.log('  ✓ resource-specs.ts');

  writeFileSync(`${OUT_DIR}/schemas.ts`, generateSchemasTs());
  console.log('  ✓ schemas.ts');

  writeFileSync(`${OUT_DIR}/routes.ts`, generateRoutesTs());
  console.log('  ✓ routes.ts');

  const entityCount = RESOURCES.filter(r => r.volumeHint === 'entity').length;
  const refCount = RESOURCES.filter(r => r.volumeHint === 'reference').length;
  console.log(`\nCodegen complete:`);
  console.log(`  ${RESOURCES.length} resources (${entityCount} entity, ${refCount} reference)`);
  console.log(`  ${totalFields} total fields, ${totalEndpoints} endpoints`);
  console.log(`  Output: ${OUT_DIR}/`);
}

main();
