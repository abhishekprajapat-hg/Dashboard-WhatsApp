import { uploadMediaWithProgress } from "../../../lib/api";
import type { Attachment } from "../types";

interface UploadResponse {
  data: Attachment;
}

class MediaCache {
  private uploadedByFingerprint = new Map<string, Attachment>();
  private previewByFingerprint = new Map<string, string>();

  fingerprint(file: File) {
    return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
  }

  preview(file: File) {
    const key = this.fingerprint(file);
    const cached = this.previewByFingerprint.get(key);
    if (cached) return cached;
    const url = URL.createObjectURL(file);
    this.previewByFingerprint.set(key, url);
    return url;
  }

  async upload(file: File, onProgress?: (progress: number) => void) {
    const key = this.fingerprint(file);
    const cached = this.uploadedByFingerprint.get(key);
    if (cached) {
      onProgress?.(100);
      return cached;
    }
    const response = await uploadMediaWithProgress<UploadResponse>(file, onProgress);
    this.uploadedByFingerprint.set(key, response.data);
    return response.data;
  }
}

export const mediaCache = new MediaCache();
