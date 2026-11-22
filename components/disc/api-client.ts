/**
 * Máy khách gọi API DISC — hai hàm, để thay bằng bản giả khi test.
 *
 *  - `goiBoDeDisc`  : POST /api/disc/bo-de  → lấy BỘ ĐỀ (câu hỏi) từ máy chủ. Động cơ chạy Ở SERVER (quyết định D1).
 *  - `goiLuuDisc`   : POST /api/disc/luu    → gửi CÂU TRẢ LỜI THÔ trong `bai`; máy chủ tự chấm rồi bỏ câu trả lời thô.
 *
 * LUẬT: chỉ trả `ok:true` khi máy chủ trả đúng hình dạng thành công. Mọi trường hợp khác (mạng
 * đứt, 429, 5xx, JSON hỏng) đều là `ok:false` — giao diện KHÔNG được nói "đã lưu" và KHÔNG được dựng bài giả.
 * Không log body (dữ liệu trẻ).
 */
import type { BoDeDisc } from "@/lib/disc/engine";
import type { LuuInput, PhanHoiLuu } from "@/lib/disc/luu";

export type LoiGoi = "MANG" | "QUA_NHIEU_LAN";
export type KetQuaGoi = PhanHoiLuu | { ok: false; loi: LoiGoi };
export type GoiLuu = (body: LuuInput, tinHieu?: AbortSignal) => Promise<KetQuaGoi>;

export const DUONG_DAN_LUU = "/api/disc/luu";
export const DUONG_DAN_BO_DE = "/api/disc/bo-de";

function laThanhCong(x: unknown): x is Extract<PhanHoiLuu, { ok: true }> {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const tb = o.thongBao as Record<string, unknown> | undefined;
  return (
    o.ok === true &&
    typeof o.submissionId === "string" &&
    typeof o.tokenTai === "string" &&
    // maNhan phải có mặt: chuỗi (mã mới) hoặc null (phát lại khi bài đã được nhận).
    (o.maNhan === null || typeof o.maNhan === "string") &&
    !!tb &&
    typeof tb.chinh === "string" &&
    (tb.email === null || typeof tb.email === "string")
  );
}

export const goiLuuDisc: GoiLuu = async (body, tinHieu) => {
  let res: Response;
  try {
    res = await fetch(DUONG_DAN_LUU, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: tinHieu,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, loi: "MANG" };
  }
  if (res.status === 429) return { ok: false, loi: "QUA_NHIEU_LAN" };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, loi: "LUU_THAT_BAI" };
  }
  if (res.ok && laThanhCong(json)) return json;
  const o = (json ?? {}) as Record<string, unknown>;
  if (o.ok === false && (o.loi === "DU_LIEU_KHONG_HOP_LE" || o.loi === "THIEU_HO_SO" || o.loi === "LUU_THAT_BAI" || o.loi === "ENGINE_CHUA_SAN_SANG")) {
    return { ok: false, loi: o.loi, chiTiet: Array.isArray(o.chiTiet) ? (o.chiTiet as Array<{ truong: string; thongBao: string }>) : undefined };
  }
  return { ok: false, loi: "LUU_THAT_BAI" };
};

// ─────────────────────────────────────────────────────────────────────────────
// Lấy bộ đề
// ─────────────────────────────────────────────────────────────────────────────

export type YeuCauBoDe = { vai: "PH" | "HS"; bacHoc?: string; namSinh: number };

/**
 * ENGINE_CHUA_SAN_SANG : máy chủ chưa có động cơ ⇒ hiện "đang hoàn thiện", KHÔNG dựng bài giả.
 * KHONG_MO             : 404 (cờ tắt) — coi như tính năng chưa mở.
 * QUA_NHIEU_LAN        : 429.
 * KHONG_HOP_LE         : 400 (năm sinh/bậc học không chọn được bộ đề) hoặc phản hồi sai hình dạng.
 * MANG                 : không kết nối được.
 * LOI_MAY_CHU          : mọi trường hợp còn lại.
 */
export type LoiBoDe = "ENGINE_CHUA_SAN_SANG" | "KHONG_MO" | "QUA_NHIEU_LAN" | "KHONG_HOP_LE" | "MANG" | "LOI_MAY_CHU";
export type KetQuaBoDe = { ok: true; boDe: BoDeDisc } | { ok: false; loi: LoiBoDe };
export type GoiBoDe = (yeuCau: YeuCauBoDe, tinHieu?: AbortSignal) => Promise<KetQuaBoDe>;

/** Kiểm hình dạng bộ đề nhận từ mạng: sai hình ⇒ KHÔNG dựng bài. */
export function laBoDeHopLe(x: unknown): x is BoDeDisc {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.ma !== "string" || !o.ma || typeof o.phienBan !== "string" || typeof o.doiTuong !== "string" || typeof o.nguoiLonTraLoiHo !== "boolean") return false;
  if (!Array.isArray(o.cauHoi) || o.cauHoi.length === 0) return false;
  const ids = new Set<string>();
  for (const c of o.cauHoi) {
    if (!c || typeof c !== "object") return false;
    const q = c as Record<string, unknown>;
    if (typeof q.id !== "string" || !q.id || typeof q.noiDung !== "string" || !q.noiDung || ids.has(q.id)) return false;
    ids.add(q.id);
  }
  // Thang/câu dẫn là TUỲ CHỌN (engine cũ không có) nhưng nếu có thì phải đúng hình, giá trị là số nguyên dương không trùng.
  if (o.cauDan !== undefined && (typeof o.cauDan !== "string" || o.cauDan.length > 300)) return false;
  if (o.thang !== undefined) {
    if (!Array.isArray(o.thang) || o.thang.length < 2 || o.thang.length > 10) return false;
    const gia = new Set<number>();
    for (const m of o.thang) {
      if (!m || typeof m !== "object") return false;
      const t = m as Record<string, unknown>;
      if (typeof t.gia !== "number" || !Number.isInteger(t.gia) || t.gia < 1 || gia.has(t.gia)) return false;
      if (typeof t.nhan !== "string" || !t.nhan || t.nhan.length > 60) return false;
      if (t.mat !== undefined && (typeof t.mat !== "string" || t.mat.length > 8)) return false;
      gia.add(t.gia);
    }
  }
  return true;
}

export const goiBoDeDisc: GoiBoDe = async (yeuCau, tinHieu) => {
  let res: Response;
  try {
    res = await fetch(DUONG_DAN_BO_DE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(yeuCau),
      signal: tinHieu,
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, loi: "MANG" };
  }
  if (res.status === 404) return { ok: false, loi: "KHONG_MO" };
  if (res.status === 429) return { ok: false, loi: "QUA_NHIEU_LAN" };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, loi: "LOI_MAY_CHU" };
  }
  const o = (json ?? {}) as Record<string, unknown>;
  if (res.status === 503 && o.loi === "ENGINE_CHUA_SAN_SANG") return { ok: false, loi: "ENGINE_CHUA_SAN_SANG" };
  if (res.status === 400) return { ok: false, loi: "KHONG_HOP_LE" };
  if (res.ok && o.ok === true) return laBoDeHopLe(o.boDe) ? { ok: true, boDe: o.boDe } : { ok: false, loi: "LOI_MAY_CHU" };
  return { ok: false, loi: "LOI_MAY_CHU" };
};

// ── Danh mục địa chỉ (bước «Lưu», 05/11/2026) ──────────────────────────────────────────────────────────────────────────────────────────

export const DUONG_DAN_DIA_CHI = "/api/disc/dia-chi";
export type DanhMucDiaChi = { thanhPho: string[]; macDinh: string; phuong: string[] };
export type KetQuaDiaChi = { ok: true; danhMuc: DanhMucDiaChi } | { ok: false; loi: "MANG" | "KHONG_MO" | "LOI_MAY_CHU" };
export type GoiDiaChi = (thanhPho?: string, tinHieu?: AbortSignal) => Promise<KetQuaDiaChi>;

const laDanhSachChuoi = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.length <= 4000 && x.every((s) => typeof s === "string" && s.length > 0 && s.length <= 120);

/** GET /api/disc/dia-chi — danh sách thành phố + phường/xã của MỘT thành phố. Hình lạ ⇒ `LOI_MAY_CHU` (không dựng ô chọn từ thứ không tin được). */
export const goiDiaChiDisc: GoiDiaChi = async (thanhPho, tinHieu) => {
  let res: Response;
  try {
    const q = thanhPho ? `?thanhPho=${encodeURIComponent(thanhPho)}` : "";
    res = await fetch(`${DUONG_DAN_DIA_CHI}${q}`, { method: "GET", signal: tinHieu, credentials: "same-origin" });
  } catch {
    return { ok: false, loi: "MANG" };
  }
  if (res.status === 404) return { ok: false, loi: "KHONG_MO" };
  if (!res.ok) return { ok: false, loi: "LOI_MAY_CHU" };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, loi: "LOI_MAY_CHU" };
  }
  const o = (json ?? {}) as Record<string, unknown>;
  if (o.ok !== true || !laDanhSachChuoi(o.thanhPho) || !laDanhSachChuoi(o.phuong) || typeof o.macDinh !== "string") return { ok: false, loi: "LOI_MAY_CHU" };
  return { ok: true, danhMuc: { thanhPho: o.thanhPho, macDinh: o.macDinh, phuong: o.phuong } };
};
