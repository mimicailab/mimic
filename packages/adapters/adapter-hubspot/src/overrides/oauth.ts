/**
 * OAuth 2.0 stubs.
 *
 * Real HubSpot OAuth requires the full code-grant dance with redirect URIs,
 * authorization codes, refresh tokens, etc. For Mimic test traffic we accept
 * any input and return a deterministic Bearer token shape — enough for SDKs
 * that look at `access_token`, `refresh_token`, and `expires_in`.
 */

import type { OverrideHandler } from '@mimicai/adapter-sdk';
import { generateId } from '@mimicai/adapter-sdk';
import { hubspotBadRequest, hubspotUnauthorized } from '../hubspot-errors.js';
import { parseBody } from './_shared.js';

interface TokenResponse {
  refresh_token: string;
  access_token: string;
  expires_in: number;
  token_type: 'bearer';
}

function buildToken(): TokenResponse {
  return {
    refresh_token: `pat-na1-${generateId('', 32)}`,
    access_token: `pat-na1-${generateId('', 32)}`,
    expires_in: 1800,
    token_type: 'bearer',
  };
}

/** POST /oauth/v1/token — exchange code or refresh token for an access token. */
export function buildTokenHandler(): OverrideHandler {
  return async (req, reply) => {
    const body = parseBody(req);
    const grantType = body.grant_type as string | undefined;
    if (!grantType) return reply.code(400).send(hubspotBadRequest('grant_type is required'));
    if (grantType === 'authorization_code') {
      if (!body.code) return reply.code(400).send(hubspotBadRequest('code is required for authorization_code grant'));
    } else if (grantType === 'refresh_token') {
      if (!body.refresh_token) return reply.code(400).send(hubspotBadRequest('refresh_token is required for refresh_token grant'));
    } else {
      return reply.code(400).send(hubspotBadRequest(`Unsupported grant_type: ${grantType}`));
    }
    return reply.code(200).send(buildToken());
  };
}

/** GET /oauth/v1/access-tokens/:token — describe an access token's scopes/account. */
export function buildAccessTokenInfoHandler(): OverrideHandler {
  return async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, string>;
    const token = params.token;
    if (!token || token.length < 10) return reply.code(401).send(hubspotUnauthorized('Invalid access token'));
    return reply.code(200).send({
      token,
      user: 'mimic-bot@example.com',
      hub_domain: 'mimic.example.com',
      scopes: [
        'crm.objects.contacts.read',
        'crm.objects.contacts.write',
        'crm.objects.companies.read',
        'crm.objects.companies.write',
        'crm.objects.deals.read',
        'crm.objects.deals.write',
        'crm.lists.read',
        'crm.schemas.contacts.read',
      ],
      hub_id: 12345678,
      app_id: 1,
      expires_in: 1800,
      user_id: 1,
      token_type: 'access',
    });
  };
}

/** GET /oauth/v1/refresh-tokens/:token — describe a refresh token. */
export function buildRefreshTokenInfoHandler(): OverrideHandler {
  return async (req, reply) => {
    const params = (req.params ?? {}) as Record<string, string>;
    const token = params.token;
    if (!token || token.length < 10) return reply.code(401).send(hubspotUnauthorized('Invalid refresh token'));
    return reply.code(200).send({
      token,
      user: 'mimic-bot@example.com',
      hub_domain: 'mimic.example.com',
      scopes: ['crm.objects.contacts.read'],
      hub_id: 12345678,
      app_id: 1,
      user_id: 1,
      token_type: 'refresh',
    });
  };
}
