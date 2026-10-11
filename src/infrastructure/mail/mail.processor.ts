import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createTransport, Transporter } from 'nodemailer';
import { AppConfigService } from '../../config/app-config.service';
import { QUEUES } from '../queue/queue.module';
import type { MailJob } from './mail.service';

@Processor(QUEUES.MAIL)
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: AppConfigService) {
    super();
    this.from = config.get('MAIL_FROM');
    this.transporter = createTransport({
      host: config.get('MAIL_HOST'),
      port: config.get('MAIL_PORT'),
      secure: false,
    });
  }

  async process(job: Job<MailJob>): Promise<void> {
    await this.transporter.sendMail({ from: this.from, ...job.data });
    this.logger.debug(`Mail sent to ${job.data.to}: ${job.data.subject}`);
  }
}
