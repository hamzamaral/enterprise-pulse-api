import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  userEmail?: string;
  companyId?: string;
  branchId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Carries per-request data (user, active company/branch, request id) through every layer
 * without passing it as arguments. Populated by RequestContextMiddleware and JwtStrategy.
 */
export const RequestContext = {
  run<T>(store: RequestContextStore, callback: () => T): T {
    return storage.run(store, callback);
  },

  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  set(values: Partial<RequestContextStore>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, values);
  },
};
