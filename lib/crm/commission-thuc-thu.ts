// lib/crm/commission-thuc-thu.ts — HOA HỒNG TÍNH TRÊN TIỀN ĐÃ THU (chủ dự án chốt 27/08/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// CHÍNH SÁCH
//   1. Hoa hồng tính trên TIỀN ĐÃ THU, không phải giá trị đơn. Ký hợp đồng 20 triệu
//      mà mới đóng 5 triệu thì hoa hồng là 4% × 5 triệu.
//   2. Tính theo THÁNG (kỳ `"YYYY-MM"` giờ Việt Nam).
//   3. Khách hoàn tiền ⇒ hoa hồng bị TRỪ LẠI (dòng âm, `isClawback`).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO MỘT LUẬT DUY NHẤT PHỦ ĐƯỢC CẢ BA
//
// Sổ tiền của kho này (`lib/finance/payment.ts`) đã ghi đúng dạng cần thiết: mỗi lần
// tiền động là MỘT bút toán `Payment` có DẤU và có ngày.
//   • thu tiền  → bút toán DƯƠNG, `paidDate` = ngày thu;
//   • hoàn tiền → `refundPayment()` tạo bút toán ÂM mới, `paidDate = now` (NGÀY HOÀN,
//     không phải ngày thu gốc) và trỏ `adjustmentOfId` về khoản gốc;
//   • điều chỉnh→ `adjustPayment()` tạo bản MỚI mang số đúng, GIỮ `paidDate` của gốc,
//     và bản gốc bị `WHERE_THUC_THU` loại ra (nếu không là cộng đôi).
//
// Nên luật hoa hồng rút gọn còn đúng một câu:
//
//     hoa hồng = tỉ lệ × số tiền có dấu của bút toán, rơi vào kỳ chứa `paidDate`
//
// Ba yêu cầu chính sách rơi ra như hệ quả, không cần nhánh `if` riêng cho từng cái:
// đóng một phần thì bút toán nhỏ ⇒ hoa hồng nhỏ; đóng vắt hai tháng thì hai bút toán
// nằm hai kỳ; hoàn tiền thì bút toán âm nằm ở KỲ HOÀN ⇒ dòng thu hồi tự sinh đúng chỗ.
//
// ⚠️ VÌ SAO THU HỒI KHÔNG ĐƯỢC THÒ NGƯỢC VỀ KỲ GỐC: kỳ cũ có thể đã APPROVED và đã
// trả lương. Sửa số của một kỳ đã chốt là đổi sổ sau lưng kế toán. Bút toán hoàn mang
// `paidDate` = ngày hoàn nên nó rơi vào kỳ đang mở — đúng chỗ để trừ.
//
// ⚠️ NHƯNG TỈ LỆ THÌ PHẢI LẤY THEO KỲ GỐC (`rateDate`): nếu BGĐ hạ Sale 4%→2% từ 1/9,
// thu hồi một khoản đã trả 4% mà chỉ đòi lại 2% là biếu không 2% — sai theo hướng mất
// tiền công ty và không ai nhìn ra. Nên KỲ đi theo ngày hoàn, TỈ LỆ đi theo ngày gốc.
//
// ⚠️ KHÔNG THÊM TẦNG NÀO VÀO `COMMISSION_TIERS`. Σ 4 tầng đúng bằng `MAX_TOTAL_RATE`
// 8,00% ⇒ tầng thứ 5 làm `validateRates()` ném `RATE_EXCEEDS_CAP` ở MỌI lần gọi
// `computeCommission()`, chết luôn hoa hồng Sale. File này KHÔNG định nghĩa tầng mới:
// nó chỉ đổi CON SỐ ĐEM NHÂN (doanh thu đơn → tiền đã thu) và gọi lại đúng hai hàm
// thuần có sẵn `computeCommission` / `computeClawback`.
import {
  COMMISSION_TIERS,
  computeCommission,
  computeClawback,
  type CommissionRecipients,
  type CommissionTier,
} from "@/lib/crm/commission";

/**
 * Kỳ hoa hồng `"YYYY-MM"` theo THÁNG DƯƠNG LỊCH VIỆT NAM.
 *
 * Vercel chạy UTC còn máy dev +07, nên `getMonth()` trần sẽ đẩy đơn chốt lúc 23:30
 * ngày 31 (giờ VN) sang kỳ tháng sau khi chạy trên Vercel. Cộng bù +7h TRƯỚC khi
 * đọc tháng là hết lệch — không dùng `toLocaleString` (khác nhau theo ICU của runtime).
 *
 * (Hàm này vốn ở `trial-teacher-commission.ts`; dời sang đây để module THUẦN không
 * phải kéo `@/lib/db` vào chỉ vì một phép tính lịch. File cũ re-export, callsite giữ nguyên.)
 */
export function commissionPeriodVN(at: Date): string {
  const vn = new Date(at.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Bút toán này thuộc kỳ nào (alias đọc-được của `commissionPeriodVN`). */
export function kyCuaButToan(paidDate: Date): string {
  return commissionPeriodVN(paidDate);
}

const DANG_KY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const BU_GIO_VN = 7 * 60 * 60 * 1000;

/**
 * Khoảng `[start, end)` của một kỳ, quy về UTC — dùng thẳng cho `paidDate` trong query.
 *
 * Biên PHẢI MỞ (`lt`, không `lte`): `end` của tháng 9 chính là `start` của tháng 10.
 * Dùng `lte` là bút toán đúng nửa đêm giao kỳ được tính cho CẢ HAI kỳ — cộng đôi.
 */
export function khoangKy(period: string): { start: Date; end: Date } {
  const m = DANG_KY.exec(period);
  if (!m) {
    throw new Error(`Kỳ hoa hồng không hợp lệ: "${period}" (cần dạng "YYYY-MM", tháng 01–12).`);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  // 00:00 ngày 1 giờ VN = 17:00 ngày cuối tháng trước theo UTC.
  const start = new Date(Date.UTC(y, mo - 1, 1) - BU_GIO_VN);
  const end = new Date(Date.UTC(y, mo, 1) - BU_GIO_VN);
  return { start, end };
}

/**
 * Một lần tiền động, đã quy về dạng hoa hồng cần biết.
 * Dựng từ `Payment` bằng `lib/crm/commission-run.ts` — file này không chạm DB.
 */
export type ButToanHoaHong = {
  /** `Payment.id` — dấu vết truy nguyên in lên bảng kê. */
  paymentId: string;
  /** Số tiền CÓ DẤU: dương = thu, âm = hoàn. Lấy nguyên dấu từ sổ. */
  amount: number;
  /** Quyết định KỲ. Bút toán hoàn mang ngày HOÀN (xem đầu file). */
  paidDate: Date;
  /** Quyết định TỈ LỆ. Bút toán hoàn mang ngày của khoản GỐC (xem đầu file). */
  rateDate: Date;
  /**
   * Quyết định NGƯỜI HƯỞNG của hai tầng gắn theo cơ sở (QC, QL_TT) — 27/08/2026.
   *
   * Chủ dự án chốt: "QC phụ trách cơ sở TẠI THỜI ĐIỂM KẾ TOÁN XÁC NHẬN THU TIỀN"
   * ⇒ `Payment.confirmedAt` (lùi về `paidDate` với dòng cũ chưa có mốc xác nhận).
   * Bút toán HOÀN mang mốc của khoản GỐC — cùng lý do với `rateDate`: đòi lại tiền
   * của người ĐÃ NHẬN, không đòi người vừa mới nhận việc.
   */
  assigneeDate: Date;
  /** `Payment.id` của khoản gốc bị hoàn — `null` với bút toán thu bình thường. */
  refundOfPaymentId: string | null;
  /** Lead nguồn: gom dòng theo phễu + truy ngược. `null` = đơn không gắn lead. */
  leadId: string | null;
  /**
   * Cơ sở của bút toán — đơn vị đo của hai tầng QC/QL_TT, và là khoá để báo
   * "cơ sở nào chưa khai người hưởng". `null` = không quy được về cơ sở nào.
   */
  centerId: string | null;
  /** Ghi danh tái tục → KHÔNG hưởng 4 tầng (C10.3). */
  isRenewal: boolean;
  /**
   * Người hưởng từng tầng. Tầng thiếu người (undefined hoặc mảng rỗng) → KHÔNG sinh
   * dòng cho tầng đó. Một tầng có NHIỀU người (nhiều QC cùng phụ trách một cơ sở) →
   * chia đều, tổng tầng không đổi.
   */
  recipients: CommissionRecipients;
};

/** Một dòng bảng kê — khớp cột của `CommissionLine`. */
export type DongHoaHongKy = {
  tier: CommissionTier;
  recipientId: string;
  /** VND; âm = thu hồi. */
  amount: number;
  isClawback: boolean;
  leadId: string | null;
  /** Dấu vết: những bút toán đã cộng vào dòng này. */
  note: string;
};

/** Số id tối đa in vào `note` — đủ truy nguyên mà không phình cột TEXT. */
const TOI_DA_ID_TRONG_NOTE = 20;

function gopId(ids: string[]): string {
  const sap = [...ids].sort();
  if (sap.length <= TOI_DA_ID_TRONG_NOTE) return sap.join(", ");
  return `${sap.slice(0, TOI_DA_ID_TRONG_NOTE).join(", ")} … (+${sap.length - TOI_DA_ID_TRONG_NOTE})`;
}

type Nhom = {
  tier: CommissionTier;
  recipientId: string;
  leadId: string | null;
  isClawback: boolean;
  amount: number;
  butToanIds: string[];
  gocIds: string[];
};

/**
 * Dựng các dòng hoa hồng của MỘT kỳ từ sổ tiền.
 *
 * THUẦN + TẤT ĐỊNH: cùng đầu vào ⇒ cùng đầu ra, kể cả thứ tự dòng và `note`. Đây là
 * nền của "chạy lại kỳ không cộng đôi" — `chotKyHoaHong()` xoá rồi ghi lại cả kỳ,
 * nên nếu hàm này tất định thì chạy lần thứ hai cho ra bảng kê trùng khít.
 *
 * `ratesAt(at)` trả tỉ lệ hiệu lực tại `at` (thường là `pickEffectiveRates`).
 */
export function tinhHoaHongTheoKy(input: {
  period: string;
  butToan: ButToanHoaHong[];
  ratesAt: (at: Date) => Record<CommissionTier, number>;
}): DongHoaHongKy[] {
  const { start, end } = khoangKy(input.period);
  const nhomTheoKhoa = new Map<string, Nhom>();
  // Query trả trùng (join lỗi, gộp hai nguồn) là tai nạn có thật — và ở đây nó biến
  // thẳng thành tiền. Chặn bằng id, không tin caller.
  const daXuLy = new Set<string>();

  for (const bt of input.butToan) {
    if (daXuLy.has(bt.paymentId)) continue;
    daXuLy.add(bt.paymentId);

    // Lớp chắn: caller đã lọc bằng SQL, nhưng biên kỳ là chỗ sai âm thầm nên chặn lại.
    if (bt.paidDate < start || bt.paidDate >= end) continue;
    // Tái tục không hưởng 4 tầng (C10.3) ⇒ cũng không có gì để thu hồi.
    if (bt.isRenewal) continue;
    if (!Number.isFinite(bt.amount) || bt.amount === 0) continue;

    const rates = input.ratesAt(bt.rateDate);
    const laThuHoi = bt.amount < 0;

    // Dùng lại ĐÚNG hai hàm thuần cũ. `computeCommission` chạy `validateRates` nên
    // trần 8% vẫn được canh trên đường mới; `computeClawback` bảo đảm dòng âm là ẢNH
    // GƯƠNG chính xác của dòng dương cùng số tiền (hoàn sạch ⇒ hoa hồng về đúng 0,
    // không lệch 1đ do làm tròn hai lần theo hai hướng).
    const duong = computeCommission({
      revenue: Math.abs(bt.amount),
      isRenewal: false,
      recipients: bt.recipients,
      rates,
    });
    const dong = laThuHoi ? computeClawback(duong, 1) : duong;

    for (const d of dong) {
      const khoa = `${d.tier}|${d.recipientId}|${bt.leadId ?? ""}|${laThuHoi ? "1" : "0"}`;
      const cu = nhomTheoKhoa.get(khoa);
      if (cu) {
        cu.amount += d.amount;
        cu.butToanIds.push(bt.paymentId);
        if (bt.refundOfPaymentId) cu.gocIds.push(bt.refundOfPaymentId);
      } else {
        nhomTheoKhoa.set(khoa, {
          tier: d.tier,
          recipientId: d.recipientId,
          leadId: bt.leadId,
          isClawback: laThuHoi,
          amount: d.amount,
          butToanIds: [bt.paymentId],
          gocIds: bt.refundOfPaymentId ? [bt.refundOfPaymentId] : [],
        });
      }
    }
  }

  const thuTuTang = new Map(COMMISSION_TIERS.map((t, i) => [t, i]));
  return [...nhomTheoKhoa.values()]
    .sort(
      (a, b) =>
        (thuTuTang.get(a.tier) ?? 0) - (thuTuTang.get(b.tier) ?? 0) ||
        a.recipientId.localeCompare(b.recipientId) ||
        (a.leadId ?? "").localeCompare(b.leadId ?? "") ||
        Number(a.isClawback) - Number(b.isClawback),
    )
    .map((n) => ({
      tier: n.tier,
      recipientId: n.recipientId,
      amount: n.amount,
      isClawback: n.isClawback,
      leadId: n.leadId,
      note: n.isClawback
        ? `Thu hồi do hoàn tiền · kỳ ${input.period} · ${n.butToanIds.length} bút toán hoàn: ` +
          `${gopId(n.butToanIds)}${n.gocIds.length ? ` (gốc: ${gopId(n.gocIds)})` : ""}`
        : `Thực thu kỳ ${input.period} · ${n.butToanIds.length} bút toán: ${gopId(n.butToanIds)}`,
    }));
}
