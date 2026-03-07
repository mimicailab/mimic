export function revenuecatError(
  httpStatusCode: number,
  type: string,
  message: string,
) {
  return {
    type,
    message,
  };
}

export function notFound(resource: string, id: string) {
  return revenuecatError(
    404,
    'resource_not_found',
    `${resource} with id '${id}' not found`,
  );
}
