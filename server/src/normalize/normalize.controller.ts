import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { NormalizeService } from './normalize.service';

@Controller('normalize')
export class NormalizeController {
  constructor(private readonly svc: NormalizeService) {}

  /** Deflate→Store 정규화 배치 시작. */
  @Post('start')
  @HttpCode(202)
  start() {
    return this.svc.start();
  }

  /** 진행 중 배치 취소(현재 아카이브까지 마치고 중단). */
  @Post('cancel')
  @HttpCode(200)
  cancel() {
    return this.svc.cancel();
  }

  /** 최근 배치 상태 + 남은 후보 수. */
  @Get('status')
  status() {
    return this.svc.status();
  }
}
