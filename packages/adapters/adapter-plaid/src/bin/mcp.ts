#!/usr/bin/env node
import { startPlaidMcpServer } from '../mcp.js';
startPlaidMcpServer().catch(console.error);
