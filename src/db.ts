import { Database } from "bun:sqlite";
import { DATA_DIR } from "./config";

export const db = new Database(`${DATA_DIR}/dublagame.db`, { create: true });
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  duration REAL,
  status TEXT NOT NULL,
  error TEXT,
  lang TEXT,
  characters TEXT,
  cues TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS takes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  player TEXT NOT NULL,
  characters TEXT NOT NULL,
  file TEXT NOT NULL,
  offset_sec REAL NOT NULL DEFAULT 0,
  score REAL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  file TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_takes_video ON takes(video_id);
`);

export type Cue = {
  i: number;
  start: number;
  end: number;
  text: string;
  words: { t: number; w: string }[];
  char: string;
};

export type Character = { id: string; name: string; color: string };

export type VideoRow = {
  id: string;
  url: string;
  title: string | null;
  duration: number | null;
  status: "pending" | "downloading" | "ready" | "error";
  error: string | null;
  lang: string | null;
  characters: string | null;
  cues: string | null;
  created_at: number;
};

export const getVideo = (id: string) =>
  db.query("SELECT * FROM videos WHERE id = ?").get(id) as VideoRow | null;

export const listVideos = () =>
  db
    .query("SELECT id, title, duration, status, created_at FROM videos ORDER BY created_at DESC LIMIT 30")
    .all() as { id: string; title: string; duration: number; status: string; created_at: number }[];

export function upsertVideo(id: string, url: string) {
  db.query(
    `INSERT INTO videos (id, url, status, created_at) VALUES (?, ?, 'pending', ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, url, Date.now());
}

export function setVideo(id: string, patch: Partial<VideoRow>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE videos SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  db.query(sql).run(...keys.map((k) => (patch as Record<string, unknown>)[k] as never), id);
}
