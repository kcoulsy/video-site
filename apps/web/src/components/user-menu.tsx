import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@video-site/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@video-site/ui/components/dropdown-menu";
import { Skeleton } from "@video-site/ui/components/skeleton";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <Skeleton className="h-9 w-24" />;
  }

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline">Sign In</Button>
      </Link>
    );
  }

  const handle = (session.user as { handle?: string | null }).handle ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="bg-card">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="sm:hidden"
            onClick={() => navigate({ to: "/upload" })}
          >
            Upload
          </DropdownMenuItem>
          {handle && (
            <DropdownMenuItem onClick={() => navigate({ to: "/u/$handle", params: { handle } })}>
              My Profile
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => navigate({ to: "/dashboard" })}>
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/history" })}>History</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/watch-later" })}>
            Watch Later
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/subscriptions" })}>
            Subscriptions
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/playlists/mine" })}>
            Playlists
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
            Settings
          </DropdownMenuItem>
          {(session.user as { role?: string }).role === "admin" && (
            <DropdownMenuItem onClick={() => navigate({ to: "/admin" })}>Admin</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem>{session.user.email}</DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    navigate({
                      to: "/",
                    });
                  },
                },
              });
            }}
          >
            Sign Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
