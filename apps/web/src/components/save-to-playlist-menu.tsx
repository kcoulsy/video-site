import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";

import { SaveToPlaylistContent } from "./save-to-playlist-content";

interface SaveToPlaylistMenuProps {
  videoId: string;
  isAuthenticated: boolean;
}

export function SaveToPlaylistMenu({ videoId, isAuthenticated }: SaveToPlaylistMenuProps) {
  const handleClick = () => {
    if (!isAuthenticated) {
      toast.message("Sign in to save to playlists");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            size="sm"
            className="gap-1.5 rounded-full"
            onClick={handleClick}
          />
        }
      >
        <ListPlus className="h-4 w-4" />
        <span className="hidden sm:inline">Save</span>
      </DropdownMenuTrigger>
      {isAuthenticated && (
        <DropdownMenuContent className="w-64 bg-card p-2">
          <SaveToPlaylistContent videoId={videoId} />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
