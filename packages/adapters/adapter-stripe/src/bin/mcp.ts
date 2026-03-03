#!/usr/bin/env node
import { startStripeMcpServer } from '../mcp.js';
startStripeMcpServer().catch(console.error);
