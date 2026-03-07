export function paddleError(type: string, code: string, detail: string) {
  return {
    error: {
      type,
      code,
      detail,
    },
    meta: {
      request_id: `req_${Date.now()}`,
    },
  };
}

export function notFound(resource: string, id: string) {
  return paddleError(
    'request_error',
    'not_found',
    `${resource} with id '${id}' not found`,
  );
}
