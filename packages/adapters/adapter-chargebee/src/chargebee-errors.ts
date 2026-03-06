export function chargebeeError(
  httpStatusCode: number,
  apiErrorCode: string,
  message: string,
  param?: string,
) {
  return {
    message,
    api_error_code: apiErrorCode,
    type: 'invalid_request',
    http_status_code: httpStatusCode,
    param: param ?? null,
  };
}

export function notFound(resource: string, id: string) {
  return chargebeeError(
    404,
    'resource_not_found',
    `${resource} with id '${id}' not found`,
  );
}
