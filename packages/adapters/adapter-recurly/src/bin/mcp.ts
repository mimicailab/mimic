#!/usr/bin/env node
import { startRecurlyMcpServer } from '../mcp.js';
startRecurlyMcpServer().catch(console.error);
