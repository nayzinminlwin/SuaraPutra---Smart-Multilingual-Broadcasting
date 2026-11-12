import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv, type EnvConfig } from './config/env.js';
import { getGroupRouting } from './config/groups.js';
import { AiProcessor } from './ai/ai-processor.js';
import { GeminiModelProvider, MockModelProvider, type IModelProvider } from './ai/model-provider.js';
import { DatabaseClient } from './database/client.js';
import { MigrationRunner } from './database/migrator.js';
import { AnnouncementRepository } from './database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from './database/repositories/delivery-job.repo.js';
import { EventLogRepository } from './database/repositories/event-log.repo.js';
import { SourceMessageRepository } from './database/repositories/source-message.repo.js';
import { TranslationRepository } from './database/repositories/translation.repo.js';
import { DeliveryDispatcher } from './delivery/dispatcher.js';
import { DeliveryQueue } from './delivery/queue.js';
import { DeliveryRecoveryScheduler } from './delivery/recovery-scheduler.js';
import { MessageIngestor, messageIngestorOptionsFromConfig } from './ingestion/message-ingestor.js';
import { HealthMonitor } from './observability/health.js';
import { createLogger, logSafeConfig } from './observability/logger.js';
import { BaileysWhatsAppAdapter } from './whatsapp/baileys-client.js';
import { MockWhatsAppAdapter } from './whatsapp/mock-adapter.js';
import type { IWhatsAppAdapter } from './whatsapp/adapter.js';
import type { PipelineTracer } from './observability/telemetry.js';

export interface ApplicationOptions {
  config?: EnvConfig;
  adapter?: IWhatsAppAdapter;
  modelProvider?: IModelProvider;
  startDeliveryLoop?: boolean;
}

export class SuaraPutraApplication {
  readonly config: EnvConfig;
  readonly database: DatabaseClient;
  readonly adapter: IWhatsAppAdapter;
  readonly queue: DeliveryQueue;
  readonly ingestor: MessageIngestor;
  readonly dispatcher: DeliveryDispatcher;
  readonly health: HealthMonitor;
  private readonly recovery: DeliveryRecoveryScheduler;
  private readonly logger;
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tracers = new Map<string, PipelineTracer>();
  private started = false;

  constructor(options: ApplicationOptions = {}) {
    this.config = options.config ?? parseEnv();
    this.logger = createLogger(this.config);
    logSafeConfig(this.logger, this.config);
    this.database = new DatabaseClient(this.config.DATABASE_URL, this.config);
    new MigrationRunner(this.database).migrate();

    const sources = new SourceMessageRepository(this.database);
    const announcements = new AnnouncementRepository(this.database);
    const translations = new TranslationRepository(this.database);
    const jobs = new DeliveryJobRepository(this.database);
    const events = new EventLogRepository(this.database);
    const destinations = getGroupRouting(this.config);
    this.queue = new DeliveryQueue(this.database, announcements, translations, jobs, destinations, events);
    this.adapter = options.adapter ?? (
      this.config.WHATSAPP_ADAPTER_MODE === 'baileys'
        ? new BaileysWhatsAppAdapter(this.config)
        : new MockWhatsAppAdapter({ maxMediaBytes: this.config.MAX_MEDIA_BYTES })
    );
    const provider = options.modelProvider ?? this.createModelProvider();
    const processor = new AiProcessor({
      provider,
      scoreThreshold: this.config.ANNOUNCEMENT_SCORE_THRESHOLD,
      announcements,
      eventLogs: events
    });
    this.ingestor = new MessageIngestor(messageIngestorOptionsFromConfig(this.config, {
      botJidProvider: () => this.adapter.getBotJid(),
      sources,
      announcements,
      deliveryJobs: jobs,
      database: this.database,
      aiProcessor: processor,
      deliveryQueue: this.queue,
      onTracer: (announcementId, tracer) => this.tracers.set(announcementId, tracer)
    }));
    this.dispatcher = new DeliveryDispatcher({
      adapter: this.adapter,
      queue: this.queue,
      pacingMs: this.config.DELIVERY_PACING_MS,
      killSwitch: this.config.BROADCAST_KILL_SWITCH === 'true',
      retryPolicy: undefined,
      tracerForJob: (job) => this.tracers.get(job.announcementId)
    });
    this.recovery = new DeliveryRecoveryScheduler(this.queue, {
      intervalMs: this.config.DELIVERY_POLL_INTERVAL_MS * 60
    });
    this.health = new HealthMonitor(this.database, this.adapter, jobs, sources, this.config);
    this.adapter.onConnectionChange((status, reason) => {
      this.logger.info({ status, reason }, 'WhatsApp connection state changed');
    });
    this.ingestor.attach(this.adapter);
    if (options.startDeliveryLoop !== false) this.startDispatchLoop();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const interruptedCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const recovered = await this.ingestor.recoverInterrupted(interruptedCutoff);
    if (recovered > 0) this.logger.info({ recovered }, 'AI_INTERRUPTED_RECOVERY_COMPLETED');
    this.recovery.start();
    await this.runRetention();
    this.retentionTimer = setInterval(() => { void this.runRetention(); }, 24 * 60 * 60 * 1000);
    this.retentionTimer.unref?.();
    await this.adapter.connect();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    this.dispatchTimer = null;
    const drained = await this.dispatcher.stopAndDrain(this.config.DELIVERY_SEND_TIMEOUT_MS);
    if (!drained) this.logger.warn({ timeoutMs: this.config.DELIVERY_SEND_TIMEOUT_MS }, 'Active dispatch did not drain before shutdown');
    this.recovery.stop();
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    await this.adapter.disconnect();
    this.database.database.pragma('wal_checkpoint(TRUNCATE)');
    this.database.close();
  }

  getPipelineTracer(announcementId: string): PipelineTracer | undefined {
    return this.tracers.get(announcementId);
  }

  private async runRetention(): Promise<void> {
    try {
      const result = await this.health.runRetention();
      this.logger.info({ ...result }, 'DATA_RETENTION_COMPLETED');
    } catch (error) {
      this.logger.error({
        errorCode: error instanceof Error ? error.name : 'DATA_RETENTION_ERROR'
      }, 'DATA_RETENTION_FAILED');
    }
  }

  private startDispatchLoop(): void {
    this.dispatchTimer = setInterval(() => {
      void this.dispatcher.dispatchOnce().catch((error: unknown) => {
        this.logger.error({ errorCode: error instanceof Error ? error.name : 'DISPATCH_LOOP_ERROR' }, 'Delivery loop failed');
      });
    }, this.config.DELIVERY_POLL_INTERVAL_MS);
  }

  private createModelProvider(): IModelProvider {
    if (this.config.AI_PROVIDER === 'gemini') {
      return new GeminiModelProvider({ apiKey: this.config.AI_API_KEY, model: this.config.AI_MODEL });
    }
    return new MockModelProvider([({ id, type, content }: { id: string; type: string; content: string }) => ({
      id,
      score: type === 'TEXT CAPTION FROM IMAGE' ? 10 : 8,
      English: content,
      Malay: content,
      Tamil: content,
      Mandarin: content
    })]);
  }
}

export function createApplication(options: ApplicationOptions = {}): SuaraPutraApplication {
  return new SuaraPutraApplication(options);
}

async function main(): Promise<void> {
  const application = createApplication();
  const shutdown = async (signal: string) => {
    console.log(`[APP] ${signal} received; shutting down`);
    await application.stop();
  };
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  await application.start();
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectRun) {
  void main();
}
