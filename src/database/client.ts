import Database from 'better-sqlite3';
import { createLogger } from '../observability/logger.js';
import type { EnvConfig } from '../config/env.js';

export class DatabaseClient {
  readonly database: Database.Database;
  private readonly logger;

  constructor(databasePath: string, config?: Pick<EnvConfig, 'LOG_LEVEL' | 'NODE_ENV'>) {
    this.database = new Database(databasePath);
    this.logger = config ? createLogger(config) : null;
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('wal_autocheckpoint = 2000');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('temp_store = MEMORY');
  }

  exec(sql: string): void {
    this.measure('exec', sql, () => this.database.exec(sql));
  }

  prepare(sql: string): Database.Statement {
    const statement = this.database.prepare(sql);
    return new Proxy(statement, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function' || !['run', 'get', 'all', 'iterate'].includes(String(property))) {
          return value;
        }
        return (...parameters: unknown[]) => this.measure(String(property), sql, () =>
          Reflect.apply(value, target, parameters)
        );
      }
    });
  }

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  close(): void {
    this.database.close();
  }

  private measure<T>(operation: string, sql: string, callback: () => T): T {
    const started = process.hrtime.bigint();
    try {
      return callback();
    } finally {
      if (this.logger?.isLevelEnabled('debug')) {
        const durationUs = Number((process.hrtime.bigint() - started) / 1000n);
        this.logger.debug({ operation, durationUs, sql: sql.slice(0, 200) }, 'SQLite query');
      }
    }
  }
}
