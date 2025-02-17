import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileData, FileDataSchema } from './schemas/file.schema';
import { ServicesModule } from '../services/services.module';
import { GatewayModule } from '../gateway/gateway.module';
import { MulterModule } from '@nestjs/platform-express';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileData.name, schema: FileDataSchema },
    ]),
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
    ServicesModule,
    GatewayModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
