// lib/nguon/gan-danh-tinh-don-db.ts — TẦNG DB của «gắn DANH TÍNH cho 6 đơn sống» (Wave 1, 24/10/2026). Lõi quyết định: `gan-danh-tinh-don.ts` (thuần).
//
// ── QUY ƯỚC (giống `noi-don-db.ts`) ──────────────────────────────────────────────────────────────────────────
//   · Mọi hàm nhận client làm tham số BẮT BUỘC (`PrismaClient` hoặc `Prisma.TransactionClient`), `maDon` (PHẠM VI) cũng BẮT BUỘC, không mặc định (luật 7):
//     script truyền hằng `MA_DON_GAN_DANH_TINH`, ca DB truyền mã fixture. Thiếu phạm vi thì `tsc` liệt kê chỗ gọi — không có «mọi đơn thiếu studentId» ngầm.
//   · Số câu đọc CỐ ĐỊNH (9), không theo số đơn.
//
// ── PHÉP GHI DUY NHẤT: ba cột, mỗi đơn ───────────────────────────────────────────────────────────────────────
//   Order.studentId · OrderItem.studentId · OrderItem.enrollmentId. Không `Payment`, không `Enrollment`, không `Commission*`, không `leadId`.
//   Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» (Payment · tổng đơn · giá/giảm giá ghi danh · leadId) chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối;
//   khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[GDT-W*]` canh) ──────────────────────────────────────────────────────────
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`, thứ tự id) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 (artifact owner ký) →
//   claim nonce (phép ghi ĐẦU TIÊN) → `order.updateMany` + `orderItem.updateMany` (điều kiện «đang NULL», lệch ⇒ throw) + audit → đọc lại phải ra «cả lô đã gắn ĐÚNG» → ảnh chụp «sau» = «trước» → audit mức lượt.
//   Lô đã gắn đúng từ trước (chạy lại) ⇒ 0 dòng ghi, KHÔNG qua cổng và KHÔNG claim (không có gì để duyệt).
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { expandPhoneVariants } from "@/lib/phone";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  HANH_DONG_GAN_DANH_TINH,
  HANH_DONG_GAN_DANH_TINH_LUOT,
  dungBanGhiLuotGanDanhTinh,
  khoaLuotChayGanDanhTinh,
  lapKeHoachGanDanhTinh,
  quyetDinhGhiGanDanhTinh,
  type DuLieuMotDon,
  type KeHoachGanDanhTinh,
  type LuotChayGanDanhTinh,
} from "./gan-danh-tinh-don";

export type KhachGanDanhTinh = PrismaClient | Prisma.TransactionClient;

export const ACTOR_GAN_DANH_TINH = { id: null, name: "Script gắn danh tính đơn (gan-danh-tinh-don)" } as const;

/** ĐỌC dữ liệu cho `maDon` (đúng các mã đó; kể cả đơn đã xoá mềm — lõi sẽ từ chối). 9 câu, cố định. */
export async function docDuLieuGanDanhTinh(c: KhachGanDanhTinh, maDon: readonly string[]): Promise<DuLieuMotDon[]> {
  const ma = [...maDon];
  const donList = await c.order.findMany({
    where: { code: { in: ma } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, deletedAt: true, studentId: true, leadId: true, leadChildId: true, centerId: true, totalAmount: true, customerPhone: true,
      items: { select: { id: true, type: true, studentId: true, enrollmentId: true, metadata: true }, orderBy: { id: "asc" } },
    },
  });
  const orderIds = donList.map((d) => d.id);
  const leadIds = [...new Set(donList.flatMap((d) => (d.leadId ? [d.leadId] : [])))];
  const beIds = [...new Set(donList.flatMap((d) => (d.leadChildId ? [d.leadChildId] : [])))];
  const phoneTheoDon = new Map(donList.map((d) => [d.id, new Set(expandPhoneVariants([d.customerPhone]))] as const));
  const moiPhone = [...new Set([...phoneTheoDon.values()].flatMap((s) => [...s]))];

  const [leads, bes, hocVienTho] = await Promise.all([
    c.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, centerId: true, deletedAt: true } }),
    c.leadChild.findMany({ where: { id: { in: beIds } }, select: { id: true, leadId: true, fullName: true } }),
    c.student.findMany({
      where: {
        deletedAt: null,
        OR: [
          { leadId: { in: leadIds } },
          { leadChildId: { in: beIds } },
          { parentPhone: { in: moiPhone } },
          { parent2Phone: { in: moiPhone } },
          { phone: { in: moiPhone } },
        ],
      },
      select: { id: true, name: true, leadId: true, leadChildId: true, centerId: true, parentPhone: true, parent2Phone: true, phone: true },
    }),
  ]);
  const hocVienIds = hocVienTho.map((h) => h.id);
  const ghiDanhTho = await c.enrollment.findMany({
    where: { studentId: { in: hocVienIds }, deletedAt: null },
    select: { id: true, studentId: true, courseId: true, status: true, leadChildId: true, centerId: true },
  });
  const ghiDanhIds = ghiDanhTho.map((g) => g.id);
  const [dongTro, payments, phanBo] = await Promise.all([
    c.orderItem.findMany({ where: { enrollmentId: { in: ghiDanhIds } }, select: { id: true, orderId: true, enrollmentId: true } }),
    c.payment.findMany({ where: { orderId: { in: orderIds }, deletedAt: null }, select: { orderId: true, amount: true } }),
    c.$queryRaw<{ orderId: string; tong: number }[]>`
      SELECT pr."orderId" AS "orderId", COALESCE(SUM(pa.amount), 0)::int AS tong
      FROM "PaymentAllocation" pa
      JOIN "PaymentRequest" pr ON pr.id = pa."paymentRequestId"
      JOIN "BankTransaction" bt ON bt.id = pa."bankTransactionId"
      WHERE pr."orderId" = ANY(${orderIds}::text[]) AND bt.status::text = 'MATCHED'
      GROUP BY pr."orderId"`,
  ]);

  return donList.map((d): DuLieuMotDon => {
    const phone = phoneTheoDon.get(d.id) ?? new Set<string>();
    const ung = hocVienTho.filter(
      (h) =>
        (d.leadId !== null && h.leadId === d.leadId) ||
        (d.leadChildId !== null && h.leadChildId === d.leadChildId) ||
        (h.parentPhone !== null && phone.has(h.parentPhone)) ||
        (h.parent2Phone !== null && phone.has(h.parent2Phone)) ||
        (h.phone !== null && phone.has(h.phone)),
    );
    const ungIds = new Set(ung.map((u) => u.id));
    const gd = ghiDanhTho.filter((g) => ungIds.has(g.studentId));
    const gdIds = new Set(gd.map((g) => g.id));
    const pay = payments.filter((p) => p.orderId === d.id);
    return {
      don: {
        id: d.id, code: d.code, type: d.type, deletedAt: d.deletedAt, studentId: d.studentId, leadId: d.leadId, leadChildId: d.leadChildId, centerId: d.centerId,
        totalAmount: d.totalAmount,
        items: d.items.map((i) => ({ id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId, metadata: i.metadata })),
      },
      lead: leads.find((l) => l.id === d.leadId) ?? null,
      be: bes.find((b) => b.id === d.leadChildId) ?? null,
      hocVienUngVien: ung.map((u) => ({ id: u.id, name: u.name, leadId: u.leadId, leadChildId: u.leadChildId, centerId: u.centerId })),
      ghiDanhUngVien: gd.map((g) => ({ id: g.id, studentId: g.studentId, courseId: g.courseId, status: g.status, leadChildId: g.leadChildId, centerId: g.centerId })),
      dongTroVaoGhiDanh: dongTro.filter((x) => x.enrollmentId !== null && gdIds.has(x.enrollmentId)).map((x) => ({ orderItemId: x.id, orderId: x.orderId, enrollmentId: x.enrollmentId! })),
      soPaymentSong: pay.length,
      tongPaymentSong: pay.reduce((s, p) => s + p.amount, 0),
      tongPhanBoNganHang: phanBo.find((x) => x.orderId === d.id)?.tong ?? 0,
    };
  });
}

export async function docKeHoachGanDanhTinh(c: KhachGanDanhTinh, maDon: readonly string[]): Promise<KeHoachGanDanhTinh> {
  return lapKeHoachGanDanhTinh({ maDon, du: await docDuLieuGanDanhTinh(c, maDon) });
}

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi — mọi `Payment` của đơn (cả đã xoá), tổng/giảm giá/`leadId` của đơn, giá + học bổng + khoá của ghi danh ứng viên.
 * Trả sha256 của JSON ổn định (sắp theo id). Chụp TRƯỚC và SAU phép ghi, trong CÙNG transaction.
 */
export async function anhChupBatBien(c: KhachGanDanhTinh, maDon: readonly string[]): Promise<string> {
  const donList = await c.order.findMany({
    where: { code: { in: [...maDon] } },
    orderBy: { id: "asc" },
    select: { id: true, code: true, status: true, subtotal: true, discountAmount: true, discountPercent: true, totalAmount: true, leadId: true, leadChildId: true, centerId: true, deletedAt: true },
  });
  const orderIds = donList.map((d) => d.id);
  const [payments, ghiDanh] = await Promise.all([
    c.payment.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { id: "asc" },
      select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, saleStatus: true, accountantStatus: true, deletedAt: true },
    }),
    c.enrollment.findMany({
      where: { student: { OR: [{ leadId: { in: donList.flatMap((d) => (d.leadId ? [d.leadId] : [])) } }, { leadChildId: { in: donList.flatMap((d) => (d.leadChildId ? [d.leadChildId] : [])) } }] } },
      orderBy: { id: "asc" },
      select: { id: true, studentId: true, courseId: true, status: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true, deletedAt: true },
    }),
  ]);
  return createHash("sha256").update(JSON.stringify({ donList, payments, ghiDanh }), "utf8").digest("hex");
}

export type DauVaoGhiGanDanhTinh = {
  /** PHẠM VI CỨNG. BẮT BUỘC khai (luật 7). */
  maDon: readonly string[];
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"Order"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayGanDanhTinh;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiGanDanhTinh = { daGhi: number; daGanHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiGanDanhTinhTrongTx`). MỘT transaction cho cả lô (đơn lệch ⇒ lùi cả lô). */
export async function ghiGanDanhTinh(c: PrismaClient, input: DauVaoGhiGanDanhTinh): Promise<KetQuaGhiGanDanhTinh> {
  const truoc = quyetDinhGhiGanDanhTinh({ soDuyet: input.soDuyet, keHoach: await docKeHoachGanDanhTinh(c, input.maDon), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiGanDanhTinhTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiGanDanhTinhTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiGanDanhTinh): Promise<KetQuaGhiGanDanhTinh> {
  const ma = [...input.maDon];
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`
    SELECT e.id FROM "Enrollment" e
    WHERE e."deletedAt" IS NULL
      AND (e."leadChildId" IN (SELECT "leadChildId" FROM "Order" WHERE code = ANY(${ma}::text[]) AND "leadChildId" IS NOT NULL)
        OR e."studentId" IN (SELECT id FROM "Student" WHERE "leadId" IN (SELECT "leadId" FROM "Order" WHERE code = ANY(${ma}::text[]) AND "leadId" IS NOT NULL)))
    ORDER BY e.id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachGanDanhTinh(tx, input.maDon);
  const loi = quyetDinhGhiGanDanhTinh({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Cả lô đã gắn ĐÚNG (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGanHet: kh.daGanHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBien(tx, input.maDon);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng (digest + số dòng tính lại ở đây). Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.ganDanhTinhDon, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang NULL» trong `where`: lệch (ai đó vừa gắn) ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const o = await tx.order.updateMany({ where: { id: g.orderId, studentId: null, deletedAt: null }, data: { studentId: g.studentId } });
    if (o.count !== 1) throw new Error(`Gắn danh tính ${g.code}: Order.studentId không còn NULL/đơn đã xoá giữa chừng — lùi cả lô.`);
    const i = await tx.orderItem.updateMany({
      where: { id: g.orderItemId, orderId: g.orderId, type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null },
      data: { studentId: g.studentId, enrollmentId: g.enrollmentId },
    });
    if (i.count !== 1) throw new Error(`Gắn danh tính ${g.code}: dòng đơn không còn «chưa gắn» giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "nguon-hoa-hong",
      entityType: "Order",
      entityId: g.orderId,
      action: HANH_DONG_GAN_DANH_TINH,
      oldValues: { studentId: null, orderItemId: g.orderItemId, orderItemStudentId: null, orderItemEnrollmentId: null },
      newValues: { studentId: g.studentId, orderItemId: g.orderItemId, orderItemStudentId: g.studentId, orderItemEnrollmentId: g.enrollmentId },
      changedFields: ["Order.studentId", "OrderItem.studentId", "OrderItem.enrollmentId"],
      reason: "Gắn danh tính cho đơn sống đã thu tiền (PHASE A — không đụng Payment/giá/hoa hồng)",
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: cả lô phải ra «đã gắn ĐÚNG», và không bất biến nào bị đổi.
  const sau = await docKeHoachGanDanhTinh(tx, input.maDon);
  if (sau.dung || !sau.daGanHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «cả lô đã gắn đúng» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBien(tx, input.maDon);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (Payment · tổng đơn · giá ghi danh · leadId) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiGanDanhTinhTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "nguon-hoa-hong",
    entityType: "GanDanhTinhDon",
    entityId: khoaLuotChayGanDanhTinh(input.luotChay.nguonChay),
    action: HANH_DONG_GAN_DANH_TINH_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotGanDanhTinh({ luot: input.luotChay, soDuyet: input.soDuyet, keHoach: kh, daGhi }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy gắn danh tính đơn: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGanHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): cả lô đã gắn đúng + đếm những thứ KHÔNG được đổi (Payment vẫn chưa gắn ghi danh). */
export async function kiemSauGhiGanDanhTinh(
  c: KhachGanDanhTinh,
  maDon: readonly string[],
): Promise<{ keHoach: KeHoachGanDanhTinh; paymentDaGanGhiDanh: number }> {
  const keHoach = await docKeHoachGanDanhTinh(c, maDon);
  const paymentDaGanGhiDanh = await c.payment.count({ where: { order: { code: { in: [...maDon] } }, deletedAt: null, enrollmentId: { not: null } } });
  return { keHoach, paymentDaGanGhiDanh };
}
