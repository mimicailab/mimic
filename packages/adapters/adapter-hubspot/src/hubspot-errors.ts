/**
 * HubSpot's standard error envelope.
 *
 * Most APIs return:
 *   {
 *     status: "error",
 *     message: "...",
 *     correlationId: "<uuid>",
 *     category: "VALIDATION_ERROR",
 *     errors?: [{ message, in?, code? }]
 *   }
 *
 * SCIM and OAuth use different shapes (handled in their respective overrides).
 *
 * Reference: https://developers.hubspot.com/docs/api/troubleshooting
 */

import type { NotFoundError } from '@mimicai/adapter-sdk';

export const HUBSPOT_ERROR_CATEGORIES = {
  validation_error: 'VALIDATION_ERROR',
  object_not_found: 'OBJECT_NOT_FOUND',
  conflict: 'CONFLICT',
  forbidden: 'FORBIDDEN',
  unauthorized: 'UNAUTHORIZED',
  rate_limit: 'RATE_LIMITS',
  internal_error: 'INTERNAL_ERROR',
  bad_request: 'BAD_REQUEST',
  missing_scope: 'MISSING_SCOPES',
} as const;

export interface HubSpotErrorBody {
  status: 'error';
  message: string;
  correlationId: string;
  category: string;
  errors?: Array<{ message: string; in?: string; code?: string; subCategory?: string }>;
}

export function hubspotError(
  message: string,
  category: string,
  errors?: HubSpotErrorBody['errors'],
): HubSpotErrorBody {
  return {
    status: 'error',
    message,
    correlationId: generateCorrelationId(),
    category,
    ...(errors ? { errors } : {}),
  };
}

export function hubspotNotFound(resource: string, id: string): HubSpotErrorBody {
  return hubspotError(
    `Unable to find ${resource} with id "${id}"`,
    HUBSPOT_ERROR_CATEGORIES.object_not_found,
  );
}

export function hubspotBadRequest(message: string, errors?: HubSpotErrorBody['errors']): HubSpotErrorBody {
  return hubspotError(message, HUBSPOT_ERROR_CATEGORIES.bad_request, errors);
}

export function hubspotValidation(message: string, errors?: HubSpotErrorBody['errors']): HubSpotErrorBody {
  return hubspotError(message, HUBSPOT_ERROR_CATEGORIES.validation_error, errors);
}

export function hubspotUnauthorized(message = 'Authentication credentials missing or invalid'): HubSpotErrorBody {
  return hubspotError(message, HUBSPOT_ERROR_CATEGORIES.unauthorized);
}

export function hubspotRateLimit(message = 'Too many requests'): HubSpotErrorBody {
  return hubspotError(message, HUBSPOT_ERROR_CATEGORIES.rate_limit);
}

/** Satisfy the base class's `NotFoundError` shape while shipping HubSpot's native body. */
export function hubspotNotFoundAsBase(resource: string, id: string): NotFoundError {
  const native = hubspotNotFound(resource, id);
  return native as unknown as NotFoundError;
}

/** Generate a UUID-shaped correlation id (not crypto-strong — fine for mock traffic). */
function generateCorrelationId(): string {
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}
