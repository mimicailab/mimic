/**
 * Build a Dwolla-style error response.
 */
export function dwError(code: string, message: string) {
  return { code, message };
}

/**
 * Build a Dwolla-style validation error response.
 */
export function dwValidationError(
  errors: Array<{ code: string; message: string; path: string }>,
) {
  return {
    code: 'ValidationError',
    message: 'Validation error(s) present.',
    _embedded: { errors },
  };
}
