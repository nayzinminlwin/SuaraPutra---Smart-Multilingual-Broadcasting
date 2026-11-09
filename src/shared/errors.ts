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

export type WhatsAppFailureKind = 'transient' | 'ambiguous' | 'permanent' | 'invalid';

export class WhatsAppError extends Error {
  constructor(
    message: string,
    public readonly failureKind: WhatsAppFailureKind,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'WhatsAppError';
  }
}

export class WhatsAppTransientError extends WhatsAppError {
  constructor(message = 'WhatsApp transport failed before send completion', options?: { cause?: unknown }) {
    super(message, 'transient', options);
    this.name = 'WhatsAppTransientError';
  }
}

export class WhatsAppAmbiguousTimeoutError extends WhatsAppError {
  constructor(message = 'WhatsApp send outcome is ambiguous after dispatch began', options?: { cause?: unknown }) {
    super(message, 'ambiguous', options);
    this.name = 'WhatsAppAmbiguousTimeoutError';
  }
}

export class WhatsAppPermanentError extends WhatsAppError {
  constructor(message = 'WhatsApp rejected the message permanently', options?: { cause?: unknown }) {
    super(message, 'permanent', options);
    this.name = 'WhatsAppPermanentError';
  }
}

export class WhatsAppInvalidInputError extends WhatsAppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'invalid', options);
    this.name = 'WhatsAppInvalidInputError';
  }
}
