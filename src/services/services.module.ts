import { Module } from '@nestjs/common';
import { PlayHTService } from './playht.service';

@Module({
  providers: [PlayHTService],
  exports: [PlayHTService],
})
export class ServicesModule {}
