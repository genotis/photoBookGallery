import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// Prisma 의 BigInt 필드(sizeBytes 등)를 JSON 직렬화 가능하게 한다.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON =
  function (): string {
    return this.toString();
  };

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // 리버스 프록시(Synology DSM) 뒤에서 secure 쿠키/프로토콜 인식
  app.set('trust proxy', 1);

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  app.use(
    session({
      secret: config.get<string>('session.secret')!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30, // 30일
      },
    }),
  );

  const port = config.get<number>('port')!;
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
