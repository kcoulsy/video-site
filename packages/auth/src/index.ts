import { createDb } from "@video-site/db";
import * as schema from "@video-site/db/schema/auth";
import { env } from "@video-site/env/server";
import { eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";

export type UserRole = "user" | "moderator" | "admin";

const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",

      schema: schema,
    }),
    trustedOrigins: [env.CORS_ORIGIN],
    emailAndPassword: {
      enabled: true,
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "user",
          input: false,
        },
        handle: {
          type: "string",
          required: true,
          input: true,
        },
        bio: {
          type: "string",
          required: false,
          input: false,
        },
        bannerPath: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            const u = userData as typeof userData & { handle?: string | null };
            const handle = (u.handle ?? "").toLowerCase();
            if (!HANDLE_RE.test(handle)) {
              throw new APIError("BAD_REQUEST", {
                message: "Handle must be 3-30 chars: lowercase letters, numbers, underscore",
              });
            }
            const [existing] = await db
              .select({ id: schema.user.id })
              .from(schema.user)
              .where(eq(schema.user.handle, handle))
              .limit(1);
            if (existing) {
              throw new APIError("BAD_REQUEST", { message: "Handle already taken" });
            }
            return { data: { ...userData, handle } };
          },
        },
      },
      session: {
        create: {
          before: async (sessionData) => {
            const [u] = await db
              .select({
                bannedAt: schema.user.bannedAt,
                suspendedUntil: schema.user.suspendedUntil,
              })
              .from(schema.user)
              .where(eq(schema.user.id, sessionData.userId))
              .limit(1);
            if (u?.bannedAt) {
              throw new APIError("FORBIDDEN", { message: "Account banned" });
            }
            if (u?.suspendedUntil && u.suspendedUntil > new Date()) {
              throw new APIError("FORBIDDEN", {
                message: `Account suspended until ${u.suspendedUntil.toISOString()}`,
              });
            }
            return { data: sessionData };
          },
        },
      },
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
        httpOnly: true,
      },
    },
    plugins: [],
  });
}

export const auth = createAuth();
