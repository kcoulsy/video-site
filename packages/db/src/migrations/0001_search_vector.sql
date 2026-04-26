-- Enable the pg_trgm extension for fuzzy/typo-tolerant matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Generated columns require an IMMUTABLE expression. Even
-- to_tsvector('english'::regconfig, ...) is treated as STABLE
-- when the planner can't prove the regconfig won't change, so we
-- wrap the whole expression in a SQL function explicitly marked
-- IMMUTABLE.
CREATE OR REPLACE FUNCTION video_search_vector(title text, description text, tags text[])
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT setweight(to_tsvector('pg_catalog.english', coalesce(title, '')), 'A') ||
         setweight(to_tsvector('pg_catalog.english', coalesce(description, '')), 'B') ||
         setweight(to_tsvector('pg_catalog.english', coalesce(array_to_string(tags, ' '), '')), 'C')
$$;

ALTER TABLE video ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (video_search_vector(title, description, tags)) STORED;

-- GIN index on the search vector for fast full-text queries
CREATE INDEX IF NOT EXISTS video_search_idx ON video USING GIN (search_vector);

-- Trigram GIN index on the title for fuzzy matching (typo tolerance)
CREATE INDEX IF NOT EXISTS video_title_trgm_idx ON video USING GIN (title gin_trgm_ops);
