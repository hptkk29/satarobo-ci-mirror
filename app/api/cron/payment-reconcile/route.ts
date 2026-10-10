import { db } from "@/lib/db";
import { notifyStaff } from "@/lib/notifications/notify";
import { withCron } from "@/lib/cron/handler";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { locDotCuaConDangBaoLuu } from "@/lib/finance/bao-luu-tien";
import { nhacKeToanHoaDon, type KetQuaNhacKeToan } from "@/lib/finance/hoa-don/nhac-ke-toan-db";

export const dynamic = "force-dynamic";

// =============================================================================
// 03/08 — ĐỐI SOÁT CUỐI NGÀY (sổ thu mới).
//
// Quét 2 thứ và chỉ 2 thứ, rồi báo chuông cho người có quyền `payments:manage`:
//   1. `BankTransaction` UNMATCHED — tiền ĐÃ VỀ nhưng chưa rót được vào phiếu nào.
//      Đây là hàng chờ xử lý tay DUY NHẤT được phép tồn tại; để qua đêm là khách đã
//      trả tiền mà hệ thống vẫn coi như còn nợ.
//   2. `PaymentRequest` PARTIAL quá hạn — khách trả thiếu và đã qua ngày đến hạn.
//      (PENDING quá hạn KHÔNG báo ở đây: đó là công nợ thường, đã có
//      /api/cron/order-debt-reminder + debt-reminder lo nhắc khách.)
//      ⚠️ Chỉ bắt được phiếu CÓ `dueDate`. Phiếu toàn đơn (`installmentNo=0`) do
//      backfill/đơn không trả góp sinh ra có `dueDate = null` (đơn lẻ không có mốc
//      hạn trong dữ liệu) ⇒ trả thiếu ở đơn lẻ KHÔNG lên chuông này; đường nhắc của
//      nhóm đó vẫn là /api/cron/order-debt-reminder (theo tuổi đơn).
//
// ⚠️ KHÔNG quét `QrSession` hết hạn: trạng thái đó SUY RA được lúc đọc
// (`expiresAt < now`) nên một job đi ghi đè `status=EXPIRED` chỉ tạo thêm đường ghi
// có thể sai mà không thêm thông tin nào. Chủ dự án đã chốt bỏ.
//
// Chống spam: StaffNotification neo `dedupeKey` theo NGÀY → mỗi người tối đa 1 thông
// báo/loại/ngày; nội dung (số đếm) được cập nhật nhưng trạng thái đã-đọc giữ nguyên.
// =============================================================================

const CATEGORY = "PAYMENT_RECONCILE";

// Hai thông báo nói về hai thứ khác nhau nên phải mở hai màn khác nhau — trước đây
// dùng CHUNG một href là đẩy người nhận tới màn không chứa dữ liệu họ cần xử lý.
//
//  • Tiền về chưa khớp → `/bien-dong-so-du` (màn liệt kê BankTransaction) kèm
//    `?status=unmatched`: trang có ĐỌC param này (page.tsx đọc `searchParams.status`,
//    chỉ nhận "unmatched"/"matched") ⇒ mở ra là đúng hàng chờ, không phải cả sổ.
//  • Phiếu thu trả thiếu quá hạn → `/cong-no`. Đây là màn công nợ + tuổi nợ quá hạn,
//    và cũng là đích đã KHAI sẵn cho tiền tố `payment-reconcile:overdue-partial:`
//    trong lib/notifications/catalog.ts. KHÔNG có màn nào liệt kê `PaymentRequest`
//    toàn hệ thống (phiếu thu chỉ hiện trong chi tiết đơn `/orders/<id>`), nên đây là
//    màn gần đúng nhất — `/bien-dong-so-du` thì sai hẳn: nó chỉ có BankTransaction.
const HREF_UNMATCHED = "/bien-dong-so-du?status=unmatched";
const HREF_OVERDUE_PARTIAL = "/cong-no";

/**
 * Người nhận = có quyền `payments:manage`.
 * Hợp NHẤT hai nguồn có chủ đích: RBAC v2 động (đang enforce trên prod) + matrix v1
 * tĩnh (thứ chạy ở local/dev/CI). Cron chạy ở cả hai nơi; lấy hợp để không có môi
 * trường nào im lặng không báo cho ai.
 */
async function getReconcileRecipients(now: Date): Promise<string[]> {
  const ids = new Set<string>();

  // v2 — RoleDef có quyền payments:manage → người đang giữ role đó.
  const roleRows = await db.rolePermission.findMany({
    where: { action: "payments:manage" },
    select: { roleId: true },
  });
  if (roleRows.length > 0) {
    const assignments = await db.userOrgRole.findMany({
      where: {
        roleId: { in: roleRows.map((r) => r.roleId) },
        status: "ACTIVE",
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      select: { userId: true },
    });
    for (const a of assignments) ids.add(a.userId);
  }

  // v1 — vai trò tĩnh trên User.roles[].
  const legacyRoles = PERMISSIONS["payments:manage"];
  const legacyUsers = await db.user.findMany({
    where: { isActive: true, deletedAt: null, roles: { hasSome: legacyRoles } },
    select: { id: true },
  });
  for (const u of legacyUsers) ids.add(u.id);

  // Chỉ giữ tài khoản còn hoạt động (người ở v2 có thể đã nghỉ).
  if (ids.size === 0) return [];
  const active = await db.user.findMany({
    where: { id: { in: [...ids] }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return active.map((u) => u.id);
}

// Cả tổ kế toán đi trong MỘT lời gọi: fan-out realtime tính chi phí theo từng người nhận.
// `notifyStaff` cập nhật số đếm + href ở nhánh update và GIỮ trạng thái đã đọc (không
// `reopen`) — đúng hành vi cũ, và ghi href là cách duy nhất chữa bản ghi mà lần chạy trước
// trong cùng ngày đã sinh với href cũ (dedupeKey khoá theo ngày ⇒ create không chạy lại).
const notifyAll = (
  userIds: string[],
  dedupeKey: string,
  title: string,
  body: string,
  href: string,
): Promise<number> =>
  notifyStaff({ userIds, dedupeKey, category: CATEGORY, title, body, href });

const fmt = (n: number) => new Intl.NumberFormat("vi-VN").format(n);

type ReconcileResult = {
  unmatchedTxns: number;
  unmatchedAmount: number;
  overduePartial: number;
  /** F2 — số phiếu quá hạn ĐƯỢC THA vì con đang bảo lưu. Nói ra, đừng lọc im lặng. */
  thaViBaoLuu: number;
  overdueOutstanding: number;
  recipients: number;
  notified: number;
};

// KHÔNG export (ngoài GET + `dynamic`): Next.js validate export của `route.ts`, thêm
// symbol lạ là gãy build. Cần tái dùng ở nơi khác thì tách sang lib/ rồi import vào.
async function runPaymentReconcile(now: Date = new Date()): Promise<ReconcileResult> {
  const day = now.toISOString().slice(0, 10);

  // 1. Tiền về chưa rót được vào phiếu nào.
  const unmatched = await db.bankTransaction.findMany({
    where: { status: "UNMATCHED" },
    select: { id: true, amount: true },
  });
  const unmatchedAmount = unmatched.reduce((s, t) => s + t.amount, 0);

  // 2. Phiếu thu trả thiếu ĐÃ quá hạn.
  const partialTho = await db.paymentRequest.findMany({
    where: { status: "PARTIAL", dueDate: { not: null, lt: now } },
    select: {
      id: true,
      orderItemId: true,
      amountDue: true,
      allocations: { select: { amount: true } },
    },
  });

  // F2 · US-18 AC2 vế hai — *"không có đợt nào của con đó thành QUA_HAN trong thời gian
  // PAUSED"*. Chỗ này là ĐƯỜNG DUY NHẤT trong repo đọc `PaymentRequest.dueDate` để kết
  // luận quá hạn (đo 22/09/2026: `overdueBucket` + `remindOverdueInstallments` của
  // `lib/finance/debt.ts` đọc `OrderInstallment` — SỔ KHÁC). Ai thêm một đường quá hạn mới
  // cho `PaymentRequest` thì phải gọi `locDotCuaConDangBaoLuu` ở đó nữa: phép tha này
  // KHÔNG tự lan sang chỗ khác.
  //
  // ⚠️ Lọc ở TẦNG MÃ chứ không nhồi vào `where`: điều kiện thật có HAI vế
  // (`reserve.enrollmentId IS NULL` ⇒ bảo lưu cả học viên, hoặc `= orderItem.enrollmentId`
  // ⇒ đúng một ghi danh) và Prisma không diễn đạt được cặp ấy trong một filter lồng. Viết
  // nửa điều kiện vào `where` là tha quá hạn cho cả khoá mà bé VẪN ĐANG HỌC.
  const thaViBaoLuu = await locDotCuaConDangBaoLuu(db, partialTho);
  const partial = partialTho.filter((r) => !thaViBaoLuu.has(r.id));
  const overdueOutstanding = partial.reduce(
    (s, r) => s + Math.max(0, r.amountDue - r.allocations.reduce((x, a) => x + a.amount, 0)),
    0,
  );

  if (unmatched.length === 0 && partial.length === 0) {
    return {
      unmatchedTxns: 0,
      unmatchedAmount: 0,
      overduePartial: 0,
      thaViBaoLuu: thaViBaoLuu.size,
      overdueOutstanding: 0,
      recipients: 0,
      notified: 0,
    };
  }

  const recipients = await getReconcileRecipients(now);
  let notified = 0;

  if (unmatched.length > 0) {
    notified += await notifyAll(
      recipients,
      `payment-reconcile:unmatched:${day}`,
      "Tiền về chưa khớp đơn",
      `${unmatched.length} giao dịch (${fmt(unmatchedAmount)}đ) chưa rót được vào phiếu thu nào — cần đối soát tay.`,
      HREF_UNMATCHED,
    );
  }
  if (partial.length > 0) {
    notified += await notifyAll(
      recipients,
      `payment-reconcile:overdue-partial:${day}`,
      "Phiếu thu trả thiếu đã quá hạn",
      `${partial.length} phiếu thu còn thiếu ${fmt(overdueOutstanding)}đ và đã qua ngày đến hạn.`,
      HREF_OVERDUE_PARTIAL,
    );
  }

  return {
    unmatchedTxns: unmatched.length,
    unmatchedAmount,
    overduePartial: partial.length,
    thaViBaoLuu: thaViBaoLuu.size,
    overdueOutstanding,
    recipients: recipients.length,
    notified,
  };
}

// PLAN hoá đơn Q-mở 7 — chuông "lần thu chờ xuất hoá đơn" đi ké lượt hằng ngày này. Chạy SAU đối soát
// và nuốt lỗi của riêng nó: chuông nhắc hỏng không được làm mất hai chuông tiền ở trên (chúng đã ghi
// xong trước khi tới đây). Cờ màn hoá đơn TẮT ⇒ `boQua: "CO_TAT"`, không tra gì.
async function nhacHoaDonKhongNem(now: Date): Promise<KetQuaNhacKeToan | { loi: string }> {
  try {
    return await nhacKeToanHoaDon(now);
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    console.error(`[cron:payment-reconcile] chuông hoá đơn lỗi: ${loi}`);
    return { loi };
  }
}

// withCron = verifyCronAuth (CRON_SECRET) + try/catch → JSON lỗi có cấu trúc (API-18).
export const GET = withCron("payment-reconcile", async () => {
  const now = new Date();
  const doiSoat = await runPaymentReconcile(now);
  return { ok: true, data: { ...doiSoat, hoaDon: await nhacHoaDonKhongNem(now) } };
});
