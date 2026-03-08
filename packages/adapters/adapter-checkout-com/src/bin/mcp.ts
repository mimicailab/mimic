#!/usr/bin/env node
import { startCheckoutComMcpServer } from '../mcp.js';
startCheckoutComMcpServer().catch(console.error);
