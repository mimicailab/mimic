import type { NotFoundError } from '@mimicai/adapter-sdk';

/**
 * Zuora error envelope: { success: false, reasons: [{ code, message }] }
 */
export function zuoraError(code: string, message: string) {
  return {
    success: false,
    reasons: [{ code, message }],
  };
}

/**
 * 404 error in Zuora format.
 * Cast to NotFoundError to satisfy the base class interface.
 */
export function notFound(resource: string, id: string): NotFoundError {
  return zuoraError('OBJECT_NOT_FOUND', `${resource} '${id}' not found`) as unknown as NotFoundError;
}
