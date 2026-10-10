// lib/finance/debt.ts — R2-06 công nợ + R2-03 confirm payment (Doc 15 §4.9) + R7-04 công nợ đa chiều.
import { WHERE_THUC_THU, TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import type { Order, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { enqueueDebtReminder } from "@/lib/email/triggers";
// TRỤC B — hằng điều kiện "đã ghi nhận". Import để KHÔNG gõ tay "RECORDED" ở đây:
// mỗi lần gõ tay là một bản sao thứ hai của định nghĩa "đã thu".
import { laKhoanDaGhiNhan } from "@/lib/finance/ghi-nhan";
import { chanGuiRaNgoai, donNhiemTheoDon } from "@/lib/orders/don-nhiem";
import { locDonDangBaoLuu } from "@/lib/bao-luu/dang-bao-luu-db";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";
import type { ScopedDb } from "@/lib/actions/factory";

// ĐỊNH NGHĨA dời sang `debt-pure.ts` (14/09/2026) vì file này import `@/lib/db`: mọi
// component client dùng lại `computeDebt` đều kéo PrismaClient vào bundle trình duyệt và
// nổ lúc chạy — typecheck/lint/depcruise đều xanh. Re-export để ~30 chỗ gọi cũ không đổi.
export { computeDebt } from "@/lib/finance/debt-pure";

/** Đã trả của 1 order (CONFIRMED/COMPLETED = trả đủ; còn lại = 0). THUẦN. */
export function paidOf(order: Pick<Order, "status" | "totalAmount">): number {
  return order.status === "CONFIRMED" || order.status === "COMPLETED" ? order.totalAmount : 0;
}

export class PaymentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentError";
    this.code = code;
  }
}

/** C3.3/C3.4 — kế toán xác nhận thanh toán. Idempotent: gọi 2 lần → 1 kết quả. */
export async function confirmOrderPayment(
  actor: AuditActor,
  orderId: string,
  reason?: string,
): Promise<{ order: Order; alreadyConfirmed: boolean }> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw new PaymentError("ORDER_NOT_FOUND", "Không tìm thấy hoá đơn.");
  if (order.status === "CONFIRMED" || order.status === "COMPLETED") {
    return { order, alreadyConfirmed: true }; // idempotent
  }
  const updated = await db.order.update({
    where: { id: orderId },
    data: { status: "CONFIRMED", paidAt: new Date() },
  });
  await writeAudit({
    actor, module: "finance", entityType: "Order", entityId: order.id, action: "STATUS_CHANGE",
    oldValues: { status: order.status }, newValues: { status: "CONFIRMED" }, reason, orgUnitId: order.centerId,
  });
  return { order: updated, alreadyConfirmed: false };
}

// ═══ R7-04 — công nợ đa chiều theo Enrollment (Payment 2 tầng) ═════════════════

// ─────────────────────────────────────────────────────────────────────────────
// TRỤC A — "tiền ĐÃ XÁC NHẬN". Định nghĩa nằm ở ĐÚNG MỘT CHỖ: dưới đây.
//
// Vì sao gom (07/09/2026): cùng một phép cộng từng được chép tay ở BỐN nơi, mỗi nơi
// một kiểu — `debt.ts` (hàm thuần), `debt.ts:getDebtRows` (tự reduce, không gọi hàm
// thuần), `portal/billing.ts` và `portal/billing-student.ts` (lọc trong JS trên truy vấn
// chỉ lọc `deletedAt`). Bốn bản đó lệch nhau là chuyện sớm muộn, và tiền lệch thì không
// ai phát hiện bằng mắt.
//
// ⚠️ KHÔNG lọc theo `paymentType`: bút toán ADJUSTMENT LUÔN được cộng. Đó là cả điểm của
// mô hình delta — dòng gốc giữ số cũ, dòng điều chỉnh mang phần chênh lệch, tổng mới là
// con số đúng. Lọc `paymentType = 'PAYMENT'` ở bất kỳ đâu là ném điều chỉnh đi lần nữa,
// đúng cái lỗi cả đợt này đang sửa.
//
// ⚠️ Đây là TRỤC A. Trục B ("đã ghi nhận", `saleStatus = RECORDED` — mã QR, webhook
// SePay, tin ZNS, cổng chốt lead) là một câu hỏi KHÁC và có khoá khác (đơn, không phải
// ghi danh). Không gộp hai trục: chênh lệch giữa chúng chính là tín hiệu phát hiện
// webhook hỏng.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TRỤC A THUẦN — CHỈ `CONFIRMED`, KHÔNG trừ bút toán hoàn.
 *
 * ⚠️ ĐÂY KHÔNG PHẢI bộ lọc trả lời "phụ huynh đã đóng bao nhiêu". Câu đó là
 * `KHOAN_DA_DONG` (ròng). Bộ lọc này chỉ đúng cho MỘT câu hỏi: "kế toán đã xác nhận
 * tổng bao nhiêu" — tức trục A trong phép so hai trục (`sumConfirmed`,
 * `tests/finance/dieu-chinh.test.ts`). Dùng nó cho màn tiền của phụ huynh / công nợ /
 * doanh thu là làm dòng hoàn tàng hình, đúng lỗi đã xảy ra ngày 16/09/2026.
 *
 * Dùng thẳng trong `where` của Prisma, kể cả trong quan hệ lồng (`payments: { where }`).
 */
export const KHOAN_DA_XAC_NHAN = {
  accountantStatus: "CONFIRMED",
  deletedAt: null,
} as const;

/**
 * Bản JS của cùng điều kiện — cho chỗ đã nạp sẵn cả danh sách rồi lọc trong bộ nhớ
 * (vd trang Học phí còn phải đếm khoản PENDING/REJECTED nên không lọc được ở query).
 */
export function laKhoanDaXacNhan(p: {
  accountantStatus: string;
  deletedAt?: Date | null;
}): boolean {
  return p.accountantStatus === "CONFIRMED" && !p.deletedAt;
}

/** Σ tiền đã xác nhận từ danh sách ĐÃ LỌC sẵn. THUẦN. */
export function tongDaXacNhan(confirmedPayments: { amount: number }[]): number {
  return confirmedPayments.reduce((s, p) => s + p.amount, 0);
}

/**
 * Hai câu hỏi KHÁC NHAU, và chính chỗ lẫn chúng đã sinh ra lỗi ngày 16/09/2026.
 *
 *   A. "PHỤ HUYNH ĐÃ ĐÓNG BAO NHIÊU" -> `KHOAN_DA_DONG` (ròng). Bút toán hoàn là tiền
 *      ĐÃ TRẢ LẠI, nên phải trừ ra: PH cầm lại 2tr thì họ không còn "đã đóng" 2tr ấy.
 *   B. "GHI DANH CÒN NỢ BAO NHIÊU"  -> `computeEnrollmentDebt` (có NGOẠI LỆ, xem dưới).
 *
 * Nhồi `REFUNDED` vào một bộ lọc chung cho cả hai là bản vá NGÂY THƠ: nó trả lời đúng
 * câu A nhưng làm câu B đẻ NỢ MA (đo được 17/09/2026 — phép cấy I2, ca `[HT-E1b]`).
 */
export const KHOAN_DA_DONG = WHERE_THUC_THU;

/** Bản JS của `KHOAN_DA_DONG` — cho chỗ đã nạp sẵn danh sách rồi lọc trong bộ nhớ. */
export function laKhoanDaDong(p: {
  accountantStatus: string;
  deletedAt?: Date | null;
}): boolean {
  return (TRANG_THAI_THUC_THU as readonly string[]).includes(p.accountantStatus) && !p.deletedAt;
}

/** Tong tien PH thuc su da dong (da tru but toan hoan). THUAN. */
export function tongDaDong(rows: { amount: number }[]): number {
  return rows.reduce((s, p) => s + p.amount, 0);
}

/**
 * Ghi danh đã RỜI LỚP — nơi ngoại lệ của `computeEnrollmentDebt` áp dụng.
 *
 * COMPLETED KHÔNG nằm ở đây: học xong thì học phí vẫn phải đóng đủ.
 */
export const TRANG_THAI_ROI_LOP = ["WITHDREW", "TRANSFERRED", "CANCELLED"] as const;

/**
 * Công nợ 1 ghi danh = finalPrice − ĐÃ ĐÓNG. THUẦN.
 * Có thể ÂM (đóng thừa) — trả raw, caller tự bucket/hiển thị. finalPrice null → 0.
 *
 * ⚠️ MỘT NGOẠI LỆ, VÀ CHỈ MỘT: với ghi danh đã RỜI LỚP, bút toán HOÀN không được tính
 * vào phép trừ. Vì sao — `getDebtRows` lọc `deletedAt: null` nhưng KHÔNG lọc `status`,
 * nên ghi danh của học viên đã nghỉ vẫn nằm nguyên trong bảng công nợ. Lấy thẳng số
 * ròng làm công nợ thì em nghỉ-học-hoàn-đủ bỗng "nợ" đúng số vừa được hoàn, và hệ thống
 * đi đòi tiền một người vừa được trả lại tiền — ngay trên màn phụ huynh.
 *
 * Ngoại lệ KHÔNG áp cho bút toán ĐIỀU CHỈNH: sửa số ghi nhầm thì công nợ phải theo số
 * đúng, dù học viên còn học hay đã nghỉ.
 *
 * `enrollmentStatus` là tham số BẮT BUỘC (không mặc định): quên truyền = TypeScript đỏ,
 * chứ không phải âm thầm chạy nhánh sai (luật 7 — `docs/luat-doc-so-va-ket-luan.md`).
 */
export function computeEnrollmentDebt(
  finalPrice: number | null,
  butToan: { amount: number; accountantStatus: string }[],
  enrollmentStatus: string | null,
): number {
  const daRoiLop =
    enrollmentStatus != null &&
    (TRANG_THAI_ROI_LOP as readonly string[]).includes(enrollmentStatus);
  const rows = daRoiLop ? butToan.filter((p) => p.accountantStatus !== "REFUNDED") : butToan;
  return (finalPrice ?? 0) - tongDaDong(rows);
}

/**
 * Σ tiền ĐÃ XÁC NHẬN của một ghi danh — đọc thẳng DB.
 *
 * Khoá là `enrollmentId` và điều đó an toàn: `confirmPayment` từ chối xác nhận khoản
 * chưa gắn ghi danh, nên không có đồng tiền đã xác nhận nào nằm ngoài tầm với.
 */
export async function sumConfirmed(enrollmentId: string): Promise<number> {
  const r = await db.payment.aggregate({
    where: { enrollmentId, ...KHOAN_DA_XAC_NHAN },
    _sum: { amount: true },
  });
  return r._sum.amount ?? 0;
}

const DAY_MS = 86_400_000;

/** Bucket quá hạn theo dueDate vs now. THUẦN. dueDate null / chưa tới hạn → "none". */
export function overdueBucket(dueDate: Date | null, now: Date): "none" | "1-7" | "8-30" | ">30" {
  if (!dueDate) return "none";
  const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS);
  if (overdueDays <= 0) return "none";
  if (overdueDays <= 7) return "1-7";
  if (overdueDays <= 30) return "8-30";
  return ">30";
}

/** Số ngày nhắc hiệu lực: per-row override → fallback default setting. THUẦN. */
export function effectiveReminderDays(reminderDays: number | null, defaultDays: number): number {
  return reminderDays ?? defaultDays;
}

/**
 * Có đến hạn nhắc chưa: nhắc khi `dueDate − effectiveDays ≤ now`. THUẦN.
 * (Chống spam 1/ngày là lastReminderAt — tách khỏi quyết định này.)
 */
export function isReminderDue(dueDate: Date | null, effectiveDays: number, now: Date): boolean {
  if (!dueDate) return false;
  const remindFrom = dueDate.getTime() - effectiveDays * DAY_MS;
  return remindFrom <= now.getTime();
}

/** 1 dòng công nợ theo ghi danh (cho trang /admin/cong-no). */
export type DebtRow = {
  enrollmentId: string;
  studentId: string | null;
  studentName: string | null;
  courseName: string | null;
  centerId: string | null;
  finalPrice: number;
  confirmedPaid: number;
  debt: number;
  /**
   * TRỤC B — Σ `Payment` có `saleStatus = RECORDED`. Tiền vừa nhập từ sheet nằm ở đây và
   * nó CHƯA vào `confirmedPaid` cho tới khi kế toán xác nhận ở /payments.
   *
   * Thêm 14/09/2026, ADDITIVE: `debt` và `confirmedPaid` giữ nguyên công thức cũ nên hai
   * caller còn lại (`manager-dashboard`, nhóm tổng của /cong-no) không đổi một con số nào.
   */
  recordedPaid: number;
  /**
   * Ghi danh CHƯA có `finalPrice`. Chỉ có thể `true` khi người gọi truyền
   * `keCaChuaChotGia: true`; mặc định hàm vẫn lọc bỏ như trước.
   */
  chuaChotGia: boolean;
};

/**
 * Tổng hợp công nợ theo ghi danh — CHỈ tính Payment accountantStatus=CONFIRMED.
 * Nhận client đã scope (tầng action truyền scopedDb(actor) → cách ly cơ sở tự động).
 */
export async function getDebtRows(
  scopedDbClient: ScopedDb,
  filters?: {
    enrollmentId?: string;
    studentId?: string;
    /**
     * Lấy CẢ ghi danh chưa chốt giá (`finalPrice = null`).
     *
     * ⚠️ MẶC ĐỊNH `false` — giữ nguyên hành vi cũ cho hai caller đang có. Bật mặc định là
     * đổi con số tổng nợ trên dashboard quản lý mà không ai yêu cầu.
     *
     * Nhưng nhóm này KHÔNG được quên: nhà đã đóng tiền mà hệ thống không biết phải đóng
     * bao nhiêu ⇒ không ai nợ ai trong sổ, không màn nào kêu. Màn đối soát học phí bật cờ
     * này và hiện chúng thành một trạng thái riêng.
     */
    keCaChuaChotGia?: boolean;
  },
): Promise<DebtRow[]> {
  // G4 fix: lái theo ENROLLMENT (không theo payment) để ghi danh CHƯA đóng đồng nào
  // — nợ nhiều nhất — vẫn hiện. Cách ly cơ sở: lọc theo lớp NẰM TRONG scope của actor
  // (Class là SCOPED_MODEL → scopedDbClient.class.findMany tự inject centerId).
  const scopedClasses = await scopedDbClient.class.findMany({ select: { id: true } });
  const classIds = scopedClasses.map((c) => c.id);
  if (classIds.length === 0) return [];

  const enrollments = await db.enrollment.findMany({
    where: {
      classId: { in: classIds },
      // Mặc định chỉ ghi danh ĐÃ chốt giá (snapshot tại convert R7-05); `keCaChuaChotGia`
      // mở thêm nhóm chưa chốt — xem chú thích ở tham số.
      ...(filters?.keCaChuaChotGia ? {} : { finalPrice: { not: null } }),
      deletedAt: null, // FIX-C3
      ...(filters?.enrollmentId ? { id: filters.enrollmentId } : {}),
      ...(filters?.studentId ? { studentId: filters.studentId } : {}),
    },
    select: {
      id: true,
      finalPrice: true,
      tuition: true,
      studentId: true,
      student: { select: { name: true } },
      course: { select: { name: true } },
      class: { select: { centerId: true } },
      // FIX-C3: nested include không auto-scope → tự lọc payment đã xóa.
      // Câu B cần `status` — ngoại lệ "ghi danh đã RỜI LỚP thì không trừ bút toán
      // hoàn" của `computeEnrollmentDebt` đọc đúng cột này.
      status: true,
      //
      // ⚠️ NẠP CẢ BA TRỤC TRONG MỘT LƯỢT, lọc trong bộ nhớ. Prisma KHÔNG cho đặt bí danh
      // cho cùng một quan hệ hai lần, nên không thể viết `payments` (trục A) cạnh
      // `khoanDaGhiNhan` (trục B) cạnh khoản ĐÃ ĐÓNG (ròng). Lấy khoản còn sống rồi lọc
      // bằng chính các hằng điều kiện của repo — KHÔNG gõ tay `"CONFIRMED"`/`"RECORDED"`
      // ở đây, vì gõ tay là đẻ bản sao thứ hai của định nghĩa "đã thu".
      payments: {
        where: { deletedAt: null },
        select: { amount: true, accountantStatus: true, saleStatus: true },
      },
    },
  });

  return enrollments.map((e) => {
    const finalPrice = e.finalPrice ?? e.tuition ?? 0;
    // ── BA TRỤC, BA CÂU HỎI KHÁC NHAU. ĐỪNG GỘP LẠI. ────────────────────────────
    // Hợp nhất 18/09/2026: `main` dựng trục A/B cho màn đối soát, `test` dựng số RÒNG
    // cho công nợ (NỢ-4). Cả ba cùng sống, mỗi cái trả lời đúng một câu:
    //
    //   A. `daXacNhan` — "kế toán đã xác nhận tổng bao nhiêu" (GỘP, không trừ hoàn).
    //   B. `daGhiNhan` — "sale đã ghi nhận tổng bao nhiêu".
    //   RÒNG `daDong`  — "phụ huynh thực sự đã đóng bao nhiêu" (ĐÃ trừ bút toán hoàn).
    //
    // 🔴 `confirmedPaid` PHẢI GIỮ TRỤC A — đừng "sửa" nó thành ròng cho gọn. Màn
    // `/cong-no` đọc nó làm cột `daXacNhan` rồi đặt cạnh `daGhiNhan` để ra số CHỜ XÁC
    // NHẬN (B − A). Một vế ròng còn vế kia gộp là đẻ báo động giả "chờ xác nhận âm" trên
    // mọi ghi danh từng hoàn tiền. Đã thử đúng hướng đó ngày 17/09 trên màn đơn hàng và
    // phải hoàn nguyên.
    //
    // Bản vá tiền của NỢ-4 KHÔNG nằm ở `confirmedPaid` mà ở `debt` ngay dưới.
    //
    // Lọc bằng chính hằng điều kiện của repo để hai đường (query và bộ nhớ) không lệch.
    const daXacNhan = e.payments.filter(
      (p) => p.accountantStatus === KHOAN_DA_XAC_NHAN.accountantStatus,
    );
    // ⚠️ Dùng HÀM, không so với `KHOAN_DA_GHI_NHAN.saleStatus`: từ 14/09 trường đó là
    // `{ in: [...] }`, nên phép so chuỗi-với-đối-tượng luôn false và cột "đã ghi nhận"
    // im lặng về 0 cho mọi dòng công nợ.
    const daGhiNhan = e.payments.filter(laKhoanDaGhiNhan);
    const daDong = e.payments.filter(laKhoanDaDong);
    const confirmedPaid = tongDaXacNhan(daXacNhan);
    return {
      enrollmentId: e.id,
      studentId: e.studentId,
      studentName: e.student?.name ?? null,
      courseName: e.course?.name ?? null,
      centerId: e.class?.centerId ?? null,
      finalPrice,
      confirmedPaid,
      // 🔴 NỢ-4 — KHÔNG phải `finalPrice - confirmedPaid`. Hai lý do, cả hai đã đo:
      //   · `confirmedPaid` là trục A (GỘP) nên phép trừ thẳng bỏ qua tiền đã hoàn;
      //   · và ngay cả với số ròng, vẫn phải áp ngoại lệ "ghi danh đã RỜI LỚP thì không
      //     trừ bút toán hoàn", nếu không sẽ đẻ NỢ MA đúng bằng số vừa hoàn cho học viên
      //     đã nghỉ — hệ thống đi đòi tiền một người vừa được trả lại tiền.
      // Đo 17/09/2026 bằng ca `[HT-E1b]`; phép cấy I2 chứng minh bản vá ngây thơ (nhồi
      // REFUNDED vào một bộ lọc chung) làm đúng ca đó đỏ.
      debt: computeEnrollmentDebt(finalPrice, daDong, e.status),
      recordedPaid: tongDaXacNhan(daGhiNhan),
      chuaChotGia: e.finalPrice == null,
    };
  });
}

/** Order quá hạn chưa thanh toán (cho cron nhắc nợ C6.2). */
export async function getOverdueOrders(opts: { olderThanDays?: number; now?: Date } = {}): Promise<Order[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.olderThanDays ?? 7) * 86_400_000);
  return db.order.findMany({
    where: { status: "PENDING_PAYMENT", createdAt: { lt: cutoff }, deletedAt: null }, // FIX-C3
    orderBy: { createdAt: "asc" },
  });
}

/**
 * C6.3 — nhắc nợ cho ĐƠN LẺ (trả 1 lần, không trả góp) qua email/Resend.
 * Bỏ qua đơn có installments (đã được /api/cron/debt-reminder lo). Chống spam 1 lần/ngày.
 */
export async function remindOverdueSingleOrders(
  opts: { olderThanDays?: number; now?: Date } = {},
): Promise<{ found: number; sent: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const orders = await getOverdueOrders({ olderThanDays: opts.olderThanDays, now });

  /**
   * ── BƯỚC A3 [16/09/2026]: KHÔNG NHẮC NỢ TỪ ĐƠN MANG TÊN CON NHÀ KHÁC ─────────
   *
   * Chủ dự án: *"đơn nhiễm: không phát QR, không nhắc nợ ZNS… gửi ra ngoài là lộ thông
   * tin."* Tin nhắc nợ đi THẲNG tới phụ huynh, nên nó cùng loại rủi ro với mã QR.
   *
   * Hỏi MỘT LẦN cho cả lô (`donNhiemTheoDon` nhận cả tập), không hỏi trong vòng lặp.
   *
   * ⚠️ `db` trần là ĐÚNG ở đây: cron chạy không có actor, và một cổng an toàn bị lọc theo
   * tầm nhìn sẽ coi đơn nhiễm ngoài tầm nhìn là SẠCH.
   *
   * ⚠️ CHỈ chặn tiêu chí CON_NHÀ_KHÁC (`chanGuiRaNgoai`). Dữ liệu PROD 16/09: 18 đơn kẹt
   * tiền (178.544.000đ) chỉ dính tiêu chí nhẹ — chặn theo `nhiem` là im lặng thôi nhắc nợ
   * 18 khách vì một lỗi nội bộ, tức hệ thống tự bỏ đòi tiền mà không ai biết.
   */
  const nhiem = await donNhiemTheoDon(db, orders.map((o) => o.id));

  // Phiên 1 bảo lưu: phụ huynh có con ĐANG BẢO LƯU không bị nhắc nợ (BR-16). Hỏi MỘT LẦN cho cả lô.
  const dangBaoLuu = await locDonDangBaoLuu(orders.map((o) => o.id), now);

  let sent = 0;
  let skipped = 0;
  for (const o of orders) {
    const dn = nhiem.get(o.id);
    if (dn && chanGuiRaNgoai(dn)) { skipped++; continue; }
    if (dangBaoLuu.has(o.id)) { skipped++; continue; }
    if (!o.customerEmail) { skipped++; continue; }
    const installmentCount = await db.orderInstallment.count({ where: { orderId: o.id } });
    if (installmentCount > 0) { skipped++; continue; } // trả góp → cron installment lo

    const remindedToday = await db.emailQueue.findFirst({
      where: { contextType: "DEBT_REMINDER_ORDER", contextId: o.id, createdAt: { gte: startOfToday } },
      select: { id: true },
    });
    if (remindedToday) { skipped++; continue; } // chống spam 1/ngày

    await enqueueDebtReminder({
      to: o.customerEmail,
      customerName: o.customerName,
      orderId: o.id,
      orderCode: o.code,
      amount: o.totalAmount,
    });
    sent++;
  }
  return { found: orders.length, sent, skipped };
}

/**
 * Số ngày nhắc trước hạn MẶC ĐỊNH cho trả góp khi installment không override
 * (`reminderDays = null`). Khớp default của SystemSetting `finance.debtReminderDaysBefore`
 * (= 14). Caller (cron) có thể truyền `defaultReminderDays` từ getSetting để override.
 */
const DEFAULT_INSTALLMENT_REMINDER_DAYS = 14;

/**
 * R7 P2 — nhắc nợ cho ĐỢT TRẢ GÓP (OrderInstallment PENDING) qua email/Resend.
 * Bổ sung cho remindOverdueSingleOrders (đơn lẻ) — phủ luôn cả đợt 1 lẫn đợt 2.
 * Mỗi đợt đến hạn nhắc khi `dueDate − (reminderDays ?? default) ≤ now`, gửi qua
 * enqueueDebtReminder rồi set `lastReminderAt = now`. Chống spam: tối đa 1 nhắc/ngày
 * (lastReminderAt cùng ngày UTC với now → skip). Đợt không có email → skip.
 */
export async function remindOverdueInstallments(
  opts: { now?: Date; defaultReminderDays?: number } = {},
): Promise<{ found: number; sent: number; skipped: number }> {
  const now = opts.now ?? new Date();
  const defaultDays = opts.defaultReminderDays ?? DEFAULT_INSTALLMENT_REMINDER_DAYS;
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const installments = await db.orderInstallment.findMany({
    where: {
      status: "PENDING",
      dueDate: { not: null },
      order: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
    },
    select: {
      id: true,
      amount: true,
      dueDate: true,
      reminderDays: true,
      lastReminderAt: true,
      order: { select: { id: true, code: true, customerName: true, customerEmail: true } },
    },
  });

  // Cùng cổng A3 với `remindOverdueSingleOrders` — chặn một cron mà để hở cron kia thì
  // đơn nhiễm vẫn nhắn ra ngoài, chỉ đổi đường. Hỏi MỘT LẦN cho cả lô.
  const nhiem = await donNhiemTheoDon(db, installments.map((i) => i.order.id));

  // Phiên 1 bảo lưu: `OrderInstallment` là SỔ CŨ — `apDungDoiHanBaoLuu` chỉ dời hạn `PaymentRequest`
  // nên hạn ở đây KHÔNG dời theo. Chặn ở đầu ĐỌC thay vì dời hạn sổ cũ (chủ dự án chốt 07/10/2026).
  const dangBaoLuu = await locDonDangBaoLuu(installments.map((i) => i.order.id), now);

  let found = 0;
  let sent = 0;
  let skipped = 0;
  for (const inst of installments) {
    const dn = nhiem.get(inst.order.id);
    if (dn && chanGuiRaNgoai(dn)) { skipped++; continue; }
    if (dangBaoLuu.has(inst.order.id)) { skipped++; continue; }
    const days = effectiveReminderDays(inst.reminderDays, defaultDays);
    if (!isReminderDue(inst.dueDate, days, now)) continue; // chưa đến mốc nhắc
    found++;

    // Chống spam: đã nhắc trong ngày UTC hôm nay → skip.
    if (inst.lastReminderAt && inst.lastReminderAt >= startOfToday) { skipped++; continue; }

    const email = inst.order.customerEmail?.trim() || null;
    if (!email) { skipped++; continue; } // không có email → skip

    await enqueueDebtReminder({
      to: email,
      customerName: inst.order.customerName,
      orderId: inst.order.id,
      orderCode: inst.order.code,
      amount: inst.amount,
    });
    await db.orderInstallment.update({ where: { id: inst.id }, data: { lastReminderAt: now } });
    sent++;
  }
  return { found, sent, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// CÔNG NỢ THEO TỪNG CON — PHIÊN A (16/09/2026)
//
// Chủ dự án chốt: *"Công nợ con = học phí thực − đã thu; công nợ đơn = Σ các con. Tính một
// chỗ trong debt.ts."* Đây là chỗ đó. Phép tính THUẦN ở `lib/finance/no-theo-con.ts`; ở đây
// chỉ có phần đọc DB.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG QUA `scopedDb` — VÀ ĐÓ LÀ YÊU CẦU, KHÔNG PHẢI SƠ SUẤT.
//
// Chủ dự án chốt: *"KHÔNG lọc theo scopedDb/cơ sở của người xem: cùng một đơn, ai mở cũng ra
// cùng con số."*
//
// Vì sao luật đó quan trọng đến mức phải viết ra: `Payment` nằm trong `SCOPED_MODELS` và KHÔNG
// nằm trong `NULL_IS_GLOBAL_MODELS` (`lib/db-scope.ts`). Nghĩa là một khoản có `centerId` khác
// — hoặc `centerId = NULL` — sẽ bị `scopedDb` LỌC MẤT với người cấp cơ sở. Hệ quả đo được:
// **con số "đã thu" của cùng một đơn KHÁC NHAU tuỳ ai mở màn**, và không lỗi nào báo. Một phụ
// huynh bị hai nhân viên nói hai số nợ khác nhau là thứ không sửa được bằng bản vá.
//
// Cách ly cơ sở vẫn còn nguyên, chỉ là nó ép ở CỬA VÀO: trang đơn đã gác quyền `orders:view` +
// `scopedDb` khi tra chính cái đơn đó. Ai mở được đơn thì thấy đủ tiền của đơn đó — đúng.
// ─────────────────────────────────────────────────────────────────────────────

import {
  kiemHuyDot,
  kiemTaoDot,
  tinhNoTheoCon,
  type DotCuaDong,
  type NoTheoConKetQua,
} from "@/lib/finance/no-theo-con";

export { kiemHuyDot, kiemTaoDot };
export type { NoCuaCon, NoTheoConKetQua } from "@/lib/finance/no-theo-con";

/**
 * Công nợ từng con của một đơn.
 *
 * Tập trạng thái `Payment` được cộng — nói rõ một lần, dùng ở mọi chỗ gọi:
 *   · `daThu`      = TRỤC A — `KHOAN_DA_XAC_NHAN` (`accountantStatus: CONFIRMED`, chưa xoá mềm)
 *   · `choXacNhan` = TRỤC B trừ đi trục A — đã ghi nhận nhưng kế toán chưa xác nhận
 * Lý do chọn trục A cho `conNo`: xem đầu `lib/finance/no-theo-con.ts`.
 */
/**
 * Client tối thiểu để đọc ba bảng của công nợ theo con. `db` trần HOẶC một `tx` đang mở.
 *
 * ⚠️ Tồn tại vì PHIÊN B: đường GHI phải đọc lại công nợ **bên trong** transaction đang giữ
 * advisory lock của đơn, nếu không thì hai lệnh song song cùng đọc một con số cũ rồi cùng ghi.
 */
export type DocSoTheoCon = Pick<Prisma.TransactionClient, "orderItem" | "payment" | "paymentRequest">;

/**
 * Thân thật của `noTheoCon`, nhận client làm THAM SỐ BẮT BUỘC.
 *
 * Không đặt mặc định `= db` (luật 7): mặc định ở đây là "đọc ngoài khoá", đúng cái sai mà
 * PHIÊN B sinh ra để sửa. Bắt buộc truyền ⇒ `tsc` liệt kê đủ chỗ gọi, mắt thấy 1 thì trình
 * biên dịch thấy hết.
 */
export async function docSoTheoCon(
  doc: DocSoTheoCon,
  orderId: string,
): Promise<NoTheoConKetQua> {
  const [dong, khoan, dot] = await Promise.all([
    doc.orderItem.findMany({
      where: { orderId },
      select: {
        id: true,
        itemName: true,
        totalPrice: true,
        discountAmount: true,
        // PHIÊN D — bé đã dừng học thì phải thu đọc `usedValue`. `status` phải lấy CÙNG
        // câu tra: suy "đã dừng" từ `usedValue != null` là tin vào một cột phụ, và cột phụ
        // thì có ngày được ghi vì lý do khác.
        status: true,
        usedValue: true,
        // ── DANH TÍNH CON [25/09/2026] ───────────────────────────────────────────
        // Chủ dự án: *"2 con học cùng khoá thì sao biết là đang giảm đơn cho con nào?"*
        // Không biết được — nhãn dòng là `itemName`, mà trên `/orders/new` cột đó là tên
        // KHOÁ. Ba trường dưới là ĐƯỜNG DUY NHẤT ra được tên bé.
        //
        // ⚠️ Cả ba MIỄN PHÍ về số lượt đi-về: `student` là join trên chính câu tra này,
        // `enrollment` vốn đã join sẵn (chỉ thêm một cột con), `metadata` là cột vô hướng.
        // Hàm này chạy TRONG transaction của mọi phép ghi tiền nên một lượt đi-về thêm ở
        // đây là thêm thời gian nằm dưới khoá đơn — xem luật "độ sâu tuần tự". Vì vậy
        // `LeadChild.fullName` KHÔNG tra ở đây: trang tự gom lô (xem
        // `lib/orders/ten-con-tren-dong.ts`).
        student: { select: { name: true } },
        metadata: true,
        enrollment: {
          select: {
            student: { select: { name: true } },
            class: { select: { course: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    doc.payment.findMany({
      where: { orderId, deletedAt: null },
      select: {
        id: true,
        orderItemId: true,
        amount: true,
        accountantStatus: true,
        saleStatus: true,
        // Hai cột dưới CHỈ phục vụ `KhoanDaVe.loaiButToan` / `.daDao` — tức chỉ để màn hình
        // biết dòng nào còn mời bấm được. Chúng KHÔNG vào phép cộng nào; xem `KhoanDaVe`.
        paymentType: true,
        adjustmentOfId: true,
      },
    }),
    doc.paymentRequest.findMany({
      where: { orderId },
      select: {
        id: true,
        orderItemId: true,
        installmentNo: true,
        amountDue: true,
        dueDate: true,
        status: true,
        allocations: { select: { amount: true } },
      },
    }),
  ]);

  // Lọc TRONG BỘ NHỚ bằng đúng các hàm chuẩn, thay vì nhiều câu `where` riêng: một câu tra
  // thì không có cách nào để các tập lệch định nghĩa nhau.
  const daXacNhan = khoan.filter((k) => laKhoanDaXacNhan(k));
  const choXacNhan = khoan.filter((k) => laKhoanDaGhiNhan(k) && !laKhoanDaXacNhan(k));
  /**
   * Tập RỘNG cho VẾ ĐƠN của cổng tạo đợt — xem `KhoanDaVe` trong `no-theo-con.ts`.
   *
   * Câu tra ở trên đã lọc `deletedAt: null`, nên ở đây chỉ còn đúng MỘT điều kiện: bỏ khoản
   * kế toán đã TỪ CHỐI. `REFUNDED` thì GIỮ (hoàn tiền là một dòng âm riêng, cộng vào là tự
   * triệt tiêu); `paymentType` không lọc (bút toán đảo mang số âm và phải được trừ ra).
   *
   * ⚠️ Cố ý KHÔNG dùng `KHOAN_DA_GHI_NHAN` của trục B: trục B **đếm cả khoản `REJECTED`**
   * (nợ đã đo, ghim `[HT-05]` bằng `it.fails`, chưa vá vì nó nuôi 4 đường tiền khác). Đây là
   * chỗ DUY NHẤT trong repo lọc đúng, và nó chỉ nuôi một cái cổng — không đổi hành vi gì
   * khác.
   */
  const daVe = khoan.filter((k) => k.accountantStatus !== "REJECTED");

  /**
   * Dòng nào ĐÃ bị một bút toán đảo còn sống trỏ vào.
   *
   * Tính TRONG BỘ NHỚ từ chính tập vừa tra, không thêm một câu SQL nào: `khoan` đã là toàn
   * bộ `Payment` chưa xoá mềm của đơn, nên mọi bút toán đảo của đơn đều nằm trong đó.
   *
   * ⚠️ Quét trên `khoan` (ĐỦ) chứ không trên `daVe` (đã lọc `REJECTED`): một bút toán đảo bị
   * kế toán từ chối vẫn là bằng chứng rằng dòng gốc đã được đảo một lần. Lọc trước rồi mới
   * quét là để sót, và hậu quả là màn hình lại mời gắn một dòng đã đảo.
   */
  const daBiDao = new Set(
    khoan.filter((k) => k.paymentType === "ADJUSTMENT" && k.adjustmentOfId).map((k) => k.adjustmentOfId as string),
  );

  return tinhNoTheoCon({
    dong: dong.map((d) => ({
      orderItemId: d.id,
      ten: d.itemName,
      khoa: d.enrollment?.class?.course?.name ?? null,
      // Tên bé — `null` là ca THƯỜNG (đơn từ lead chưa chốt), không phải ca lỗi.
      tenHocVien: d.student?.name ?? d.enrollment?.student?.name ?? null,
      // Con của lead. Đọc bằng hàm CÓ SẴN, không tự bóc `metadata` bằng tay: cột `Json?`
      // này có bốn đường ghi và chỉ một đường qua zod.
      leadChildId: docConLeadTuMetadata(d.metadata),
      tamTinh: d.totalPrice,
      giam: d.discountAmount,
      // Chỉ dòng ĐÃ DỪNG mới đưa `usedValue` vào. Dòng còn học mà cột này lỡ có số (dữ
      // liệu rác / một đường ghi tương lai) thì KHÔNG được làm tụt phải thu của bé.
      daDung: d.status === "STOPPED" ? (d.usedValue ?? 0) : null,
    })),
    khoanDaXacNhan: daXacNhan.map((k) => ({ orderItemId: k.orderItemId, amount: k.amount })),
    khoanChoXacNhan: choXacNhan.map((k) => ({ orderItemId: k.orderItemId, amount: k.amount })),
    khoanDaVe: daVe.map((k) => ({
      id: k.id,
      orderItemId: k.orderItemId,
      amount: k.amount,
      trangThaiKeToan: k.accountantStatus,
      loaiButToan: k.paymentType,
      daDao: daBiDao.has(k.id),
    })),
    dot: dot.map(
      (r): DotCuaDong => ({
        id: r.id,
        orderItemId: r.orderItemId,
        installmentNo: r.installmentNo,
        amountDue: r.amountDue,
        dueDate: r.dueDate,
        trangThai: r.status,
        daRot: r.allocations.reduce((s, a) => s + a.amount, 0),
      }),
    ),
  });
}

/**
 * Công nợ theo từng con của một đơn — bản dùng cho ĐỌC HIỂN THỊ.
 *
 * ⚠️ `db` TRẦN, không `scopedDb`, theo chốt của chủ dự án: *"cùng một đơn, ai mở cũng ra cùng
 * con số"*. `Payment` ∈ `SCOPED_MODELS` và ∉ `NULL_IS_GLOBAL_MODELS`, nên đọc qua `scopedDb` là
 * một khoản mang `centerId` khác — hoặc NULL — bị LỌC MẤT với người cấp cơ sở, và con số "đã
 * thu" của cùng một đơn khác nhau tuỳ ai mở màn, không lỗi nào báo. Cách ly cơ sở ép ở CỬA VÀO
 * (`orders:view` + `scopedDb` khi tra chính cái đơn).
 *
 * ⚠️ KHÔNG dùng hàm này ở đường GHI — nó đọc ngoài transaction. Đường ghi gọi `docSoTheoCon(tx, …)`
 * bên trong `ghiTienChoDon` (`lib/finance/ghi-tien-don.ts`).
 */
export async function noTheoCon(orderId: string): Promise<NoTheoConKetQua> {
  return docSoTheoCon(db, orderId);
}
