// lib/finance/payment.ts — R7-04: khoản thanh toán 2 tầng (Sale ghi nhận ↔ Kế toán xác nhận).
// MỌI mutation tiền chạy trong db.$transaction. Audit before/after; reject/adjust/refund
// BẮT BUỘC reason. Hàm THUẦN role-logic (can() do tầng action lo) — chỉ xử lý nghiệp vụ.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { KHOAN_DA_GHI_NHAN, laKhoanDaGhiNhan } from "@/lib/finance/ghi-nhan";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { issueReceipt } from "@/lib/finance/receipt";
import { thieuGhiDanh } from "@/lib/finance/can-ghi-danh";
import {
  chiaKhoanTheoDon,
  type GhiDanhCuaLead,
} from "@/lib/finance/chia-khoan-theo-don";
import { expandPhoneVariants } from "@/lib/phone";
// Cổng "tiền vào ⇒ lead lên Đã đăng ký". Thân hàm DỜI sang `@/lib/leads/tien-vao-day-pheu`
// ở I-1 (22/09/2026) để đường tiền tự động gọi được mà không vi phạm lưới `[GGW-04]` — xem
// khối chú thích ở chỗ re-export bên dưới. Hai sổ lead (sổ ĐẾM phễu + vết NGƯỜI ĐỌC) nay
// nằm trong tệp đó, không còn import ở đây.
import { maybeAdvanceLeadToRegistered } from "@/lib/leads/tien-vao-day-pheu";
// Sổ đăng ký marker — MỘT chỗ định nghĩa chuỗi nhận dạng khoản tự sinh.
import {
  AUTO_ORDER_CONFIRM_MARKER,
  installmentMarker,
} from "@/lib/finance/payment-markers";
import { KHOAN_DA_DONG } from "@/lib/finance/debt";
import { khoanDaKhoaHoaDon, thongDiepKhoaHoaDon } from "@/lib/finance/hoa-don/khoa-khoan";
import { soTienRong } from "@/lib/finance/hoa-don/nguon-khoan";
import {
  giuNguyenTien,
  lapKeHoachGanGhiDanh,
  type GhiDanhUngVien,
  type KeHoachGan,
  type KhoaHoaDonCuaKhoan,
  type KhoanChuaGan,
} from "@/lib/finance/ke-hoach-gan-ghi-danh";
import type { DongDonCoHocVien } from "@/lib/finance/chia-khoan-theo-don";

type Tx = Prisma.TransactionClient;

/** Kết quả chung — { ok } + field phụ; lỗi → { ok:false, error }. */
type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

function fail(error: string): Fail {
  return { ok: false, error };
}

/**
 * FIX-H9 — mã lỗi optimistic lock: record đã bị người khác sửa kể từ lúc client
 * đọc `updatedAt`. FE map STALE_WRITE → toast "Người khác vừa sửa, tải lại" + reload.
 */
export const STALE_WRITE = "STALE_WRITE" as const;

/** Resolve actor cho audit (chỉ có id → tra tên; null → Hệ thống). */
async function auditActor(userId: string | null | undefined): Promise<AuditActor> {
  if (!userId) return { id: null, name: "Hệ thống" };
  const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { id: userId, name: u?.name ?? userId };
}

// ─── S1 — Hợp nhất sổ thanh toán (Ledger-B → Payment) ─────────────────────────
// Actor tối thiểu cho ghi nhận tự động: id (+name cho audit) + centerId fallback.
export type EnsurePaymentActor = { id: string | null; name?: string | null; centerId?: string | null };

const AUTO_PAYMENT_METHOD = "auto";

/**
 * Khoá idempotency lưu trong Payment.note (Payment KHÔNG có cột soDot).
 *
 * ⚠️ 13/09/2026 — chuỗi nay lấy từ SỔ ĐĂNG KÝ `lib/finance/payment-markers.ts`, không
 * ghép tay nữa. Trước đó hàm này ghép một đằng còn `installments.ts` dọn theo tiền tố
 * `"[auto:"` một nẻo, và cái tiền tố đó quét luôn tiền thật từ ngân hàng (DS-03).
 */
function autoPaymentMarker(soDot?: number | null): string {
  return soDot != null ? installmentMarker(soDot) : AUTO_ORDER_CONFIRM_MARKER;
}

/**
 * S1 — Đảm bảo tồn tại 1 Payment(saleStatus=RECORDED) cho phần tiền của đơn:
 *  - đợt1 (recordInstallmentPlan), đợt2 (markInstallmentPaid), xác nhận đơn offline
 *    (changeOrderStatusAction →CONFIRMED) đều đi qua đây để Ledger-A (Payment) khớp Ledger-B.
 * IDEMPOTENT theo (orderId, soDot) — gọi lại KHÔNG tạo trùng (key = marker trong note).
 * Payment.centerId LUÔN suy ra (order.centerId → lead.centerId → actor.centerId), không để null.
 * Sau khi tạo, tự đẩy lead AWAITING_DECISION → REGISTERED (mở khoá PH-2 / S3).
 * CHẠY TRONG tx do call-site cung cấp (money-sensitive).
 */
export async function ensureOrderPaymentRecorded(
  tx: Tx,
  params: {
    orderId: string;
    soDot?: number | null;
    amount: number;
    leadId?: string | null;
    centerId?: string | null;
    actor: EnsurePaymentActor;
  },
): Promise<{ ok: true; created: boolean; paymentId: string | null } | Fail> {
  const { orderId, soDot, amount, leadId } = params;
  const marker = autoPaymentMarker(soDot);

  // Idempotency: đã có Payment auto cho (orderId, soDot) → trả lại, không tạo lại.
  const existing = await tx.payment.findFirst({
    where: { orderId, deletedAt: null, note: { contains: marker } },
    select: { id: true },
  });
  if (existing) return { ok: true, created: false, paymentId: existing.id };

  // Không có tiền để ghi (vd đợt2 = 0) → no-op thành công.
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: true, created: false, paymentId: null };
  }

  // Suy centerId: order → lead → actor; KHÔNG để null nếu còn nguồn khác.
  let centerId: string | null = params.centerId ?? null;
  if (!centerId && leadId) {
    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { centerId: true } });
    centerId = lead?.centerId ?? null;
  }
  if (!centerId) centerId = params.actor.centerId ?? null;

  // ⚠️ GẮN GHI DANH cho khoản thu tự động — nay làm SAU khi tạo, bằng hàm dùng chung
  // `ganGhiDanhChoKhoanCuaDon` (xem cuối tệp). Xem chú thích ở đó để biết vì sao bản
  // 06/09/2026 (chỉ gắn khi `Order.studentId` có giá trị) không đủ.
  const enrollmentId: string | null = null;

  const now = new Date();
  const payment = await tx.payment.create({
    data: {
      orderId,
      enrollmentId,
      amount: Math.round(amount),
      method: AUTO_PAYMENT_METHOD,
      paidDate: now,
      note:
        soDot != null
          ? `Ghi nhận tự động đợt ${soDot} ${marker}`
          : `Ghi nhận tự động (xác nhận đơn) ${marker}`,
      saleStatus: "RECORDED",
      accountantStatus: "PENDING",
      recordedById: params.actor.id,
      centerId,
    },
    select: { id: true },
  });

  await writeAudit({
    actor: { id: params.actor.id, name: params.actor.name ?? "Hệ thống" },
    module: "finance",
    entityType: "Payment",
    entityId: payment.id,
    action: "CREATE",
    newValues: {
      amount: Math.round(amount),
      saleStatus: "RECORDED",
      source: "order-ledger",
      soDot: soDot ?? null,
    },
    orgUnitId: centerId,
    tx,
  });

  // ── GẮN GHI DANH NGAY, KHÔNG ĐỢI CONVERT [15/09/2026] ──────────────────────
  // Học viên đã tồn tại (lead đã chuyển đổi) thì khoản này gắn được luôn. Không gắn được
  // thì để nguyên `enrollmentId = null` — đúng hiện trạng, không tệ hơn.
  await ganGhiDanhChoKhoanCuaDon(tx, {
    orderId,
    actor: { id: params.actor.id, name: params.actor.name ?? "Hệ thống" },
  });

  // S3 / PH-2 — ghi nhận tiền → lead tự lên 'Đã đăng ký' (mở khoá convert).
  if (leadId) {
    await maybeAdvanceLeadToRegistered(tx, { leadId, actor: params.actor });
  }

  return { ok: true, created: true, paymentId: payment.id };
}

/**
 * S3 — TIỀN VÀO ⇒ lead CHỜ QUYẾT ĐỊNH lên ĐÃ ĐĂNG KÝ.
 *
 * ⚠️ THÂN HÀM ĐÃ DỜI sang `@/lib/leads/tien-vao-day-pheu` [I-1 · 22/09/2026]. Ở đây chỉ còn
 * lối vào cũ để không phải sửa chỗ gọi và bộ test đang neo vào tệp này.
 *
 * Vì sao dời: đường tiền TỰ ĐỘNG (`lib/payments/payos-ingest.ts`) cũng phải gọi cổng này,
 * mà lưới `[GGW-04]` CẤM tệp đó import bất cứ thứ gì `from "@/lib/finance/payment"` — lệnh
 * cấm đúng, vì nó canh chuyện đường webhook lỡ dùng marker của `ensureOrderPaymentRecorded`
 * rồi bị `lib/orders/installments.ts` xoá mềm tiền ngân hàng. Lời giải là đừng với tay vào
 * đây, không phải nới lưới. Lý lẽ đầy đủ nằm trong tệp mới.
 */
export { maybeAdvanceLeadToRegistered } from "@/lib/leads/tien-vao-day-pheu";

// ─── FIN-01 (Q1=A) — Gắn/chia khoản RECORDED của đơn vào Enrollment lúc convert ───
/**
 * Sau khi convert tạo Enrollment(s), GẮN các khoản `RECORDED` chưa gắn ghi danh của đơn
 * (theo order.leadId) vào ghi danh → `confirmPayment` sinh Receipt (scoped theo Enrollment)
 * chạy được, `getDebtRows` phản ánh đúng.
 *  - **1 ghi danh** → gắn nguyên khoản.
 *  - **Nhiều ghi danh (Q1=A)** → CHIA mỗi khoản theo `weights` (finalPrice từng ghi danh),
 *    bất biến tổng (allocateByWeight). Giữ id khoản gốc cho phần dương ĐẦU TIÊN, tạo Payment
 *    con cho các phần còn lại; phần = 0 (học bổng toàn phần) → bỏ qua (ghi danh đó không nợ).
 * KHÔNG auto-confirm — giữ tách vai kế toán (xác nhận tiền vào ngân hàng ở /payments, hoặc
 * trang Đối soát ngân hàng FIN-02). `enrollmentIds[i]` PHẢI tương ứng `weights[i]` (cùng thứ
 * tự students lúc convert). Chạy TRONG tx call-site cấp. Idempotent nhờ cổng convert
 * (atomic claim + idempotencyKey) — chỉ chạy 1 lần / lead.
 */
export async function linkRecordedPaymentsToEnrollments(
  tx: Tx,
  params: {
    leadId: string;
    /**
     * Ghi danh vừa tạo, KÈM `studentId` — bắt buộc từ 15/09/2026.
     *
     * ⚠️ Trước bản này tham số là hai mảng song song `enrollmentIds` + `weights`. Không có
     * `studentId` thì hàm KHÔNG THỂ biết khoản của đơn nào thuộc về em nào, nên nó chia mọi
     * khoản cho mọi ghi danh của lead. Đổi kiểu để cái sai đó không diễn đạt lại được.
     */
    ghiDanh: GhiDanhCuaLead[];
    actor: AuditActor;
  },
): Promise<{ linked: number; splitCreated: number; duongLui: number }> {
  const { leadId, ghiDanh, actor } = params;
  if (ghiDanh.length === 0) return { linked: 0, splitCreated: 0, duongLui: 0 };

  const recorded = await tx.payment.findMany({
    where: { ...KHOAN_DA_GHI_NHAN, enrollmentId: null, order: { leadId } },
    select: {
      id: true, amount: true, orderId: true, method: true, paidDate: true,
      note: true, evidenceUrl: true, recordedById: true, centerId: true,
      accountantStatus: true,
    },
  });
  if (recorded.length === 0) return { linked: 0, splitCreated: 0, duongLui: 0 };

  // ⚠️ CHỐT CHẶN CỨNG (07/09/2026) — nhánh tách dưới đây SỬA `amount` của dòng gốc
  // (dòng 268: `tx.payment.update({ data: { amount: part } })`). Điều đó chỉ đúng khi
  // dòng còn là BẢN NHÁP: chưa qua kế toán, chưa đối soát sao kê, chưa vào bất kỳ tổng
  // nào của trục A. Đúng cùng một luận điểm với `updatePendingPayment`.
  //
  // Nếu một ngày nào đó dòng CONFIRMED lọt được vào đây thì việc sửa `amount` là làm sai
  // lệch tiền đã đối soát — âm thầm, giữa một transaction convert. Thà nổ ngay còn hơn.
  // Truy vấn trên vốn đã lọc `enrollmentId: null`, mà `confirmPayment` từ chối xác nhận
  // khoản chưa gắn ghi danh, nên về lý thuyết không thể xảy ra — chốt này canh đúng cái
  // "về lý thuyết" đó.
  const daXacNhan = recorded.filter((p) => p.accountantStatus === "CONFIRMED");
  if (daXacNhan.length > 0) {
    throw new Error(
      `linkRecordedPaymentsToEnrollments: gặp ${daXacNhan.length} khoản ĐÃ XÁC NHẬN ` +
        `(${daXacNhan.map((p) => p.id).join(", ")}). Nhánh tách sửa \`amount\` của dòng gốc ` +
        "nên TUYỆT ĐỐI không được chạm khoản đã đối soát — dùng adjustPayment.",
    );
  }

  // ── CHIA THEO ĐƠN, KHÔNG THEO LEAD [15/09/2026] ────────────────────────────
  //
  // Luật ở `lib/finance/chia-khoan-theo-don.ts` (thuần, có test + đã cấy lỗi). Ở đây chỉ
  // còn việc nạp CÁC DÒNG của những đơn có khoản, rồi ghi kết quả.
  //
  // ⚠️ Nạp dòng theo `orderId` CỦA CHÍNH CÁC KHOẢN, không nạp theo lead. Đó đúng là chỗ
  // bản cũ đánh mất ranh giới đơn.
  const maDon = [...new Set(recorded.map((p) => p.orderId).filter((x): x is string => !!x))];
  const dongTheoDon = new Map<
    string,
    { studentId: string | null; courseId: string | null; thanhTien: number }[]
  >();
  if (maDon.length > 0) {
    const items = await tx.orderItem.findMany({
      where: { orderId: { in: maDon } },
      select: {
        orderId: true,
        studentId: true,
        totalPrice: true,
        discountAmount: true,
        metadata: true,
      },
    });
    for (const it of items) {
      const ds = dongTheoDon.get(it.orderId) ?? [];
      // ⚠️ `studentId` của dòng thường NULL ở luồng lead — học viên chỉ ra đời ở bước
      // Chuyển đổi, SAU khi đơn đã tồn tại. Khoá học mới là thứ luôn có trên dòng, nên nó
      // là móc nối chính; xem `chiaKhoanTheoDon`.
      const m = it.metadata as Record<string, unknown> | null;
      const courseId = typeof m?.courseId === "string" && m.courseId ? m.courseId : null;
      // TIỀN DÒNG SAU GIẢM GIÁ: `totalPrice` là tạm tính của dòng, `discountAmount` là tổng
      // khoản giảm của dòng. Cân theo tạm tính là bỏ qua ưu đãi đã cho riêng em đó.
      ds.push({
        studentId: it.studentId,
        courseId,
        thanhTien: it.totalPrice - (it.discountAmount ?? 0),
      });
      dongTheoDon.set(it.orderId, ds);
    }
  }

  // Khoản đang nằm trong hoá đơn (PLAN §5): gắn ghi danh mà GIỮ NGUYÊN số tiền thì được — tờ
  // hoá đơn không đổi, và không gắn thì khoản không bao giờ xác nhận được. Phải TÁCH tiền (sửa
  // `amount`) thì bỏ qua: tờ hoá đơn đã chụp số của dòng này.
  const daKhoa = new Set((await khoanDaKhoaHoaDon(tx, recorded.map((p) => p.id))).map((k) => k.paymentId));

  let splitCreated = 0;
  let duongLui = 0;
  for (const p of recorded) {
    const { phan, duongLui: lui } = chiaKhoanTheoDon(
      p.amount,
      dongTheoDon.get(p.orderId ?? "") ?? [],
      ghiDanh,
    );
    if (lui) duongLui++;
    if (phan.length === 0) continue;
    if (daKhoa.has(p.id) && !giuNguyenTien(phan, p.amount)) continue;

    const soPhan = phan.length;
    let reusedOriginal = false;
    for (let k = 0; k < soPhan; k++) {
      const { enrollmentId, amount } = phan[k]!;
      // Một mảnh ⇒ giữ nguyên ghi chú. Dán "[tách 1/1]" vào một khoản không hề tách là nói
      // dối trên chính dòng sổ.
      const note =
        soPhan === 1
          ? (p.note ?? null)
          : `${(p.note ?? "").trim()} [tách ${k + 1}/${soPhan}]`.trim();
      if (!reusedOriginal) {
        await tx.payment.update({ where: { id: p.id }, data: { enrollmentId, amount, note } });
        await writeAudit({
          actor, module: "finance", entityType: "Payment", entityId: p.id, action: "UPDATE",
          changedFields: ["amount", "enrollmentId"],
          oldValues: { amount: p.amount, enrollmentId: null },
          newValues: { amount, enrollmentId, source: "convert-split", duongLui: lui },
          orgUnitId: p.centerId, tx,
        });
        reusedOriginal = true;
      } else {
        const created = await tx.payment.create({
          data: {
            orderId: p.orderId, enrollmentId, amount,
            method: p.method, paidDate: p.paidDate, evidenceUrl: p.evidenceUrl ?? null, note,
            saleStatus: "RECORDED", accountantStatus: "PENDING",
            recordedById: p.recordedById, centerId: p.centerId,
          },
          select: { id: true },
        });
        splitCreated++;
        await writeAudit({
          actor, module: "finance", entityType: "Payment", entityId: created.id, action: "CREATE",
          newValues: { amount, enrollmentId, source: "convert-split", splitFrom: p.id },
          orgUnitId: p.centerId, tx,
        });
      }
    }
  }
  return { linked: recorded.length, splitCreated, duongLui };
}

/**
 * GẮN GHI DANH CHO KHOẢN CỦA MỘT ĐƠN — chạy được BẤT CỨ LÚC NÀO, không chỉ lúc convert.
 *
 * ── Con bug đóng ở đây (đo 15/09/2026, chạy tay đầu-cuối) ──
 * `linkRecordedPaymentsToEnrollments` chỉ chạy MỘT LẦN, trong `convert-lead-v2`. Mọi đợt
 * đóng SAU đó sinh `Payment` với `enrollmentId = null`, mà `confirmPayment` lại cần
 * `enrollmentId` (nó truyền thẳng vào `issueReceipt`). Hệ quả đo được:
 *
 *   · Màn Khoản thu hiện "Chờ convert" cho một lead ĐÃ chuyển đổi xong, và không có nút
 *     nào thoát khỏi trạng thái đó.
 *   · Hai đơn thật: 13.920.000đ / 22.080.000đ (63%) không bao giờ vào sổ kế toán được,
 *     không bao giờ có phiếu thu — trong khi trang đơn vẫn in "Đã đóng đủ · Còn thiếu 0đ".
 *
 * Bản vá 06/09/2026 trước đó có cố gắng gắn ngay trong `ensureOrderPaymentRecorded`, nhưng
 * điều kiện là `Order.studentId` phải có giá trị. Đơn lập từ `/orders/new?leadId=…` để cột
 * đó NULL (suy từ dòng hàng, mà dòng hàng chưa có học viên lúc tạo đơn), nên nhánh ấy chưa
 * từng chạy trong luồng lead.
 *
 * ⚠️ KHÔNG DÙNG ĐƯỜNG LUI Ở ĐÂY. `chiaKhoanTheoDon` có nhánh "không khớp được thì chia cho
 * mọi ghi danh theo finalPrice" — đúng cho lúc convert (khi ta biết chắc mọi ghi danh vừa
 * tạo là của lead này), nhưng SAI ở đây: gắn bừa một khoản vào ghi danh không liên quan còn
 * tệ hơn để nó chưa gắn. Không khớp ⇒ bỏ qua, giữ nguyên hiện trạng.
 */
export async function ganGhiDanhChoKhoanCuaDon(
  tx: Tx,
  params: { orderId: string; actor: AuditActor },
): Promise<{ linked: number; splitCreated: number; boQua: number }> {
  const duLieu = await napGanGhiDanhCuaDon(tx, params.orderId);
  if (!duLieu || duLieu.khoan.length === 0) return { linked: 0, splitCreated: 0, boQua: 0 };

  // Đường TỰ ĐỘNG (ghi nhận tiền) không có người bấm ⇒ không có phạm vi nào để thu hẹp: giữ hành vi
  // cũ, mọi cơ sở. Đường THỦ CÔNG từ màn hoá đơn truyền phạm vi kế toán thật (gan-ghi-danh.ts).
  const keHoach = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: () => true });
  // Cùng chốt chặn cứng với hàm convert: nhánh tách SỬA `amount` của dòng gốc, chỉ đúng khi dòng còn
  // là bản nháp chưa qua kế toán.
  if (keHoach.chan) {
    throw new Error(
      "ganGhiDanhChoKhoanCuaDon: gặp khoản ĐÃ XÁC NHẬN chưa gắn ghi danh — " +
        "không được sửa tiền đã đối soát, dùng adjustPayment.",
    );
  }
  const kq = await thucHienKeHoachGan(tx, duLieu, keHoach, params.actor, "gan-sau-convert");
  return {
    linked: kq.linked,
    splitCreated: kq.splitCreated,
    boQua: keHoach.dong.filter((d) => d.ketQua === "BO_QUA").length + kq.doi.length,
  };
}

export type KhoanChuaGanDayDu = KhoanChuaGan & {
  orderId: string;
  method: string;
  paidDate: Date;
  note: string | null;
  evidenceUrl: string | null;
  recordedById: string | null;
  centerId: string | null;
};

export type DuLieuGanGhiDanh = {
  orderId: string;
  orderCenterId: string | null;
  khoan: KhoanChuaGanDayDu[];
  dongDon: DongDonCoHocVien[];
  ghiDanh: GhiDanhUngVien[];
  coHocVien: boolean;
  daKhoa: Map<string, KhoaHoaDonCuaKhoan>;
};

/**
 * Nạp đầu vào của `lapKeHoachGanGhiDanh` cho MỘT đơn — dùng chung cho đường tự động (trong transaction
 * ghi tiền) và đường thủ công từ màn hoá đơn (xem trước + gắn). CHỈ ĐỌC. `null` ⇒ không có đơn.
 *
 * Khoản: MỌI dòng còn sống của đơn (để tính số RÒNG — dòng gốc đã bị đảo ra ≤ 0), rồi lọc khoản ĐÃ
 * GHI NHẬN chưa gắn ghi danh. Ứng viên: học viên trên dòng đơn · học viên của đơn · học viên mang SĐT
 * phụ huynh (`Student` KHÔNG có `leadId`; tra bằng `expandPhoneVariants` vì DB có cả `0…` lẫn `84…`).
 * ⚠️ Tra SĐT KHÔNG theo phạm vi — hành vi có sẵn của đường tự động; đường thủ công lọc đích bằng
 * `trongTam` của planner.
 */
export async function napGanGhiDanhCuaDon(client: Tx, orderId: string): Promise<DuLieuGanGhiDanh | null> {
  const dong = await client.payment.findMany({
    where: { orderId, deletedAt: null },
    select: {
      id: true, amount: true, adjustmentOfId: true, deletedAt: true, paymentType: true,
      saleStatus: true, accountantStatus: true, enrollmentId: true, orderId: true, method: true,
      paidDate: true, note: true, evidenceUrl: true, recordedById: true, centerId: true,
    },
  });
  const rong = soTienRong(dong);
  const khoan: KhoanChuaGanDayDu[] = dong
    .filter((p) => laKhoanDaGhiNhan(p) && p.enrollmentId === null)
    .map((p) => ({
      id: p.id, amount: p.amount, paymentType: p.paymentType, accountantStatus: p.accountantStatus,
      rong: rong.get(p.id) ?? p.amount, orderId: p.orderId, method: p.method, paidDate: p.paidDate,
      note: p.note, evidenceUrl: p.evidenceUrl, recordedById: p.recordedById, centerId: p.centerId,
    }));

  const don = await client.order.findUnique({
    where: { id: orderId },
    select: {
      centerId: true,
      customerPhone: true,
      studentId: true,
      items: { select: { studentId: true, totalPrice: true, discountAmount: true, metadata: true } },
    },
  });
  if (!don) return null;
  const rong0: DuLieuGanGhiDanh = {
    orderId, orderCenterId: don.centerId, khoan, dongDon: [], ghiDanh: [], coHocVien: false, daKhoa: new Map(),
  };
  // Đường tự động chạy ở MỌI lượt ghi tiền — không có khoản nào cần gắn thì dừng trước mọi câu tra khác.
  if (khoan.length === 0) return rong0;

  const dongDon: DongDonCoHocVien[] = don.items.map((it) => {
    const m = it.metadata as Record<string, unknown> | null;
    return {
      studentId: it.studentId,
      courseId: typeof m?.courseId === "string" && m.courseId ? m.courseId : null,
      thanhTien: it.totalPrice - (it.discountAmount ?? 0),
    };
  });

  const idHocVien = new Set<string>();
  for (const d of dongDon) if (d.studentId) idHocVien.add(d.studentId);
  if (don.studentId) idHocVien.add(don.studentId);
  if (don.customerPhone) {
    const cuaPhuHuynh = await client.student.findMany({
      where: { parentPhone: { in: expandPhoneVariants([don.customerPhone]) }, deletedAt: null },
      select: { id: true },
    });
    for (const s of cuaPhuHuynh) idHocVien.add(s.id);
  }

  const dsGhiDanh =
    idHocVien.size === 0
      ? []
      : await client.enrollment.findMany({
          where: { studentId: { in: [...idHocVien] }, deletedAt: null },
          select: {
            id: true, studentId: true, finalPrice: true, centerId: true, courseId: true,
            class: { select: { courseId: true } },
          },
          orderBy: { createdAt: "asc" },
        });
  const khoa = await khoanDaKhoaHoaDon(client, khoan.map((k) => k.id));
  return {
    ...rong0,
    dongDon,
    coHocVien: idHocVien.size > 0,
    ghiDanh: dsGhiDanh.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      // Khoá của LỚP trước (nguồn cũ của `chiaKhoanTheoDon`), rơi về khoá của chính ghi danh.
      courseId: e.class?.courseId ?? e.courseId,
      finalPrice: e.finalPrice ?? 0,
      centerId: e.centerId,
    })),
    daKhoa: new Map(
      khoa.map((k) => [k.paymentId, { trangThai: k.trangThai, so: [k.kyHieu, k.soHoaDon].filter(Boolean).join("-") || "(chưa ghi số)" }]),
    ),
  };
}

/**
 * Thực hiện các dòng GAN / TACH của kế hoạch. Phép ghi ĐẦU TIÊN của mỗi khoản là `updateMany` CÓ ĐIỀU
 * KIỆN (`enrollmentId` còn trống + đúng số tiền đã lập kế hoạch + chưa xoá): hai lượt cùng gắn một
 * khoản thì lượt sau đổi 0 dòng và BỎ khoản đó (vào `doi`) TRƯỚC khi tạo bất kỳ dòng tách nào — trước
 * đây `update` vô điều kiện cho lượt sau tách chồng lên lượt trước (mẫu FIX-H9).
 * `nguon` BẮT BUỘC (luật 7): nhật ký phải nói lượt gắn đến từ đâu.
 */
export async function thucHienKeHoachGan(
  tx: Tx,
  duLieu: Pick<DuLieuGanGhiDanh, "khoan">,
  keHoach: KeHoachGan,
  actor: AuditActor,
  nguon: string,
): Promise<{ linked: number; splitCreated: number; doi: string[] }> {
  const theoId = new Map(duLieu.khoan.map((k) => [k.id, k]));
  let linked = 0;
  let splitCreated = 0;
  const doi: string[] = [];
  for (const d of keHoach.dong) {
    if (d.ketQua === "BO_QUA") continue;
    const p = theoId.get(d.paymentId);
    if (!p) {
      doi.push(d.paymentId);
      continue;
    }
    const soPhan = d.phan.length;
    const ghiChu = (k: number) =>
      soPhan === 1 ? (p.note ?? null) : `${(p.note ?? "").trim()} [tách ${k + 1}/${soPhan}]`.trim();

    const dau = d.phan[0]!;
    const upd = await tx.payment.updateMany({
      where: { id: p.id, enrollmentId: null, amount: d.soTien, deletedAt: null },
      data: { enrollmentId: dau.enrollmentId, amount: dau.amount, note: ghiChu(0) },
    });
    if (upd.count === 0) {
      doi.push(p.id);
      continue;
    }
    linked++;
    await writeAudit({
      actor, module: "finance", entityType: "Payment", entityId: p.id, action: "UPDATE",
      changedFields: ["amount", "enrollmentId"],
      oldValues: { amount: d.soTien, enrollmentId: null },
      newValues: { amount: dau.amount, enrollmentId: dau.enrollmentId, source: nguon },
      orgUnitId: p.centerId, tx,
    });
    for (let k = 1; k < soPhan; k++) {
      const { enrollmentId, amount } = d.phan[k]!;
      const moi = await tx.payment.create({
        data: {
          orderId: p.orderId, enrollmentId, amount,
          method: p.method, paidDate: p.paidDate, evidenceUrl: p.evidenceUrl ?? null, note: ghiChu(k),
          saleStatus: "RECORDED", accountantStatus: "PENDING",
          recordedById: p.recordedById, centerId: p.centerId,
        },
        select: { id: true },
      });
      splitCreated++;
      await writeAudit({
        actor, module: "finance", entityType: "Payment", entityId: moi.id, action: "CREATE",
        newValues: { amount, enrollmentId, source: nguon, splitFrom: p.id },
        orgUnitId: p.centerId, tx,
      });
    }
  }
  return { linked, splitCreated, doi };
}

// ─── AC1 — Sale ghi nhận khoản ────────────────────────────────────────────────
/**
 * Sale ghi nhận 1 khoản đã thu → saleStatus=RECORDED, accountantStatus=PENDING.
 * PH KHÔNG thấy (portal chỉ đọc CONFIRMED). Ghi audit CREATE.
 */
export async function recordPayment(input: {
  orderId: string;
  enrollmentId?: string | null;
  amount: number;
  method: string;
  paidDate: Date;
  evidenceUrl?: string | null;
  note?: string | null;
  recordedById: string;
  centerId: string | null;
  // S3 — leadId của order (nếu có) → auto-advance lead AWAITING_DECISION→REGISTERED trong cùng tx.
  leadId?: string | null;
}): Promise<Ok<{ paymentId: string }> | Fail> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return fail("Số tiền phải lớn hơn 0");
  }
  const actor = await auditActor(input.recordedById);

  const payment = await db.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        orderId: input.orderId,
        enrollmentId: input.enrollmentId ?? null,
        amount: input.amount,
        method: input.method,
        paidDate: input.paidDate,
        evidenceUrl: input.evidenceUrl ?? null,
        note: input.note ?? null,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
        recordedById: input.recordedById,
        centerId: input.centerId,
      },
    });
    await writeAudit({
      actor,
      module: "finance",
      entityType: "Payment",
      entityId: p.id,
      action: "CREATE",
      newValues: {
        amount: input.amount,
        method: input.method,
        saleStatus: "RECORDED",
        accountantStatus: "PENDING",
      },
      orgUnitId: input.centerId,
      tx,
    });
    // S3 — ghi nhận tiền → lead tự lên 'Đã đăng ký' (idempotent guard trong helper).
    if (input.leadId) {
      await maybeAdvanceLeadToRegistered(tx, {
        leadId: input.leadId,
        actor: { id: input.recordedById, name: actor.name, centerId: input.centerId },
      });
    }
    return p;
  });

  return { ok: true, paymentId: payment.id };
}

// ─── AC2/AC8 — Kế toán xác nhận (idempotent) ──────────────────────────────────
/**
 * Kế toán xác nhận khoản → accountantStatus=CONFIRMED + confirmedAt; sinh 1 Receipt;
 * publish "payment.confirmed". IDEMPOTENT: đã CONFIRMED → no-op success (1 Receipt duy nhất
 * kể cả double-click). Khoản chưa gắn enrollment → không sinh phiếu được, báo lỗi.
 *
 * FIX-H8 — idempotency cấp REQUEST: nếu truyền `idempotencyKey` (uuid client tạo mỗi
 * lần bấm), trước khi xử lý sẽ thử đọc/ghi `IdempotencyKey` trong tx (mẫu convert-lead-v2).
 * Cùng key gửi lại → trả kết quả cũ, KHÔNG xử lý lại. Đây là lớp bổ sung — state-guard
 * `updateMany where accountantStatus=PENDING` (AC8) vẫn giữ và đã functionally idempotent.
 */
export async function confirmPayment(params: {
  paymentId: string;
  confirmedById: string;
  idempotencyKey?: string;
}): Promise<Ok<{ alreadyConfirmed: boolean; receiptId?: string }> | Fail> {
  // FIX-H8 — đã xử lý key này (request lặp) → trả kết quả cũ, không chạm lại nghiệp vụ.
  if (params.idempotencyKey) {
    const seen = await db.idempotencyKey.findUnique({ where: { key: params.idempotencyKey } });
    if (seen?.result) {
      const r = seen.result as { receiptId?: string | null };
      return { ok: true, alreadyConfirmed: true, receiptId: r.receiptId ?? undefined };
    }
  }

  const existing = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { receipts: { where: { deletedAt: null } }, order: { select: { type: true } } },
  });
  if (!existing) return fail("Không tìm thấy khoản thanh toán");

  // Idempotent: đã xác nhận → trả receipt hiện có, không tạo thêm.
  if (existing.accountantStatus === "CONFIRMED") {
    return { ok: true, alreadyConfirmed: true, receiptId: existing.receipts[0]?.id };
  }
  if (existing.accountantStatus !== "PENDING") {
    return fail("Khoản này không ở trạng thái chờ duyệt");
  }
  // Đơn KIT / THI (PRODUCT · EXAM) không có ghi danh ⇒ không chặn (chốt 29/09/2026, `can-ghi-danh.ts`).
  if (thieuGhiDanh(existing, existing.order?.type ?? null)) {
    return fail("Khoản chưa gắn ghi danh, không thể sinh phiếu thu");
  }

  const actor = await auditActor(params.confirmedById);

  let result: { receiptId: string | undefined; raced: boolean };
  try {
    result = await db.$transaction(async (tx) => {
      const r = await xacNhanKhoanTrongTx(tx, {
        paymentId: existing.id,
        confirmedById: params.confirmedById,
        actor,
        now: new Date(),
      });
      // FIX-H8 — ghi key trong CÙNG tx → double-submit sau trả kết quả này (không sinh Receipt
      // thứ 2). Ghi cả khi lượt này THUA đua (raced) để request lặp sau trả đúng kết quả.
      if (params.idempotencyKey) {
        await tx.idempotencyKey.create({
          data: { key: params.idempotencyKey, scope: "payment.confirm", result: { receiptId: r.receiptId ?? null } },
        });
      }
      return r;
    });
  } catch (e) {
    if (e instanceof LoiXacNhanKhoan) return fail(e.message);
    throw e;
  }

  return { ok: true, alreadyConfirmed: result.raced, receiptId: result.receiptId };
}

// ─── LÕI XÁC NHẬN MỘT KHOẢN — trong transaction của người gọi ─────────────────
//
// docs/ke-toan-hoa-don/PLAN.md §4 "Tách lõi xác nhận". `confirmPayment` (màn /payments) và bước
// chốt hoá đơn (màn Hoá đơn điện tử) cùng gọi hàm này ⇒ MỘT chỗ cấp phiếu RCP + MỘT chỗ phát
// `payment.confirmed`. Viết ở ĐÂY (không tệp khác) vì tệp này đã nằm trong ngoại lệ của lưới
// `truc-a`: chép lõi sang tệp khác là lưới đỏ, và đúng ra là thêm một nhà thứ hai cho trục A.
//
// Lõi mang theo các cổng trước đây chỉ nằm ở tầng action / không nằm đâu cả:
//   · AC5 — người ghi nhận không tự xác nhận khoản của mình (trước chỉ ở `confirmPaymentAction`);
//   · tiền RÒNG > 0 — dòng gốc đã bị đảo trọn (gỡ gắn / tách) KHÔNG được cấp phiếu thu. Trước
//     bản này /payments xác nhận được cả dòng gốc đã đảo và cấp RCP cho tiền đã gỡ;
//   · sau `updateMany` hụt thì ĐỌC LẠI: người khác vừa xác nhận ⇒ trả phiếu có sẵn (idempotent);
//     trạng thái khác (vd vừa bị TỪ CHỐI) ⇒ NÉM — không "coi như xong".
// Từ chối = NÉM `LoiXacNhanKhoan` (luật rollback: `return` không rollback). Người gọi dịch câu.

export type MaLoiXacNhanKhoan =
  | "KHONG_TIM_THAY"
  | "KHONG_CHO_DUYET"
  | "CHUA_GHI_DANH"
  | "TU_XAC_NHAN"
  | "TIEN_RONG_KHONG_DUONG"
  | "DOI_TRANG_THAI";

const CAU_LOI_XAC_NHAN: Record<MaLoiXacNhanKhoan, string> = {
  KHONG_TIM_THAY: "Không tìm thấy khoản thanh toán",
  KHONG_CHO_DUYET: "Khoản này không ở trạng thái chờ duyệt",
  CHUA_GHI_DANH: "Khoản chưa gắn ghi danh, không thể sinh phiếu thu",
  TU_XAC_NHAN: "Người ghi nhận không được tự xác nhận khoản của mình",
  TIEN_RONG_KHONG_DUONG: "Khoản này đã bị gỡ / tách hết tiền — không còn gì để xác nhận",
  DOI_TRANG_THAI: "Khoản vừa bị người khác đổi trạng thái — tải lại rồi thử lại",
};

export class LoiXacNhanKhoan extends Error {
  constructor(readonly ma: MaLoiXacNhanKhoan) {
    super(CAU_LOI_XAC_NHAN[ma]);
    this.name = "LoiXacNhanKhoan";
  }
}

export async function xacNhanKhoanTrongTx(
  tx: Tx,
  params: { paymentId: string; confirmedById: string; actor: AuditActor; now: Date },
): Promise<{ receiptId: string | undefined; receiptCode: string | undefined; raced: boolean }> {
  const p = await tx.payment.findUnique({
    where: { id: params.paymentId },
    select: {
      id: true,
      amount: true,
      orderId: true,
      centerId: true,
      enrollmentId: true,
      recordedById: true,
      accountantStatus: true,
      deletedAt: true,
      // Loại đơn quyết khoản có BẮT BUỘC ghi danh không — kit/thi thì không (`can-ghi-danh.ts`).
      order: { select: { type: true } },
    },
  });
  if (!p || p.deletedAt) throw new LoiXacNhanKhoan("KHONG_TIM_THAY");

  const phieuCo = async () =>
    tx.receipt.findFirst({ where: { paymentId: p.id }, select: { id: true, code: true } });
  // Idempotent: đã xác nhận → trả phiếu có sẵn, không sinh thêm.
  if (p.accountantStatus === "CONFIRMED") {
    const r = await phieuCo();
    return { receiptId: r?.id, receiptCode: r?.code, raced: true };
  }
  if (p.accountantStatus !== "PENDING") throw new LoiXacNhanKhoan("KHONG_CHO_DUYET");
  // Đơn COURSE (và loại lạ — fail-closed) vẫn phải có ghi danh; đơn KIT / THI cấp phiếu với
  // `enrollmentId = null` (cột `Receipt.enrollmentId` nới NULL ở migration 20260929120000).
  if (thieuGhiDanh(p, p.order?.type ?? null)) throw new LoiXacNhanKhoan("CHUA_GHI_DANH");
  // AC5 — tách nhiệm vụ.
  if (p.recordedById && p.recordedById === params.confirmedById) throw new LoiXacNhanKhoan("TU_XAC_NHAN");
  // Tiền RÒNG = dòng gốc + mọi bút toán còn sống trỏ `adjustmentOfId` về nó (đảo gỡ gắn, tách…).
  const dao = await tx.payment.aggregate({
    where: { adjustmentOfId: p.id, deletedAt: null },
    _sum: { amount: true },
  });
  if (p.amount + (dao._sum.amount ?? 0) <= 0) throw new LoiXacNhanKhoan("TIEN_RONG_KHONG_DUONG");

  // AC8 — chỉ chuyển CONFIRMED khi đang PENDING (atomic).
  const upd = await tx.payment.updateMany({
    where: { id: p.id, accountantStatus: "PENDING" },
    data: { accountantStatus: "CONFIRMED", confirmedById: params.confirmedById, confirmedAt: params.now },
  });
  if (upd.count === 0) {
    const lai = await tx.payment.findUnique({ where: { id: p.id }, select: { accountantStatus: true } });
    if (lai?.accountantStatus !== "CONFIRMED") throw new LoiXacNhanKhoan("DOI_TRANG_THAI");
    // Một request khác đã xác nhận đồng thời → trả phiếu hiện có, KHÔNG sinh thêm.
    const r = await phieuCo();
    return { receiptId: r?.id, receiptCode: r?.code, raced: true };
  }

  // Mã cơ sở cho mã phiếu thu. `Payment.centerId` là `Center.id` cũ; ánh xạ sang OrgUnit qua cột
  // `OrgUnit.centerId` (@unique) — tra `where: { centerId }`, KHÔNG `where: { id }` (cuid không khớp).
  const ou = p.centerId
    ? await tx.orgUnit.findUnique({ where: { centerId: p.centerId }, select: { code: true } })
    : null;
  const receipt = await issueReceipt({
    enrollmentId: p.enrollmentId,
    paymentId: p.id,
    issuedById: params.confirmedById,
    centerCode: ou?.code ?? "SR",
    tx,
    now: params.now,
  });
  await writeAudit({
    actor: params.actor,
    module: "finance",
    entityType: "Payment",
    entityId: p.id,
    action: "STATUS_CHANGE",
    oldValues: { accountantStatus: p.accountantStatus },
    newValues: { accountantStatus: "CONFIRMED", receiptCode: receipt.code },
    orgUnitId: p.centerId,
    tx,
  });
  await publishEvent(
    "payment.confirmed",
    {
      paymentId: p.id,
      enrollmentId: p.enrollmentId,
      orderId: p.orderId,
      amount: p.amount,
      receiptId: receipt.id,
      receiptCode: receipt.code,
    },
    { tx, dedupeKey: `payment.confirmed:${p.id}` },
  );
  return { receiptId: receipt.id, receiptCode: receipt.code, raced: false };
}

// ─── AC3 — Kế toán từ chối (reason bắt buộc) ──────────────────────────────────
/**
 * Kế toán từ chối khoản → accountantStatus=REJECTED + rejectReason. Nếu khoản đã sinh
 * Receipt ACTIVE → thu hồi (status=VOID) + audit. reason BẮT BUỘC.
 */
export async function rejectPayment(params: {
  paymentId: string;
  confirmedById: string;
  reason: string;
  /** FIX-H9 — optimistic lock: Payment.updatedAt client đã thấy. Lệch → STALE_WRITE. */
  expectedUpdatedAt?: Date | string;
}): Promise<Ok<{ voidedReceiptIds: string[] }> | Fail> {
  if (!params.reason?.trim()) return fail("Lý do từ chối là bắt buộc");

  const existing = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { receipts: { where: { deletedAt: null } } },
  });
  if (!existing) return fail("Không tìm thấy khoản thanh toán");
  if (existing.accountantStatus === "REJECTED") {
    return { ok: true, voidedReceiptIds: [] };
  }

  const actor = await auditActor(params.confirmedById);
  const expectedAt = params.expectedUpdatedAt ? new Date(params.expectedUpdatedAt) : null;

  const result = await db.$transaction(async (tx) => {
    // CỔNG HOÁ ĐƠN (docs/ke-toan-hoa-don/PLAN.md §5) — đứng TRƯỚC phép ghi đầu tiên, LUÔN chạy
    // (không hỏi cờ). Từ chối một khoản đã nằm trong hoá đơn là để tờ hoá đơn nói một số tiền
    // mà sổ đã gỡ. Trả về khi CHƯA ghi gì ⇒ không cần rollback.
    const khoa = await khoanDaKhoaHoaDon(tx, [existing.id]);
    if (khoa.length > 0) {
      return { stale: false as const, voided: [] as string[], khoaHoaDon: thongDiepKhoaHoaDon(khoa) };
    }

    // FIX-H9 — ghi có điều kiện updatedAt; 0 row ⇒ người khác vừa sửa → STALE_WRITE.
    const upd = await tx.payment.updateMany({
      where: { id: existing.id, ...(expectedAt ? { updatedAt: expectedAt } : {}) },
      data: {
        accountantStatus: "REJECTED",
        confirmedById: params.confirmedById,
        confirmedAt: new Date(),
        rejectReason: params.reason.trim(),
      },
    });
    if (upd.count === 0) return { stale: true as const };

    const activeReceipts = existing.receipts.filter((r) => r.status === "ACTIVE");
    const voided: string[] = [];
    for (const r of activeReceipts) {
      await tx.receipt.update({ where: { id: r.id }, data: { status: "VOID" } });
      voided.push(r.id);
    }

    await writeAudit({
      actor,
      module: "finance",
      entityType: "Payment",
      entityId: existing.id,
      action: "STATUS_CHANGE",
      oldValues: { accountantStatus: existing.accountantStatus },
      newValues: { accountantStatus: "REJECTED", voidedReceipts: voided },
      reason: params.reason.trim(),
      orgUnitId: existing.centerId,
      tx,
    });
    // R7-17 (P0 gap) — phát event để PH/Sale được thông báo khoản bị từ chối.
    await publishEvent(
      "payment.rejected",
      {
        paymentId: existing.id,
        enrollmentId: existing.enrollmentId,
        orderId: existing.orderId,
        amount: existing.amount,
        reason: params.reason.trim(),
      },
      { tx, dedupeKey: `payment.rejected:${existing.id}` },
    );
    return { stale: false as const, voided, khoaHoaDon: null };
  });

  if (result.stale) return fail(STALE_WRITE);
  if (result.khoaHoaDon) return fail(result.khoaHoaDon);
  return { ok: true, voidedReceiptIds: result.voided };
}

// ─── Điều chỉnh — BÚT TOÁN CỘNG THÊM, lưu DELTA (viết lại 07/09/2026) ─────────
/**
 * Điều chỉnh MỘT phiếu thu đã xác nhận.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Mô hình: CỘNG THÊM, không sửa đè
 *
 * Dòng `CONFIRMED` là tiền thật đã đối soát với sao kê ngân hàng ⇒ **bất biến**. Sửa số
 * của nó là sửa một sự kiện đã xảy ra. Nên điều chỉnh sinh một dòng MỚI mang phần
 * CHÊNH LỆCH, trỏ `adjustmentOfId` về phiếu gốc:
 *
 *     delta = correctAmount − (amount gốc + Σ amount các ADJUSTMENT đang trỏ vào nó)
 *
 * Cộng dồn các lần điều chỉnh trước vào công thức là có chủ đích: lần hai phải tính trên
 * kết quả của lần một, nếu không lần hai sẽ huỷ lần một một cách âm thầm.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Vì sao khoá theo `paymentId` chứ không phải `enrollmentId`
 *
 * Kế toán đang nhìn MỘT dòng phiếu thu và nói "dòng này phải là 3.500.000". Đó là thao
 * tác cấp phiếu thu. Một ghi danh trả góp có nhiều phiếu CONFIRMED (đợt 1, đợt 2), nên
 * nhận `enrollmentId` thì hàm phải TỰ ĐOÁN sửa phiếu nào — đoán sai ở đây là sai âm
 * thầm. Giao diện bắt buộc truyền id của đúng dòng đang sửa.
 *
 * `sumConfirmed(enrollmentId)` tự đúng theo, vì ADJUSTMENT là bút toán cộng thêm nằm
 * cùng ghi danh.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Vài điểm dễ vấp
 *
 * · `amount` của dòng ADJUSTMENT **được phép ÂM** — đó là cả điểm của delta. Ràng buộc
 *   DB duy nhất là `payment_amount_nonzero: CHECK (amount <> 0)`; cột là `integer` CÓ
 *   DẤU nên số âm lưu bình thường. Ràng buộc đó còn cộng hưởng với luật "delta = 0 thì
 *   không tạo bản ghi": code quên thì DB chặn.
 * · KHÔNG dùng lại mẹo khoá lạc quan cũ (ghi đè `updatedAt` của dòng gốc để chốt lock):
 *   nó là một UPDATE lên dòng gốc, đúng thứ mô hình này cấm. Thay bằng `SELECT … FOR
 *   UPDATE` — khoá HÀNG mà không đổi một cột nào, vẫn ngăn hai người điều chỉnh song
 *   song cùng tính delta trên một nền cũ.
 * · `reason` lưu vào `note` của chính dòng điều chỉnh: bảng `Payment` không có cột
 *   `reason` riêng, mà cổng phụ huynh (Bước 5) phải in được lý do ngay cạnh con số.
 *   AuditLog vẫn giữ bản sao ở trường `reason` của nó.
 */
export async function adjustPayment(params: {
  paymentId: string;
  /** SỐ ĐÚNG CUỐI CÙNG của DÒNG NÀY — không phải tổng của ghi danh, không phải delta. */
  correctAmount: number;
  reason: string;
  actorId: string;
  /** Optimistic lock: `Payment.updatedAt` client đã thấy. Lệch → STALE_WRITE. */
  expectedUpdatedAt?: Date | string;
}): Promise<Ok<{ adjustmentId: string; delta: number }> | Fail> {
  const reason = params.reason?.trim() ?? "";
  if (!reason) return fail("Lý do điều chỉnh là bắt buộc");

  const correctAmount = params.correctAmount;
  if (!Number.isInteger(correctAmount)) return fail("Số tiền đúng không hợp lệ");
  if (correctAmount < 0) return fail("Số tiền đúng không được âm");

  const original = await db.payment.findUnique({
    where: { id: params.paymentId },
    include: { order: { select: { type: true, totalAmount: true } } },
  });
  if (!original) return fail("Không tìm thấy khoản thanh toán");
  if (original.deletedAt) return fail("Khoản này đã bị xoá — không điều chỉnh được");

  // Chỉ điều chỉnh tiền ĐÃ ĐỐI SOÁT. Khoản còn PENDING là bản nháp: sửa thẳng bằng
  // `updatePendingPayment`, ép nó qua đường delta chỉ đẻ rác sổ.
  if (original.accountantStatus !== "CONFIRMED") {
    return fail(
      "Chỉ điều chỉnh được khoản ĐÃ XÁC NHẬN. Khoản đang chờ duyệt thì sửa trực tiếp.",
    );
  }
  // Không điều chỉnh chồng lên một bút toán điều chỉnh — mọi delta luôn trỏ về phiếu thu
  // gốc, nếu không chuỗi `adjustmentOfId` thành cây nhiều tầng và không ai cộng nổi.
  if (original.paymentType === "ADJUSTMENT") {
    return fail(
      "Đây là bút toán điều chỉnh, không phải phiếu thu. Điều chỉnh trên phiếu thu gốc.",
    );
  }
  // Đơn COURSE (và loại lạ — fail-closed) PHẢI có ghi danh để kiểm trần học phí. Đơn KIT / THI
  // (29/09/2026) không có ghi danh nào ⇒ trần đo ở cấp ĐƠN (`Order.totalAmount`). CÙNG luật
  // `thieuGhiDanh` với lõi xác nhận — nếu không, khoản kit/thi xác nhận được mà không sửa được.
  if (thieuGhiDanh(original, original.order?.type ?? null)) {
    return fail("Khoản chưa gắn ghi danh — không kiểm được trần học phí");
  }
  const enrollmentId = original.enrollmentId;
  // `thieuGhiDanh` = false mà không có ghi danh ⇒ chắc chắn có đơn (loại đơn null là fail-closed).
  const donKhongGhiDanh =
    enrollmentId == null && original.orderId && original.order
      ? { id: original.orderId, tran: original.order.totalAmount }
      : null;
  if (enrollmentId == null && !donKhongGhiDanh) {
    return fail("Khoản chưa gắn ghi danh — không kiểm được trần học phí");
  }

  if (params.expectedUpdatedAt) {
    // So sánh KHÔNG ghi: dòng gốc phải bất biến, kể cả `updatedAt`.
    const expected = new Date(params.expectedUpdatedAt).getTime();
    if (original.updatedAt.getTime() !== expected) return fail(STALE_WRITE);
  }

  const actor = await auditActor(params.actorId);
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    // Khoá HÀNG gốc mà không sửa nó. Hai người cùng bấm điều chỉnh trên một phiếu sẽ nối
    // đuôi nhau, người sau tính delta trên kết quả của người trước.
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${original.id} FOR UPDATE`;

    // Giá trị HIỆN TẠI của phiếu = số gốc + mọi điều chỉnh đã có.
    const daDieuChinh = await tx.payment.aggregate({
      where: { adjustmentOfId: original.id, paymentType: "ADJUSTMENT", deletedAt: null },
      _sum: { amount: true },
    });
    const hienTai = original.amount + (daDieuChinh._sum.amount ?? 0);
    const delta = correctAmount - hienTai;
    if (delta === 0) {
      return {
        loi:
          `Số tiền đúng đã bằng số hiện tại (${hienTai.toLocaleString("vi-VN")} đ) — ` +
          "không có gì để điều chỉnh.",
      };
    }

    // ── Trần: Σ CONFIRMED của GHI DANH (hoặc của ĐƠN kit/thi) sau điều chỉnh ─────
    // Điều chỉnh là thao tác cấp phiếu thu, nhưng trần là cấp ghi danh: một ghi danh
    // không thể thu quá học phí của nó, cũng không thể âm tiền. Đơn KIT/THI không có ghi
    // danh ⇒ cùng hai vế đó đo trên ĐƠN: tổng đã đóng của đơn ≤ `Order.totalAmount`.
    let tran: number | null;
    let daThuSum: number;
    let tenPham: string;
    if (enrollmentId) {
      const ghiDanh = await tx.enrollment.findUnique({
        where: { id: enrollmentId },
        select: { finalPrice: true, tuition: true },
      });
      tran = ghiDanh?.finalPrice ?? ghiDanh?.tuition ?? null;
      const daThu = await tx.payment.aggregate({
        where: { enrollmentId, ...KHOAN_DA_DONG },
        _sum: { amount: true },
      });
      daThuSum = daThu._sum.amount ?? 0;
      tenPham = "học phí của ghi danh";
    } else {
      tran = donKhongGhiDanh!.tran;
      const daThu = await tx.payment.aggregate({
        where: { orderId: donKhongGhiDanh!.id, ...KHOAN_DA_DONG },
        _sum: { amount: true },
      });
      daThuSum = daThu._sum.amount ?? 0;
      tenPham = "tổng tiền của đơn";
    }
    const tongSau = daThuSum + delta;
    if (tongSau < 0) {
      return {
        loi: enrollmentId
          ? "Điều chỉnh làm tổng đã thu của ghi danh thành số âm."
          : "Điều chỉnh làm tổng đã thu của đơn thành số âm.",
      };
    }
    if (tran != null && tongSau > tran) {
      return {
        loi:
          `Điều chỉnh làm tổng đã thu (${tongSau.toLocaleString("vi-VN")} đ) vượt ${tenPham} ` +
          `(${tran.toLocaleString("vi-VN")} đ).`,
      };
    }

    const adj = await tx.payment.create({
      data: {
        orderId: original.orderId,
        enrollmentId,
        // DELTA — âm khi điều chỉnh giảm.
        amount: delta,
        method: original.method,
        paidDate: original.paidDate,
        // Lý do đi cùng bút toán để cổng phụ huynh in được ngay cạnh con số.
        note: reason,
        saleStatus: original.saleStatus,
        paymentType: "ADJUSTMENT",
        // Bút toán điều chỉnh do kế toán tạo ra, không qua vòng chờ duyệt thứ hai.
        accountantStatus: "CONFIRMED",
        recordedById: params.actorId,
        confirmedById: params.actorId,
        confirmedAt: now,
        adjustmentOfId: original.id,
        centerId: original.centerId,
      },
      select: { id: true },
    });

    await writeAudit({
      actor,
      module: "finance",
      entityType: "Payment",
      entityId: adj.id,
      action: "CREATE",
      newValues: {
        paymentType: "ADJUSTMENT",
        accountantStatus: "CONFIRMED",
        adjustmentOfId: original.id,
        soCu: hienTai,
        soDung: correctAmount,
        delta,
      },
      reason,
      orgUnitId: original.centerId,
      tx,
    });

    return { adjustmentId: adj.id, delta };
  });

  if ("loi" in result) return fail(result.loi as string);
  return {
    ok: true,
    adjustmentId: result.adjustmentId as string,
    delta: result.delta as number,
  };
}

// ─── Sửa khoản CÒN CHỜ DUYỆT — sửa tại chỗ, KHÔNG sinh bút toán ──────────────
/**
 * Sửa một khoản thu đang `PENDING`.
 *
 * Khoản chưa qua kế toán là BẢN NHÁP, chưa phải bút toán: sửa nháp không phải "điều
 * chỉnh". Ép nó đi đường delta sẽ đẻ ra một cặp dòng (số sai + dòng bù) cho một con số
 * chưa từng vào sổ — rác sổ, và bắt mọi báo cáo phải giải thích thêm một khái niệm.
 *
 * Ngược lại, KHÔNG cho hàm này chạm khoản đã `CONFIRMED`: đó là tiền đã đối soát với sao
 * kê, sửa tại chỗ là làm sai lệch một sự kiện đã xảy ra. Đường đúng là `adjustPayment`.
 */
export async function updatePendingPayment(params: {
  paymentId: string;
  actorId: string;
  amount?: number;
  method?: string;
  paidDate?: Date | string;
  note?: string | null;
  reason?: string;
  /** Optimistic lock: `Payment.updatedAt` client đã thấy. Lệch → STALE_WRITE. */
  expectedUpdatedAt?: Date | string;
}): Promise<Ok<{ paymentId: string }> | Fail> {
  const original = await db.payment.findUnique({ where: { id: params.paymentId } });
  if (!original) return fail("Không tìm thấy khoản thanh toán");
  if (original.deletedAt) return fail("Khoản này đã bị xoá");
  if (original.accountantStatus !== "PENDING") {
    return fail(
      "Chỉ sửa trực tiếp được khoản ĐANG CHỜ DUYỆT. Khoản đã xác nhận thì dùng Điều chỉnh.",
    );
  }
  if (params.amount !== undefined) {
    if (!Number.isInteger(params.amount)) return fail("Số tiền không hợp lệ");
    if (params.amount <= 0) return fail("Số tiền phải lớn hơn 0");
  }

  const actor = await auditActor(params.actorId);
  const expectedAt = params.expectedUpdatedAt ? new Date(params.expectedUpdatedAt) : null;

  const data: Prisma.PaymentUpdateManyMutationInput = {};
  if (params.amount !== undefined) data.amount = params.amount;
  if (params.method !== undefined) data.method = params.method;
  if (params.paidDate !== undefined) data.paidDate = new Date(params.paidDate);
  if (params.note !== undefined) data.note = params.note;
  if (Object.keys(data).length === 0) return fail("Không có gì để sửa.");

  // Sửa ghi chú không đổi gì trên tờ hoá đơn; sửa số tiền / phương thức / ngày thì có.
  const doiNoiDungHoaDon = data.amount !== undefined || data.method !== undefined || data.paidDate !== undefined;

  const result = await db.$transaction(async (tx) => {
    // CỔNG HOÁ ĐƠN (PLAN §5) — TRƯỚC phép ghi đầu tiên, luôn chạy. Trả về khi chưa ghi gì.
    if (doiNoiDungHoaDon) {
      const khoa = await khoanDaKhoaHoaDon(tx, [original.id]);
      if (khoa.length > 0) return { stale: false, khoaHoaDon: thongDiepKhoaHoaDon(khoa) };
    }
    // Khoản PENDING thì sửa đè là hợp lệ, nên vẫn dùng khoá lạc quan cũ: ghi có điều
    // kiện `updatedAt` + `accountantStatus`, 0 dòng ⇒ người khác vừa động vào (sửa hoặc
    // xác nhận) kể từ lúc client đọc.
    const upd = await tx.payment.updateMany({
      where: {
        id: original.id,
        accountantStatus: "PENDING",
        ...(expectedAt ? { updatedAt: expectedAt } : {}),
      },
      data,
    });
    if (upd.count === 0) return { stale: true };

    await writeAudit({
      actor,
      module: "finance",
      entityType: "Payment",
      entityId: original.id,
      action: "UPDATE",
      oldValues: {
        amount: original.amount,
        method: original.method,
        paidDate: original.paidDate,
        note: original.note,
      },
      newValues: data as Record<string, unknown>,
      reason: params.reason?.trim() || "Sửa khoản chờ duyệt",
      orgUnitId: original.centerId,
      tx,
    });
    return { stale: false };
  });

  if (result.stale) return fail(STALE_WRITE);
  if ("khoaHoaDon" in result && result.khoaHoaDon) return fail(result.khoaHoaDon);
  return { ok: true, paymentId: original.id };
}

// ─── AC3 — Hoàn tiền (bút toán âm, không xóa gốc) ─────────────────────────────
/**
 * Hoàn tiền: tạo bản ghi MỚI amount ÂM, accountantStatus=REFUNDED, trỏ adjustmentOfId=gốc.
 * KHÔNG xóa gốc. reason BẮT BUỘC. (Công thức hoàn đầy đủ — out of scope R7-04.)
 */
export async function refundPayment(params: {
  paymentId: string;
  confirmedById: string;
  reason: string;
  amount?: number;
  /** FIX-H9 — optimistic lock trên bản gốc: Payment.updatedAt client đã thấy. */
  expectedUpdatedAt?: Date | string;
}): Promise<Ok<{ refundId: string }> | Fail> {
  if (!params.reason?.trim()) return fail("Lý do hoàn tiền là bắt buộc");

  const original = await db.payment.findUnique({ where: { id: params.paymentId } });
  if (!original) return fail("Không tìm thấy khoản thanh toán");

  // Số tiền hoàn (dương) — mặc định hoàn toàn bộ; bút toán ghi ÂM.
  const refundAbs = Math.abs(params.amount ?? original.amount);
  const negative = -refundAbs;

  const actor = await auditActor(params.confirmedById);
  const now = new Date();
  const expectedAt = params.expectedUpdatedAt ? new Date(params.expectedUpdatedAt) : null;

  const result = await db.$transaction(async (tx) => {
    // FIX-H9 — "touch" bản gốc có điều kiện updatedAt để chốt lock (chống hoàn 2 lần
    // trên cùng snapshot cũ khi 2 người thao tác song song).
    if (expectedAt) {
      const lock = await tx.payment.updateMany({
        where: { id: original.id, updatedAt: expectedAt },
        data: { updatedAt: now },
      });
      if (lock.count === 0) return { stale: true as const };
    }
    const ref = await tx.payment.create({
      data: {
        orderId: original.orderId,
        enrollmentId: original.enrollmentId,
        amount: negative,
        method: original.method,
        paidDate: now,
        note: original.note,
        saleStatus: original.saleStatus,
        accountantStatus: "REFUNDED",
        recordedById: original.recordedById,
        confirmedById: params.confirmedById,
        confirmedAt: now,
        adjustmentOfId: original.id,
        centerId: original.centerId,
      },
    });
    await writeAudit({
      actor,
      module: "finance",
      entityType: "Payment",
      entityId: ref.id,
      action: "CREATE",
      newValues: {
        accountantStatus: "REFUNDED",
        adjustmentOfId: original.id,
        amount: negative,
      },
      reason: params.reason.trim(),
      orgUnitId: original.centerId,
      tx,
    });
    // T14 (học bù): hoàn tiền KHÔNG đổi trạng thái đơn (`order.voided` không bao giờ bắn) nên phí học bù thu thiếu sau hoàn một phần không ai xét lại.
    // Sự kiện ghi CÙNG giao dịch (hoàn rollback ⇒ không có sự kiện); chỉ mang id — người nhận tự đọc lại số đã thu.
    if (original.orderId) {
      await publishEvent("payment.refunded", { orderId: original.orderId, paymentId: ref.id }, { tx, dedupeKey: `payment.refunded:${ref.id}` });
    }
    return { stale: false as const, refundId: ref.id };
  });

  if (result.stale) return fail(STALE_WRITE);
  return { ok: true, refundId: result.refundId };
}
