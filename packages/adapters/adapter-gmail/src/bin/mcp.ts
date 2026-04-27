#!/usr/bin/env node
import { startGmailMcpServer } from '../mcp.js';
startGmailMcpServer().catch(console.error);
