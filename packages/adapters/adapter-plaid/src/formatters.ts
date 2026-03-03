import { toDateStr, capitalize } from '@mimicai/adapter-sdk';
import type { PlaidConfig } from './config.js';

const CONFIDENCE_LEVELS = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * Transform a DB row into Plaid account format.
 */
export function formatPlaidAccount(row: Record<string, unknown>) {
  const balance = Number(row.balance ?? 0);
  const accountId = String(row.id ?? row.account_id ?? '');
  const name = String(row.institution ?? row.name ?? 'Account');
  const subtype = String(row.type ?? row.subtype ?? 'checking').toLowerCase();
  const type = subtype === 'savings' || subtype === 'cd' || subtype === 'money market'
    ? 'depository'
    : subtype === 'credit card' || subtype === 'credit'
      ? 'credit'
      : subtype === 'mortgage' || subtype === 'student' || subtype === 'auto'
        ? 'loan'
        : 'depository';

  return {
    account_id: `acc_${accountId}`,
    balances: {
      available: balance,
      current: balance,
      iso_currency_code: 'USD',
      limit: null,
      unofficial_currency_code: null,
    },
    mask: String(1000 + (Number(accountId) % 9000)).slice(-4),
    name: `${capitalize(name)} ${capitalize(subtype)}`,
    official_name: `${name} ${capitalize(subtype)} Account`,
    subtype,
    type,
  };
}

/**
 * Transform a DB row into Plaid transaction format.
 */
export function formatPlaidTransaction(
  row: Record<string, unknown>,
  config: PlaidConfig,
) {
  const txId = String(row.id ?? row.transaction_id ?? '');
  const accountId = String(row.account_id ?? '');
  const amount = Number(row.amount ?? 0);
  const date = toDateStr(row.date ?? row.authorized_date);
  const merchant = String(row.merchant ?? row.merchant_name ?? 'Unknown');
  const category = String(row.category ?? 'Other');
  const pending = Boolean(row.pending ?? false);

  const confidenceLevel = config.personalFinanceCategoryVersion === 'v2'
    ? CONFIDENCE_LEVELS[Math.floor(Math.abs(amount) % CONFIDENCE_LEVELS.length)]
    : 'HIGH';

  return {
    transaction_id: `txn_${txId}`,
    account_id: `acc_${accountId}`,
    amount,
    iso_currency_code: 'USD',
    date,
    authorized_date: date,
    name: merchant,
    merchant_name: merchant,
    pending,
    payment_channel: 'online',
    transaction_type: 'place',
    category: [category],
    category_id: null,
    personal_finance_category: {
      primary: category.toUpperCase().replace(/\s+/g, '_'),
      detailed: `${category.toUpperCase().replace(/\s+/g, '_')}_OTHER`,
      confidence_level: confidenceLevel,
    },
  };
}
