import { DomainError } from "@livecoco/domain";
import type { Tx } from "@livecoco/database";
import type { Session, User } from "../modules/identity/identity.types.ts";

/** Who is acting: the authenticated user and the session they used (absent for public, worker and system work). */
export interface Actor { user: User; session: Session }

/**
 * Everything a service call needs: the unit of work, the clock, the request's correlation id (stamped on
 * audit entries) and, for authenticated calls, the actor. One Scope per request or background job.
 */
export class Scope {
  readonly tx: Tx;
  readonly cid: string;
  actor: Actor | undefined;
  private readonly clock: () => Date;

  constructor(tx: Tx, clock: () => Date, cid: string, actor?: Actor) {
    this.tx = tx;
    this.clock = clock;
    this.cid = cid;
    this.actor = actor;
  }

  now() { return this.clock(); }
  ms() { return this.clock().getTime(); }
  iso() { return this.clock().toISOString(); }

  get user(): User {
    if (!this.actor) throw new DomainError("UNAUTHENTICATED", 401, "Authentication required", "error.unauthenticated");
    return this.actor.user;
  }
  get session(): Session {
    if (!this.actor) throw new DomainError("UNAUTHENTICATED", 401, "Authentication required", "error.unauthenticated");
    return this.actor.session;
  }
}

/** Throws a NOT_FOUND domain error; for `x ?? missing("Lot")`. */
export const orNotFound = <T>(v: T | undefined, what: string): T => {
  if (v === undefined) throw new DomainError("NOT_FOUND", 404, `${what} not found`);
  return v;
};
