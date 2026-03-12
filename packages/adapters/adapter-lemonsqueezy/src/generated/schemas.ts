// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-lemonsqueezy generate
import { generateId } from '@mimicai/adapter-sdk';

function isoNow(): string { return new Date().toISOString(); }

export function defaultUsers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("", 14),
    "name": '',
    "email": '',
    "color": "#898FA9",
    "avatar_url": '',
    "has_custom_avatar": false,
    "createdAt": isoNow(),
    "updatedAt": isoNow(),
    ...overrides,
  };
}

export function defaultStores(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("store_", 14),
    "name": '',
    "slug": '',
    "domain": '',
    "url": '',
    "avatar_url": '',
    "plan": "fresh",
    "country": "US",
    "country_nicename": "United States",
    "currency": "USD",
    "total_sales": 0,
    "total_revenue": 0,
    "thirty_day_sales": 0,
    "thirty_day_revenue": 0,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultCustomers(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("cust_", 14),
    "store_id": 0,
    "name": '',
    "email": '',
    "status": "subscribed",
    "city": null,
    "region": null,
    "country": null,
    "total_revenue_currency": 0,
    "mrr": 0,
    "status_formatted": "Subscribed",
    "country_formatted": null,
    "total_revenue_currency_formatted": "$0.00",
    "mrr_formatted": "$0.00",
    "urls": {"customer_portal":null},
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultProducts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("prod_", 14),
    "store_id": 0,
    "name": '',
    "slug": '',
    "description": "",
    "status": "published",
    "status_formatted": "Published",
    "thumb_url": null,
    "large_thumb_url": null,
    "price": 0,
    "price_formatted": "$0.00",
    "from_price": null,
    "from_price_formatted": null,
    "to_price": null,
    "to_price_formatted": null,
    "pay_what_you_want": false,
    "buy_now_url": '',
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultVariants(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("var_", 14),
    "product_id": 0,
    "name": '',
    "slug": '',
    "description": "",
    "has_license_keys": false,
    "license_activation_limit": 5,
    "is_license_limit_unlimited": false,
    "license_length_value": 1,
    "license_length_unit": "years",
    "is_license_length_unlimited": false,
    "sort": 0,
    "status": "published",
    "status_formatted": "Published",
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultPrices(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("pri_", 14),
    "variant_id": 0,
    "category": "one_time",
    "scheme": "standard",
    "usage_aggregation": null,
    "unit_price": null,
    "unit_price_decimal": null,
    "setup_fee_enabled": null,
    "setup_fee": null,
    "package_size": 1,
    "tiers": null,
    "renewal_interval_unit": null,
    "renewal_interval_quantity": null,
    "trial_interval_unit": null,
    "trial_interval_quantity": null,
    "min_price": null,
    "suggested_price": null,
    "tax_code": "eservice",
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultOrders(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("ord_", 14),
    "store_id": 0,
    "customer_id": 0,
    "identifier": '',
    "order_number": 1,
    "user_name": '',
    "user_email": '',
    "currency": "USD",
    "currency_rate": "1.0000",
    "subtotal": 0,
    "setup_fee": 0,
    "discount_total": 0,
    "tax": 0,
    "total": 0,
    "refunded_amount": 0,
    "subtotal_usd": 0,
    "setup_fee_usd": 0,
    "discount_total_usd": 0,
    "tax_usd": 0,
    "total_usd": 0,
    "refunded_amount_usd": 0,
    "tax_name": null,
    "tax_rate": "0.00",
    "tax_inclusive": false,
    "status": "paid",
    "status_formatted": "Paid",
    "refunded": false,
    "refunded_at": null,
    "subtotal_formatted": "$0.00",
    "setup_fee_formatted": "$0.00",
    "discount_total_formatted": "$0.00",
    "tax_formatted": "$0.00",
    "total_formatted": "$0.00",
    "refunded_amount_formatted": "$0.00",
    "first_order_item": null,
    "urls": {"receipt":null},
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultSubscriptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("sub_", 14),
    "store_id": 0,
    "customer_id": 0,
    "order_id": 0,
    "order_item_id": 0,
    "product_id": 0,
    "variant_id": 0,
    "product_name": '',
    "variant_name": '',
    "user_name": '',
    "user_email": '',
    "status": "active",
    "status_formatted": "Active",
    "card_brand": null,
    "card_last_four": null,
    "payment_processor": "stripe",
    "pause": null,
    "cancelled": false,
    "trial_ends_at": null,
    "billing_anchor": 1,
    "first_subscription_item": null,
    "urls": {"update_payment_method":"","customer_portal":"","update_customer_portal":""},
    "renews_at": isoNow(),
    "ends_at": null,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultDiscounts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("dsc_", 14),
    "store_id": 0,
    "name": '',
    "code": '',
    "amount": 0,
    "amount_type": "percent",
    "is_limited_to_products": false,
    "is_limited_redemptions": false,
    "max_redemptions": 0,
    "starts_at": null,
    "expires_at": null,
    "duration": "once",
    "duration_in_months": 0,
    "status": "published",
    "status_formatted": "Published",
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultCheckouts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("chk_", 14),
    "store_id": 0,
    "variant_id": 0,
    "custom_price": null,
    "product_options": {},
    "checkout_options": {},
    "checkout_data": {},
    "preview": null,
    "expires_at": null,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    "url": '',
    ...overrides,
  };
}

export function defaultFiles(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("file_", 14),
    "variant_id": 0,
    "identifier": '',
    "name": '',
    "extension": '',
    "download_url": '',
    "size": 0,
    "size_formatted": "0 B",
    "version": "1.0.0",
    "sort": 0,
    "status": "published",
    "createdAt": isoNow(),
    "updatedAt": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultOrderItems(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("oi_", 14),
    "order_id": 0,
    "product_id": 0,
    "variant_id": 0,
    "product_name": '',
    "variant_name": '',
    "price": 0,
    "quantity": 1,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultSubscriptionInvoices(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("si_", 14),
    "store_id": 0,
    "subscription_id": 0,
    "customer_id": 0,
    "user_name": '',
    "user_email": '',
    "billing_reason": "initial",
    "card_brand": "",
    "card_last_four": "",
    "currency": "USD",
    "currency_rate": "1.0000",
    "status": "paid",
    "status_formatted": "Paid",
    "refunded": false,
    "refunded_at": null,
    "subtotal": 0,
    "discount_total": 0,
    "tax": 0,
    "tax_inclusive": false,
    "total": 0,
    "refunded_amount": 0,
    "subtotal_usd": 0,
    "discount_total_usd": 0,
    "tax_usd": 0,
    "total_usd": 0,
    "refunded_amount_usd": 0,
    "subtotal_formatted": "$0.00",
    "discount_total_formatted": "$0.00",
    "tax_formatted": "$0.00",
    "total_formatted": "$0.00",
    "refunded_amount_formatted": "$0.00",
    "urls": {"invoice_url":null},
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

export function defaultSubscriptionItems(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("subi_", 14),
    "subscription_id": 0,
    "price_id": 0,
    "quantity": 1,
    "is_usage_based": false,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultUsageRecords(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("ur_", 14),
    "subscription_item_id": 0,
    "quantity": 0,
    "action": "increment",
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultDiscountRedemptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("dr_", 14),
    "discount_id": 0,
    "order_id": 0,
    "discount_name": '',
    "discount_code": '',
    "discount_amount": 0,
    "discount_amount_type": "percent",
    "amount": 0,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultLicenseKeys(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("lk_", 14),
    "store_id": 0,
    "customer_id": 0,
    "order_id": 0,
    "order_item_id": 0,
    "product_id": 0,
    "user_name": '',
    "user_email": '',
    "key": '',
    "key_short": '',
    "activation_limit": 5,
    "instances_count": 0,
    "disabled": false,
    "status": "inactive",
    "status_formatted": "Inactive",
    "expires_at": null,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultLicenseKeyInstances(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("lki_", 14),
    "license_key_id": 0,
    "identifier": '',
    "name": '',
    "created_at": isoNow(),
    "updated_at": isoNow(),
    ...overrides,
  };
}

export function defaultWebhooks(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: generateId("wh_", 14),
    "store_id": 0,
    "url": '',
    "events": [],
    "last_sent_at": null,
    "created_at": isoNow(),
    "updated_at": isoNow(),
    "test_mode": false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lookup map: resourceKey → default factory
// ---------------------------------------------------------------------------

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "users": defaultUsers,
  "user": defaultUsers,
  "stores": defaultStores,
  "store": defaultStores,
  "customers": defaultCustomers,
  "customer": defaultCustomers,
  "products": defaultProducts,
  "product": defaultProducts,
  "variants": defaultVariants,
  "variant": defaultVariants,
  "prices": defaultPrices,
  "price": defaultPrices,
  "orders": defaultOrders,
  "order": defaultOrders,
  "subscriptions": defaultSubscriptions,
  "subscription": defaultSubscriptions,
  "discounts": defaultDiscounts,
  "discount": defaultDiscounts,
  "checkouts": defaultCheckouts,
  "checkout": defaultCheckouts,
  "files": defaultFiles,
  "file": defaultFiles,
  "order-items": defaultOrderItems,
  "order_items": defaultOrderItems,
  "order-item": defaultOrderItems,
  "subscription-invoices": defaultSubscriptionInvoices,
  "subscription_invoices": defaultSubscriptionInvoices,
  "subscription-invoice": defaultSubscriptionInvoices,
  "subscription-items": defaultSubscriptionItems,
  "subscription_items": defaultSubscriptionItems,
  "subscription-item": defaultSubscriptionItems,
  "usage-records": defaultUsageRecords,
  "usage_records": defaultUsageRecords,
  "usage-record": defaultUsageRecords,
  "discount-redemptions": defaultDiscountRedemptions,
  "discount_redemptions": defaultDiscountRedemptions,
  "discount-redemption": defaultDiscountRedemptions,
  "license-keys": defaultLicenseKeys,
  "license_keys": defaultLicenseKeys,
  "license-key": defaultLicenseKeys,
  "license-key-instances": defaultLicenseKeyInstances,
  "license_key_instances": defaultLicenseKeyInstances,
  "license-key-instance": defaultLicenseKeyInstances,
  "webhooks": defaultWebhooks,
  "webhook": defaultWebhooks,
};
