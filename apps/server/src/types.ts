import type { Session, User } from "better-auth";

export type AppVariables = {
  user: User;
  session: Session;
};
