// lib/portal/hv-danh-gia-thuan.ts — Cổng học sinh, màn "Đánh giá thầy cô" (artifact HV-Danh-gia): phần THUẦN. Không DB.
//
// Bản thiết kế vẽ 4 câu cố định, nhưng ĐỢT ĐÁNH GIÁ THẬT (engine EVAL_V2) do trung tâm soạn: số câu, loại câu, chữ câu đều do biểu mẫu
// quyết định. Màn học sinh vẽ ĐÚNG câu của biểu mẫu bằng giao diện của bản thiết kế:
//   · câu RADIO có đúng 5 lựa chọn  → hàng 5 mặt cười (như câu "Giờ học gần đây thế nào?")
//   · câu STAR_RATING               → 5 ngôi sao
//   · câu CHECKBOX                  → các nút chọn nhiều ("chọn bao nhiêu cũng được")
//   · câu RADIO còn lại             → các nút chọn một
//   · câu TEXTBOX                   → ô lời nhắn

export type LoaiCauTho = "STAR_RATING" | "RADIO" | "CHECKBOX" | "TEXTBOX";

export type CauTho = { id: string; type: LoaiCauTho; label: string; options: string[]; required: boolean };

export type KieuCau = "mat" | "sao" | "chon-nhieu" | "chon-mot" | "van-ban";

export function kieuCau(q: Pick<CauTho, "type" | "options">): KieuCau {
  switch (q.type) {
    case "STAR_RATING":
      return "sao";
    case "CHECKBOX":
      return "chon-nhieu";
    case "TEXTBOX":
      return "van-ban";
    default:
      return q.options.length === 5 ? "mat" : "chon-mot";
  }
}

export type TraLoi = { number?: number | null; options?: string[]; text?: string };

/** Câu bắt buộc còn trống. Câu không bắt buộc không bao giờ tính. */
export function demCauThieu(cau: readonly CauTho[], tl: Readonly<Record<string, TraLoi>>): number {
  let thieu = 0;
  for (const q of cau) {
    if (!q.required) continue;
    const v = tl[q.id] ?? {};
    const k = kieuCau(q);
    const co =
      k === "sao" ? (v.number ?? 0) >= 1 : k === "van-ban" ? (v.text ?? "").trim().length > 0 : (v.options ?? []).length > 0;
    if (!co) thieu += 1;
  }
  return thieu;
}

export function nhanConThieu(thieu: number): string {
  return thieu > 0 ? `Còn ${thieu} câu chưa chọn` : "Đủ rồi, em bấm Gửi nhé!";
}

/** Bỏ emoji đứng đầu lựa chọn ("😞 Chán" ⇒ "Chán") — mặt cười đã được vẽ bằng hình. */
export function nhanLuaChon(opt: string): string {
  const m = opt.match(/^\p{Extended_Pictographic}+\s*(.*)$/u);
  return (m?.[1] || opt).trim();
}

/** Đường miệng + màu nền của 5 mặt (thứ tự: chán nhất → vui nhất), chép từ bản thiết kế. */
export const MAT_CUOI: { nen: string; mieng: string }[] = [
  { nen: "var(--sr-bad-bg)", mieng: "M14 31q8-6 16 0" },
  { nen: "var(--sr-tint-orange)", mieng: "M15 30h14" },
  { nen: "var(--sr-tint-purple)", mieng: "M15 29q7 2 14 0" },
  { nen: "var(--sr-success-bg)", mieng: "M14 27q8 6 16 0" },
  { nen: "var(--sr-success-bg)", mieng: "M13 25q9 10 18 0" },
];
