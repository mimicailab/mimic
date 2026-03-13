export function stripeError(code: string, message: string, param?: string) {
  return {
    error: {
      type: 'invalid_request_error' as const,
      code,
      message,
      param: param ?? null,
    },
  };
}

export function stripeStateError(message: string, code = 'resource_state_invalid') {
  return stripeError(code, message);
}

export function stripeAuthError() {
  return {
    error: {
      type: 'authentication_error' as const,
      code: 'api_key_invalid',
      message: 'No valid API key provided.',
      param: null,
    },
  };
}
