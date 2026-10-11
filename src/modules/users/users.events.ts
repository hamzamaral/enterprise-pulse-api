export const USER_EVENTS = {
  INVITED: 'user.invited',
} as const;

export interface UserInvitedEvent {
  userId: string;
  email: string;
}
