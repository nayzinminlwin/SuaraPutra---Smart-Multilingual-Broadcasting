import { DuplicateRecordError } from '../../shared/errors.js';
import type { Translation, TranslationInput } from '../../shared/types.js';
import type { DatabaseClient } from '../client.js';

type TranslationRow = {
  id: string; announcement_id: string; language_code: TranslationInput['languageCode'];
  content: string; validation_status: TranslationInput['validationStatus'];
  validation_errors_json: string | null; created_at: string;
};
function map(row: TranslationRow): Translation {
  return {
    id: row.id, announcementId: row.announcement_id, languageCode: row.language_code,
    content: row.content, validationStatus: row.validation_status,
    validationErrorsJson: row.validation_errors_json, createdAt: row.created_at
  };
}

export class TranslationRepository {
  constructor(private readonly client: DatabaseClient) {}

  insert(input: TranslationInput): Translation {
    try {
      this.client.prepare(`
        INSERT INTO translations
        (id, announcement_id, language_code, content, validation_status, validation_errors_json)
        VALUES (@id, @announcementId, @languageCode, @content, @validationStatus, @validationErrorsJson)
      `).run({ ...input, validationErrorsJson: input.validationErrorsJson ?? null });
      return this.find(input.announcementId, input.languageCode) ?? (() => { throw new Error('Inserted translation could not be read'); })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new DuplicateRecordError('translation', `${input.announcementId}:${input.languageCode}`);
      }
      throw error;
    }
  }

  find(announcementId: string, languageCode: TranslationInput['languageCode']): Translation | null {
    const row = this.client.prepare(
      'SELECT * FROM translations WHERE announcement_id = ? AND language_code = ?'
    ).get(announcementId, languageCode) as TranslationRow | undefined;
    return row ? map(row) : null;
  }

  listForAnnouncement(announcementId: string): Translation[] {
    const rows = this.client.prepare(
      'SELECT * FROM translations WHERE announcement_id = ? ORDER BY language_code'
    ).all(announcementId) as TranslationRow[];
    return rows.map(map);
  }
}
