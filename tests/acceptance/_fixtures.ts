// Hằng số + kiểu dùng chung cho bộ nghiệm thu [TAY] của module chat.
// KHÔNG import gì từ `@/lib/*` (nhiều file có `server-only`) — bộ này chạy như một
// client bên ngoài, đúng tư thế của người dùng thật.
import { readFileSync } from "node:fs";
import path from "node:path";

/** Trùng hằng PASSWORD trong scripts/_zztest-chat-nghiemthu-seed.ts. */
export const PASSWORD = "ZZtest!ChatNT#2026";
export const PREFIX = "ZZTEST_CHAT_NT";

export const ACCOUNT_EMAILS = {
  admin: "zztest-chat-nt-admin@zztest.local",
  gv: "zztest-chat-nt-gv@zztest.local",
  ph1: "zztest-chat-nt-ph1@zztest.local",
  ph2: "zztest-chat-nt-ph2@zztest.local",
  ph3: "zztest-chat-nt-ph3@zztest.local",
  sale: "zztest-chat-nt-sale@zztest.local",
} as const;

export type AccountKey = keyof typeof ACCOUNT_EMAILS;

export type SeedInfo = {
  baseURL: string;
  dbHost: string;
  users: Record<AccountKey, { id: string; email: string; name: string }>;
  classes: { lopA: string; lopB: string };
  conversations: { lopA: string; lopB: string };
  /** Đăng ký của HV3 trong LopB — TS-11 đổi trạng thái bản ghi này để "gỡ khỏi lớp". */
  enrollmentHv3: string;
};

export const ARTIFACT_DIR = path.join(process.cwd(), "test-results", "acceptance");
export const SEED_FILE = path.join(ARTIFACT_DIR, "seed.json");
export const storageStateFile = (key: AccountKey) =>
  path.join(ARTIFACT_DIR, `state-${key}.json`);

export function readSeed(): SeedInfo {
  return JSON.parse(readFileSync(SEED_FILE, "utf8")) as SeedInfo;
}

/** Đường dẫn màn chat theo vai — trên host `unknown` mọi site đi bằng PATH. */
export const paths = {
  portalList: "/portal/tin-nhan",
  portalThread: (id: string) => `/portal/tin-nhan/${id}`,
  teacherChat: (id?: string) => (id ? `/teacher/tin-nhan?c=${id}` : "/teacher/tin-nhan"),
  teacherAnnouncements: (id: string) => `/teacher/tin-nhan?c=${id}&tab=thong-bao`,
  teacherMembers: (id: string) => `/teacher/tin-nhan?c=${id}&tab=thanh-vien`,
  adminConversations: "/admin/hoi-thoai",
  adminConversation: (id: string) => `/admin/hoi-thoai/${id}`,
  adminReconcile: "/admin/hoi-thoai/doi-soat",
  enrollmentEdit: (id: string) => `/admin/enrollments/${id}/edit`,
};

/** Nhãn duy nhất cho mỗi lần chạy — tránh đụng tin của lần chạy trước. */
export function runTag(): string {
  return process.env.ACCEPT_RUN_TAG ?? "R";
}
