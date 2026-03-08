/**
 * Build a dLocal-style error response.
 */
export function dlError(code: number, message: string) {
  return { code, message };
}
