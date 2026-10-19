#!/usr/bin/env node
import { runUiMcpCli } from './cli.js';

runUiMcpCli({ argv: process.argv.slice(2) }).catch((error: unknown) => {
  console.error('qakit-mcp-ui failed to start:', error);
  process.exitCode = 1;
});
