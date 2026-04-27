import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./auth";

export const subscription = pgTable(
  "subscription",
  {
    subscriberId: text("subscriber_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.subscriberId, table.channelId] }),
    index("subscription_channel_idx").on(table.channelId),
    index("subscription_subscriber_created_idx").on(table.subscriberId, table.createdAt),
  ],
);
