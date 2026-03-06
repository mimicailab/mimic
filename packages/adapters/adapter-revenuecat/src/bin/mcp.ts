#!/usr/bin/env node
import { startRevenueCatMcpServer } from '../mcp.js';
startRevenueCatMcpServer().catch(console.error);
