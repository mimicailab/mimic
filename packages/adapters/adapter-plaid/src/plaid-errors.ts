/**
 * Plaid-specific error response builders.
 * Matches the exact PlaidError format from https://plaid.com/docs/errors/
 */

import { generateId } from '@mimicai/adapter-sdk';

export type PlaidErrorType =
  | 'INVALID_REQUEST'
  | 'INVALID_RESULT'
  | 'INVALID_INPUT'
  | 'INSTITUTION_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'API_ERROR'
  | 'ITEM_ERROR'
  | 'ASSET_REPORT_ERROR';

export function plaidError(
  errorType: PlaidErrorType,
  errorCode: string,
  errorMessage: string,
  httpStatus: number = 400,
): Record<string, unknown> {
  return {
    error_type: errorType,
    error_code: errorCode,
    error_message: errorMessage,
    display_message: null,
    request_id: generateId('', 5),
    causes: [],
    status: httpStatus,
    documentation_url: 'https://plaid.com/docs/?ref=error',
  };
}

export function plaidInvalidRequest(errorCode: string, message: string) {
  return plaidError('INVALID_REQUEST', errorCode, message, 400);
}

export function plaidItemError(errorCode: string, message: string) {
  return plaidError('ITEM_ERROR', errorCode, message, 400);
}

export function plaidNotFound(resourceType: string, id: string) {
  return plaidError(
    'INVALID_REQUEST',
    'INVALID_FIELD',
    `Unable to find ${resourceType} with id: ${id}`,
    400,
  );
}

export function plaidApiError(message: string) {
  return plaidError('API_ERROR', 'INTERNAL_SERVER_ERROR', message, 500);
}

/** Wrap a successful response with a request_id */
export function plaidResponse(data: Record<string, unknown>): Record<string, unknown> {
  return {
    ...data,
    request_id: data.request_id ?? generateId('', 5),
  };
}
