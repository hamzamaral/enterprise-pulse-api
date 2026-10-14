import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { AccountingPostingService } from './accounting-posting.service';

const DAILY_JOB = 'accounting-daily';

/** Posts the documents of the previous day every night; tests use `POST /accounting/run`. */
@Processor(QUEUES.ACCOUNTING)
export class AccountingProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountingProcessor.name);

  constructor(
    private readonly posting: AccountingPostingService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.ACCOUNTING) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.queue.upsertJobScheduler(
      DAILY_JOB,
      { pattern: '30 2 * * *', tz: 'Europe/Istanbul' },
      { name: DAILY_JOB },
    );
  }

  async process(): Promise<void> {
    await this.posting.runAll();
    this.logger.log('Pending documents posted to the journal');
  }
}
