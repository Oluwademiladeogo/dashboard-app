#!/usr/bin/env node
const { spawn } = require('child_process');
const loadRootEnv = require('./load-root-env.cjs');

loadRootEnv();
const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Usage: node scripts/with-root-env.cjs <command> [...args]');
  process.exit(1);
}
const child = spawn(cmd, args, { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 1));
