import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MigrationError } from '../shared/errors.js';
import { DatabaseClient } from './client.js';

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export class MigrationRunner {
  constructor(private readonly client: DatabaseClient) {}

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
      const version = '001_initial_schema';
      if (applied.some((row) => row.version === version)) return;
      const migrationPath = join(migrationDirectory, `${version}.sql`);
      const sourceMigrationPath = join(process.cwd(), 'src', 'database', 'migrations', `${version}.sql`);
      const sql = readFileSync(existsSync(migrationPath) ? migrationPath : sourceMigrationPath, 'utf8');
      this.client.transaction(() => {
        this.client.exec(sql);
        this.client.prepare('INSERT INTO _migrations (version) VALUES (?)').run(version);
      });
    } catch (error) {
      throw new MigrationError('SQLite migration failed', { cause: error });
    }
  }
}
