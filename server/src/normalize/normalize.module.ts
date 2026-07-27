import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { RepackModule } from '../repack/repack.module';
import { NormalizeController } from './normalize.controller';
import { NormalizeService } from './normalize.service';

@Module({
  // PrismaModule·QueueModule 은 @Global. RepackModule 에서 RepackService 를 가져온다.
  imports: [JobsModule, RepackModule],
  controllers: [NormalizeController],
  providers: [NormalizeService],
})
export class NormalizeModule {}
