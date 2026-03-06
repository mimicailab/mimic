#!/usr/bin/env node
import { startGoCardlessMcpServer } from '../mcp.js';
startGoCardlessMcpServer().catch(console.error);
