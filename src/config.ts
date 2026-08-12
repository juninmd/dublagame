import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const PORT = Number(process.env.PORT ?? 3000);
export const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data");
export const MAX_DURATION_SEC = Number(process.env.MAX_DURATION_SEC ?? 900);
export const YTDLP = process.env.YTDLP_BIN ?? "yt-dlp";
export const FFMPEG = process.env.FFMPEG_BIN ?? "ffmpeg";
export const YTDLP_COOKIES = process.env.YTDLP_COOKIES ?? "";

export const AI = {
  baseUrl: process.env.OPENAI_BASE_URL ?? "",
  key: process.env.OPENAI_API_KEY ?? "",
  model: process.env.OPENAI_MODEL ?? "cloud/gemma3",
  enabled: Boolean(process.env.OPENAI_BASE_URL && process.env.OPENAI_API_KEY),
};

export const videoDir = (id: string) => `${DATA_DIR}/videos/${id}`;
export const takesDir = (id: string) => `${videoDir(id)}/takes`;
export const rendersDir = (id: string) => `${videoDir(id)}/renders`;

export function ensureDirs(id: string) {
  for (const d of [videoDir(id), takesDir(id), rendersDir(id)]) mkdirSync(d, { recursive: true });
}

mkdirSync(`${DATA_DIR}/videos`, { recursive: true });
