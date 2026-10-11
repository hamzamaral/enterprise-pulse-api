import { Global, Module } from '@nestjs/common';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [MailService, MailProcessor],
  exports: [MailService],
})
export class MailModule {}
