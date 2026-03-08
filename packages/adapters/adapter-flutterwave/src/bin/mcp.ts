#!/usr/bin/env node
import { startFlutterwaveMcpServer } from '../mcp.js';
startFlutterwaveMcpServer().catch(console.error);
