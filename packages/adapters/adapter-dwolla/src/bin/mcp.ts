#!/usr/bin/env node
import { startDwollaMcpServer } from '../mcp.js';
startDwollaMcpServer().catch(console.error);
