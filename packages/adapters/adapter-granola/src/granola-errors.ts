/**
 * Granola's public docs only describe natural-language status codes
 * (`401 Unauthorized - Invalid API key`, `404 Not found`, `429 Too Many
 * Requests`) without a structured error schema. We default to a generic
 * `{ error: { type, code, message } }` envelope — matches what most
 * Bearer-token JSON APIs return and what SDK consumers typically expect.
 */

import type { NotFoundError } from '@mimicai/adapter-sdk';

export const GRANOLA_ERROR_TYPES = {
  invalid_request_error: 'invalid_request_error',
  authentication_error: 'authentication_error',
  not_found_error: 'not_found_error',
  rate_limit_error: 'rate_limit_error',
} as const;

export const GRANOLA_ERROR_CODES = {
  not_found: 'not_found',
  unauthorized: 'unauthorized',
  invalid_api_key: 'invalid_api_key',
  rate_limited: 'rate_limited',
  bad_request: 'bad_request',
  invalid_cursor: 'invalid_cursor',
  invalid_date: 'invalid_date',
} as const;

export interface GranolaErrorBody {
  error: {
    type: string;
    code: string;
    message: string;
  };
}

export function granolaError(
  type: string,
  code: string,
  message: string,
): GranolaErrorBody {
  return { error: { type, code, message } };
}

export function granolaNotFound(resource: string, id: string): GranolaErrorBody {
  return granolaError(
    GRANOLA_ERROR_TYPES.not_found_error,
    GRANOLA_ERROR_CODES.not_found,
    `${resource} with id "${id}" not found`,
  );
}

export function granolaBadRequest(message: string, code: string = GRANOLA_ERROR_CODES.bad_request): GranolaErrorBody {
  return granolaError(GRANOLA_ERROR_TYPES.invalid_request_error, code, message);
}

export function granolaUnauthorized(message = 'Invalid API key'): GranolaErrorBody {
  return granolaError(
    GRANOLA_ERROR_TYPES.authentication_error,
    GRANOLA_ERROR_CODES.invalid_api_key,
    message,
  );
}

/** Satisfy the base class's `NotFoundError` shape (it expects a nested `error.{type,code,message,param}`). */
export function granolaNotFoundAsBase(resource: string, id: string): NotFoundError {
  return {
    error: {
      ...granolaNotFound(resource, id).error,
      param: null,
    },
  };
}
