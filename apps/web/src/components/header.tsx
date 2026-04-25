import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Film, Upload } from "lucide-react";
import { Button } from "@video-site/ui/components/button";

import { SearchBar } from "./search-bar";
import { UploadModal } from "./upload-modal";
import UserMenu from "./user-menu";

export default function Header() {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <header
        data-header
        className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl"
      >
        <div className="flex h-14 items-center gap-4 px-4">
          {/* Brand */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Film className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="hidden font-display text-xl italic tracking-tight sm:block">
              Watchbox
            </span>
          </Link>

          {/* Search */}
          <SearchBar />

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUploadOpen(true)}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
            <UserMenu />
          </div>
        </div>
      </header>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}
