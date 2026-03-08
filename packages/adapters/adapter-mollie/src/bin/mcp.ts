#!/usr/bin/env node
import { startMollieMcpServer } from '../mcp.js';
startMollieMcpServer().catch(console.error);
