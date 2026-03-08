import { generateId } from '@mimicai/adapter-sdk';

/**
 * Build a PayPal-style error response.
 */
export function ppError(name: string, message: string, details?: unknown[]) {
  return {
    name,
    message,
    debug_id: generateId('', 16),
    details: details || [],
    links: [],
  };
}
