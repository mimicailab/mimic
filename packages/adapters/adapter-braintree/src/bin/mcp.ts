#!/usr/bin/env node
import { startBraintreeMcpServer } from '../mcp.js';
startBraintreeMcpServer().catch(console.error);
