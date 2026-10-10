import "server-only";
import type { InstallmentApprovalStatus, OrderStatus, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { assertCan } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit-log";
import { ensureOrderPaymentRecorded } from "@/lib/finance/payment";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { laThuTienLinhHoatBat } from "@/lib/finance/feature";
// 03/08 — SỔ MỚI (PaymentRequest) chạy SONG SONG sổ cũ (OrderInstallment).
// Sổ cũ giữ nguyên hành vi (đợt 1 = PAID) để không phá công nợ đang chạy; sổ mới
// ⚠️ 03/08 luật ĐÃ ĐỔI: phiếu theo đợt sinh NGAY khi lưu kế hoạch (không chờ duyệt),
// vẫn ở trạng thái PENDING. "Duyệt" nay chỉ có nghĩa KHOÁ kế hoạch.
import {
  ensureFullOrderRequest,
  materializeInstallmentRequests,
  revertInstallmentRequests,
} from "@/lib/payments/payment-request";
// Điều kiện "kế hoạch còn hiệu lực" — DÙNG CHUNG với `computeDueNow`. Hai bên lệch
// nhau là nhận tiền một đằng, ghi sổ một nẻo (xem file đó).
import { isInstallmentPlanActive } from "@/lib/payments/installment-plan";
// Sổ đăng ký marker + phép ghi phần chênh — MỘT chỗ (DS-03 + R-01, 13/09/2026).
import { planOwnedNoteOr } from "@/lib/finance/payment-markers";
// R-02 — cổng chặn việc lưu kế hoạch làm mất dấu tiền khách đã đóng (thuần).
import { keHoachLamMatTien } from "@/lib/payments/plan-money-guard";
// R-03 — cổng chặn lời khai "đã thu" vượt sổ của đơn (thuần). KHÁC R-02: R-02 canh tiền
// SẮP MẤT DẤU, cổng này canh tiền SẮP ĐƯỢC ĐÚC THÊM. Xem lib/payments/khai-da-thu.ts.
import { khaiDaThuVuotSo } from "@/lib/payments/khai-da-thu";
// Khoá đơn — CÙNG khoá mọi đường tiền (`thuTheoPhieuGop`, `allocateToOrder`, gắn/gỡ tay) đang giữ.
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { thongDiepPhieuDaSoat, type PhieuDaSoatTom } from "@/lib/finance/soat-phieu-gop";
import { donDangThuTheoCon, LY_DO_DON_THU_THEO_CON } from "@/lib/payments/phieu-se-huy-ke-hoach";
import {
  kiemKeHoachDot,
  phanBoGhiTheoDot,
  TRAN_SO_DOT,
} from "@/lib/payments/ke-hoach-dot";
import { laDonPhiHocBu, LY_DO_KHONG_TRA_GOP_PHI_BU } from "@/lib/hoc-bu/don-phi";

// =============================================================================
// Commit 4 — thanh toán TỐI ĐA 2 ĐỢT cho 1 Order.
//  - Đợt 1: số tiền đã thu + thời gian đóng (paidAt = lúc ghi nhận).
//  - Đợt 2: số tiền còn lại + ngày hẹn đóng (dueDate).
//  - Tổng 2 đợt = totalAmount của Order. Cập nhật Order.paidAt + status.
// =============================================================================

export async function getOrderInstallments(orderId: string) {
  return db.orderInstallment.findMany({
    where: { orderId },
    orderBy: { soDot: "asc" },
    select: { id: true, soDot: true, amount: true, status: true, dueDate: true, paidAt: true, lastReminderAt: true },
  });
}

/**
 * Tính lại Order.paidAt/status từ tổng các đợt đã PAID.
 *
 * ⚠️ CHỈ ĐỘNG VÀO BA TRẠNG THÁI [sửa 14/09/2026]. Trước bản này câu ghi là
 * `db.order.update({ where: { id: orderId } })` KHÔNG lọc trạng thái hiện tại, nên nó:
 *  · kéo đơn `CANCELLED` / `REFUNDED` ngược về `CONFIRMED` (lưu kế hoạch trên đơn đã huỷ
 *    là đơn sống lại, kèm `paidAt` mới);
 *  · đẩy đơn `COMPLETED` (đã bàn giao, đã ghi danh) ngược về `PENDING_PAYMENT` chỉ vì
 *    kế hoạch vừa thêm một đợt chưa thu.
 * Cả hai đều KHÔNG để lại dấu vết nào: hàm này cũng không ghi `OrderStatusHistory` lẫn
 * `AuditLog`, trong khi `updateOrderStatusAction` (`orders/_actions.ts:720`) thì có.
 *
 * Khuôn lấy từ `recomputeRequestStatuses` (`lib/payments/payment-request.ts:452`):
 * `canConfirm = status === "PENDING_PAYMENT" || status === "DRAFT"`. Thêm `CONFIRMED` vào
 * tập ĐƯỢC CHẠM vì đó là trạng thái chính hàm này đặt ra — sửa kế hoạch xuống dưới tổng
 * đơn thì đơn phải quay về chờ thu, nếu không `CONFIRMED` thành một chiều không quay lại.
 *
 * `COMPLETED` / `CANCELLED` / `REFUNDED` thì KHÔNG chạm gì — kể cả `paidAt`. Đặt
 * `paidAt: null` trên một đơn đã hoàn tiền cũng là xoá một sự thật, chỉ lặng lẽ hơn.
 */
const TRANG_THAI_RECOMPUTE_DUOC_CHAM = ["DRAFT", "PENDING_PAYMENT", "CONFIRMED"] as const;

async function recomputeOrder(orderId: string, actorId: string | null): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { totalAmount: true, status: true },
  });
  if (!order) return;
  if (!(TRANG_THAI_RECOMPUTE_DUOC_CHAM as readonly string[]).includes(order.status)) return;

  const paid = await db.orderInstallment.aggregate({
    where: { orderId, status: "PAID" },
    _sum: { amount: true },
    _max: { paidAt: true },
  });
  const paidTotal = paid._sum.amount ?? 0;
  const duTien = paidTotal >= order.totalAmount;
  const trangThaiMoi: OrderStatus = duTien ? "CONFIRMED" : "PENDING_PAYMENT";

  await db.order.update({
    where: { id: orderId },
    data: {
      paidAt: duTien ? paid._max.paidAt ?? new Date() : null,
      status: trangThaiMoi,
    },
  });

  // Đổi trạng thái đơn phải có dấu vết — cùng bảng mà màn `/orders/<id>` đang đọc
  // (`orders/[id]/page.tsx:96`), nên không cần bảng mới và không cần nới quyền nào.
  // Chỉ ghi khi THẬT SỰ đổi: `recomputeOrder` chạy sau mỗi lần lưu kế hoạch và mỗi lần
  // đánh dấu đợt đã đóng, ghi cả lượt không đổi là chôn dòng có ý nghĩa dưới nhiễu.
  if (trangThaiMoi !== order.status) {
    await db.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: trangThaiMoi,
        changedByUserId: actorId,
        // Không phải người bấm nút đổi trạng thái — đây là hệ quả của việc sửa kế hoạch
        // đợt. Nói thẳng ra trong tên để người đọc nhật ký không đi tìm một cú bấm
        // không tồn tại.
        changedByName: "Tự động — tính lại theo kế hoạch đợt",
        reason: duTien
          ? `Tổng các đợt đã thu ${paidTotal.toLocaleString("vi-VN")}đ ≥ tổng đơn`
          : `Tổng các đợt đã thu ${paidTotal.toLocaleString("vi-VN")}đ < tổng đơn`,
      },
    });
  }
}

/**
 * Ghi/ghi đè kế hoạch 2 đợt. dot1Amount đã thu (PAID ngay), dot2 còn lại (PENDING,
 * dueDate hẹn). Nếu dot2Amount=0 → chỉ 1 đợt (đã đóng đủ).
 */
// `InstallmentMoneyBlocked` ĐÃ DỜI sang `lib/payments/plan-money-guard.ts` [15/09/2026]
// — cổng A6 phải ném cùng lớp lỗi này từ `materializeInstallmentRequests`, mà tệp đó
// không nhập ngược được vào đây (vòng nhập). Xuất lại để mọi chỗ gọi cũ không đổi.
// ⚠️ NHẬP rồi XUẤT LẠI, không dùng `export … from`: dạng đó tái xuất được nhưng KHÔNG
// đưa tên vào phạm vi cục bộ, mà tệp này còn `throw new InstallmentMoneyBlocked(...)`
// ở bốn chỗ (tsc báo đúng bốn lỗi khi thử).
import { InstallmentMoneyBlocked } from "@/lib/payments/plan-money-guard";
import { KHOAN_CHUA_KHOA_HOA_DON } from "@/lib/finance/hoa-don/khoa-khoan";
export { InstallmentMoneyBlocked };

export type DotGhi = {
  amount: number;
  /** Đợt này sale đã thu tiền rồi (ghi Ledger-A ngay). */
  daThu: boolean;
  dueDate: Date | null;
  /** Số ngày nhắc trước hạn; null → cron dùng SystemSetting default. */
  reminderDays?: number | null;
};

export async function recordInstallmentPlan(params: {
  orderId: string;
  /**
   * KẾ HOẠCH N ĐỢT — đường MỚI [14/09/2026].
   *
   * Chủ dự án chốt đổi "thanh toán 2 đợt" thành đóng theo 1/2/3/4 học phần. Trần 2 đợt
   * chưa bao giờ nằm ở kiểu dữ liệu (`soDot` là `Int`, sổ mới + QR + portal + webhook đã
   * n-đợt sạch) — nó nằm ở chữ ký hàm này và vài chốt mã. Xem `lib/payments/ke-hoach-dot.ts`.
   */
  dots?: DotGhi[];
  /**
   * @deprecated Đường CŨ 2 đợt — giữ để 15 chỗ gọi trong bộ e2e không vỡ cùng lượt.
   * Nội bộ quy ngay về `dots`; `dots` thắng khi cả hai cùng có.
   * TODO: gỡ sau khi chuyển các spec sang `dots`.
   */
  dot1Amount?: number;
  /** @deprecated xem `dot1Amount`. */
  dot2Amount?: number;
  /** @deprecated xem `dot1Amount`. */
  dot2DueDate?: Date | null;
  actorId: string | null;
  /** @deprecated xem `dot1Amount` — nay khai theo từng đợt trong `dots`. */
  reminderDays?: number | null;
}): Promise<{ ok: boolean; error?: string; thongDiepPhieu?: string | null }> {
  const { orderId, actorId } = params;

  // Quy đường cũ về đường mới NGAY, để phần dưới chỉ còn MỘT hình dạng dữ liệu.
  const dots: DotGhi[] =
    params.dots ??
    (() => {
      const d1 = Math.max(0, Math.round(params.dot1Amount ?? 0));
      const d2 = Math.max(0, Math.round(params.dot2Amount ?? 0));
      const ra: DotGhi[] = [{ amount: d1, daThu: d1 > 0, dueDate: null }];
      if (d2 > 0) {
        ra.push({
          amount: d2,
          daThu: false,
          dueDate: params.dot2DueDate ?? null,
          reminderDays: params.reminderDays ?? null,
        });
      }
      return ra;
    })();

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      code: true,
      totalAmount: true,
      centerId: true,
      orgUnitId: true,
      leadId: true,
      items: { select: { type: true } },
    },
  });
  if (!order) return { ok: false, error: "Không tìm thấy đơn" };
  // Đơn phí học bù: đóng MỘT lần qua phiếu toàn đơn — cổng ở ĐÂY che cả hai đường ghi kế hoạch
  // (action trên màn đơn + lúc tạo đơn), đứng TRƯỚC mọi phép ghi.
  if (laDonPhiHocBu(order.items)) return { ok: false, error: LY_DO_KHONG_TRA_GOP_PHI_BU };

  // ⚠️ ĐÃ THAY [14/09/2026] — KHÔNG gỡ trắng, ĐỔI KHOÁ.
  //
  // Trước: "kế hoạch đã DUYỆT thì không sửa" (chốt 03/08, duyệt = khoá). Cơ chế duyệt đã
  // bỏ nên khoá đó không còn cửa nào để bám. Nhưng thứ nó bảo vệ vẫn thật: phiếu thu và
  // mã QR đã phát cho khách bám theo kế hoạch, sửa sau lưng là tiền về một đằng sổ ghi
  // một nẻo.
  //
  // Khoá MỚI không hỏi ai đã bấm duyệt, nó hỏi TIỀN: cổng R-02 (`keHoachLamMatTien`)
  // chạy bên dưới, TRƯỚC khi `materializeInstallmentRequests` VOID phiếu "thu toàn đơn".
  // Chặt hơn khoá cũ — cờ duyệt có thể chưa ai bấm trong khi tiền đã về.

  const kiem = kiemKeHoachDot(dots, order.totalAmount);
  if (!kiem.ok) return { ok: false, error: kiem.error };
  // ⚠️ `coDotChuaThu`, KHÔNG phải `dots.length > 1`. Kế hoạch MỘT đợt trả sau là 100% nợ
  // và phải đi qua đúng những cổng mà kế hoạch nhiều đợt đi qua; đếm số đợt thì nó lọt,
  // và sale tự cấp tín dụng toàn bộ học phí mà không cổng nào thấy.
  const coDotChuaThu = kiem.coDotChuaThu;

  const now = new Date();

  // PHIÊN A (16/09/2026) — đọc CÔNG TẮC trước transaction. `getSetting` có câu tra DB riêng;
  // gọi nó BÊN TRONG transaction là giữ transaction mở trong lúc chờ một truy vấn không liên
  // quan, và transaction của đường ghi tiền là thứ phải ngắn nhất có thể.
  //
  // Đọc theo `orgUnitId` của CƠ SỞ GIỮ ĐƠN, không theo người đang bấm: một đơn của cơ sở đã
  // bật luồng mới phải được bảo vệ kể cả khi người bấm thuộc cơ sở khác.
  const batLuongMoi = await laThuTienLinhHoatBat(order.orgUnitId);

  // Phiếu gộp bị soát khi VOID đợt "thu toàn đơn" — lên toast (rà vòng 4, luật 12).
  let phieuDaSoat: PhieuDaSoatTom[] = [];
  const chan = await db.$transaction(async (tx) => {
    // Rà vòng 4 (30/09/2026) — câu ĐẦU TIÊN, trước mọi phép ghi. Lưu kế hoạch VOID đợt "thu toàn
    // đơn" + soát phiếu gộp; không giữ khoá đơn thì nó không loại trừ lượt thu đang giữ khoá
    // (`thuTheoPhieuGop` đã qua cổng đợt VOID với ảnh chụp cũ) ⇒ tiền rót vào đợt VOID, đợt mới
    // đòi lại đủ học phí, phiếu bị ghi VOID "chưa nhận đồng nào". Dưới khoá, R-02 + soát đọc tiền
    // ĐÃ commit. Ca `[V3-06]`, lưới `[KDK-W1]`.
    await khoaDonTrongTx(tx, orderId);
    // Rà vòng 5 (30/09/2026, ca `[V5-40]`) — CỔNG đứng TRƯỚC phép ghi đầu tiên (luật rollback): đơn
    // đang thu THEO CON không nhận kế hoạch mức đơn. Trước bản vá: đợt B#1 (của một bé) bị sửa
    // `amountDue` thành đợt đơn #1, sinh thêm đợt đơn #2 ⇒ Σ đợt sống 9.900.000 cho học phí
    // 6.732.000 (đòi thừa), mã cả nhà đổi số mà màn im. `throw` ⇒ `.catch` dưới đổi sang `{ok:false}`.
    const dotCon = await tx.paymentRequest.findMany({
      where: { orderId, orderItemId: { not: null } },
      select: { orderItemId: true, status: true },
    });
    if (donDangThuTheoCon(dotCon)) throw new InstallmentMoneyBlocked(LY_DO_DON_THU_THEO_CON, 0);
    await tx.orderInstallment.deleteMany({ where: { orderId } });
    // S1-fix (double-write) — kế hoạch 2 đợt là NGUỒN SỰ THẬT về tiền của đơn:
    // xoá mềm Payment auto cũ TRƯỚC khi dựng lại. Nếu không:
    //  (a) đơn CONFIRMED trước rồi mới lưu kế hoạch → confirm(full) + đợt1 = cộng đôi "đã nộp";
    //  (b) sửa lại số tiền đợt 1 → marker cũ khiến ensureOrderPaymentRecorded no-op, lệch số.
    //
    // ⚠️ THU HẸP 13/09/2026 (DS-03) — trước đây điều kiện là `note contains "[auto:"`.
    // Tiền tố đó quét luôn `[auto:sepay:<txn>]` / `[auto:payos:<txn>]`, tức TIỀN THẬT
    // KHÁCH ĐÃ CHUYỂN (`lib/payments/payos-ingest.ts` ghi Ledger-A bằng marker đó).
    // Hệ quả đang sống trên prod: bấm "Lưu kế hoạch" lần nữa trên đơn đã nhận chuyển
    // khoản là xoá mềm dòng ledger DUY NHẤT của khoản đó ⇒ tiền rơi khỏi công nợ hiển
    // thị (mọi phép đọc lọc `deletedAt: null`), trong khi `PaymentAllocation` ở sổ mới
    // vẫn còn ⇒ hai sổ lệch đúng bằng số khách đã chuyển.
    //
    // Nay liệt kê TƯỜNG MINH đúng marker của chính kế hoạch (`lib/finance/payment-markers.ts`).
    // KHÔNG "tối ưu" lại thành một mảnh tiền tố — `[MK-04]` khoá điều đó.
    //
    // Ba điều kiện gác thêm, vì so chuỗi KHÔNG đủ để nói "khoản này của kế hoạch":
    //  · `enrollmentId: null`     — khoản đã gắn ghi danh là khoản đã vào sổ học phí thật.
    //  · `accountantStatus: PENDING` — kế toán đã xác nhận/từ chối/điều chỉnh/hoàn thì
    //    khoản đó không còn là nháp của kế hoạch nữa.
    //  · `receipts: { none: {} }` — đã phát phiếu thu cho phụ huynh thì tuyệt đối không đụng.
    // (Chú thích cũ ở đây nói "khoản auto vốn chưa gắn enrollment nên không có Receipt" —
    //  MÃ NGUỒN NÓI NGƯỢC: `linkRecordedPaymentsToEnrollments` gắn `enrollmentId` cho MỌI
    //  khoản RECORDED của đơn lúc convert. Vì thế phải gác tường minh, không tin chú thích.)
    // ⚠️ ĐỐI XỨNG với phép GHI bên dưới: quét MỌI soDot của kế hoạch mới, kể cả đợt lần
    // này không còn. Lệch hai bên là lật một đợt từ đã-thu sang chưa-thu sẽ xoá một dòng
    // Ledger-A CÒN SỐNG mà không cổng nào thấy và không audit nào ghi.
    //
    // Quét cả `TRAN_SO_DOT` đợt chứ không chỉ số đợt lần này: kế hoạch trước có thể
    // nhiều đợt hơn kế hoạch mới, và khoản nháp của đợt bị bỏ phải được dọn.
    // ⚠️ PHIÊN A — CÔNG TẮC BẬT ⇒ TUYỆT ĐỐI KHÔNG CHẠM `Payment`.
    //
    // Chủ dự án chốt: *"'Lưu kế hoạch' đang xoá mềm Payment → cấm. Lưu/sửa đợt không bao giờ
    // chạm dòng Payment đã có."*
    //
    // Phép xoá mềm dưới đây sinh ra cho luồng CŨ, nơi kế hoạch đợt TỰ ĐẺ dòng Ledger-A
    // (`ensureOrderPaymentRecorded`) và vì thế phải tự dọn bản nháp của chính nó. Luồng MỚI
    // (đợt theo con) KHÔNG đẻ dòng `Payment` nào — tiền chỉ vào sổ khi có giao dịch ngân hàng
    // thật — nên không có gì để dọn, và mọi dòng `Payment` đang có đều là TIỀN THẬT.
    //
    // Cổng đặt Ở ĐÂY chứ không ở đường gọi, vì có BA đường gọi (`installments.ts:332`, `:500`,
    // `crm/backfill-order.ts:153`). Gác ở đường gọi là gác một cửa rồi để hai cửa mở — đúng bài
    // học của cổng A6 ngay phía trên.
    if (!batLuongMoi) {
    const soDotCuaKeHoach = Array.from({ length: TRAN_SO_DOT }, (_, i) => i + 1);
    await tx.payment.updateMany({
      where: {
        orderId,
        deletedAt: null,
        OR: planOwnedNoteOr(soDotCuaKeHoach),
        enrollmentId: null,
        accountantStatus: "PENDING",
        receipts: { none: {} },
        // Khoản đang nằm trong hoá đơn (PLAN §5): BỎ QUA, không xoá mềm — tờ hoá đơn đã chụp
        // nó. Không ném: ném là làm vỡ cả lượt lưu kế hoạch vì một khoản.
        ...KHOAN_CHUA_KHOA_HOA_DON,
      },
      data: { deletedAt: now },
    });
    }
    // Dựng đủ n đợt. `soDot` đánh số từ 1 theo thứ tự trong `dots` — đó cũng là thứ tự
    // hạn đóng, và là thứ tự `computeDueNow` chọn "đợt chưa thu sớm nhất".
    //
    // ⚠️ ĐÃ GỠ [14/09/2026] — khối set `installmentApprovalStatus: "PENDING_APPROVAL"`
    // vốn nằm trong nhánh này. Đây là nơi DUY NHẤT sinh hàng chờ duyệt kế hoạch (đo prod:
    // đúng 1 đơn). Cột giữ nguyên trong schema — không drop cột trên bảng có dữ liệu prod.
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i]!;
      const soTien = Math.max(0, Math.round(d.amount));
      await tx.orderInstallment.create({
        data: {
          orderId,
          soDot: i + 1,
          amount: soTien,
          status: d.daThu ? "PAID" : "PENDING",
          paidAt: d.daThu ? now : null,
          dueDate: d.daThu ? null : d.dueDate,
          recordedById: actorId,
          reminderDays: d.reminderDays ?? null,
        },
      });
    }
    // S1 — đợt 1 (đã thu) ghi Payment(RECORDED) idempotent → Ledger-A khớp Ledger-B.
    //
    // ⚠️ GHI PHẦN CHÊNH, KHÔNG GHI LẠI TỪ ĐẦU (R-01, 13/09/2026).
    //
    // Bất biến mà chỗ này luôn muốn giữ: "tổng Payment còn sống của đơn = tiền đợt 1
    // đã thu". Trước đây nó giữ bằng cách xoá sạch rồi ghi lại nguyên `dot1Amount` —
    // cách đó chỉ đúng khi phép xoá quét SẠCH mọi thứ, và chính vì nó quét sạch nên
    // nó cuốn cả tiền ngân hàng (DS-03, đã thu hẹp ở trên).
    //
    // Sau khi thu hẹp, ba loại khoản SỐNG SÓT có chủ đích: tiền cổng `[auto:<provider>:…]`,
    // khoản nhập lịch sử `[backfill-import]`, và khoản kế toán gõ tay. Ghi lại nguyên
    // `dot1Amount` lúc này là CỘNG ĐÔI — đó đúng là R-01, và nó nổ luôn cho tiền cổng
    // chứ không chỉ đơn backfill. Vì thế chỉ ghi phần còn thiếu.
    //
    // Đếm SAU lượt xoá mềm ở trên, nên khoản nháp của lần lưu trước không bị tính.
    //
    // ⚠️ N ĐỢT: PHẢI PHÂN THEO TỪNG MARKER, KHÔNG DÙNG MỘT SỐ CHÊNH CHO N LỜI GỌI.
    //
    // `ensureOrderPaymentRecorded` idempotent theo SỰ TỒN TẠI của marker
    // `[auto:order-installment:dotN]`, KHÔNG so số tiền. Nên gọi n lần với cùng một con
    // số chênh là tạo n dòng Payment (n marker khác nhau, không cái nào dedupe cái nào);
    // còn dồn hết vào một marker thì đợt 2..n PAID mà không có marker của nó — bất biến
    // "đợt PAID ⇒ có marker dot_k" gãy, và mọi đường ghi bù sau này sẽ `create` thêm.
    //
    // `phanBoGhiTheoDot` giữ cả hai: Σ phần ghi thêm = phần còn thiếu so với sổ (R-01,
    // không cộng đôi với tiền cổng/backfill), và mỗi đợt nhận phần của riêng nó.
    const daCoAgg = await tx.payment.aggregate({
      where: { orderId, ...KHOAN_DA_GHI_NHAN },
      _sum: { amount: true },
    });
    const chiSoDaThu = dots.map((d, i) => ({ d, i })).filter((x) => x.d.daThu);

    // ── R-03 ── LỜI KHAI "ĐÃ THU" KHÔNG ĐƯỢC VƯỢT SỔ CỦA ĐƠN.
    //
    // ⚠️ VỊ TRÍ LÀ TOÀN BỘ GIÁ TRỊ CỦA CỔNG NÀY: ngay SAU `daCoAgg` và ngay TRƯỚC vòng
    // `ensureOrderPaymentRecorded`. Đặt nó xuống dưới vòng ghi thì vòng ghi vừa tạo đúng
    // phần còn thiếu ⇒ `daCoTrongSo === tienDaThuTheoKeHoach` ⇒ cổng KHÔNG BAO GIỜ nổ,
    // mà vẫn trông y hệt một cổng đang làm việc. Lưới `[KDT-10]` khoá thứ tự này.
    //
    // Vì sao R-02 ở dưới không thay được: R-02 nằm trong nhánh `if (coDotChuaThu)`, mà ca
    // hỏng nhất — kế hoạch MỘT đợt "đã thu đủ" — có `coDotChuaThu = false` nên nhánh đó
    // không chạy. Và cả khi chạy, nhánh (b) của R-02 CỐ Ý tha ca `khai > recordedPaid`
    // (đo thật: `keHoachLamMatTien({0, 3tr, 0, 10tr})` → `{chan:false}`) để không khoá
    // cứng nghiệp vụ sale thu tiền mặt. R-02 không hở — nó canh việc KHÁC.
    const tienDaThuTheoKeHoach = chiSoDaThu.reduce(
      (sum, x) => sum + Math.max(0, Math.round(x.d.amount)),
      0,
    );
    const khaiKhong = khaiDaThuVuotSo({
      tienCacDotDaThu: tienDaThuTheoKeHoach,
      daCoTrongSo: daCoAgg._sum.amount ?? 0,
    });
    if (khaiKhong.chan) {
      // ⚠️ Nhật ký này RỚT THEO transaction khi `throw` bên dưới rollback — hệt R-02 ở
      // cuối hàm. Giữ để hai cổng đọc giống nhau; muốn nhật ký sống sót thì phải ghi
      // NGOÀI transaction, và đó là việc chung của cả hai cổng, không phải của lượt này.
      await writeAudit({
        actor: { id: actorId, name: "" },
        module: "finance",
        entityType: "Order",
        entityId: orderId,
        action: "INSTALLMENT_DECLARED_PAID_BLOCKED",
        newValues: {
          soTien: khaiKhong.soTien ?? 0,
          tienDaThuTheoKeHoach,
          // Tên khoá KHÁC tên tham số của cổng là CÓ CHỦ ĐÍCH: `[KDT-10]` neo vào chuỗi
          // `daCoTrongSo: daCoAgg…` để chứng minh cổng đo bằng chính `daCoAgg`, và một
          // bản sao trong payload nhật ký sẽ làm phép đếm của lưới vô nghĩa (luật 11).
          soTrongSo: daCoAgg._sum.amount ?? 0,
          lyDo: khaiKhong.lyDo ?? "",
        },
        orgUnitId: order.centerId,
        tx,
      });
      throw new InstallmentMoneyBlocked(khaiKhong.lyDo ?? "", khaiKhong.soTien ?? 0);
    }

    const phanGhi = phanBoGhiTheoDot(
      chiSoDaThu.map((x) => x.d.amount),
      daCoAgg._sum.amount ?? 0,
    );
    for (let k = 0; k < chiSoDaThu.length; k++) {
      const canGhiThem = phanGhi[k] ?? 0;
      if (canGhiThem <= 0) continue;
      await ensureOrderPaymentRecorded(tx, {
        orderId,
        soDot: chiSoDaThu[k]!.i + 1,
        amount: canGhiThem,
        leadId: order.leadId,
        centerId: order.centerId,
        actor: { id: actorId },
      });
    }
    // ⚠️ 03/08 — ĐẢO QĐ-1 (chủ dự án chốt trong chat). Trước đây chỗ này chỉ dựng
    // phiếu "thu toàn đơn" và đợi QLCS duyệt mới sinh phiếu theo đợt ⇒ khách đứng ở
    // quầy không quét được mã đúng số tiền đợt 1 cho tới khi có người duyệt.
    // Nay: LƯU KẾ HOẠCH LÀ CÓ PHIẾU THU THEO ĐỢT NGAY (kèm QR đúng số tiền từng đợt).
    // Duyệt chỉ còn là bước KHOÁ kế hoạch lại.
    //
    // Đơn trả 1 lần (không có đợt 2) giữ nguyên đường cũ: 1 phiếu "thu toàn đơn" —
    // gọi nó là "Đợt 1/1" chỉ làm sale rối chứ không thêm thông tin gì.
    // ⚠️ `coDotChuaThu`, KHÔNG phải số đợt: kế hoạch MỘT đợt trả sau là 100% nợ và phải
    // qua đúng cổng này. Đếm đợt thì nó lọt, và R-02 bị bỏ qua cho đúng ca đáng lo nhất.
    if (coDotChuaThu) {
      const tienCacDotDaThu = dots
        .filter((d) => d.daThu)
        .reduce((sum, d) => sum + Math.max(0, Math.round(d.amount)), 0);
      // ── R-02 ── Chặn TRƯỚC khi `materializeInstallmentRequests` VOID phiếu "thu toàn
      // đơn". Đo bốn số rồi hỏi `keHoachLamMatTien` (thuần, `lib/payments/plan-money-guard.ts`).
      // Đo Ở ĐÂY, sau lượt xoá mềm và sau khi đã ghi phần chênh đợt 1: `recordedPaid`
      // phải là số THẬT còn sống tại thời điểm phiếu sắp bị VOID.
      const [rotVaoToanDon, tongDaThu, tongDaRot] = await Promise.all([
        tx.paymentAllocation.aggregate({
          where: {
            paymentRequest: { orderId, installmentNo: 0, status: { not: "VOID" } },
          },
          _sum: { amount: true },
        }),
        tx.payment.aggregate({
          where: { orderId, ...KHOAN_DA_GHI_NHAN },
          _sum: { amount: true },
        }),
        tx.paymentAllocation.aggregate({
          where: { paymentRequest: { orderId } },
          _sum: { amount: true },
        }),
      ]);
      const canhBao = keHoachLamMatTien({
        fullOrderAllocated: rotVaoToanDon._sum.amount ?? 0,
        recordedPaid: tongDaThu._sum.amount ?? 0,
        allocated: tongDaRot._sum.amount ?? 0,
        // ⚠️ Σ MỌI đợt đã thu, không phải đợt đầu. Xem chú thích `tienCacDotDaThu`.
        tienCacDotDaThu,
      });
      if (canhBao.chan) {
        await writeAudit({
          actor: { id: actorId, name: "" },
          module: "finance",
          entityType: "Order",
          entityId: orderId,
          action: "PAYMENT_REQUESTS_MATERIALIZE_BLOCKED",
          newValues: { soTien: canhBao.soTien ?? 0, tienCacDotDaThu, lyDo: canhBao.lyDo ?? "" },
          orgUnitId: order.centerId,
          tx,
        });
        throw new InstallmentMoneyBlocked(canhBao.lyDo ?? "", canhBao.soTien ?? 0);
      }
      phieuDaSoat = (await materializeInstallmentRequests(tx, orderId, { id: actorId, name: "" })).phieuGopDaSoat;
    } else {
      await ensureFullOrderRequest(tx, {
        id: orderId,
        code: order.code,
        totalAmount: order.totalAmount,
        centerId: order.centerId,
      });
    }
  }).catch((e: unknown) => {
    // R-02 — transaction ĐÃ rollback ở đây (đó là lý do dùng throw). Chỉ còn việc đổi
    // sang kênh `{ok,error}` sẵn có để toast trên màn đơn nói được cho sale biết làm gì tiếp.
    if (e instanceof InstallmentMoneyBlocked) return e;
    throw e;
  });
  if (chan instanceof InstallmentMoneyBlocked) return { ok: false, error: chan.message };
  await recomputeOrder(orderId, actorId);
  return { ok: true, thongDiepPhieu: thongDiepPhieuDaSoat(phieuDaSoat) };
}

/**
 * Đánh dấu 1 đợt đã đóng (đợt 2).
 * `expectedOrderId`: Server Action ĐÃ scope-check đơn nào thì truyền id đơn đó vào —
 * thiếu đối chiếu này là IDOR ghi tiền: client gửi orderId (trong scope) kèm
 * installmentId của ĐƠN KHÁC cơ sở → flip PAID + sinh Payment chéo cơ sở.
 */
export async function markInstallmentPaid(
  installmentId: string,
  actorId: string | null,
  expectedOrderId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const inst = await db.orderInstallment.findUnique({
    where: { id: installmentId },
    select: { id: true, orderId: true, status: true, soDot: true, amount: true },
  });
  if (!inst) return { ok: false, error: "Không tìm thấy đợt" };
  if (expectedOrderId && inst.orderId !== expectedOrderId) {
    return { ok: false, error: "Đợt thu không thuộc đơn hàng này" };
  }
  if (inst.status === "PAID") return { ok: true };

  const order = await db.order.findUnique({
    where: { id: inst.orderId },
    select: { centerId: true, leadId: true, installmentApprovalStatus: true },
  });

  await db.$transaction(async (tx) => {
    await tx.orderInstallment.update({ where: { id: installmentId }, data: { status: "PAID", paidAt: new Date(), recordedById: actorId } });
    // ⚠️ ĐẢO 13/09/2026 — `PENDING_APPROVAL` nay CŨNG ghi Ledger-A.
    //
    // Luật cũ (C4): chỉ `APPROVED`/`null` mới ghi `Payment`; `PENDING_APPROVAL` thì đánh
    // dấu PAID ở Ledger-B mà KHÔNG tính tiền ở Ledger-A. Luật đó chỉ vô hại khi kế hoạch
    // chưa duyệt KHÔNG THỂ nhận tiền theo đợt — đúng với bản cũ của `computeDueNow` (nó
    // loại kế hoạch chờ duyệt nên webhook luôn đi nhánh "thu toàn đơn", `soDot == null`,
    // và hàm này không được gọi).
    //
    // Bản vá QR cùng ngày gỡ cái loại đó (kế hoạch chờ duyệt nay ra QR đúng số tiền đợt 1).
    // Giữ nguyên luật cũ ở đây thì hệ quả là: khách quét QR đóng đợt 1 → SePay báo về →
    // `markInstallmentPaid` đánh Ledger-B PAID → **bỏ qua Ledger-A** → công nợ hiển thị
    // (đọc từ `Payment`, xem `lib/finance/debt.ts`) KHÔNG GIẢM. Tiền thật vào tài khoản
    // mà khách vẫn còn nguyên nợ trên hệ thống — tệ hơn cả con bug đang vá.
    //
    // `REJECTED` vẫn bị loại: lúc đó `revertInstallmentRequests` đã VOID phiếu theo đợt
    // và dựng lại phiếu "thu toàn đơn", nên khoản thu phải đi đường toàn đơn.
    //
    // Phần "ghi bù khi APPROVED" ở `approveInstallmentPlan` GIỮ LẠI, không gỡ: nó vẫn
    // cần cho ca REJECTED → APPROVED và cho dữ liệu cũ sinh ra dưới luật trước. Nó
    // idempotent theo marker nên không cộng đôi.
    const approvalOk = isInstallmentPlanActive(order?.installmentApprovalStatus);
    if (approvalOk) {
      // Khoản ghi ở mức RECORDED (Ledger-A pending). CONFIRMED + Receipt CHỈ sinh SAU convert
      // (Receipt scoped theo Enrollment; đòi CONFIRMED trước convert = deadlock — xem
      // lib/crm/convert-lead-v2.ts). KHÔNG auto-confirm ở đây.
      await ensureOrderPaymentRecorded(tx, {
        orderId: inst.orderId,
        soDot: inst.soDot,
        amount: inst.amount,
        leadId: order?.leadId ?? null,
        centerId: order?.centerId ?? null,
        actor: { id: actorId },
      });
    }
  });
  await recomputeOrder(inst.orderId, actorId);
  return { ok: true };
}

// =============================================================================
// C4 / S5 — Duyệt kế hoạch trả góp 2 đợt (CENTER_MANAGER + SUPER_ADMIN).
// requestInstallmentApproval: sale yêu cầu duyệt (set PENDING_APPROVAL).
// approveInstallmentPlan / rejectInstallmentPlan: assertCan('installments:approve') + audit
// (reject bắt buộc reason). Khi APPROVED, nếu đợt2 đã PAID (Ledger-B) → ghi bù Payment.
// =============================================================================

/** Actor cho luồng duyệt: id+name (audit) + role/roles (assertCan). */
export type InstallmentApprovalActor = {
  id: string;
  name: string;
  role?: Role | string | null;
  roles?: (Role | string)[] | null;
};

/** Phần đơn mà việc duyệt kế hoạch cần đọc — dùng chung cho luồng lẻ và luồng gộp. */
export type InstallmentApprovalOrder = {
  id: string;
  centerId: string | null;
  leadId: string | null;
  installmentApprovalStatus: InstallmentApprovalStatus | null;
};

// -----------------------------------------------------------------------------
// THÂN của việc duyệt/từ chối kế hoạch, nhận sẵn `tx` — xem lý do tách ở
// lib/orders/discount.ts (một nút duyệt cả đơn ⇒ hai việc phải chung transaction).
//
// ⚠️ Duyệt kế hoạch KHÔNG chỉ là đổi một cột: nó còn ghi bù Payment cho đợt 2 đã thu
// và SINH PHIẾU THU theo đợt. Ai mượn lại thân hàm này mà bỏ bớt sẽ được một đơn
// "đã duyệt" nhưng không có phiếu để thu tiền — nên chỗ duy nhất biết đủ việc là đây.
// -----------------------------------------------------------------------------

/**
 * Đặt cột duyệt kế hoạch + nhật ký + ghi bù Payment đợt 2 + sinh phiếu thu theo đợt.
 *
 * Trả các phiếu gộp vừa bị huỷ/đóng vì đợt dưới chân chúng bị VOID (rà vòng 4, luật 12) —
 * `approveOrder` đưa lên toast của người duyệt. Vứt kết quả này là lỗi câm.
 */
export async function applyInstallmentApproval(
  tx: Prisma.TransactionClient,
  params: {
    order: InstallmentApprovalOrder;
    actor: InstallmentApprovalActor;
    reason?: string;
  },
): Promise<PhieuDaSoatTom[]> {
  const { order, actor } = params;
  await tx.order.update({
    where: { id: order.id },
    data: {
      installmentApprovalStatus: "APPROVED",
      installmentApprovedById: actor.id,
      installmentApprovedAt: new Date(),
      installmentRejectReason: null,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "INSTALLMENT_APPROVED",
    oldValues: { installmentApprovalStatus: order.installmentApprovalStatus },
    newValues: { installmentApprovalStatus: "APPROVED" },
    reason: params.reason?.trim() || undefined,
    orgUnitId: order.centerId,
    tx,
  });
  // Đợt2 đã PAID (Ledger-B) nhưng bị gate trước đó → ghi bù Payment(RECORDED).
  const dot2 = await tx.orderInstallment.findFirst({
    where: { orderId: order.id, soDot: 2, status: "PAID" },
    select: { soDot: true, amount: true },
  });
  if (dot2) {
    await ensureOrderPaymentRecorded(tx, {
      orderId: order.id,
      soDot: dot2.soDot,
      amount: dot2.amount,
      leadId: order.leadId,
      centerId: order.centerId,
      actor: { id: actor.id, name: actor.name },
    });
  }
  // QĐ-1 (03/08) — ĐÂY là nơi duy nhất phiếu thu theo đợt ra đời. Cùng transaction
  // với việc set APPROVED ở trên: duyệt hỏng thì phiếu cũng không tồn tại, và
  // ngược lại không có đơn nào "đã duyệt mà chưa có phiếu".
  return (await materializeInstallmentRequests(tx, order.id, { id: actor.id, name: actor.name }))
    .phieuGopDaSoat;
}

/**
 * Đặt cột từ chối kế hoạch + nhật ký + thu hồi phiếu theo đợt (hồi sinh phiếu toàn đơn).
 *
 * Không cần `leadId` (khác nhánh duyệt): từ chối thì không ghi Payment cho ai cả.
 * Trả các phiếu gộp vừa bị huỷ/đóng — xem `applyInstallmentApproval`.
 */
export async function applyInstallmentRejection(
  tx: Prisma.TransactionClient,
  params: {
    order: Omit<InstallmentApprovalOrder, "leadId">;
    actor: InstallmentApprovalActor;
    reason: string;
  },
): Promise<PhieuDaSoatTom[]> {
  const { order, actor } = params;
  const reason = params.reason.trim();
  await tx.order.update({
    where: { id: order.id },
    data: {
      installmentApprovalStatus: "REJECTED",
      installmentApprovedById: actor.id,
      installmentApprovedAt: new Date(),
      installmentRejectReason: reason,
    },
  });
  await writeAudit({
    actor: { id: actor.id, name: actor.name },
    module: "finance",
    entityType: "Order",
    entityId: order.id,
    action: "INSTALLMENT_REJECTED",
    oldValues: { installmentApprovalStatus: order.installmentApprovalStatus },
    newValues: { installmentApprovalStatus: "REJECTED" },
    reason,
    orgUnitId: order.centerId,
    tx,
  });
  // Kế hoạch bị bác sau khi đã lỡ duyệt → thu hồi phiếu theo đợt (chưa dính tiền)
  // và cho phiếu "thu toàn đơn" sống lại, để đơn vẫn thu được.
  return (await revertInstallmentRequests(tx, order.id, { id: actor.id, name: actor.name }))
    .phieuGopDaSoat;
}

/** Sale yêu cầu duyệt kế hoạch 2 đợt → PENDING_APPROVAL (reset cờ duyệt/từ chối cũ). */
export async function requestInstallmentApproval(params: {
  orderId: string;
  actor: InstallmentApprovalActor;
}): Promise<{ ok: boolean; error?: string }> {
  const order = await db.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, centerId: true },
  });
  if (!order) return { ok: false, error: "Không tìm thấy đơn" };

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        installmentApprovalStatus: "PENDING_APPROVAL",
        installmentRequestedById: params.actor.id,
        installmentApprovedById: null,
        installmentApprovedAt: null,
        installmentRejectReason: null,
      },
    });
    await writeAudit({
      actor: { id: params.actor.id, name: params.actor.name },
      module: "finance",
      entityType: "Order",
      entityId: order.id,
      action: "INSTALLMENT_APPROVAL_REQUEST",
      newValues: { installmentApprovalStatus: "PENDING_APPROVAL" },
      orgUnitId: order.centerId,
      tx,
    });
  });
  return { ok: true };
}

/**
 * CENTER_MANAGER/SUPER_ADMIN duyệt kế hoạch 2 đợt → APPROVED + ghi bù Payment đợt2 nếu đã PAID.
 *
 * @deprecated Dùng `approveOrder()` (lib/orders/approval.ts) — một nút duyệt cho cả
 * giảm giá lẫn kế hoạch thanh toán. Giữ lại cho đơn/luồng chỉ có kế hoạch trả góp và
 * cho caller cũ (e2e gọi thẳng lib); hành vi KHÔNG đổi.
 */
export async function approveInstallmentPlan(params: {
  orderId: string;
  actor: InstallmentApprovalActor;
  reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    assertCan({ role: params.actor.role ?? null, roles: params.actor.roles ?? undefined }, "installments:approve");
  } catch {
    return { ok: false, error: "Không có quyền duyệt kế hoạch trả góp" };
  }
  const order = await db.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, centerId: true, leadId: true, installmentApprovalStatus: true },
  });
  if (!order) return { ok: false, error: "Không tìm thấy đơn" };
  if (order.installmentApprovalStatus == null) {
    return { ok: false, error: "Đơn không có kế hoạch trả góp cần duyệt" };
  }

  await db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, order.id); // rà vòng 4 — xem recordInstallmentPlan
    await applyInstallmentApproval(tx, { order, actor: params.actor, reason: params.reason });
  });
  return { ok: true };
}

/**
 * CENTER_MANAGER/SUPER_ADMIN từ chối kế hoạch 2 đợt → REJECTED (reason bắt buộc).
 *
 * @deprecated Dùng `rejectOrder()` (lib/orders/approval.ts) — xem chú thích ở
 * `approveInstallmentPlan`.
 */
export async function rejectInstallmentPlan(params: {
  orderId: string;
  actor: InstallmentApprovalActor;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    assertCan({ role: params.actor.role ?? null, roles: params.actor.roles ?? undefined }, "installments:approve");
  } catch {
    return { ok: false, error: "Không có quyền duyệt kế hoạch trả góp" };
  }
  if (!params.reason?.trim()) return { ok: false, error: "Lý do từ chối là bắt buộc" };

  const order = await db.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, centerId: true, installmentApprovalStatus: true },
  });
  if (!order) return { ok: false, error: "Không tìm thấy đơn" };
  if (order.installmentApprovalStatus == null) {
    return { ok: false, error: "Đơn không có kế hoạch trả góp cần duyệt" };
  }

  await db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, order.id); // rà vòng 4 — xem recordInstallmentPlan
    await applyInstallmentRejection(tx, { order, actor: params.actor, reason: params.reason });
  });
  return { ok: true };
}
