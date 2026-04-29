import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, EyeOff, Flag, ListPlus, MoreVertical, Share2 } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { apiClient } from "@/lib/api-client";
import { authClient } from "@/lib/auth-client";

import { ReportDialog } from "./report-dialog";
import { SaveToPlaylistContent } from "./save-to-playlist-content";
import { ShareDialog } from "./share-dialog";

interface Props {
  videoId: string;
  videoTitle: string;
}

const RECOMMENDATION_QUERY_KEYS = [
  ["recommendations", "feed"],
  ["recommendations", "trending"],
  ["recommendations", "continue-watching"],
  ["video-related"],
  ["related"],
] as const;

function invalidateRecommendations(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of RECOMMENDATION_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey: key });
  }
}

export function VideoCardMenu({ videoId, videoTitle }: Props) {
  const { data: session } = authClient.useSession();
  const isAuthed = !!session?.user;
  const queryClient = useQueryClient();

  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);

  const stop = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const saveWatchLater = useMutation({
    mutationFn: () =>
      apiClient<{ saved: boolean }>(`/api/watch-later/${videoId}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(["watch-later-status", videoId], { saved: true });
      queryClient.invalidateQueries({ queryKey: ["watch-later"] });
      toast.success("Saved to Watch Later");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    },
  });

  const undoNotInterested = async () => {
    try {
      await apiClient(`/api/hidden-videos/${videoId}`, { method: "DELETE" });
      invalidateRecommendations(queryClient);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to undo");
    }
  };

  const notInterested = useMutation({
    mutationFn: () => apiClient(`/api/hidden-videos/${videoId}`, { method: "POST" }),
    onSuccess: () => {
      invalidateRecommendations(queryClient);
      toast.success("Video hidden", {
        action: { label: "Undo", onClick: () => void undoNotInterested() },
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to hide video");
    },
  });

  const requireAuthOr = (run: () => void) => {
    if (!isAuthed) {
      toast.message("Sign in to use this");
      return;
    }
    run();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              onClick={stop}
              aria-label="More options"
              className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          }
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-56 bg-card p-1">
          <DropdownMenuItem
            onClick={(e) => {
              stop(e);
              requireAuthOr(() => saveWatchLater.mutate());
            }}
          >
            <Clock className="h-4 w-4" />
            Save to Watch Later
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={(e) => {
              stop(e);
              requireAuthOr(() => setPlaylistOpen(true));
            }}
          >
            <ListPlus className="h-4 w-4" />
            Save to playlist
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={(e) => {
              stop(e);
              setShareOpen(true);
            }}
          >
            <Share2 className="h-4 w-4" />
            Share
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={(e) => {
              stop(e);
              requireAuthOr(() => notInterested.mutate());
            }}
          >
            <EyeOff className="h-4 w-4" />
            Not interested
          </DropdownMenuItem>

          <DropdownMenuItem
            variant="destructive"
            onClick={(e) => {
              stop(e);
              requireAuthOr(() => setReportOpen(true));
            }}
          >
            <Flag className="h-4 w-4" />
            Report
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        videoId={videoId}
        title={videoTitle}
      />

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        targetType="video"
        targetId={videoId}
      />

      {playlistOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setPlaylistOpen(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-border bg-card p-3 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <SaveToPlaylistContent videoId={videoId} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
