/**
 * Xử lý HỌC PHÍ khi nhập danh sách đăng ký CŨ (chủ dự án chốt 04/08/2026).
 *
 * Bối cảnh: file Excel cũ chỉ có một cột "học phí đã đóng". Chủ dự án không giải trình
 * được từng lead giảm theo chính sách nào, và chốt: **tiền đã thu là đúng**, phần chênh
 * so với giá niêm yết thì "tự chia lại". NHƯNG luật đó chỉ đúng với dòng THU 1 ĐỢT +
 * ĐÓNG ĐỦ; dòng trả góp/đặt cọc mà cũng suy thành giảm giá thì **công nợ biến mất**.
 *
 * Đo trên file thật 04/08 (81 dòng, 6 sheet): tổng niêm yết 574.543.000 · tổng đã thu
 * 464.123.000 · chênh 110.420.000. Trong đó có những dòng ghi rõ "cọc 1tr", "đóng trước
 * 2tr", "cuối tháng full phí" — suy thành giảm giá là mất ~30 triệu tiền phải đòi.
 *
 * Cách giải: **cột ghi chú đã chứa sẵn câu trả lời** — máy đọc, chỉ hỏi người ở chỗ
 * thật sự mơ hồ. Module này THUẦN (không DB, không I/O) để test kỹ.
 */
import { normalizeVi } from "./import-registered";

/** Cách xử lý phần chênh giữa giá niêm yết và số tiền đã thu. */
export type FeeTreatment =
  /** Thu đúng giá niêm yết → không giảm, không nợ. */
  | "PAID_FULL"
  /** Ghi chú nói rõ mức giảm / lý do giảm → giảm giá thật, có căn cứ. */
  | "DISCOUNT_NOTED"
  /** Chênh nhỏ, không dấu hiệu nợ → SUY là giảm giá (đánh dấu "suy khi nhập"). */
  | "DISCOUNT_INFERRED"
  /** Ghi chú có dấu hiệu trả góp/đặt cọc → chênh là CÔNG NỢ, không phải giảm giá. */
  | "DEBT"
  /** Ca hoàn phí → KHÔNG nhập (chủ dự án chốt 04/08). */
  | "REFUND"
  /** Máy không đủ căn cứ → người phải quyết từng dòng. */
  | "REVIEW";

export interface FeePlan {
  treatment: FeeTreatment;
  /** Khoản giảm (VND) ghi vào đơn. */
  discountAmount: number;
  /** Tổng phải nộp = niêm yết − giảm. */
  totalAmount: number;
  /** Còn nợ = tổng phải nộp − đã thu (≥ 0). */
  remaining: number;
  /** Câu giải trình gợi ý — rỗng nếu máy không có căn cứ. */
  reason: string;
  /** Vì sao máy kết luận vậy (hiện ở màn xem thử để người nhập đối chiếu). */
  evidence: string;
  /** true → dòng này người phải xem, đừng ghi mù. */
  needsHuman: boolean;
}

/**
 * Ngưỡng "chênh nhỏ thì coi là giảm giá". Lấy từ phân bố THẬT của file 04/08:
 * các khoản giảm có thật nằm ở 3–10% (giới thiệu −300.000, ưu đãi vài %), còn mọi
 * dòng chênh ≥ 23% khi soi ghi chú đều hoá ra là đặt cọc / trả góp. Đặt ở 15% để
 * chừa biên an toàn giữa hai cụm.
 */
export const AUTO_DISCOUNT_MAX_RATIO = 0.15;

/** Ghi chú báo hiệu ca HOÀN PHÍ — không nhập. */
const REFUND_HINTS = ["hoan phi", "hoan tien", "hoan hoc phi"];

/**
 * Ghi chú báo hiệu "mới trả một phần" → phần chênh là CÔNG NỢ.
 * Lấy nguyên văn các cụm xuất hiện trong file thật.
 */
const DEBT_HINTS = [
  "coc", // "cọc 1tr", "đặt cọc"
  "dong truoc", // "đóng trước 2tr"
  "con lai", // "thanh toán 4tr còn lại"
  "cuoi thang", // "cuối tháng full phí"
  "thanh toan sau",
  "tra sau",
  "dot 1",
  "dot 2",
  "dot2",
  "50%",
];

/** Ghi chú báo hiệu GIẢM GIÁ có căn cứ. */
const DISCOUNT_HINTS = ["giam", "giới thieu", "gioi thieu", "uu dai", "khuyen mai", "hoc bong"];

function hasAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) if (haystack.includes(n)) return n;
  return null;
}

/**
 * Đọc mức giảm ghi tường minh trong ghi chú: "-300.000", "-40%", "giảm 500k".
 * Trả về null nếu không có con số rõ ràng.
 */
export function statedDiscountFromNote(
  note: string | null | undefined,
): { kind: "PERCENT" | "AMOUNT"; value: number } | null {
  const raw = String(note ?? "");
  // Phần trăm: "-40%" / "giảm 40%"
  const pct = /(?:^|[^\d])(\d{1,2})\s*%/.exec(raw);
  // Số tiền âm: "-300.000" / "-300,000" / "-300k"
  const amt = /-\s*(\d{1,3}(?:[.,]\d{3})+|\d+\s*k|\d+\s*tr)/i.exec(raw);
  if (amt) {
    const t = amt[1]!.toLowerCase().replace(/\s/g, "");
    if (t.endsWith("k")) return { kind: "AMOUNT", value: parseInt(t) * 1_000 };
    if (t.endsWith("tr")) return { kind: "AMOUNT", value: parseInt(t) * 1_000_000 };
    return { kind: "AMOUNT", value: parseInt(t.replace(/[.,]/g, ""), 10) };
  }
  if (pct) return { kind: "PERCENT", value: parseInt(pct[1]!, 10) };
  return null;
}

export interface FeeRowInput {
  listPrice: number;
  paid: number;
  note: string | null | undefined;
  /** Đã đánh dấu trả 2 đợt (từ ghi chú hoặc người nhập tick). */
  payIn2: boolean;
  /** Người nhập đã tự điền mức giảm ở màn xem thử → tôn trọng, không suy nữa. */
  manualDiscountAmount?: number | null;
  manualDiscountReason?: string | null;
}

/**
 * Quyết định cách xử lý học phí của MỘT dòng.
 *
 * Thứ tự luật cố ý: hoàn phí → người nhập đã quyết → trả góp → ghi chú nói giảm →
 * thu đủ → chênh nhỏ → còn lại là phải hỏi. Đổi thứ tự là đổi kết quả.
 */
export function planRowFee(input: FeeRowInput): FeePlan {
  const { listPrice, paid, payIn2 } = input;
  const n = normalizeVi(input.note);
  const build = (
    treatment: FeeTreatment,
    discountAmount: number,
    reason: string,
    evidence: string,
    needsHuman: boolean,
  ): FeePlan => {
    const d = Math.min(Math.max(0, Math.round(discountAmount)), Math.max(0, listPrice));
    const totalAmount = Math.max(0, listPrice - d);
    return {
      treatment,
      discountAmount: d,
      totalAmount,
      remaining: Math.max(0, totalAmount - paid),
      reason,
      evidence,
      needsHuman,
    };
  };

  // 1. Hoàn phí → không nhập.
  const refundHit = hasAny(n, REFUND_HINTS);
  if (refundHit) {
    return build("REFUND", 0, "", `ghi chú có "${refundHit}" → ca hoàn phí, không nhập`, true);
  }

  // 2. Người nhập đã tự điền mức giảm → tôn trọng tuyệt đối, máy không đoán đè.
  if (input.manualDiscountAmount !== null && input.manualDiscountAmount !== undefined) {
    return build(
      "DISCOUNT_NOTED",
      input.manualDiscountAmount,
      input.manualDiscountReason ?? "",
      "người nhập tự điền",
      false,
    );
  }

  // Không có giá niêm yết thì không suy được gì.
  if (!listPrice) {
    return build("REVIEW", 0, "", "chưa khớp giá niêm yết của khoá", true);
  }

  // 3. Trả góp / đặt cọc → chênh là CÔNG NỢ, tuyệt đối không thành giảm giá.
  const debtHit = payIn2 ? "đã tick trả 2 đợt" : hasAny(n, DEBT_HINTS);
  if (debtHit) {
    return build("DEBT", 0, "", `${debtHit} → phần chênh là CÔNG NỢ, không phải giảm giá`, false);
  }

  // 4. Ghi chú nói rõ có giảm. Chủ dự án chốt 04/08: TIN SỐ TIỀN, không tin con số
  //    trong ghi chú (ca thật: ghi "-40%" nhưng tiền ứng với 29%).
  const stated = statedDiscountFromNote(input.note);
  const discountHit = hasAny(n, DISCOUNT_HINTS);
  const gap = Math.max(0, listPrice - paid);
  if (stated || discountHit) {
    const statedAmount =
      stated?.kind === "PERCENT" ? Math.round((listPrice * stated.value) / 100) : (stated?.value ?? 0);
    const lech = stated && Math.abs(statedAmount - gap) > 1000;
    return build(
      "DISCOUNT_NOTED",
      gap, // tin số tiền
      String(input.note ?? "").trim(),
      lech
        ? `ghi chú ghi mức giảm ${statedAmount.toLocaleString("vi-VN")} nhưng tiền ứng với ${gap.toLocaleString("vi-VN")} — lấy theo TIỀN`
        : "ghi chú nêu rõ khoản giảm",
      !!lech,
    );
  }

  // 5. Thu đúng giá niêm yết.
  if (paid === listPrice) return build("PAID_FULL", 0, "", "thu đúng giá niêm yết", false);

  // 6. Thu vượt niêm yết — chủ dự án chốt 04/08 "tạm cứ cho là đúng", nhưng vẫn nêu ra.
  if (paid > listPrice) {
    return build("PAID_FULL", 0, "", "đã thu VƯỢT giá niêm yết — kiểm lại gói/khoá", true);
  }

  // 7. Chênh nhỏ, không dấu hiệu gì → suy là giảm giá.
  if (gap / listPrice <= AUTO_DISCOUNT_MAX_RATIO) {
    return build(
      "DISCOUNT_INFERRED",
      gap,
      "Suy khi nhập liệu 04/08 — chưa có chính sách kèm theo",
      `chênh ${Math.round((gap / listPrice) * 100)}% (≤ ${Math.round(AUTO_DISCOUNT_MAX_RATIO * 100)}%), ghi chú không nhắc nợ`,
      false,
    );
  }

  // 8. Chênh lớn mà không giải thích → người phải quyết. Kèm NGUYÊN VĂN ghi chú (nếu
  //    có) để người quyết ngay trên màn, khỏi mở lại Excel — ca thật "học viên chỉ học
  //    24 buổi vì thời gian ở VN quá ngắn" là lý do giảm giá hợp lệ nhưng không chứa
  //    từ khoá nào máy nhận ra được.
  const noteText = String(input.note ?? "").trim();
  const pct = Math.round((gap / listPrice) * 100);
  return build(
    "REVIEW",
    0,
    "",
    noteText
      ? `chênh ${pct}% — giảm giá hay còn nợ? Ghi chú: "${noteText.slice(0, 80)}"`
      : `chênh ${pct}% mà ghi chú TRỐNG — giảm giá hay còn nợ?`,
    true,
  );
}

// ─── Phát hiện MỘT em bị tách thành nhiều dòng ────────────────────────────────

export interface DupRow {
  fullName: string;
  paid: number;
}

/**
 * Cùng phụ huynh + cùng khoá mà tách 2 dòng: là 1 em trả 2 đợt, hay 2 em thật?
 *
 * Ca thật 04/08: "Quân" (4.000.000) + "Nguyễn Ngọc Quân" (4.640.000) cùng khoá Sata4,
 * cộng lại = ĐÚNG 8.640.000 giá niêm yết ⇒ một em trả 2 đợt. Bộ nhập cũ tạo 2 học viên.
 * Đối chứng: 2 nhóm khác cùng phụ huynh nhưng tên khác hẳn và tổng ≈ 2× niêm yết ⇒ 2 em thật.
 *
 * Hai tín hiệu ĐỘC LẬP phải cùng chỉ một hướng thì mới kết luận "1 em":
 *   (a) tổng tiền cộng lại ≈ giá niêm yết của MỘT suất,
 *   (b) tên dòng này nằm trong tên dòng kia ("Quân" ⊂ "Nguyễn Ngọc Quân").
 * Chỉ một tín hiệu → nghi ngờ, để người quyết.
 */
export function detectSameStudent(
  rows: DupRow[],
  listPrice: number,
): { verdict: "SAME_STUDENT" | "DIFFERENT_STUDENTS" | "UNSURE"; evidence: string } {
  if (rows.length < 2) return { verdict: "DIFFERENT_STUDENTS", evidence: "chỉ một dòng" };

  const sum = rows.reduce((s, r) => s + r.paid, 0);
  // So theo TỶ LỆ chứ không theo số tuyệt đối: mỗi em có thể có khoản giảm riêng.
  // Ca thật THỊNH+KIM lệch đúng 300.000 (em thứ hai được giảm giới thiệu) — dung sai
  // cứng vài nghìn đồng sẽ kết luận nhầm thành "1 em". Dùng lại đúng biên giảm giá.
  const ratio = listPrice > 0 ? sum / listPrice : 0;
  const sumMatchesOne = listPrice > 0 && Math.abs(ratio - 1) <= AUTO_DISCOUNT_MAX_RATIO;
  const sumMatchesMany =
    listPrice > 0 && Math.abs(ratio - rows.length) <= AUTO_DISCOUNT_MAX_RATIO * rows.length;

  const names = rows.map((r) => normalizeVi(r.fullName).replace(/\s+/g, " ").trim());
  const nameOverlap = names.some((a, i) =>
    names.some((b, j) => i !== j && a.length > 0 && b.includes(a) && a !== b),
  );

  if (sumMatchesOne && nameOverlap) {
    return {
      verdict: "SAME_STUDENT",
      evidence: `tổng ${sum.toLocaleString("vi-VN")} = đúng giá niêm yết MỘT suất, và tên dòng này nằm trong tên dòng kia`,
    };
  }
  if (sumMatchesMany && !nameOverlap) {
    return {
      verdict: "DIFFERENT_STUDENTS",
      evidence: `tên khác hẳn nhau và tổng ≈ ${rows.length}× giá niêm yết`,
    };
  }
  if (sumMatchesOne || nameOverlap) {
    return {
      verdict: "UNSURE",
      evidence: sumMatchesOne
        ? `tổng tiền khớp MỘT suất nhưng tên khác hẳn — 1 em trả 2 đợt hay 2 em cùng nợ?`
        : `tên giống nhau nhưng tổng tiền không khớp một suất`,
    };
  }
  return { verdict: "UNSURE", evidence: "không tín hiệu nào đủ rõ — người kiểm" };
}
