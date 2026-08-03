import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const MAX_CODE_BYTES = 100 * 1024;
const MAX_STDIN_BYTES = 10 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;
const COMPILE_TIMEOUT_MS = 6_000;
const RUN_TIMEOUT_MS = 4_000;

const LANGUAGES = {
  c: {
    file: 'main.c',
    compile: (file) => ['gcc', [file, '-o', 'main', '-O0', '-std=c11', '-lm']],
    run: (directory) => [path.join(directory, 'main'), []],
  },
  cpp: {
    file: 'main.cpp',
    compile: (file) => ['g++', [file, '-o', 'main', '-O0', '-std=c++17']],
    run: (directory) => [path.join(directory, 'main'), []],
  },
  python: {
    file: 'main.py',
    run: (_directory, file) => ['python3', [file]],
  },
  java: {
    file: 'Main.java',
    compile: (file) => ['javac', [file]],
    run: (_directory, file) => ['java', ['-Xmx128m', path.basename(file, '.java')]],
  },
};

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function boundedAppend(current, chunk) {
  return Buffer.concat([current, Buffer.from(chunk)]).subarray(0, MAX_OUTPUT_BYTES);
}

function execute(command, args, directory, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: directory,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/tmp',
        LANG: 'C.UTF-8',
      },
    });

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;

    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = boundedAppend(stdout, chunk);
      if (stdout.length >= MAX_OUTPUT_BYTES) killGroup();
    });
    child.stderr.on('data', (chunk) => {
      stderr = boundedAppend(stderr, chunk);
      if (stderr.length >= MAX_OUTPUT_BYTES) killGroup();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: '', stderr: error.message, exitCode: null, timedOut: false });
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode,
        timedOut,
      });
    });

    child.stdin.end(stdin);
  });
}

function javaFileName(code) {
  const match = code.match(/public\s+(?:final\s+)?class\s+([A-Za-z_$][\w$]*)/);
  return match ? `${match[1]}.java` : 'Main.java';
}

export async function handler(event) {
  const startedAt = performance.now();
  const language = typeof event?.language === 'string' ? event.language.trim().toLowerCase() : '';
  const code = typeof event?.code === 'string' ? event.code : '';
  const stdin = typeof event?.stdin === 'string' ? event.stdin : '';
  const config = LANGUAGES[language];

  if (!config || !code.trim() || byteLength(code) > MAX_CODE_BYTES || byteLength(stdin) > MAX_STDIN_BYTES) {
    return {
      ok: false,
      phase: 'setup',
      stdout: '',
      stderr: 'Invalid compiler request.',
      exitCode: null,
      timedOut: false,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'eproc-run-'));
  try {
    const fileName = language === 'java' ? javaFileName(code) : config.file;
    const sourceFile = path.join(directory, fileName);
    fs.writeFileSync(sourceFile, code, { encoding: 'utf8', mode: 0o600 });

    if (config.compile) {
      const [command, args] = config.compile(sourceFile);
      const compiled = await execute(command, args, directory, '', COMPILE_TIMEOUT_MS);
      if (compiled.exitCode !== 0 || compiled.timedOut) {
        return {
          ok: false,
          phase: 'compile',
          ...compiled,
          durationMs: Math.round(performance.now() - startedAt),
        };
      }
    }

    const [command, args] = config.run(directory, sourceFile);
    const executed = await execute(command, args, directory, stdin, RUN_TIMEOUT_MS);
    return {
      ok: executed.exitCode === 0 && !executed.timedOut,
      phase: 'run',
      ...executed,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
