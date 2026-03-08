#!/usr/bin/env node
import { startAdyenMcpServer } from '../mcp.js';
startAdyenMcpServer().catch(console.error);
