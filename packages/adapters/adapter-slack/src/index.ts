import type { AdapterManifest } from '@mimicai/adapter-sdk';

export { SlackAdapter } from './slack-adapter.js';
export { SlackConfigSchema, type SlackConfig } from './config.js';
export { createSlackMcpServer, startSlackMcpServer } from './mcp.js';

export const manifest: AdapterManifest = {
  id: 'slack',
  name: 'Slack API',
  type: 'api-mock',
  description: 'Slack messaging, channels, reactions, file sharing mock adapter',
};
