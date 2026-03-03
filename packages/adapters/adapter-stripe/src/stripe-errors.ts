export function stripeError(code: string, message: string) {
  return {
    error: {
      type: 'invalid_request_error' as const,
      code,
      message,
      param: null,
    },
  };
}
