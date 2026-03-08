#!/usr/bin/env node
import { startDlocalMcpServer } from '../mcp.js';
startDlocalMcpServer().catch(console.error);
