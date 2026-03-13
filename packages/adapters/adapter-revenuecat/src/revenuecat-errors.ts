/**
 * RevenueCat API error helpers.
 * Error format: { object: 'error', type, message, retryable, param?, doc_url }
 */

export function rcError(
  type: string,
  message: string,
  opts: { param?: string; retryable?: boolean; docUrl?: string } = {},
) {
  return {
    object: 'error',
    type,
    message,
    retryable: opts.retryable ?? false,
    param: opts.param ?? null,
    doc_url: opts.docUrl ?? `https://errors.rev.cat/${type}`,
  };
}

export function rcNotFound(resource: string, id: string) {
  return rcError('resource_missing', `${resource} with id '${id}' not found`);
}

export function rcStateError(message: string) {
  return rcError('invalid_request', message);
}
