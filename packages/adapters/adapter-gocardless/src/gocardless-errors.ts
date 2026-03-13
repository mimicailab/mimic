import { generateId } from '@mimicai/adapter-sdk';

export function gcError(
  type: string,
  code: number,
  message: string,
  errors: Array<{ reason?: string; message: string }> = [],
) {
  return {
    error: {
      type,
      code,
      message,
      errors,
      documentation_url: 'https://developer.gocardless.com/api-reference',
      request_id: generateId('', 16),
    },
  };
}

export function gcNotFound(resource: string, id: string) {
  return gcError('invalid_api_usage', 404, `${resource} with id ${id} not found`, [
    { reason: 'resource_not_found', message: `${resource} with id ${id} not found` },
  ]);
}

export function gcStateError(message: string) {
  return gcError('validation_failed', 409, message, [
    { reason: 'invalid_state', message },
  ]);
}
