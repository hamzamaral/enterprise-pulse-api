import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';

@ApiTags('Health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      async () => {
        const result = this.indicator.check('database');
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return result.up();
        } catch (error) {
          return result.down({ message: String(error) });
        }
      },
      async () => {
        const result = this.indicator.check('redis');
        try {
          await this.redis.ping();
          return result.up();
        } catch (error) {
          return result.down({ message: String(error) });
        }
      },
    ]);
  }
}
