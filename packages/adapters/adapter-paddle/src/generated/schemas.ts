// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-paddle generate
import { generateId } from '@mimicai/adapter-sdk';

/**
 * Returns a complete Paddle object with all fields defaulted to spec-faithful values.
 * The caller merges request body fields on top of this default skeleton.
 */

export function defaultCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("ctm_", 24),
    "name": null,
    "email": "",
    "marketing_consent": false,
    "status": "active",
    "custom_data": null,
    "locale": "",
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "import_meta": null,
    ...overrides,
  };
}

export function defaultAddress(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("add_", 24),
    "customer_id": "",
    "description": null,
    "first_line": null,
    "second_line": null,
    "city": null,
    "postal_code": null,
    "region": null,
    "country_code": "AD",
    "custom_data": null,
    "status": "active",
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "import_meta": null,
    ...overrides,
  };
}

export function defaultBusiness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("biz_", 24),
    "customer_id": "",
    "name": null,
    "company_number": null,
    "tax_identifier": null,
    "status": "active",
    "contacts": [],
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "custom_data": null,
    "import_meta": null,
    ...overrides,
  };
}

export function defaultProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("pro_", 24),
    "name": "",
    "description": null,
    "type": "standard",
    "tax_category": "digital-goods",
    "image_url": null,
    "custom_data": null,
    "status": "active",
    "import_meta": null,
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    ...overrides,
  };
}

export function defaultPrice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("pri_", 24),
    "product_id": "",
    "description": "",
    "type": "standard",
    "name": null,
    "billing_cycle": null,
    "trial_period": null,
    "tax_mode": "account_setting",
    "unit_price": {"amount":"","currency_code":"USD"},
    "unit_price_overrides": [],
    "quantity": {"minimum":0,"maximum":0},
    "status": "active",
    "custom_data": null,
    "import_meta": null,
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    ...overrides,
  };
}

export function defaultDiscount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("dsc_", 24),
    "status": "active",
    "description": "",
    "enabled_for_checkout": true,
    "code": null,
    "type": "percentage",
    "mode": "standard",
    "amount": "",
    "currency_code": "USD",
    "recur": false,
    "maximum_recurring_intervals": null,
    "usage_limit": null,
    "restrict_to": null,
    "expires_at": new Date().toISOString(),
    "custom_data": null,
    "times_used": 0,
    "discount_group_id": null,
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "import_meta": null,
    ...overrides,
  };
}

export function defaultDiscountGroup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("dsg_", 24),
    "name": "",
    "status": "active",
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "import_meta": null,
    ...overrides,
  };
}

export function defaultTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("txn_", 24),
    "status": "draft",
    "customer_id": null,
    "address_id": null,
    "business_id": null,
    "custom_data": null,
    "currency_code": "USD",
    "origin": "api",
    "subscription_id": null,
    "invoice_id": null,
    "invoice_number": null,
    "collection_mode": "automatic",
    "discount_id": null,
    "billing_details": null,
    "billing_period": null,
    "items": [],
    "details": {"tax_rates_used":[],"totals":{},"adjusted_totals":{},"payout_totals":{},"adjusted_payout_totals":{},"line_items":[]},
    "payments": [],
    "checkout": null,
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "billed_at": new Date().toISOString(),
    "revised_at": new Date().toISOString(),
    ...overrides,
  };
}

export function defaultSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("sub_", 24),
    "status": "active",
    "customer_id": null,
    "address_id": null,
    "business_id": null,
    "currency_code": "USD",
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "started_at": new Date().toISOString(),
    "first_billed_at": new Date().toISOString(),
    "next_billed_at": new Date().toISOString(),
    "paused_at": new Date().toISOString(),
    "canceled_at": new Date().toISOString(),
    "discount": null,
    "collection_mode": "automatic",
    "billing_details": null,
    "current_billing_period": null,
    "billing_cycle": null,
    "scheduled_change": null,
    "management_urls": {"update_payment_method":"","cancel":""},
    "items": [],
    "custom_data": null,
    "import_meta": null,
    ...overrides,
  };
}

export function defaultAdjustment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("adj_", 24),
    "action": "credit",
    "type": "full",
    "transaction_id": "",
    "subscription_id": null,
    "customer_id": null,
    "reason": "",
    "credit_applied_to_balance": null,
    "currency_code": "USD",
    "status": "pending_approval",
    "items": [],
    "totals": {"subtotal":"","tax":"","total":"","fee":"","retained_fee":null,"earnings":"","currency_code":"USD"},
    "payout_totals": null,
    "tax_rates_used": [],
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    ...overrides,
  };
}

export function defaultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "event_id": "",
    "event_type": "address.created",
    "occurred_at": new Date().toISOString(),
    "data": {},
    ...overrides,
  };
}

export function defaultNotificationSetting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("ntfset_", 24),
    "description": "",
    "type": "email",
    "destination": "",
    "active": false,
    "api_version": 0,
    "include_sensitive_fields": false,
    "subscribed_events": [],
    "endpoint_secret_key": "",
    "traffic_source": "platform",
    ...overrides,
  };
}

export function defaultNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("ntf_", 24),
    "type": "address.created",
    "status": "not_attempted",
    "payload": {"event_id":"","event_type":"address.created","occurred_at":"","data":{},"notification_id":null},
    "occurred_at": new Date().toISOString(),
    "delivered_at": new Date().toISOString(),
    "replayed_at": new Date().toISOString(),
    "origin": "event",
    "last_attempt_at": new Date().toISOString(),
    "retry_at": new Date().toISOString(),
    "times_attempted": 0,
    "notification_setting_id": "",
    ...overrides,
  };
}

export function defaultReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("rep_", 24),
    "status": "pending",
    "rows": null,
    "expires_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    "created_at": new Date().toISOString(),
    "type": "adjustments",
    "filters": [],
    ...overrides,
  };
}

export function defaultClientToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("ctkn_", 24),
    "token": "",
    "name": "",
    "description": null,
    "status": "active",
    "revoked_at": new Date().toISOString(),
    "created_at": new Date().toISOString(),
    "updated_at": new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lookup map: resourceId → default factory
// ---------------------------------------------------------------------------

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "customer": defaultCustomer,
  "customers": defaultCustomer,
  "address": defaultAddress,
  "addresses": defaultAddress,
  "business": defaultBusiness,
  "businesses": defaultBusiness,
  "product": defaultProduct,
  "products": defaultProduct,
  "price": defaultPrice,
  "prices": defaultPrice,
  "discount": defaultDiscount,
  "discounts": defaultDiscount,
  "discount_group": defaultDiscountGroup,
  "discount_groups": defaultDiscountGroup,
  "transaction": defaultTransaction,
  "transactions": defaultTransaction,
  "subscription": defaultSubscription,
  "subscriptions": defaultSubscription,
  "adjustment": defaultAdjustment,
  "adjustments": defaultAdjustment,
  "event": defaultEvent,
  "events": defaultEvent,
  "notification_setting": defaultNotificationSetting,
  "notification_settings": defaultNotificationSetting,
  "notification": defaultNotification,
  "notifications": defaultNotification,
  "report": defaultReport,
  "reports": defaultReport,
  "client_token": defaultClientToken,
  "client_tokens": defaultClientToken,
};
