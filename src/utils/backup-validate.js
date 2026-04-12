import { createReadStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { BackupError } from './errors.js';

/**
 * @param {Buffer} buf
 */
function looksLikeSql(buf) {
  const s = buf.toString('utf8', 0, Math.min(buf.length, 8192)).toLowerCase();
  return (
    s.includes('create ') ||
    s.includes('insert ') ||
    s.includes('--') ||
    s.includes('set ') ||
    s.includes('copy ') ||
    s.includes('/*!') ||
    s.includes('drop ')
  );
}

/**
 * @param {string} filePath
 * @param {boolean} isGzip
 */
export async function validateBackupFile(filePath, isGzip) {
  if (isGzip) {
    const rs = createReadStream(filePath);
    const gunzip = createGunzip();
    const sink = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    try {
      await pipeline(rs, gunzip, sink);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BackupError('Not a valid SQL backup', `File appears corrupted or not gzip: ${msg}`);
    }
    return;
  }

  const first = await readMaxBytesFromPath(filePath, 65536);
  if (first.length === 0) {
    throw new BackupError('Not a valid SQL backup', 'File is empty');
  }
  if (!looksLikeSql(first)) {
    throw new BackupError(
      'Not a valid SQL backup',
      'File does not look like a SQL dump (missing common SQL patterns)'
    );
  }
}

/**
 * @param {string} filePath
 * @param {number} max
 */
async function readMaxBytesFromPath(filePath, max) {
  const rs = createReadStream(filePath);
  /** @type {Buffer[]} */
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of rs) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      total += buf.length;
      if (total >= max) break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new BackupError('Not a valid SQL backup', msg);
  }
  return Buffer.concat(chunks);
}
