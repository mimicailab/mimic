import { generateId } from '@mimicai/adapter-sdk';

export function paddleError(code: string, detail: string, type: 'request_error' | 'api_error' = 'request_error') {
  return {
    error: {
      type,
      code,
      detail,
      documentation_url: 'https://developer.paddle.com/errors/overview',
    },
    meta: {
      request_id: generateId('', 32),
    },
  };
}

export function paddleNotFound(resource: string, id: string) {
  return paddleError('not_found', `Entity ${id} not found`);
}

export function paddleStateError(message: string, code = 'conflict') {
  return paddleError(code, message);
}
