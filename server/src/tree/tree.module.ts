import { Module } from '@nestjs/common';
import { TreeController } from './tree.controller';

@Module({
  controllers: [TreeController],
})
export class TreeModule {}
