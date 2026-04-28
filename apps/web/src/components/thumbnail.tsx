// Renders a video thumbnail with width-descriptor srcset, leaving the format
// up to the server (it negotiates webp vs jpeg via the Accept header).
//
// `sizes` should match how the image is laid out in the page so the browser picks
// the right variant. Pass `eager` for the LCP image; everything else lazy-loads.

interface ThumbnailProps {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  eager?: boolean;
  decoding?: "sync" | "async" | "auto";
  draggable?: boolean;
}

const VARIANT_WIDTHS = [320, 640, 1280] as const;

function withWidth(url: string, w: number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}w=${w}`;
}

export function Thumbnail({
  src,
  alt,
  className,
  sizes = "(min-width: 1280px) 320px, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  eager = false,
  decoding = "async",
  draggable,
}: ThumbnailProps) {
  if (!src) return null;
  const srcSet = VARIANT_WIDTHS.map((w) => `${withWidth(src, w)} ${w}w`).join(", ");
  return (
    <img
      src={withWidth(src, 640)}
      srcSet={srcSet}
      sizes={sizes}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding={decoding}
      draggable={draggable}
    />
  );
}
