-- Composite indexes to back the two hot comment-list queries:
--   1. Top-level comments for a video:
--        WHERE video_id = ? AND parent_id IS NULL ORDER BY created_at DESC
--   2. Replies under a root:
--        WHERE video_id = ? AND root_id = ?    ORDER BY created_at ASC
-- Without these the planner falls back to comment_video_id_idx and a sort.
CREATE INDEX IF NOT EXISTS comment_video_toplevel_created_idx
  ON comment (video_id, created_at DESC)
  WHERE parent_id IS NULL;

CREATE INDEX IF NOT EXISTS comment_video_root_created_idx
  ON comment (video_id, root_id, created_at);
