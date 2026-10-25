import type { Db } from "../db/client.js";
import type { Queue } from "../runtime/queue.js";

/** Per-request dependencies. Injected rather than imported so tests can supply a temp DB. */
export interface AppContext {
  db: Db;
  taskQueue: Queue;
  webhookQueue: Queue;
}

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  apiKeyWorkspaceId?: string | null;
  [claim: string]: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx: AppContext;
      auth?: AuthUser;
    }
  }
}
