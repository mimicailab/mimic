// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-plaid generate
import { generateId } from '@mimicai/adapter-sdk';

/**
 * Returns a complete Plaid object with all fields defaulted to spec-faithful values.
 * The caller merges request body fields on top of this default skeleton.
 */

export function defaultItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "item_id": generateId("item_", 14),
    "institution_id": null,
    "institution_name": null,
    "webhook": "",
    "auth_method": "INSTANT_AUTH",
    "error": null,
    "available_products": [],
    "billed_products": [],
    "products": [],
    "consented_products": [],
    "consent_expiration_time": null,
    "update_type": "background",
    ...overrides,
  };
}

export function defaultAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_id": generateId("acc_", 14),
    "balances": {"available":0,"current":0,"limit":0,"iso_currency_code":"","unofficial_currency_code":"","last_updated_datetime":null},
    "mask": "",
    "name": "",
    "official_name": "",
    "type": "investment",
    "subtype": "401a",
    "verification_status": null,
    "verification_name": null,
    "verification_insights": {"name_match_score":null,"network_status":{},"previous_returns":{},"account_number_format":"valid"},
    "persistent_account_id": null,
    "holder_category": "business",
    ...overrides,
  };
}

export function defaultTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_id": "",
    "amount": 0,
    "iso_currency_code": "",
    "unofficial_currency_code": "",
    "category": null,
    "category_id": null,
    "check_number": null,
    "date": new Date().toISOString().split('T')[0]!,
    "location": {"address":"","city":"","region":"","postal_code":"","country":"","lat":0,"lon":0,"store_number":""},
    "name": "",
    "merchant_name": null,
    "original_description": null,
    "payment_meta": {"reference_number":"","ppd_id":"","payee":"","by_order_of":"","payer":"","payment_method":"","payment_processor":"","reason":""},
    "pending": false,
    "pending_transaction_id": "",
    "account_owner": "",
    "transaction_id": generateId("txn_", 14),
    "transaction_type": "digital",
    "logo_url": null,
    "website": null,
    "authorized_date": new Date().toISOString().split('T')[0]!,
    "authorized_datetime": new Date().toISOString().split('T')[0]!,
    "datetime": new Date().toISOString().split('T')[0]!,
    "payment_channel": "online",
    "personal_finance_category": null,
    "business_finance_category": null,
    "transaction_code": "adjustment",
    "personal_finance_category_icon_url": null,
    "counterparties": [],
    "merchant_entity_id": null,
    "client_customization": null,
    ...overrides,
  };
}

export function defaultInstitution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "institution_id": generateId("ins_", 14),
    "name": "",
    "products": [],
    "country_codes": [],
    "url": null,
    "primary_color": null,
    "logo": null,
    "routing_numbers": [],
    "dtc_numbers": [],
    "oauth": false,
    "status": null,
    "payment_initiation_metadata": null,
    "auth_metadata": null,
    ...overrides,
  };
}

export function defaultHolding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_id": "",
    "security_id": "",
    "institution_price": 0,
    "institution_price_as_of": new Date().toISOString().split('T')[0]!,
    "institution_price_datetime": new Date().toISOString().split('T')[0]!,
    "institution_value": 0,
    "cost_basis": 0,
    "quantity": 0,
    "iso_currency_code": "",
    "unofficial_currency_code": "",
    "vested_quantity": null,
    "vested_value": null,
    ...overrides,
  };
}

export function defaultSecurity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "security_id": generateId("sec_", 14),
    "isin": "",
    "cusip": "",
    "sedol": "",
    "institution_security_id": "",
    "institution_id": "",
    "proxy_security_id": "",
    "name": "",
    "ticker_symbol": "",
    "is_cash_equivalent": false,
    "type": "",
    "subtype": null,
    "close_price": 0,
    "close_price_as_of": new Date().toISOString().split('T')[0]!,
    "update_datetime": new Date().toISOString().split('T')[0]!,
    "iso_currency_code": "",
    "unofficial_currency_code": "",
    "market_identifier_code": "",
    "sector": "",
    "industry": "",
    "option_contract": {"contract_type":"","expiration_date":"","strike_price":0,"underlying_security_ticker":""},
    "fixed_income": {"yield_rate":{},"maturity_date":"","issue_date":"","face_value":0},
    ...overrides,
  };
}

export function defaultInvestmentTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "investment_transaction_id": generateId("inv_txn_", 14),
    "cancel_transaction_id": null,
    "account_id": "",
    "security_id": "",
    "date": new Date().toISOString().split('T')[0]!,
    "transaction_datetime": new Date().toISOString().split('T')[0]!,
    "name": "",
    "quantity": 0,
    "amount": 0,
    "price": 0,
    "fees": 0,
    "type": "buy",
    "subtype": "account fee",
    "iso_currency_code": "",
    "unofficial_currency_code": "",
    ...overrides,
  };
}

export function defaultIdentity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_id": generateId("acc_", 14),
    "balances": {"available":0,"current":0,"limit":0,"iso_currency_code":"","unofficial_currency_code":"","last_updated_datetime":null},
    "mask": "",
    "name": "",
    "official_name": "",
    "type": "investment",
    "subtype": "401a",
    "verification_status": "automatically_verified",
    "verification_name": null,
    "verification_insights": {"name_match_score":null,"network_status":{},"previous_returns":{},"account_number_format":"valid"},
    "persistent_account_id": null,
    "holder_category": "business",
    "owners": [],
    ...overrides,
  };
}

export function defaultLinkToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "link_token": generateId("link-sandbox-", 14),
    "expiration": new Date(Date.now() + 4 * 3600_000).toISOString(),
    "request_id": "",
    "hosted_link_url": null,
    "user_id": null,
    ...overrides,
  };
}

export function defaultAssetReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "asset_report_id": generateId("ar_", 14),
    "insights": null,
    "client_report_id": "",
    "date_generated": new Date().toISOString().split('T')[0]!,
    "days_requested": 0,
    "user": {"client_user_id":null,"first_name":null,"middle_name":null,"last_name":null,"ssn":null,"phone_number":null,"email":null},
    "items": [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lookup map: resourceId → default factory
// ---------------------------------------------------------------------------

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "item": defaultItem,
  "items": defaultItem,
  "account": defaultAccount,
  "accounts": defaultAccount,
  "transaction": defaultTransaction,
  "transactions": defaultTransaction,
  "institution": defaultInstitution,
  "institutions": defaultInstitution,
  "holding": defaultHolding,
  "holdings": defaultHolding,
  "security": defaultSecurity,
  "securities": defaultSecurity,
  "investment_transaction": defaultInvestmentTransaction,
  "investment_transactions": defaultInvestmentTransaction,
  "identity": defaultIdentity,
  "identities": defaultIdentity,
  "link_token": defaultLinkToken,
  "link_tokens": defaultLinkToken,
  "asset_report": defaultAssetReport,
  "asset_reports": defaultAssetReport,
};
