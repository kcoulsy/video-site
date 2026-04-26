import { db } from "@video-site/db";
import { user } from "@video-site/db/schema/auth";
import { videoLike } from "@video-site/db/schema/like";
import { userRecs, videoSimilarity } from "@video-site/db/schema/recommendations";
import { video } from "@video-site/db/schema/video";
import { watchHistory } from "@video-site/db/schema/watch-history";
import { and, desc, eq, gt, inArray, isNull, ne, notInArray, or, sql } from "drizzle-orm";

import { activeAuthorWhere, visibleVideoWhere } from "../lib/moderation-filters";
import { getRedisClient } from "../lib/redis";

export const TRENDING_KEY = "trending:global";

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

// Trending fetch overfetch — pull extra in case excluded ids cluster at the top.
const TRENDING_OVERFETCH_BUFFER = 20;

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

function mmrSimilarity(a: CandidateRow, b: CandidateRow): number {
  if (a.userId === b.userId) return 1;
  return tagJaccard(a.tags, b.tags);
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
  // User's most recent positive interactions: likes + high-progress watches.
  const seeds: string[] = [];

  const likes = await db
    .select({ videoId: videoLike.videoId, createdAt: videoLike.createdAt })
    .from(videoLike)
    .where(and(eq(videoLike.userId, userId), eq(videoLike.type, "like")))
    .orderBy(desc(videoLike.createdAt))
    .limit(ITEM_CF_SEED_COUNT);
  for (const l of likes) seeds.push(l.videoId);

  if (seeds.length < ITEM_CF_SEED_COUNT) {
    const watches = await db
      .select({ videoId: watchHistory.videoId })
      .from(watchHistory)
      .where(
        and(
          eq(watchHistory.userId, userId),
          gt(watchHistory.progressPercent, SEED_PROGRESS_MIN),
          seeds.length > 0 ? notInArray(watchHistory.videoId, seeds) : undefined,
        ),
      )
      .orderBy(desc(watchHistory.lastWatchedAt))
      .limit(ITEM_CF_SEED_COUNT - seeds.length);
    for (const w of watches) seeds.push(w.videoId);
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

export async function getRelated(videoId: string, limit = 15): Promise<VideoCard[]> {
  const sims = await db
    .select({
      otherVideoId: videoSimilarity.otherVideoId,
      score: videoSimilarity.score,
    })
    .from(videoSimilarity)
    .where(eq(videoSimilarity.videoId, videoId))
    .orderBy(desc(videoSimilarity.score))
    .limit(limit * RELATED_SIM_OVERFETCH);

  if (sims.length > 0) {
    const ids = sims.map((s) => s.otherVideoId);
    const scoreById = new Map(sims.map((s) => [s.otherVideoId, s.score]));
    const rows = await db
      .select(baseVideoSelect)
      .from(video)
      .innerJoin(user, eq(user.id, video.userId))
      .where(and(publicReadyWhere, inArray(video.id, ids), ne(video.id, videoId)));

    const scored: ScoredCandidate[] = rows.map((r) => ({
      row: r,
      baseScore:
        (scoreById.get(r.id) ?? 0) *
        qualityMultiplier(r.likeCount, r.dislikeCount) *
        freshnessBoost(r.createdAt),
    }));
    scored.sort((a, b) => b.baseScore - a.baseScore);
    const diversified = mmrRerank(scored, limit);

    if (diversified.length >= limit) return diversified.map(rowToCard);
    const fallback = await getTrending(limit - diversified.length, [
      videoId,
      ...diversified.map((r) => r.id),
    ]);
    return [...diversified.map(rowToCard), ...fallback];
  }

  return getTrending(limit, [videoId]);
}

export async function getTrending(limit: number, exclude: string[] = []): Promise<VideoCard[]> {
  const redis = getRedisClient();
  const ranked = await redis.zrevrange(
    TRENDING_KEY,
    0,
    limit + exclude.length + TRENDING_OVERFETCH_BUFFER - 1,
  );

  if (ranked.length > 0) {
    const filtered = ranked.filter((id) => !exclude.includes(id)).slice(0, limit);
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
    exclude.length > 0 ? and(publicReadyWhere, notInArray(video.id, exclude)) : publicReadyWhere;

  const rows = await db
    .select(baseVideoSelect)
    .from(video)
    .innerJoin(user, eq(user.id, video.userId))
    .where(where)
    .orderBy(desc(video.viewCount), desc(video.createdAt))
    .limit(limit);

  return rows.map(rowToCard);
}

export async function getContinueWatching(
  userId: string,
  limit = 10,
): Promise<ContinueWatchingCard[]> {
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
    .where(
      and(
        eq(watchHistory.userId, userId),
        sql`${watchHistory.progressPercent} BETWEEN ${CONTINUE_PROGRESS_MIN} AND ${CONTINUE_PROGRESS_MAX}`,
        isNull(watchHistory.completedAt),
        eq(video.status, "ready"),
        or(eq(video.visibility, "public"), eq(video.visibility, "unlisted")),
        visibleVideoWhere(),
        activeAuthorWhere(),
      ),
    )
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

  const targetCount = limit * HOME_CANDIDATE_OVERFETCH;

  const continueWatching = await getContinueWatching(userId, HOME_CONTINUE_WATCHING_LIMIT);
  const cwIds = new Set(continueWatching.map((c) => c.id));

  const userCfRows = await db
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
    .where(and(eq(userRecs.userId, userId), publicReadyWhere))
    .orderBy(desc(userRecs.score))
    .limit(targetCount);

  const itemCfScores = await getItemCfCandidates(userId);

  const entries = new Map<string, HomeEntry>();

  for (const r of userCfRows) {
    if (r.completedAt) continue;
    if (cwIds.has(r.id)) continue;
    const base =
      r.cfScore * freshnessBoost(r.createdAt) * qualityMultiplier(r.likeCount, r.dislikeCount);
    const itemBonus = itemCfScores.get(r.id);
    const withBonus = itemBonus ? base + itemBonus * HOME_USER_CF_OVERLAP_BONUS : base;
    entries.set(r.id, { row: r, baseScore: withBonus, fromUserCf: true });
  }

  // Pull row data for item-CF candidates that user-CF didn't already provide.
  if (itemCfScores.size > 0) {
    const missingIds = [...itemCfScores.keys()].filter((id) => !entries.has(id));
    if (missingIds.length > 0) {
      const missingRows = await db
        .select({ ...baseVideoSelect, completedAt: watchHistory.completedAt })
        .from(video)
        .innerJoin(user, eq(user.id, video.userId))
        .leftJoin(
          watchHistory,
          and(eq(watchHistory.userId, userId), eq(watchHistory.videoId, video.id)),
        )
        .where(
          and(publicReadyWhere, ne(video.userId, userId), inArray(video.id, missingIds)),
        );

      for (const r of missingRows) {
        if (r.completedAt) continue;
        if (cwIds.has(r.id)) continue;
        const itemScore = itemCfScores.get(r.id) ?? 0;
        const base =
          itemScore *
          HOME_FRESH_ITEM_CF_WEIGHT *
          freshnessBoost(r.createdAt) *
          qualityMultiplier(r.likeCount, r.dislikeCount);
        const { completedAt: _ignored, ...rest } = r;
        void _ignored;
        entries.set(r.id, { row: rest, baseScore: base, fromUserCf: false });
      }
    }
  }

  const cwCards: VideoCard[] = continueWatching.map(({ progressPercent: _p, watchedSeconds: _w, ...rest }) => {
    void _p;
    void _w;
    return rest;
  });

  let recommended: VideoCard[];
  if (entries.size === 0) {
    recommended = await getTrending(limit, [...cwIds]);
  } else {
    const sorted = [...entries.values()].sort((a, b) => b.baseScore - a.baseScore);
    const diversified = mmrRerank(sorted, limit);
    recommended = diversified.map(rowToCard);
    if (recommended.length < limit) {
      const fallback = await getTrending(limit - recommended.length, [
        ...cwIds,
        ...recommended.map((r) => r.id),
      ]);
      recommended = [...recommended, ...fallback];
    }
  }

  const combined = [...cwCards, ...recommended].slice(0, limit);
  return shuffleTop(combined, HOME_SHUFFLE_TOP_N);
}
