#!/usr/bin/env node
import { startKlarnaMcpServer } from '../mcp.js';
startKlarnaMcpServer().catch(console.error);
