import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import { MigrationError } from '../shared/errors.js';
import { DatabaseClient } from './client.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const sourceMigrationDirectory = join(process.cwd(), 'src', 'database', 'migrations');

export class MigrationRunner {
  constructor(
    private readonly client: DatabaseClient,
    private readonly logger?: Logger,
    private readonly migrationsDir = migrationDirectory
  ) {}

  migrate(): void {
    try {
      this.client.exec(`
        CREATE TABLE IF NOT EXISTS _migrations (
          version TEXT PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);
      const applied = this.client.prepare('SELECT version FROM _migrations ORDER BY version')
        .all() as Array<{ version: string }>;
      const directory = existsSync(this.migrationsDir)
        ? this.migrationsDir
        : this.migrationsDir === migrationDirectory
          ? sourceMigrationDirectory
          : this.migrationsDir;
      const migrations = readdirSync(directory).filter((file) => file.endsWith('.sql')).sort();
      if (migrations.length === 0) throw new Error(`No SQL migrations found in ${directory}`);
      for (const file of migrations) {
        const version = file.slice(0, -'.sql'.length);
        this.logger?.info({ migration: version }, 'Discovered database migration');
        if (applied.some((row) => row.version === version)) continue;
        const sql = readFileSync(join(directory, file), 'utf8');
        this.client.transaction(() => {
          this.client.exec(sql);
          this.client.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
        });
      }
    } catch (error) {
      throw new MigrationError('SQLite migration failed', { cause: error });
    }
  }
}
