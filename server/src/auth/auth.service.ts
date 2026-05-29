import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly password: string;

  constructor(config: ConfigService) {
    this.password = config.get<string>('auth.password') ?? '';
  }

  onModuleInit(): void {
    if (!this.password) {
      this.logger.warn(
        'PBG_AUTH_PASSWORD 가 설정되지 않았습니다. 인증이 항상 실패합니다.',
      );
    }
  }

  /** 입력 비밀번호 검증 (타이밍 공격 방지 비교). */
  verify(input: string): boolean {
    if (!this.password || !input) {
      return false;
    }
    const a = Buffer.from(input);
    const b = Buffer.from(this.password);
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }
}
