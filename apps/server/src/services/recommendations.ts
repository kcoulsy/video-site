import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { hiddenVideo } from "@video-site/db/schema/hidden-video";
import { userRecs, videoSimilarity } from "@video-site/db/schema/recommendations";
import { video } from "@video-site/db/schema/video";
import { watchHistory } from "@video-site/db/schema/watch-history";
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";

import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { getRedisClient } from "../lib/redis";

export const TRENDING_KEY = "trending:global";
const TRENDING_COUNT_KEY = "trending:count";
const TRENDING_COUNT_TTL_SECONDS = 60;
const HOME_FEED_CACHE_TTL_SECONDS = 30;
const homeFeedCacheKey = (userId: string, limit: number) => `home:${userId}:${limit}`;

// ---------- ranking constants ----------

const FRESHNESS_HALF_LIFE_DAYS = 30;
const MMR_LAMBDA = 0.6;

// Item-CF candidate gathering for the home feed.
const ITEM_CF_SEED_COUNT = 8;
const ITEM_CF_PER_SEED = 12;
// Most-recent seed weighs 1.0; oldest seed weighs ~0.5. Smooths recency without dropping older taste.
const ITEM_CF_OLDEST_SEED_WEIGHT = 0.5;
// Seed selection threshold for "watched enough to count as a positive signal".
const SEED_PROGRESS_MIN = 0.5;

// Continue-watching window: 5–90% progress, no completion.
const CONTINUE_PROGRESS_MIN = 0.05;
const CONTINUE_PROGRESS_MAX = 0.9;

// Home feed candidate sourcing.
const HOME_CANDIDATE_OVERFETCH = 5;
const HOME_FRESH_ITEM_CF_WEIGHT = 0.7; // applied to item-CF-only candidates
const HOME_USER_CF_OVERLAP_BONUS = 0.3; // bonus added when a user-CF candidate also appears in item-CF

// getRelated overfetches similarity rows in case moderation filters drop some.
const RELATED_SIM_OVERFETCH = 6;

// Related-video content scoring weights. CF (co-watch) is the strongest signal
// when present; content (tags/title/author) keeps new videos from falling
// through to trending and shapes the list when CF is thin.
const RELATED_CF_WEIGHT = 0.7;
const RELATED_CONTENT_WEIGHT = 0.3;
const RELATED_SAME_AUTHOR_BONUS = 0.15;
const RELATED_TITLE_WEIGHT = 0.4; // relative to tag jaccard inside the content score

// How many tag-matched content candidates to pull when CF is sparse or to
// blend with CF results.
const RELATED_CONTENT_CANDIDATES = 80;

// Personalization (viewer-aware): small bonuses so the up-next list still
// feels like it belongs to the *current* video, not the home feed.
const RELATED_VIEWER_AUTHOR_BONUS = 0.1;
const RELATED_VIEWER_TAG_BONUS = 0.15;

// Trending fetch overfetch — pull extra in case excluded ids cluster at the top.
const TRENDING_OVERFETCH_BUFFER = 20;

// "Not interested" soft penalty: when a video shares an author or any tag with
// something the user recently dismissed, multiply its score by this. Only the
// videos hidden within HIDDEN_PENALTY_WINDOW_DAYS contribute to the penalty
// signal, so the effect fades naturally.
const HIDDEN_PENALTY_MULTIPLIER = 0.4;
const HIDDEN_PENALTY_WINDOW_DAYS = 30;

// Home feed: continue-watching items merged into the top of the feed.
const HOME_CONTINUE_WATCHING_LIMIT = 8;
// Top N items of the home feed are shuffled so repeat visits feel fresh.
const HOME_SHUFFLE_TOP_N = 16;

// ---------- types ----------

type VideoCard = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  duration: number | null;
  viewCount: number;
  createdAt: Date;
  user: { id: string; name: string; image: string | null };
};

type ContinueWatchingCard = VideoCard & {
  progressPercent: number;
  watchedSeconds: number;
};

type CandidateRow = {
  id: string;
  title: string;
  thumbnailPath: string | null;
  thumbnailStillIndex: number | null;
  duration: number | null;
  viewCount: number;
  likeCount: number;
  dislikeCount: number;
  tags: string[] | null;
  createdAt: Date;
  userId: string;
  userName: string;
  userImage: string | null;
};

type HomeEntry = {
  row: CandidateRow;
  baseScore: number;
  fromUserCf: boolean;
};

function thumbnailUrlFor(
  videoId: string,
  thumbnailPath: string | null,
  stillIndex: number | null,
): string | null {
  if (!thumbnailPath) return null;
  const base = `/api/stream/${videoId}/thumbnail`;
  return stillIndex == null ? base : `${base}?v=${stillIndex}`;
}

function rowToCard(r: CandidateRow): VideoCard {
  return {
    id: r.id,
    title: r.title,
    thumbnailUrl: thumbnailUrlFor(r.id, r.thumbnailPath, r.thumbnailStillIndex),
    duration: r.duration,
    viewCount: r.viewCount,
    createdAt: r.createdAt,
    user: { id: r.userId, name: r.userName, image: r.userImage },
  };
}

const baseVideoSelect = {
  id: video.id,
  title: video.title,
  thumbnailPath: video.thumbnailPath,
  thumbnailStillIndex: video.thumbnailStillIndex,
  duration: video.duration,
  viewCount: video.viewCount,
  likeCount: video.likeCount,
  dislikeCount: video.dislikeCount,
  tags: video.tags,
  createdAt: video.createdAt,
  userId: video.userId,
  userName: user.name,
  userImage: user.image,
};

const publicReadyWhere = and(
  eq(video.status, "ready"),
  eq(video.visibility, "public"),
  visibleVideoWhere(),
  activeAuthorWhere(),
);

// ---------- ranking primitives ----------

function freshnessBoost(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

function qualityMultiplier(likes: number, dislikes: number): number {
  // Laplace-smoothed positivity. New videos with no votes hover near 0.5
  // and converge toward true ratio as votes accumulate.
  return (likes + 1) / (likes + dislikes + 2);
}

function tagJaccard(a: string[] | null, b: string[] | null): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  let intersect = 0;
  for (const t of b) if (setA.has(t)) intersect++;
  const union = setA.size + b.length - intersect;
  return union === 0 ? 0 : intersect / union;
}

function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  return new Set(tokens);
}

function tokenJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of b) if (a.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function mmrSimilarity(a: CandidateRow, b: CandidateRow): number {
  if (a.userId === b.userId) return 1;
  return tagJaccard(a.tags, b.tags);
}

interface HiddenSignals {
  hiddenIds: Set<string>;
  penalAuthors: Set<string>;
  penalTags: Set<string>;
}

const EMPTY_HIDDEN_SIGNALS: HiddenSignals = {
  hiddenIds: new Set(),
  penalAuthors: new Set(),
  penalTags: new Set(),
};

async function loadHiddenSignals(userId: string | null): Promise<HiddenSignals> {
  if (!userId) return EMPTY_HIDDEN_SIGNALS;

  const rows = await db
    .select({
      videoId: hiddenVideo.videoId,
      hiddenAt: hiddenVideo.hiddenAt,
      authorId: video.userId,
      tags: video.tags,
    })
    .from(hiddenVideo)
    .leftJoin(video, eq(video.id, hiddenVideo.videoId))
    .where(eq(hiddenVideo.userId, userId));

  if (rows.length === 0) return EMPTY_HIDDEN_SIGNALS;

  const hiddenIds = new Set<string>();
  const penalAuthors = new Set<string>();
  const penalTags = new Set<string>();
  const cutoff = Date.now() - HIDDEN_PENALTY_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  for (const r of rows) {
    hiddenIds.add(r.videoId);
    if (r.hiddenAt.getTime() < cutoff) continue;
    if (r.authorId) penalAuthors.add(r.authorId);
    if (r.tags) for (const t of r.tags) penalTags.add(t);
  }

  return { hiddenIds, penalAuthors, penalTags };
}

function hiddenPenalty(row: CandidateRow, signals: HiddenSignals): number {
  if (signals.penalAuthors.size === 0 && signals.penalTags.size === 0) return 1;
  if (signals.penalAuthors.has(row.userId)) return HIDDEN_PENALTY_MULTIPLIER;
  if (row.tags) {
    for (const t of row.tags) if (signals.penalTags.has(t)) return HIDDEN_PENALTY_MULTIPLIER;
  }
  return 1;
}

type ScoredCandidate = { row: CandidateRow; baseScore: number };

function mmrRerank(candidates: ScoredCandidate[], limit: number): CandidateRow[] {
  const remaining = [...candidates];
  const picked: CandidateRow[] = [];
  while (picked.length < limit && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      let maxSim = 0;
      for (const p of picked) {
        const s = mmrSimilarity(cand.row, p);
        if (s > maxSim) maxSim = s;
      }
      const mmr = MMR_LAMBDA * cand.baseScore - (1 - MMR_LAMBDA) * maxSim * cand.baseScore;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    picked.push(remaining[bestIdx]!.row);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}

// ---------- candidate gathering ----------

async function getUserSeedVideos(userId: string): Promise<string[]> {
  // Likes (source=0) ranked above high-progress watches (source=1); within each
  // source the most recent comes first. Single round trip via UNION ALL.
  const rows = (
    await db.execute(sql`
      SELECT video_id, source FROM (
        SELECT video_id, created_at AS sort_at, 0 AS source
        FROM video_like
        WHERE user_id = ${userId} AND type = 'like'
        UNION ALL
        SELECT video_id, last_watched_at AS sort_at, 1 AS source
        FROM watch_history
        WHERE user_id = ${userId} AND progress_percent > ${SEED_PROGRESS_MIN}
      ) t
      ORDER BY source ASC, sort_at DESC
    `)
  ).rows as Array<{ video_id: string; source: number }>;

  const seeds: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.video_id)) continue;
    seen.add(r.video_id);
    seeds.push(r.video_id);
    if (seeds.length >= ITEM_CF_SEED_COUNT) break;
  }
  return seeds;
}

async function getItemCfCandidates(userId: string): Promise<Map<string, number>> {
  const seeds = await getUserSeedVideos(userId);
  if (seeds.length === 0) return new Map();

  // Fetch top-N similar per seed via a windowed query so no single seed can starve
  // the others when results are merged.
  const sims = (
    await db.execute(sql`
      SELECT video_id, other_video_id, score
      FROM (
        SELECT video_id, other_video_id, score,
          ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY score DESC) AS rn
        FROM video_similarity
        WHERE video_id IN (${sql.join(
          seeds.map((s) => sql`${s}`),
          sql`, `,
        )})
      ) t
      WHERE rn <= ${ITEM_CF_PER_SEED}
    `)
  ).rows as Array<{ video_id: string; other_video_id: string; score: number }>;

  // Most recent seed weighs 1.0, oldest weighs ITEM_CF_OLDEST_SEED_WEIGHT, linear in between.
  const span = 1 - ITEM_CF_OLDEST_SEED_WEIGHT;
  const denom = Math.max(seeds.length - 1, 1);
  const seedWeight = new Map(seeds.map((id, i) => [id, 1 - (i / denom) * span]));

  const seedSet = new Set(seeds);
  const scores = new Map<string, number>();
  for (const s of sims) {
    if (seedSet.has(s.other_video_id)) continue;
    const weight = (seedWeight.get(s.video_id) ?? ITEM_CF_OLDEST_SEED_WEIGHT) * s.score;
    scores.set(s.other_video_id, (scores.get(s.other_video_id) ?? 0) + weight);
  }
  return scores;
}

// ---------- public API ----------

export async function getRelated(
  videoId: string,
  limit = 15,
  userId: string | null = null,
): Promise<VideoCard[]> {
  // Wave 1: everything we can fetch knowing only the videoId/userId. Pulling
  // the seeds and completed-watches up here means the viewer-signal block no
  // longer adds round trips after the candidate fetch.
  const [currentRows, sims, hiddenSignals, seeds, completed] = await Promise.all([
    db
      .select({
        id: video.id,
        title: video.title,
        tags: video.tags,
        userId: video.userId,
      })
      .from(video)
      .where(eq(video.id, videoId))
      .limit(1),
    db
      .select({
        otherVideoId: videoSimilarity.otherVideoId,
        score: videoSimilarity.score,
      })
      .from(videoSimilarity)
      .where(eq(videoSimilarity.videoId, videoId))
      .orderBy(desc(videoSimilarity.score))
      .limit(limit * RELATED_SIM_OVERFETCH),
    loadHiddenSignals(userId),
    userId ? getUserSeedVideos(userId) : Promise.resolve<string[]>([]),
    userId
      ? db
          .select({ videoId: watchHistory.videoId })
          .from(watchHistory)
          .where(and(eq(watchHistory.userId, userId), sql`${watchHistory.completedAt} IS NOT NULL`))
      : Promise.resolve<{ videoId: string }[]>([]),
  ]);
  const current = currentRows[0];
  if (!current) return getTrending(limit, [videoId], userId, hiddenSignals);

  const currentTitleTokens = titleTokens(current.title);
  const currentTags = current.tags ?? [];

  const cfScoreById = new Map(sims.map((s) => [s.otherVideoId, s.score]));
  const maxCfScore = sims.reduce((m, s) => (s.score > m ? s.score : m), 0);

  // Wave 2: candidate rows + seed metadata in parallel. Content candidates
  // share a tag with the current video; seedRows feeds viewer-personalization
  // signals.
  const [contentRows, seedRows] = await Promise.all([
    currentTags.length > 0
      ? db
          .select(baseVideoSelect)
          .from(video)
          .innerJoin(user, eq(user.id, video.userId))
          .where(
            and(
              publicReadyWhere,
              ne(video.id, videoId),
              sql`${video.tags} && ${currentTags}::text[]`,
            ),
          )
          .orderBy(desc(video.viewCount))
          .limit(RELATED_CONTENT_CANDIDATES)
      : Promise.resolve<CandidateRow[]>([]),
    seeds.length > 0
      ? db
          .select({ tags: video.tags, userId: video.userId })
          .from(video)
          .where(inArray(video.id, seeds))
      : Promise.resolve<{ tags: string[] | null; userId: string }[]>([]),
  ]);

  // Wave 3: pull rows for any CF candidate not already covered by content fetch.
  const haveIds = new Set(contentRows.map((r) => r.id));
  const cfMissingIds = [...cfScoreById.keys()].filter((id) => !haveIds.has(id));
  const cfRows =
    cfMissingIds.length > 0
      ? await db
          .select(baseVideoSelect)
          .from(video)
          .innerJoin(user, eq(user.id, video.userId))
          .where(and(publicReadyWhere, inArray(video.id, cfMissingIds), ne(video.id, videoId)))
      : [];

  const allRowsRaw: CandidateRow[] = [...contentRows, ...cfRows];
  const allRows: CandidateRow[] =
    hiddenSignals.hiddenIds.size > 0
      ? allRowsRaw.filter((r) => !hiddenSignals.hiddenIds.has(r.id))
      : allRowsRaw;
  if (allRows.length === 0) return getTrending(limit, [videoId], userId, hiddenSignals);

  // Viewer personalization signals derived from wave 1/2 results.
  const viewerAuthorIds = new Set<string>();
  const viewerTags = new Set<string>();
  for (const s of seedRows) {
    viewerAuthorIds.add(s.userId);
    for (const t of s.tags ?? []) viewerTags.add(t);
  }
  const viewerCompletedIds = new Set(completed.map((r) => r.videoId));

  const scored: ScoredCandidate[] = [];
  for (const r of allRows) {
    if (viewerCompletedIds.has(r.id)) continue;

    const cfScore = cfScoreById.get(r.id) ?? 0;
    const cfNorm = maxCfScore > 0 ? cfScore / maxCfScore : 0;

    const tagSim = tagJaccard(currentTags, r.tags);
    const titleSim = tokenJaccard(currentTitleTokens, titleTokens(r.title));
    const authorMatch = r.userId === current.userId ? 1 : 0;
    const contentSim =
      (tagSim + RELATED_TITLE_WEIGHT * titleSim) / (1 + RELATED_TITLE_WEIGHT) +
      RELATED_SAME_AUTHOR_BONUS * authorMatch;

    let base =
      (cfNorm > 0 ? RELATED_CF_WEIGHT * cfNorm + RELATED_CONTENT_WEIGHT * contentSim : contentSim) *
      qualityMultiplier(r.likeCount, r.dislikeCount) *
      freshnessBoost(r.createdAt);

    if (userId) {
      if (viewerAuthorIds.has(r.userId)) base += RELATED_VIEWER_AUTHOR_BONUS;
      if (r.tags && r.tags.some((t) => viewerTags.has(t))) base += RELATED_VIEWER_TAG_BONUS;
    }

    base *= hiddenPenalty(r, hiddenSignals);

    if (base > 0) scored.push({ row: r, baseScore: base });
  }

  if (scored.length === 0) return getTrending(limit, [videoId], userId, hiddenSignals);

  scored.sort((a, b) => b.baseScore - a.baseScore);
  const diversified = mmrRerank(scored, limit);

  if (diversified.length >= limit) return diversified.map(rowToCard);
  const fallback = await getTrending(
    limit - diversified.length,
    [videoId, ...diversified.map((r) => r.id)],
    userId,
    hiddenSignals,
  );
  return [...diversified.map(rowToCard), ...fallback];
}

export async function getTrending(
  limit: number,
  exclude: string[] = [],
  userId: string | null = null,
  hiddenSignals?: HiddenSignals,
): Promise<VideoCard[]> {
  return getTrendingPage(limit, 0, exclude, userId, hiddenSignals);
}

export async function getTrendingPage(
  limit: number,
  offset: number,
  exclude: string[] = [],
  userId: string | null = null,
  preloadedSignals?: HiddenSignals,
): Promise<VideoCard[]> {
  const hiddenSignals = preloadedSignals ?? (await loadHiddenSignals(userId));
  const effectiveExclude =
    hiddenSignals.hiddenIds.size > 0
      ? Array.from(new Set([...exclude, ...hiddenSignals.hiddenIds]))
      : exclude;

  const redis = getRedisClient();
  const ranked = await redis.zrevrange(
    TRENDING_KEY,
    0,
    offset + limit + effectiveExclude.length + TRENDING_OVERFETCH_BUFFER - 1,
  );

  if (ranked.length > 0) {
    const filtered = ranked
      .filter((id) => !effectiveExclude.includes(id))
      .slice(offset, offset + limit);
    if (filtered.length > 0) {
      const rows = await db
        .select(baseVideoSelect)
        .from(video)
        .innerJoin(user, eq(user.id, video.userId))
        .where(and(publicReadyWhere, inArray(video.id, filtered)));

      const order = new Map(filtered.map((id, i) => [id, i]));
      rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      if (rows.length >= limit) return rows.map(rowToCard);
    }
  }

  const where =
    effectiveExclude.length > 0
      ? and(publicReadyWhere, notInArray(video.id, effectiveExclude))
      : publicReadyWhere;

  const rows = await db
    .select(baseVideoSelect)
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(where)
    .orderBy(desc(video.viewCount), desc(video.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map(rowToCard);
}

export async function countTrendingCandidates(): Promise<number> {
  const redis = getRedisClient();
  const cached = await redis.get(TRENDING_COUNT_KEY);
  if (cached !== null) {
    const parsed = Number(cached);
    if (Number.isFinite(parsed)) return parsed;
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(publicReadyWhere);
  const count = rows[0]?.count ?? 0;
  await redis.set(TRENDING_COUNT_KEY, String(count), "EX", TRENDING_COUNT_TTL_SECONDS);
  return count;
}

export async function getContinueWatching(
  userId: string,
  limit = 10,
  preloadedSignals?: HiddenSignals,
): Promise<ContinueWatchingCard[]> {
  const hiddenSignals = preloadedSignals ?? (await loadHiddenSignals(userId));
  const conditions = [
    eq(watchHistory.userId, userId),
    sql`${watchHistory.progressPercent} BETWEEN ${CONTINUE_PROGRESS_MIN} AND ${CONTINUE_PROGRESS_MAX}`,
    isNull(watchHistory.completedAt),
    eq(video.status, "ready"),
    or(eq(video.visibility, "public"), eq(video.visibility, "unlisted")),
    visibleVideoWhere(),
    activeAuthorWhere(),
  ];
  if (hiddenSignals.hiddenIds.size > 0) {
    conditions.push(notInArray(video.id, [...hiddenSignals.hiddenIds]));
  }
  const rows = await db
    .select({
      ...baseVideoSelect,
      progressPercent: watchHistory.progressPercent,
      watchedSeconds: watchHistory.watchedSeconds,
      lastWatchedAt: watchHistory.lastWatchedAt,
    })
    .from(watchHistory)
    .innerJoin(video, eq(video.id, watchHistory.videoId))
    .innerJoin(user, eq(user.id, video.userId))
    .where(and(...conditions))
    .orderBy(desc(watchHistory.lastWatchedAt))
    .limit(limit);

  return rows.map((r) => ({
    ...rowToCard(r),
    progressPercent: r.progressPercent,
    watchedSeconds: r.watchedSeconds,
  }));
}

function shuffleTop<T>(arr: T[], n: number): T[] {
  const top = arr.slice(0, n);
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [top[i], top[j]] = [top[j]!, top[i]!];
  }
  return [...top, ...arr.slice(n)];
}

export async function getHomeFeed(userId: string | null, limit: number): Promise<VideoCard[]> {
  if (!userId) {
    // Overfetch then shuffle the top so guests see a fresh order on each refresh.
    const pool = await getTrending(Math.max(limit, HOME_SHUFFLE_TOP_N));
    return shuffleTop(pool, HOME_SHUFFLE_TOP_N).slice(0, limit);
  }

  const redis = getRedisClient();
  const cacheKey = homeFeedCacheKey(userId, limit);
  const cached = await redis.get(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached) as Array<Omit<VideoCard, "createdAt"> & { createdAt: string }>;
    const hydrated: VideoCard[] = parsed.map((c) => ({ ...c, createdAt: new Date(c.createdAt) }));
    return shuffleTop(hydrated, HOME_SHUFFLE_TOP_N);
  }

  const combined = await computeHomeFeed(userId, limit);
  await redis.set(cacheKey, JSON.stringify(combined), "EX", HOME_FEED_CACHE_TTL_SECONDS);
  return shuffleTop(combined, HOME_SHUFFLE_TOP_N);
}

async function computeHomeFeed(userId: string, limit: number): Promise<VideoCard[]> {
  const hiddenSignals = await loadHiddenSignals(userId);
  const hiddenIdList = [...hiddenSignals.hiddenIds];

  const targetCount = limit * HOME_CANDIDATE_OVERFETCH;

  const userCfWhere =
    hiddenIdList.length > 0
      ? and(eq(userRecs.userId, userId), publicReadyWhere, notInArray(video.id, hiddenIdList))
      : and(eq(userRecs.userId, userId), publicReadyWhere);

  const [continueWatching, userCfRows, itemCfScores] = await Promise.all([
    getContinueWatching(userId, HOME_CONTINUE_WATCHING_LIMIT, hiddenSignals),
    db
      .select({
        ...baseVideoSelect,
        cfScore: userRecs.score,
        completedAt: watchHistory.completedAt,
      })
      .from(userRecs)
      .innerJoin(video, eq(video.id, userRecs.videoId))
      .innerJoin(user, eq(user.id, video.userId))
      .leftJoin(
        watchHistory,
        and(eq(watchHistory.userId, userId), eq(watchHistory.videoId, video.id)),
      )
      .where(userCfWhere)
      .orderBy(desc(userRecs.score))
      .limit(targetCount),
    getItemCfCandidates(userId),
  ]);
  const cwIds = new Set(continueWatching.map((c) => c.id));

  const entries = new Map<string, HomeEntry>();

  for (const r of userCfRows) {
    if (r.completedAt) continue;
    if (cwIds.has(r.id)) continue;
    const base =
      r.cfScore *
      freshnessBoost(r.createdAt) *
      qualityMultiplier(r.likeCount, r.dislikeCount) *
      hiddenPenalty(r, hiddenSignals);
    const itemBonus = itemCfScores.get(r.id);
    const withBonus = itemBonus ? base + itemBonus * HOME_USER_CF_OVERLAP_BONUS : base;
    entries.set(r.id, { row: r, baseScore: withBonus, fromUserCf: true });
  }

  // Pull row data for item-CF candidates that user-CF didn't already provide.
  if (itemCfScores.size > 0) {
    const missingIds = [...itemCfScores.keys()].filter(
      (id) => !entries.has(id) && !hiddenSignals.hiddenIds.has(id),
    );
    if (missingIds.length > 0) {
      const missingRows = await db
        .select({ ...baseVideoSelect, completedAt: watchHistory.completedAt })
        .from(video)
        .innerJoin(user, eq(user.id, video.userId))
        .leftJoin(
          watchHistory,
          and(eq(watchHistory.userId, userId), eq(watchHistory.videoId, video.id)),
        )
        .where(and(publicReadyWhere, ne(video.userId, userId), inArray(video.id, missingIds)));

      for (const r of missingRows) {
        if (r.completedAt) continue;
        if (cwIds.has(r.id)) continue;
        const itemScore = itemCfScores.get(r.id) ?? 0;
        const base =
          itemScore *
          HOME_FRESH_ITEM_CF_WEIGHT *
          freshnessBoost(r.createdAt) *
          qualityMultiplier(r.likeCount, r.dislikeCount) *
          hiddenPenalty(r, hiddenSignals);
        const { completedAt: _ignored, ...rest } = r;
        void _ignored;
        entries.set(r.id, { row: rest, baseScore: base, fromUserCf: false });
      }
    }
  }

  const cwCards: VideoCard[] = continueWatching.map(
    ({ progressPercent: _p, watchedSeconds: _w, ...rest }) => {
      void _p;
      void _w;
      return rest;
    },
  );

  let recommended: VideoCard[];
  if (entries.size === 0) {
    recommended = await getTrending(limit, [...cwIds], userId, hiddenSignals);
  } else {
    const sorted = [...entries.values()].sort((a, b) => b.baseScore - a.baseScore);
    const diversified = mmrRerank(sorted, limit);
    recommended = diversified.map(rowToCard);
    if (recommended.length < limit) {
      const fallback = await getTrending(
        limit - recommended.length,
        [...cwIds, ...recommended.map((r) => r.id)],
        userId,
        hiddenSignals,
      );
      recommended = [...recommended, ...fallback];
    }
  }

  return [...cwCards, ...recommended].slice(0, limit);
}
