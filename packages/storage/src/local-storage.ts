import { copyFile, mkdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import type { StorageService } from "./index";

const VIDEOS_DIR = "videos";
const TEMP_DIR = "temp";
const TUS_DIR = "tus";
const RAW_DIR = "raw";
const TRANSCODED_DIR = "transcoded";
const THUMBNAILS_DIR = "thumbnails";
const USERS_DIR = "users";

const toForwardSlashes = (p: string) => p.replaceAll("\\", "/");

export function createLocalStorage(basePath: string): StorageService {
  if (!path.isAbsolute(basePath)) {
    throw new Error(
      `STORAGE_PATH must be an absolute path, got: ${basePath}`,
    );
  }

  const base = toForwardSlashes(path.resolve(basePath));

  const join = (...segments: string[]) =>
    toForwardSlashes(path.join(base, ...segments));

  const getVideoDir = (videoId: string) => join(VIDEOS_DIR, videoId);
  const getRawDir = (videoId: string) => join(VIDEOS_DIR, videoId, RAW_DIR);
  const getTranscodedDir = (videoId: string) =>
    join(VIDEOS_DIR, videoId, TRANSCODED_DIR);
  const getThumbnailDir = (videoId: string) =>
    join(VIDEOS_DIR, videoId, THUMBNAILS_DIR);
  const getUserImageDir = (userId: string) => join(USERS_DIR, userId);

  return {
    async saveRawUpload(videoId, sourceFile, filename) {
      const dir = getRawDir(videoId);
      await mkdir(dir, { recursive: true });
      const dest = toForwardSlashes(path.join(dir, filename));
      try {
        await rename(sourceFile, dest);
      } catch {
        await copyFile(sourceFile, dest);
        await unlink(sourceFile);
      }
      return dest;
    },

    getRawUploadPath(videoId) {
      return getRawDir(videoId);
    },

    getTranscodedDir,

    async ensureTranscodedDir(videoId) {
      const dir = getTranscodedDir(videoId);
      await mkdir(dir, { recursive: true });
      return dir;
    },

    async saveThumbnail(videoId, data, filename = "thumbnail.jpg") {
      const dir = getThumbnailDir(videoId);
      await mkdir(dir, { recursive: true });
      const dest = toForwardSlashes(path.join(dir, filename));
      await Bun.write(dest, data);
      return dest;
    },

    getThumbnailPath(videoId) {
      return getThumbnailDir(videoId);
    },

    async saveUserImage(userId, kind, data, extension = "jpg") {
      const dir = getUserImageDir(userId);
      await mkdir(dir, { recursive: true });
      const dest = toForwardSlashes(path.join(dir, `${kind}.${extension}`));
      await Bun.write(dest, data);
      return dest;
    },

    getUserImageDir,

    createReadStream(filePath) {
      return Bun.file(filePath).stream();
    },

    async getFileSize(filePath) {
      return Bun.file(filePath).size;
    },

    async fileExists(filePath) {
      return Bun.file(filePath).exists();
    },

    async deleteVideoFiles(videoId) {
      await rm(getVideoDir(videoId), { recursive: true, force: true });
    },

    async deleteFile(filePath) {
      await rm(filePath, { force: true });
    },

    getVideoDir,

    getTusDir() {
      return join(TEMP_DIR, TUS_DIR);
    },

    resolve(...segments) {
      return join(...segments);
    },
  };
}
