#!/usr/bin/env node
import { spawn } from 'child_process';

import { getCompileCloseExitCode } from '../dev/dev-lifecycle.js';
import { createCliStdoutProxy } from '../dev/dev-stdout.js';

const rawArgs = process.argv.slice(2);
const cliArgs = [...rawArgs, '--no-open'];

// Detect a `--host [addr]` in the args the user passed. When present we expose
// the Vite dev server (the actual UI) on the network too — otherwise only the
// CLI/API server would bind the host and the page on :5173 stays localhost-only.
// `--host 0.0.0.0` / `--host=1.2.3.4` / bare `--host` are all supported.
// Returns: null (no --host), '' (bare → all interfaces), or the address string.
function parseHostArg(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--host') {
      const next = args[i + 1];
      return next && !next.startsWith('-') ? next : '';
    }
    if (arg.startsWith('--host=')) {
      return arg.slice('--host='.length);
    }
  }
  return null;
}

const hostArg = parseHostArg(rawArgs);
const exposeOnNetwork = hostArg !== null;

// Wait for CLI server to be ready, then start Vite
let cliProcess = null;
let compileProcess = null;
let viteProcess = null;
let isShuttingDown = false;

const cliStdoutProxy = createCliStdoutProxy({
  onServerUrl: (cliServerUrl) => {
    if (viteProcess) {
      return;
    }

    console.log('🚀 Starting Vite dev server...');

    const viteArgs = ['exec', 'vite', '--clearScreen=false'];
    const viteEnv = { ...process.env };

    if (exposeOnNetwork) {
      // Bind Vite to the network too, and route the client through the Vite
      // proxy (relative URLs) so fetch AND SSE work from other devices. We pass
      // the CLI target via a non-VITE_ var so it never becomes an absolute
      // localhost URL baked into the client bundle.
      viteArgs.push('--host');
      if (hostArg) viteArgs.push(hostArg);
      viteEnv.BUDDY_DEV_API_TARGET = cliServerUrl;
      delete viteEnv.VITE_BUDDY_API_URL;
    } else {
      // Local dev: open the browser and point the client straight at the CLI
      // server (SSE connects directly, avoiding any proxy buffering).
      viteArgs.push('--open');
      viteEnv.VITE_BUDDY_API_URL = cliServerUrl;
    }

    viteProcess = spawn('pnpm', viteArgs, {
      stdio: 'inherit',
      env: viteEnv,
    });
  },
  onOutput: (output) => {
    process.stdout.write(output);
  },
});

function startCliProcess() {
  cliProcess = spawn(process.execPath, ['dist/cli/index.js', ...cliArgs], {
    // Keep stdin attached so CLI can decide stdin mode by itself.
    stdio: ['inherit', 'pipe', 'inherit'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
    },
  });

  cliProcess.stdout.on('data', (data) => {
    // Wait for CLI server before starting Vite to prevent proxy connection errors.
    // Suppress dev-only startup lines but continue mirroring shutdown output such as review comments.
    cliStdoutProxy.push(data.toString());
  });

  cliProcess.on('close', (code) => {
    cliStdoutProxy.flush();

    if (code !== 0 && code !== null && !isShuttingDown) {
      console.error(`CLI server exited with code ${code}`);
    }

    if (viteProcess && !viteProcess.killed) {
      viteProcess.kill('SIGINT');
    }

    process.exit(code || 0);
  });
}

function startCompileProcess() {
  compileProcess = spawn('pnpm', ['exec', 'tsc', '--project', 'tsconfig.cli.json'], {
    stdio: 'inherit',
  });

  compileProcess.on('close', (code) => {
    compileProcess = null;

    const exitCode = getCompileCloseExitCode(code, isShuttingDown);

    if (exitCode !== null) {
      process.exit(exitCode);
      return;
    }

    startCliProcess();
  });
}

function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  compileProcess?.kill(signal);
  cliProcess?.kill(signal);
  viteProcess?.kill(signal);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

startCompileProcess();
