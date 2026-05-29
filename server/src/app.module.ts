import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { LoggerModule } from 'nestjs-pino';
import { join } from 'path';
import configuration from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { HealthModule } from './health/health.module';
import { ArchiveModule } from './archive/archive.module';
import { JobsModule } from './jobs/jobs.module';
import { LibraryModule } from './library/library.module';
import { ImagesModule } from './images/images.module';
import { ArchivesModule } from './archives/archives.module';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: isProd ? 'info' : 'debug',
        transport: isProd
          ? undefined
          : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.cookie', 'req.headers.authorization'],
      },
    }),
    // 프로덕션에서는 빌드된 SPA(public/)를 서빙. /api/* 는 제외.
    ...(isProd
      ? [
          ServeStaticModule.forRoot({
            rootPath: join(__dirname, '..', 'public'),
            exclude: ['/api*'],
          }),
        ]
      : []),
    PrismaModule,
    AuthModule,
    HealthModule,
    ArchiveModule,
    JobsModule,
    LibraryModule,
    ImagesModule,
    ArchivesModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
