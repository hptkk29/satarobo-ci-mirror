// lib/crm/commission.ts — R1-10: engine hoa hồng 4 tầng (SR.QD.217, tiền — THUẦN).
// QC 1% · Sale Admin 1% · Sale 4% · QL TT 2% (Σ 8%). Tách tính toán khỏi DB/UI để
// test phủ cao (C10.1–C10.5). Persistence (DRAFT→APPROVED) + "của tôi" = phần DB sau.

export type CommissionTier = "QC" | "SALE_ADMIN" | "SALE" | "QL_TT";

// ⚠️ KHÔNG có tầng GIAO_VIEN ở đây. GĐ6 từng thêm nó vào pool, nhưng bản chốt tách
// hẳn ra `lib/crm/trial-teacher-commission.ts`: pool 4 tầng Sale tính trên DOANH THU
// KỲ, còn hoa hồng giáo viên dạy Trial tính trên TỪNG GHI DANH — hai cơ sở tính khác
// nhau, nhét chung một mảng là sai ngay ở phép cộng. Trần tổng (9%) vẫn phủ cả hai:
// `setCommissionRate` cộng tầng TRIAL_TEACHER vào trước khi so trần.
export const COMMISSION_TIERS: CommissionTier[] = ["QC", "SALE_ADMIN", "SALE", "QL_TT"];

/** % mặc định mỗi tầng của pool Sale (Σ = 8%; +1% tầng GV dạy Trial = trần 9%). */
export const DEFAULT_RATES: Record<CommissionTier, number> = {
  QC: 0.01,
  SALE_ADMIN: 0.01,
  SALE: 0.04,
  QL_TT: 0.02,
};

/**
 * Trần tổng tỉ lệ hoa hồng — GIÁ TRỊ MẶC ĐỊNH khi chưa đọc được cấu hình.
 *
 * ⚠️ 27/08/2026 — NỚI 8% → 9% theo quyết định của chủ dự án, và **thôi hardcode**:
 * trần nay là tham số vận hành `crm.commissionMaxTotalRate`, quản trị hệ thống tự sửa ở
 * màn Cấu hình vận hành. Hằng này chỉ còn là chỗ dựa cho code THUẦN (test, hàm không
 * chạm DB) — nơi nào chạm DB được thì phải đọc cấu hình rồi truyền vào `maxTotalRate`.
 *
 * Vì sao nới: Σ 4 tầng Sale đúng bằng 8,00% nên trần cũ đã bão hoà — không còn chỗ cho
 * tầng `TRIAL_TEACHER` (+1% GV dạy Trial). Nới lên 9% là để 8% Sale + 1% GV cùng nằm
 * dưới MỘT trần đo được, thay vì để tầng GV chạy ngoài mọi ràng buộc như trước.
 */
export const MAX_TOTAL_RATE = 0.09;

/** Trần cũ, giữ tên để đọc lại lịch sử — KHÔNG dùng cho tính toán mới. */
export const MAX_TOTAL_RATE_TRUOC_2708 = 0.08;

export class CommissionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CommissionError";
    this.code = code;
  }
}

export type CommissionLine = {
  tier: CommissionTier;
  recipientId: string;
  amount: number; // VND (làm tròn); âm = clawback
  isClawback?: boolean;
};

function mergedRates(rates?: Partial<Record<CommissionTier, number>>): Record<CommissionTier, number> {
  return { ...DEFAULT_RATES, ...(rates ?? {}) };
}

/**
 * C10.2 — Σ rate vượt trần → từ chối lưu config.
 *
 * `maxTotalRate` truyền vào từ cấu hình vận hành (`crm.commissionMaxTotalRate`). Bỏ
 * trống thì rơi về `MAX_TOTAL_RATE` — đúng cho code thuần/test, KHÔNG đúng cho đường
 * ghi thật: nơi nào chạm DB được thì phải đọc cấu hình, nếu không người vận hành sửa
 * trần ở màn cấu hình mà đường ghi vẫn chặn theo số cũ.
 */
export function validateRates(
  rates?: Partial<Record<CommissionTier, number>>,
  maxTotalRate: number = MAX_TOTAL_RATE,
): Record<CommissionTier, number> {
  const merged = mergedRates(rates);
  const total = COMMISSION_TIERS.reduce((s, t) => s + (merged[t] ?? 0), 0);
  if (total > maxTotalRate + 1e-9) {
    throw new CommissionError(
      "RATE_EXCEEDS_CAP",
      `Tổng tỉ lệ ${(total * 100).toFixed(2)}% vượt trần ${(maxTotalRate * 100).toFixed(2)}%.`,
    );
  }
  return merged;
}

/**
 * Một tầng có thể thuộc NHIỀU người (27/08/2026 — QC theo cơ sở, xem
 * `CenterCommissionAssignee`). Giữ kiểu cũ `string` để 20+ chỗ gọi không phải đổi.
 */
export type CommissionRecipients = Partial<Record<CommissionTier, string | readonly string[]>>;

/** Chuẩn hoá `string | string[] | undefined` về danh sách id (bỏ chuỗi rỗng). */
function danhSachNguoiHuong(v: string | readonly string[] | undefined): string[] {
  if (v == null) return [];
  if (typeof v === "string") return v ? [v] : [];
  return v.filter((x) => !!x);
}

/**
 * Chia `total` cho `recipientIds` sao cho TỔNG CÁC PHẦN ĐÚNG BẰNG `total`.
 *
 * Vì sao không phải `Math.round(total / n)` mỗi người: 10.000đ chia 3 ra 3.333 × 3 =
 * 9.999 ⇒ hụt 1đ mỗi lần, mãi mãi, và hụt theo hướng công ty giữ lại tiền của nhân
 * viên. Dùng phần dư lớn nhất: mỗi người `floor`, rồi rải `du` đồng lẻ cho những id
 * đứng đầu theo thứ tự CHỮ CÁI.
 *
 * Sắp theo `userId` (không theo thứ tự đầu vào) là điều kiện của "chốt lại kỳ cho ra
 * bảng kê trùng khít" — `chotKyHoaHong` xoá rồi ghi lại cả kỳ, nên hàm này phải TẤT
 * ĐỊNH tuyệt đối. Trùng id bị khử: nhập tay hai dòng cho cùng một người là chuyện sẽ
 * xảy ra, và không khử thì người đó ăn hai suất.
 */
export function chiaDeuTien(
  total: number,
  recipientIds: readonly string[],
): { recipientId: string; amount: number }[] {
  const ids = [...new Set(recipientIds)].sort();
  const n = ids.length;
  if (n === 0) return [];
  const dau = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / n);
  const du = abs - base * n;
  return ids.map((recipientId, i) => ({ recipientId, amount: dau * (base + (i < du ? 1 : 0)) }));
}

/**
 * Tính hoa hồng cho 1 đơn chốt.
 * - isRenewal=true → KHÔNG có hoa hồng 4 tầng (C10.3, OI-26/B2).
 * - recipients.SALE = người CHỐT CUỐI (đổi sale giữa chừng → truyền người cuối — C10.5).
 * - Chỉ sinh dòng cho tầng có recipient.
 */
export function computeCommission(input: {
  revenue: number;
  isRenewal: boolean;
  recipients: CommissionRecipients;
  rates?: Partial<Record<CommissionTier, number>>;
  /**
   * GĐ6 — ĐỢT THU thứ mấy của cùng một hợp đồng (1 = đợt đầu). Bỏ trống = đợt 1.
   *
   * ⚠️ Tham số này tồn tại để MỤC 9.2 đổi được bằng cấu hình chứ không phải sửa code.
   * Câu chưa chốt: chính sách ghi "kỳ 1 mức học viên mới, các kỳ sau mức tái tục",
   * nhưng không nói "kỳ" là ĐỢT THANH TOÁN hay CHU KỲ HỢP ĐỒNG. Khoá 48 buổi chia 2
   * đợt thì hai cách hiểu chênh 3% trên nửa học phí.
   */
  soDot?: number;
  /**
   * Đợt thứ 2 trở đi có bị tính như tái tục không.
   *
   * `false` (MẶC ĐỊNH, và là phương án đang đề xuất): một hợp đồng = một kỳ, chia mấy
   * đợt thu cũng vẫn là khách mới. Lý do: nếu đợt 2 xuống mức tái tục thì Sale có động
   * cơ ép phụ huynh đóng full, mất đúng nhóm khách khó khăn tài chính.
   *
   * `true`: đợt 2 trở đi coi như tái tục (không hoa hồng 4 tầng).
   *
   * ĐỪNG hardcode cách hiểu nào vào chỗ khác — truyền cờ này từ cấu hình.
   */
  dotSauTinhTaiTuc?: boolean;
  /** Trần tổng đọc từ cấu hình vận hành; bỏ trống → `MAX_TOTAL_RATE`. */
  maxTotalRate?: number;
}): CommissionLine[] {
  const rates = validateRates(input.rates, input.maxTotalRate);
  if (input.isRenewal) return [];
  // Mục 9.2 — chỉ có tác dụng khi cờ được BẬT tường minh.
  if (input.dotSauTinhTaiTuc === true && (input.soDot ?? 1) > 1) return [];
  if (input.revenue <= 0) return [];
  const lines: CommissionLine[] = [];
  for (const tier of COMMISSION_TIERS) {
    const ids = danhSachNguoiHuong(input.recipients[tier]);
    if (ids.length === 0) continue;
    // Làm tròn MỘT LẦN ở mức tầng rồi mới chia — không làm tròn từng phần, kẻo Σ các
    // phần lệch tổng tầng và trần 9% bị vượt bằng những đồng lẻ.
    const tongTang = Math.round(input.revenue * rates[tier]);
    for (const phan of chiaDeuTien(tongTang, ids)) {
      lines.push({ tier, recipientId: phan.recipientId, amount: phan.amount });
    }
  }
  return lines;
}

/**
 * C10.4 — Refund → clawback dòng ÂM kỳ sau theo tỉ lệ hoàn (ratio 0..1).
 * Dựa trên các dòng hoa hồng gốc đã chi.
 */
export function computeClawback(originalLines: CommissionLine[], refundRatio: number): CommissionLine[] {
  if (refundRatio <= 0) return [];
  const ratio = Math.min(1, refundRatio);
  return originalLines
    .filter((l) => l.amount > 0)
    .map((l) => ({
      tier: l.tier,
      recipientId: l.recipientId,
      amount: -Math.round(l.amount * ratio),
      isClawback: true,
    }));
}
