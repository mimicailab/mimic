#!/usr/bin/env node
import { startChargebeeMcpServer } from '../mcp.js';
startChargebeeMcpServer().catch(console.error);
