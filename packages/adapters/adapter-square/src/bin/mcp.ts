#!/usr/bin/env node
import { startSquareMcpServer } from '../mcp.js';
startSquareMcpServer().catch(console.error);
