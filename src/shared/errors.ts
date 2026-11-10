export class PersistenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}

export class DuplicateRecordError extends PersistenceError {
  constructor(entity: string, key: string) {
    super(`Duplicate ${entity}: ${key}`);
    this.name = 'DuplicateRecordError';
  }
}

export class MigrationError extends PersistenceError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
  }
}

export class DeliveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryValidationError';
  }
}
