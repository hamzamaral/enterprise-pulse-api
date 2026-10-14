import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../../infrastructure/queue/queue.module';
import { FleetSummaryService } from './fleet-summary.service';

const DAILY_JOB = 'fleet-daily';

/** Runs the fleet reminders every morning; tests trigger them through `POST /vehicles/run`. */
@Processor(QUEUES.FLEET)
export class FleetProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(FleetProcessor.name);

  constructor(
    private readonly fleet: FleetSummaryService,
    private readonly config: AppConfigService,
    @InjectQueue(QUEUES.FLEET) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV') === 'test') return;
    await this.queue.upsertJobScheduler(
      DAILY_JOB,
      { pattern: '15 7 * * *', tz: 'Europe/Istanbul' },
      { name: DAILY_JOB },
    );
  }

  async process(): Promise<void> {
    await this.fleet.runAll();
    this.logger.log('Vehicle document and service reminders processed');
  }
}
