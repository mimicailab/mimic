#!/usr/bin/env node
import { startXenditMcpServer } from '../mcp.js';
startXenditMcpServer().catch(console.error);
