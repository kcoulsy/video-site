-- Enable the pg_trgm extension for fuzzy/typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add a generated tsvector column to the video table
-- This column auto-updates whenever title, description, or tags change
ALTER TABLE video ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
  ) STORED;

-- GIN index on the search vector for fast full-text queries
CREATE INDEX IF NOT EXISTS video_search_idx ON video USING GIN (search_vector);

-- Trigram GIN index on the title for fuzzy matching (typo tolerance)
CREATE INDEX IF NOT EXISTS video_title_trgm_idx ON video USING GIN (title gin_trgm_ops);
