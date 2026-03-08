/**
 * Build a MercadoPago-style error response.
 */
export function mpError(
  error: string,
  message: string,
  status: number,
  causeCode: number,
): any {
  return {
    message,
    error,
    status,
    cause: [{ code: causeCode, description: message }],
  };
}
