export function zuoraError(
  httpStatusCode: number,
  code: string,
  message: string,
) {
  return {
    success: false,
    reasons: [{ code, message }],
  };
}

export function notFound(resource: string, id: string) {
  return zuoraError(
    404,
    'OBJECT_NOT_FOUND',
    `${resource} with id '${id}' not found`,
  );
}
