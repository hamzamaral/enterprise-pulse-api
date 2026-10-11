/** The authenticated principal attached to `request.user` for every protected request. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSuperAdmin: boolean;
  /** Active company for this request (x-company-id header or default membership). */
  companyId: string;
  branchId: string | null;
  permissions: string[];
}

export interface JwtPayload {
  sub: string;
  email: string;
}
