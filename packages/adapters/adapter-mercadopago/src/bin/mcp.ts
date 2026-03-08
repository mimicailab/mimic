#!/usr/bin/env node
import { startMercadoPagoMcpServer } from '../mcp.js';
startMercadoPagoMcpServer().catch(console.error);
