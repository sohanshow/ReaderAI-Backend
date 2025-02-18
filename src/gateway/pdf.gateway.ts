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
      completedPages: number;
      totalPages: number;
      completedJobs: string[];
    },
  ) {
    const channel = `pdf-progress-${userEmail}-${fileId}`;
    this.server.emit(channel, progress);
  }
}
