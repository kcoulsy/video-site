export interface StorageService {
  saveRawUpload(videoId: string, sourceFile: string, filename: string): Promise<string>;
  getRawUploadPath(videoId: string): string;

  getTranscodedDir(videoId: string): string;
  ensureTranscodedDir(videoId: string): Promise<string>;

  saveThumbnail(videoId: string, data: Buffer | Uint8Array, filename?: string): Promise<string>;
  getThumbnailPath(videoId: string): string;

  saveUserImage(
    userId: string,
    kind: "avatar" | "banner",
    data: Buffer | Uint8Array,
    extension?: string,
  ): Promise<string>;
  getUserImageDir(userId: string): string;

  createReadStream(filePath: string): ReadableStream;
  getFileSize(filePath: string): Promise<number>;
  fileExists(filePath: string): Promise<boolean>;

  deleteVideoFiles(videoId: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;

  getVideoDir(videoId: string): string;
  getTusDir(): string;
  resolve(...segments: string[]): string;
}

export { createLocalStorage } from "./local-storage";
