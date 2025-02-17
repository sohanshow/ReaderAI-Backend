import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})
export class PdfGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  private logger = new Logger('PdfGateway');

  handleConnection(client: any) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: any) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  emitProgress(
    userEmail: string,
    fileId: string,
    progress: {
      phase: 'extraction' | 'audio';
      current: number;
      total: number;
      pageNumber?: number;
    },
  ) {
    const channel = `pdf-progress-${userEmail}-${fileId}`;
    // this.logger.log(`Emitting progress on channel ${channel}:`, progress);
    this.server.emit(channel, progress);
  }

  emitJobStatus(
    userEmail: string,
    fileId: string,
    pageNumber: number,
    status: string,
  ) {
    const channel = `pdf-progress-${userEmail}-${fileId}`;
    this.logger.log(`Emitting job status on channel ${channel}:`, {
      pageNumber,
      status,
    });
    this.server.emit(channel, {
      phase: 'audio',
      pageNumber,
      status,
    });
  }
}
