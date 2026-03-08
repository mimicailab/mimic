import { generateId } from '@mimicai/adapter-sdk';

/**
 * Build a Checkout.com-style error response.
 *
 * Format:
 * ```json
 * {
 *   "request_id": "...",
 *   "error_type": "request_invalid",
 *   "error_codes": ["payment_source_required"],
 *   "message": "A payment source is required"
 * }
 * ```
 */
export function ckoError(
  errorType: string,
  message: string,
  errorCodes?: string[],
) {
  return {
    request_id: generateId('', 32),
    error_type: errorType,
    error_codes: errorCodes || [errorType],
    message,
  };
}
