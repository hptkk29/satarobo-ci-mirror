/**
 * Cấu hình extension (hợp đồng §2.1): agentId · centerCode · merchantCode · satAroboBaseUrl, và
 * agentSecret lưu RIÊNG (khoá `biMat` của `chrome.storage.local`).
 *
 * Luật bí mật (§2.3): đúng 64 hex THƯỜNG sau `trim()`, chuỗi khác bị từ chối — không tự sửa hoa
 * thường. Không bao giờ hiển thị lại, không log, không gửi đi đâu (server chỉ nhận CHỮ KÝ).
 * `xemCongKhai` là đường DUY NHẤT trả cấu hình ra ngoài service worker — nó không có ô bí mật.
 */
import { MERCHANT_RE, PORTAL_ORIGIN, SATAROBO_GOC } from "./hang-so.js";

export interface CauHinh {
  agentId: string;
  centerCode: string;
  merchantCode: string;
  satAroboBaseUrl: string;
}

export type OCauHinh = keyof CauHinh | "agentSecret";
export type LoiCauHinh = Partial<Record<OCauHinh, string>>;

const AGENT_ID_RE = /^[a-z0-9]{20,40}$/;
const CENTER_RE = /^[A-Za-z0-9_-]{1,16}$/;
const BI_MAT_RE = /^[0-9a-f]{64}$/;

function chuoi(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

/** Host satarobo gói này được phép gọi = host satarobo đã biết có trong `host_permissions`. */
export function gocChoPhepTuManifest(hostPermissions: readonly string[]): string[] {
  const biet: readonly string[] = Object.values(SATAROBO_GOC);
  const ra: string[] = [];
  for (const h of hostPermissions) {
    const goc = h.replace(/\/\*$/, "");
    if (goc !== PORTAL_ORIGIN && biet.includes(goc) && !ra.includes(goc)) ra.push(goc);
  }
  return ra;
}

export function kiemCauHinh(
  input: unknown,
  gocChoPhep: readonly string[],
): { ok: true; cauHinh: CauHinh } | { ok: false; loi: LoiCauHinh } {
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const agentId = chuoi(o.agentId);
  const centerCode = chuoi(o.centerCode);
  const merchantCode = chuoi(o.merchantCode);
  const satAroboBaseUrl = chuoi(o.satAroboBaseUrl).replace(/\/$/, "");
  const loi: LoiCauHinh = {};
  if (!AGENT_ID_RE.test(agentId)) loi.agentId = "Mã agent: 20–40 ký tự chữ thường và số (chép từ màn Sức khoẻ POS Agent).";
  if (!CENTER_RE.test(centerCode)) loi.centerCode = "Mã cơ sở: 1–16 ký tự, vd CS1.";
  if (!MERCHANT_RE.test(merchantCode)) loi.merchantCode = "Mã merchant: chữ IN HOA và số, vd NCCPH6KE.";
  if (!gocChoPhep.includes(satAroboBaseUrl)) {
    loi.satAroboBaseUrl = `Địa chỉ satarobo phải là: ${gocChoPhep.join(" hoặc ") || "(gói này chưa khai địa chỉ nào)"}.`;
  }
  if (Object.keys(loi).length > 0) return { ok: false, loi };
  return { ok: true, cauHinh: { agentId, centerCode, merchantCode, satAroboBaseUrl } };
}

/** Câu lỗi KHÔNG lặp lại chuỗi người dán (không để bí mật gần đúng hiện trên màn). */
export function kiemBiMat(input: unknown): { ok: true; biMat: string } | { ok: false; loi: string } {
  const s = typeof input === "string" ? input.trim() : "";
  if (!BI_MAT_RE.test(s)) {
    return { ok: false, loi: "Bí mật agent phải là đúng 64 ký tự hex thường (0-9, a-f) — dán lại nguyên văn từ màn Sức khoẻ POS Agent." };
  }
  return { ok: true, biMat: s };
}

/** Đọc cấu hình đã lưu; hỏng / thiếu ⇒ null (coi như chưa cấu hình — không chạy). */
export function docCauHinhDaLuu(x: unknown, gocChoPhep: readonly string[]): CauHinh | null {
  const kq = kiemCauHinh(x, gocChoPhep);
  return kq.ok ? kq.cauHinh : null;
}

export interface XemCauHinh {
  cauHinh: CauHinh | null;
  coBiMat: boolean;
  gocChoPhep: string[];
}

/** Bản xem công khai — dựng ô-theo-ô từ cấu hình hợp lệ, KHÔNG bao giờ có bí mật. */
export function xemCongKhai(daLuu: unknown, coBiMat: boolean, gocChoPhep: readonly string[]): XemCauHinh {
  const c = docCauHinhDaLuu(daLuu, gocChoPhep);
  return {
    cauHinh: c
      ? { agentId: c.agentId, centerCode: c.centerCode, merchantCode: c.merchantCode, satAroboBaseUrl: c.satAroboBaseUrl }
      : null,
    coBiMat,
    gocChoPhep: [...gocChoPhep],
  };
}
