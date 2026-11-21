// lib/hoc-bu/loai-bu-vuot.ts — PHÂN BIỆT "HỌC BÙ" VÀ "HỌC VƯỢT" (chủ dự án chốt 17/11/2026). THUẦN, không DB.
//
// Hai loại đi CHUNG một đường (dòng cần bù → case → điểm danh → sổ lượt), nên KHÔNG có bảng riêng. Cái phân biệt chúng đã nằm sẵn trong dữ liệu:
//   · học VƯỢT = dòng cần bù sinh ra khi bé vào lớp đang chạy giữa chừng, học đuổi các buổi lớp đã dạy ⇒ `MakeupNeed.sourceType = ORDER_CONVERSION`;
//   · học BÙ   = mọi dòng còn lại (vắng buổi, quản lý tạo tay, dòng di trú cũ…). Dòng `SYSTEM_MIGRATION` không rõ nguồn ⇒ coi là BÙ, KHÔNG đoán.
//
// Ở mức BUỔI (case): một case chỉ chứa MỘT loại. Loại của case ghi vào `MakeupCase.sessionCategoryId` (BU / VUOT) — chính cột mà lưới phân công GV
// (`lib/parttime/buoi.ts`) và công dạy đọc để gọi tên "Dạy bù" / "Học vượt". Trước đây cột này luôn là BU nên nhãn "Học vượt" chưa bao giờ hiện.

export type LoaiBuVuot = "BU" | "VUOT";

/** Mã `SessionCategory` tương ứng (cùng mã với `lib/cham-cong/catalog.ts` và `lib/parttime/buoi.ts`). */
export const MA_PHAN_LOAI_THEO_LOAI: Record<LoaiBuVuot, string> = { BU: "BU", VUOT: "VUOT" };

export const NHAN_LOAI: Record<LoaiBuVuot, string> = { BU: "Học bù", VUOT: "Học vượt" };

/** Dòng cần bù thuộc loại nào, theo `MakeupNeed.sourceType`. Mọi giá trị khác `ORDER_CONVERSION` (kể cả lạ / thiếu) là BÙ. */
export function loaiTuNguon(sourceType: string | null | undefined): LoaiBuVuot {
  return sourceType === "ORDER_CONVERSION" ? "VUOT" : "BU";
}

/** Loại của case theo mã phân loại buổi. `null` / mã khác ⇒ BÙ (case cũ chưa gắn loại luôn là bù). */
export function loaiTuMaPhanLoai(ma: string | null | undefined): LoaiBuVuot {
  return ma === MA_PHAN_LOAI_THEO_LOAI.VUOT ? "VUOT" : "BU";
}

/** Giá trị bộ lọc từ URL: chỉ nhận đúng `bu` / `vuot`; còn lại là không lọc. */
export function docLocLoai(raw: string | undefined | null): LoaiBuVuot | undefined {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "bu") return "BU";
  if (s === "vuot") return "VUOT";
  return undefined;
}

export type DongCoLoai = { hocVien: string; loai: LoaiBuVuot };

export type KetQuaLoai = { ok: true; loai: LoaiBuVuot } | { ok: false; lyDo: string };

/**
 * Các dòng được chọn để xếp CÙNG MỘT case phải cùng loại. Trộn ⇒ từ chối, nói rõ bé nào thuộc loại nào để người xếp tách ra hai case.
 * Danh sách rỗng ⇒ `ok` với BÙ (không có gì để trộn); nơi gọi tự chặn danh sách rỗng ở bước khác.
 */
export function kiemCungLoai(dong: readonly DongCoLoai[]): KetQuaLoai {
  const vuot = dong.filter((d) => d.loai === "VUOT");
  const bu = dong.filter((d) => d.loai === "BU");
  if (vuot.length > 0 && bu.length > 0) {
    const ten = (xs: readonly DongCoLoai[]) => [...new Set(xs.map((x) => x.hocVien))].slice(0, 3).join(", ") + (new Set(xs.map((x) => x.hocVien)).size > 3 ? "…" : "");
    return {
      ok: false,
      lyDo: `Không xếp chung học vượt và học bù vào một case — học vượt: ${ten(vuot)}; học bù: ${ten(bu)}. Tách thành hai case.`,
    };
  }
  return { ok: true, loai: vuot.length > 0 ? "VUOT" : "BU" };
}

/**
 * Dòng mới thêm vào case ĐÃ CÓ người phải cùng loại với những gì case đang có. `loaiCase = null` (case chưa còn ai) ⇒ nhận loại nào cũng được.
 * Trả câu từ chối, hoặc `null` nếu hợp lệ.
 */
export function kiemHopVoiCase(loaiCase: LoaiBuVuot | null, dongThem: readonly DongCoLoai[]): string | null {
  if (loaiCase === null) return null;
  const lech = dongThem.filter((d) => d.loai !== loaiCase);
  if (lech.length === 0) return null;
  const ten = [...new Set(lech.map((x) => x.hocVien))].slice(0, 3).join(", ");
  return loaiCase === "VUOT"
    ? `Case này là buổi HỌC VƯỢT — ${ten} là học bù nên không xếp chung được. Tạo case học bù riêng.`
    : `Case này là buổi HỌC BÙ — ${ten} là học vượt nên không xếp chung được. Tạo case học vượt riêng.`;
}

/** Loại của một case từ các dòng đang còn trong nó: toàn vượt ⇒ VUOT, còn lại ⇒ BU, không còn dòng nào ⇒ `null` (chưa có loại để so). */
export function loaiCuaCaseTuDong(loais: readonly LoaiBuVuot[]): LoaiBuVuot | null {
  if (loais.length === 0) return null;
  return loais.every((l) => l === "VUOT") ? "VUOT" : "BU";
}
