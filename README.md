# db-sync-tool

CLI for backing up and restoring **PostgreSQL** and **MySQL** databases with `.env` support, gzip compression, timestamped backups, listing, retention cleanup, and interactive restore.

## Requirements

- **Node.js** 18+
- **PostgreSQL client tools** on `PATH` when using Postgres: `pg_dump`, `psql`
- **MySQL client tools** on `PATH` when using MySQL: `mysqldump`, `mysql`

## Install

```bash
pnpm add -g @habityzer/db-sync-tool
# or
pnpm dlx @habityzer/db-sync-tool --help
```

The executable is **`dbsync`**. The package is published under the **Habityzer** org on npm (`@habityzer/…`).

If **`pnpm add -g`** warns that the package **has no binaries**, pnpm is skipping the global link because the npm tarball did not ship `bin/dbsync.js` with the executable bit. Use **`npm install -g @habityzer/db-sync-tool`** (npm still wires up the CLI), **`pnpm dlx @habityzer/db-sync-tool`**, or upgrade once a release publishes the bin as executable.

## Configuration

### Environment (default)

Create a `.env` in the working directory:

```env
DATABASE_URL="postgresql://app:!ChangeMe!@127.0.0.1:5434/app?serverVersion=16"
```

- `postgresql://` is normalized to `postgres://`
- Query params `serverVersion`, `charset`, and `driver` are stripped for native tools
- Override file: `--env-file <path>`
- Override variable name: `--env-var MY_DATABASE_URL`

### Optional JSON config

`.db-sync.json` or `.db-syncconfig.json` in the project root:

```json
{
  "backupDir": "./backups",
  "compress": true,
  "compressLevel": 6,
  "keepLast": 30,
  "timestampFormat": "YYYYMMDD_HHMMSS"
}
```

Override path: `--config <path>`.

## Commands

| Command | Description |
|--------|-------------|
| `dbsync export` | Stream dump → gzip (default) → file under `backupDir` |
| `dbsync restore [file]` | Stream file → decompress if needed → `psql` / `mysql` |
| `dbsync list` | List backups with size, date, database name |
| `dbsync info <file>` | File metadata and parsed backup name |
| `dbsync clean` | Retention: `--keep-last`, `--keep-days`, `--dry-run` |
| `dbsync test` | `SELECT 1` via `pg` / `mysql2` drivers |

### Global options

- `--env-file`, `--env-var`, `--config`, `-v/--verbose`, `-h/--help`, `-V/--version`

### Export

- `-o, --output` — file path or directory (default naming: `{db}_{YYYYMMDD}_{HHMMSS}.sql.gz`)
- `--schema-only`, `--data-only`, `--tables a,b`
- `--no-compress`, `--compress-level 1-9`

### Restore

- `--drop-before` — drop & recreate database first
- `--dry-run` — validate backup (full gzip stream check for `.gz`)
- `--force` — skip confirmation
- `-i, --interactive` — pick backup from list
- `-d, --database` — filter interactive list

### List

- `-d, --database`, `-l, --limit`, `--since YYYY-MM-DD`

### Clean

- `--keep-last N` — keep newest N (default from config or **30** if nothing else set)
- `--keep-days N` — also keep anything newer than N days (union with keep-last)
- `--dry-run`

## Examples

```bash
dbsync export
dbsync export -o ./backups --schema-only
dbsync restore ./backups/app_20260410_120000.sql.gz
dbsync restore -i --force
dbsync list --database app --limit 5
dbsync info ./backups/app_20260410_120000.sql.gz
dbsync clean --keep-last 10 --dry-run
dbsync test
```

## Large databases

Exports and restores use **streaming** (no in-memory buffering of the full dump). Progress shows **bytes transferred** during export (spinner) and a **bar** during restore when the input file size is known.

## Troubleshooting

| Issue | Suggestion |
|-------|------------|
| No `.env` | Create `.env` with `DATABASE_URL` or pass `--env-file` |
| Cannot connect | Run `dbsync test`; check host, port, user, password, SSL params |
| `pg_dump` / `psql` not found | Install PostgreSQL client tools and ensure they are on `PATH` |
| Permission denied on backup dir | Fix directory permissions or choose another `--output` / `backupDir` |

## License

MIT
