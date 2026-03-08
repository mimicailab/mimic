#!/usr/bin/env node
import { startPayPalMcpServer } from '../mcp.js';
startPayPalMcpServer().catch(console.error);
