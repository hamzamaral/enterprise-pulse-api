import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [{ provide: PrismaService, useFactory: () => createPrismaClient() }],
  exports: [PrismaService],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
