import { generateUUID } from './helpers.js';

/**
 * Build a Klarna-style error response.
 */
export function klarnaError(errorCode: string, errorMessages: string[]) {
  return {
    error_code: errorCode,
    error_messages: errorMessages,
    correlation_id: generateUUID(),
  };
}
