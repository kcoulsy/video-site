import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { comment } from "./comment";
import { video } from "./video";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  videos: many(video),
  comments: many(comment),
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

export const videoRelations = relations(video, ({ one, many }) => ({
  user: one(user, {
    fields: [video.userId],
    references: [user.id],
  }),
  comments: many(comment),
}));

export const commentRelations = relations(comment, ({ one, many }) => ({
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [comment.videoId],
    references: [video.id],
  }),
  parent: one(comment, {
    fields: [comment.parentId],
    references: [comment.id],
    relationName: "commentReplies",
  }),
  replies: many(comment, {
    relationName: "commentReplies",
  }),
}));
