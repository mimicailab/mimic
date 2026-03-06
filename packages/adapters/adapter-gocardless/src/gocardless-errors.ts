export function gcError(type: string, code: string, message: string, requestId?: string) {
  return {
    error: {
      message,
      type,
      code,
      errors: [{ message, reason: code, field: null }],
      request_id: requestId ?? `req_${Date.now()}`,
    },
  };
}

export function notFound(resource: string, id: string) {
  return gcError(
    'invalid_api_usage',
    'resource_not_found',
    `${resource} with id '${id}' not found`,
  );
}
