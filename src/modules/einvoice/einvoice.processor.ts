import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { EINVOICE_SYNC_JOB, EInvoiceService } from './einvoice.service';

const POLL_JOB = 'einvoice-poll';

/** The simulated integrator: polls every minute, plus runs queued right after each send. */
@Processor(QUEUES.EINVOICE)
export class EInvoiceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(EInvoiceProcessor.name);

  constructor(
    private readonly einvoice: EInvoiceService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.EINVOICE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.queue.upsertJobScheduler(POLL_JOB, { pattern: '* * * * *' }, { name: POLL_JOB });
  }

  async process(job: Job<{ companyId?: string }>): Promise<void> {
    // Tests drive the integrator through `POST /e-invoices/sync` so every step is deterministic.
    if (this.config.get('NODE_ENV') === 'test') return;
    const companyId = job.name === EINVOICE_SYNC_JOB ? job.data.companyId : undefined;
    const { processed } = await this.einvoice.sync(companyId);
    if (processed) this.logger.log(`e-Invoice run moved ${processed} envelope(s)`);
  }
}
