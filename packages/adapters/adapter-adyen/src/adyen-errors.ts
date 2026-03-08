/**
 * Build an Adyen-style error response.
 */
export function adyenError(
  status: number,
  errorCode: string,
  message: string,
  errorType: string = 'validation',
) {
  return {
    status,
    errorCode,
    message,
    errorType,
  };
}
