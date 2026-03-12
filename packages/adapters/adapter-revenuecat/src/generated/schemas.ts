// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-revenuecat generate
import { generateId } from '@mimicai/adapter-sdk';

/**
 * Returns a complete RevenueCat object with all fields defaulted to spec-faithful values.
 * The caller merges request body fields on top of this default skeleton.
 */

export function defaultProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "project",
    "id": generateId("proj", 14),
    "name": "",
    "created_at": Date.now(),
    "icon_url": null,
    "icon_url_large": null,
    ...overrides,
  };
}

export function defaultCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "customer",
    "id": crypto.randomUUID(),
    "project_id": "",
    "first_seen_at": Date.now(),
    "last_seen_at": Date.now(),
    "last_seen_app_version": null,
    "last_seen_country": "US",
    "last_seen_platform": "ios",
    "last_seen_platform_version": null,
    "experiment": null,
    ...overrides,
  };
}

export function defaultEntitlement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "entitlement",
    "state": "active",
    "project_id": "",
    "id": generateId("entl", 14),
    "lookup_key": "",
    "display_name": "",
    "created_at": Date.now(),
    ...overrides,
  };
}

export function defaultOffering(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "offering",
    "state": "active",
    "id": generateId("ofrng", 14),
    "lookup_key": "",
    "display_name": "",
    "is_current": true,
    "created_at": Date.now(),
    "project_id": "",
    "metadata": null,
    ...overrides,
  };
}

export function defaultPackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "package",
    "id": generateId("pkg", 14),
    "lookup_key": "",
    "display_name": "",
    "position": null,
    "created_at": Date.now(),
    ...overrides,
  };
}

export function defaultProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "product",
    "state": "active",
    "id": generateId("prod", 14),
    "store_identifier": "",
    "type": "subscription",
    "subscription": null,
    "one_time": null,
    "created_at": Date.now(),
    "app_id": "",
    "app": null,
    "display_name": null,
    ...overrides,
  };
}

export function defaultSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "subscription",
    "id": generateId("sub", 14),
    "customer_id": "",
    "original_customer_id": "",
    "product_id": null,
    "starts_at": Date.now(),
    "current_period_starts_at": Date.now(),
    "current_period_ends_at": Date.now(),
    "ends_at": Date.now(),
    "gives_access": true,
    "pending_payment": false,
    "auto_renewal_status": "will_renew",
    "status": "active",
    "total_revenue_in_usd": {"currency":"AED","gross":0,"commission":0,"tax":0,"proceeds":0},
    "presented_offering_id": null,
    "environment": "production",
    "store": "app_store",
    "store_subscription_identifier": "",
    "ownership": "purchased",
    "pending_changes": null,
    "country": null,
    "management_url": null,
    ...overrides,
  };
}

export function defaultPurchase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "purchase",
    "id": generateId("purch", 14),
    "customer_id": "",
    "original_customer_id": "",
    "product_id": "",
    "purchased_at": Date.now(),
    "revenue_in_usd": {"currency":"AED","gross":0,"commission":0,"tax":0,"proceeds":0},
    "quantity": 1,
    "status": "owned",
    "presented_offering_id": null,
    "environment": "production",
    "store": "app_store",
    "store_purchase_identifier": "",
    "ownership": "purchased",
    "country": null,
    ...overrides,
  };
}

export function defaultPaywall(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "paywall",
    "id": generateId("pw", 14),
    "name": null,
    "offering_id": "",
    "created_at": Date.now(),
    "published_at": Date.now(),
    "offering": null,
    "components": null,
    ...overrides,
  };
}

export function defaultApp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "app",
    "id": generateId("app", 14),
    "name": "",
    "created_at": Date.now(),
    "type": "amazon",
    "project_id": "",
    "amazon": {"package_name":""},
    "app_store": {"bundle_id":""},
    "mac_app_store": {"bundle_id":""},
    "play_store": {"package_name":""},
    "stripe": {"stripe_account_id":null},
    "rc_billing": {"stripe_account_id":null,"seller_company_name":"","app_name":null,"seller_company_support_email":null,"support_email":null,"default_currency":"USD"},
    "roku": {"roku_channel_id":null,"roku_channel_name":null},
    "paddle": {"paddle_is_sandbox":false,"paddle_api_key":null},
    ...overrides,
  };
}

export function defaultCollaborator(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "collaborator",
    "id": generateId("collab", 14),
    "name": null,
    "email": "",
    "role": "",
    "accepted_at": Date.now(),
    "has_mfa": false,
    ...overrides,
  };
}

export function defaultVirtualCurrency(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "virtual_currency",
    "state": "active",
    "project_id": "",
    "code": crypto.randomUUID(),
    "name": "",
    "created_at": Date.now(),
    "description": null,
    "product_grants": null,
    ...overrides,
  };
}

export function defaultWebhookIntegration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "webhook_integration",
    "id": generateId("whi", 14),
    "project_id": "",
    "name": "",
    "url": "",
    "environment": "production",
    "event_types": null,
    "app_id": null,
    "created_at": Date.now(),
    ...overrides,
  };
}

export function defaultInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "invoice",
    "id": generateId("rcbin", 14),
    "total_amount": {"currency":"AED","gross":0,"commission":0,"tax":0,"proceeds":0},
    "line_items": [],
    "issued_at": Date.now(),
    "paid_at": Date.now(),
    "invoice_url": null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lookup map: resourceId → default factory
// ---------------------------------------------------------------------------

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "project": defaultProject,
  "projects": defaultProject,
  "customer": defaultCustomer,
  "customers": defaultCustomer,
  "entitlement": defaultEntitlement,
  "entitlements": defaultEntitlement,
  "offering": defaultOffering,
  "offerings": defaultOffering,
  "package": defaultPackage,
  "packages": defaultPackage,
  "product": defaultProduct,
  "products": defaultProduct,
  "subscription": defaultSubscription,
  "subscriptions": defaultSubscription,
  "purchase": defaultPurchase,
  "purchases": defaultPurchase,
  "paywall": defaultPaywall,
  "paywalls": defaultPaywall,
  "app": defaultApp,
  "apps": defaultApp,
  "collaborator": defaultCollaborator,
  "collaborators": defaultCollaborator,
  "virtual_currency": defaultVirtualCurrency,
  "virtual_currencies": defaultVirtualCurrency,
  "webhook_integration": defaultWebhookIntegration,
  "webhooks": defaultWebhookIntegration,
  "invoice": defaultInvoice,
  "invoices": defaultInvoice,
};
