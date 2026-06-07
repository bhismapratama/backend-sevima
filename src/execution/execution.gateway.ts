import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import {Injectable} from '@nestjs/common';
import {Server, Socket} from 'socket.io';

@Injectable()
@WebSocketGateway({
  cors: {origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173'},
  namespace: 'executions',
})
export class ExecutionGateway {
  @WebSocketServer()
  private readonly server!: Server;

  @SubscribeMessage('subscribe')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() executionId: string,
  ): void {
    void client.join(`execution:${executionId}`);
  }

  @SubscribeMessage('subscribe-tenant')
  handleSubscribeTenant(
    @ConnectedSocket() client: Socket,
    @MessageBody() tenantId: string,
  ): void {
    void client.join(`tenant:${tenantId}`);
  }

  broadcast(executionId: string, event: Record<string, unknown>): void {
    this.server.to(`execution:${executionId}`).emit('event', event);
  }

  broadcastTenant(
    tenantId: string,
    patch: {
      executionId: string;
      status: string;
      durationMs?: number;
      completedAt?: string;
    },
  ): void {
    this.server
      .to(`tenant:${tenantId}`)
      .emit('tenant-event', {type: 'execution.updated', ...patch});
  }
}
