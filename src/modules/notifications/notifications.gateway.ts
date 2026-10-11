import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { JwtPayload } from '../../common/auth/auth-user';

const userRoom = (userId: string) => `user:${userId}`;

/** Real-time channel. Clients connect to `/ws` with `auth: { token: <accessToken> }`. */
@WebSocketGateway({
  namespace: '/ws',
  cors: { origin: process.env.CORS_ORIGINS?.split(',') ?? true, credentials: true },
})
export class NotificationsGateway implements OnGatewayConnection {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const auth = client.handshake.auth as { token?: string } | undefined;
    try {
      if (!auth?.token) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(auth.token);
      await client.join(userRoom(payload.sub));
    } catch {
      this.logger.debug(`Rejected socket ${client.id}`);
      client.disconnect(true);
    }
  }

  emitToUser(userId: string, event: string, payload: unknown): void {
    this.server.to(userRoom(userId)).emit(event, payload);
  }
}
