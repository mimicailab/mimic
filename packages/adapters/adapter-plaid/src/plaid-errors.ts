import { generateId } from '@mimicailab/adapter-sdk';

export function plaidError(code: string) {
  return {
    error_type: 'INVALID_REQUEST',
    error_code: code,
    error_message: `Mimic mock error: ${code}`,
    display_message: null,
    request_id: generateId('req', 16),
  };
}
