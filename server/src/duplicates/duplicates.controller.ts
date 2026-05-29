import { Controller, Get, Post } from '@nestjs/common';
import { DuplicatesService } from './duplicates.service';

@Controller('duplicates')
export class DuplicatesController {
  constructor(private readonly svc: DuplicatesService) {}

  @Post('scan')
  async scan(): Promise<{ jobId: number }> {
    return { jobId: await this.svc.startScan() };
  }

  @Get('latest')
  latest() {
    return this.svc.latest();
  }
}
