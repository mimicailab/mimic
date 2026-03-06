#!/usr/bin/env node
import { startPaddleMcpServer } from '../mcp.js';
startPaddleMcpServer().catch(console.error);
