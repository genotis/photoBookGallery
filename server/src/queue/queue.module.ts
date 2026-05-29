import { Global, Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { JobReconcilerService } from './job-reconciler.service';
import { QueueService } from './queue.service';

@Global()
@Module({
  imports: [JobsModule],
  providers: [QueueService, JobReconcilerService],
  exports: [QueueService],
})
export class QueueModule {}
