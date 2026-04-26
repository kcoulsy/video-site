import { fileTypeFromBuffer, fileTypeFromFile } from "file-type";

const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
  "video/x-msvideo",
  "video/mpeg",
  "video/x-flv",
  "video/3gpp",
  "video/3gpp2",
]);

const ALLOWED_THUMBNAIL_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type DetectedType = { mime: string; ext: string };

export async function detectVideoFile(filePath: string): Promise<DetectedType> {
  const detected = await fileTypeFromFile(filePath);
  if (!detected || !ALLOWED_VIDEO_MIMES.has(detected.mime)) {
    throw new Error(
      `File content is not a recognized video format (detected: ${detected?.mime ?? "unknown"})`,
    );
  }
  return detected;
}

export async function detectThumbnailBuffer(buffer: Uint8Array): Promise<DetectedType> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_THUMBNAIL_MIMES.has(detected.mime)) {
    throw new Error(
      `File content is not a recognized image format (detected: ${detected?.mime ?? "unknown"})`,
    );
  }
  return detected;
}
