# Phase 5: Comments System

## Overview

Implement a threaded/nested comment system with top-level comments on videos and reply chains underneath. Includes database schema, API endpoints with rate limiting, and a full frontend comment UI with optimistic updates.

## Prerequisites

- Phase 4 complete (video watch page exists at `/watch/:videoId`)

## Parallel Note

This phase is independent of Phase 6 (Likes & Watch History). They can be implemented in any order or in parallel after Phase 4.

---

## 1. Database Schema

### File: `packages/db/src/schema/comment.ts` (new)

```typescript
import { pgTable, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { video } from "./video";

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(), // nanoid
    content: text("content").notNull(),

    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    videoId: text("video_id")
      .notNull()
      .references(() => video.id, { onDelete: "cascade" }),

    // Threading: null = top-level, otherwise the parent comment's ID
    parentId: text("parent_id"),
    // Self-referential FK added via raw SQL migration since Drizzle
    // has limitations with self-referencing in the same pgTable call.
    // Alternative: .references((): any => comment.id, { onDelete: "cascade" })

    // Nesting depth: 0 = top-level, 1 = reply, 2 = reply-to-reply, max 3
    depth: integer("depth").default(0).notNull(),

    // Denormalized counts
    replyCount: integer("reply_count").default(0).notNull(),
    likeCount: integer("like_count").default(0).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    editedAt: timestamp("edited_at"), // set when comment is edited
    deletedAt: timestamp("deleted_at"), // set on soft-delete (comments with replies)
  },
  (table) => [
    index("comment_video_id_idx").on(table.videoId),
    index("comment_parent_id_idx").on(table.parentId),
    index("comment_user_id_idx").on(table.userId),
    index("comment_video_id_created_at_idx").on(table.videoId, table.createdAt),
  ],
);
```

### File: `packages/db/src/schema/relations.ts` (modify)

Add comment relations:

```typescript
import { comment } from "./comment";

export const commentRelations = relations(comment, ({ one, many }) => ({
  user: one(user, {
    fields: [comment.userId],
    references: [user.id],
  }),
  video: one(video, {
    fields: [comment.videoId],
    references: [video.id],
  }),
  parent: one(comment, {
    fields: [comment.parentId],
    references: [comment.id],
    relationName: "commentReplies",
  }),
  replies: many(comment, {
    relationName: "commentReplies",
  }),
}));
```

Update existing relations:

```typescript
// In userRelations, add:
comments: many(comment),

// In videoRelations, add:
comments: many(comment),
```

### File: `packages/db/src/schema/index.ts` (modify)

Add: `export * from "./comment";`

---

## 2. API Endpoints

### File: `apps/server/src/routes/comment.ts` (new)

Mount comment routes. These are nested under video routes for context.

### `GET /api/videos/:videoId/comments`

List top-level comments for a video.

**Query params**:

- `cursor`: cursor for pagination (comment ID of the last item on previous page)
- `limit`: number of comments per page (default 20, max 50)
- `sort`: "newest" (default) | "oldest"

**Response**:

```json
{
  "comments": [
    {
      "id": "abc123",
      "content": "Great video!",
      "user": { "id": "...", "name": "John", "image": "..." },
      "parentId": null,
      "depth": 0,
      "replyCount": 3,
      "likeCount": 5,
      "createdAt": "2026-04-24T...",
      "editedAt": null
    }
  ],
  "nextCursor": "def456",
  "hasMore": true
}
```

**Query implementation**:

```typescript
// Cursor-based pagination
const where = [
  eq(commentTable.videoId, videoId),
  isNull(commentTable.parentId), // top-level only
];

if (cursor) {
  // For "newest" sort: get comments older than cursor
  const cursorComment = await db.query.comment.findFirst({
    where: eq(commentTable.id, cursor),
  });
  if (cursorComment) {
    where.push(lt(commentTable.createdAt, cursorComment.createdAt));
  }
}

const comments = await db.query.comment.findMany({
  where: and(...where),
  orderBy: sort === "oldest" ? asc(commentTable.createdAt) : desc(commentTable.createdAt),
  limit: limit + 1, // fetch one extra to determine hasMore
  with: {
    user: { columns: { id: true, name: true, image: true } },
  },
});

const hasMore = comments.length > limit;
if (hasMore) comments.pop();
```

### `GET /api/videos/:videoId/comments/:id/replies`

List replies to a specific comment. Same pagination pattern as top-level, but filtered by `parentId`.

**Note**: Replies are always sorted by "oldest" (chronological conversation order).

### `POST /api/videos/:videoId/comments` (auth required)

Create a top-level comment.

**Request body**:

```json
{
  "content": "This is my comment"
}
```

**Validation**:

- `content`: required, 1-2000 characters, trimmed
- Strip HTML tags (prevent XSS)
- Rate limit: max 10 comments per minute per user

**Implementation**:

```typescript
// Rate limiting via Redis — use a pipeline to atomically INCR + EXPIRE
// (avoids race where INCR succeeds but EXPIRE fails, leaving key without TTL)
const redis = getRedisClient();
const key = `comment-rate:${user.id}`;
const [[, count]] = await redis.multi().incr(key).expire(key, 60).exec();
if ((count as number) > 10) return c.json({ error: "Rate limit exceeded" }, 429);

// Create comment and update count atomically
const id = generateId();
await db.transaction(async (tx) => {
  await tx.insert(commentTable).values({
    id,
    content: body.content.trim(),
    userId: user.id,
    videoId,
    parentId: null,
    depth: 0,
  });

  await tx
    .update(videoTable)
    .set({ commentCount: sql`${videoTable.commentCount} + 1` })
    .where(eq(videoTable.id, videoId));
});
```

### `POST /api/videos/:videoId/comments/:id/replies` (auth required)

Reply to an existing comment.

**Request body**: Same as top-level comment.

**Additional validation**:

- Parent comment must exist and belong to the same video
- Depth limit: if parent's depth >= 3, the reply is created at depth 3 (flattened)
  - In the UI, these deep replies show "@parentUsername" as a mention prefix

**Implementation**:

```typescript
const parent = await db.query.comment.findFirst({
  where: and(eq(commentTable.id, parentId), eq(commentTable.videoId, videoId)),
});
if (!parent) return c.json({ error: "Parent comment not found" }, 404);

const depth = Math.min(parent.depth + 1, 3);

// Wrap in transaction to keep counts consistent
await db.transaction(async (tx) => {
  await tx.insert(commentTable).values({
    id: generateId(),
    content: body.content.trim(),
    userId: user.id,
    videoId,
    parentId,
    depth,
  });

  // Update parent reply count
  await tx
    .update(commentTable)
    .set({ replyCount: sql`${commentTable.replyCount} + 1` })
    .where(eq(commentTable.id, parentId));

  // Update video comment count
  await tx
    .update(videoTable)
    .set({ commentCount: sql`${videoTable.commentCount} + 1` })
    .where(eq(videoTable.id, videoId));
});
```

### `PATCH /api/comments/:id` (auth, owner only)

Edit a comment. Only the owner can edit.

**Request body**:

```json
{
  "content": "Updated comment text"
}
```

**Implementation**:

- Verify `userId` matches authenticated user
- Update `content` and set `editedAt = new Date()`
- Same content validation as create (1-2000 chars, sanitize)

### `DELETE /api/comments/:id` (auth, owner only)

Delete a comment.

**Deletion strategy**:

- **If the comment has replies** (`replyCount > 0`): Soft-delete — replace `content` with `"[deleted]"` and set `deletedAt = new Date()`. Keep `userId` intact (it is `NOT NULL`). The comment skeleton remains to preserve the thread structure. The frontend checks for `deletedAt` to show the greyed-out placeholder.
- **If the comment has no replies**: Hard-delete — remove the row entirely.

**In both cases**:

- Decrement the video's `commentCount`
- If the comment has a parent, decrement the parent's `replyCount`

---

## 3. Content Handling

Comments are plain text — no rich text, no HTML. On the frontend, render comment content as plain text (NOT `dangerouslySetInnerHTML`). Use CSS `white-space: pre-wrap` to preserve line breaks.

React auto-escapes all text rendered via JSX, so even if a user types `<script>alert(1)</script>` it renders as literal text. No server-side sanitization is needed beyond `.trim()` and length validation. Do NOT strip HTML tags or transform content — just store the raw text.

---

## 4. Frontend Components

### File: `apps/web/src/components/comments/comment-section.tsx` (new)

The main comments container, placed on the watch page below the video info.

**Structure**:

```
+-----------------------------------------+
| 123 Comments     [Sort: Newest v]       |
+-----------------------------------------+
| [Your avatar] [Comment input...]        |  <- only if authenticated
+-----------------------------------------+
| CommentList (top-level comments)        |
|   CommentItem                           |
|     CommentItem (reply)                 |
|       CommentItem (nested reply)        |
|   CommentItem                           |
|   [Load more comments]                  |
+-----------------------------------------+
```

Props:

```typescript
interface CommentSectionProps {
  videoId: string;
  commentCount: number;
}
```

State:

- `sort`: "newest" | "oldest"
- React Query infinite query for comments with cursor pagination

If the user is not authenticated, show: "Sign in to comment" with a link to `/login`.

### File: `apps/web/src/components/comments/comment-item.tsx` (new)

A single comment with all its interactive elements.

**Layout**:

```
+------------------------------------------+
| [Avatar] Username · 3 days ago (edited)  |
|          Comment content text here...    |
|          [Reply] [Like 5]               |
|          [Edit] [Delete] (if owner)     |
+------------------------------------------+
| (indented replies)                       |
|   [Avatar] Username · 2 days ago        |
|            Reply content...             |
|            [Reply] [Like 2]             |
+------------------------------------------+
| [View 3 more replies]                    |
+------------------------------------------+
```

Props:

```typescript
interface CommentItemProps {
  comment: Comment;
  videoId: string;
  depth: number;
  currentUserId?: string;
}
```

Behaviors:

- **Reply button**: Toggles a `CommentForm` inline below the comment
- **Edit button** (owner only): Replaces content with an editable `CommentForm`, pre-filled
- **Delete button** (owner only): Confirmation dialog, then delete
- **"View N replies" toggle**: Lazily fetches replies via `GET /api/videos/:videoId/comments/:id/replies`
- **Indentation**: Apply `pl-8` (32px) per depth level. Max visual indentation at depth 3.
- **"(edited)" indicator**: Shown next to timestamp if `editedAt` is set
- **Deleted comment display**: If `deletedAt` is set, show greyed out "[deleted]" placeholder text, no edit/delete/reply buttons

### File: `apps/web/src/components/comments/comment-form.tsx` (new)

Reusable form for creating comments and replies, and editing existing comments.

**Layout**:

```
+------------------------------------------+
| [Auto-growing textarea             ]    |
| 0/2000              [Cancel] [Submit]    |
+------------------------------------------+
```

Props:

```typescript
interface CommentFormProps {
  videoId: string;
  parentId?: string; // set for replies
  initialContent?: string; // set for editing
  onSubmit: () => void; // callback after successful submit
  onCancel?: () => void; // callback for cancel button
  placeholder?: string; // e.g., "Add a comment..." or "Reply to @username..."
}
```

Implementation:

- Use TanStack Form for validation
- Auto-growing `<textarea>`: set `rows=1`, use `onInput` to adjust height via `scrollHeight`
- Character count displayed (e.g., "0/2000")
- Submit disabled when empty or over limit
- On submit, call the appropriate API (POST create, POST reply, or PATCH edit)
- **Optimistic update**: Use React Query's `useMutation` with `onMutate` to immediately add the comment to the cache, then `onError` to roll back

### File: `apps/web/src/components/comments/comment-list.tsx` (new)

Renders a list of `CommentItem` components.

Props:

```typescript
interface CommentListProps {
  videoId: string;
  parentId?: string; // null for top-level, set for replies
  sort?: "newest" | "oldest";
}
```

Implementation:

- Uses `useInfiniteQuery` for cursor-based pagination
- "Load more" button at the bottom (not infinite scroll — comments are secondary content)
- Loading skeleton while fetching
- For replies (parentId set): always sort by "oldest" for conversation flow

---

## 5. Watch Page Integration

### File: `apps/web/src/routes/watch.$videoId.tsx` (modify)

Add the `CommentSection` component below the video information:

```typescript
<VideoPlayer manifestUrl={video.streamUrl} />
<VideoInfo video={video} />
<CommentSection
  videoId={video.id}
  commentCount={video.commentCount}
/>
```

---

## 6. Optimistic Update Pattern

For comment creation, use React Query's mutation with optimistic updates:

```typescript
const queryClient = useQueryClient();

const createComment = useMutation({
  mutationFn: (data: { content: string }) =>
    apiClient(`/api/videos/${videoId}/comments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  onMutate: async (newComment) => {
    // Cancel outgoing refetches
    await queryClient.cancelQueries({ queryKey: ["comments", videoId] });

    // Snapshot previous value
    const previous = queryClient.getQueryData(["comments", videoId]);

    // Optimistically add the new comment
    queryClient.setQueryData(["comments", videoId], (old) => ({
      ...old,
      pages: [
        {
          comments: [
            {
              id: `temp-${Date.now()}`,
              content: newComment.content,
              user: currentUser,
              createdAt: new Date().toISOString(),
              replyCount: 0,
              likeCount: 0,
              depth: 0,
            },
            ...(old?.pages[0]?.comments ?? []),
          ],
        },
        ...(old?.pages?.slice(1) ?? []),
      ],
    }));

    return { previous };
  },
  onError: (err, newComment, context) => {
    // Roll back on error
    queryClient.setQueryData(["comments", videoId], context?.previous);
    toast.error("Failed to post comment");
  },
  onSettled: () => {
    // Refetch to sync with server
    queryClient.invalidateQueries({ queryKey: ["comments", videoId] });
  },
});
```

---

## Verification Checklist

1. Post a top-level comment -> appears immediately below the video
2. Reply to a comment -> reply appears nested under the parent
3. "View N replies" toggle loads replies lazily
4. Reply depth is capped at 3 — deeper replies flatten to depth 3
5. Edit own comment -> content updates, "(edited)" appears
6. Delete comment with no replies -> comment removed entirely
7. Delete comment with replies -> content replaced with "[deleted]", thread preserved
8. Rate limiting: posting > 10 comments per minute returns 429
9. Content validation: empty, over 2000 chars, HTML tags stripped
10. Comment count on video updates correctly on create/delete
11. Reply count on parent comment updates correctly
12. Unauthenticated users see "Sign in to comment" prompt
13. Unauthenticated users can still read comments
14. Cursor pagination works: "Load more" fetches the next page
15. Sort by newest/oldest works for top-level comments

---

## Files Summary

| Action | File                                                          |
| ------ | ------------------------------------------------------------- |
| Create | `packages/db/src/schema/comment.ts`                           |
| Create | `apps/server/src/routes/comment.ts`                           |
| Create | `apps/web/src/components/comments/comment-section.tsx`        |
| Create | `apps/web/src/components/comments/comment-item.tsx`           |
| Create | `apps/web/src/components/comments/comment-form.tsx`           |
| Create | `apps/web/src/components/comments/comment-list.tsx`           |
| Modify | `packages/db/src/schema/relations.ts` (add comment relations) |
| Modify | `packages/db/src/schema/index.ts` (add export)                |
| Modify | `apps/server/src/index.ts` (mount comment routes)             |
| Modify | `apps/web/src/routes/watch.$videoId.tsx` (add CommentSection) |

## Dependencies to Install

None — all dependencies are already available from prior phases.
