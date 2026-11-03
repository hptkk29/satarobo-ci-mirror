// lib/reports/trung-tam.ts — R7-17 Báo cáo trung tâm (tài chính + hài lòng + tái tục).
//
// HÀM THUẦN: nhận MẢNG record phẳng (đã query sẵn ở page) → trả object số liệu.
// KHÔNG gọi DB ở đây để Vitest test được mà không cần Postgres. Mirror style
// lib/crm/marketing-report.ts. Timezone VN (UTC+7) cho gom theo tháng.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM" của 1 ngày theo giờ VN (THUẦN). */
export function monthKeyVN(date: Date): string {
  const v = new Date(date.getTime() + VN_OFFSET_MS);
  return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}`;
}

// =============================================================================
// TÀI CHÍNH — Payment (đã xác nhận / chờ / hoàn) + công nợ theo Enrollment.
// =============================================================================

/**
 * Khoản thanh toán phẳng (đã query). `accountantStatus` = PaymentAccountantStatus.
 *
 * ⚠️ `id` + `adjustmentOfId` là BẮT BUỘC từ 13/09/2026 (R-13), cố ý không optional để
 * trình biên dịch ÉP mọi chỗ gọi phải select thêm. Thiếu chúng thì không thể biết một
 * khoản CONFIRMED đã bị dòng ĐIỀU CHỈNH thay hay chưa, và bản gốc sẽ được đếm bằng
 * SỐ CŨ mãi mãi.
 */
export type PaymentRecord = {
  id: string;
  centerId: string | null;
  amount: number;
  accountantStatus: string;
  paidDate: Date;
  /** Trỏ tới khoản GỐC khi dòng này là bản ĐIỀU CHỈNH hoặc HOÀN tiền. */
  adjustmentOfId: string | null;
};

// ─── R-13 (13/09/2026) — LUẬT "ĐÃ THU" DÙNG CHUNG ──────────────────────────────
//
// Đo mã thật: repo CỐ Ý không sửa bản gốc khi điều chỉnh / hoàn tiền — nó tạo DÒNG MỚI:
//  · `refundPayment` → `amount: -refundAbs`, `accountantStatus: "REFUNDED"`, `adjustmentOfId`
//  · `adjustPayment` → `amount` ĐÚNG, `accountantStatus: "ADJUSTED"`, `adjustmentOfId`
// Bản gốc trong CẢ HAI ca đều GIỮ NGUYÊN `CONFIRMED`.
//
// Trước bản vá, `summarizeFinance` chỉ cộng `CONFIRMED` và `PENDING`, còn `REFUNDED` đếm
// riêng (cộng dồn số ÂM) và `ADJUSTED` bị bỏ qua HẲN. Ba hệ quả:
//  (1) ô "Đã thu" KHÔNG BAO GIỜ GIẢM dù hoàn bao nhiêu lần;
//  (2) ô "Đã hoàn" hiện số âm, và màn `/bao-cao/trung-tam` gác `refundedAmount > 0` nên
//      CẢNH BÁO KHÔNG BAO GIỜ BẬT;
//  (3) gõ sai 100tr rồi điều chỉnh về 10tr thì báo cáo vẫn đọc 100tr.

/** Id các khoản GỐC đã bị một dòng ĐIỀU CHỈNH thay thế. */
function idBiThayThe(payments: PaymentRecord[]): Set<string> {
  const s = new Set<string>();
  for (const p of payments) {
    if (p.accountantStatus === "ADJUSTED" && p.adjustmentOfId) s.add(p.adjustmentOfId);
  }
  return s;
}

/**
 * Khoản này góp bao nhiêu vào "đã thu" — MỘT luật cho cả bảng tổng và bảng theo cơ sở,
 * để hai bên không bao giờ lệch (`[R13-03]` khoá bất biến này).
 *
 * `REFUNDED` có `amount` ÂM sẵn nên CỘNG là TRỪ — không đảo dấu ở đây.
 */
function gopVaoDaThu(p: PaymentRecord, biThay: Set<string>): number {
  switch (p.accountantStatus) {
    case "CONFIRMED":
      return biThay.has(p.id) ? 0 : p.amount;
    case "ADJUSTED":
      return p.amount;
    case "REFUNDED":
      return p.amount;
    default:
      return 0; // PENDING đếm riêng; REJECTED không đếm vào đâu cả
  }
}

/** Lượt ghi danh phẳng — centerId resolve từ Class ở page (Enrollment không có centerId). */
export type EnrollmentRecord = {
  studentId: string;
  centerId: string | null;
  finalPrice: number | null;
  tuition: number | null;
  enrolledAt: Date;
};

/** Phải thu của 1 lượt ghi danh: finalPrice → fallback tuition → 0 (THUẦN). */
export function receivableOf(e: Pick<EnrollmentRecord, "finalPrice" | "tuition">): number {
  return e.finalPrice ?? e.tuition ?? 0;
}

export type FinanceSummary = {
  /** Doanh thu kế toán đã xác nhận (CONFIRMED). */
  confirmedRevenue: number;
  /** Khoản chờ kế toán xác nhận (PENDING). */
  pendingRevenue: number;
  /** Đã hoàn (REFUNDED) — thường là bút toán âm. */
  refundedAmount: number;
  /** Tổng phải thu (∑ receivable của các lượt ghi danh). */
  totalReceivable: number;
  /** Công nợ = phải thu − đã xác nhận, clamp ≥ 0. */
  debt: number;
  /** Số khoản CONFIRMED. */
  confirmedCount: number;
};

/** Tổng hợp tài chính từ khoản thanh toán + lượt ghi danh (THUẦN). */
export function summarizeFinance(
  payments: PaymentRecord[],
  enrollments: Pick<EnrollmentRecord, "finalPrice" | "tuition">[],
): FinanceSummary {
  const biThay = idBiThayThe(payments);
  let confirmedRevenue = 0;
  let pendingRevenue = 0;
  let refundedAmount = 0;
  let confirmedCount = 0;
  // ⚠️ KHÔNG có nhánh riêng cho bút toán ĐIỀU CHỈNH — và đó là ĐÚNG, không phải sót.
  //
  // Trước 07/09/2026 bút toán điều chỉnh mang `accountantStatus = 'ADJUSTED'`, tức rơi
  // hết xuống nhánh `else` và biến mất khỏi doanh thu. Sau khi tách `paymentType`
  // (migration 20260907090000), dòng ADJUSTMENT mang `accountantStatus = 'CONFIRMED'` và
  // `amount` là DELTA (âm khi điều chỉnh giảm) ⇒ cộng thẳng vào `confirmedRevenue` là ra
  // đúng doanh thu sau điều chỉnh.
  //
  // ⛔ ĐỪNG thêm bộ lọc `paymentType === 'PAYMENT'` ở đây: làm vậy là ném điều chỉnh đi
  // lần nữa, đúng cái lỗi cả đợt này sinh ra để sửa.
  //
  // `confirmedCount` thì có đếm cả bút toán điều chỉnh — chấp nhận: nó là "số dòng sổ đã
  // xác nhận", không phải "số lần khách đóng tiền".
  for (const p of payments) {
    confirmedRevenue += gopVaoDaThu(p, biThay);
    if (p.accountantStatus === "PENDING") pendingRevenue += p.amount;
    // "Đã hoàn" là ĐỘ LỚN, không phải số âm: nhãn trên màn đọc là "đã hoàn X", và cảnh
    // báo ở `/bao-cao/trung-tam` gác `> 0` nên trả số âm là cảnh báo chết vĩnh viễn.
    if (p.accountantStatus === "REFUNDED") refundedAmount += Math.abs(p.amount);
    if (p.accountantStatus === "CONFIRMED" && !biThay.has(p.id)) confirmedCount += 1;
    if (p.accountantStatus === "ADJUSTED") confirmedCount += 1;
  }
  const totalReceivable = enrollments.reduce((s, e) => s + receivableOf(e), 0);
  const debt = Math.max(0, totalReceivable - confirmedRevenue);
  return {
    confirmedRevenue,
    pendingRevenue,
    refundedAmount,
    totalReceivable,
    debt,
    confirmedCount,
  };
}

export type MonthRevenue = { month: string; confirmed: number; pending: number };

/** Xu hướng doanh thu theo tháng VN (THUẦN) — confirmed + pending, sort tăng dần. */
export function revenueByMonth(payments: PaymentRecord[]): MonthRevenue[] {
  const map = new Map<string, { confirmed: number; pending: number }>();
  for (const p of payments) {
    const k = monthKeyVN(p.paidDate);
    const e = map.get(k) ?? { confirmed: 0, pending: 0 };
    if (p.accountantStatus === "CONFIRMED") e.confirmed += p.amount;
    else if (p.accountantStatus === "PENDING") e.pending += p.amount;
    map.set(k, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, confirmed: v.confirmed, pending: v.pending }));
}

export type CenterRevenue = {
  centerId: string;
  confirmed: number;
  pending: number;
  receivable: number;
  debt: number;
};

/** Doanh thu + công nợ theo cơ sở (THUẦN). centerId null → gom vào "—". */
export function revenueByCenter(
  payments: PaymentRecord[],
  enrollments: EnrollmentRecord[],
): CenterRevenue[] {
  const map = new Map<string, CenterRevenue>();
  const get = (cid: string | null): CenterRevenue => {
    const k = cid ?? "—";
    let e = map.get(k);
    if (!e) {
      e = { centerId: k, confirmed: 0, pending: 0, receivable: 0, debt: 0 };
      map.set(k, e);
    }
    return e;
  };
  const biThay = idBiThayThe(payments);
  for (const p of payments) {
    const e = get(p.centerId);
    // CÙNG luật với `summarizeFinance` — dùng chung `gopVaoDaThu`, không viết lại.
    e.confirmed += gopVaoDaThu(p, biThay);
    if (p.accountantStatus === "PENDING") e.pending += p.amount;
  }
  for (const en of enrollments) {
    get(en.centerId).receivable += receivableOf(en);
  }
  for (const e of map.values()) e.debt = Math.max(0, e.receivable - e.confirmed);
  return [...map.values()].sort((a, b) => b.confirmed - a.confirmed);
}

// =============================================================================
// HÀI LÒNG — EvalAnswer STAR_RATING (CENTER_SURVEY). valueNumber 1..5.
// =============================================================================

export type RatingRecord = { valueNumber: number | null };

export type SatisfactionSummary = {
  /** Điểm trung bình (0 nếu không có phản hồi). */
  average: number;
  /** Số lượt rating hợp lệ. */
  count: number;
  /** Phân bố sao 1..5. */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  /** Tỉ lệ hài lòng (sao 4-5 / tổng). */
  positiveRate: number;
};

/** Tổng hợp mức độ hài lòng từ rating sao (THUẦN). Bỏ qua valueNumber null. */
export function summarizeSatisfaction(answers: RatingRecord[]): SatisfactionSummary {
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const a of answers) {
    if (a.valueNumber == null) continue;
    const r = Math.min(5, Math.max(1, Math.round(a.valueNumber))) as 1 | 2 | 3 | 4 | 5;
    distribution[r] += 1;
    sum += a.valueNumber;
    count += 1;
  }
  const average = count ? sum / count : 0;
  const positive = distribution[4] + distribution[5];
  const positiveRate = count ? positive / count : 0;
  return { average, count, distribution, positiveRate };
}

// =============================================================================
// TÁI TỤC — Enrollment lặp lại theo studentId (re-enroll).
// =============================================================================

export type RetentionSummary = {
  /** Số học viên có ghi danh (distinct studentId). */
  totalStudents: number;
  /** Học viên có ≥2 lượt ghi danh (tái tục). */
  returningStudents: number;
  /** Tổng số lượt ghi danh. */
  totalEnrollments: number;
  /** Tỉ lệ tái tục = returning / total. */
  retentionRate: number;
};

/** Tỉ lệ tái tục theo studentId lặp lại (THUẦN). */
export function summarizeRetention(
  enrollments: Pick<EnrollmentRecord, "studentId">[],
): RetentionSummary {
  const counts = new Map<string, number>();
  for (const e of enrollments) {
    counts.set(e.studentId, (counts.get(e.studentId) ?? 0) + 1);
  }
  const totalStudents = counts.size;
  let returningStudents = 0;
  for (const c of counts.values()) if (c > 1) returningStudents += 1;
  const retentionRate = totalStudents ? returningStudents / totalStudents : 0;
  return { totalStudents, returningStudents, totalEnrollments: enrollments.length, retentionRate };
}
