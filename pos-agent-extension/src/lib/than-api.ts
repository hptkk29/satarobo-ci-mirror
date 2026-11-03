/**
 * Dựng thân request + đọc `data` trả về cho 3 endpoint nhỏ (heartbeat, status, jobs) — hợp đồng
 * §4.1–§4.3 — và đọc `rejected[]` của `/transactions` (§4.4, 1.1). Thứ tự khoá cố định (thân V2 của test
 * vector dựng lại đúng từng byte).
 */
import { PHIEN_BAN } from "./hang-so.js";
import { docIso, isoVN } from "./gio-vn.js";
import { KHOA_GIAO_DICH, type KhoaGiaoDich } from "./payload.js";

export type TrangThaiPhienGui = "READY" | "EXPIRED" | "UNKNOWN";
export type NguonHetHan = "ACCESS_TOKEN" | "SESSION" | null;

/** §4.1 — `sessionExpiresSource` / `profileName` là tuỳ chọn: null thì KHÔNG gửi khoá. */
export function thanHeartbeat(p: {
  sessionState: TrangThaiPhienGui;
  sessionExpiresAt: string | null;
  sessionExpiresSource: NguonHetHan;
  lastSyncedAt: number | null;
  profileName: string | null;
}): Record<string, unknown> {
  const than: Record<string, unknown> = {
    extensionVersion: PHIEN_BAN,
    sessionState: p.sessionState,
    sessionExpiresAt: p.sessionExpiresAt,
  };
  if (p.sessionExpiresSource !== null) than.sessionExpiresSource = p.sessionExpiresSource;
  than.lastSyncedAt = p.lastSyncedAt === null ? null : isoVN(p.lastSyncedAt);
  if (p.profileName) than.profileName = p.profileName;
  return than;
}

export type TrangThaiStatus = "SESSION_READY" | "SESSION_EXPIRED" | "ERROR";

/** Một sự kiện chờ gửi `/status` (lưu kho phiên để gửi lại nếu mạng rớt). */
export interface SuKienStatus {
  state: TrangThaiStatus;
  reason: string;
  occurredAt: number;
  httpStatus: number | null;
  sessionExpiresAt: string | null;
}

const LY_DO_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** §4.2 — chỉ MÃ lý do (không chữ tự do, không URL, không token). */
export function thanStatus(s: SuKienStatus, profileName: string | null): Record<string, unknown> {
  if (!LY_DO_RE.test(s.reason)) throw new Error("reason sai định dạng");
  const than: Record<string, unknown> = { state: s.state, reason: s.reason, occurredAt: isoVN(s.occurredAt) };
  if (profileName) than.profileName = profileName;
  if (s.state === "SESSION_READY" && s.sessionExpiresAt) than.sessionExpiresAt = s.sessionExpiresAt;
  if (s.httpStatus !== null && Number.isInteger(s.httpStatus) && s.httpStatus >= 100 && s.httpStatus <= 599) {
    than.httpStatus = s.httpStatus;
  }
  return than;
}

export interface JobDongBo {
  id: string;
  scanFrom: number | null;
}

const JOB_ID_RE = /^[a-z0-9]{20,40}$/;

function docObject(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** `nextPollMs` trong `data` của bất kỳ endpoint nào; không có / sai kiểu ⇒ null. */
export function docNextPoll(data: unknown): number | null {
  const d = docObject(data);
  const v = d?.nextPollMs;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** §4.3 — job hợp lệ của chính agent (tối đa 50, đúng giới hạn `jobIds` của §4.4). */
export function docJobs(data: unknown): JobDongBo[] {
  const ds = docObject(data)?.jobs;
  if (!Array.isArray(ds)) return [];
  const ra: JobDongBo[] = [];
  for (const j of ds) {
    const o = docObject(j);
    if (!o || typeof o.id !== "string" || !JOB_ID_RE.test(o.id)) continue;
    if (ra.some((x) => x.id === o.id)) continue;
    ra.push({ id: o.id, scanFrom: docIso(o.scanFrom) });
    if (ra.length >= 50) break;
  }
  return ra;
}

/** §4.1 — `merchantCode` máy chủ gắn cho agent (để so với cấu hình). */
export function docMerchantHeartbeat(data: unknown): string | null {
  const v = docObject(data)?.merchantCode;
  return typeof v === "string" ? v : null;
}

/** Một dòng máy chủ TỪ CHỐI trong lô vừa gửi (hợp đồng §4.4 `data.rejected[]`, mã §7.2). */
export interface TuChoiDong {
  /** Chỉ số dòng trong lô HIỆN TẠI. */
  index: number;
  /** Mã giao dịch máy chủ vọng lại (≤ 64 ký tự) — chỉ để chẩn đoán. */
  transactionId: string | null;
  code: string;
  /** 1.1 — CHỈ với `FIELD_TOO_LONG`, và chỉ khi là một khoá whitelist §6.1; còn lại null. */
  field: KhoaGiaoDich | null;
}

const MA_TU_CHOI_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const KHOA_SET: ReadonlySet<string> = new Set(KHOA_GIAO_DICH);

function laKhoaGiaoDich(x: unknown): x is KhoaGiaoDich {
  return typeof x === "string" && KHOA_SET.has(x);
}

/**
 * §4.4 / §7.2 — `rejected[]` của `/transactions`. Dữ liệu từ máy chủ ⇒ chỉ nhận đúng hình dạng (mục lạ bị bỏ);
 * `field` chỉ giữ khi mã là `FIELD_TOO_LONG` và giá trị là một khoá whitelist §6.1 — không đưa chuỗi tuỳ ý của
 * máy chủ vào kho / huy hiệu / trang Options.
 */
export function docTuChoi(data: unknown): TuChoiDong[] {
  const ds = docObject(data)?.rejected;
  if (!Array.isArray(ds)) return [];
  const ra: TuChoiDong[] = [];
  for (const x of ds) {
    const o = docObject(x);
    if (!o || typeof o.index !== "number" || !Number.isInteger(o.index) || o.index < 0) continue;
    if (typeof o.code !== "string" || !MA_TU_CHOI_RE.test(o.code)) continue;
    const id = o.transaction_id;
    ra.push({
      index: o.index,
      transactionId: typeof id === "string" && id.length <= 64 ? id : null,
      code: o.code,
      field: o.code === "FIELD_TOO_LONG" && laKhoaGiaoDich(o.field) ? o.field : null,
    });
  }
  return ra;
}

/** Khoá §6.1 máy chủ báo VƯỢT TRẦN (`FIELD_TOO_LONG`) — không trùng, theo thứ tự gặp. Mã khác: không phải việc của agent. */
export function truongQuaDai(ds: readonly TuChoiDong[]): KhoaGiaoDich[] {
  const ra: KhoaGiaoDich[] = [];
  for (const t of ds) if (t.code === "FIELD_TOO_LONG" && t.field !== null && !ra.includes(t.field)) ra.push(t.field);
  return ra;
}
