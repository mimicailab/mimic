/**
 * Build a Xendit-style error response.
 */
export function xndError(status: number, errorCode: string, message: string) {
  return {
    status,
    error_code: errorCode,
    message,
  };
}
