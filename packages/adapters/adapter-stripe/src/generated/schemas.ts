// !! AUTO-GENERATED — do not edit. Run: pnpm --filter @mimicai/adapter-stripe generate
import { unixNow, generateId } from '@mimicai/adapter-sdk';

/**
 * Returns a complete Stripe object with all fields defaulted to spec-faithful values.
 * The caller merges request body fields on top of this default skeleton.
 */

export function defaultAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "business_profile": null,
    "business_type": "company",
    "capabilities": {"acss_debit_payments":"active","affirm_payments":"active","afterpay_clearpay_payments":"active","alma_payments":"active","amazon_pay_payments":"active","au_becs_debit_payments":"active","bacs_debit_payments":"active","bancontact_payments":"active","bank_transfer_payments":"active","billie_payments":"active","blik_payments":"active","boleto_payments":"active","card_issuing":"active","card_payments":"active","cartes_bancaires_payments":"active","cashapp_payments":"active","crypto_payments":"active","eps_payments":"active","fpx_payments":"active","gb_bank_transfer_payments":"active","giropay_payments":"active","grabpay_payments":"active","ideal_payments":"active","india_international_payments":"active","jcb_payments":"active","jp_bank_transfer_payments":"active","kakao_pay_payments":"active","klarna_payments":"active","konbini_payments":"active","kr_card_payments":"active","legacy_payments":"active","link_payments":"active","mb_way_payments":"active","mobilepay_payments":"active","multibanco_payments":"active","mx_bank_transfer_payments":"active","naver_pay_payments":"active","nz_bank_account_becs_debit_payments":"active","oxxo_payments":"active","p24_payments":"active","pay_by_bank_payments":"active","payco_payments":"active","paynow_payments":"active","payto_payments":"active","pix_payments":"active","promptpay_payments":"active","revolut_pay_payments":"active","samsung_pay_payments":"active","satispay_payments":"active","sepa_bank_transfer_payments":"active","sepa_debit_payments":"active","sofort_payments":"active","swish_payments":"active","tax_reporting_us_1099_k":"active","tax_reporting_us_1099_misc":"active","transfers":"active","treasury":"active","twint_payments":"active","us_bank_account_ach_payments":"active","us_bank_transfer_payments":"active","zip_payments":"active"},
    "charges_enabled": false,
    "company": {"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"address_kana":null,"address_kanji":null,"directors_provided":false,"directorship_declaration":null,"executives_provided":false,"export_license_id":"","export_purpose_code":"","name":null,"name_kana":null,"name_kanji":null,"owners_provided":false,"ownership_declaration":null,"ownership_exemption_reason":"qualified_entity_exceeds_ownership_threshold","phone":null,"registration_date":{"day":null,"month":null,"year":null},"representative_declaration":null,"structure":"free_zone_establishment","tax_id_provided":false,"tax_id_registrar":"","vat_id_provided":false,"verification":null},
    "controller": {"fees":{"payer":"account"},"is_controller":false,"losses":{"payments":"application"},"requirement_collection":"application","stripe_dashboard":{"type":"express"},"type":"account"},
    "country": null,
    "created": unixNow(),
    "default_currency": null,
    "details_submitted": false,
    "email": null,
    "external_accounts": {"data":[],"has_more":false,"object":"list","url":""},
    "future_requirements": {"alternatives":null,"current_deadline":null,"currently_due":null,"disabled_reason":null,"errors":null,"eventually_due":null,"past_due":null,"pending_verification":null},
    "groups": null,
    "id": generateId("acct_", 14),
    "individual": {"account":"","additional_tos_acceptances":{"account":null},"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"address_kana":null,"address_kanji":null,"created":0,"dob":{"day":null,"month":null,"year":null},"email":null,"first_name":null,"first_name_kana":null,"first_name_kanji":null,"full_name_aliases":[],"future_requirements":null,"gender":null,"id":"","id_number_provided":false,"id_number_secondary_provided":false,"last_name":null,"last_name_kana":null,"last_name_kanji":null,"maiden_name":null,"metadata":{},"nationality":null,"object":"person","phone":null,"political_exposure":"existing","registered_address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"relationship":{"authorizer":null,"director":null,"executive":null,"legal_guardian":null,"owner":null,"percent_ownership":null,"representative":null,"title":null},"requirements":null,"ssn_last_4_provided":false,"us_cfpb_data":null,"verification":{"additional_document":null,"details":null,"details_code":null,"document":null,"status":""}},
    "metadata": {},
    "object": "account",
    "payouts_enabled": false,
    "requirements": {"alternatives":null,"current_deadline":null,"currently_due":null,"disabled_reason":null,"errors":null,"eventually_due":null,"past_due":null,"pending_verification":null},
    "settings": null,
    "tos_acceptance": {"date":null,"ip":null,"service_agreement":"","user_agent":null},
    "type": "custom",
    ...overrides,
  };
}

export function defaultAccountLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "expires_at": undefined,
    "object": "account_link",
    "url": "",
    ...overrides,
  };
}

export function defaultAccountSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": "",
    "client_secret": "",
    "components": {"account_management":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"external_account_collection":false}},"account_onboarding":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"external_account_collection":false}},"balances":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"edit_payout_schedule":false,"external_account_collection":false,"instant_payouts":false,"standard_payouts":false}},"disputes_list":{"enabled":false,"features":{"capture_payments":false,"destination_on_behalf_of_charge_management":false,"dispute_management":false,"refund_management":false}},"documents":{"enabled":false,"features":{}},"financial_account":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"external_account_collection":false,"send_money":false,"transfer_balance":false}},"financial_account_transactions":{"enabled":false,"features":{"card_spend_dispute_management":false}},"instant_payouts_promotion":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"external_account_collection":false,"instant_payouts":false}},"issuing_card":{"enabled":false,"features":{"card_management":false,"card_spend_dispute_management":false,"cardholder_management":false,"spend_control_management":false}},"issuing_cards_list":{"enabled":false,"features":{"card_management":false,"card_spend_dispute_management":false,"cardholder_management":false,"disable_stripe_user_authentication":false,"spend_control_management":false}},"notification_banner":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"external_account_collection":false}},"payment_details":{"enabled":false,"features":{"capture_payments":false,"destination_on_behalf_of_charge_management":false,"dispute_management":false,"refund_management":false}},"payment_disputes":{"enabled":false,"features":{"destination_on_behalf_of_charge_management":false,"dispute_management":false,"refund_management":false}},"payments":{"enabled":false,"features":{"capture_payments":false,"destination_on_behalf_of_charge_management":false,"dispute_management":false,"refund_management":false}},"payout_details":{"enabled":false,"features":{}},"payouts":{"enabled":false,"features":{"disable_stripe_user_authentication":false,"edit_payout_schedule":false,"external_account_collection":false,"instant_payouts":false,"standard_payouts":false}},"payouts_list":{"enabled":false,"features":{}},"tax_registrations":{"enabled":false,"features":{}},"tax_settings":{"enabled":false,"features":{}}},
    "expires_at": undefined,
    "livemode": false,
    "object": "account_session",
    ...overrides,
  };
}

export function defaultApplePayDomain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "domain_name": "",
    "id": generateId("apwc_", 14),
    "livemode": false,
    "object": "apple_pay_domain",
    ...overrides,
  };
}

export function defaultApplicationFee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": "",
    "amount": 0,
    "amount_refunded": 0,
    "application": "",
    "balance_transaction": null,
    "charge": "",
    "created": unixNow(),
    "currency": "",
    "fee_source": null,
    "id": generateId("fee_", 14),
    "livemode": false,
    "object": "application_fee",
    "originating_transaction": null,
    "refunded": false,
    "refunds": {"data":[],"has_more":false,"object":"list","url":""},
    ...overrides,
  };
}

export function defaultAppsSecret(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "deleted": false,
    "expires_at": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "name": "",
    "object": "apps.secret",
    "payload": null,
    "scope": {"type":"account","user":""},
    ...overrides,
  };
}

export function defaultBalance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "available": [],
    "connect_reserved": [],
    "instant_available": [],
    "issuing": {"available":[]},
    "livemode": false,
    "object": "balance",
    "pending": [],
    "refund_and_dispute_prefunding": {"available":[],"pending":[]},
    ...overrides,
  };
}

export function defaultBalanceSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "object": "balance_settings",
    "payments": {"debit_negative_balances":null,"payouts":null,"settlement_timing":{"delay_days":0,"delay_days_override":0}},
    ...overrides,
  };
}

export function defaultBalanceTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "available_on": undefined,
    "balance_type": "issuing",
    "created": unixNow(),
    "currency": "",
    "description": null,
    "exchange_rate": null,
    "fee": 0,
    "fee_details": [],
    "id": generateId("txn_", 14),
    "net": 0,
    "object": "balance_transaction",
    "reporting_category": "",
    "source": null,
    "status": "",
    "type": "adjustment",
    ...overrides,
  };
}

export function defaultBankAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": null,
    "account_holder_name": null,
    "account_holder_type": null,
    "account_type": null,
    "available_payout_methods": null,
    "bank_name": null,
    "country": "",
    "currency": "",
    "customer": null,
    "default_for_currency": null,
    "fingerprint": null,
    "future_requirements": null,
    "id": generateId("ba_", 14),
    "last4": "",
    "metadata": {},
    "object": "bank_account",
    "requirements": null,
    "routing_number": null,
    "status": "",
    ...overrides,
  };
}

export function defaultBillingAlert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "alert_type": "usage_threshold",
    "id": generateId("", 14),
    "livemode": false,
    "object": "billing.alert",
    "status": "active",
    "title": "",
    "usage_threshold": null,
    ...overrides,
  };
}

export function defaultBillingCreditBalanceSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "balances": [],
    "customer": "",
    "customer_account": null,
    "livemode": false,
    "object": "billing.credit_balance_summary",
    ...overrides,
  };
}

export function defaultBillingCreditBalanceTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "credit": null,
    "credit_grant": "",
    "debit": null,
    "effective_at": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "object": "billing.credit_balance_transaction",
    "test_clock": null,
    "type": "credit",
    ...overrides,
  };
}

export function defaultBillingCreditGrant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": {"monetary":null,"type":"monetary"},
    "applicability_config": {"scope":{"price_type":"metered","prices":[]}},
    "category": "paid",
    "created": unixNow(),
    "customer": "",
    "customer_account": null,
    "effective_at": undefined,
    "expires_at": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "name": null,
    "object": "billing.credit_grant",
    "priority": null,
    "test_clock": null,
    "updated": undefined,
    "voided_at": undefined,
    ...overrides,
  };
}

export function defaultBillingMeter(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "customer_mapping": {"event_payload_key":"","type":"by_id"},
    "default_aggregation": {"formula":"count"},
    "display_name": "",
    "event_name": "",
    "event_time_window": "day",
    "id": generateId("", 14),
    "livemode": false,
    "object": "billing.meter",
    "status": "active",
    "status_transitions": {"deactivated_at":null},
    "updated": undefined,
    "value_settings": {"event_payload_key":""},
    ...overrides,
  };
}

export function defaultBillingMeterEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "event_name": "",
    "identifier": "",
    "livemode": false,
    "object": "billing.meter_event",
    "payload": {},
    "timestamp": undefined,
    ...overrides,
  };
}

export function defaultBillingMeterEventAdjustment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "cancel": null,
    "event_name": "",
    "livemode": false,
    "object": "billing.meter_event_adjustment",
    "status": "complete",
    "type": "cancel",
    ...overrides,
  };
}

export function defaultBillingMeterEventSummary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "aggregated_value": 0,
    "end_time": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "meter": "",
    "object": "billing.meter_event_summary",
    "start_time": undefined,
    ...overrides,
  };
}

export function defaultBillingPortalConfiguration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "application": null,
    "business_profile": {"headline":null,"privacy_policy_url":null,"terms_of_service_url":null},
    "created": unixNow(),
    "default_return_url": null,
    "features": {"customer_update":{"allowed_updates":[],"enabled":false},"invoice_history":{"enabled":false},"payment_method_update":{"enabled":false,"payment_method_configuration":null},"subscription_cancel":{"cancellation_reason":{"enabled":false,"options":[]},"enabled":false,"mode":"at_period_end","proration_behavior":"always_invoice"},"subscription_update":{"billing_cycle_anchor":null,"default_allowed_updates":[],"enabled":false,"products":null,"proration_behavior":"always_invoice","schedule_at_period_end":{"conditions":[]},"trial_update_behavior":"continue_trial"}},
    "id": generateId("", 14),
    "is_default": false,
    "livemode": false,
    "login_page": {"enabled":false,"url":null},
    "metadata": {},
    "name": null,
    "object": "billing_portal.configuration",
    "updated": undefined,
    ...overrides,
  };
}

export function defaultBillingPortalSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "configuration": "",
    "created": unixNow(),
    "customer": "",
    "customer_account": null,
    "flow": null,
    "id": generateId("", 14),
    "livemode": false,
    "locale": "auto",
    "object": "billing_portal.session",
    "on_behalf_of": null,
    "return_url": null,
    "url": "",
    ...overrides,
  };
}

export function defaultCapability(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": "",
    "future_requirements": {"alternatives":null,"current_deadline":null,"currently_due":[],"disabled_reason":null,"errors":[],"eventually_due":[],"past_due":[],"pending_verification":[]},
    "id": generateId("", 14),
    "object": "capability",
    "requested": false,
    "requested_at": undefined,
    "requirements": {"alternatives":null,"current_deadline":null,"currently_due":[],"disabled_reason":null,"errors":[],"eventually_due":[],"past_due":[],"pending_verification":[]},
    "status": "active",
    ...overrides,
  };
}

export function defaultCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": null,
    "address_city": null,
    "address_country": null,
    "address_line1": null,
    "address_line1_check": null,
    "address_line2": null,
    "address_state": null,
    "address_zip": null,
    "address_zip_check": null,
    "allow_redisplay": "always",
    "available_payout_methods": null,
    "brand": "",
    "country": null,
    "currency": null,
    "customer": null,
    "cvc_check": null,
    "default_for_currency": null,
    "dynamic_last4": null,
    "exp_month": 0,
    "exp_year": 0,
    "fingerprint": null,
    "funding": "",
    "id": generateId("card_", 14),
    "iin": null,
    "last4": "",
    "metadata": {},
    "name": null,
    "networks": {"preferred":null},
    "object": "card",
    "regulated_status": "regulated",
    "status": null,
    "tokenization_method": null,
    ...overrides,
  };
}

export function defaultCashBalance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "available": null,
    "customer": "",
    "customer_account": null,
    "livemode": false,
    "object": "cash_balance",
    "settings": {"reconciliation_mode":"automatic","using_merchant_default":false},
    ...overrides,
  };
}

export function defaultCharge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_captured": 0,
    "amount_refunded": 0,
    "application": null,
    "application_fee": null,
    "application_fee_amount": 0,
    "balance_transaction": null,
    "billing_details": {"address":null,"email":null,"name":null,"phone":null,"tax_id":null},
    "calculated_statement_descriptor": null,
    "captured": false,
    "created": unixNow(),
    "currency": "",
    "customer": null,
    "description": null,
    "disputed": false,
    "failure_balance_transaction": null,
    "failure_code": null,
    "failure_message": null,
    "fraud_details": null,
    "id": generateId("ch_", 14),
    "livemode": false,
    "metadata": {},
    "object": "charge",
    "on_behalf_of": null,
    "outcome": null,
    "paid": false,
    "payment_intent": null,
    "payment_method": null,
    "payment_method_details": null,
    "presentment_details": {"presentment_amount":0,"presentment_currency":""},
    "radar_options": {"session":""},
    "receipt_email": null,
    "receipt_number": null,
    "receipt_url": null,
    "refunded": false,
    "refunds": null,
    "review": null,
    "shipping": null,
    "source_transfer": null,
    "statement_descriptor": null,
    "statement_descriptor_suffix": null,
    "status": "failed",
    "transfer": null,
    "transfer_data": null,
    "transfer_group": null,
    ...overrides,
  };
}

export function defaultCheckoutSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "adaptive_pricing": null,
    "after_expiration": null,
    "allow_promotion_codes": null,
    "amount_subtotal": null,
    "amount_total": null,
    "automatic_tax": {"enabled":false,"liability":null,"provider":null,"status":null},
    "billing_address_collection": "auto",
    "branding_settings": {"background_color":"","border_style":"pill","button_color":"","display_name":"","font_family":"","icon":null,"logo":null},
    "cancel_url": null,
    "client_reference_id": null,
    "client_secret": null,
    "collected_information": null,
    "consent": null,
    "consent_collection": null,
    "created": unixNow(),
    "currency": null,
    "currency_conversion": null,
    "custom_fields": [],
    "custom_text": {"after_submit":null,"shipping_address":null,"submit":null,"terms_of_service_acceptance":null},
    "customer": null,
    "customer_account": null,
    "customer_creation": "always",
    "customer_details": null,
    "customer_email": null,
    "discounts": null,
    "excluded_payment_method_types": [],
    "expires_at": undefined,
    "id": generateId("", 14),
    "invoice": null,
    "invoice_creation": null,
    "line_items": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "locale": "auto",
    "metadata": {},
    "mode": "payment",
    "name_collection": {"business":{"enabled":false,"optional":false},"individual":{"enabled":false,"optional":false}},
    "object": "checkout.session",
    "optional_items": null,
    "origin_context": "mobile_app",
    "payment_intent": null,
    "payment_link": null,
    "payment_method_collection": "always",
    "payment_method_configuration_details": null,
    "payment_method_options": null,
    "payment_method_types": [],
    "payment_status": "no_payment_required",
    "permissions": null,
    "phone_number_collection": {"enabled":false},
    "presentment_details": {"presentment_amount":0,"presentment_currency":""},
    "recovered_from": null,
    "redirect_on_completion": "always",
    "return_url": null,
    "saved_payment_method_options": null,
    "setup_intent": null,
    "shipping_address_collection": null,
    "shipping_cost": null,
    "shipping_options": [],
    "status": "complete",
    "submit_type": "auto",
    "subscription": null,
    "success_url": null,
    "tax_id_collection": {"enabled":false,"required":"if_supported"},
    "total_details": null,
    "ui_mode": "custom",
    "url": null,
    "wallet_options": null,
    ...overrides,
  };
}

export function defaultClimateOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount_fees": 0,
    "amount_subtotal": 0,
    "amount_total": 0,
    "beneficiary": {"public_name":""},
    "canceled_at": undefined,
    "cancellation_reason": "expired",
    "certificate": null,
    "confirmed_at": undefined,
    "created": unixNow(),
    "currency": "",
    "delayed_at": undefined,
    "delivered_at": undefined,
    "delivery_details": [],
    "expected_delivery_year": 0,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "metric_tons": "",
    "object": "climate.order",
    "product": "",
    "product_substituted_at": undefined,
    "status": "awaiting_funds",
    ...overrides,
  };
}

export function defaultClimateProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "current_prices_per_metric_ton": {},
    "delivery_year": null,
    "id": generateId("", 14),
    "livemode": false,
    "metric_tons_available": "",
    "name": "",
    "object": "climate.product",
    "suppliers": [],
    ...overrides,
  };
}

export function defaultClimateSupplier(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("", 14),
    "info_url": "",
    "livemode": false,
    "locations": [],
    "name": "",
    "object": "climate.supplier",
    "removal_pathway": "biomass_carbon_removal_and_storage",
    ...overrides,
  };
}

export function defaultConfirmationToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "expires_at": undefined,
    "id": generateId("ctoken_", 14),
    "livemode": false,
    "mandate_data": null,
    "object": "confirmation_token",
    "payment_intent": null,
    "payment_method_options": null,
    "payment_method_preview": null,
    "return_url": null,
    "setup_future_usage": "off_session",
    "setup_intent": null,
    "shipping": null,
    "use_stripe_sdk": false,
    ...overrides,
  };
}

export function defaultCountrySpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "default_currency": "",
    "id": generateId("", 14),
    "object": "country_spec",
    "supported_bank_account_currencies": {},
    "supported_payment_currencies": [],
    "supported_payment_methods": [],
    "supported_transfer_countries": [],
    "verification_fields": {"company":{"additional":[],"minimum":[]},"individual":{"additional":[],"minimum":[]}},
    ...overrides,
  };
}

export function defaultCoupon(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount_off": 0,
    "applies_to": {"products":[]},
    "created": unixNow(),
    "currency": null,
    "currency_options": {},
    "duration": "forever",
    "duration_in_months": null,
    "id": generateId("", 14),
    "livemode": false,
    "max_redemptions": null,
    "metadata": {},
    "name": null,
    "object": "coupon",
    "percent_off": null,
    "redeem_by": undefined,
    "times_redeemed": 0,
    "valid": true,
    ...overrides,
  };
}

export function defaultCreditNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_shipping": 0,
    "created": unixNow(),
    "currency": "",
    "customer": "",
    "customer_account": null,
    "customer_balance_transaction": null,
    "discount_amount": 0,
    "discount_amounts": [],
    "effective_at": undefined,
    "id": generateId("cn_", 14),
    "invoice": "",
    "lines": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "memo": null,
    "metadata": {},
    "number": "",
    "object": "credit_note",
    "out_of_band_amount": null,
    "pdf": "",
    "post_payment_amount": 0,
    "pre_payment_amount": 0,
    "pretax_credit_amounts": [],
    "reason": "duplicate",
    "refunds": [],
    "shipping_cost": null,
    "status": "issued",
    "subtotal": 0,
    "subtotal_excluding_tax": null,
    "total": 0,
    "total_excluding_tax": null,
    "total_taxes": null,
    "type": "mixed",
    "voided_at": undefined,
    ...overrides,
  };
}

export function defaultCreditNoteLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "description": null,
    "discount_amount": 0,
    "discount_amounts": [],
    "id": generateId("", 14),
    "invoice_line_item": null,
    "livemode": false,
    "object": "credit_note_line_item",
    "pretax_credit_amounts": [],
    "quantity": null,
    "tax_rates": [],
    "taxes": null,
    "type": "custom_line_item",
    "unit_amount": 0,
    "unit_amount_decimal": null,
    ...overrides,
  };
}

export function defaultCustomer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "address": null,
    "balance": 0,
    "business_name": null,
    "cash_balance": null,
    "created": unixNow(),
    "currency": null,
    "customer_account": null,
    "default_source": null,
    "delinquent": null,
    "description": null,
    "discount": null,
    "email": null,
    "id": generateId("cus_", 14),
    "individual_name": null,
    "invoice_credit_balance": {},
    "invoice_prefix": null,
    "invoice_settings": {"custom_fields":null,"default_payment_method":null,"footer":null,"rendering_options":null},
    "livemode": false,
    "metadata": {},
    "name": null,
    "next_invoice_sequence": 0,
    "object": "customer",
    "phone": null,
    "preferred_locales": null,
    "shipping": null,
    "sources": {"data":[],"has_more":false,"object":"list","url":""},
    "subscriptions": {"data":[],"has_more":false,"object":"list","url":""},
    "tax": {"automatic_tax":"failed","ip_address":null,"location":null,"provider":"anrok"},
    "tax_exempt": "exempt",
    "tax_ids": {"data":[],"has_more":false,"object":"list","url":""},
    "test_clock": null,
    ...overrides,
  };
}

export function defaultCustomerBalanceTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "checkout_session": null,
    "created": unixNow(),
    "credit_note": null,
    "currency": "",
    "customer": "",
    "customer_account": null,
    "description": null,
    "ending_balance": 0,
    "id": generateId("cbtxn_", 14),
    "invoice": null,
    "livemode": false,
    "metadata": {},
    "object": "customer_balance_transaction",
    "type": "adjustment",
    ...overrides,
  };
}

export function defaultCustomerCashBalanceTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "adjusted_for_overdraft": {"balance_transaction":"","linked_transaction":""},
    "applied_to_payment": {"payment_intent":""},
    "created": unixNow(),
    "currency": "",
    "customer": "",
    "customer_account": null,
    "ending_balance": 0,
    "funded": {"bank_transfer":{"eu_bank_transfer":{"bic":null,"iban_last4":null,"sender_name":null},"gb_bank_transfer":{"account_number_last4":null,"sender_name":null,"sort_code":null},"jp_bank_transfer":{"sender_bank":null,"sender_branch":null,"sender_name":null},"reference":null,"type":"eu_bank_transfer","us_bank_transfer":{"network":"ach","sender_name":null}}},
    "id": generateId("ccsbtxn_", 14),
    "livemode": false,
    "net_amount": 0,
    "object": "customer_cash_balance_transaction",
    "refunded_from_payment": {"refund":""},
    "transferred_to_balance": {"balance_transaction":""},
    "type": "adjusted_for_overdraft",
    "unapplied_from_payment": {"payment_intent":""},
    ...overrides,
  };
}

export function defaultCustomerSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "client_secret": "",
    "components": {"buy_button":{"enabled":false},"customer_sheet":{"enabled":false,"features":null},"mobile_payment_element":{"enabled":false,"features":null},"payment_element":{"enabled":false,"features":null},"pricing_table":{"enabled":false}},
    "created": unixNow(),
    "customer": "",
    "customer_account": null,
    "expires_at": undefined,
    "livemode": false,
    "object": "customer_session",
    ...overrides,
  };
}

export function defaultDiscount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "checkout_session": null,
    "customer": null,
    "customer_account": null,
    "end": undefined,
    "id": generateId("di_", 14),
    "invoice": null,
    "invoice_item": null,
    "object": "discount",
    "promotion_code": null,
    "source": {"coupon":null,"type":"coupon"},
    "start": undefined,
    "subscription": null,
    "subscription_item": null,
    ...overrides,
  };
}

export function defaultDispute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transactions": [],
    "charge": "",
    "created": unixNow(),
    "currency": "",
    "enhanced_eligibility_types": [],
    "evidence": {"access_activity_log":null,"billing_address":null,"cancellation_policy":null,"cancellation_policy_disclosure":null,"cancellation_rebuttal":null,"customer_communication":null,"customer_email_address":null,"customer_name":null,"customer_purchase_ip":null,"customer_signature":null,"duplicate_charge_documentation":null,"duplicate_charge_explanation":null,"duplicate_charge_id":null,"enhanced_evidence":{"visa_compelling_evidence_3":{"disputed_transaction":null,"prior_undisputed_transactions":[]},"visa_compliance":{"fee_acknowledged":false}},"product_description":null,"receipt":null,"refund_policy":null,"refund_policy_disclosure":null,"refund_refusal_explanation":null,"service_date":null,"service_documentation":null,"shipping_address":null,"shipping_carrier":null,"shipping_date":null,"shipping_documentation":null,"shipping_tracking_number":null,"uncategorized_file":null,"uncategorized_text":null},
    "evidence_details": {"due_by":null,"enhanced_eligibility":{"visa_compelling_evidence_3":{"required_actions":[],"status":"not_qualified"},"visa_compliance":{"status":"fee_acknowledged"}},"has_evidence":false,"past_due":false,"submission_count":0},
    "id": generateId("dp_", 14),
    "is_charge_refundable": false,
    "livemode": false,
    "metadata": {},
    "object": "dispute",
    "payment_intent": null,
    "payment_method_details": {"amazon_pay":{"dispute_type":null},"card":{"brand":"","case_type":"block","network_reason_code":null},"klarna":{"chargeback_loss_reason_code":"","reason_code":null},"paypal":{"case_id":null,"reason_code":null},"type":"amazon_pay"},
    "reason": "",
    "status": "lost",
    ...overrides,
  };
}

export function defaultEntitlementsActiveEntitlement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "feature": "",
    "id": generateId("", 14),
    "livemode": false,
    "lookup_key": "",
    "object": "entitlements.active_entitlement",
    ...overrides,
  };
}

export function defaultEntitlementsFeature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "id": generateId("", 14),
    "livemode": false,
    "lookup_key": "",
    "metadata": {},
    "name": "",
    "object": "entitlements.feature",
    ...overrides,
  };
}

export function defaultEphemeralKey(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "expires": undefined,
    "id": generateId("ephkey_", 14),
    "livemode": false,
    "object": "ephemeral_key",
    "secret": null,
    ...overrides,
  };
}

export function defaultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": null,
    "api_version": null,
    "context": null,
    "created": unixNow(),
    "data": {"object":{},"previous_attributes":{}},
    "id": generateId("evt_", 14),
    "livemode": false,
    "object": "event",
    "pending_webhooks": 0,
    "request": null,
    "type": "",
    ...overrides,
  };
}

export function defaultExchangeRate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "id": generateId("", 14),
    "object": "exchange_rate",
    "rates": {},
    ...overrides,
  };
}

export function defaultExternalAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": null,
    "account_holder_name": null,
    "account_holder_type": null,
    "account_type": null,
    "available_payout_methods": null,
    "bank_name": null,
    "country": "",
    "currency": "",
    "customer": null,
    "default_for_currency": null,
    "fingerprint": null,
    "future_requirements": null,
    "id": generateId("", 14),
    "last4": "",
    "metadata": {},
    "object": "bank_account",
    "requirements": null,
    "routing_number": null,
    "status": "",
    ...overrides,
  };
}

export function defaultFeeRefund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transaction": null,
    "created": unixNow(),
    "currency": "",
    "fee": "",
    "id": generateId("", 14),
    "metadata": {},
    "object": "fee_refund",
    ...overrides,
  };
}

export function defaultFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "expires_at": undefined,
    "filename": null,
    "id": generateId("file_", 14),
    "links": null,
    "object": "file",
    "purpose": "account_requirement",
    "size": 0,
    "title": null,
    "type": null,
    "url": null,
    ...overrides,
  };
}

export function defaultFileLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "expired": false,
    "expires_at": undefined,
    "file": "",
    "id": generateId("link_", 14),
    "livemode": false,
    "metadata": {},
    "object": "file_link",
    "url": null,
    ...overrides,
  };
}

export function defaultFinancialConnectionsAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_holder": null,
    "account_numbers": null,
    "balance": null,
    "balance_refresh": null,
    "category": "cash",
    "created": unixNow(),
    "display_name": null,
    "id": generateId("", 14),
    "institution_name": "",
    "last4": null,
    "livemode": false,
    "object": "financial_connections.account",
    "ownership": null,
    "ownership_refresh": null,
    "permissions": null,
    "status": "active",
    "subcategory": "checking",
    "subscriptions": null,
    "supported_payment_method_types": [],
    "transaction_refresh": null,
    ...overrides,
  };
}

export function defaultFinancialConnectionsAccountOwner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "email": null,
    "id": generateId("", 14),
    "name": "",
    "object": "financial_connections.account_owner",
    "ownership": "",
    "phone": null,
    "raw_address": null,
    "refreshed_at": undefined,
    ...overrides,
  };
}

export function defaultFinancialConnectionsSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_holder": null,
    "accounts": {"data":[],"has_more":false,"object":"list","url":""},
    "client_secret": null,
    "filters": {"account_subcategories":null,"countries":null},
    "id": generateId("", 14),
    "livemode": false,
    "object": "financial_connections.session",
    "permissions": [],
    "prefetch": null,
    "return_url": null,
    ...overrides,
  };
}

export function defaultFinancialConnectionsTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": "",
    "amount": 0,
    "currency": "",
    "description": "",
    "id": generateId("", 14),
    "livemode": false,
    "object": "financial_connections.transaction",
    "status": "pending",
    "status_transitions": {"posted_at":null,"void_at":null},
    "transacted_at": undefined,
    "transaction_refresh": "",
    "updated": undefined,
    ...overrides,
  };
}

export function defaultForwardingRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "forwarding.request",
    "payment_method": "",
    "replacements": [],
    "request_context": null,
    "request_details": null,
    "response_details": null,
    "url": null,
    ...overrides,
  };
}

export function defaultFundingInstructions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "bank_transfer": {"country":"","financial_addresses":[],"type":"eu_bank_transfer"},
    "currency": "",
    "funding_type": "bank_transfer",
    "livemode": false,
    "object": "funding_instructions",
    ...overrides,
  };
}

export function defaultIdentityVerificationReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "client_reference_id": null,
    "created": unixNow(),
    "document": {"address":null,"dob":null,"error":null,"expiration_date":null,"files":null,"first_name":null,"issued_date":null,"issuing_country":null,"last_name":null,"number":null,"sex":null,"status":"unverified","type":null,"unparsed_place_of_birth":null,"unparsed_sex":null},
    "email": {"email":null,"error":null,"status":"unverified"},
    "id": generateId("", 14),
    "id_number": {"dob":null,"error":null,"first_name":null,"id_number":null,"id_number_type":null,"last_name":null,"status":"unverified"},
    "livemode": false,
    "object": "identity.verification_report",
    "options": {"document":{"allowed_types":[],"require_id_number":false,"require_live_capture":false,"require_matching_selfie":false},"id_number":{}},
    "phone": {"error":null,"phone":null,"status":"unverified"},
    "selfie": {"document":null,"error":null,"selfie":null,"status":"unverified"},
    "type": "document",
    "verification_flow": null,
    "verification_session": null,
    ...overrides,
  };
}

export function defaultIdentityVerificationSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "client_reference_id": null,
    "client_secret": null,
    "created": unixNow(),
    "id": generateId("", 14),
    "last_error": null,
    "last_verification_report": null,
    "livemode": false,
    "metadata": {},
    "object": "identity.verification_session",
    "options": null,
    "provided_details": null,
    "redaction": null,
    "related_customer": null,
    "related_customer_account": null,
    "related_person": {"account":"","person":""},
    "status": "canceled",
    "type": "document",
    "url": null,
    "verification_flow": null,
    "verified_outputs": null,
    ...overrides,
  };
}

export function defaultInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account_country": null,
    "account_name": null,
    "account_tax_ids": null,
    "amount_due": 0,
    "amount_overpaid": 0,
    "amount_paid": 0,
    "amount_remaining": 0,
    "amount_shipping": 0,
    "application": null,
    "attempt_count": 0,
    "attempted": false,
    "auto_advance": false,
    "automatic_tax": {"disabled_reason":null,"enabled":false,"liability":null,"provider":null,"status":null},
    "automatically_finalizes_at": undefined,
    "billing_reason": "automatic_pending_invoice_item_invoice",
    "collection_method": "charge_automatically",
    "confirmation_secret": null,
    "created": unixNow(),
    "currency": "",
    "custom_fields": null,
    "customer": "",
    "customer_account": null,
    "customer_address": null,
    "customer_email": null,
    "customer_name": null,
    "customer_phone": null,
    "customer_shipping": null,
    "customer_tax_exempt": "exempt",
    "customer_tax_ids": null,
    "default_payment_method": null,
    "default_source": null,
    "default_tax_rates": [],
    "description": null,
    "discounts": [],
    "due_date": undefined,
    "effective_at": undefined,
    "ending_balance": null,
    "footer": null,
    "from_invoice": null,
    "hosted_invoice_url": null,
    "id": generateId("in_", 14),
    "invoice_pdf": null,
    "issuer": {"account":"","type":"account"},
    "last_finalization_error": null,
    "latest_revision": null,
    "lines": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "metadata": {},
    "next_payment_attempt": undefined,
    "number": null,
    "object": "invoice",
    "on_behalf_of": null,
    "parent": null,
    "payment_settings": {"default_mandate":null,"payment_method_options":null,"payment_method_types":null},
    "payments": {"data":[],"has_more":false,"object":"list","url":""},
    "period_end": undefined,
    "period_start": undefined,
    "post_payment_credit_notes_amount": 0,
    "pre_payment_credit_notes_amount": 0,
    "receipt_number": null,
    "rendering": null,
    "shipping_cost": null,
    "shipping_details": null,
    "starting_balance": 0,
    "statement_descriptor": null,
    "status": "draft",
    "status_transitions": {"finalized_at":null,"marked_uncollectible_at":null,"paid_at":null,"voided_at":null},
    "subtotal": 0,
    "subtotal_excluding_tax": null,
    "test_clock": null,
    "threshold_reason": {"amount_gte":null,"item_reasons":[]},
    "total": 0,
    "total_discount_amounts": null,
    "total_excluding_tax": null,
    "total_pretax_credit_amounts": null,
    "total_taxes": null,
    "webhooks_delivered_at": undefined,
    ...overrides,
  };
}

export function defaultInvoicePayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount_paid": 0,
    "amount_requested": 0,
    "created": unixNow(),
    "currency": "",
    "id": generateId("", 14),
    "invoice": "",
    "is_default": false,
    "livemode": false,
    "object": "invoice_payment",
    "payment": {"charge":"","payment_intent":"","payment_record":"","type":"charge"},
    "status": "",
    "status_transitions": {"canceled_at":null,"paid_at":null},
    ...overrides,
  };
}

export function defaultInvoiceRenderingTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "id": generateId("invtmpl_", 14),
    "livemode": false,
    "metadata": {},
    "nickname": null,
    "object": "invoice_rendering_template",
    "status": "active",
    "version": 0,
    ...overrides,
  };
}

export function defaultInvoiceitem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "currency": "",
    "customer": "",
    "customer_account": null,
    "date": undefined,
    "description": null,
    "discountable": false,
    "discounts": null,
    "id": generateId("ii_", 14),
    "invoice": null,
    "livemode": false,
    "metadata": {},
    "net_amount": 0,
    "object": "invoiceitem",
    "parent": null,
    "period": {"end":0,"start":0},
    "pricing": null,
    "proration": false,
    "proration_details": {"discount_amounts":[]},
    "quantity": 0,
    "tax_rates": null,
    "test_clock": null,
    ...overrides,
  };
}

export function defaultIssuingAuthorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_details": null,
    "approved": false,
    "authorization_method": "chip",
    "balance_transactions": [],
    "card": {"brand":"","cancellation_reason":null,"cardholder":{"billing":{"address":{}},"company":null,"created":0,"email":null,"id":"","individual":null,"livemode":false,"metadata":{},"name":"","object":"issuing.cardholder","phone_number":null,"preferred_locales":null,"requirements":{"disabled_reason":null,"past_due":null},"spending_controls":null,"status":"active","type":"company"},"created":0,"currency":"","cvc":"","exp_month":0,"exp_year":0,"financial_account":null,"id":"","last4":"","latest_fraud_warning":null,"livemode":false,"metadata":{},"number":"","object":"issuing.card","personalization_design":null,"replaced_by":null,"replacement_for":null,"replacement_reason":null,"second_line":null,"shipping":null,"spending_controls":{"allowed_categories":null,"allowed_merchant_countries":null,"blocked_categories":null,"blocked_merchant_countries":null,"spending_limits":null,"spending_limits_currency":null},"status":"active","type":"physical","wallets":null},
    "cardholder": null,
    "created": unixNow(),
    "currency": "",
    "fleet": null,
    "fraud_challenges": null,
    "fuel": null,
    "id": generateId("", 14),
    "livemode": false,
    "merchant_amount": 0,
    "merchant_currency": "",
    "merchant_data": {"category":"","category_code":"","city":null,"country":null,"name":null,"network_id":"","postal_code":null,"state":null,"tax_id":null,"terminal_id":null,"url":null},
    "metadata": {},
    "network_data": null,
    "object": "issuing.authorization",
    "pending_request": null,
    "request_history": [],
    "status": "closed",
    "token": null,
    "transactions": [],
    "treasury": null,
    "verification_data": {"address_line1_check":"match","address_postal_code_check":"match","authentication_exemption":null,"cvc_check":"match","expiry_check":"match","postal_code":null,"three_d_secure":null},
    "verified_by_fraud_challenge": null,
    "wallet": null,
    ...overrides,
  };
}

export function defaultIssuingCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "brand": "",
    "cancellation_reason": "design_rejected",
    "cardholder": {"billing":{"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null}},"company":null,"created":0,"email":null,"id":"","individual":null,"livemode":false,"metadata":{},"name":"","object":"issuing.cardholder","phone_number":null,"preferred_locales":null,"requirements":{"disabled_reason":null,"past_due":null},"spending_controls":null,"status":"active","type":"company"},
    "created": unixNow(),
    "currency": "",
    "cvc": null,
    "exp_month": 0,
    "exp_year": 0,
    "financial_account": null,
    "id": generateId("", 14),
    "last4": "",
    "latest_fraud_warning": null,
    "livemode": false,
    "metadata": {},
    "number": null,
    "object": "issuing.card",
    "personalization_design": null,
    "replaced_by": null,
    "replacement_for": null,
    "replacement_reason": "damaged",
    "second_line": null,
    "shipping": null,
    "spending_controls": {"allowed_categories":null,"allowed_merchant_countries":null,"blocked_categories":null,"blocked_merchant_countries":null,"spending_limits":null,"spending_limits_currency":null},
    "status": "active",
    "type": "physical",
    "wallets": null,
    ...overrides,
  };
}

export function defaultIssuingCardholder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "billing": {"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null}},
    "company": null,
    "created": unixNow(),
    "email": null,
    "id": generateId("", 14),
    "individual": null,
    "livemode": false,
    "metadata": {},
    "name": "",
    "object": "issuing.cardholder",
    "phone_number": null,
    "preferred_locales": null,
    "requirements": {"disabled_reason":null,"past_due":null},
    "spending_controls": null,
    "status": "active",
    "type": "company",
    ...overrides,
  };
}

export function defaultIssuingDispute(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transactions": null,
    "created": unixNow(),
    "currency": "",
    "evidence": {"canceled":{"additional_documentation":null,"canceled_at":null,"cancellation_policy_provided":null,"cancellation_reason":null,"expected_at":null,"explanation":null,"product_description":null,"product_type":null,"return_status":null,"returned_at":null},"duplicate":{"additional_documentation":null,"card_statement":null,"cash_receipt":null,"check_image":null,"explanation":null,"original_transaction":null},"fraudulent":{"additional_documentation":null,"explanation":null},"merchandise_not_as_described":{"additional_documentation":null,"explanation":null,"received_at":null,"return_description":null,"return_status":null,"returned_at":null},"no_valid_authorization":{"additional_documentation":null,"explanation":null},"not_received":{"additional_documentation":null,"expected_at":null,"explanation":null,"product_description":null,"product_type":null},"other":{"additional_documentation":null,"explanation":null,"product_description":null,"product_type":null},"reason":"canceled","service_not_as_described":{"additional_documentation":null,"canceled_at":null,"cancellation_reason":null,"explanation":null,"received_at":null}},
    "id": generateId("", 14),
    "livemode": false,
    "loss_reason": "cardholder_authentication_issuer_liability",
    "metadata": {},
    "object": "issuing.dispute",
    "status": "expired",
    "transaction": "",
    "treasury": null,
    ...overrides,
  };
}

export function defaultIssuingPersonalizationDesign(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "card_logo": null,
    "carrier_text": null,
    "created": unixNow(),
    "id": generateId("", 14),
    "livemode": false,
    "lookup_key": null,
    "metadata": {},
    "name": null,
    "object": "issuing.personalization_design",
    "physical_bundle": "",
    "preferences": {"is_default":false,"is_platform_default":null},
    "rejection_reasons": {"card_logo":null,"carrier_text":null},
    "status": "active",
    ...overrides,
  };
}

export function defaultIssuingPhysicalBundle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "features": {"card_logo":"optional","carrier_text":"optional","second_line":"optional"},
    "id": generateId("", 14),
    "livemode": false,
    "name": "",
    "object": "issuing.physical_bundle",
    "status": "active",
    "type": "custom",
    ...overrides,
  };
}

export function defaultIssuingSettlement(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "bin": "",
    "clearing_date": undefined,
    "created": unixNow(),
    "currency": "",
    "id": generateId("", 14),
    "interchange_fees_amount": 0,
    "livemode": false,
    "metadata": {},
    "net_total_amount": 0,
    "network": "maestro",
    "network_fees_amount": 0,
    "network_settlement_identifier": "",
    "object": "issuing.settlement",
    "settlement_service": "",
    "status": "complete",
    "transaction_amount": 0,
    "transaction_count": 0,
    ...overrides,
  };
}

export function defaultIssuingToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "card": "",
    "created": unixNow(),
    "device_fingerprint": null,
    "id": generateId("", 14),
    "last4": null,
    "livemode": false,
    "network": "mastercard",
    "network_data": {"device":{"device_fingerprint":"","ip_address":"","location":"","name":"","phone_number":"","type":"other"},"mastercard":{"card_reference_id":"","token_reference_id":"","token_requestor_id":"","token_requestor_name":""},"type":"mastercard","visa":{"card_reference_id":"","token_reference_id":"","token_requestor_id":"","token_risk_score":""},"wallet_provider":{"account_id":"","account_trust_score":0,"card_number_source":"app","cardholder_address":{"line1":"","postal_code":""},"cardholder_name":"","device_trust_score":0,"hashed_account_email_address":"","reason_codes":[],"suggested_decision":"approve","suggested_decision_version":""}},
    "network_updated_at": undefined,
    "object": "issuing.token",
    "status": "active",
    "wallet_provider": "apple_pay",
    ...overrides,
  };
}

export function defaultIssuingTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_details": null,
    "authorization": null,
    "balance_transaction": null,
    "card": "",
    "cardholder": null,
    "created": unixNow(),
    "currency": "",
    "dispute": null,
    "id": generateId("", 14),
    "livemode": false,
    "merchant_amount": 0,
    "merchant_currency": "",
    "merchant_data": {"category":"","category_code":"","city":null,"country":null,"name":null,"network_id":"","postal_code":null,"state":null,"tax_id":null,"terminal_id":null,"url":null},
    "metadata": {},
    "network_data": null,
    "object": "issuing.transaction",
    "purchase_details": null,
    "token": null,
    "treasury": null,
    "type": "capture",
    "wallet": "apple_pay",
    ...overrides,
  };
}

export function defaultItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "adjustable_quantity": null,
    "amount_discount": 0,
    "amount_subtotal": 0,
    "amount_tax": 0,
    "amount_total": 0,
    "currency": "",
    "description": null,
    "discounts": [],
    "id": generateId("", 14),
    "metadata": {},
    "object": "item",
    "price": null,
    "quantity": null,
    "taxes": [],
    ...overrides,
  };
}

export function defaultLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "currency": "",
    "description": null,
    "discount_amounts": null,
    "discountable": false,
    "discounts": [],
    "id": generateId("li_", 14),
    "invoice": null,
    "livemode": false,
    "metadata": {},
    "object": "line_item",
    "parent": null,
    "period": {"end":0,"start":0},
    "pretax_credit_amounts": null,
    "pricing": null,
    "quantity": null,
    "subscription": null,
    "subtotal": 0,
    "taxes": null,
    ...overrides,
  };
}

export function defaultLoginLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "object": "login_link",
    "url": "",
    ...overrides,
  };
}

export function defaultMandate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "customer_acceptance": {"accepted_at":null,"offline":{},"online":{"ip_address":null,"user_agent":null},"type":"offline"},
    "id": generateId("mandate_", 14),
    "livemode": false,
    "multi_use": {},
    "object": "mandate",
    "on_behalf_of": null,
    "payment_method": "",
    "payment_method_details": {"acss_debit":{"default_for":[],"interval_description":null,"payment_schedule":"combined","transaction_type":"business"},"amazon_pay":{},"au_becs_debit":{"url":""},"bacs_debit":{"display_name":null,"network_status":"accepted","reference":"","revocation_reason":null,"service_user_number":null,"url":""},"card":{},"cashapp":{},"kakao_pay":{},"klarna":{},"kr_card":{},"link":{},"naver_pay":{},"nz_bank_account":{},"paypal":{"billing_agreement_id":null,"payer_id":null},"payto":{"amount":null,"amount_type":"fixed","end_date":null,"payment_schedule":"adhoc","payments_per_period":null,"purpose":null,"start_date":null},"revolut_pay":{},"sepa_debit":{"reference":"","url":""},"type":"","us_bank_account":{"collection_method":"paper"}},
    "single_use": {"amount":0,"currency":""},
    "status": "active",
    "type": "multi_use",
    ...overrides,
  };
}

export function defaultPaymentAttemptRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": {"currency":"","value":0},
    "amount_authorized": {"currency":"","value":0},
    "amount_canceled": {"currency":"","value":0},
    "amount_failed": {"currency":"","value":0},
    "amount_guaranteed": {"currency":"","value":0},
    "amount_refunded": {"currency":"","value":0},
    "amount_requested": {"currency":"","value":0},
    "application": null,
    "created": unixNow(),
    "customer_details": null,
    "customer_presence": "off_session",
    "description": null,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "payment_attempt_record",
    "payment_method_details": null,
    "payment_record": null,
    "processor_details": {"custom":{"payment_reference":null},"type":"custom"},
    "reported_by": "self",
    "shipping_details": null,
    ...overrides,
  };
}

export function defaultPaymentIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_capturable": 0,
    "amount_details": {"discount_amount":0,"error":{"code":null,"message":null},"line_items":{"data":[],"has_more":false,"object":"list","url":""},"shipping":{"amount":null,"from_postal_code":null,"to_postal_code":null},"tax":{"total_tax_amount":null},"tip":{"amount":0}},
    "amount_received": 0,
    "application": null,
    "application_fee_amount": 0,
    "automatic_payment_methods": null,
    "canceled_at": undefined,
    "cancellation_reason": "abandoned",
    "capture_method": "automatic",
    "client_secret": generateId("pi_", 14) + "_secret_" + generateId("", 10),
    "confirmation_method": "automatic",
    "created": unixNow(),
    "currency": null,
    "customer": null,
    "customer_account": null,
    "description": null,
    "excluded_payment_method_types": null,
    "hooks": {"inputs":{"tax":{"calculation":""}}},
    "id": generateId("pi_", 14),
    "last_payment_error": null,
    "latest_charge": null,
    "livemode": false,
    "metadata": {},
    "next_action": null,
    "object": "payment_intent",
    "on_behalf_of": null,
    "payment_details": {"customer_reference":null,"order_reference":null},
    "payment_method": null,
    "payment_method_configuration_details": null,
    "payment_method_options": null,
    "payment_method_types": [],
    "presentment_details": {"presentment_amount":0,"presentment_currency":""},
    "processing": null,
    "receipt_email": null,
    "review": null,
    "setup_future_usage": "off_session",
    "shipping": null,
    "statement_descriptor": null,
    "statement_descriptor_suffix": null,
    "status": "requires_payment_method",
    "transfer_data": null,
    "transfer_group": null,
    ...overrides,
  };
}

export function defaultPaymentIntentAmountDetailsLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "discount_amount": null,
    "id": generateId("", 14),
    "object": "payment_intent_amount_details_line_item",
    "payment_method_options": null,
    "product_code": null,
    "product_name": "",
    "quantity": 0,
    "tax": null,
    "unit_cost": 0,
    "unit_of_measure": null,
    ...overrides,
  };
}

export function defaultPaymentLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": true,
    "after_completion": {"hosted_confirmation":{"custom_message":null},"redirect":{"url":""},"type":"hosted_confirmation"},
    "allow_promotion_codes": false,
    "application": null,
    "application_fee_amount": 0,
    "application_fee_percent": null,
    "automatic_tax": {"enabled":false,"liability":null},
    "billing_address_collection": "auto",
    "consent_collection": null,
    "currency": "",
    "custom_fields": [],
    "custom_text": {"after_submit":null,"shipping_address":null,"submit":null,"terms_of_service_acceptance":null},
    "customer_creation": "always",
    "id": generateId("plink_", 14),
    "inactive_message": null,
    "invoice_creation": null,
    "line_items": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "metadata": {},
    "name_collection": {"business":{"enabled":false,"optional":false},"individual":{"enabled":false,"optional":false}},
    "object": "payment_link",
    "on_behalf_of": null,
    "optional_items": null,
    "payment_intent_data": null,
    "payment_method_collection": "always",
    "payment_method_types": null,
    "phone_number_collection": {"enabled":false},
    "restrictions": null,
    "shipping_address_collection": null,
    "shipping_options": [],
    "submit_type": "auto",
    "subscription_data": null,
    "tax_id_collection": {"enabled":false,"required":"if_supported"},
    "transfer_data": null,
    "url": "https://buy.stripe.com/test_" + generateId("", 10),
    ...overrides,
  };
}

export function defaultPaymentMethod(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "acss_debit": {"bank_name":null,"fingerprint":null,"institution_number":null,"last4":null,"transit_number":null},
    "affirm": {},
    "afterpay_clearpay": {},
    "alipay": {},
    "allow_redisplay": "always",
    "alma": {},
    "amazon_pay": {},
    "au_becs_debit": {"bsb_number":null,"fingerprint":null,"last4":null},
    "bacs_debit": {"fingerprint":null,"last4":null,"sort_code":null},
    "bancontact": {},
    "billie": {},
    "billing_details": {"address":null,"email":null,"name":null,"phone":null,"tax_id":null},
    "blik": {},
    "boleto": {"tax_id":""},
    "card": {"brand":"","checks":null,"country":null,"display_brand":null,"exp_month":0,"exp_year":0,"fingerprint":null,"funding":"","generated_from":null,"last4":"","networks":null,"regulated_status":null,"three_d_secure_usage":null,"wallet":null},
    "card_present": {"brand":null,"brand_product":null,"cardholder_name":null,"country":null,"description":null,"exp_month":0,"exp_year":0,"fingerprint":null,"funding":null,"issuer":null,"last4":null,"networks":null,"offline":null,"preferred_locales":null,"read_method":null,"wallet":{"type":"apple_pay"}},
    "cashapp": {"buyer_id":null,"cashtag":null},
    "created": unixNow(),
    "crypto": {},
    "custom": {"display_name":null,"logo":null,"type":""},
    "customer": null,
    "customer_account": null,
    "customer_balance": {},
    "eps": {"bank":null},
    "fpx": {"bank":"affin_bank"},
    "giropay": {},
    "grabpay": {},
    "id": generateId("pm_", 14),
    "ideal": {"bank":null,"bic":null},
    "interac_present": {"brand":null,"cardholder_name":null,"country":null,"description":null,"exp_month":0,"exp_year":0,"fingerprint":null,"funding":null,"issuer":null,"last4":null,"networks":null,"preferred_locales":null,"read_method":null},
    "kakao_pay": {},
    "klarna": {"dob":null},
    "konbini": {},
    "kr_card": {"brand":null,"last4":null},
    "link": {"email":null},
    "livemode": false,
    "mb_way": {},
    "metadata": {},
    "mobilepay": {},
    "multibanco": {},
    "naver_pay": {"buyer_id":null,"funding":"card"},
    "nz_bank_account": {"account_holder_name":null,"bank_code":"","bank_name":"","branch_code":"","last4":"","suffix":null},
    "object": "payment_method",
    "oxxo": {},
    "p24": {"bank":null},
    "pay_by_bank": {},
    "payco": {},
    "paynow": {},
    "paypal": {"country":null,"payer_email":null,"payer_id":null},
    "payto": {"bsb_number":null,"last4":null,"pay_id":null},
    "pix": {},
    "promptpay": {},
    "radar_options": {"session":""},
    "revolut_pay": {},
    "samsung_pay": {},
    "satispay": {},
    "sepa_debit": {"bank_code":null,"branch_code":null,"country":null,"fingerprint":null,"generated_from":null,"last4":null},
    "sofort": {"country":null},
    "swish": {},
    "twint": {},
    "type": "acss_debit",
    "us_bank_account": {"account_holder_type":null,"account_type":null,"bank_name":null,"financial_connections_account":null,"fingerprint":null,"last4":null,"networks":null,"routing_number":null,"status_details":null},
    "wechat_pay": {},
    "zip": {},
    ...overrides,
  };
}

export function defaultPaymentMethodConfiguration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "acss_debit": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "active": false,
    "affirm": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "afterpay_clearpay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "alipay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "alma": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "amazon_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "apple_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "application": null,
    "au_becs_debit": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "bacs_debit": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "bancontact": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "billie": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "blik": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "boleto": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "card": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "cartes_bancaires": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "cashapp": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "crypto": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "customer_balance": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "eps": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "fpx": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "giropay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "google_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "grabpay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "id": generateId("pmc_", 14),
    "ideal": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "is_default": false,
    "jcb": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "kakao_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "klarna": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "konbini": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "kr_card": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "link": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "livemode": false,
    "mb_way": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "mobilepay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "multibanco": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "name": "",
    "naver_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "nz_bank_account": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "object": "payment_method_configuration",
    "oxxo": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "p24": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "parent": null,
    "pay_by_bank": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "payco": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "paynow": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "paypal": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "payto": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "pix": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "promptpay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "revolut_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "samsung_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "satispay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "sepa_debit": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "sofort": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "swish": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "twint": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "us_bank_account": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "wechat_pay": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    "zip": {"available":false,"display_preference":{"overridable":null,"preference":"none","value":"off"}},
    ...overrides,
  };
}

export function defaultPaymentMethodDomain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amazon_pay": {"status":"active","status_details":{"error_message":""}},
    "apple_pay": {"status":"active","status_details":{"error_message":""}},
    "created": unixNow(),
    "domain_name": "",
    "enabled": false,
    "google_pay": {"status":"active","status_details":{"error_message":""}},
    "id": generateId("pmd_", 14),
    "klarna": {"status":"active","status_details":{"error_message":""}},
    "link": {"status":"active","status_details":{"error_message":""}},
    "livemode": false,
    "object": "payment_method_domain",
    "paypal": {"status":"active","status_details":{"error_message":""}},
    ...overrides,
  };
}

export function defaultPaymentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": {"currency":"","value":0},
    "amount_authorized": {"currency":"","value":0},
    "amount_canceled": {"currency":"","value":0},
    "amount_failed": {"currency":"","value":0},
    "amount_guaranteed": {"currency":"","value":0},
    "amount_refunded": {"currency":"","value":0},
    "amount_requested": {"currency":"","value":0},
    "application": null,
    "created": unixNow(),
    "customer_details": null,
    "customer_presence": "off_session",
    "description": null,
    "id": generateId("", 14),
    "latest_payment_attempt_record": null,
    "livemode": false,
    "metadata": {},
    "object": "payment_record",
    "payment_method_details": null,
    "processor_details": {"custom":{"payment_reference":null},"type":"custom"},
    "reported_by": "self",
    "shipping_details": null,
    ...overrides,
  };
}

export function defaultPaymentSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "business_profile": null,
    "business_type": "company",
    "capabilities": {"acss_debit_payments":"active","affirm_payments":"active","afterpay_clearpay_payments":"active","alma_payments":"active","amazon_pay_payments":"active","au_becs_debit_payments":"active","bacs_debit_payments":"active","bancontact_payments":"active","bank_transfer_payments":"active","billie_payments":"active","blik_payments":"active","boleto_payments":"active","card_issuing":"active","card_payments":"active","cartes_bancaires_payments":"active","cashapp_payments":"active","crypto_payments":"active","eps_payments":"active","fpx_payments":"active","gb_bank_transfer_payments":"active","giropay_payments":"active","grabpay_payments":"active","ideal_payments":"active","india_international_payments":"active","jcb_payments":"active","jp_bank_transfer_payments":"active","kakao_pay_payments":"active","klarna_payments":"active","konbini_payments":"active","kr_card_payments":"active","legacy_payments":"active","link_payments":"active","mb_way_payments":"active","mobilepay_payments":"active","multibanco_payments":"active","mx_bank_transfer_payments":"active","naver_pay_payments":"active","nz_bank_account_becs_debit_payments":"active","oxxo_payments":"active","p24_payments":"active","pay_by_bank_payments":"active","payco_payments":"active","paynow_payments":"active","payto_payments":"active","pix_payments":"active","promptpay_payments":"active","revolut_pay_payments":"active","samsung_pay_payments":"active","satispay_payments":"active","sepa_bank_transfer_payments":"active","sepa_debit_payments":"active","sofort_payments":"active","swish_payments":"active","tax_reporting_us_1099_k":"active","tax_reporting_us_1099_misc":"active","transfers":"active","treasury":"active","twint_payments":"active","us_bank_account_ach_payments":"active","us_bank_transfer_payments":"active","zip_payments":"active"},
    "charges_enabled": false,
    "company": {"address":null,"address_kana":null,"address_kanji":null,"directors_provided":false,"directorship_declaration":null,"executives_provided":false,"export_license_id":"","export_purpose_code":"","name":null,"name_kana":null,"name_kanji":null,"owners_provided":false,"ownership_declaration":null,"ownership_exemption_reason":"qualified_entity_exceeds_ownership_threshold","phone":null,"registration_date":{"day":null,"month":null,"year":null},"representative_declaration":null,"structure":"free_zone_establishment","tax_id_provided":false,"tax_id_registrar":"","vat_id_provided":false,"verification":null},
    "controller": {"fees":{"payer":"account"},"is_controller":false,"losses":{"payments":"application"},"requirement_collection":"application","stripe_dashboard":{"type":"express"},"type":"account"},
    "country": null,
    "created": unixNow(),
    "default_currency": null,
    "details_submitted": false,
    "email": null,
    "external_accounts": {"data":[],"has_more":false,"object":"list","url":""},
    "future_requirements": {"alternatives":null,"current_deadline":null,"currently_due":null,"disabled_reason":null,"errors":null,"eventually_due":null,"past_due":null,"pending_verification":null},
    "groups": null,
    "id": generateId("", 14),
    "individual": {"account":"","additional_tos_acceptances":{"account":null},"address":null,"address_kana":null,"address_kanji":null,"created":0,"dob":{"day":null,"month":null,"year":null},"email":null,"first_name":null,"first_name_kana":null,"first_name_kanji":null,"full_name_aliases":[],"future_requirements":null,"gender":null,"id":"","id_number_provided":false,"id_number_secondary_provided":false,"last_name":null,"last_name_kana":null,"last_name_kanji":null,"maiden_name":null,"metadata":{},"nationality":null,"object":"person","phone":null,"political_exposure":"existing","registered_address":null,"relationship":{"authorizer":null,"director":null,"executive":null,"legal_guardian":null,"owner":null,"percent_ownership":null,"representative":null,"title":null},"requirements":null,"ssn_last_4_provided":false,"us_cfpb_data":null,"verification":{"additional_document":null,"details":null,"details_code":null,"document":null,"status":""}},
    "metadata": {},
    "object": "account",
    "payouts_enabled": false,
    "requirements": {"alternatives":null,"current_deadline":null,"currently_due":null,"disabled_reason":null,"errors":null,"eventually_due":null,"past_due":null,"pending_verification":null},
    "settings": null,
    "tos_acceptance": {"date":null,"ip":null,"service_agreement":"","user_agent":null},
    "type": "custom",
    ...overrides,
  };
}

export function defaultPayout(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "application_fee": null,
    "application_fee_amount": 0,
    "arrival_date": undefined,
    "automatic": false,
    "balance_transaction": null,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "destination": null,
    "failure_balance_transaction": null,
    "failure_code": null,
    "failure_message": null,
    "id": generateId("po_", 14),
    "livemode": false,
    "metadata": {},
    "method": "",
    "object": "payout",
    "original_payout": null,
    "payout_method": null,
    "reconciliation_status": "completed",
    "reversed_by": null,
    "source_type": "",
    "statement_descriptor": null,
    "status": "",
    "trace_id": null,
    "type": "bank_account",
    ...overrides,
  };
}

export function defaultPerson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "account": "",
    "additional_tos_acceptances": {"account":null},
    "address": null,
    "address_kana": null,
    "address_kanji": null,
    "created": unixNow(),
    "dob": {"day":null,"month":null,"year":null},
    "email": null,
    "first_name": null,
    "first_name_kana": null,
    "first_name_kanji": null,
    "full_name_aliases": [],
    "future_requirements": null,
    "gender": null,
    "id": generateId("", 14),
    "id_number_provided": false,
    "id_number_secondary_provided": false,
    "last_name": null,
    "last_name_kana": null,
    "last_name_kanji": null,
    "maiden_name": null,
    "metadata": {},
    "nationality": null,
    "object": "person",
    "phone": null,
    "political_exposure": "existing",
    "registered_address": null,
    "relationship": {"authorizer":null,"director":null,"executive":null,"legal_guardian":null,"owner":null,"percent_ownership":null,"representative":null,"title":null},
    "requirements": null,
    "ssn_last_4_provided": false,
    "us_cfpb_data": null,
    "verification": {"additional_document":null,"details":null,"details_code":null,"document":null,"status":""},
    ...overrides,
  };
}

export function defaultPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "amount": 0,
    "amount_decimal": null,
    "billing_scheme": "per_unit",
    "created": unixNow(),
    "currency": "",
    "id": generateId("plan_", 14),
    "interval": "day",
    "interval_count": 0,
    "livemode": false,
    "metadata": {},
    "meter": null,
    "nickname": null,
    "object": "plan",
    "product": null,
    "tiers": [],
    "tiers_mode": "graduated",
    "transform_usage": null,
    "trial_period_days": null,
    "usage_type": "licensed",
    ...overrides,
  };
}

export function defaultPrice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "billing_scheme": "per_unit",
    "created": unixNow(),
    "currency": "",
    "currency_options": {},
    "custom_unit_amount": null,
    "id": generateId("price_", 14),
    "livemode": false,
    "lookup_key": null,
    "metadata": {},
    "nickname": null,
    "object": "price",
    "product": "",
    "recurring": null,
    "tax_behavior": "exclusive",
    "tiers": [],
    "tiers_mode": "graduated",
    "transform_quantity": null,
    "type": "one_time",
    "unit_amount": 0,
    "unit_amount_decimal": null,
    ...overrides,
  };
}

export function defaultProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "created": unixNow(),
    "default_price": null,
    "description": null,
    "id": generateId("prod_", 14),
    "images": [],
    "livemode": false,
    "marketing_features": [],
    "metadata": {},
    "name": "",
    "object": "product",
    "package_dimensions": null,
    "shippable": null,
    "statement_descriptor": null,
    "tax_code": null,
    "unit_label": null,
    "updated": undefined,
    "url": null,
    ...overrides,
  };
}

export function defaultProductFeature(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "entitlement_feature": {"active":false,"id":"","livemode":false,"lookup_key":"","metadata":{},"name":"","object":"entitlements.feature"},
    "id": generateId("", 14),
    "livemode": false,
    "object": "product_feature",
    ...overrides,
  };
}

export function defaultPromotionCode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "code": "",
    "created": unixNow(),
    "customer": null,
    "customer_account": null,
    "expires_at": undefined,
    "id": generateId("promo_", 14),
    "livemode": false,
    "max_redemptions": null,
    "metadata": {},
    "object": "promotion_code",
    "promotion": {"coupon":null,"type":"coupon"},
    "restrictions": {"currency_options":{},"first_time_transaction":false,"minimum_amount":null,"minimum_amount_currency":null},
    "times_redeemed": 0,
    ...overrides,
  };
}

export function defaultQuote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount_subtotal": 0,
    "amount_total": 0,
    "application": null,
    "application_fee_amount": 0,
    "application_fee_percent": null,
    "automatic_tax": {"enabled":false,"liability":null,"provider":null,"status":null},
    "collection_method": "charge_automatically",
    "computed": {"recurring":null,"upfront":{"amount_subtotal":0,"amount_total":0,"line_items":{"data":[],"has_more":false,"object":"list","url":""},"total_details":{"amount_discount":0,"amount_shipping":null,"amount_tax":0,"breakdown":{}}}},
    "created": unixNow(),
    "currency": null,
    "customer": null,
    "customer_account": null,
    "default_tax_rates": [],
    "description": null,
    "discounts": [],
    "expires_at": undefined,
    "footer": null,
    "from_quote": null,
    "header": null,
    "id": generateId("qt_", 14),
    "invoice": null,
    "invoice_settings": {"days_until_due":null,"issuer":{"account":"","type":"account"}},
    "line_items": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "metadata": {},
    "number": null,
    "object": "quote",
    "on_behalf_of": null,
    "status": "accepted",
    "status_transitions": {"accepted_at":null,"canceled_at":null,"finalized_at":null},
    "subscription": null,
    "subscription_data": {"billing_mode":{"flexible":{"proration_discounts":"included"},"type":"classic"},"description":null,"effective_date":null,"metadata":null,"trial_period_days":null},
    "subscription_schedule": null,
    "test_clock": null,
    "total_details": {"amount_discount":0,"amount_shipping":null,"amount_tax":0,"breakdown":{"discounts":[],"taxes":[]}},
    "transfer_data": null,
    ...overrides,
  };
}

export function defaultRadarEarlyFraudWarning(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "actionable": false,
    "charge": "",
    "created": unixNow(),
    "fraud_type": "",
    "id": generateId("", 14),
    "livemode": false,
    "object": "radar.early_fraud_warning",
    "payment_intent": null,
    ...overrides,
  };
}

export function defaultRadarPaymentEvaluation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "client_device_metadata_details": {"radar_session":""},
    "created_at": unixNow(),
    "customer_details": {"customer":null,"customer_account":null,"email":null,"name":null,"phone":null},
    "events": [],
    "id": generateId("", 14),
    "insights": {"evaluated_at":0,"fraudulent_dispute":{"recommended_action":"block","risk_score":0}},
    "livemode": false,
    "metadata": {},
    "object": "radar.payment_evaluation",
    "outcome": null,
    "payment_details": {"amount":0,"currency":"","description":null,"money_movement_details":null,"payment_method_details":null,"shipping_details":null,"statement_descriptor":null},
    ...overrides,
  };
}

export function defaultRadarValueList(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "alias": "",
    "created": unixNow(),
    "created_by": "",
    "id": generateId("", 14),
    "item_type": "card_bin",
    "list_items": {"data":[],"has_more":false,"object":"list","url":""},
    "livemode": false,
    "metadata": {},
    "name": "",
    "object": "radar.value_list",
    ...overrides,
  };
}

export function defaultRadarValueListItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "created_by": "",
    "id": generateId("", 14),
    "livemode": false,
    "object": "radar.value_list_item",
    "value": "",
    "value_list": "",
    ...overrides,
  };
}

export function defaultRefund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transaction": null,
    "charge": null,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "destination_details": {"affirm":{},"afterpay_clearpay":{},"alipay":{},"alma":{},"amazon_pay":{},"au_bank_transfer":{},"blik":{"network_decline_code":null,"reference":null,"reference_status":null},"br_bank_transfer":{"reference":null,"reference_status":null},"card":{"reference":"","reference_status":"","reference_type":"","type":"pending"},"cashapp":{},"crypto":{"reference":null},"customer_cash_balance":{},"eps":{},"eu_bank_transfer":{"reference":null,"reference_status":null},"gb_bank_transfer":{"reference":null,"reference_status":null},"giropay":{},"grabpay":{},"jp_bank_transfer":{"reference":null,"reference_status":null},"klarna":{},"mb_way":{"reference":null,"reference_status":null},"multibanco":{"reference":null,"reference_status":null},"mx_bank_transfer":{"reference":null,"reference_status":null},"nz_bank_transfer":{},"p24":{"reference":null,"reference_status":null},"paynow":{},"paypal":{"network_decline_code":null},"pix":{},"revolut":{},"sofort":{},"swish":{"network_decline_code":null,"reference":null,"reference_status":null},"th_bank_transfer":{"reference":null,"reference_status":null},"twint":{},"type":"","us_bank_transfer":{"reference":null,"reference_status":null},"wechat_pay":{},"zip":{}},
    "failure_balance_transaction": null,
    "failure_reason": null,
    "id": generateId("re_", 14),
    "instructions_email": null,
    "metadata": {},
    "next_action": {"display_details":{"email_sent":{"email_sent_at":0,"email_sent_to":""},"expires_at":0},"type":""},
    "object": "refund",
    "payment_intent": null,
    "pending_reason": "charge_pending",
    "presentment_details": {"presentment_amount":0,"presentment_currency":""},
    "reason": "duplicate",
    "receipt_number": null,
    "source_transfer_reversal": null,
    "status": null,
    "transfer_reversal": null,
    ...overrides,
  };
}

export function defaultReportingReportRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "error": null,
    "id": generateId("", 14),
    "livemode": false,
    "object": "reporting.report_run",
    "parameters": {"columns":[],"connected_account":"","currency":"","interval_end":0,"interval_start":0,"payout":"","reporting_category":"","timezone":""},
    "report_type": "",
    "result": null,
    "status": "",
    "succeeded_at": undefined,
    ...overrides,
  };
}

export function defaultReportingReportType(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "data_available_end": undefined,
    "data_available_start": undefined,
    "default_columns": null,
    "id": generateId("", 14),
    "livemode": false,
    "name": "",
    "object": "reporting.report_type",
    "updated": undefined,
    "version": 0,
    ...overrides,
  };
}

export function defaultReview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "billing_zip": null,
    "charge": null,
    "closed_reason": "acknowledged",
    "created": unixNow(),
    "id": generateId("prv_", 14),
    "ip_address": null,
    "ip_address_location": null,
    "livemode": false,
    "object": "review",
    "open": false,
    "opened_reason": "manual",
    "payment_intent": null,
    "reason": "",
    "session": null,
    ...overrides,
  };
}

export function defaultScheduledQueryRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "data_load_time": undefined,
    "error": {"message":""},
    "file": null,
    "id": generateId("sqr_", 14),
    "livemode": false,
    "object": "scheduled_query_run",
    "result_available_until": undefined,
    "sql": "",
    "status": "",
    "title": "",
    ...overrides,
  };
}

export function defaultSetupAttempt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "application": null,
    "attach_to_self": false,
    "created": unixNow(),
    "customer": null,
    "customer_account": null,
    "flow_directions": null,
    "id": generateId("setatt_", 14),
    "livemode": false,
    "object": "setup_attempt",
    "on_behalf_of": null,
    "payment_method": "",
    "payment_method_details": {"acss_debit":{},"amazon_pay":{},"au_becs_debit":{},"bacs_debit":{},"bancontact":{"bank_code":null,"bank_name":null,"bic":null,"generated_sepa_debit":null,"generated_sepa_debit_mandate":null,"iban_last4":null,"preferred_language":null,"verified_name":null},"boleto":{},"card":{"brand":null,"checks":null,"country":null,"exp_month":null,"exp_year":null,"fingerprint":null,"funding":null,"last4":null,"network":null,"three_d_secure":null,"wallet":null},"card_present":{"generated_card":null,"offline":null},"cashapp":{},"ideal":{"bank":null,"bic":null,"generated_sepa_debit":null,"generated_sepa_debit_mandate":null,"iban_last4":null,"verified_name":null},"kakao_pay":{},"klarna":{},"kr_card":{},"link":{},"naver_pay":{"buyer_id":""},"nz_bank_account":{},"paypal":{},"payto":{},"revolut_pay":{},"sepa_debit":{},"sofort":{"bank_code":null,"bank_name":null,"bic":null,"generated_sepa_debit":null,"generated_sepa_debit_mandate":null,"iban_last4":null,"preferred_language":null,"verified_name":null},"type":"","us_bank_account":{}},
    "setup_error": null,
    "setup_intent": "",
    "status": "",
    "usage": "",
    ...overrides,
  };
}

export function defaultSetupIntent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "application": null,
    "attach_to_self": false,
    "automatic_payment_methods": null,
    "cancellation_reason": "abandoned",
    "client_secret": generateId("seti_", 14) + "_secret_" + generateId("", 10),
    "created": unixNow(),
    "customer": null,
    "customer_account": null,
    "description": null,
    "excluded_payment_method_types": null,
    "flow_directions": null,
    "id": generateId("seti_", 14),
    "last_setup_error": null,
    "latest_attempt": null,
    "livemode": false,
    "mandate": null,
    "metadata": {},
    "next_action": null,
    "object": "setup_intent",
    "on_behalf_of": null,
    "payment_method": null,
    "payment_method_configuration_details": null,
    "payment_method_options": null,
    "payment_method_types": [],
    "single_use_mandate": null,
    "status": "requires_payment_method",
    "usage": "",
    ...overrides,
  };
}

export function defaultShippingRate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "created": unixNow(),
    "delivery_estimate": null,
    "display_name": null,
    "fixed_amount": {"amount":0,"currency":"","currency_options":{}},
    "id": generateId("shr_", 14),
    "livemode": false,
    "metadata": {},
    "object": "shipping_rate",
    "tax_behavior": "exclusive",
    "tax_code": null,
    "type": "fixed_amount",
    ...overrides,
  };
}

export function defaultSigmaSigmaApiQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "id": generateId("", 14),
    "livemode": false,
    "name": "",
    "object": "sigma.sigma_api_query",
    "sql": "",
    ...overrides,
  };
}

export function defaultSource(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "ach_credit_transfer": {"account_number":null,"bank_name":null,"fingerprint":null,"refund_account_holder_name":null,"refund_account_holder_type":null,"refund_routing_number":null,"routing_number":null,"swift_code":null},
    "ach_debit": {"bank_name":null,"country":null,"fingerprint":null,"last4":null,"routing_number":null,"type":null},
    "acss_debit": {"bank_address_city":null,"bank_address_line_1":null,"bank_address_line_2":null,"bank_address_postal_code":null,"bank_name":null,"category":null,"country":null,"fingerprint":null,"last4":null,"routing_number":null},
    "alipay": {"data_string":null,"native_url":null,"statement_descriptor":null},
    "allow_redisplay": "always",
    "amount": 0,
    "au_becs_debit": {"bsb_number":null,"fingerprint":null,"last4":null},
    "bancontact": {"bank_code":null,"bank_name":null,"bic":null,"iban_last4":null,"preferred_language":null,"statement_descriptor":null},
    "card": {"address_line1_check":null,"address_zip_check":null,"brand":null,"country":null,"cvc_check":null,"dynamic_last4":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"name":null,"three_d_secure":"","tokenization_method":null},
    "card_present": {"application_cryptogram":"","application_preferred_name":"","authorization_code":null,"authorization_response_code":"","brand":null,"country":null,"cvm_type":"","data_type":null,"dedicated_file_name":"","emv_auth_data":"","evidence_customer_signature":null,"evidence_transaction_certificate":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"pos_device_id":null,"pos_entry_mode":"","read_method":null,"reader":null,"terminal_verification_results":"","transaction_status_information":""},
    "client_secret": "",
    "code_verification": {"attempts_remaining":0,"status":""},
    "created": unixNow(),
    "currency": null,
    "customer": null,
    "eps": {"reference":null,"statement_descriptor":null},
    "flow": "",
    "giropay": {"bank_code":null,"bank_name":null,"bic":null,"statement_descriptor":null},
    "id": generateId("src_", 14),
    "ideal": {"bank":null,"bic":null,"iban_last4":null,"statement_descriptor":null},
    "klarna": {"background_image_url":"","client_token":null,"first_name":"","last_name":"","locale":"","logo_url":"","page_title":"","pay_later_asset_urls_descriptive":"","pay_later_asset_urls_standard":"","pay_later_name":"","pay_later_redirect_url":"","pay_now_asset_urls_descriptive":"","pay_now_asset_urls_standard":"","pay_now_name":"","pay_now_redirect_url":"","pay_over_time_asset_urls_descriptive":"","pay_over_time_asset_urls_standard":"","pay_over_time_name":"","pay_over_time_redirect_url":"","payment_method_categories":"","purchase_country":"","purchase_type":"","redirect_url":"","shipping_delay":0,"shipping_first_name":"","shipping_last_name":""},
    "livemode": false,
    "metadata": {},
    "multibanco": {"entity":null,"reference":null,"refund_account_holder_address_city":null,"refund_account_holder_address_country":null,"refund_account_holder_address_line1":null,"refund_account_holder_address_line2":null,"refund_account_holder_address_postal_code":null,"refund_account_holder_address_state":null,"refund_account_holder_name":null,"refund_iban":null},
    "object": "source",
    "owner": null,
    "p24": {"reference":null},
    "receiver": {"address":null,"amount_charged":0,"amount_received":0,"amount_returned":0,"refund_attributes_method":"","refund_attributes_status":""},
    "redirect": {"failure_reason":null,"return_url":"","status":"","url":""},
    "sepa_debit": {"bank_code":null,"branch_code":null,"country":null,"fingerprint":null,"last4":null,"mandate_reference":null,"mandate_url":null},
    "sofort": {"bank_code":null,"bank_name":null,"bic":null,"country":null,"iban_last4":null,"preferred_language":null,"statement_descriptor":null},
    "source_order": {"amount":0,"currency":"","email":"","items":null,"shipping":null},
    "statement_descriptor": null,
    "status": "",
    "three_d_secure": {"address_line1_check":null,"address_zip_check":null,"authenticated":null,"brand":null,"card":null,"country":null,"customer":null,"cvc_check":null,"dynamic_last4":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"name":null,"three_d_secure":"","tokenization_method":null},
    "type": "ach_credit_transfer",
    "usage": null,
    "wechat": {"prepay_id":"","qr_code_url":null,"statement_descriptor":""},
    ...overrides,
  };
}

export function defaultSourceMandateNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "acss_debit": {"statement_descriptor":""},
    "amount": 0,
    "bacs_debit": {"last4":""},
    "created": unixNow(),
    "id": generateId("src_", 14),
    "livemode": false,
    "object": "source_mandate_notification",
    "reason": "",
    "sepa_debit": {"creditor_identifier":"","last4":"","mandate_reference":""},
    "source": {"ach_credit_transfer":{"account_number":null,"bank_name":null,"fingerprint":null,"refund_account_holder_name":null,"refund_account_holder_type":null,"refund_routing_number":null,"routing_number":null,"swift_code":null},"ach_debit":{"bank_name":null,"country":null,"fingerprint":null,"last4":null,"routing_number":null,"type":null},"acss_debit":{"bank_address_city":null,"bank_address_line_1":null,"bank_address_line_2":null,"bank_address_postal_code":null,"bank_name":null,"category":null,"country":null,"fingerprint":null,"last4":null,"routing_number":null},"alipay":{"data_string":null,"native_url":null,"statement_descriptor":null},"allow_redisplay":null,"amount":null,"au_becs_debit":{"bsb_number":null,"fingerprint":null,"last4":null},"bancontact":{"bank_code":null,"bank_name":null,"bic":null,"iban_last4":null,"preferred_language":null,"statement_descriptor":null},"card":{"address_line1_check":null,"address_zip_check":null,"brand":null,"country":null,"cvc_check":null,"dynamic_last4":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"name":null,"three_d_secure":"","tokenization_method":null},"card_present":{"application_cryptogram":"","application_preferred_name":"","authorization_code":null,"authorization_response_code":"","brand":null,"country":null,"cvm_type":"","data_type":null,"dedicated_file_name":"","emv_auth_data":"","evidence_customer_signature":null,"evidence_transaction_certificate":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"pos_device_id":null,"pos_entry_mode":"","read_method":null,"reader":null,"terminal_verification_results":"","transaction_status_information":""},"client_secret":"","code_verification":{"attempts_remaining":0,"status":""},"created":0,"currency":null,"customer":"","eps":{"reference":null,"statement_descriptor":null},"flow":"","giropay":{"bank_code":null,"bank_name":null,"bic":null,"statement_descriptor":null},"id":"","ideal":{"bank":null,"bic":null,"iban_last4":null,"statement_descriptor":null},"klarna":{"background_image_url":"","client_token":null,"first_name":"","last_name":"","locale":"","logo_url":"","page_title":"","pay_later_asset_urls_descriptive":"","pay_later_asset_urls_standard":"","pay_later_name":"","pay_later_redirect_url":"","pay_now_asset_urls_descriptive":"","pay_now_asset_urls_standard":"","pay_now_name":"","pay_now_redirect_url":"","pay_over_time_asset_urls_descriptive":"","pay_over_time_asset_urls_standard":"","pay_over_time_name":"","pay_over_time_redirect_url":"","payment_method_categories":"","purchase_country":"","purchase_type":"","redirect_url":"","shipping_delay":0,"shipping_first_name":"","shipping_last_name":""},"livemode":false,"metadata":null,"multibanco":{"entity":null,"reference":null,"refund_account_holder_address_city":null,"refund_account_holder_address_country":null,"refund_account_holder_address_line1":null,"refund_account_holder_address_line2":null,"refund_account_holder_address_postal_code":null,"refund_account_holder_address_state":null,"refund_account_holder_name":null,"refund_iban":null},"object":"source","owner":null,"p24":{"reference":null},"receiver":{"address":null,"amount_charged":0,"amount_received":0,"amount_returned":0,"refund_attributes_method":"","refund_attributes_status":""},"redirect":{"failure_reason":null,"return_url":"","status":"","url":""},"sepa_debit":{"bank_code":null,"branch_code":null,"country":null,"fingerprint":null,"last4":null,"mandate_reference":null,"mandate_url":null},"sofort":{"bank_code":null,"bank_name":null,"bic":null,"country":null,"iban_last4":null,"preferred_language":null,"statement_descriptor":null},"source_order":{"amount":0,"currency":"","email":"","items":null,"shipping":null},"statement_descriptor":null,"status":"","three_d_secure":{"address_line1_check":null,"address_zip_check":null,"authenticated":null,"brand":null,"card":null,"country":null,"customer":null,"cvc_check":null,"dynamic_last4":null,"exp_month":null,"exp_year":null,"fingerprint":"","funding":null,"last4":null,"name":null,"three_d_secure":"","tokenization_method":null},"type":"ach_credit_transfer","usage":null,"wechat":{"prepay_id":"","qr_code_url":null,"statement_descriptor":""}},
    "status": "",
    "type": "",
    ...overrides,
  };
}

export function defaultSourceTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "ach_credit_transfer": {"customer_data":"","fingerprint":"","last4":"","routing_number":""},
    "amount": 0,
    "chf_credit_transfer": {"reference":"","sender_address_country":"","sender_address_line1":"","sender_iban":"","sender_name":""},
    "created": unixNow(),
    "currency": "",
    "gbp_credit_transfer": {"fingerprint":"","funding_method":"","last4":"","reference":"","sender_account_number":"","sender_name":"","sender_sort_code":""},
    "id": generateId("srctxn_", 14),
    "livemode": false,
    "object": "source_transaction",
    "paper_check": {"available_at":"","invoices":""},
    "sepa_credit_transfer": {"reference":"","sender_iban":"","sender_name":""},
    "source": "",
    "status": "",
    "type": "ach_credit_transfer",
    ...overrides,
  };
}

export function defaultSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "application": null,
    "application_fee_percent": null,
    "automatic_tax": {"disabled_reason":null,"enabled":false,"liability":null},
    "billing_cycle_anchor": undefined,
    "billing_cycle_anchor_config": null,
    "billing_mode": {"flexible":null,"type":"classic","updated_at":0},
    "billing_thresholds": null,
    "cancel_at": undefined,
    "cancel_at_period_end": false,
    "canceled_at": undefined,
    "cancellation_details": null,
    "collection_method": "charge_automatically",
    "created": unixNow(),
    "currency": "",
    "customer": "",
    "customer_account": null,
    "days_until_due": null,
    "default_payment_method": null,
    "default_source": null,
    "default_tax_rates": null,
    "description": null,
    "discounts": [],
    "ended_at": undefined,
    "id": generateId("sub_", 14),
    "invoice_settings": {"account_tax_ids":null,"issuer":{"account":"","type":"account"}},
    "items": {"data":[],"has_more":false,"object":"list","url":""},
    "latest_invoice": null,
    "livemode": false,
    "metadata": {},
    "next_pending_invoice_item_invoice": undefined,
    "object": "subscription",
    "on_behalf_of": null,
    "pause_collection": null,
    "payment_settings": null,
    "pending_invoice_item_interval": null,
    "pending_setup_intent": null,
    "pending_update": null,
    "schedule": null,
    "start_date": undefined,
    "status": "active",
    "test_clock": null,
    "transfer_data": null,
    "trial_end": undefined,
    "trial_settings": null,
    "trial_start": undefined,
    ...overrides,
  };
}

export function defaultSubscriptionItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "billing_thresholds": null,
    "created": unixNow(),
    "current_period_end": undefined,
    "current_period_start": undefined,
    "discounts": [],
    "id": generateId("si_", 14),
    "metadata": {},
    "object": "subscription_item",
    "price": {"active":false,"billing_scheme":"per_unit","created":0,"currency":"","currency_options":{},"custom_unit_amount":null,"id":"","livemode":false,"lookup_key":null,"metadata":{},"nickname":null,"object":"price","product":"","recurring":null,"tax_behavior":null,"tiers":[],"tiers_mode":null,"transform_quantity":null,"type":"one_time","unit_amount":null,"unit_amount_decimal":null},
    "quantity": 0,
    "subscription": "",
    "tax_rates": null,
    ...overrides,
  };
}

export function defaultSubscriptionSchedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "application": null,
    "billing_mode": {"flexible":null,"type":"classic","updated_at":0},
    "canceled_at": undefined,
    "completed_at": undefined,
    "created": unixNow(),
    "current_phase": null,
    "customer": "",
    "customer_account": null,
    "default_settings": {"application_fee_percent":null,"automatic_tax":{"disabled_reason":null,"enabled":false,"liability":null},"billing_cycle_anchor":"automatic","billing_thresholds":null,"collection_method":null,"default_payment_method":null,"description":null,"invoice_settings":{"account_tax_ids":null,"days_until_due":null,"issuer":{"account":"","type":"account"}},"on_behalf_of":null,"transfer_data":null},
    "end_behavior": "cancel",
    "id": generateId("sub_sched_", 14),
    "livemode": false,
    "metadata": {},
    "object": "subscription_schedule",
    "phases": [],
    "released_at": undefined,
    "released_subscription": null,
    "status": "active",
    "subscription": null,
    "test_clock": null,
    ...overrides,
  };
}

export function defaultTaxAssociation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "calculation": "",
    "id": generateId("", 14),
    "object": "tax.association",
    "payment_intent": "",
    "tax_transaction_attempts": null,
    ...overrides,
  };
}

export function defaultTaxCalculation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount_total": 0,
    "currency": "",
    "customer": null,
    "customer_details": {"address":null,"address_source":null,"ip_address":null,"tax_ids":[],"taxability_override":"customer_exempt"},
    "expires_at": undefined,
    "id": generateId("", 14),
    "line_items": null,
    "livemode": false,
    "object": "tax.calculation",
    "ship_from_details": null,
    "shipping_cost": null,
    "tax_amount_exclusive": 0,
    "tax_amount_inclusive": 0,
    "tax_breakdown": [],
    "tax_date": undefined,
    ...overrides,
  };
}

export function defaultTaxCalculationLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_tax": 0,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "tax.calculation_line_item",
    "product": null,
    "quantity": 0,
    "reference": "",
    "tax_behavior": "exclusive",
    "tax_breakdown": null,
    "tax_code": "",
    ...overrides,
  };
}

export function defaultTaxRegistration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active_from": undefined,
    "country": "",
    "country_options": {"ae":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"al":{"type":"standard"},"am":{"type":"simplified"},"ao":{"type":"standard"},"at":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"au":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"aw":{"type":"standard"},"az":{"type":"simplified"},"ba":{"type":"standard"},"bb":{"type":"standard"},"bd":{"type":"standard"},"be":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"bf":{"type":"standard"},"bg":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"bh":{"type":"standard"},"bj":{"type":"simplified"},"bs":{"type":"standard"},"by":{"type":"simplified"},"ca":{"province_standard":{"province":""},"type":"province_standard"},"cd":{"type":"standard"},"ch":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"cl":{"type":"simplified"},"cm":{"type":"simplified"},"co":{"type":"simplified"},"cr":{"type":"simplified"},"cv":{"type":"simplified"},"cy":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"cz":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"de":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"dk":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"ec":{"type":"simplified"},"ee":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"eg":{"type":"simplified"},"es":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"et":{"type":"standard"},"fi":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"fr":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"gb":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"ge":{"type":"simplified"},"gn":{"type":"standard"},"gr":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"hr":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"hu":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"id":{"type":"simplified"},"ie":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"in":{"type":"simplified"},"is":{"type":"standard"},"it":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"jp":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"ke":{"type":"simplified"},"kg":{"type":"simplified"},"kh":{"type":"simplified"},"kr":{"type":"simplified"},"kz":{"type":"simplified"},"la":{"type":"simplified"},"lk":{"type":"simplified"},"lt":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"lu":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"lv":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"ma":{"type":"simplified"},"md":{"type":"simplified"},"me":{"type":"standard"},"mk":{"type":"standard"},"mr":{"type":"standard"},"mt":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"mx":{"type":"simplified"},"my":{"type":"simplified"},"ng":{"type":"simplified"},"nl":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"no":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"np":{"type":"simplified"},"nz":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"om":{"type":"standard"},"pe":{"type":"simplified"},"ph":{"type":"simplified"},"pl":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"pt":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"ro":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"rs":{"type":"standard"},"ru":{"type":"simplified"},"sa":{"type":"simplified"},"se":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"sg":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"standard"},"si":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"sk":{"standard":{"place_of_supply_scheme":"inbound_goods"},"type":"ioss"},"sn":{"type":"simplified"},"sr":{"type":"standard"},"th":{"type":"simplified"},"tj":{"type":"simplified"},"tr":{"type":"simplified"},"tw":{"type":"simplified"},"tz":{"type":"simplified"},"ua":{"type":"simplified"},"ug":{"type":"simplified"},"us":{"local_amusement_tax":{"jurisdiction":""},"local_lease_tax":{"jurisdiction":""},"state":"","state_sales_tax":{"elections":[]},"type":"local_amusement_tax"},"uy":{"type":"standard"},"uz":{"type":"simplified"},"vn":{"type":"simplified"},"za":{"type":"standard"},"zm":{"type":"simplified"},"zw":{"type":"standard"}},
    "created": unixNow(),
    "expires_at": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "object": "tax.registration",
    "status": "active",
    ...overrides,
  };
}

export function defaultTaxSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "defaults": {"provider":"anrok","tax_behavior":null,"tax_code":null},
    "head_office": null,
    "livemode": false,
    "object": "tax.settings",
    "status": "active",
    "status_details": {"active":{},"pending":{"missing_fields":null}},
    ...overrides,
  };
}

export function defaultTaxTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "currency": "",
    "customer": null,
    "customer_details": {"address":null,"address_source":null,"ip_address":null,"tax_ids":[],"taxability_override":"customer_exempt"},
    "id": generateId("", 14),
    "line_items": null,
    "livemode": false,
    "metadata": {},
    "object": "tax.transaction",
    "posted_at": undefined,
    "reference": "",
    "reversal": null,
    "ship_from_details": null,
    "shipping_cost": null,
    "tax_date": undefined,
    "type": "reversal",
    ...overrides,
  };
}

export function defaultTaxTransactionLineItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_tax": 0,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "tax.transaction_line_item",
    "product": null,
    "quantity": 0,
    "reference": "",
    "reversal": null,
    "tax_behavior": "exclusive",
    "tax_code": "",
    "type": "reversal",
    ...overrides,
  };
}

export function defaultTaxCode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "description": "",
    "id": generateId("", 14),
    "name": "",
    "object": "tax_code",
    ...overrides,
  };
}

export function defaultTaxId(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "country": null,
    "created": unixNow(),
    "customer": null,
    "customer_account": null,
    "id": generateId("txi_", 14),
    "livemode": false,
    "object": "tax_id",
    "owner": null,
    "type": "ad_nrt",
    "value": "",
    "verification": null,
    ...overrides,
  };
}

export function defaultTaxRate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active": false,
    "country": null,
    "created": unixNow(),
    "description": null,
    "display_name": "",
    "effective_percentage": null,
    "flat_amount": null,
    "id": generateId("txr_", 14),
    "inclusive": false,
    "jurisdiction": null,
    "jurisdiction_level": "city",
    "livemode": false,
    "metadata": {},
    "object": "tax_rate",
    "percentage": 0,
    "rate_type": "flat_amount",
    "state": null,
    "tax_type": "amusement_tax",
    ...overrides,
  };
}

export function defaultTerminalConfiguration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "bbpos_wisepad3": {"splashscreen":""},
    "bbpos_wisepos_e": {"splashscreen":""},
    "cellular": {"enabled":false},
    "id": generateId("", 14),
    "is_account_default": null,
    "livemode": false,
    "name": null,
    "object": "terminal.configuration",
    "offline": {"enabled":null},
    "reboot_window": {"end_hour":0,"start_hour":0},
    "stripe_s700": {"splashscreen":""},
    "stripe_s710": {"splashscreen":""},
    "tipping": {"aed":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"aud":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"cad":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"chf":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"czk":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"dkk":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"eur":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"gbp":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"gip":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"hkd":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"huf":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"jpy":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"mxn":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"myr":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"nok":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"nzd":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"pln":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"ron":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"sek":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"sgd":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0},"usd":{"fixed_amounts":null,"percentages":null,"smart_tip_threshold":0}},
    "verifone_p400": {"splashscreen":""},
    "wifi": {"enterprise_eap_peap":{"ca_certificate_file":"","password":"","ssid":"","username":""},"enterprise_eap_tls":{"ca_certificate_file":"","client_certificate_file":"","private_key_file":"","private_key_file_password":"","ssid":""},"personal_psk":{"password":"","ssid":""},"type":"enterprise_eap_peap"},
    ...overrides,
  };
}

export function defaultTerminalConnectionToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "location": null,
    "object": "terminal.connection_token",
    "secret": "",
    ...overrides,
  };
}

export function defaultTerminalLocation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "address": {"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},
    "address_kana": null,
    "address_kanji": null,
    "configuration_overrides": null,
    "display_name": "",
    "display_name_kana": null,
    "display_name_kanji": null,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "terminal.location",
    "phone": null,
    ...overrides,
  };
}

export function defaultTerminalOnboardingLink(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "link_options": {"apple_terms_and_conditions":null},
    "link_type": "apple_terms_and_conditions",
    "object": "terminal.onboarding_link",
    "on_behalf_of": null,
    "redirect_url": "",
    ...overrides,
  };
}

export function defaultTerminalReader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "action": null,
    "device_sw_version": null,
    "device_type": "bbpos_chipper2x",
    "id": generateId("", 14),
    "ip_address": null,
    "label": "",
    "last_seen_at": undefined,
    "livemode": false,
    "location": null,
    "metadata": {},
    "object": "terminal.reader",
    "serial_number": "",
    "status": "offline",
    ...overrides,
  };
}

export function defaultTerminalRefund(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...overrides,
  };
}

export function defaultTestHelpersTestClock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "created": unixNow(),
    "deletes_after": undefined,
    "frozen_time": undefined,
    "id": generateId("", 14),
    "livemode": false,
    "name": null,
    "object": "test_helpers.test_clock",
    "status": "advancing",
    "status_details": {"advancing":{"target_frozen_time":0}},
    ...overrides,
  };
}

export function defaultToken(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "bank_account": {"account":null,"account_holder_name":null,"account_holder_type":null,"account_type":null,"available_payout_methods":null,"bank_name":null,"country":"","currency":"","customer":null,"default_for_currency":null,"fingerprint":null,"future_requirements":null,"id":"","last4":"","metadata":null,"object":"bank_account","requirements":null,"routing_number":null,"status":""},
    "card": {"account":null,"address_city":null,"address_country":null,"address_line1":null,"address_line1_check":null,"address_line2":null,"address_state":null,"address_zip":null,"address_zip_check":null,"allow_redisplay":null,"available_payout_methods":null,"brand":"","country":null,"currency":null,"customer":null,"cvc_check":null,"default_for_currency":null,"dynamic_last4":null,"exp_month":0,"exp_year":0,"fingerprint":null,"funding":"","id":"","iin":"","last4":"","metadata":null,"name":null,"networks":{"preferred":null},"object":"card","regulated_status":null,"status":null,"tokenization_method":null},
    "client_ip": null,
    "created": unixNow(),
    "id": generateId("tok_", 14),
    "livemode": false,
    "object": "token",
    "type": "",
    "used": false,
    ...overrides,
  };
}

export function defaultTopup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transaction": null,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "expected_availability_date": null,
    "failure_code": null,
    "failure_message": null,
    "id": generateId("tu_", 14),
    "livemode": false,
    "metadata": {},
    "object": "topup",
    "source": null,
    "statement_descriptor": null,
    "status": "canceled",
    "transfer_group": null,
    ...overrides,
  };
}

export function defaultTransfer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "amount_reversed": 0,
    "balance_transaction": null,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "destination": null,
    "destination_payment": null,
    "id": generateId("tr_", 14),
    "livemode": false,
    "metadata": {},
    "object": "transfer",
    "reversals": {"data":[],"has_more":false,"object":"list","url":""},
    "reversed": false,
    "source_transaction": null,
    "source_type": null,
    "transfer_group": null,
    ...overrides,
  };
}

export function defaultTransferReversal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_transaction": null,
    "created": unixNow(),
    "currency": "",
    "destination_payment_refund": null,
    "id": generateId("trr_", 14),
    "metadata": {},
    "object": "transfer_reversal",
    "source_refund": null,
    "transfer": "",
    ...overrides,
  };
}

export function defaultTreasuryCreditReversal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "created": unixNow(),
    "currency": "",
    "financial_account": "",
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "network": "ach",
    "object": "treasury.credit_reversal",
    "received_credit": "",
    "status": "canceled",
    "status_transitions": {"posted_at":null},
    "transaction": null,
    ...overrides,
  };
}

export function defaultTreasuryDebitReversal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "created": unixNow(),
    "currency": "",
    "financial_account": null,
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "linked_flows": null,
    "livemode": false,
    "metadata": {},
    "network": "ach",
    "object": "treasury.debit_reversal",
    "received_debit": "",
    "status": "failed",
    "status_transitions": {"completed_at":null},
    "transaction": null,
    ...overrides,
  };
}

export function defaultTreasuryFinancialAccount(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "active_features": [],
    "balance": {"cash":{},"inbound_pending":{},"outbound_pending":{}},
    "country": "",
    "created": unixNow(),
    "features": {"card_issuing":{"requested":false,"status":"active","status_details":[]},"deposit_insurance":{"requested":false,"status":"active","status_details":[]},"financial_addresses":{"aba":{"requested":false,"status":"active","status_details":[]}},"inbound_transfers":{"ach":{"requested":false,"status":"active","status_details":[]}},"intra_stripe_flows":{"requested":false,"status":"active","status_details":[]},"object":"treasury.financial_account_features","outbound_payments":{"ach":{"requested":false,"status":"active","status_details":[]},"us_domestic_wire":{"requested":false,"status":"active","status_details":[]}},"outbound_transfers":{"ach":{"requested":false,"status":"active","status_details":[]},"us_domestic_wire":{"requested":false,"status":"active","status_details":[]}}},
    "financial_addresses": [],
    "id": generateId("", 14),
    "is_default": false,
    "livemode": false,
    "metadata": {},
    "nickname": null,
    "object": "treasury.financial_account",
    "pending_features": [],
    "platform_restrictions": null,
    "restricted_features": [],
    "status": "closed",
    "status_details": {"closed":null},
    "supported_currencies": [],
    ...overrides,
  };
}

export function defaultTreasuryFinancialAccountFeatures(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "card_issuing": {"requested":false,"status":"active","status_details":[]},
    "deposit_insurance": {"requested":false,"status":"active","status_details":[]},
    "financial_addresses": {"aba":{"requested":false,"status":"active","status_details":[]}},
    "inbound_transfers": {"ach":{"requested":false,"status":"active","status_details":[]}},
    "intra_stripe_flows": {"requested":false,"status":"active","status_details":[]},
    "object": "treasury.financial_account_features",
    "outbound_payments": {"ach":{"requested":false,"status":"active","status_details":[]},"us_domestic_wire":{"requested":false,"status":"active","status_details":[]}},
    "outbound_transfers": {"ach":{"requested":false,"status":"active","status_details":[]},"us_domestic_wire":{"requested":false,"status":"active","status_details":[]}},
    ...overrides,
  };
}

export function defaultTreasuryInboundTransfer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "cancelable": false,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "failure_details": null,
    "financial_account": "",
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "linked_flows": {"received_debit":null},
    "livemode": false,
    "metadata": {},
    "object": "treasury.inbound_transfer",
    "origin_payment_method": null,
    "origin_payment_method_details": null,
    "returned": null,
    "statement_descriptor": "",
    "status": "canceled",
    "status_transitions": {"canceled_at":null,"failed_at":null,"succeeded_at":null},
    "transaction": null,
    ...overrides,
  };
}

export function defaultTreasuryOutboundPayment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "cancelable": false,
    "created": unixNow(),
    "currency": "",
    "customer": null,
    "description": null,
    "destination_payment_method": null,
    "destination_payment_method_details": null,
    "end_user_details": null,
    "expected_arrival_date": undefined,
    "financial_account": "",
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "treasury.outbound_payment",
    "returned_details": null,
    "statement_descriptor": "",
    "status": "canceled",
    "status_transitions": {"canceled_at":null,"failed_at":null,"posted_at":null,"returned_at":null},
    "tracking_details": null,
    "transaction": "",
    ...overrides,
  };
}

export function defaultTreasuryOutboundTransfer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "cancelable": false,
    "created": unixNow(),
    "currency": "",
    "description": null,
    "destination_payment_method": null,
    "destination_payment_method_details": {"billing_details":{"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"email":null,"name":null},"financial_account":{"id":"","network":"stripe"},"type":"financial_account","us_bank_account":{"account_holder_type":null,"account_type":null,"bank_name":null,"fingerprint":null,"last4":null,"mandate":"","network":"ach","routing_number":null}},
    "expected_arrival_date": undefined,
    "financial_account": "",
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "livemode": false,
    "metadata": {},
    "object": "treasury.outbound_transfer",
    "returned_details": null,
    "statement_descriptor": "",
    "status": "canceled",
    "status_transitions": {"canceled_at":null,"failed_at":null,"posted_at":null,"returned_at":null},
    "tracking_details": null,
    "transaction": "",
    ...overrides,
  };
}

export function defaultTreasuryReceivedCredit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "created": unixNow(),
    "currency": "",
    "description": "",
    "failure_code": "account_closed",
    "financial_account": null,
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "initiating_payment_method_details": {"balance":"payments","billing_details":{"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"email":null,"name":null},"financial_account":{"id":"","network":"stripe"},"issuing_card":"","type":"balance","us_bank_account":{"bank_name":null,"last4":null,"routing_number":null}},
    "linked_flows": {"credit_reversal":null,"issuing_authorization":null,"issuing_transaction":null,"source_flow":null,"source_flow_details":null,"source_flow_type":null},
    "livemode": false,
    "network": "ach",
    "object": "treasury.received_credit",
    "reversal_details": null,
    "status": "failed",
    "transaction": null,
    ...overrides,
  };
}

export function defaultTreasuryReceivedDebit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "created": unixNow(),
    "currency": "",
    "description": "",
    "failure_code": "account_closed",
    "financial_account": null,
    "hosted_regulatory_receipt_url": null,
    "id": generateId("", 14),
    "initiating_payment_method_details": {"balance":"payments","billing_details":{"address":{"city":null,"country":null,"line1":null,"line2":null,"postal_code":null,"state":null},"email":null,"name":null},"financial_account":{"id":"","network":"stripe"},"issuing_card":"","type":"balance","us_bank_account":{"bank_name":null,"last4":null,"routing_number":null}},
    "linked_flows": {"debit_reversal":null,"inbound_transfer":null,"issuing_authorization":null,"issuing_transaction":null,"payout":null,"topup":null},
    "livemode": false,
    "network": "ach",
    "object": "treasury.received_debit",
    "reversal_details": null,
    "status": "failed",
    "transaction": null,
    ...overrides,
  };
}

export function defaultTreasuryTransaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "amount": 0,
    "balance_impact": {"cash":0,"inbound_pending":0,"outbound_pending":0},
    "created": unixNow(),
    "currency": "",
    "description": "",
    "entries": null,
    "financial_account": "",
    "flow": null,
    "flow_details": null,
    "flow_type": "credit_reversal",
    "id": generateId("", 14),
    "livemode": false,
    "object": "treasury.transaction",
    "status": "open",
    "status_transitions": {"posted_at":null,"void_at":null},
    ...overrides,
  };
}

export function defaultTreasuryTransactionEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "balance_impact": {"cash":0,"inbound_pending":0,"outbound_pending":0},
    "created": unixNow(),
    "currency": "",
    "effective_at": undefined,
    "financial_account": "",
    "flow": null,
    "flow_details": null,
    "flow_type": "credit_reversal",
    "id": generateId("", 14),
    "livemode": false,
    "object": "treasury.transaction_entry",
    "transaction": "",
    "type": "credit_reversal",
    ...overrides,
  };
}

export function defaultWebhookEndpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "api_version": null,
    "application": null,
    "created": unixNow(),
    "description": null,
    "enabled_events": [],
    "id": generateId("we_", 14),
    "livemode": false,
    "metadata": {},
    "object": "webhook_endpoint",
    "secret": null,
    "status": "",
    "url": "",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lookup map: resourceId → default factory
// ---------------------------------------------------------------------------

export type DefaultFactory = (overrides?: Record<string, unknown>) => Record<string, unknown>;

export const SCHEMA_DEFAULTS: Record<string, DefaultFactory> = {
  "account": defaultAccount,
  "account_link": defaultAccountLink,
  "account_links": defaultAccountLink,
  "account_session": defaultAccountSession,
  "account_sessions": defaultAccountSession,
  "apple_pay_domain": defaultApplePayDomain,
  "apple_pay_domains": defaultApplePayDomain,
  "application_fee": defaultApplicationFee,
  "application_fees": defaultApplicationFee,
  "apps.secret": defaultAppsSecret,
  "apps.secrets": defaultAppsSecret,
  "balance": defaultBalance,
  "balance_settings": defaultBalanceSettings,
  "balance_transaction": defaultBalanceTransaction,
  "balance_transactions": defaultBalanceTransaction,
  "bank_account": defaultBankAccount,
  "bank_accounts": defaultBankAccount,
  "billing.alert": defaultBillingAlert,
  "billing.alerts": defaultBillingAlert,
  "billing.credit_balance_summary": defaultBillingCreditBalanceSummary,
  "billing.credit_balance_summaries": defaultBillingCreditBalanceSummary,
  "billing.credit_balance_transaction": defaultBillingCreditBalanceTransaction,
  "billing.credit_balance_transactions": defaultBillingCreditBalanceTransaction,
  "billing.credit_grant": defaultBillingCreditGrant,
  "billing.credit_grants": defaultBillingCreditGrant,
  "billing.meter": defaultBillingMeter,
  "billing.meters": defaultBillingMeter,
  "billing.meter_event": defaultBillingMeterEvent,
  "billing.meter_events": defaultBillingMeterEvent,
  "billing.meter_event_adjustment": defaultBillingMeterEventAdjustment,
  "billing.meter_event_adjustments": defaultBillingMeterEventAdjustment,
  "billing.meter_event_summary": defaultBillingMeterEventSummary,
  "billing.meter_event_summaries": defaultBillingMeterEventSummary,
  "billing_portal.configuration": defaultBillingPortalConfiguration,
  "billing_portal.configurations": defaultBillingPortalConfiguration,
  "billing_portal.session": defaultBillingPortalSession,
  "billing_portal.sessions": defaultBillingPortalSession,
  "capability": defaultCapability,
  "capabilities": defaultCapability,
  "card": defaultCard,
  "cards": defaultCard,
  "cash_balance": defaultCashBalance,
  "cash_balances": defaultCashBalance,
  "charge": defaultCharge,
  "charges": defaultCharge,
  "checkout.session": defaultCheckoutSession,
  "checkout.sessions": defaultCheckoutSession,
  "climate.order": defaultClimateOrder,
  "climate.orders": defaultClimateOrder,
  "climate.product": defaultClimateProduct,
  "climate.products": defaultClimateProduct,
  "climate.supplier": defaultClimateSupplier,
  "climate.suppliers": defaultClimateSupplier,
  "confirmation_token": defaultConfirmationToken,
  "confirmation_tokens": defaultConfirmationToken,
  "country_spec": defaultCountrySpec,
  "country_specs": defaultCountrySpec,
  "coupon": defaultCoupon,
  "coupons": defaultCoupon,
  "credit_note": defaultCreditNote,
  "credit_notes": defaultCreditNote,
  "credit_note_line_item": defaultCreditNoteLineItem,
  "credit_note_line_items": defaultCreditNoteLineItem,
  "customer": defaultCustomer,
  "customers": defaultCustomer,
  "customer_balance_transaction": defaultCustomerBalanceTransaction,
  "customer_balance_transactions": defaultCustomerBalanceTransaction,
  "customer_cash_balance_transaction": defaultCustomerCashBalanceTransaction,
  "customer_cash_balance_transactions": defaultCustomerCashBalanceTransaction,
  "customer_session": defaultCustomerSession,
  "customer_sessions": defaultCustomerSession,
  "discount": defaultDiscount,
  "discounts": defaultDiscount,
  "dispute": defaultDispute,
  "disputes": defaultDispute,
  "entitlements.active_entitlement": defaultEntitlementsActiveEntitlement,
  "entitlements.active_entitlements": defaultEntitlementsActiveEntitlement,
  "entitlements.feature": defaultEntitlementsFeature,
  "entitlements.features": defaultEntitlementsFeature,
  "ephemeral_key": defaultEphemeralKey,
  "ephemeral_keys": defaultEphemeralKey,
  "event": defaultEvent,
  "events": defaultEvent,
  "exchange_rate": defaultExchangeRate,
  "exchange_rates": defaultExchangeRate,
  "external_account": defaultExternalAccount,
  "external_accounts": defaultExternalAccount,
  "fee_refund": defaultFeeRefund,
  "fee_refunds": defaultFeeRefund,
  "file": defaultFile,
  "files": defaultFile,
  "file_link": defaultFileLink,
  "file_links": defaultFileLink,
  "financial_connections.account": defaultFinancialConnectionsAccount,
  "financial_connections.accounts": defaultFinancialConnectionsAccount,
  "financial_connections.account_owner": defaultFinancialConnectionsAccountOwner,
  "financial_connections.account_owners": defaultFinancialConnectionsAccountOwner,
  "financial_connections.session": defaultFinancialConnectionsSession,
  "financial_connections.sessions": defaultFinancialConnectionsSession,
  "financial_connections.transaction": defaultFinancialConnectionsTransaction,
  "financial_connections.transactions": defaultFinancialConnectionsTransaction,
  "forwarding.request": defaultForwardingRequest,
  "forwarding.requests": defaultForwardingRequest,
  "funding_instructions": defaultFundingInstructions,
  "funding_instructionss": defaultFundingInstructions,
  "identity.verification_report": defaultIdentityVerificationReport,
  "identity.verification_reports": defaultIdentityVerificationReport,
  "identity.verification_session": defaultIdentityVerificationSession,
  "identity.verification_sessions": defaultIdentityVerificationSession,
  "invoice": defaultInvoice,
  "invoices": defaultInvoice,
  "invoice_payment": defaultInvoicePayment,
  "invoice_payments": defaultInvoicePayment,
  "invoice_rendering_template": defaultInvoiceRenderingTemplate,
  "invoice_rendering_templates": defaultInvoiceRenderingTemplate,
  "invoiceitem": defaultInvoiceitem,
  "invoiceitems": defaultInvoiceitem,
  "issuing.authorization": defaultIssuingAuthorization,
  "issuing.authorizations": defaultIssuingAuthorization,
  "issuing.card": defaultIssuingCard,
  "issuing.cards": defaultIssuingCard,
  "issuing.cardholder": defaultIssuingCardholder,
  "issuing.cardholders": defaultIssuingCardholder,
  "issuing.dispute": defaultIssuingDispute,
  "issuing.disputes": defaultIssuingDispute,
  "issuing.personalization_design": defaultIssuingPersonalizationDesign,
  "issuing.personalization_designs": defaultIssuingPersonalizationDesign,
  "issuing.physical_bundle": defaultIssuingPhysicalBundle,
  "issuing.physical_bundles": defaultIssuingPhysicalBundle,
  "issuing.settlement": defaultIssuingSettlement,
  "issuing.settlements": defaultIssuingSettlement,
  "issuing.token": defaultIssuingToken,
  "issuing.tokens": defaultIssuingToken,
  "issuing.transaction": defaultIssuingTransaction,
  "issuing.transactions": defaultIssuingTransaction,
  "item": defaultItem,
  "items": defaultItem,
  "line_item": defaultLineItem,
  "line_items": defaultLineItem,
  "login_link": defaultLoginLink,
  "login_links": defaultLoginLink,
  "mandate": defaultMandate,
  "mandates": defaultMandate,
  "payment_attempt_record": defaultPaymentAttemptRecord,
  "payment_attempt_records": defaultPaymentAttemptRecord,
  "payment_intent": defaultPaymentIntent,
  "payment_intents": defaultPaymentIntent,
  "payment_intent_amount_details_line_item": defaultPaymentIntentAmountDetailsLineItem,
  "payment_intent_amount_details_line_items": defaultPaymentIntentAmountDetailsLineItem,
  "payment_link": defaultPaymentLink,
  "payment_links": defaultPaymentLink,
  "payment_method": defaultPaymentMethod,
  "payment_methods": defaultPaymentMethod,
  "payment_method_configuration": defaultPaymentMethodConfiguration,
  "payment_method_configurations": defaultPaymentMethodConfiguration,
  "payment_method_domain": defaultPaymentMethodDomain,
  "payment_method_domains": defaultPaymentMethodDomain,
  "payment_record": defaultPaymentRecord,
  "payment_records": defaultPaymentRecord,
  "payment_source": defaultPaymentSource,
  "payment_sources": defaultPaymentSource,
  "payout": defaultPayout,
  "payouts": defaultPayout,
  "person": defaultPerson,
  "persons": defaultPerson,
  "plan": defaultPlan,
  "plans": defaultPlan,
  "price": defaultPrice,
  "prices": defaultPrice,
  "product": defaultProduct,
  "products": defaultProduct,
  "product_feature": defaultProductFeature,
  "product_features": defaultProductFeature,
  "promotion_code": defaultPromotionCode,
  "promotion_codes": defaultPromotionCode,
  "quote": defaultQuote,
  "quotes": defaultQuote,
  "radar.early_fraud_warning": defaultRadarEarlyFraudWarning,
  "radar.early_fraud_warnings": defaultRadarEarlyFraudWarning,
  "radar.payment_evaluation": defaultRadarPaymentEvaluation,
  "radar.payment_evaluations": defaultRadarPaymentEvaluation,
  "radar.value_list": defaultRadarValueList,
  "radar.value_lists": defaultRadarValueList,
  "radar.value_list_item": defaultRadarValueListItem,
  "radar.value_list_items": defaultRadarValueListItem,
  "refund": defaultRefund,
  "refunds": defaultRefund,
  "reporting.report_run": defaultReportingReportRun,
  "reporting.report_runs": defaultReportingReportRun,
  "reporting.report_type": defaultReportingReportType,
  "reporting.report_types": defaultReportingReportType,
  "review": defaultReview,
  "reviews": defaultReview,
  "scheduled_query_run": defaultScheduledQueryRun,
  "scheduled_query_runs": defaultScheduledQueryRun,
  "setup_attempt": defaultSetupAttempt,
  "setup_attempts": defaultSetupAttempt,
  "setup_intent": defaultSetupIntent,
  "setup_intents": defaultSetupIntent,
  "shipping_rate": defaultShippingRate,
  "shipping_rates": defaultShippingRate,
  "sigma.sigma_api_query": defaultSigmaSigmaApiQuery,
  "sigma.sigma_api_queries": defaultSigmaSigmaApiQuery,
  "source": defaultSource,
  "sources": defaultSource,
  "source_mandate_notification": defaultSourceMandateNotification,
  "source_mandate_notifications": defaultSourceMandateNotification,
  "source_transaction": defaultSourceTransaction,
  "source_transactions": defaultSourceTransaction,
  "subscription": defaultSubscription,
  "subscriptions": defaultSubscription,
  "subscription_item": defaultSubscriptionItem,
  "subscription_items": defaultSubscriptionItem,
  "subscription_schedule": defaultSubscriptionSchedule,
  "subscription_schedules": defaultSubscriptionSchedule,
  "tax.association": defaultTaxAssociation,
  "tax.associations": defaultTaxAssociation,
  "tax.calculation": defaultTaxCalculation,
  "tax.calculations": defaultTaxCalculation,
  "tax.calculation_line_item": defaultTaxCalculationLineItem,
  "tax.calculation_line_items": defaultTaxCalculationLineItem,
  "tax.registration": defaultTaxRegistration,
  "tax.registrations": defaultTaxRegistration,
  "tax.settings": defaultTaxSettings,
  "tax.settingss": defaultTaxSettings,
  "tax.transaction": defaultTaxTransaction,
  "tax.transactions": defaultTaxTransaction,
  "tax.transaction_line_item": defaultTaxTransactionLineItem,
  "tax.transaction_line_items": defaultTaxTransactionLineItem,
  "tax_code": defaultTaxCode,
  "tax_codes": defaultTaxCode,
  "tax_id": defaultTaxId,
  "tax_ids": defaultTaxId,
  "tax_rate": defaultTaxRate,
  "tax_rates": defaultTaxRate,
  "terminal.configuration": defaultTerminalConfiguration,
  "terminal.configurations": defaultTerminalConfiguration,
  "terminal.connection_token": defaultTerminalConnectionToken,
  "terminal.connection_tokens": defaultTerminalConnectionToken,
  "terminal.location": defaultTerminalLocation,
  "terminal.locations": defaultTerminalLocation,
  "terminal.onboarding_link": defaultTerminalOnboardingLink,
  "terminal.onboarding_links": defaultTerminalOnboardingLink,
  "terminal.reader": defaultTerminalReader,
  "terminal.readers": defaultTerminalReader,
  "terminal.refund": defaultTerminalRefund,
  "terminal.refunds": defaultTerminalRefund,
  "test_helpers.test_clock": defaultTestHelpersTestClock,
  "test_helpers.test_clocks": defaultTestHelpersTestClock,
  "token": defaultToken,
  "tokens": defaultToken,
  "topup": defaultTopup,
  "topups": defaultTopup,
  "transfer": defaultTransfer,
  "transfers": defaultTransfer,
  "transfer_reversal": defaultTransferReversal,
  "transfer_reversals": defaultTransferReversal,
  "treasury.credit_reversal": defaultTreasuryCreditReversal,
  "treasury.credit_reversals": defaultTreasuryCreditReversal,
  "treasury.debit_reversal": defaultTreasuryDebitReversal,
  "treasury.debit_reversals": defaultTreasuryDebitReversal,
  "treasury.financial_account": defaultTreasuryFinancialAccount,
  "treasury.financial_accounts": defaultTreasuryFinancialAccount,
  "treasury.financial_account_features": defaultTreasuryFinancialAccountFeatures,
  "treasury.financial_account_featuress": defaultTreasuryFinancialAccountFeatures,
  "treasury.inbound_transfer": defaultTreasuryInboundTransfer,
  "treasury.inbound_transfers": defaultTreasuryInboundTransfer,
  "treasury.outbound_payment": defaultTreasuryOutboundPayment,
  "treasury.outbound_payments": defaultTreasuryOutboundPayment,
  "treasury.outbound_transfer": defaultTreasuryOutboundTransfer,
  "treasury.outbound_transfers": defaultTreasuryOutboundTransfer,
  "treasury.received_credit": defaultTreasuryReceivedCredit,
  "treasury.received_credits": defaultTreasuryReceivedCredit,
  "treasury.received_debit": defaultTreasuryReceivedDebit,
  "treasury.received_debits": defaultTreasuryReceivedDebit,
  "treasury.transaction": defaultTreasuryTransaction,
  "treasury.transactions": defaultTreasuryTransaction,
  "treasury.transaction_entry": defaultTreasuryTransactionEntry,
  "treasury.transaction_entries": defaultTreasuryTransactionEntry,
  "webhook_endpoint": defaultWebhookEndpoint,
  "webhook_endpoints": defaultWebhookEndpoint,
};
