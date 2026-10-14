import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export const QUEUES = {
  MAIL: 'mail',
  /** Daily contract renewals, expiries and reminders. */
  CONTRACTS: 'contracts',
  BUDGETS: 'budgets',
  /** Daily vehicle document and service reminders. */
  FLEET: 'fleet',
  /** Nightly posting of source documents to the journal. */
  ACCOUNTING: 'accounting',
  /** Simulated e-invoice integrator runs. */
  EINVOICE: 'einvoice',
} as const;

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
          },
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUES.MAIL },
      { name: QUEUES.CONTRACTS },
      { name: QUEUES.BUDGETS },
      { name: QUEUES.FLEET },
      { name: QUEUES.ACCOUNTING },
      { name: QUEUES.EINVOICE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
