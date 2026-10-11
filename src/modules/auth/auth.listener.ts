import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { USER_EVENTS, type UserInvitedEvent } from '../users/users.events';
import { AuthService } from './auth.service';

@Injectable()
export class AuthListener {
  constructor(private readonly auth: AuthService) {}

  /** Invited users set their own password through the regular reset-password flow. */
  @OnEvent(USER_EVENTS.INVITED, { async: true, promisify: true })
  async onUserInvited(event: UserInvitedEvent): Promise<void> {
    await this.auth.forgotPassword(event.email);
  }
}
