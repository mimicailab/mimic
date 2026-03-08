/**
 * Build a Mollie RFC 7807 error response.
 */
export function mollieError(
  status: number,
  title: string,
  detail: string,
  field?: string,
) {
  return {
    status,
    title,
    detail,
    ...(field ? { field } : {}),
    _links: {
      documentation: {
        href: 'https://docs.mollie.com/overview/handling-errors',
        type: 'text/html',
      },
    },
  };
}
