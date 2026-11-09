import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators';
import { PrismaService } from './common/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async health() {
    await this.prisma.ping();
    return { ok: true };
  }
}
