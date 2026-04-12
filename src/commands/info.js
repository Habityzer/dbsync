import { statSync, existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { parseBackupFilename } from '../utils/backup-scanner.js';
import { formatBytes } from '../utils/progress.js';
import { BackupError } from '../utils/errors.js';
import * as ui from '../utils/ui.js';

/**
 * @param {object} globalOpts
 * @param {string} fileArg
 */
export async function runInfo(globalOpts, fileArg) {
  if (!fileArg) {
    throw new BackupError('Missing file path', 'Usage: dbsync info <file>');
  }
  const p = isAbsolute(fileArg) ? fileArg : resolve(process.cwd(), fileArg);
  if (!existsSync(p)) {
    throw new BackupError('Invalid backup file', 'Check the path');
  }
  const st = statSync(p);
  const name = p.split(/[/\\]/).pop() || fileArg;
  const compressed = name.endsWith('.gz');
  const { database, parsedDate } = parseBackupFilename(name);

  ui.infoLine(`${ui.icons.pkg} Backup: ${name}`);
  ui.infoLine(`   Size: ${formatBytes(st.size)}`);
  ui.infoLine(`   Modified: ${st.mtime.toISOString()}`);
  if (database) ui.infoLine(`   Database: ${database}`);
  if (parsedDate) ui.infoLine(`   Parsed timestamp: ${parsedDate.toISOString()}`);
  ui.infoLine(`   Compression: ${compressed ? 'gzip' : 'none'}`);
}
