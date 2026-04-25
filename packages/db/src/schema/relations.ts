import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { video } from "./video";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  videos: many(video),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const videoRelations = relations(video, ({ one }) => ({
  user: one(user, {
    fields: [video.userId],
    references: [user.id],
  }),
}));
