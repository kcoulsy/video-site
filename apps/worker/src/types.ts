export interface TranscodeJobData {
  videoId: string;
  rawPath: string;
  userId: string;
}

export interface ThumbnailJobData {
  videoId: string;
  thumbnailSourcePath: string;
}

export type CleanupJobType = "stale-uploads" | "failed-videos" | "delete-video";

export interface CleanupJobData {
  type: CleanupJobType;
  videoId?: string;
}

export type TranscodeProgress = {
  stage: "probing" | "thumbnail" | "transcoding" | "complete";
  percent: number;
};

export type RecsJobType = "build-similarity" | "build-trending" | "build-user-cf" | "guest-cleanup";

export interface RecsJobData {
  type: RecsJobType;
}

export type NotificationKind =
  | "new_upload"
  | "comment_reply"
  | "video_like"
  | "comment_like"
  | "mention";

export type NotificationJobData =
  | {
      type: "fanout-new-upload";
      videoId: string;
      channelId: string;
    }
  | {
      type: "single";
      recipientId: string;
      kind: NotificationKind;
      actorId?: string;
      videoId?: string;
      commentId?: string;
      coalesceWindowSec?: number;
    };
