import { spawn } from 'node:child_process';
import { AppError } from './errors.js';

/**
 * @typedef {object} SpawnStreamOptions
 * @property {NodeJS.ReadableStream} [stdin]
 * @property {NodeJS.WritableStream} [stdout]
 * @property {NodeJS.WritableStream} [stderr]
 * @property {Record<string, string>} [env]
 * @property {string} [cwd]
 */

/**
 * Spawn a process; pipe stdin/stdout if provided. Resolves on exit 0.
 * @param {string} command
 * @param {string[]} args
 * @param {SpawnStreamOptions} opts
 * @returns {Promise<{ code: number, stderr: string }>}
 */
export function spawnProcess(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
      cwd: opts.cwd,
    });

    let stderr = '';
    child.stderr?.on('data', (c) => {
      stderr += c.toString();
    });

    if (opts.stdin) {
      opts.stdin.pipe(child.stdin);
      opts.stdin.on('error', (e) => {
        child.stdin?.destroy();
        reject(e);
      });
    } else {
      child.stdin?.end();
    }

    if (opts.stdout) {
      child.stdout.pipe(opts.stdout);
    }

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stderr });
    });
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {SpawnStreamOptions} opts
 */
export async function spawnProcessOrThrow(command, args, opts = {}) {
  const { code, stderr } = await spawnProcess(command, args, opts);
  if (code !== 0) {
    throw new AppError(`${command} exited with code ${code}`, {
      suggestion: stderr.trim() || 'Check database client tools are installed and DATABASE_URL is correct',
    });
  }
}

/**
 * Wait for readable/writable stream end if present.
 * @param {import('node:stream').Readable | import('node:stream').Writable} stream
 */
export async function finishedWrite(stream) {
  if (!stream || typeof stream.end !== 'function') return;
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    if ('writableFinished' in stream && stream.writableFinished) resolve(undefined);
  });
}
