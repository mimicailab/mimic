/**
 * Chargebee-specific error response builders.
 *
 * Chargebee error format (flat, not nested under .error):
 *   { message, type, api_error_code, param? }
 */

export function chargebeeError(
  apiErrorCode: string,
  message: string,
  type = 'invalid_request',
  param?: string,
) {
  return {
    message,
    type,
    api_error_code: apiErrorCode,
    ...(param ? { param } : {}),
  };
}

export function chargebeeNotFound(resource: string, id: string) {
  const singular = resource.replace(/s$/, '');
  return chargebeeError(
    'resource_not_found',
    `No such ${singular}: '${id}'`,
    'invalid_request',
  );
}

export function chargebeeStateError(message: string) {
  return chargebeeError('invalid_state_for_request', message, 'invalid_request');
}

export function chargebeeAuthError() {
  return {
    message: 'Sorry, authentication with the API failed. Are you sure you\'re using the right API key?',
    type: 'unauthorized',
    api_error_code: 'api_authentication_failed',
  };
}
