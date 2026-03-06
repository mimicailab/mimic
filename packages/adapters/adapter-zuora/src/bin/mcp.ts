#!/usr/bin/env node
import { startZuoraMcpServer } from '../mcp.js';
startZuoraMcpServer().catch(console.error);
