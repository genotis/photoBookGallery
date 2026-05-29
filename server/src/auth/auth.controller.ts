import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request): { ok: true } {
    if (!this.auth.verify(dto.password)) {
      throw new UnauthorizedException('비밀번호가 올바르지 않습니다.');
    }
    req.session.authenticated = true;
    return { ok: true };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Req() req: Request): { ok: true } {
    req.session.destroy(() => undefined);
    return { ok: true };
  }

  @Public()
  @Get('me')
  me(@Req() req: Request): { authenticated: boolean } {
    return { authenticated: Boolean(req.session?.authenticated) };
  }
}
