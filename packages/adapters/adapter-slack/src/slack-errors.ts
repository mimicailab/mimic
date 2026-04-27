/**
 * Slack Web API error envelope. All Slack responses (success or error) carry
 * `ok: boolean`. Error responses include an `error` string code; many include
 * additional `errors`/`warning`/`response_metadata` fields.
 *
 *   { "ok": false, "error": "channel_not_found" }
 *   { "ok": true, "channel": { ... } }
 *
 * This module centralises the error helpers so the shape is consistent.
 */

export interface SlackErrorBody {
  ok: false;
  error: string;
  warning?: string;
  response_metadata?: { messages?: string[] };
}

export function slackError(code: string, warning?: string, messages?: string[]): SlackErrorBody {
  const body: SlackErrorBody = { ok: false, error: code };
  if (warning) body.warning = warning;
  if (messages && messages.length > 0) body.response_metadata = { messages };
  return body;
}

export const SLACK_ERROR_CODES = {
  CHANNEL_NOT_FOUND: 'channel_not_found',
  USER_NOT_FOUND: 'users_not_found',
  MESSAGE_NOT_FOUND: 'message_not_found',
  NOT_AUTHED: 'not_authed',
  INVALID_AUTH: 'invalid_auth',
  MISSING_SCOPE: 'missing_scope',
  INVALID_ARGUMENTS: 'invalid_arguments',
  RATE_LIMITED: 'ratelimited',
  METHOD_NOT_IMPLEMENTED: 'method_not_implemented',
} as const;
