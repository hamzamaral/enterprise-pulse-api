import type { AuthUser } from './auth-user';

/** In-service check for permissions that widen access beyond self-service. */
export function hasPermission(user: AuthUser, code: string): boolean {
  return user.isSuperAdmin || user.permissions.includes(code);
}
