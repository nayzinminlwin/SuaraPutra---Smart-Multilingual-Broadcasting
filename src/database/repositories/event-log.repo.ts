import type { DatabaseClient } from '../client.js';
import type { EventLevel } from '../../shared/types.js';

export interface EventLogInput {
  eventType: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  level: EventLevel;
  details: Readonly<Record<string, unknown>>;
}

export class EventLogRepository {
  constructor(private readonly client: DatabaseClient) {}

  append(input: EventLogInput): number {
    const result = this.client.prepare(`
      INSERT INTO event_logs
      (event_type, related_entity_type, related_entity_id, level, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      input.eventType, input.relatedEntityType ?? null, input.relatedEntityId ?? null,
      input.level, JSON.stringify(input.details)
    );
    return Number(result.lastInsertRowid);
  }
}
