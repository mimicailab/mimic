export function recurlyError(
  httpStatusCode: number,
  type: string,
  message: string,
  params?: Record<string, unknown>,
) {
  return {
    error: {
      type,
      message,
      params: params ?? [],
    },
  };
}

export function notFound(resource: string, id: string) {
  return recurlyError(
    404,
    'not_found',
    `Couldn't find ${resource} with id = '${id}'`,
  );
}
