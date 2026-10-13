import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { BudgetsService } from './budgets.service';

const DAILY_JOB = 'budgets-daily';

/** Runs the overspend check every morning; tests trigger it through `POST /budgets/run`. */
@Processor(QUEUES.BUDGETS)
export class BudgetsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(BudgetsProcessor.name);

  constructor(
    private readonly budgets: BudgetsService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.BUDGETS) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.queue.upsertJobScheduler(
      DAILY_JOB,
      { pattern: '30 7 * * *', tz: 'Europe/Istanbul' },
      { name: DAILY_JOB },
    );
  }

  async process(): Promise<void> {
    await this.budgets.runAll();
    this.logger.log('Budget overspend alerts processed');
  }
}
