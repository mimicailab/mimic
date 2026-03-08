/**
 * Build a Square-style error response.
 */
export function sqError(code: string, detail: string) {
  return {
    errors: [{
      category: 'INVALID_REQUEST_ERROR',
      code,
      detail,
    }],
  };
}
