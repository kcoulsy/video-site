export interface CommentUser {
  id: string;
  name: string;
  image: string | null;
}

export interface Comment {
  id: string;
  content: string;
  user: CommentUser;
  parentId: string | null;
  depth: number;
  replyCount: number;
  likeCount: number;
  liked: boolean;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface CommentsPage {
  comments: Comment[];
  nextCursor: string | null;
  hasMore: boolean;
}
