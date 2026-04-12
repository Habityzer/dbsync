import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { AppError } from './utils/errors.js';
import { printErrorWithSuggestion } from './utils/ui.js';
import { runExport } from './commands/export.js';
import { runRestore } from './commands/restore.js';
import { runList } from './commands/list.js';
import { runInfo } from './commands/info.js';
import { runClean } from './commands/clean.js';
import { runTest } from './commands/test.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

/**
 * @param {import('commander').Command} program
 * @param {import('commander').Command} cmd
 */
function globalOpts(program, cmd) {
  if (typeof cmd.optsWithGlobals === 'function') {
    return cmd.optsWithGlobals();
  }
  return { ...program.opts(), ...cmd.opts() };
}

/**
 * @param {string[]} argv
 */
export async function runCli(argv) {
  const program = new Command();

  program
    .name('dbsync')
    .description('Backup and restore PostgreSQL/MySQL databases with .env support')
    .version(pkg.version)
    .option('--env-file <path>', 'Path to .env file', '.env')
    .option('--env-var <name>', 'Environment variable for database URL', 'DATABASE_URL')
    .option('--config <path>', 'Path to .db-sync.json / .db-syncconfig.json')
    .option('-v, --verbose', 'Verbose logging', false);

  program
    .command('export')
    .description('Export (backup) the database')
    .option('-o, --output <path>', 'Output file or directory')
    .option('--schema-only', 'Export schema only', false)
    .option('--data-only', 'Export data only', false)
    .option('--tables <list>', 'Comma-separated table names')
    .addOption(new Option('--no-compress', 'Disable gzip compression'))
    .addOption(
      new Option('--compress-level <n>', 'Gzip level 1-9')
        .default('6')
        .argParser((v) => parseInt(String(v), 10))
    )
    .action(async (opts, cmd) => {
      await runExport(globalOpts(program, cmd), opts);
    });

  program
    .command('restore')
    .description('Restore database from a backup file')
    .argument('[file]', 'Backup .sql or .sql.gz file')
    .option(
      '--no-drop-before',
      'Do not drop the database; import into the current database (advanced)'
    )
    .option(
      '--preserve-privileges',
      'PostgreSQL: keep OWNER/GRANT/REVOKE lines (needs matching roles on the server)',
      false
    )
    .option('--dry-run', 'Validate backup without importing', false)
    .option('-y, --yes', 'Answer yes to confirmation prompts (non-interactive)', false)
    .option('--force', 'Same as --yes / -y', false)
    .option('-i, --interactive', 'Choose backup from list', false)
    .option('-d, --database <name>', 'Filter interactive list by database name')
    .action(async (file, opts, cmd) => {
      await runRestore(globalOpts(program, cmd), opts, file);
    });

  program
    .command('list')
    .description('List backups in the backup directory')
    .option('-d, --database <name>', 'Filter by database name')
    .option('-l, --limit <n>', 'Limit number of results', (v) => parseInt(v, 10))
    .option('--since <date>', 'Backups on or after date (YYYY-MM-DD)')
    .action(async (opts, cmd) => {
      await runList(globalOpts(program, cmd), opts);
    });

  program
    .command('info')
    .description('Show details for a backup file')
    .argument('<file>', 'Backup file path')
    .action(async (file, _opts, cmd) => {
      await runInfo(globalOpts(program, cmd), file);
    });

  program
    .command('clean')
    .description('Remove old backups (retention)')
    .option('--keep-last <n>', 'Keep newest N backups (default from config or 30)')
    .option('--keep-days <n>', 'Keep backups newer than N days')
    .option('--dry-run', 'Show files that would be deleted', false)
    .action(async (opts, cmd) => {
      await runClean(globalOpts(program, cmd), opts);
    });

  program
    .command('test')
    .description('Test database connection from DATABASE_URL')
    .action(async (_opts, cmd) => {
      await runTest(globalOpts(program, cmd));
    });

  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e instanceof AppError) {
      printErrorWithSuggestion(e);
      process.exitCode = e.exitCode ?? 1;
      return;
    }
    throw e;
  }
}
