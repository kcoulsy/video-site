import type { Session, User } from "better-auth";

export type AppUser = User & {
  role?: string | null;
  mutedAt?: Date | null;
  muteReason?: string | null;
};

export type AppVariables = {
  user: AppUser;
  session: Session;
};
