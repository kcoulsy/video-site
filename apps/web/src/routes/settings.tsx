import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { env } from "@video-site/env/web";
import { Button } from "@video-site/ui/components/button";
import { Input } from "@video-site/ui/components/input";
import { Label } from "@video-site/ui/components/label";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { getUser } from "@/functions/get-user";
import { ApiError, apiClient } from "@/lib/api-client";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Watchbox" }] }),
  beforeLoad: async () => {
    const session = await getUser();
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
});

interface MeResponse {
  id: string;
  name: string;
  handle: string | null;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
}

function abs(path: string | null): string | null {
  if (!path) return null;
  return `${env.VITE_SERVER_URL}${path}`;
}

function SettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ["profile", "me"],
    queryFn: () => apiClient<MeResponse>("/api/profile/me"),
  });

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [imgVersion, setImgVersion] = useState(0);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (data) {
      setName(data.name);
      setHandle(data.handle ?? "");
      setBio(data.bio ?? "");
    }
  }, [data]);

  const saveProfile = useMutation({
    mutationFn: async (payload: { name: string; handle: string; bio: string }) => {
      return apiClient("/api/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: payload.name,
          handle: payload.handle || undefined,
          bio: payload.bio,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Profile saved");
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.code === "HANDLE_TAKEN"
          ? "That handle is already taken"
          : err instanceof Error
            ? err.message
            : "Failed to save";
      toast.error(msg);
    },
  });

  const uploadImage = useMutation({
    mutationFn: async ({ kind, file }: { kind: "avatar" | "banner"; file: File }) => {
      const fd = new FormData();
      fd.append("image", file);
      return apiClient(`/api/profile/me/${kind}`, { method: "POST", body: fd });
    },
    onSuccess: () => {
      toast.success("Image uploaded");
      setImgVersion((v) => v + 1);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Upload failed"),
  });

  if (isLoading || !data) {
    return <div className="mx-auto max-w-2xl px-4 py-8">Loading…</div>;
  }

  const avatarSrc = abs(data.avatarUrl) ? `${abs(data.avatarUrl)}?v=${imgVersion}` : null;
  const bannerSrc = abs(data.bannerUrl) ? `${abs(data.bannerUrl)}?v=${imgVersion}` : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-medium">Banner</h2>
        <div className="relative aspect-[4/1] w-full overflow-hidden rounded-lg bg-secondary">
          {bannerSrc ? (
            <img src={bannerSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              No banner
            </div>
          )}
        </div>
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadImage.mutate({ kind: "banner", file: f });
            e.target.value = "";
          }}
        />
        <Button variant="secondary" onClick={() => bannerInputRef.current?.click()}>
          Upload banner
        </Button>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-medium">Avatar</h2>
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-secondary">
            {avatarSrc ? (
              <img src={avatarSrc} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-muted-foreground">
                {data.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadImage.mutate({ kind: "avatar", file: f });
              e.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => avatarInputRef.current?.click()}>
            Upload avatar
          </Button>
        </div>
      </section>

      <section className="mt-8 space-y-4">
        <h2 className="text-lg font-medium">Profile</h2>

        <div className="space-y-2">
          <Label htmlFor="name">Display name</Label>
          <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="handle">Handle</Label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-muted-foreground">@</span>
            <Input
              id="handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="your_handle"
              maxLength={30}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            3-30 chars. Lowercase letters, numbers, underscore.
            {data.handle && (
              <>
                {" "}
                Profile:{" "}
                <Link
                  to="/u/$handle"
                  params={{ handle: data.handle }}
                  className="underline hover:text-foreground"
                >
                  /u/{data.handle}
                </Link>
              </>
            )}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Bio</Label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            rows={4}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">{bio.length}/500</p>
        </div>

        <Button
          onClick={() => saveProfile.mutate({ name, handle, bio })}
          disabled={saveProfile.isPending}
        >
          {saveProfile.isPending ? "Saving…" : "Save"}
        </Button>
      </section>
    </div>
  );
}
