import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { ContractsService } from './contracts.service';

const DAILY_JOB = 'contracts-daily';

/** Runs the contract job every morning; tests trigger it through `POST /contracts/run`. */
@Processor(QUEUES.CONTRACTS)
export class ContractsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractsProcessor.name);

  constructor(
    private readonly contracts: ContractsService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.CONTRACTS) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.queue.upsertJobScheduler(
      DAILY_JOB,
      { pattern: '0 7 * * *', tz: 'Europe/Istanbul' },
      { name: DAILY_JOB },
    );
  }

  async process(): Promise<void> {
    await this.contracts.runAll();
    this.logger.log('Contract renewals, expiries and reminders processed');
  }
}
