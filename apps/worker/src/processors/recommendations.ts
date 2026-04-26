import { db } from "@video-site/db";
import { env } from "@video-site/env/worker";
import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import IORedis from "ioredis";

import type { RecsJobData } from "../types";

const TRENDING_KEY = "trending:global";
const TRENDING_TTL_SECONDS = 60 * 90;

let trendingRedis: IORedis | null = null;
function getTrendingRedis(): IORedis {
  if (!trendingRedis) trendingRedis = new IORedis(env.REDIS_URL);
  return trendingRedis;
}

const SIM_LOOKBACK_DAYS = 90;
const SIM_MIN_COOCCURRENCE = 2;
const SIM_MIN_SCORE = 0.05;
const SIM_TOP_PER_VIDEO = 50;
const TRENDING_LIMIT = 500;

const USER_SIM_MIN_OVERLAP = 3;
const USER_SIM_MIN_SCORE = 0.05;
const USER_SIM_TOP_NEIGHBORS = 50;
const USER_RECS_TOP = 200;
const USER_RECS_MIN_INTERACTIONS = 3;

// Cap each actor's contribution before pairwise self-joins. Without this, a
// single power user with thousands of interactions makes the pairs CTE blow up
// quadratically.
const MAX_INTERACTIONS_PER_ACTOR = 300;

export async function processRecsBuildSimilarity(_job: Job<RecsJobData>) {
  const startedAt = Date.now();

  await db.execute(sql`
    WITH actor_affinity AS (
      SELECT 'u:' || ve.user_id AS actor, ve.video_id, 1.0::real AS w
      FROM view_event ve
      JOIN video v ON v.id = ve.video_id
      WHERE ve.user_id IS NOT NULL
        AND ve.viewed_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'

      UNION ALL

      SELECT 's:' || ve.session_id AS actor, ve.video_id, 1.0::real AS w
      FROM view_event ve
      JOIN video v ON v.id = ve.video_id
      WHERE ve.user_id IS NULL AND ve.session_id IS NOT NULL
        AND ve.viewed_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'

      UNION ALL

      SELECT 'u:' || wh.user_id AS actor, wh.video_id,
        CASE
          WHEN wh.progress_percent >= 0.85 THEN 1.0
          WHEN wh.progress_percent >= 0.25 THEN 0.6
          WHEN wh.progress_percent < 0.10 AND wh.watched_seconds > 5 THEN -0.3
          ELSE 0.0
        END::real AS w
      FROM watch_history wh
      JOIN video v ON v.id = wh.video_id
      WHERE wh.last_watched_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'

      UNION ALL

      SELECT 'u:' || vl.user_id AS actor, vl.video_id,
        CASE WHEN vl.type = 'like' THEN 1.5 ELSE -2.0 END::real AS w
      FROM video_like vl
      JOIN video v ON v.id = vl.video_id
      WHERE v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'

      UNION ALL

      SELECT 'u:' || c.user_id AS actor, c.video_id, 0.8::real AS w
      FROM comment c
      JOIN video v ON v.id = c.video_id
      WHERE c.deleted_at IS NULL
        AND c.created_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'
    ),
    agg_raw AS (
      SELECT actor, video_id, SUM(w) AS w
      FROM actor_affinity
      GROUP BY actor, video_id
      HAVING SUM(w) > 0
    ),
    agg AS (
      SELECT actor, video_id, w FROM (
        SELECT actor, video_id, w,
          ROW_NUMBER() OVER (PARTITION BY actor ORDER BY w DESC) AS rn
        FROM agg_raw
      ) t
      WHERE rn <= ${sql.raw(String(MAX_INTERACTIONS_PER_ACTOR))}
    ),
    norms AS (
      SELECT video_id, SQRT(SUM(w * w)) AS norm
      FROM agg
      GROUP BY video_id
    ),
    pairs AS (
      SELECT a.video_id AS v1, b.video_id AS v2,
        SUM(a.w * b.w) AS num,
        COUNT(*) AS co
      FROM agg a
      JOIN agg b ON a.actor = b.actor AND a.video_id <> b.video_id
      GROUP BY a.video_id, b.video_id
      HAVING COUNT(*) >= ${sql.raw(String(SIM_MIN_COOCCURRENCE))}
    ),
    scored AS (
      SELECT p.v1, p.v2, (p.num / NULLIF(n1.norm * n2.norm, 0))::real AS score
      FROM pairs p
      JOIN norms n1 ON n1.video_id = p.v1
      JOIN norms n2 ON n2.video_id = p.v2
    ),
    ranked AS (
      SELECT v1, v2, score,
        ROW_NUMBER() OVER (PARTITION BY v1 ORDER BY score DESC) AS rn
      FROM scored
      WHERE score >= ${sql.raw(String(SIM_MIN_SCORE))}
    ),
    fresh AS (
      SELECT v1 AS video_id, v2 AS other_video_id, score, NOW() AS computed_at
      FROM ranked
      WHERE rn <= ${sql.raw(String(SIM_TOP_PER_VIDEO))}
    ),
    cleared AS (
      DELETE FROM video_similarity
      RETURNING 1
    )
    INSERT INTO video_similarity (video_id, other_video_id, score, computed_at)
    SELECT video_id, other_video_id, score, computed_at FROM fresh;
  `);

  const result = (await db.execute(sql`SELECT COUNT(*)::int AS count FROM video_similarity`))
    .rows as Array<{ count: number }>;
  const count = result[0]?.count ?? 0;

  console.log(`[recs] item-item similarity rebuilt: ${count} rows in ${Date.now() - startedAt}ms`);
}

export async function processRecsBuildTrending(_job: Job<RecsJobData>) {
  const startedAt = Date.now();

  const rows = (
    await db.execute(sql`
    SELECT v.id AS id,
      COALESCE(SUM(CASE WHEN ve.viewed_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0)::int AS views_24h,
      COALESCE(SUM(CASE WHEN ve.viewed_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0)::int AS views_7d,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(v.published_at, v.created_at))) / 3600.0 AS age_hours
    FROM video v
    JOIN "user" u ON u.id = v.user_id
    LEFT JOIN view_event ve ON ve.video_id = v.id AND ve.viewed_at > NOW() - INTERVAL '7 days'
    WHERE v.status = 'ready'
      AND v.visibility = 'public'
      AND v.deleted_at IS NULL
      AND u.banned_at IS NULL
      AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
      AND COALESCE(v.published_at, v.created_at) > NOW() - INTERVAL '60 days'
    GROUP BY v.id, v.published_at, v.created_at
    HAVING COALESCE(SUM(CASE WHEN ve.viewed_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END), 0) > 0
    ORDER BY views_7d DESC
    LIMIT ${sql.raw(String(TRENDING_LIMIT * 2))}
  `)
  ).rows as Array<{
    id: string;
    views_24h: number;
    views_7d: number;
    age_hours: number;
  }>;

  const scored = rows
    .map((r) => {
      const recency = r.views_24h + r.views_7d / 7;
      const score = recency / Math.pow(Number(r.age_hours) + 2, 1.2);
      return { id: r.id, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TRENDING_LIMIT);

  const redis = getTrendingRedis();
  const stagingKey = `${TRENDING_KEY}:staging`;
  await redis.del(stagingKey);
  if (scored.length > 0) {
    const args: (string | number)[] = [];
    for (const s of scored) {
      args.push(s.score, s.id);
    }
    await redis.zadd(stagingKey, ...args);
    await redis.rename(stagingKey, TRENDING_KEY);
    await redis.expire(TRENDING_KEY, TRENDING_TTL_SECONDS);
  } else {
    await redis.del(TRENDING_KEY);
  }

  console.log(`[recs] trending rebuilt: ${scored.length} rows in ${Date.now() - startedAt}ms`);
}

export async function processRecsBuildUserCf(_job: Job<RecsJobData>) {
  const startedAt = Date.now();

  await db.transaction(async (tx) => {
    await tx.execute(sql`
    CREATE TEMP TABLE _user_affinity ON COMMIT DROP AS
    WITH raw AS (
      SELECT ve.user_id, ve.video_id, 1.0::real AS w
      FROM view_event ve
      JOIN video v ON v.id = ve.video_id
      WHERE ve.user_id IS NOT NULL
        AND ve.viewed_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'

      UNION ALL

      SELECT wh.user_id, wh.video_id,
        (CASE
          WHEN wh.progress_percent >= 0.85 THEN 1.0
          WHEN wh.progress_percent >= 0.25 THEN 0.6
          WHEN wh.progress_percent < 0.10 AND wh.watched_seconds > 5 THEN -0.3
          ELSE 0.0
        END)::real
      FROM watch_history wh
      JOIN video v ON v.id = wh.video_id
      WHERE wh.last_watched_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'

      UNION ALL

      SELECT vl.user_id, vl.video_id,
        (CASE WHEN vl.type = 'like' THEN 1.5 ELSE -2.0 END)::real
      FROM video_like vl
      JOIN video v ON v.id = vl.video_id
      WHERE v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'

      UNION ALL

      SELECT wl.user_id, wl.video_id, 1.2::real
      FROM watch_later wl
      JOIN video v ON v.id = wl.video_id
      WHERE v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'

      UNION ALL

      SELECT c.user_id, c.video_id, 0.8::real
      FROM comment c
      JOIN video v ON v.id = c.video_id
      WHERE c.deleted_at IS NULL
        AND c.created_at > NOW() - INTERVAL '${sql.raw(String(SIM_LOOKBACK_DAYS))} days'
        AND v.deleted_at IS NULL AND v.status = 'ready' AND v.visibility = 'public'
    )
    SELECT user_id, video_id, w FROM (
      SELECT user_id, video_id, SUM(w)::real AS w,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY SUM(w) DESC) AS rn
      FROM raw
      GROUP BY user_id, video_id
    ) t
    WHERE rn <= ${sql.raw(String(MAX_INTERACTIONS_PER_ACTOR))}
  `);

    await tx.execute(sql`CREATE INDEX ON _user_affinity (user_id)`);
    await tx.execute(sql`CREATE INDEX ON _user_affinity (video_id)`);

    await tx.execute(sql`
    CREATE TEMP TABLE _user_active ON COMMIT DROP AS
    SELECT user_id, COUNT(*) AS n_interactions, SQRT(SUM(w*w)) AS norm
    FROM _user_affinity
    WHERE w > 0
    GROUP BY user_id
    HAVING COUNT(*) >= ${sql.raw(String(USER_RECS_MIN_INTERACTIONS))}
  `);
    await tx.execute(sql`CREATE INDEX ON _user_active (user_id)`);

    await tx.execute(sql`
    WITH pairs AS (
      SELECT a.user_id AS u1, b.user_id AS u2,
        SUM(a.w * b.w) AS num,
        COUNT(*) AS overlap
      FROM _user_affinity a
      JOIN _user_affinity b
        ON a.video_id = b.video_id AND a.user_id <> b.user_id
      JOIN _user_active na ON na.user_id = a.user_id
      JOIN _user_active nb ON nb.user_id = b.user_id
      GROUP BY a.user_id, b.user_id
      HAVING COUNT(*) >= ${sql.raw(String(USER_SIM_MIN_OVERLAP))}
    ),
    scored AS (
      SELECT p.u1, p.u2,
        (p.num / NULLIF(n1.norm * n2.norm, 0))::real AS score
      FROM pairs p
      JOIN _user_active n1 ON n1.user_id = p.u1
      JOIN _user_active n2 ON n2.user_id = p.u2
    ),
    ranked AS (
      SELECT u1, u2, score,
        ROW_NUMBER() OVER (PARTITION BY u1 ORDER BY score DESC) AS rn
      FROM scored
      WHERE score >= ${sql.raw(String(USER_SIM_MIN_SCORE))}
    ),
    fresh AS (
      SELECT u1 AS user_id, u2 AS other_user_id, score, NOW() AS computed_at
      FROM ranked
      WHERE rn <= ${sql.raw(String(USER_SIM_TOP_NEIGHBORS))}
    ),
    cleared AS (DELETE FROM user_similarity RETURNING 1)
    INSERT INTO user_similarity (user_id, other_user_id, score, computed_at)
    SELECT user_id, other_user_id, score, computed_at FROM fresh
  `);

    await tx.execute(sql`
    WITH candidates AS (
      SELECT us.user_id AS target,
        a.video_id,
        SUM(us.score * a.w) / NULLIF(SUM(us.score), 0) AS pred
      FROM user_similarity us
      JOIN _user_affinity a ON a.user_id = us.other_user_id
      JOIN video v ON v.id = a.video_id
      JOIN "user" u ON u.id = v.user_id
      WHERE a.w > 0
        AND v.deleted_at IS NULL
        AND v.status = 'ready'
        AND v.visibility = 'public'
        AND u.banned_at IS NULL
        AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
        AND v.user_id <> us.user_id
        AND NOT EXISTS (
          SELECT 1 FROM _user_affinity seen
          WHERE seen.user_id = us.user_id
            AND seen.video_id = a.video_id
            AND seen.w > 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM watch_history wh
          WHERE wh.user_id = us.user_id
            AND wh.video_id = a.video_id
            AND wh.completed_at IS NOT NULL
        )
      GROUP BY us.user_id, a.video_id
    ),
    ranked AS (
      SELECT target, video_id, pred,
        ROW_NUMBER() OVER (PARTITION BY target ORDER BY pred DESC) AS rn
      FROM candidates
      WHERE pred > 0
    ),
    fresh AS (
      SELECT target AS user_id, video_id, pred::real AS score, NOW() AS computed_at
      FROM ranked
      WHERE rn <= ${sql.raw(String(USER_RECS_TOP))}
    ),
    cleared AS (DELETE FROM user_recs RETURNING 1)
    INSERT INTO user_recs (user_id, video_id, score, computed_at)
    SELECT user_id, video_id, score, computed_at FROM fresh
  `);
  });

  const simResult = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM user_similarity`))
    .rows as Array<{ n: number }>;
  const recsResult = (await db.execute(sql`SELECT COUNT(*)::int AS n FROM user_recs`))
    .rows as Array<{ n: number }>;

  console.log(
    `[recs] user-user CF rebuilt: ${simResult[0]?.n ?? 0} sims, ${recsResult[0]?.n ?? 0} recs in ${Date.now() - startedAt}ms`,
  );
}

export async function processGuestCleanup(_job: Job<RecsJobData>) {
  const result = await db.execute(sql`
    DELETE FROM view_event
    WHERE user_id IS NULL
      AND viewed_at < NOW() - INTERVAL '90 days'
  `);
  console.log(`[recs] purged old guest view events: ${result.rowCount ?? 0}`);
}
