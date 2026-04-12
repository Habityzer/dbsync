import { createGzip, createGunzip } from 'node:zlib';
import { PassThrough } from 'node:stream';

/**
 * @param {boolean} compress
 * @param {number} level 1-9
 * @returns {import('node:stream').Transform}
 */
export function createCompressStream(compress, level = 6) {
  if (!compress) {
    return new PassThrough();
  }
  const lv = Math.min(9, Math.max(1, level));
  return createGzip({ level: lv });
}

/**
 * @param {boolean} isGzip
 */
export function createDecompressStream(isGzip) {
  if (!isGzip) {
    return new PassThrough();
  }
  return createGunzip();
}
