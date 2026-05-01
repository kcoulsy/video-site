-- GIN index on video.tags so the related-video query in
-- apps/server/src/services/recommendations.ts (`tags && currentTags::text[]`)
-- can use a Bitmap Index Scan instead of sequential-scanning the video table.
CREATE INDEX IF NOT EXISTS video_tags_gin_idx ON video USING GIN (tags);
