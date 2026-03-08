/**
 * Build a Braintree-style error response.
 *
 * Braintree errors use: `{ errors: { message, attribute?, code? } }`
 */
export function btError(message: string, attribute?: string, code?: string) {
  const err: Record<string, string> = { message };
  if (attribute) err.attribute = attribute;
  if (code) err.code = code;
  return { errors: err };
}
