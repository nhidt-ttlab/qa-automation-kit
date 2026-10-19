#!/usr/bin/env node
import { runApiMcpCli } from './cli.js';

runApiMcpCli({ argv: process.argv.slice(2) }).catch((error: unknown) => {
  console.error('qakit-mcp-api failed to start:', error);
  process.exitCode = 1;
});
