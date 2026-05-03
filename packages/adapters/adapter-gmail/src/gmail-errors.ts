/**
 * Gmail (Google API) error envelope. Matches the standard Google JSON error shape:
 * https://cloud.google.com/apis/design/errors
 *
 *   {
 *     "error": {
 *       "code": 404,
 *       "message": "Requested entity was not found.",
 *       "errors": [{ "message": "...", "domain": "global", "reason": "notFound" }],
 *       "status": "NOT_FOUND"
 *     }
 *   }
 */

export type GoogleErrorStatus =
  | 'INVALID_ARGUMENT'
  | 'FAILED_PRECONDITION'
  | 'OUT_OF_RANGE'
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'ABORTED'
  | 'ALREADY_EXISTS'
  | 'RESOURCE_EXHAUSTED'
  | 'CANCELLED'
  | 'DATA_LOSS'
  | 'UNKNOWN'
  | 'INTERNAL'
  | 'NOT_IMPLEMENTED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED';

export interface GoogleErrorBody {
  error: {
    code: number;
    message: string;
    errors: Array<{ message: string; domain: string; reason: string }>;
    status: GoogleErrorStatus;
  };
}

export function gmailError(
  code: number,
  status: GoogleErrorStatus,
  reason: string,
  message: string,
): GoogleErrorBody {
  return {
    error: {
      code,
      message,
      errors: [{ message, domain: 'global', reason }],
      status,
    },
  };
}

export function gmailNotFound(resource: string, id: string): GoogleErrorBody {
  return gmailError(404, 'NOT_FOUND', 'notFound', `Requested entity was not found: ${resource}/${id}.`);
}

export function gmailInvalidArgument(message: string): GoogleErrorBody {
  return gmailError(400, 'INVALID_ARGUMENT', 'invalidArgument', message);
}

export function gmailFailedPrecondition(message: string): GoogleErrorBody {
  return gmailError(400, 'FAILED_PRECONDITION', 'failedPrecondition', message);
}
