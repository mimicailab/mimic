export function lsError(status: number, title: string, detail: string) {
  return {
    errors: [
      {
        status: String(status),
        title,
        detail,
      },
    ],
  };
}

export function notFound(resource: string, id: string) {
  return lsError(404, 'Not Found', `${resource} with id '${id}' not found`);
}
