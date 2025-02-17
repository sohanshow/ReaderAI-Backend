import { Module } from '@nestjs/common';
import { PdfGateway } from './pdf.gateway';

@Module({
  providers: [PdfGateway],
  exports: [PdfGateway],
})
export class GatewayModule {}
