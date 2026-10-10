// lib/crm/commission-run.ts — CHỐT KỲ HOA HỒNG từ sổ tiền thật.
//
// Đây là mảnh còn thiếu suốt từ R1: engine 4 tầng (`commission.ts`) và bảng kê
// (`commission-statement.ts`) đã có và có test, nhưng KHÔNG chỗ nào trong sản phẩm
// gọi `setStatementLines` — nên bảng kê kỳ nào cũng rỗng và Sale chưa từng nhận một
// dòng hoa hồng nào. File này nối hai đầu đó vào `Payment`.
//
// ─────────────────────────────────────────────────────────────────────────────
// NGUỒN "TIỀN ĐÃ THU" — DÙNG LẠI, KHÔNG VIẾT CÔNG THỨC THỨ HAI
//
// `lib/finance/thuc-thu.ts` (quyết định B3, 24/08) là công thức thực thu DUY NHẤT của
// hệ thống — màn kế toán, ROAS, báo cáo doanh thu đều đã đi qua nó. Hoa hồng đi cùng
// một cửa: cùng `WHERE_THUC_THU`, cùng `butToanThucThu`. Nếu ngày nào luật thực thu
// đổi thì hoa hồng đổi theo, không lệch âm thầm.
//
//   CONFIRMED → cộng · REFUNDED (âm) → cộng ⇒ trừ ra · ĐIỀU CHỈNH (paymentType) → là
//   DELTA nên cộng thêm, KHÔNG loại bản gốc (đổi mô hình 07/09/2026)
//   PENDING / REJECTED → bỏ.
//
// ⚠️ CHÊNH CÓ CHỦ ĐÍCH VỚI CÔNG NỢ/CỔNG PH: `lib/finance/debt.ts` và `lib/portal/*`
// vẫn chỉ cộng `accountantStatus = CONFIRMED` (chưa chuyển sang `thuc-thu`), nên khoản
// hoàn KHÔNG làm tăng công nợ và KHÔNG trừ "đã đóng" mà phụ huynh nhìn thấy. Hoa hồng
// CỐ Ý không bắt chước chỗ đó — nó dùng bản đúng. Chênh lệch này đã được báo lại cho
// chủ dự án; sửa `debt.ts`/portal là đổi con số phụ huynh đang nhìn nên phải có quyết
// định riêng, KHÔNG gộp vào ticket hoa hồng.
//
// ─────────────────────────────────────────────────────────────────────────────
// AI HƯỞNG TẦNG NÀO — VÀ VÌ SAO HAI TẦNG CỐ Ý BỎ TRỐNG
//
//   SALE (4%)       ← `Lead.convertedById` — người CHỐT CUỐI (B5/OI-26/C10.5).
//   SALE_ADMIN (1%) ← `Lead.adminId` — Sale Admin bàn giao L1→L2.
//   QC (1%)         ← `CenterCommissionAssignee(role=QC)` của CƠ SỞ bút toán, hiệu lực
//                     tại thời điểm KẾ TOÁN XÁC NHẬN thu tiền (chốt 27/08/2026).
//   QL_TT (2%)      ← `CenterCommissionAssignee(role=QL_TT)` — cùng cơ chế.
//
// (Trước 27/08 hai tầng này KHÔNG CÓ NGUỒN: không cột nào định nghĩa "QC phụ trách",
// và `Center.managerName` là CHUỖI TÊN không nối được tới tài khoản ⇒ 3% treo mỗi kỳ.
// Nay quan hệ nằm ở một SỔ có hiệu lực theo thời gian; xem lib/crm/commission-assignee.ts
// để biết vì sao phải là sổ chứ không phải một cột "người phụ trách hiện tại".)
//
// ⚠️ CƠ SỞ CHƯA KHAI NGƯỜI HƯỞNG THÌ VẪN TREO — cố ý, và đây là hành vi được giữ lại
// nguyên vẹn. Bịa người hưởng = chuyển tiền thật vào tài khoản sai, sai theo kiểu không
// ai soi ra vì con số vẫn "đẹp". `computeCommission()` bỏ qua tầng thiếu người, và
// `chotKyHoaHong()` trả `chuaCoNguoiHuong` + `treoTheoCoSo` để màn chốt kỳ NÓI RA số
// tiền đang treo VÀ CƠ SỞ NÀO còn thiếu — im lặng mới là thứ nguy hiểm.
//
// ⚠️ KHÔNG THÊM TẦNG vào `COMMISSION_TIERS` để "vá" hai chỗ trống này. Σ 4 tầng đúng
// bằng trần 8% ⇒ tầng thứ 5 giết luôn `computeCommission()`. Nâng trần là quyết định
// chính sách tiền của BGĐ. Việc ở đây là TÌM NGƯỜI HƯỞNG, không phải thêm tầng.
import { db } from "@/lib/db";
import type { AuditActor } from "@/lib/audit/audit-log";
import { WHERE_THUC_THU, butToanThucThu, SELECT_THUC_THU } from "@/lib/finance/thuc-thu";
import { pickEffectiveRates } from "@/lib/crm/commission-config";
import { setStatementLines } from "@/lib/crm/commission-statement";
import {
  COMMISSION_TIERS,
  type CommissionRecipients,
  type CommissionTier,
} from "@/lib/crm/commission";
import {
  nguoiHuongHieuLuc,
  VAI_HOA_HONG_CO_SO,
  type PhanCongCoSo,
} from "@/lib/crm/commission-assignee";
import {
  khoangKy,
  tinhHoaHongTheoKy,
  type ButToanHoaHong,
  type DongHoaHongKy,
} from "@/lib/crm/commission-thuc-thu";

/** Một dòng sổ `Payment` với đúng những cột phép tính hoa hồng cần. */
export type HangThanhToanHoaHong = {
  id: string;
  amount: number;
  accountantStatus: string;
  adjustmentOfId: string | null;
  paidDate: Date;
  /** Mốc kế toán XÁC NHẬN — quyết định QC/QL_TT nào đang phụ trách (chốt 27/08). */
  confirmedAt: Date | null;
  /** Cơ sở ghi thẳng trên bút toán; `null` → lùi về đơn rồi tới phiếu. */
  centerId: string | null;
  /** Khoản gốc bị hoàn/điều chỉnh — cho `rateDate` + `assigneeDate` của bút toán hoàn. */
  adjustmentOf: { paidDate: Date; confirmedAt: Date | null } | null;
  enrollment: { renewedFromEnrollmentId: string | null } | null;
  order: {
    leadId: string | null;
    centerId: string | null;
    lead: { convertedById: string | null; adminId: string | null; centerId: string | null } | null;
  } | null;
};

/** `select` chuẩn — giữ khớp 1-1 với `HangThanhToanHoaHong`. */
export const SELECT_HOA_HONG = {
  ...SELECT_THUC_THU,
  paidDate: true,
  confirmedAt: true,
  centerId: true,
  adjustmentOf: { select: { paidDate: true, confirmedAt: true } },
  enrollment: { select: { renewedFromEnrollmentId: true } },
  order: {
    select: {
      leadId: true,
      centerId: true,
      lead: { select: { convertedById: true, adminId: true, centerId: true } },
    },
  },
} as const;

/** `select` chuẩn cho sổ phân công — giữ khớp 1-1 với `PhanCongCoSo`. */
export const SELECT_PHAN_CONG = {
  centerId: true,
  role: true,
  userId: true,
  effectiveFrom: true,
  effectiveTo: true,
} as const;

/**
 * THUẦN — dịch sổ `Payment` sang bút toán hoa hồng.
 *
 * Chạy `butToanThucThu` TRƯỚC: nó lọc đúng hai trạng thái tham gia thực thu. Lớp này
 * trùng với `WHERE_THUC_THU` ở tầng SQL và đó là CHỦ ĐÍCH — caller nào quên mảnh `where`
 * vẫn không tạo ra tiền khống.
 *
 * 🔴 Từ 07/09/2026 nó KHÔNG còn loại bản gốc: bút toán điều chỉnh là DELTA, gốc giữ số
 * cũ, cộng cả hai mới ra số đúng.
 */
export function mapButToanHoaHong(
  rows: HangThanhToanHoaHong[],
  phanCong: readonly PhanCongCoSo[] = [],
): ButToanHoaHong[] {
  return butToanThucThu(rows).map((r) => {
    const laHoan = r.accountantStatus === "REFUNDED";
    // Cơ sở của bút toán: ưu tiên cột trên chính phiếu thu (nguồn gần nhất), lùi dần
    // về đơn rồi tới phiếu khách. `Payment.centerId` là cột `BAT_BUOC` nhưng dòng cũ
    // vẫn có NULL — bỏ hai bước lùi là hàng loạt bút toán cũ mất cơ sở và treo oan.
    const centerId = r.centerId ?? r.order?.centerId ?? r.order?.lead?.centerId ?? null;
    // Mốc XÁC NHẬN quyết định ai đang phụ trách.
    //
    // ⚠️ MỌI bút toán CÓ KHOẢN GỐC đều soi mốc của khoản GỐC, không riêng khoản hoàn.
    // Bản ĐIỀU CHỈNH cũng vậy, và đây là chỗ suýt sai: `adjustPayment()` chép `paidDate`
    // của gốc (nên bản điều chỉnh ở lại KỲ gốc và ăn TỈ LỆ gốc) nhưng đặt
    // `confirmedAt = now` — tức mốc bấm nút sửa. Lấy mốc đó thì kế toán sửa số tháng 9
    // cho một khoản thu tháng 7 sẽ đẩy hoa hồng QC của tháng 7 sang người mới nhận việc
    // tháng 8, trong khi kỳ và tỉ lệ vẫn là của tháng 7. Ba thứ phải cùng đi theo gốc.
    //
    // Giới hạn đã biết: chuỗi điều chỉnh nhiều lần (A ← B ← C) chỉ lùi được MỘT bậc,
    // nên C soi mốc của B chứ không phải A. Chấp nhận — vẫn đúng hơn hẳn "lúc bấm nút",
    // và chuỗi 3 bậc chưa từng xuất hiện trên sổ.
    const goc = r.adjustmentOf;
    const assigneeDate = goc
      ? (goc.confirmedAt ?? goc.paidDate)
      : (r.confirmedAt ?? r.paidDate);
    return {
      paymentId: r.id,
      amount: r.amount,
      // KỲ đi theo ngày bút toán vào sổ. Bút toán hoàn mang ngày HOÀN ⇒ thu hồi rơi
      // vào kỳ đang mở, không thò ngược vào kỳ đã duyệt.
      paidDate: r.paidDate,
      // TỈ LỆ đi theo kỳ GỐC với khoản hoàn: đòi lại đúng % đã trả, kể cả khi BGĐ
      // vừa đổi tỉ lệ. Mất dấu gốc thì lùi về ngày hoàn (vẫn thu hồi được).
      rateDate: laHoan ? (r.adjustmentOf?.paidDate ?? r.paidDate) : r.paidDate,
      assigneeDate,
      refundOfPaymentId: laHoan ? r.adjustmentOfId : null,
      leadId: r.order?.leadId ?? null,
      centerId,
      isRenewal: r.enrollment?.renewedFromEnrollmentId != null,
      recipients: nguoiHuong(r.order?.lead ?? null, phanCong, centerId, assigneeDate),
    };
  });
}

/** Người hưởng từng tầng. Tầng thiếu người → bỏ trống (xem đầu file). */
function nguoiHuong(
  lead: { convertedById: string | null; adminId: string | null } | null,
  phanCong: readonly PhanCongCoSo[],
  centerId: string | null,
  assigneeDate: Date,
): CommissionRecipients {
  const out: Record<string, string | string[]> = {};
  // Hai tầng gắn theo NGƯỜI trên phễu.
  if (lead?.convertedById) out.SALE = lead.convertedById;
  if (lead?.adminId) out.SALE_ADMIN = lead.adminId;
  // Hai tầng gắn theo CƠ SỞ. Tên vai TRÙNG tên tầng nên không cần bảng tra thứ hai.
  for (const vai of VAI_HOA_HONG_CO_SO) {
    const ids = nguoiHuongHieuLuc(phanCong, centerId, vai, assigneeDate);
    if (ids.length > 0) out[vai] = ids;
  }
  return out as CommissionRecipients;
}

export type KetQuaChotKy = {
  period: string;
  /** Số bút toán thực thu đã đọc trong kỳ. */
  soButToan: number;
  /** Số dòng hoa hồng đã ghi. */
  soDong: number;
  /** Tổng tiền hoa hồng của kỳ (đã trừ thu hồi). */
  tongTien: number;
  /** Tổng phần thu hồi (số âm) — tách ra để kế toán thấy ngay. */
  tongThuHoi: number;
  /**
   * Tiền hoa hồng KHÔNG chi được vì tầng chưa có người hưởng — theo tầng.
   * Đây là con số phải hiện lên màn hình, không được nuốt.
   */
  chuaCoNguoiHuong: Partial<Record<CommissionTier, number>>;
  /**
   * Cùng số tiền treo đó, nhưng TÁCH THEO CƠ SỞ — 27/08/2026.
   *
   * Trước đây màn chốt kỳ chỉ nói "3% treo vì hệ thống không có nguồn dữ liệu". Nay
   * nguồn đã có, nên câu đúng phải là "cơ sở NÀO chưa khai vai NÀO" — nếu không, người
   * vận hành biết mình mất tiền mà không biết phải đi điền ở đâu.
   * `centerId = null` = bút toán không quy được về cơ sở nào.
   */
  treoTheoCoSo: { centerId: string | null; tier: CommissionTier; amount: number }[];
  /** Tên cơ sở cho `treoTheoCoSo` (id → tên), để màn hình khỏi truy vấn lần nữa. */
  tenCoSo: Record<string, string>;
  /** Thực thu trong kỳ KHÔNG quy được về lead nào (đơn vãng lai). */
  thucThuKhongCoLead: number;
};

/**
 * Chốt (hoặc chốt lại) kỳ hoa hồng từ tiền đã thu.
 *
 * ⚠️ CHẠY LẠI KHÔNG CỘNG ĐÔI — nhưng KHÔNG nhờ khoá unique.
 * `@@unique([statementId, tier, recipientId, enrollmentId])` VÔ TÁC DỤNG với 4 tầng
 * Sale: các dòng này để `enrollmentId = NULL`, mà trong UNIQUE của Postgres NULL không
 * bằng NULL ⇒ ghi bao nhiêu lần cũng lọt (chính migration
 * `20260825110000_teacher_site_2508` nói thẳng điều đó). Khoá ấy chỉ che tầng
 * TRIAL_TEACHER, nơi `enrollmentId` luôn có giá trị.
 * Chống trùng thật nằm ở `setStatementLines`: XOÁ hết dòng 4 tầng Sale của kỳ rồi GHI
 * lại, cả hai trong MỘT transaction. Cộng với `tinhHoaHongTheoKy` tất định ⇒ chạy lần
 * thứ hai cho ra bảng kê trùng khít. Không cần migration nào.
 *
 * Kỳ đã APPROVED → `setStatementLines` ném `STATEMENT_LOCKED` (phải REOPEN bằng
 * SUPER_ADMIN). Cố ý: kỳ đã duyệt là kỳ đã trả lương.
 */
export async function chotKyHoaHong(
  actor: AuditActor,
  input: { period: string; reason?: string },
): Promise<KetQuaChotKy> {
  // Ném sớm nếu kỳ sai định dạng — đừng đi quét cả bảng Payment rồi mới biết.
  const { start, end } = khoangKy(input.period);

  const [rows, rateRows, phanCong] = await Promise.all([
    db.payment.findMany({
      where: { ...WHERE_THUC_THU, paidDate: { gte: start, lt: end } },
      select: SELECT_HOA_HONG,
      orderBy: { id: "asc" }, // thứ tự ổn định ⇒ chạy lại cho ra `note` giống hệt
    }),
    db.commissionRateConfig.findMany({
      select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true },
    }),
    // TOÀN BỘ sổ phân công, KHÔNG lọc theo kỳ: bút toán hoàn soi mốc xác nhận của
    // khoản GỐC, có thể nằm nhiều tháng trước kỳ đang chốt. Bảng này cỡ vài dòng/cơ sở.
    // Đọc bằng `db` TRẦN chứ không `scopedDb`: chốt kỳ là việc toàn hệ (xem
    // `chotKyHoaHongAction`), lọc theo tầm nhìn người bấm nút sẽ đẻ bảng kê thiếu dòng.
    db.centerCommissionAssignee.findMany({ select: SELECT_PHAN_CONG }),
  ]);

  const butToan = mapButToanHoaHong(rows, phanCong);
  const lines = tinhHoaHongTheoKy({
    period: input.period,
    butToan,
    ratesAt: (at) => pickEffectiveRates(rateRows, at),
  });

  await setStatementLines(actor, {
    period: input.period,
    lines: lines.map((l) => ({
      tier: l.tier,
      recipientId: l.recipientId,
      amount: l.amount,
      isClawback: l.isClawback,
      leadId: l.leadId,
      note: l.note,
    })),
    reason: input.reason ?? `Chốt kỳ hoa hồng ${input.period} theo tiền đã thu`,
  });

  const ketQua = thongKe(input.period, butToan, lines, (at) => pickEffectiveRates(rateRows, at));

  // Tên cơ sở cho phần treo — chỉ tra đúng những id thực sự đang treo.
  const idCanTen = [
    ...new Set(ketQua.treoTheoCoSo.map((t) => t.centerId).filter((x): x is string => !!x)),
  ];
  if (idCanTen.length > 0) {
    const centers = await db.center.findMany({
      where: { id: { in: idCanTen } },
      select: { id: true, name: true },
    });
    ketQua.tenCoSo = Object.fromEntries(centers.map((c) => [c.id, c.name]));
  }
  return ketQua;
}

/**
 * THUẦN — số liệu để màn chốt kỳ nói thật về những gì KHÔNG chi được.
 * Tách khỏi `chotKyHoaHong` để test được mà không cần DB.
 */
export function thongKe(
  period: string,
  butToan: ButToanHoaHong[],
  lines: DongHoaHongKy[],
  ratesAt: (at: Date) => Record<CommissionTier, number>,
): KetQuaChotKy {
  const chuaCoNguoiHuong: Partial<Record<CommissionTier, number>> = {};
  const theoCoSo = new Map<string, { centerId: string | null; tier: CommissionTier; amount: number }>();
  let thucThuKhongCoLead = 0;

  for (const bt of butToan) {
    if (bt.isRenewal) continue; // tái tục vốn không hưởng ⇒ không phải "treo"
    if (!bt.leadId) thucThuKhongCoLead += bt.amount;
    const rates = ratesAt(bt.rateDate);
    for (const tier of COMMISSION_TIERS) {
      // "Có người hưởng" = có chuỗi id, HOẶC mảng KHÔNG rỗng. Mảng rỗng là truthy
      // trong JS — kiểm bằng `if (bt.recipients[tier])` trần sẽ coi "chưa khai" thành
      // "đã khai" và số treo về 0 trong khi không đồng nào được chi.
      const r = bt.recipients[tier];
      const coNguoi = typeof r === "string" ? !!r : (r?.length ?? 0) > 0;
      if (coNguoi) continue;
      const tien = Math.sign(bt.amount) * Math.round(Math.abs(bt.amount) * rates[tier]);
      chuaCoNguoiHuong[tier] = (chuaCoNguoiHuong[tier] ?? 0) + tien;
      const khoa = `${bt.centerId ?? ""}|${tier}`;
      const cu = theoCoSo.get(khoa);
      if (cu) cu.amount += tien;
      else theoCoSo.set(khoa, { centerId: bt.centerId, tier, amount: tien });
    }
  }

  const thuTuTang = new Map(COMMISSION_TIERS.map((t, i) => [t, i]));
  return {
    period,
    soButToan: butToan.length,
    soDong: lines.length,
    tongTien: lines.reduce((s, l) => s + l.amount, 0),
    tongThuHoi: lines.filter((l) => l.isClawback).reduce((s, l) => s + l.amount, 0),
    chuaCoNguoiHuong,
    // Bỏ dòng 0đ: thu và hoàn triệt tiêu nhau trong cùng kỳ thì không còn gì treo.
    // Thứ tự TẤT ĐỊNH để chốt lại kỳ ra đúng màn hình cũ.
    treoTheoCoSo: [...theoCoSo.values()]
      .filter((t) => t.amount !== 0)
      .sort(
        (a, b) =>
          (thuTuTang.get(a.tier) ?? 0) - (thuTuTang.get(b.tier) ?? 0) ||
          (a.centerId ?? "").localeCompare(b.centerId ?? ""),
      ),
    tenCoSo: {},
    thucThuKhongCoLead,
  };
}
