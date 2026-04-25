import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { comment } from "./comment";
import { videoLike } from "./like";
import { video } from "./video";
import { watchHistory } from "./watch-history";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  videos: many(video),
  comments: many(comment),
  likes: many(videoLike),
  watchHistory: many(watchHistory),
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
  likes: many(videoLike),
  watchHistory: many(watchHistory),
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

export const videoLikeRelations = relations(videoLike, ({ one }) => ({
  user: one(user, {
    fields: [videoLike.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [videoLike.videoId],
    references: [video.id],
  }),
}));

export const watchHistoryRelations = relations(watchHistory, ({ one }) => ({
  user: one(user, {
    fields: [watchHistory.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [watchHistory.videoId],
    references: [video.id],
  }),
}));
