#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const platformArgs = process.platform === 'linux' ? ['--ozone-platform=x11'] : [];
const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...platformArgs, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
