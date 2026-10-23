"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { checkPermission, assertPermission } from "@/lib/auth/check-permission";
import { PermissionError } from "@/lib/auth/can";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import {
  METHOD_WRONG_CENTER_ERROR,
  methodServesCenter,
} from "@/lib/payments/method-scope";
import { lookupMethodCenterByCode } from "@/lib/payments/method-lookup";
import { maskNationalId, maskAddress } from "@/lib/finance/pii-mask";
import { breakGlassSchema } from "@/lib/validators/audit";
import { writeAudit } from "@/lib/audit/audit-log";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";
// Phương án B (13/09/2026) — chọn khoản NHẬP LIỆU BAN ĐẦU đủ điều kiện xác nhận hàng
// loạt. Luật THUẦN, ở một chỗ, và KHÔNG lách cổng nào của `confirmPayment`.
import {
  BACKFILL_PAYMENT_MARKER,
  type NguonKhoan,
} from "@/lib/finance/payment-markers";
import {
  lapKeHoachXacNhan,
  type BackfillCandidate,
} from "@/lib/finance/backfill-confirm";
import {
  MUC_GAN,
  dongVuongMac,
  mucGanChoKhoan,
  vuongMacCuaKhoan,
  type GhiDanhUngVien,
  type MucGan,
  type VuongMacKhoan,
} from "@/lib/finance/gan-ghi-danh-khoan";
import { getAuditActor } from "@/lib/audit/log";
import { getRequestMetadata } from "@/lib/audit/headers";
// ─── lib/finance/* — parallel agent owns these. Combined typecheck resolves. ──
// Contract assumed (single object arg, returns discriminated `{ ok }`):
//   recordPayment(input)  -> { ok:true; paymentId } | { ok:false; error }
//   confirmPayment(args)  -> { ok:true; receiptCode? } | { ok:false; error }
//   rejectPayment(args)   -> { ok:true } | { ok:false; error }
//   adjustPayment(args)   -> { ok:true; paymentId } | { ok:false; error }
//   refundPayment(args)   -> { ok:true } | { ok:false; error }
import {
  recordPayment,
  confirmPayment,
  rejectPayment,
  adjustPayment,
  updatePendingPayment,
  refundPayment,
} from "@/lib/finance/payment";

const PAGE_SIZE = 30;

// ─── AUTH GATES ─────────────────────────────────────────────────────
// R7-04 AC1/AC5 — tách nhiệm vụ: Sale GHI NHẬN (payments:record, gồm SALES_CSM),
// Kế toán XÁC NHẬN (payments:confirm = SUPER_ADMIN/ACCOUNTANT). Sale không confirm được.
async function requireRecord() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate trước khi fetch order/payment cụ thể → chưa có centerId, không truyền target
  // được ở đây (xem báo cáo). Cách ly cơ sở thật sự nằm ở scopedDb/passesScope bên dưới.
  if (!(await checkPermission("payments:record"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

async function requireAccountant() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Gate trước khi fetch payment cụ thể → chưa có centerId, không truyền target được ở
  // đây (xem báo cáo). Cách ly cơ sở thật sự nằm ở scopedDb/passesScope bên dưới.
  if (!(await checkPermission("payments:confirm"))) {
    redirect("/dashboard?error=unauthorized");
  }
  return session;
}

// ─── VALIDATORS (inline — lib/validators is out of scope to touch) ──────
const recordSchema = z.object({
  orderId: z.string().min(1, "Thiếu đơn hàng"),
  enrollmentId: z.string().trim().optional().nullable(),
  amount: z.coerce.number().int().positive("Số tiền phải > 0"),
  method: z.string().min(1, "Chọn phương thức"),
  paidDate: z.string().min(1, "Chọn ngày thu"),
  evidenceUrl: z.string().trim().optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
});

const adjustSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.coerce.number().int().positive("Số tiền phải > 0"),
  // ⚠️ 30/08/2026 — `method` ĐÃ GỠ khỏi đây, có chủ đích.
  //
  // Nó là một ô GHI MỞ mà không giao diện nào dùng: `payments-client.tsx:747` chỉ gửi
  // paymentId/amount/reason/expectedUpdatedAt. Nhưng Server Action là endpoint HTTP
  // riêng — ai gọi thẳng vẫn đặt được `method: "BANK_CS2"` và `adjustPayment` ghi
  // nguyên chuỗi đó vào bút toán điều chỉnh mới (lib/finance/payment.ts
  // `method: params.method ?? original.method`), KHÔNG qua cổng cơ sở nào. Tức đây là
  // đường ghi `Payment.method` thứ hai, và nó lách trọn cổng vừa dựng ở
  // `recordPaymentAction`. Bỏ hẳn rẻ hơn và chặt hơn dựng cổng thứ hai: bút toán điều
  // chỉnh nay luôn KẾ THỪA phương thức của khoản gốc (`params.method` = undefined →
  // `?? original.method`), đúng hành vi mà giao diện vẫn đang có.
  // `note` ĐÃ GỠ 07/09: bút toán điều chỉnh nay lưu chính LÝ DO vào `Payment.note` để
  // cổng phụ huynh in được lý do cạnh con số, nên không còn chỗ cho một ghi chú thứ hai.
  reason: z.string().trim().min(5, "Lý do tối thiểu 5 ký tự"),
  // Optimistic lock: Payment.updatedAt (ISO) client đã thấy. So sánh KHÔNG ghi đè —
  // dòng gốc phải bất biến.
  expectedUpdatedAt: z.string().optional().nullable(),
});

// Sửa khoản CÒN CHỜ DUYỆT — động từ khác hẳn "điều chỉnh", nên schema riêng.
const updatePendingSchema = z.object({
  paymentId: z.string().min(1),
  amount: z.coerce.number().int().positive("Số tiền phải > 0"),
  reason: z.string().trim().max(1000).optional().nullable(),
  expectedUpdatedAt: z.string().optional().nullable(),
});

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length ? t : null;
}

// ─── LIST / FORM DATA (scopedDb — cách ly cơ sở tự động) ───────────────
export type PaymentFilters = {
  saleStatus?: string;
  accountantStatus?: string;
  search?: string;
};

// #15 (câu 32) — 1 dòng khoản chờ xác nhận cho màn Kế toán. Flat DTO (serializable),
// CHỈ gồm field cần hiển thị; PII (CCCD PH + địa chỉ) đã MASK sẵn ở server, KHÔNG gửi
// bản raw xuống client khi chưa break-glass.
export type PaymentListRow = {
  id: string;
  amount: number;
  method: string;
  paidDate: string; // ISO
  updatedAt: string; // ISO
  saleStatus: string;
  accountantStatus: string;
  /** LOẠI bút toán — phân biệt phiếu thu với dòng điều chỉnh. */
  paymentType: string;
  /**
   * Giá trị HIỆN TẠI của phiếu thu = `amount` + Σ các bút toán điều chỉnh trỏ vào nó.
   *
   * Giao diện cần con số này để tính trước `delta` cho kế toán xem — nếu để client tự
   * lấy `amount` thì sau lần điều chỉnh đầu tiên nó đã sai (amount là số GỐC, không phải
   * số đang có hiệu lực).
   */
  hienTai: number;
  /** Số bút toán điều chỉnh đã có trên phiếu này. */
  soLanDieuChinh: number;
  /**
   * Id của đơn — CHỈ để dựng link sang `/admin/orders/<id>`.
   *
   * Chủ dự án 16/09: *"link giữa trang thanh toán và trang đơn hàng chi tiết cho từng
   * đơn khi bấm vào xem luôn chứ?"*. Trước bản này cột mã đơn là chữ TRƠN — và nguyên
   * nhân không phải thiếu dữ liệu: câu Prisma ở `:207` ĐÃ `select: { id: true }`, chỉ
   * phép map bên dưới bỏ nó đi, nên màn không có gì để dựng `href`.
   */
  orderId: string | null;
  orderCode: string | null;
  customerName: string | null;
  studentName: string | null; // tên bé
  className: string | null; // lớp
  enrollmentId: string | null; // null = chưa gắn ghi danh — đơn KIT/THI thì null là bình thường
  /**
   * Khoản bị chặn xác nhận vì THIẾU ghi danh (`lib/finance/can-ghi-danh.ts`): đơn cần ghi danh mà
   * khoản chưa gắn. Đơn KIT / THI (PRODUCT · EXAM) không có ghi danh ⇒ `false`, nút ✓ hiện như thường.
   */
  thieuGhiDanh: boolean;
  collectedByName: string | null; // người thu (recordedBy)
  leadSource: string | null; // nguồn học viên
  parentName: string | null; // tên PH
  parentNationalId: string | null; // CCCD PH — mask/raw theo break-glass
  address: string | null; // địa chỉ — mask/raw theo break-glass
  piiMasked: boolean; // true = đang che (mặc định); false = đã break-glass
  receiptCode: string | null; // mã phiếu thu ACTIVE (để in)
  hasActiveReceipt: boolean;
};

// Lõi query dùng chung (KHÔNG export → không phải 'use server' entry point). Chỉ được
// gọi sau khi caller đã gác quyền. `wantUnmask=true` chỉ đi từ revealPaymentsPii (đã
// assertPermission + reason + writeAudit). scopedDb ép cách ly cơ sở như thường.
async function fetchPaymentRows(
  userId: string,
  filters: PaymentFilters,
  wantUnmask: boolean,
): Promise<PaymentListRow[]> {
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);

  const AND: Array<Record<string, unknown>> = [];
  if (filters.saleStatus) AND.push({ saleStatus: filters.saleStatus });
  if (filters.accountantStatus)
    AND.push({ accountantStatus: filters.accountantStatus });
  if (filters.search?.trim()) {
    const s = filters.search.trim();
    AND.push({
      OR: [
        { order: { code: { contains: s, mode: "insensitive" } } },
        { order: { customerName: { contains: s, mode: "insensitive" } } },
      ],
    });
  }

  // Payment ∈ SCOPED_MODELS → findMany đã tự lọc centerId theo actor (cách ly cơ sở:
  // CENTER_ACCOUNTANT CS1 KHÔNG thấy khoản/CCCD CS2). Nested include chỉ để hiển thị.
  const rows = await sdb.payment.findMany({
    where: AND.length ? { AND } : undefined,
    include: {
      order: {
        select: {
          id: true,
          code: true,
          type: true,
          customerName: true,
          student: {
            select: {
              name: true,
              parentName: true,
              parentNationalId: true,
              address: true,
            },
          },
          lead: { select: { source: true } },
        },
      },
      enrollment: { select: { id: true, class: { select: { name: true } } } },
      receipts: { select: { code: true, status: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: PAGE_SIZE,
  });

  // "Người thu" = người ghi nhận khoản (Payment.recordedById là String thuần, KHÔNG có
  // quan hệ Prisma) → tra tên qua 1 query User (User ∈ SCOPE_EXEMPT, đọc toàn cục OK).
  const collectorIds = [
    ...new Set(rows.map((r) => r.recordedById).filter((v): v is string => !!v)),
  ];
  const collectors = collectorIds.length
    ? await sdb.user.findMany({
        where: { id: { in: collectorIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(collectors.map((u) => [u.id, u.name]));

  // Σ điều chỉnh theo TỪNG phiếu của trang — MỘT truy vấn gộp, không phải mỗi dòng một
  // lượt. Dùng để tính "giá trị hiện tại" gửi xuống giao diện.
  const dieuChinhTheoPhieu = await sdb.payment.groupBy({
    by: ["adjustmentOfId"],
    where: {
      adjustmentOfId: { in: rows.map((r) => r.id) },
      paymentType: "ADJUSTMENT",
      deletedAt: null,
    },
    _sum: { amount: true },
    _count: { _all: true },
  });
  const dieuChinhCua = new Map(
    dieuChinhTheoPhieu.map((g) => [
      g.adjustmentOfId as string,
      { tong: g._sum.amount ?? 0, soLan: g._count._all },
    ]),
  );

  // Defense in depth: chỉ unmask khi caller THẬT SỰ có quyền. Không đủ quyền → im lặng
  // trả bản MASK (an toàn). wantUnmask chỉ true khi đã qua break-glass ở revealPaymentsPii.
  const unmask = wantUnmask && (await checkPermission("payments:view-pii"));

  return rows.map((p) => {
    const activeReceipt = p.receipts.find((r) => r.status === "ACTIVE");
    const rawCccd = p.order?.student?.parentNationalId ?? null;
    const rawAddress = p.order?.student?.address ?? null;
    const dc = dieuChinhCua.get(p.id);
    return {
      id: p.id,
      amount: p.amount,
      method: p.method,
      paidDate: p.paidDate.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      saleStatus: p.saleStatus,
      accountantStatus: p.accountantStatus,
      paymentType: p.paymentType,
      hienTai: p.amount + (dc?.tong ?? 0),
      soLanDieuChinh: dc?.soLan ?? 0,
      orderId: p.order?.id ?? null,
      orderCode: p.order?.code ?? null,
      customerName: p.order?.customerName ?? null,
      studentName: p.order?.student?.name ?? null,
      className: p.enrollment?.class?.name ?? null,
      enrollmentId: p.enrollment?.id ?? null,
      // Khoản đơn COURSE chưa gắn ghi danh (đơn chưa convert) → KHÔNG confirm được; đơn KIT/THI
      // không có ghi danh thì confirm được. Cùng luật với lõi `xacNhanKhoanTrongTx` — UI ẩn nút ✓
      // đúng khi lõi sẽ từ chối (luật 12). Xem FIN-01 + lib/finance/can-ghi-danh.ts.
      thieuGhiDanh: thieuGhiDanh({ enrollmentId: p.enrollment?.id ?? null }, p.order?.type ?? null),
      collectedByName: p.recordedById
        ? (nameById.get(p.recordedById) ?? null)
        : null,
      leadSource: p.order?.lead?.source ?? null,
      parentName: p.order?.student?.parentName ?? null,
      parentNationalId: unmask ? rawCccd : maskNationalId(rawCccd),
      address: unmask ? rawAddress : maskAddress(rawAddress),
      piiMasked: !unmask,
      receiptCode: activeReceipt?.code ?? null,
      hasActiveReceipt: !!activeReceipt,
    };
  });
}

// LUÔN trả bản MASK. Raw CCCD PH + địa chỉ KHÔNG BAO GIỜ ra từ đây — chỉ qua
// revealPaymentsPii (đường DUY NHẤT có reason + audit). Không còn tham số unmask.
export async function queryPayments(
  filters: PaymentFilters,
): Promise<PaymentListRow[]> {
  const session = await requireRecord();
  return fetchPaymentRows(session.user.id, filters, false);
}

export type PaymentRow = PaymentListRow;

// ─── #15 — BREAK-GLASS: mở xem đầy đủ CCCD PH + địa chỉ (reason + audit) ──────────
/**
 * ĐƯỜNG DUY NHẤT trả raw CCCD PH + địa chỉ. Bấm "Xem đầy đủ" → nhập lý do (≥10 ký tự)
 * → (1) assertPermission('payments:view-pii'); (2) reason ≥10; (3) ghi log RIÊNG
 * `payments.pii-unmasked` (ai – lúc nào – lý do) TRƯỚC khi trả raw; (4) query & trả
 * rows UNMASK. Mọi lối trả raw đều đi qua audit — không còn queryPayments({unmask}).
 */
export async function revealPaymentsPii(
  filters: PaymentFilters,
  reason: string,
): Promise<{ ok: true; rows: PaymentListRow[] } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };

  // (1) Chỉ kế toán/admin (payments:view-pii) mới mở xem đầy đủ.
  try {
    await assertPermission("payments:view-pii");
  } catch (e) {
    if (e instanceof PermissionError) {
      return { ok: false, error: "Bạn không có quyền xem đầy đủ CCCD/địa chỉ" };
    }
    throw e;
  }

  // (2) Bắt buộc reason ≥10 ký tự (break-glass).
  const parsed = breakGlassSchema.safeParse({ reason });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Lý do không hợp lệ",
    };
  }

  // (3) Ghi log break-glass TRƯỚC khi trả raw.
  const { actorId, actorName } = getAuditActor(session);
  const meta = await getRequestMetadata();
  await writeAudit({
    actor: { id: actorId, name: actorName },
    module: "finance",
    entityType: "Payment",
    entityId: "*",
    action: "payments.pii-unmasked",
    reason: parsed.data.reason,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  // (4) Đã audit → mới trả rows UNMASK (scopedDb vẫn cách ly cơ sở).
  const rows = await fetchPaymentRows(session.user.id, filters, true);
  return { ok: true, rows };
}

/** Đơn hàng gần đây trong scope — dùng cho select của form ghi nhận khoản. */
/**
 * Danh mục phương thức thanh toán để màn Ghi nhận khoản thu chọn.
 *
 * ⚠️ Trước 30/08/2026 danh sách này HARDCODE 5 dòng trong payments-client.tsx
 * (`METHOD_OPTIONS`) — nên phương thức riêng của cơ sở khai ở /payment-methods không bao
 * giờ hiện ra ở đây, và ngược lại người của cơ sở này thấy đủ 5 dòng của mọi cơ sở.
 *
 * Nay đọc từ DB qua scopedDb (PaymentMethod ∈ SCOPED_MODELS ∩ NULL_IS_GLOBAL_MODELS) ⇒
 * người cấp cơ sở chỉ thấy phương thức của cơ sở mình + phương thức dùng chung. Client
 * lọc thêm một lượt theo cơ sở của ĐƠN đang chọn.
 */
export async function loadPaymentMethodOptions() {
  const session = await requireRecord();
  const sdb = scopedDb(await resolveActor(session.user.id));
  // ⚠️ KHÔNG lọc `isActive` ở đây, có chủ đích. Danh sách này phục vụ HAI câu hỏi khác
  // nhau trong payments-client.tsx: (a) dropdown CHỌN phương thức — chỉ dòng đang bật,
  // client tự lọc; (b) bảng NHÃN dịch `Payment.method` của mọi khoản thu CŨ. Lọc ở tầng
  // truy vấn là đúng cho (a) nhưng hỏng (b): tắt một phương thức riêng của cơ sở thì mọi
  // khoản thu cũ ghi bằng mã đó rơi khỏi bảng nhãn và cột Phương thức in ra mã trần
  // ("BANK_CS1") trước mắt kế toán.
  return sdb.paymentMethod.findMany({
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, centerId: true, isActive: true },
  });
}

export async function loadOrderOptions() {
  const session = await requireRecord();
  const sdb = scopedDb(await resolveActor(session.user.id));
  const orders = await sdb.order.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      code: true,
      customerName: true,
      totalAmount: true,
      centerId: true,
    },
  });
  return orders;
}

// ─── RECORD (Sale ghi nhận khoản đã thu) ────────────────────────────────
export async function recordPaymentAction(input: unknown) {
  const session = await requireRecord();
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;

  const uid = session.user.id;
  if (!uid) return { ok: false as const, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);

  // Lấy order để (a) chống IDOR liên cơ sở, (b) suy centerId cho Payment, (c) auto-advance lead.
  const order = await sdb.order.findUnique({
    where: { id: data.orderId },
    select: { id: true, centerId: true, leadId: true, studentId: true },
  });
  if (!order || !passesScope("Order", order, actor)) {
    return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  }

  // ⚠️ CỔNG SERVER cho ô "Enrollment ID" (06/09/2026).
  //
  // Ô đó là TEXT TỰ DO trên form, và `recordPayment` ghi thẳng giá trị nhận được vào
  // `Payment.enrollmentId` — không nơi nào kiểm ghi danh ấy có thuộc đúng học viên của
  // đơn này không. Gõ nhầm/dán nhầm một id là khoản thu về sổ của bé khác: công nợ bé A
  // tụt xuống trên cổng phụ huynh dù nhà A chưa đóng đồng nào, còn nhà B đóng rồi vẫn
  // thấy nợ. Tiền thật, hai gia đình, không có dấu vết nào ở giao diện.
  //
  // Ba điều kiện, cái nào hỏng cũng từ chối: ghi danh có thật · nằm trong tầm nhìn cơ sở
  // của người ghi · thuộc ĐÚNG học viên của đơn hàng.
  const enrollmentId = trimOrNull(data.enrollmentId);
  if (enrollmentId) {
    // Qua `sdb` (không phải db trần): ghi danh ngoài tầm nhìn cơ sở trả null ⇒ TỪ CHỐI.
    // Ở đây "không thấy" phải dẫn tới CHẶN, nên hướng fail của scope là an toàn — khác
    // hẳn cổng `lookupMethodCenterByCode` ngay dưới, nơi scope làm cổng mở toang.
    const enr = await sdb.enrollment.findFirst({
      where: { id: enrollmentId },
      select: { id: true, centerId: true, studentId: true, deletedAt: true },
    });
    if (!enr || enr.deletedAt || !passesScope("Enrollment", enr, actor)) {
      return { ok: false as const, error: "Không tìm thấy ghi danh tương ứng" };
    }
    if (order.studentId && enr.studentId !== order.studentId) {
      return {
        ok: false as const,
        error: "Ghi danh này thuộc học viên khác — khoản thu sẽ vào sai sổ. Kiểm tra lại mã ghi danh.",
      };
    }
  }

  // ⚠️ CỔNG SERVER cho luật "cơ sở nào dùng phương thức của cơ sở đó" ở màn ghi nhận
  // khoản thu. `Payment.method` là CHUỖI TỰ DO ở DB, nên không có ràng buộc nào khác
  // chặn việc ghi mã phương thức của cơ sở khác vào sổ thu của cơ sở này — mà đó chính
  // là con số kế toán mang đi đối chiếu với sao kê ngân hàng.
  //
  // Chỉ kiểm khi mã KHỚP một dòng trong danh mục: `Payment.method` còn mang dữ liệu cũ
  // dạng nhãn thô ("auto", "COD"…) từ trước khi có danh mục — chặn cứng mọi chuỗi lạ là
  // khoá luôn đường ghi nhận cho những khoản hợp lệ đã tồn tại.
  //
  // ⚠️ Tra qua `lookupMethodCenterByCode` (KHÔNG scope), TUYỆT ĐỐI không qua `sdb`:
  // dùng `sdb` thì đúng mã cần chặn — mã của cơ sở khác — bị scope lọc mất, trả null,
  // và cổng đọc null thành "mã lạ, cho qua" ⇒ cổng mở toang đúng lúc phải đóng.
  // Xem ghi chú đầy đủ ở lib/payments/method-lookup.ts.
  const pm = await lookupMethodCenterByCode(data.method);
  if (pm.found && !methodServesCenter(pm, order.centerId)) {
    return { ok: false as const, error: METHOD_WRONG_CENTER_ERROR };
  }

  const res = await recordPayment({
    orderId: data.orderId,
    enrollmentId,
    amount: data.amount,
    method: data.method,
    paidDate: new Date(data.paidDate),
    evidenceUrl: trimOrNull(data.evidenceUrl),
    note: trimOrNull(data.note),
    centerId: order.centerId,
    recordedById: uid,
    // S3 — auto-advance lead AWAITING_DECISION→REGISTERED (xử lý trong recordPayment, cùng tx).
    leadId: order.leadId,
  });

  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  // S6 — đồng bộ trang lead/convert.
  if (order.leadId) {
    revalidatePath(`/leads/${order.leadId}`);
    revalidatePath(`/leads/${order.leadId}/convert`);
  }
  return { ok: true as const, paymentId: res.paymentId };
}

// ─── Helper: load Payment by id + scope check (chống IDOR) ──────────────
// Trả uid để by-id mutation truyền confirmedById (lib yêu cầu string).
async function loadScopedPayment(
  userId: string | undefined,
  paymentId: string,
): Promise<{ ok: true; uid: string; recordedById: string | null } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: "Phiên không hợp lệ" };
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);
  const row = await sdb.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, centerId: true, accountantStatus: true, recordedById: true },
  });
  if (!row || !passesScope("Payment", row, actor)) {
    return { ok: false, error: "Không tìm thấy khoản thanh toán" };
  }
  return { ok: true, uid: userId, recordedById: row.recordedById };
}

// ─── CONFIRM (Kế toán xác nhận → sinh Receipt) ──────────────────────────
// FIX-H8 — `idempotencyKey` (uuid client tạo mỗi lần bấm) làm double-click/retry an toàn.
export async function confirmPaymentAction(paymentId: string, idempotencyKey?: string) {
  const session = await requireAccountant();
  const scope = await loadScopedPayment(session.user.id, paymentId);
  if (!scope.ok) return { ok: false as const, error: scope.error };
  // AC5 — tách nhiệm vụ: người ghi nhận không được tự xác nhận khoản của mình.
  if (scope.recordedById && scope.recordedById === scope.uid) {
    return { ok: false as const, error: "Người ghi nhận không được tự xác nhận khoản của mình" };
  }

  const res = await confirmPayment({ paymentId, confirmedById: scope.uid, idempotencyKey });
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  // S6 — đồng bộ trang lead/convert (lấy leadId qua order của khoản, scopedDb cách ly cơ sở).
  const sdb = scopedDb(await resolveActor(session.user.id));
  const p = await sdb.payment.findUnique({
    where: { id: paymentId },
    select: { order: { select: { leadId: true } } },
  });
  const leadId = p?.order?.leadId;
  if (leadId) {
    revalidatePath(`/leads/${leadId}`);
    revalidatePath(`/leads/${leadId}/convert`);
  }
  return { ok: true as const, receiptId: res.receiptId };
}

// ─── REJECT (Kế toán từ chối — bắt buộc reason ≥5) ──────────────────────
export async function rejectPaymentAction(
  paymentId: string,
  reason: string,
  expectedUpdatedAt?: string,
) {
  const session = await requireAccountant();
  if (!reason || reason.trim().length < 5) {
    return { ok: false as const, error: "Lý do từ chối tối thiểu 5 ký tự" };
  }
  const scope = await loadScopedPayment(session.user.id, paymentId);
  if (!scope.ok) return { ok: false as const, error: scope.error };

  const res = await rejectPayment({
    paymentId,
    confirmedById: scope.uid,
    reason: reason.trim(),
    expectedUpdatedAt: expectedUpdatedAt || undefined,
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true as const };
}

// ─── SỬA KHOẢN CHỜ DUYỆT (sửa tại chỗ, KHÔNG sinh bút toán) ─────────────
/**
 * Khoản chưa qua kế toán là BẢN NHÁP: sửa thẳng. Khác hẳn "Điều chỉnh" — xem
 * `updatePendingPayment` trong lib/finance/payment.ts.
 *
 * Hai động từ khác nhau nên là hai đường khác nhau: sửa nháp KHÔNG sinh bút toán, còn
 * "Điều chỉnh" thì luôn sinh, và không bao giờ đụng vào dòng đã xác nhận.
 */
export async function updatePendingPaymentAction(input: unknown) {
  const session = await requireAccountant();
  const parsed = updatePendingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;
  const scope = await loadScopedPayment(session.user.id, data.paymentId);
  if (!scope.ok) return { ok: false as const, error: scope.error };

  const res = await updatePendingPayment({
    paymentId: data.paymentId,
    actorId: scope.uid,
    amount: data.amount,
    reason: trimOrNull(data.reason) ?? undefined,
    expectedUpdatedAt: data.expectedUpdatedAt || undefined,
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true as const };
}

// ─── ADJUST (Kế toán điều chỉnh — bút toán mới trỏ adjustmentOfId) ───────
export async function adjustPaymentAction(input: unknown) {
  // Cầu dao `ADJUST_PAYMENT_DISABLED` đã GỠ 07/09/2026 (Bước 7) sau khi bộ test Bước 6
  // xanh: 24 ca trên Postgres thật + 25 ca thuần. Không còn `lib/finance/cau-dao-dieu-chinh.ts`.
  const session = await requireAccountant();
  // Server Action là endpoint HTTP riêng — ẩn nút ở giao diện KHÔNG phải là cổng.
  if (!(await checkPermission("payments:adjust"))) {
    return {
      ok: false as const,
      error: "Bạn không có quyền điều chỉnh khoản thu.",
    };
  }
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  const data = parsed.data;
  const scope = await loadScopedPayment(session.user.id, data.paymentId);
  if (!scope.ok) return { ok: false as const, error: scope.error };

  const res = await adjustPayment({
    paymentId: data.paymentId,
    // Ô nhập gửi SỐ ĐÚNG CUỐI CÙNG của dòng này; backend tự tính delta.
    correctAmount: data.amount,
    reason: data.reason.trim(),
    actorId: scope.uid,
    expectedUpdatedAt: data.expectedUpdatedAt || undefined,
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true as const, adjustmentId: res.adjustmentId, delta: res.delta };
}

// ─── REFUND (Kế toán hoàn — bút toán âm, không xoá gốc) ─────────────────
export async function refundPaymentAction(
  paymentId: string,
  reason: string,
  expectedUpdatedAt?: string,
) {
  const session = await requireAccountant();
  if (!reason || reason.trim().length < 5) {
    return { ok: false as const, error: "Lý do hoàn tiền tối thiểu 5 ký tự" };
  }
  const scope = await loadScopedPayment(session.user.id, paymentId);
  if (!scope.ok) return { ok: false as const, error: scope.error };

  const res = await refundPayment({
    paymentId,
    confirmedById: scope.uid,
    reason: reason.trim(),
    expectedUpdatedAt: expectedUpdatedAt || undefined,
  });
  if (!res.ok) return { ok: false as const, error: res.error };
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true as const };
}

// ─── XÁC NHẬN HÀNG LOẠT khoản NHẬP LIỆU BAN ĐẦU (phương án B, 13/09/2026) ────
//
// VÌ SAO CÓ: học phí của khách chốt TRƯỚC 06/08 nhập từ sheet qua
// `/leads/import/registered`. Nó tạo Order `CONFIRMED` + `Payment` mang dấu
// `[backfill-import]` nhưng để `accountantStatus: PENDING`, mà doanh thu chỉ đếm
// `CONFIRMED` ⇒ tiền cũ không vào doanh thu, và `confirmPaymentAction` là từng khoản một.
//
// ⚠️ KHÔNG lách cổng nào. Mỗi khoản vẫn đi qua ĐÚNG `confirmPayment` đang chạy (sinh
// `Receipt`, ghi nhật ký), và cổng TÁCH NHIỆM VỤ ("người ghi nhận không tự xác nhận")
// được giữ nguyên — thực thi ở `lapKeHoachXacNhan` rồi `confirmPayment` kiểm lại.
//
// ⚠️ ĐỘI NHỎ: nếu người bấm nút CHÍNH LÀ người đã nhập liệu thì MỌI khoản rơi vào
// `TU_XAC_NHAN` và lượt này xác nhận 0 khoản. Đó không phải lỗi — hàm trả về số đếm
// theo lý do để màn hiện ra, người vận hành đổi người xác nhận hoặc xin đổi luật.
//
// `xemThu: true` → chỉ TRẢ VỀ kế hoạch, KHÔNG ghi gì. Dùng cho màn xem trước.

export async function bulkConfirmBackfillPaymentsAction(opts?: {
  xemThu?: boolean;
  /** Trần số khoản xử lý một lượt — tránh transaction dài trên prod. */
  gioiHan?: number;
}) {
  const session = await requireAccountant();
  const actorId = session.user.id as string;
  const sdb = scopedDb(await resolveActor(actorId));
  const gioiHan = Math.min(Math.max(1, Math.round(opts?.gioiHan ?? 200)), 500);

  // scopedDb lọc theo tầm nhìn cơ sở (Payment ∈ SCOPED_MODELS) — người cấp cơ sở chỉ
  // thấy khoản của cơ sở mình.
  const rows = await sdb.payment.findMany({
    where: {
      deletedAt: null,
      accountantStatus: "PENDING",
      note: { contains: BACKFILL_PAYMENT_MARKER },
    },
    select: {
      id: true,
      note: true,
      accountantStatus: true,
      enrollmentId: true,
      recordedById: true,
      amount: true,
      order: { select: { type: true } },
    },
    orderBy: { paidDate: "asc" },
    take: gioiHan,
  });

  // `loaiDon` BẮT BUỘC — đơn KIT/THI không cần ghi danh (`lib/finance/can-ghi-danh.ts`).
  const ungVien: BackfillCandidate[] = rows.map(({ order, ...r }) => ({ ...r, loaiDon: order?.type ?? null }));
  const plan = lapKeHoachXacNhan(ungVien, actorId);

  if (opts?.xemThu) {
    return {
      ok: true as const,
      xemThu: true as const,
      // `quet` = số khoản backfill CHỜ KẾ TOÁN tìm được. Phải trả về để màn phân biệt
      // "CHƯA CÓ khoản nào nhập từ sheet" (quet = 0) với "CÓ nhưng bị cổng bỏ qua"
      // (quet > 0, soNhan = 0). Gộp hai thứ đó vào một câu là báo sai nguyên nhân.
      quet: rows.length,
      soNhan: plan.nhan.length,
      tongNhan: plan.tongNhan,
      soBo: plan.bo.length,
      demTheoLyDo: plan.demTheoLyDo,
    };
  }

  // Chạy TỪNG khoản qua `confirmPayment` — KHÔNG gộp một transaction lớn: một khoản
  // hỏng không được kéo cả lượt về, và `confirmPayment` tự mở transaction riêng
  // (sinh Receipt + publishEvent bên trong).
  let thanhCong = 0;
  const loi: { id: string; error: string }[] = [];
  for (const p of plan.nhan) {
    const res = await confirmPayment({ paymentId: p.id, confirmedById: actorId });
    if (res.ok) thanhCong += 1;
    else loi.push({ id: p.id, error: res.error });
  }

  await writeAudit({
    actor: (() => {
      const a = getAuditActor(session);
      return { id: a.actorId, name: a.actorName };
    })(),
    module: "finance",
    entityType: "Payment",
    // Không có một khoản cụ thể — dùng id người bấm làm mốc của LƯỢT chạy.
    entityId: `bulk-backfill-confirm:${actorId}`,
    action: "CONFIRM",
    newValues: {
      quet: rows.length,
      nhan: plan.nhan.length,
      thanhCong,
      loi: loi.length,
      tongTien: plan.tongNhan,
      demTheoLyDo: plan.demTheoLyDo,
    },
    reason: "Xác nhận hàng loạt khoản nhập liệu ban đầu (học phí chốt trước 06/08)",
    ...(await getRequestMetadata()),
  });

  revalidatePath("/payments");
  revalidatePath("/cong-no");
  revalidatePath("/bao-cao/doanh-thu");
  revalidatePath("/bao-cao/trung-tam");
  revalidatePath("/dashboard");

  return {
    ok: true as const,
    xemThu: false as const,
    quet: rows.length,
    thanhCong,
    soBo: plan.bo.length,
    demTheoLyDo: plan.demTheoLyDo,
    loi,
    tongTien: plan.tongNhan,
  };
}

// ─── KHOẢN BỊ BỎ: XEM TỪNG CÁI, VÀ SỬA ĐƯỢC ───────────────────────────────────
//
// Chủ dự án 14/09/2026, chỉ vào màn này: "bấm xem thử xong chỉ xem và không có thao tác
// gì nữa à?"
//
// Đúng. Khối xem thử đếm được số khoản bị bỏ và nêu lý do, nhưng không cho làm gì. Mà lý
// do phổ biến nhất — `LY_DO_BO.CHUA_GAN_GHI_DANH` — là thứ SỬA ĐƯỢC: trỏ khoản vào đúng
// ghi danh của em. Không có đường sửa thì tiền nằm mãi ở trạng thái chờ, và cổng phụ
// huynh vẫn hiện nợ dù nhà đã đóng.

export type KhoanBiBoView = {
  id: string;
  soTien: number;
  ngay: string | null;
  lyDo: string;
  hocVien: string | null;
  phuHuynh: string | null;
  maDon: string | null;
  /** Ghi danh còn sống của em — để người dùng chọn. Rỗng = em chưa có ghi danh nào. */
  ungVien: { id: string; tenLop: string | null; tenKhoa: string | null; finalPrice: number | null }[];
  /** Gợi ý khi CHỈ CÓ MỘT ghi danh. `null` ⇒ phải có người chọn. */
  goiYGhiDanhId: string | null;
  mucGan: MucGan;
  /**
   * Khoản này do đâu sinh ra — dạng MÁY ĐỌC, để màn nhóm/đếm theo nguồn khi cần.
   *
   * Nhãn cho người đọc đã nằm sẵn trong `lyDo` (xem `dongVuongMac`) vì đó là trường DUY
   * NHẤT màn đang vẽ; giữ thêm bản máy ở đây để lần nâng cấp sau khỏi phải tách chuỗi.
   */
  nguon: NguonKhoan;
};

/**
 * Danh sách khoản TIỀN CHƯA VÀO ĐƯỢC CÔNG NỢ, kèm ứng viên ghi danh để gắn.
 *
 * Chỉ ĐỌC. Cùng cổng quyền và cùng phạm vi `scopedDb` với lượt xác nhận hàng loạt.
 *
 * ⚠️ PHẠM VI ĐÃ MỞ 14/09/2026 — tên "khoản bị bỏ" nay hẹp hơn việc nó làm. Trước bản vá
 * nó CHỈ tra khoản `[backfill-import]`, nên mọi đồng tiền về qua cổng thanh toán mà hệ
 * thống không dám tự gắn lớp đều tàng hình. Nay danh sách gồm HAI nhóm:
 *   · khoản nhập từ Excel bị lượt xác nhận hàng loạt bỏ lại — đủ mọi lý do, y như trước;
 *   · MỌI khoản đang chờ kế toán mà CHƯA GẮN GHI DANH, bất kể marker nào sinh ra nó.
 *
 * Lý do vẫn dùng chung ATOM với khối "Xem thử" (`nenXacNhanHangLoat`) cho nhóm thứ nhất,
 * nên hai chỗ không thể lệch nhau. Vì sao không dùng thẳng `lapKeHoachXacNhan` cho cả
 * hai nhóm: xem chú thích trong `lib/finance/gan-ghi-danh-khoan.ts` — nó trả lời câu
 * "có vào được lượt hàng loạt không", không phải câu "đồng tiền này vướng gì".
 */
export async function khoanBiBoAction(opts?: { gioiHan?: number }) {
  const session = await requireAccountant();
  const actorId = session.user.id as string;
  const sdb = scopedDb(await resolveActor(actorId));
  const gioiHan = Math.min(Math.max(1, Math.round(opts?.gioiHan ?? 200)), 500);

  const rows = await sdb.payment.findMany({
    where: {
      deletedAt: null,
      accountantStatus: "PENDING",
      // Hai vế dưới chỉ để DB khỏi kéo về dữ liệu không bao giờ hiện. LUẬT + LÝ DO nằm ở
      // `vuongMacCuaKhoan` (bút toán ADJUSTMENT giữ delta của phiếu gốc; dòng hoàn tiền
      // mang số ÂM) — và hàm đó kiểm lại lần nữa, cố ý.
      paymentType: "PAYMENT",
      amount: { gt: 0 },
      // ⚠️ BẢN VÁ 14/09/2026 — TRƯỚC ĐÂY Ở ĐÂY CHỈ CÓ MỘT DÒNG:
      //     note: { contains: BACKFILL_PAYMENT_MARKER }
      // tức danh sách CHỈ thấy khoản nhập từ file Excel. Khoản do webhook cổng thanh
      // toán sinh ra mang `[auto:sepay:<txn>]` / `[auto:payos:<txn>]` nên KHÔNG BAO GIỜ
      // hiện ra để mà gắn — trong khi `lib/payments/payos-ingest.ts:1120` CỐ Ý để
      // `enrollmentId = null` mỗi khi mơ hồ (em học ≥2 lớp, hoặc đơn không gắn học
      // viên) và ghi rõ trong chú thích rằng ca đó nhường cho NGƯỜI quyết.
      //
      // Người đó không có màn nào để quyết: `confirmPayment` mở đầu bằng
      // `if (!existing.enrollmentId) return fail(...)`, nên tiền thật đã về tài khoản,
      // đã có dòng trong sổ, mà không thao tác nào đưa được vào công nợ.
      //
      // Vế `enrollmentId: null` là vế MỞ, KHÔNG thay vế cũ: khoản backfill còn vướng
      // những lý do khác (đã gắn lớp nhưng "bạn là người ghi nhận khoản này") vẫn phải
      // hiện, kẻo bản vá này lại giấu đi đúng nhóm mà màn sinh ra để phục vụ.
      OR: [
        { note: { contains: BACKFILL_PAYMENT_MARKER } },
        { enrollmentId: null },
      ],
    },
    select: {
      id: true,
      note: true,
      accountantStatus: true,
      paymentType: true,
      enrollmentId: true,
      recordedById: true,
      amount: true,
      paidDate: true,
      order: {
        select: {
          type: true,
          code: true,
          customerName: true,
          studentId: true,
          student: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { paidDate: "asc" },
    take: gioiHan,
  });

  // Nhánh backfill của `vuongMacCuaKhoan` ỦY QUYỀN cho `nenXacNhanHangLoat` — cùng ATOM
  // với `lapKeHoachXacNhan` ở khối "Xem thử", nên lý do hiện ở đây và con số đếm ở trên
  // không thể lệch nhau. Xem chú thích dài trong `lib/finance/gan-ghi-danh-khoan.ts`.
  const vuongTheoId = new Map<string, Extract<VuongMacKhoan, { hien: true }>>();
  for (const r of rows) {
    const v = vuongMacCuaKhoan({ ...r, loaiDon: r.order?.type ?? null }, actorId);
    if (v.hien) vuongTheoId.set(r.id, v);
  }
  const khoanBo = rows.filter((r) => vuongTheoId.has(r.id));

  // Tra ghi danh MỘT LƯỢT cho mọi học viên liên quan — mỗi khoản một câu tra thì 200
  // khoản là 200 lượt đi DB.
  const idHocVien = [
    ...new Set(khoanBo.map((r) => r.order?.student?.id).filter((v): v is string => !!v)),
  ];
  const ghiDanh = idHocVien.length
    ? await sdb.enrollment.findMany({
        where: { studentId: { in: idHocVien }, deletedAt: null },
        select: {
          id: true,
          studentId: true,
          finalPrice: true,
          class: { select: { name: true } },
          course: { select: { name: true } },
        },
      })
    : [];
  const theoHocVien = new Map<string, GhiDanhUngVien[]>();
  for (const e of ghiDanh) {
    if (!e.studentId) continue;
    const item: GhiDanhUngVien = {
      id: e.id,
      tenLop: e.class?.name ?? null,
      tenKhoa: e.course?.name ?? null,
      finalPrice: e.finalPrice,
    };
    const cu = theoHocVien.get(e.studentId);
    if (cu) cu.push(item);
    else theoHocVien.set(e.studentId, [item]);
  }

  const ds: KhoanBiBoView[] = khoanBo.map((r) => {
    const v = vuongTheoId.get(r.id)!;
    const hvId = r.order?.student?.id ?? null;
    const chon = mucGanChoKhoan({
      // Khoản ĐÃ gắn lớp thì `ganGhiDanhChoKhoanAction` từ chối ("Khoản này đã gắn ghi
      // danh rồi") — nên màn KHÔNG được bày nút Gắn cho nó. Luật 12.
      daGanGhiDanh: !!r.enrollmentId,
      coHocVien: !!hvId,
      ghiDanh: hvId ? (theoHocVien.get(hvId) ?? []) : [],
    });
    // Ca "đơn chưa gắn học viên" phải nói ra VIỆC PHẢI LÀM, kẻo nó trông y hệt ca "em
    // chưa có lớp" và người dùng bị chỉ sang trang Ghi danh — nơi không tạo được ghi
    // danh cho một đơn chưa biết là của em nào.
    const viecPhaiLam =
      chon.muc === MUC_GAN.THIEU_HOC_VIEN
        ? "mở đơn gắn học viên trước — ở đây chưa biết tiền này của em nào"
        : null;
    return {
      id: r.id,
      soTien: r.amount,
      ngay: r.paidDate ? r.paidDate.toISOString() : null,
      lyDo: dongVuongMac(v.lyDo, v.nguon, viecPhaiLam),
      hocVien: r.order?.student?.name ?? null,
      phuHuynh: r.order?.customerName ?? null,
      maDon: r.order?.code ?? null,
      ungVien: chon.ungVien,
      goiYGhiDanhId: chon.ghiDanhId,
      mucGan: chon.muc,
      nguon: v.nguon,
    };
  });

  return { ok: true as const, ds };
}

/**
 * GẮN một khoản thu vào ghi danh.
 *
 * ⚠️ ĐÂY LÀ ĐƯỜNG GHI TIỀN, dù không đổi một đồng nào: `Payment.enrollmentId` chính là
 * thứ cổng phụ huynh và màn công nợ dùng để cộng — gắn nhầm lớp là tiền của lớp này trừ
 * vào nợ của lớp kia, và không màn nào kêu lên.
 *
 * Ba lớp gác:
 *   · quyền `payments:confirm` — cùng cổng với việc xác nhận khoản, vì hệ quả tương đương;
 *   · `passesScope` cho CẢ khoản lẫn ghi danh — `scopedDb` chỉ auto-scope đường ĐỌC;
 *   · ghi danh phải THUỘC ĐÚNG học viên của đơn mang khoản đó. Thiếu vế này thì gửi lên
 *     `enrollmentId` của em khác cùng cơ sở là gắn được — `passesScope` không chặn nổi.
 *
 * Chỉ nhận khoản CHƯA GẮN. Đổi ghi danh của khoản đã gắn là chuyện khác hẳn (tiền đang
 * nằm trong công nợ của một em rồi) và không đi qua đây.
 */
export async function ganGhiDanhChoKhoanAction(input: unknown) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false as const, error: "Không có quyền xác nhận khoản thu" };
  }

  const parsed = z
    .object({ paymentId: z.string().min(1), enrollmentId: z.string().min(1) })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  const actor = await resolveActor(session.user.id as string);
  const sdb = scopedDb(actor);

  const khoan = await sdb.payment.findUnique({
    where: { id: d.paymentId },
    select: {
      id: true,
      centerId: true,
      deletedAt: true,
      enrollmentId: true,
      accountantStatus: true,
      amount: true,
      order: { select: { code: true, studentId: true } },
    },
  });
  if (!khoan || khoan.deletedAt || !passesScope("Payment", khoan, actor)) {
    return { ok: false as const, error: "Không tìm thấy khoản thu trong phạm vi của bạn" };
  }
  if (khoan.enrollmentId) {
    return {
      ok: false as const,
      error: "Khoản này đã gắn ghi danh rồi — muốn đổi thì xử lý ở màn khoản thu.",
    };
  }

  const gd = await sdb.enrollment.findUnique({
    where: { id: d.enrollmentId },
    select: { id: true, centerId: true, studentId: true, deletedAt: true },
  });
  if (!gd || gd.deletedAt || !passesScope("Enrollment", gd, actor)) {
    return { ok: false as const, error: "Không tìm thấy ghi danh trong phạm vi của bạn" };
  }
  // Ghi danh phải của ĐÚNG em mang đơn này. Không có vế này thì `passesScope` cho qua
  // mọi ghi danh cùng cơ sở, và tiền rơi vào hồ sơ người khác.
  if (!khoan.order?.studentId || gd.studentId !== khoan.order.studentId) {
    return { ok: false as const, error: "Ghi danh này không thuộc học viên của đơn" };
  }

  const au = getAuditActor(session);
  await sdb.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Prisma.TransactionClient;
    await tx.payment.update({
      where: { id: khoan.id },
      data: { enrollmentId: gd.id },
    });
    await writeAudit({
      actor: { id: au.actorId, name: au.actorName },
      module: "finance",
      entityType: "Payment",
      entityId: khoan.id,
      action: "UPDATE",
      oldValues: { enrollmentId: null },
      newValues: {
        enrollmentId: gd.id,
        soTien: khoan.amount,
        maDon: khoan.order?.code ?? null,
        nguon: "khoan-bi-bo-backfill",
      },
      orgUnitId: khoan.centerId,
      tx,
    });
  });

  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true as const };
}
