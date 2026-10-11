import type { AuthUser } from '../../common/auth/auth-user';

/** In-service check for permissions that widen access beyond self-service. */
export function hasPermission(user: AuthUser, code: string): boolean {
  return user.isSuperAdmin || user.permissions.includes(code);
}

export const LEAVE_WORKFLOW_CODE = 'LEAVE_REQUEST';
export const LEAVE_ENTITY_TYPE = 'LeaveRequest';
