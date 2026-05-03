#!/usr/bin/env node
import { startSlackMcpServer } from '../mcp.js';
startSlackMcpServer().catch(console.error);
