#!/usr/bin/env node
import { startWiseMcpServer } from '../mcp.js';
startWiseMcpServer().catch(console.error);
