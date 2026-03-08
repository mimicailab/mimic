/**
 * Build a Flutterwave-style envelope response.
 */
export function flwEnvelope(status: string, message: string, data: unknown): unknown {
  return { status, message, data };
}
