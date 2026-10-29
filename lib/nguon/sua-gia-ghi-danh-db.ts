// lib/nguon/sua-gia-ghi-danh-db.ts — TẦNG DB của «chuẩn hoá GIÁ GHI DANH cho 6 đơn sống» (Wave 1, PHASE B.1). Lõi quyết định: `sua-gia-ghi-danh.ts` (thuần).
//
// ── QUY ƯỚC (giống `gan-danh-tinh-don-db.ts`) ───────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC; `bang` (PHẠM VI + giá niêm yết + snapshot legacy) cũng BẮT BUỘC, không mặc định (luật 7). Script truyền hằng
//     `BANG_SUA_GIA`, ca DB truyền bảng fixture. Số câu đọc CỐ ĐỊNH, không theo số đơn.
//
// ── PHÉP GHI DUY NHẤT: BỐN cột của MỘT bảng ────────────────────────────────────────────────────────────────
//   Enrollment.discountType · discountAmount · finalPrice · tuition — qua MỘT lời gọi `enrollment.updateMany` có điều kiện «đang đúng snapshot legacy đã audit».
//   KHÔNG Order, Payment, BankTransaction, Commission*, leadId, Receipt, `Payment.enrollmentId`. Bằng chứng KHÔNG đụng nằm TRONG transaction:
//   «ảnh chụp bất biến» (Order · dòng đơn · mọi Payment · phân bổ ngân hàng · các cột KHÔNG phải giá của Enrollment · số dòng hoa hồng) chụp TRƯỚC phép ghi đầu tiên và SAU
//   phép ghi cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi (phép cấy «ghi thêm một cột ngoài allowlist» bị bắt ở đây).
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[SGG-W*]` canh) ─────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) →
//   `enrollment.updateMany` (lệch ⇒ throw) + audit → đọc lại phải ra «cả lô đã ở giá đích» → ảnh chụp «sau» = «trước» → audit mức lượt.
//   Lô đã ở giá đích (chạy lại) ⇒ 0 dòng ghi, KHÔNG qua cổng và KHÔNG claim.
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  HANH_DONG_SUA_GIA,
  HANH_DONG_SUA_GIA_LUOT,
  LY_DO_SUA_GIA,
  dungBanGhiLuotSuaGia,
  khoaLuotChaySuaGia,
  lapKeHoachSuaGia,
  quyetDinhGhiSuaGia,
  type DuLieuSuaGia,
  type KeHoachSuaGia,
  type LuotChaySuaGia,
  type MucTieuSuaGia,
} from "./sua-gia-ghi-danh";

export type KhachSuaGia = PrismaClient | Prisma.TransactionClient;

export const ACTOR_SUA_GIA = { id: null, name: "Script chuẩn hoá giá ghi danh (sua-gia-ghi-danh)" } as const;

/** ĐỌC dữ liệu cho các mã trong `bang`. 9 câu, cố định. */
export async function docDuLieuSuaGia(c: KhachSuaGia, bang: Readonly<Record<string, MucTieuSuaGia>>): Promise<DuLieuSuaGia[]> {
  const ma = Object.keys(bang);
  const donList = await c.order.findMany({
    where: { code: { in: ma } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, deletedAt: true, studentId: true, leadId: true, leadChildId: true, centerId: true, subtotal: true, discountAmount: true,
      discountPercent: true, totalAmount: true, discountApprovalStatus: true,
      items: { select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true }, orderBy: { id: "asc" } },
    },
  });
  const orderIds = donList.map((d) => d.id);
  const enrIds = [...new Set(donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : []))))];
  const leadIds = [...new Set(donList.flatMap((d) => (d.leadId ? [d.leadId] : [])))];
  const studentIds = [...new Set(donList.flatMap((d) => (d.studentId ? [d.studentId] : [])))];

  const [ghiDanh, payments, phanBo, dongHoaHong, giaoDichHoaHong] = await Promise.all([
    c.enrollment.findMany({
      where: { id: { in: enrIds } },
      select: { id: true, studentId: true, courseId: true, status: true, leadChildId: true, centerId: true, deletedAt: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true },
    }),
    c.payment.findMany({ where: { orderId: { in: orderIds }, deletedAt: null }, select: { orderId: true, amount: true, enrollmentId: true } }),
    c.$queryRaw<{ orderId: string; tong: number }[]>`
      SELECT pr."orderId" AS "orderId", COALESCE(SUM(pa.amount), 0)::int AS tong
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) AND bt.status::text = 'MATCHED'
      GROUP BY pr."orderId"`,
    c.commissionLine.findMany({ where: { OR: [{ enrollmentId: { in: enrIds } }, { leadId: { in: leadIds } }] }, select: { id: true, enrollmentId: true, leadId: true } }),
    c.commissionTransaction.findMany({
      where: { OR: [{ orderId: { in: orderIds } }, { studentId: { in: studentIds } }, { leadId: { in: leadIds } }] },
      select: { id: true, orderId: true, studentId: true, leadId: true },
    }),
  ]);

  return donList.map((d): DuLieuSuaGia => {
    const itemEnr = d.items.find((i) => i.type === "COURSE_ENROLLMENT")?.enrollmentId ?? null;
    const ge = itemEnr === null ? null : (ghiDanh.find((g) => g.id === itemEnr) ?? null);
    const pay = payments.filter((p) => p.orderId === d.id);
    const hoaHong =
      dongHoaHong.filter((h) => (ge !== null && h.enrollmentId === ge.id) || (d.leadId !== null && h.leadId === d.leadId)).length +
      giaoDichHoaHong.filter((h) => h.orderId === d.id || (d.studentId !== null && h.studentId === d.studentId) || (d.leadId !== null && h.leadId === d.leadId)).length;
    return {
      don: {
        id: d.id, code: d.code, type: d.type, deletedAt: d.deletedAt, studentId: d.studentId, leadChildId: d.leadChildId, centerId: d.centerId, subtotal: d.subtotal,
        discountAmount: d.discountAmount, discountPercent: d.discountPercent, totalAmount: d.totalAmount, discountApprovalStatus: d.discountApprovalStatus,
        items: d.items.map((i) => ({ id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId, metadata: i.metadata })),
      },
      ghiDanh:
        ge === null
          ? null
          : {
              id: ge.id, studentId: ge.studentId, courseId: ge.courseId, status: ge.status, leadChildId: ge.leadChildId, centerId: ge.centerId, deletedAt: ge.deletedAt,
              gia: { listPrice: ge.listPrice, discountType: ge.discountType, discountAmount: ge.discountAmount, tuition: ge.tuition, finalPrice: ge.finalPrice },
            },
      soPaymentSong: pay.length,
      tongPaymentSong: pay.reduce((s, p) => s + p.amount, 0),
      tongPhanBoNganHang: phanBo.find((x) => x.orderId === d.id)?.tong ?? 0,
      soPaymentDaGanGhiDanh: pay.filter((p) => p.enrollmentId !== null).length,
      soHoaHongLienQuan: hoaHong,
    };
  });
}

export async function docKeHoachSuaGia(c: KhachSuaGia, bang: Readonly<Record<string, MucTieuSuaGia>>): Promise<KeHoachSuaGia> {
  return lapKeHoachSuaGia({ bang, du: await docDuLieuSuaGia(c, bang) });
}

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi. Order (tiền · giảm giá · lead · trạng thái) · dòng đơn · MỌI Payment (cả đã xoá) · phân bổ ngân hàng + trạng thái giao dịch ·
 * các cột KHÔNG phải giá của Enrollment (chỉ loại `discountType` · `discountAmount` · `finalPrice` · `tuition` · `updatedAt`; `listPrice` VẪN nằm trong ảnh chụp vì lõi không ghi nó) ·
 * số dòng hoa hồng. sha256 của JSON ổn định (sắp theo id). Chụp TRƯỚC và SAU phép ghi, trong CÙNG transaction.
 */
export async function anhChupBatBienSuaGia(c: KhachSuaGia, bang: Readonly<Record<string, MucTieuSuaGia>>): Promise<string> {
  const donList = await c.order.findMany({
    where: { code: { in: Object.keys(bang) } },
    orderBy: { id: "asc" },
    select: {
      id: true, code: true, type: true, status: true, subtotal: true, discountAmount: true, discountPercent: true, discountReason: true, discountApprovalStatus: true, voucherCode: true,
      totalAmount: true, shippingFee: true, studentId: true, leadId: true, leadChildId: true, centerId: true, paidAt: true, deletedAt: true,
      items: { orderBy: { id: "asc" }, select: { id: true, type: true, unitPrice: true, totalPrice: true, discountAmount: true, discountPercent: true, discounts: true, studentId: true, enrollmentId: true, status: true } },
    },
  });
  const orderIds = donList.map((d) => d.id);
  const enrIds = donList.flatMap((d) => d.items.flatMap((i) => (i.enrollmentId ? [i.enrollmentId] : [])));
  const leadIds = donList.flatMap((d) => (d.leadId ? [d.leadId] : []));
  const [payments, ghiDanh, phanBo, soHoaHong] = await Promise.all([
    c.payment.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { id: "asc" },
      select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, saleStatus: true, accountantStatus: true, paymentType: true, deletedAt: true },
    }),
    c.enrollment.findMany({
      where: { id: { in: enrIds } },
      orderBy: { id: "asc" },
      select: {
        id: true, studentId: true, classId: true, courseId: true, status: true, paidAt: true, startDate: true, endDate: true, createdAt: true, enrolledAt: true, confirmedAt: true, startedAt: true,
        endedAt: true, transferredToId: true, transferReason: true, notes: true, listPrice: true, deletedAt: true, leadChildId: true, centerId: true, saleId: true, renewedFromEnrollmentId: true,
        orgUnitId: true, buoiBatDau: true,
      },
    }),
    c.$queryRaw<{ id: string; orderId: string; amount: number; status: string }[]>`
      SELECT pa.id AS id, pr."orderId" AS "orderId", pa.amount AS amount, bt.status::text AS status
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) ORDER BY pa.id`,
    Promise.all([
      c.commissionLine.count({ where: { OR: [{ enrollmentId: { in: enrIds } }, { leadId: { in: leadIds } }] } }),
      c.commissionTransaction.count({ where: { OR: [{ orderId: { in: orderIds } }, { leadId: { in: leadIds } }] } }),
    ]),
  ]);
  return createHash("sha256").update(JSON.stringify({ donList, payments, ghiDanh, phanBo, soHoaHong }), "utf8").digest("hex");
}

export type DauVaoGhiSuaGia = {
  /** PHẠM VI CỨNG + giá niêm yết + snapshot legacy. BẮT BUỘC khai (luật 7). */
  bang: Readonly<Record<string, MucTieuSuaGia>>;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Enrollment"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChaySuaGia;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiSuaGia = { daGhi: number; daSuaHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiSuaGiaTrongTx`). MỘT transaction cho cả lô. */
export async function ghiSuaGia(c: PrismaClient, input: DauVaoGhiSuaGia): Promise<KetQuaGhiSuaGia> {
  const truoc = quyetDinhGhiSuaGia({ soDuyet: input.soDuyet, keHoach: await docKeHoachSuaGia(c, input.bang), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiSuaGiaTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiSuaGiaTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiSuaGia): Promise<KetQuaGhiSuaGia> {
  const ma = Object.keys(input.bang);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e.id IN (SELECT oi."enrollmentId" FROM "OrderItem" oi WHERE oi."orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) AND oi."enrollmentId" IS NOT NULL)
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachSuaGia(tx, input.bang);
  const loi = quyetDinhGhiSuaGia({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã ở giá đích (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daSuaHet: kh.daSuaHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienSuaGia(tx, input.bang);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng (digest + số dòng tính lại ở đây). Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.suaGiaGhiDanh, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang đúng snapshot legacy» trong `where`: lệch (ai đó vừa sửa giá) ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const { discountType, discountAmount, finalPrice, tuition } = g.sau;
    if (discountType === null || discountAmount === null || finalPrice === null || tuition === null) throw new Error(`Sửa giá ${g.code}: giá đích thiếu cột — lùi cả lô.`);
    const r = await tx.enrollment.updateMany({
      where: {
        id: g.enrollmentId,
        deletedAt: null,
        listPrice: g.truoc.listPrice,
        discountType: g.truoc.discountType,
        discountAmount: g.truoc.discountAmount,
        tuition: g.truoc.tuition,
        finalPrice: g.truoc.finalPrice,
      },
      data: { discountType, discountAmount, finalPrice, tuition },
    });
    if (r.count !== 1) throw new Error(`Sửa giá ${g.code}: giá ghi danh không còn đúng snapshot lúc lập kế hoạch giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "finance",
      entityType: "Enrollment",
      entityId: g.enrollmentId,
      action: HANH_DONG_SUA_GIA,
      oldValues: { listPrice: g.truoc.listPrice, discountType: g.truoc.discountType, discountAmount: g.truoc.discountAmount, tuition: g.truoc.tuition, finalPrice: g.truoc.finalPrice },
      newValues: { listPrice: g.sau.listPrice, discountType, discountAmount, tuition, finalPrice, orderCode: g.code, chinhSach: "Đóng full khóa học giảm 15%" },
      changedFields: ["discountType", "discountAmount", "finalPrice", "tuition"],
      reason: LY_DO_SUA_GIA,
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã ở giá đích», và không bất biến nào bị đổi.
  const sau = await docKeHoachSuaGia(tx, input.bang);
  if (sau.dung || !sau.daSuaHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã ở giá đích» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienSuaGia(tx, input.bang);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Order · Payment · phân bổ ngân hàng · cột không phải giá của ghi danh · hoa hồng) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiSuaGiaTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "SuaGiaGhiDanh",
    entityId: khoaLuotChaySuaGia(input.luotChay.nguonChay),
    action: HANH_DONG_SUA_GIA_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotSuaGia({ luot: input.luotChay, soDuyet: input.soDuyet, keHoach: kh, daGhi }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy chuẩn hoá giá ghi danh: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daSuaHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): cả lô ở giá đích + số Payment sống đã gắn ghi danh (PHẢI = 0 — PHASE B.2 chưa làm). */
export async function kiemSauGhiSuaGia(
  c: KhachSuaGia,
  bang: Readonly<Record<string, MucTieuSuaGia>>,
): Promise<{ keHoach: KeHoachSuaGia; paymentDaGanGhiDanh: number }> {
  const keHoach = await docKeHoachSuaGia(c, bang);
  const paymentDaGanGhiDanh = await c.payment.count({ where: { order: { code: { in: Object.keys(bang) } }, deletedAt: null, enrollmentId: { not: null } } });
  return { keHoach, paymentDaGanGhiDanh };
}
