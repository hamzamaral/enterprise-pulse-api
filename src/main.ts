import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);

  const config = app.get(AppConfigService);
  const document = setupSwagger(app);
  if (!config.isProduction) {
    // Consumed by the web repo's Orval client generator
    writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  }

  await app.listen(config.get('PORT'));
}

void bootstrap();
