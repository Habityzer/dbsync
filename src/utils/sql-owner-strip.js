import { Transform } from 'node:stream';

/**
 * Drop lines that reference roles / ownership from plain pg_dump SQL so restores
 * work when the target cluster does not have the same roles (e.g. local dev).
 * @param {{ stripGrants?: boolean }} opts
 */
export function createPostgresPrivilegeStripTransform(opts = {}) {
  const stripGrants = opts.stripGrants === true;
  let remainder = '';

  /**
   * @param {string} line
   */
  function shouldDrop(line) {
    const t = line.trimStart();
    if (/\bOWNER\s+TO\b/i.test(line)) {
      return true;
    }
    if (/^\s*REASSIGN\s+OWNED\b/i.test(t)) {
      return true;
    }
    if (stripGrants && /^\s*(GRANT|REVOKE)\b/i.test(t)) {
      return true;
    }
    return false;
  }

  return new Transform({
    transform(chunk, _enc, cb) {
      remainder += chunk.toString('utf8');
      const parts = remainder.split('\n');
      remainder = parts.pop() ?? '';
      const kept = [];
      for (const line of parts) {
        if (!shouldDrop(line)) {
          kept.push(line);
        }
      }
      cb(null, kept.length ? `${kept.join('\n')}\n` : '');
    },
    flush(cb) {
      if (remainder !== '' && !shouldDrop(remainder)) {
        this.push(remainder);
      }
      cb();
    },
  });
}
