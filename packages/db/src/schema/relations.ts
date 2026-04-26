import { relations } from "drizzle-orm";

import { account, session, user } from "./auth";
import { comment } from "./comment";
import { videoLike } from "./like";
import { moderationAction, report } from "./moderation";
import { category, categoryTag, tag, videoTag } from "./tags";
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
  videoTags: many(videoTag),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  videoTags: many(videoTag),
  categoryTags: many(categoryTag),
}));

export const categoryRelations = relations(category, ({ many }) => ({
  categoryTags: many(categoryTag),
}));

export const categoryTagRelations = relations(categoryTag, ({ one }) => ({
  category: one(category, {
    fields: [categoryTag.categoryId],
    references: [category.id],
  }),
  tag: one(tag, {
    fields: [categoryTag.tagId],
    references: [tag.id],
  }),
}));

export const videoTagRelations = relations(videoTag, ({ one }) => ({
  video: one(video, {
    fields: [videoTag.videoId],
    references: [video.id],
  }),
  tag: one(tag, {
    fields: [videoTag.tagId],
    references: [tag.id],
  }),
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

export const moderationActionRelations = relations(moderationAction, ({ one }) => ({
  actor: one(user, {
    fields: [moderationAction.actorId],
    references: [user.id],
  }),
}));

export const reportRelations = relations(report, ({ one }) => ({
  reporter: one(user, {
    fields: [report.reporterId],
    references: [user.id],
    relationName: "reportReporter",
  }),
  resolver: one(user, {
    fields: [report.resolvedBy],
    references: [user.id],
    relationName: "reportResolver",
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
