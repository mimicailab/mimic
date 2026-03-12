import type { NotFoundError } from '@mimicai/adapter-sdk';

export function recurlyError(type: string, message: string, params?: Array<{ param: string; message: string }>) {
  return {
    error: {
      type,
      message,
      params: params ?? [],
    },
  };
}

export function recurlyNotFound(resource: string, id: string): NotFoundError {
  return {
    error: {
      type: 'not_found',
      code: 'not_found',
      message: `Couldn't find ${resource} with id = ${id}`,
      param: null,
    },
  };
}

export function recurlyStateError(message: string) {
  return recurlyError('immutable_subscription', message);
}

export function recurlyValidationError(param: string, message: string) {
  return recurlyError('validation', message, [{ param, message }]);
}
