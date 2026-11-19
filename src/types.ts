export type ActiveTab = "downloader" | "source" | "setup" | "architecture";

export interface QualityFormat {
  id: string;
  label: string;
  type: "video" | "audio";
  height: number | null;
  detail: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  channel: string;
  duration: number;
  duration_string: string;
  thumbnail: string;
  webpage_url: string;
  formats: QualityFormat[];
  preview_mode?: boolean;
}

export interface DownloadStatus {
  id: string;
  status: "queued" | "downloading" | "merging" | "finished" | "error";
  phase: string;
  percent: number;
  speed: string;
  eta: string;
  filename: string;
  filesize: number;
  filesize_formatted: string;
  error: string;
  isPreviewSample?: boolean;
}

export interface SourceFileRecord {
  id: string;
  path: string;
  language: string;
  description: string;
  content: string;
  lines: number;
  bytes: number;
}
