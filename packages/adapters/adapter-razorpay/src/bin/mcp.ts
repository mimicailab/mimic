#!/usr/bin/env node
import { startRazorpayMcpServer } from '../mcp.js';
startRazorpayMcpServer().catch(console.error);
