/**
 * Attio's error envelope is flat — no nested `error: { ... }` wrapper.
 * Every error response carries `status_code`, `type`, `code`, `message`, and
 * occasionally `field` / `errors[]` arrays.
 *
 * See: https://developers.attio.com/reference/errors
 */

import type { NotFoundError } from '@mimicai/adapter-sdk';

export const ATTIO_ERROR_TYPES = {
  invalid_request_error: 'invalid_request_error',
  not_found_error: 'not_found_error',
  authentication_error: 'authentication_error',
  authorization_error: 'authorization_error',
  rate_limit_error: 'rate_limit_error',
  server_error: 'server_error',
} as const;

export const ATTIO_ERROR_CODES = {
  validation_type: 'validation_type',
  not_found: 'not_found',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  conflict: 'conflict',
  unknown_attribute_slug: 'unknown_attribute_slug',
  unknown_object_slug: 'unknown_object_slug',
  invalid_value: 'invalid_value',
  duplicate_record: 'duplicate_record',
  filter_invalid: 'filter_invalid',
} as const;

export interface AttioErrorBody {
  status_code: number;
  type: string;
  code: string;
  message: string;
  field?: string;
  errors?: Array<{ code: string; message: string; field?: string }>;
}

export function attioError(
  status_code: number,
  type: string,
  code: string,
  message: string,
  extras: Partial<Omit<AttioErrorBody, 'status_code' | 'type' | 'code' | 'message'>> = {},
): AttioErrorBody {
  return { status_code, type, code, message, ...extras };
}

export function attioNotFound(resource: string, id: string): AttioErrorBody {
  return attioError(404, ATTIO_ERROR_TYPES.not_found_error, ATTIO_ERROR_CODES.not_found, `${resource} with ID "${id}" not found.`);
}

export function attioInvalidRequest(message: string, field?: string): AttioErrorBody {
  return attioError(400, ATTIO_ERROR_TYPES.invalid_request_error, ATTIO_ERROR_CODES.validation_type, message, field ? { field } : {});
}

export function attioUnauthorized(message = 'Authentication credentials are missing or invalid.'): AttioErrorBody {
  return attioError(401, ATTIO_ERROR_TYPES.authentication_error, ATTIO_ERROR_CODES.unauthorized, message);
}

export function attioForbidden(message: string): AttioErrorBody {
  return attioError(403, ATTIO_ERROR_TYPES.authorization_error, ATTIO_ERROR_CODES.forbidden, message);
}

export function attioConflict(message: string): AttioErrorBody {
  return attioError(409, ATTIO_ERROR_TYPES.invalid_request_error, ATTIO_ERROR_CODES.conflict, message);
}

/**
 * The base class's `notFoundError()` must return its own `NotFoundError` shape
 * (with nested `error: { ... }`). We satisfy the type while shipping Attio's
 * native flat envelope on the wire by widening here.
 */
export function attioNotFoundAsBase(resource: string, id: string): NotFoundError {
  return attioNotFound(resource, id) as unknown as NotFoundError;
}
