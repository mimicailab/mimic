/**
 * Lemon Squeezy error format (JSON:API style):
 *   { errors: [{ detail, status, title }] }
 */

export interface LemonSqueezyError {
  errors: Array<{
    detail: string;
    status: string;
    title: string;
  }>;
}

export function lsNotFound(resource: string, id: string): LemonSqueezyError {
  return {
    errors: [{
      detail: `${resource} with id '${id}' not found.`,
      status: '404',
      title: 'Not Found',
    }],
  };
}

export function lsValidationError(detail: string): LemonSqueezyError {
  return {
    errors: [{
      detail,
      status: '422',
      title: 'Unprocessable Entity',
    }],
  };
}

export function lsStateError(detail: string): LemonSqueezyError {
  return {
    errors: [{
      detail,
      status: '422',
      title: 'Invalid state transition',
    }],
  };
}
