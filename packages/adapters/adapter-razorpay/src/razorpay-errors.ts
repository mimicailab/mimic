/**
 * Build a Razorpay-style error response.
 */
export function rzpError(
  code: string,
  description: string,
  field: string | null,
  source: string,
  reason: string,
) {
  return {
    error: {
      code,
      description,
      field,
      source,
      step: null,
      reason,
      metadata: {},
    },
  };
}
