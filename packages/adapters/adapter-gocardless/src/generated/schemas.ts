// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-gocardless generate
import { generateId } from '@mimicai/adapter-sdk';

export function defaultCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("CU", 8),
    "created_at": new Date().toISOString(),
    "email": null,
    "given_name": null,
    "family_name": null,
    "company_name": null,
    "address_line1": null,
    "address_line2": null,
    "address_line3": null,
    "city": null,
    "region": null,
    "postal_code": null,
    "country_code": null,
    "language": null,
    "phone_number": null,
    "swedish_identity_number": null,
    "danish_identity_number": null,
    "metadata": {},
    ...overrides,
  };
}

export function defaultCustomerBankAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("BA", 8),
    "created_at": new Date().toISOString(),
    "account_holder_name": null,
    "account_number_ending": null,
    "account_type": "savings",
    "country_code": null,
    "currency": null,
    "bank_name": null,
    "bank_account_token": null,
    "enabled": false,
    "metadata": {},
    "links": {},
    ...overrides,
  };
}

export function defaultMandate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("MD", 8),
    "created_at": new Date().toISOString(),
    "reference": null,
    "status": "pending_submission",
    "scheme": null,
    "next_possible_charge_date": new Date().toISOString(),
    "next_possible_standard_ach_charge_date": new Date().toISOString(),
    "payments_require_approval": false,
    "verified_at": new Date().toISOString(),
    "metadata": {},
    "links": {},
    "consent_parameters": null,
    "authorisation_source": "web",
    "funds_settlement": "managed",
    "consent_type": "one_off",
    ...overrides,
  };
}

export function defaultPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("PM", 8),
    "created_at": new Date().toISOString(),
    "amount": null,
    "amount_refunded": null,
    "currency": "AUD",
    "description": null,
    "charge_date": new Date(Date.now() + 5 * 86400_000).toISOString().split('T')[0]!,
    "reference": null,
    "metadata": {},
    "status": "pending_submission",
    "links": {},
    "faster_ach": null,
    "fx": {},
    "retry_if_possible": true,
    "scheme": null,
    ...overrides,
  };
}

export function defaultSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("SB", 8),
    "created_at": new Date().toISOString(),
    "amount": null,
    "name": null,
    "start_date": new Date(Date.now() + 5 * 86400_000).toISOString().split('T')[0]!,
    "end_date": new Date().toISOString(),
    "interval": null,
    "interval_unit": "weekly",
    "day_of_month": null,
    "currency": null,
    "month": "january",
    "count": null,
    "payment_reference": null,
    "metadata": {},
    "status": "active",
    "upcoming_payments": [],
    "app_fee": null,
    "links": {},
    "retry_if_possible": true,
    "earliest_charge_date_after_resume": new Date().toISOString(),
    "parent_plan_paused": false,
    ...overrides,
  };
}

export function defaultRefund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("RF", 8),
    "created_at": new Date().toISOString(),
    "amount": null,
    "currency": null,
    "status": "created",
    "reference": null,
    "metadata": {},
    "links": {},
    "fx": {},
    ...overrides,
  };
}

export function defaultPayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("PO", 8),
    "created_at": new Date().toISOString(),
    "amount": null,
    "deducted_fees": null,
    "currency": "AUD",
    "reference": null,
    "status": "pending",
    "payout_type": "merchant",
    "arrival_date": new Date(Date.now() + 5 * 86400_000).toISOString().split('T')[0]!,
    "links": {},
    "fx": {},
    "tax_currency": null,
    "metadata": {},
    ...overrides,
  };
}

export function defaultCreditor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("CR", 8),
    "created_at": new Date().toISOString(),
    "name": null,
    "address_line1": null,
    "address_line2": null,
    "address_line3": null,
    "city": null,
    "region": null,
    "postal_code": null,
    "country_code": null,
    "can_create_refunds": false,
    "bank_reference_prefix": null,
    "links": {},
    "scheme_identifiers": [],
    "logo_url": null,
    "verification_status": "successful",
    "merchant_responsible_for_notifications": false,
    "mandate_imports_enabled": false,
    "custom_payment_pages_enabled": false,
    "fx_payout_currency": "AUD",
    "creditor_type": "company",
    ...overrides,
  };
}

export function defaultCreditorBankAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("BA", 8),
    "created_at": new Date().toISOString(),
    "account_holder_name": null,
    "account_number_ending": null,
    "account_type": "savings",
    "country_code": null,
    "currency": null,
    "bank_name": null,
    "enabled": false,
    "metadata": {},
    "links": {},
    "verification_status": "pending",
    ...overrides,
  };
}

export function defaultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("EV", 8),
    "created_at": new Date().toISOString(),
    "resource_type": "billing_requests",
    "action": null,
    "customer_notifications": null,
    "details": {},
    "metadata": {},
    "resource_metadata": {},
    "source": {},
    "links": {},
    ...overrides,
  };
}

export function defaultBillingRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("BRQ", 8),
    "purpose_code": "mortgage",
    "payment_purpose_code": null,
    "payment_context_code": "billing_goods_and_services_in_advance",
    "created_at": new Date().toISOString(),
    "status": "pending",
    "metadata": {},
    "mandate_request": {},
    "payment_request": {},
    "subscription_request": null,
    "instalment_schedule_request": null,
    "actions": [],
    "resources": {},
    "links": {},
    "fallback_enabled": false,
    "fallback_occurred": false,
    ...overrides,
  };
}

export function defaultInstalmentSchedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("IS", 8),
    "created_at": new Date().toISOString(),
    "total_amount": null,
    "name": null,
    "currency": "AUD",
    "metadata": {},
    "status": "pending",
    "payment_errors": {},
    "links": {},
    ...overrides,
  };
}

export function defaultRedirectFlow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("RE", 8),
    "description": null,
    "session_token": null,
    "scheme": "ach",
    "success_redirect_url": null,
    "confirmation_url": null,
    "redirect_url": null,
    "created_at": new Date().toISOString(),
    "links": {},
    "metadata": {},
    "mandate_reference": null,
    ...overrides,
  };
}

export function defaultPayoutItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": null,
    "type": "payment_paid_out",
    "taxes": [],
    "links": {},
    ...overrides,
  };
}

export function defaultSchemeIdentifier(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("SU", 8),
    "created_at": new Date().toISOString(),
    "name": null,
    "scheme": "ach",
    "reference": null,
    "status": "pending",
    "minimum_advance_notice": 0,
    "can_specify_mandate_reference": false,
    "currency": "AUD",
    "address_line1": null,
    "address_line2": null,
    "address_line3": null,
    "city": null,
    "region": null,
    "postal_code": null,
    "country_code": null,
    "email": null,
    "phone_number": null,
    ...overrides,
  };
}

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "customer": defaultCustomer,
  "customers": defaultCustomer,
  "customer_bank_account": defaultCustomerBankAccount,
  "customer_bank_accounts": defaultCustomerBankAccount,
  "mandate": defaultMandate,
  "mandates": defaultMandate,
  "payment": defaultPayment,
  "payments": defaultPayment,
  "subscription": defaultSubscription,
  "subscriptions": defaultSubscription,
  "refund": defaultRefund,
  "refunds": defaultRefund,
  "payout": defaultPayout,
  "payouts": defaultPayout,
  "creditor": defaultCreditor,
  "creditors": defaultCreditor,
  "creditor_bank_account": defaultCreditorBankAccount,
  "creditor_bank_accounts": defaultCreditorBankAccount,
  "event": defaultEvent,
  "events": defaultEvent,
  "billing_request": defaultBillingRequest,
  "billing_requests": defaultBillingRequest,
  "instalment_schedule": defaultInstalmentSchedule,
  "instalment_schedules": defaultInstalmentSchedule,
  "redirect_flow": defaultRedirectFlow,
  "redirect_flows": defaultRedirectFlow,
  "payout_item": defaultPayoutItem,
  "payout_items": defaultPayoutItem,
  "scheme_identifier": defaultSchemeIdentifier,
  "scheme_identifiers": defaultSchemeIdentifier,
};
