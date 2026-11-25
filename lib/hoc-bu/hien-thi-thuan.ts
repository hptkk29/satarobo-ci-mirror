// lib/hoc-bu/hien-thi-thuan.ts — LUẬT HIỂN THỊ của màn học bù (T16, 08/10/2026). THUẦN, dùng được cả ở client lẫn server, test không cần dựng màn.
//
// Gom vào một chỗ những quyết định mà trước đây rải trong JSX (và vì thế không test được): form điểm danh gửi gì · phòng đầy hay chưa · bút toán lượt
// đọc thành câu gì. Component chỉ vẽ kết quả của các hàm này.
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";

// ─── Điểm danh một bé (hai tầng) ─────────────────────────────────────────────────────────────────────────────────────

export type KetQuaChon = "COMPLETED" | "NOT_COMPLETED";
export type LuaChonMuc = Record<string, { ketQua: KetQuaChon | null; danhGia: string }>;

export type KetQuaKiemGui =
  | { ok: true; ketQuaMuc: Record<string, { ketQua: KetQuaChon; danhGia: string | null }> }
  | { ok: false; thieu: string[]; lyDo: string };

/**
 * Bé CÓ MẶT thì MỖI bài phải có kết quả (xong / chưa xong) — không bao giờ tự suy "có mặt ⇒ xong" (luật T07). Thiếu bài nào thì NÓI bài đó, không chỉ
 * "chưa đủ". Đánh giá trống = null (không lưu chuỗi rỗng).
 */
export function kiemKetQuaGui(muc: readonly { id: string; tenBai: string }[], luaChon: LuaChonMuc): KetQuaKiemGui {
  const thieu = muc.filter((m) => !luaChon[m.id]?.ketQua).map((m) => m.tenBai);
  if (thieu.length > 0) {
    return { ok: false, thieu, lyDo: `Chọn "Đã học xong" hoặc "Chưa xong" cho ${thieu.length === 1 ? "bài" : "các bài"}: ${thieu.join(", ")}` };
  }
  const ketQuaMuc: Record<string, { ketQua: KetQuaChon; danhGia: string | null }> = {};
  for (const m of muc) {
    const c = luaChon[m.id]!;
    ketQuaMuc[m.id] = { ketQua: c.ketQua!, danhGia: c.danhGia.trim() ? c.danhGia.trim() : null };
  }
  return { ok: true, ketQuaMuc };
}

/** Lý do SỬA điểm danh: bắt buộc, đủ độ dài (cùng ngưỡng với huỷ / miễn phí). Trả câu nói cho người nhập; null = đủ. */
export function lyDoSuaThieu(lyDo: string): string | null {
  const n = lyDo.trim().length;
  return n >= LY_DO_TOI_THIEU ? null : `Cần ít nhất ${LY_DO_TOI_THIEU} ký tự (đang có ${n}).`;
}

// ─── Sức chứa ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TrangThaiSucChua = { muc: "KHONG_BIET" | "THOAI_MAI" | "GAN_DAY" | "VUOT"; nhan: string };

/** Phòng chứa bao nhiêu so với số bé trong case. Chưa xếp phòng ⇒ nói thẳng là chưa biết (không bịa số). */
export function trangThaiSucChua(soBe: number, sucChua: number | null): TrangThaiSucChua {
  if (sucChua === null) return { muc: "KHONG_BIET", nhan: `${soBe} bé · chưa xếp phòng` };
  if (soBe > sucChua) return { muc: "VUOT", nhan: `${soBe}/${sucChua} bé — VƯỢT sức chứa phòng` };
  if (soBe === sucChua) return { muc: "GAN_DAY", nhan: `${soBe}/${sucChua} bé — phòng đã đầy` };
  return { muc: "THOAI_MAI", nhan: `${soBe}/${sucChua} bé` };
}

// ─── Nhãn kết quả mục ─────────────────────────────────────────────────────────────────────────────────────────────────

export type NhanKetQua = { nhan: string; tone: "success" | "warning" | "muted" | "info" };

export function nhanKetQuaMuc(result: "PLANNED" | "COMPLETED" | "NOT_COMPLETED" | "RELEASED"): NhanKetQua {
  switch (result) {
    case "COMPLETED":
      return { nhan: "Đã học xong", tone: "success" };
    case "NOT_COMPLETED":
      return { nhan: "Chưa xong — sẽ xếp bù lại", tone: "warning" };
    case "RELEASED":
      return { nhan: "Đã nhả khỏi case", tone: "muted" };
    case "PLANNED":
      return { nhan: "Chờ học", tone: "info" };
  }
}

// ─── "Vì sao còn x/y lượt?" ─────────────────────────────────────────────────────────────────────────────────────────────

export type BieuGhiLuot = {
  type: "GRANT" | "HOLD" | "RELEASE" | "CONSUME" | "ADJUSTMENT";
  grantedDelta: number;
  heldDelta: number;
  consumedDelta: number;
  reason: string | null;
  createdAt: Date;
};

export type DongGiaiThich = { ngay: Date; nhan: string; thayDoi: string; lyDo: string | null };

const NHAN_BUT_TOAN: Record<BieuGhiLuot["type"], string> = {
  GRANT: "Cấp lượt",
  HOLD: "Giữ lượt cho buổi đã xếp",
  RELEASE: "Nhả lượt (buổi không còn xếp)",
  CONSUME: "Dùng lượt (đã học)",
  ADJUSTMENT: "Điều chỉnh",
};

/** "+3 cấp", "giữ 1", "nhả 1", "dùng 1" — đọc được, không phải ba cột số trần. */
function noiThayDoi(e: Pick<BieuGhiLuot, "grantedDelta" | "heldDelta" | "consumedDelta">): string {
  const ra: string[] = [];
  if (e.grantedDelta !== 0) ra.push(`${e.grantedDelta > 0 ? "+" : ""}${e.grantedDelta} lượt được cấp`);
  if (e.consumedDelta > 0) ra.push(`dùng ${e.consumedDelta}`);
  else if (e.consumedDelta < 0) ra.push(`trả lại ${-e.consumedDelta} đã dùng`);
  if (e.heldDelta > 0 && e.consumedDelta === 0) ra.push(`giữ ${e.heldDelta}`);
  else if (e.heldDelta < 0 && e.consumedDelta === 0) ra.push(`nhả ${-e.heldDelta}`);
  return ra.join(" · ") || "không đổi số";
}

export function giaiThichLuot(
  so: { granted: number; held: number; consumed: number },
  bieuGhi: readonly BieuGhiLuot[],
): { tomTat: string; con: number; dong: DongGiaiThich[] } {
  const con = so.granted - so.held - so.consumed;
  const phan = [`Được cấp ${so.granted} lượt`];
  if (so.held > 0) phan.push(`đang giữ ${so.held} cho buổi đã xếp case`);
  if (so.consumed > 0) phan.push(`đã dùng ${so.consumed} cho buổi đã học`);
  const tomTat = `${phan.join(", ")} ⇒ còn ${con}.`;
  const dong = [...bieuGhi]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((e) => ({ ngay: e.createdAt, nhan: NHAN_BUT_TOAN[e.type], thayDoi: noiThayDoi(e), lyDo: e.reason }));
  return { tomTat, con, dong };
}
