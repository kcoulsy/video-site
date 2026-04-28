-- Trigram GIN indexes for tag and category names so the search
-- autosuggest endpoint (apps/server/src/routes/search.ts) can use
-- index-backed similarity() instead of sequential scans.
CREATE INDEX IF NOT EXISTS tag_name_trgm_idx ON tag USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS category_name_trgm_idx ON category USING GIN (name gin_trgm_ops);
