import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES } from '../queue/queue.module';

export interface MailJob {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/** Queues e-mails; delivery happens in MailProcessor so HTTP requests never wait on SMTP. */
@Injectable()
export class MailService {
  constructor(@InjectQueue(QUEUES.MAIL) private readonly queue: Queue<MailJob>) {}

  async send(job: MailJob): Promise<void> {
    await this.queue.add('send', job);
  }
}
