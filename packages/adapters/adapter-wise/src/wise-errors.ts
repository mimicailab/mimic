/**
 * Build a Wise-style error response.
 */
export function wiseError(code: string, message: string) {
  return {
    errors: [{ code, message, arguments: [] }],
  };
}
