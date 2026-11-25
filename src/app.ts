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

const TRACER_MAX_AGE_MS = 5 * 60 * 1000;
const TRACER_SWEEP_INTERVAL_MS = 60 * 1000;

export interface ApplicationOptions {
  config?: EnvConfig;
  adapter?: IWhatsAppAdapter;
  modelProvider?: IModelProvider;
  startDeliveryLoop?: boolean;
}

type ApplicationRuntime = Readonly<{
  logger: ReturnType<typeof createLogger>;
  database: DatabaseClient;
  adapter: IWhatsAppAdapter;
  queue: DeliveryQueue;
  ingestor: MessageIngestor;
  dispatcher: DeliveryDispatcher;
  health: HealthMonitor;
  recovery: DeliveryRecoveryScheduler;
}>;

type TracerEntry = Readonly<{ tracer: PipelineTracer; createdAtMs: number }>;

export class SuaraPutraApplication {
  readonly config: EnvConfig;
  private readonly options: ApplicationOptions;
  private runtime: ApplicationRuntime | null = null;
  private dispatchTimer: ReturnType<typeof setInterval> | null = null;
  private retentionTimer: ReturnType<typeof setInterval> | null = null;
  private tracerCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tracers = new Map<string, TracerEntry>();
  private started = false;

  constructor(options: ApplicationOptions = {}) {
    this.options = options;
    this.config = options.config ?? parseEnv();
  }

  get database(): DatabaseClient {
    return this.requireRuntime().database;
  }

  get adapter(): IWhatsAppAdapter {
    return this.requireRuntime().adapter;
  }

  get queue(): DeliveryQueue {
    return this.requireRuntime().queue;
  }

  get ingestor(): MessageIngestor {
    return this.requireRuntime().ingestor;
  }

  get dispatcher(): DeliveryDispatcher {
    return this.requireRuntime().dispatcher;
  }

  get health(): HealthMonitor {
    return this.requireRuntime().health;
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.runtime) throw new Error('Application has already been initialized and cannot be restarted');
    const runtime = this.createRuntime();
    this.runtime = runtime;
    try {
      runtime.adapter.onConnectionChange((status, reason) => {
        runtime.logger.info({ status, reason }, 'WhatsApp connection state changed');
      });
      runtime.ingestor.attach(runtime.adapter);

      const interruptedCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const recovered = await runtime.ingestor.recoverInterrupted(interruptedCutoff);
      if (recovered > 0) runtime.logger.info({ recovered }, 'AI_INTERRUPTED_RECOVERY_COMPLETED');

      await runtime.adapter.connect();
      runtime.recovery.start();
      await this.runRetention();
      this.retentionTimer = setInterval(() => { void this.runRetention(); }, 24 * 60 * 60 * 1000);
      this.retentionTimer.unref?.();
      this.tracerCleanupTimer = setInterval(() => this.evictExpiredTracers(Date.now()), TRACER_SWEEP_INTERVAL_MS);
      this.tracerCleanupTimer.unref?.();
      this.started = true;
      if (this.options.startDeliveryLoop !== false) this.startDispatchLoop();
    } catch (error) {
      this.clearTimers();
      runtime.recovery.stop();
      runtime.database.close();
      this.runtime = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const runtime = this.requireRuntime();
    this.clearTimers();
    const drained = await runtime.dispatcher.stopAndDrain(this.config.DELIVERY_SEND_TIMEOUT_MS);
    if (!drained) runtime.logger.warn({ timeoutMs: this.config.DELIVERY_SEND_TIMEOUT_MS }, 'Active dispatch did not drain before shutdown');
    runtime.recovery.stop();
    await runtime.adapter.disconnect();
    runtime.database.database.pragma('wal_checkpoint(TRUNCATE)');
    runtime.database.close();
  }

  getPipelineTracer(announcementId: string): PipelineTracer | undefined {
    return this.tracers.get(announcementId)?.tracer;
  }

  private async runRetention(): Promise<void> {
    try {
      const result = await this.health.runRetention();
      this.requireRuntime().logger.info({ ...result }, 'DATA_RETENTION_COMPLETED');
    } catch (error) {
      this.requireRuntime().logger.error({
        errorCode: error instanceof Error ? error.name : 'DATA_RETENTION_ERROR'
      }, 'DATA_RETENTION_FAILED');
    }
  }

  private startDispatchLoop(): void {
    this.dispatchTimer = setInterval(() => {
      void this.dispatcher.dispatchOnce().catch((error: unknown) => {
        this.requireRuntime().logger.error({ errorCode: error instanceof Error ? error.name : 'DISPATCH_LOOP_ERROR' }, 'Delivery loop failed');
      });
    }, this.config.DELIVERY_POLL_INTERVAL_MS);
  }

  private createRuntime(): ApplicationRuntime {
    const logger = createLogger(this.config);
    logSafeConfig(logger, this.config);
    const database = new DatabaseClient(this.config.DATABASE_URL, this.config);
    try {
      new MigrationRunner(database, logger).migrate();
      const sources = new SourceMessageRepository(database);
      const announcements = new AnnouncementRepository(database);
      const translations = new TranslationRepository(database);
      const jobs = new DeliveryJobRepository(database);
      const events = new EventLogRepository(database);
      const destinations = getGroupRouting(this.config);
      const queue = new DeliveryQueue(
        database,
        announcements,
        translations,
        jobs,
        destinations,
        events,
        (announcementId) => this.tracers.delete(announcementId)
      );
      const adapter = this.options.adapter ?? (
        this.config.WHATSAPP_ADAPTER_MODE === 'baileys'
          ? new BaileysWhatsAppAdapter(this.config)
          : new MockWhatsAppAdapter({ maxMediaBytes: this.config.MAX_MEDIA_BYTES })
      );
      const provider = this.options.modelProvider ?? this.createModelProvider();
      const processor = new AiProcessor({
        provider,
        scoreThreshold: this.config.ANNOUNCEMENT_SCORE_THRESHOLD,
        announcements,
        eventLogs: events
      });
      const ingestor = new MessageIngestor(messageIngestorOptionsFromConfig(this.config, {
        botJidProvider: () => {
          const identities = adapter.getBotIdentities();
          return identities.length > 0 ? identities : adapter.getBotJid();
        },
        sources,
        announcements,
        deliveryJobs: jobs,
        database,
        aiProcessor: processor,
        deliveryQueue: queue,
        onTracer: (announcementId, tracer) => this.storeTracer(announcementId, tracer)
      }));
      const dispatcher = new DeliveryDispatcher({
        adapter,
        queue,
        pacingMs: this.config.DELIVERY_PACING_MS,
        killSwitch: this.config.BROADCAST_KILL_SWITCH === 'true',
        retryPolicy: undefined,
        tracerForJob: (job) => this.getPipelineTracer(job.announcementId)
      });
      const recovery = new DeliveryRecoveryScheduler(queue, {
        intervalMs: this.config.DELIVERY_POLL_INTERVAL_MS * 60
      });
      const health = new HealthMonitor(database, adapter, jobs, sources, this.config);
      return { logger, database, adapter, queue, ingestor, dispatcher, health, recovery };
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private storeTracer(announcementId: string, tracer: PipelineTracer): void {
    const createdAtMs = Date.now();
    this.evictExpiredTracers(createdAtMs);
    this.tracers.set(announcementId, { tracer, createdAtMs });
  }

  private evictExpiredTracers(nowMs: number): void {
    for (const [announcementId, entry] of this.tracers) {
      if (nowMs - entry.createdAtMs >= TRACER_MAX_AGE_MS) this.tracers.delete(announcementId);
    }
  }

  private clearTimers(): void {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    this.dispatchTimer = null;
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = null;
    if (this.tracerCleanupTimer) clearInterval(this.tracerCleanupTimer);
    this.tracerCleanupTimer = null;
  }

  private requireRuntime(): ApplicationRuntime {
    if (!this.runtime) throw new Error('Application has not been started');
    return this.runtime;
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
