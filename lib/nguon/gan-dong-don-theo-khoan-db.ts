// lib/nguon/gan-dong-don-theo-khoan-db.ts — TẦNG DB của «gắn DÒNG ĐƠN ↔ GHI DANH theo khoản thu đã gắn» (01/11/2026). Lõi quyết định: `gan-dong-don-theo-khoan.ts` (thuần).
//
// ── QUY ƯỚC (giống `gan-danh-tinh-don-db.ts`) ─────────────────────────────────────────────────────────�
//   · Mọi hàm nhận client làm tham số BẮT BUỘC (`PrismaClient` hoặc `Prisma.TransactionClient`); `phamVi` BẮT BUỘC, không mặc định (luật 7): script truyền hằng
//     `PHAM_VI_GAN_DONG_THEO_KHOAN`, ca DB truyền phạm vi fixture. Thiếu phạm vi thì `tsc` liệt kê chỗ gọi — không có «mọi dòng đơn thiếu studentId» ngầm.
//   · Số câu đọc CỐ ĐỊNH, không theo số mục.
//
// ── PHÉP GHI DUY NHẤT: hai cột, mỗi dòng đơn ───────────────────────────────────────────────────────�
//   OrderItem.studentId · OrderItem.enrollmentId — chỉ khi cả hai đang NULL. Không `Order`, không `Payment`, không `Receipt`, không `Enrollment`, không `Commission*`, không `PaymentRequest`.
//   Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến» (đơn · khoản thu · ghi danh · biên lai) chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối; khác nhau một byte ⇒ `throw` ⇒ cả lô lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (lưới `[GDK-W*]` canh) ───────────────────────────────────────────────────�
//   khoá Order → OrderItem → Enrollment (`FOR UPDATE`, thứ tự id) → ĐỌC LẠI + lập lại kế hoạch → cổng số duyệt/lệch → ảnh chụp «trước» → cổng Wave 1 (artifact owner ký) + claim nonce
//   (phép ghi ĐẦU TIÊN) → `orderItem.updateMany` (điều kiện «đang NULL», lệch ⇒ throw) + audit → đọc lại phải ra «mọi dòng đã gắn ĐÚNG» → ảnh chụp «sau» phải trùng «trước» → bản ghi lượt chạy.
//   Lô đã gắn đúng từ trước (chạy lại) ⇒ 0 dòng ghi, KHÔNG qua cổng và KHÔNG claim (không có gì để duyệt).
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { writeAudit } from "@/lib/audit/audit-log";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import {
  HANH_DONG_GAN_DONG_THEO_KHOAN,
  HANH_DONG_GAN_DONG_THEO_KHOAN_LUOT,
  dungBanGhiLuotGanDong,
  khoaLuotChayGanDong,
  lapKeHoachGanDong,
  quyetDinhGhiGanDong,
  type DuLieuMotMuc,
  type KeHoachGanDong,
  type LuotChayGanDong,
  type MucPhamVi,
} from "./gan-dong-don-theo-khoan";

export type KhachGanDong = PrismaClient | Prisma.TransactionClient;

export const ACTOR_GAN_DONG = { id: null, name: "Script gắn dòng đơn theo khoản thu (gan-dong-don-theo-khoan)" } as const;

const maCua = (phamVi: readonly MucPhamVi[]) => phamVi.map((p) => p.code);
const hocVienCua = (phamVi: readonly MucPhamVi[]) => [...new Set(phamVi.map((p) => p.studentId))];
const ghiDanhCua = (phamVi: readonly MucPhamVi[]) => [...new Set(phamVi.map((p) => p.enrollmentId))];

/** ĐỌC dữ liệu cho `phamVi` (đúng các mã đó; kể cả đơn đã xoá mềm — lõi sẽ từ chối). 6 câu, cố định. */
export async function docDuLieuGanDong(c: KhachGanDong, phamVi: readonly MucPhamVi[]): Promise<DuLieuMotMuc[]> {
  const donList = await c.order.findMany({
    where: { code: { in: maCua(phamVi) } },
    orderBy: { code: "asc" },
    select: {
      id: true, code: true, type: true, status: true, deletedAt: true, studentId: true, centerId: true, totalAmount: true,
      items: { select: { id: true, type: true, studentId: true, enrollmentId: true, itemName: true }, orderBy: { id: "asc" } },
    },
  });
  const orderIds = donList.map((d) => d.id);
  const [khoan, hocVien, ghiDanh, soGhiDanhSong, dongTro] = await Promise.all([
    // Khoản thu SỐNG = chưa xoá mềm + kế toán chưa từ chối (cùng định nghĩa với công nợ).
    c.payment.findMany({
      where: { orderId: { in: orderIds }, deletedAt: null, accountantStatus: { not: "REJECTED" } },
      orderBy: { id: "asc" },
      select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true },
    }),
    c.student.findMany({ where: { id: { in: hocVienCua(phamVi) } }, select: { id: true, deletedAt: true, centerId: true } }),
    c.enrollment.findMany({
      where: { id: { in: ghiDanhCua(phamVi) } },
      select: { id: true, studentId: true, status: true, centerId: true, deletedAt: true, course: { select: { name: true } } },
    }),
    c.enrollment.groupBy({ by: ["studentId"], where: { studentId: { in: hocVienCua(phamVi) }, deletedAt: null }, _count: { _all: true } }),
    c.orderItem.findMany({ where: { enrollmentId: { in: ghiDanhCua(phamVi) } }, select: { id: true, orderId: true, enrollmentId: true } }),
  ]);

  return phamVi.flatMap((pv): DuLieuMotMuc[] => {
    const d = donList.find((x) => x.code === pv.code);
    if (!d) return [];
    const g = ghiDanh.find((x) => x.id === pv.enrollmentId) ?? null;
    return [
      {
        don: {
          id: d.id, code: d.code, type: d.type, status: d.status, deletedAt: d.deletedAt, studentId: d.studentId, centerId: d.centerId, totalAmount: d.totalAmount,
          items: d.items.map((i) => ({ id: i.id, type: i.type, studentId: i.studentId, enrollmentId: i.enrollmentId, itemName: i.itemName })),
        },
        khoan: khoan.filter((k) => k.orderId === d.id).map((k) => ({ id: k.id, orderItemId: k.orderItemId, enrollmentId: k.enrollmentId, amount: k.amount })),
        hocVien: hocVien.find((h) => h.id === pv.studentId) ?? null,
        ghiDanh: g ? { id: g.id, studentId: g.studentId, status: g.status, centerId: g.centerId, deletedAt: g.deletedAt, tenKhoa: g.course?.name ?? null } : null,
        soGhiDanhSong: soGhiDanhSong.find((x) => x.studentId === pv.studentId)?._count._all ?? 0,
        dongTroVaoGhiDanh: dongTro.filter((x) => x.enrollmentId === pv.enrollmentId).map((x) => ({ orderItemId: x.id, orderId: x.orderId })),
      },
    ];
  });
}

export async function docKeHoachGanDong(c: KhachGanDong, phamVi: readonly MucPhamVi[]): Promise<KeHoachGanDong> {
  return lapKeHoachGanDong({ phamVi, du: await docDuLieuGanDong(c, phamVi) });
}

/**
 * ẢNH CHỤP BẤT BIẾN: mọi thứ chủ dự án CẤM đổi — đơn (tổng · trạng thái · học viên · lead), MỌI `Payment` của đơn (cả đã xoá), `Receipt` của chúng, và giá + trạng thái của ghi danh.
 * Trả sha256 của JSON ổn định (sắp theo id). Chụp TRƯỚC và SAU phép ghi, trong CÙNG transaction.
 */
export async function anhChupBatBienGanDong(c: KhachGanDong, phamVi: readonly MucPhamVi[]): Promise<string> {
  const donList = await c.order.findMany({
    where: { code: { in: maCua(phamVi) } },
    orderBy: { id: "asc" },
    select: { id: true, code: true, status: true, subtotal: true, discountAmount: true, discountPercent: true, totalAmount: true, studentId: true, leadId: true, leadChildId: true, centerId: true, deletedAt: true },
  });
  const orderIds = donList.map((d) => d.id);
  const [payments, bienLai, ghiDanh] = await Promise.all([
    c.payment.findMany({
      where: { orderId: { in: orderIds } },
      orderBy: { id: "asc" },
      select: { id: true, orderId: true, orderItemId: true, enrollmentId: true, amount: true, paidDate: true, method: true, saleStatus: true, accountantStatus: true, deletedAt: true },
    }),
    c.receipt.findMany({ where: { payment: { orderId: { in: orderIds } } }, orderBy: { id: "asc" }, select: { id: true, code: true, paymentId: true, enrollmentId: true, status: true, deletedAt: true } }),
    c.enrollment.findMany({
      where: { id: { in: ghiDanhCua(phamVi) } },
      orderBy: { id: "asc" },
      select: { id: true, studentId: true, courseId: true, status: true, listPrice: true, discountType: true, discountAmount: true, tuition: true, finalPrice: true, deletedAt: true },
    }),
  ]);
  return createHash("sha256").update(JSON.stringify({ donList, payments, bienLai, ghiDanh }), "utf8").digest("hex");
}

export type DauVaoGhiGanDong = {
  /** PHẠM VI CỨNG. BẮT BUỘC khai (luật 7). */
  phamVi: readonly MucPhamVi[];
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…"OrderItem"…, 'UPDATE')`; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayGanDong;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiGanDong = { daGhi: number; daGanHet: boolean; keHoachSha: string };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction (`ghiGanDongTrongTx`). MỘT transaction cho cả lô (mục lệch ⇒ lùi cả lô). */
export async function ghiGanDong(c: PrismaClient, input: DauVaoGhiGanDong): Promise<KetQuaGhiGanDong> {
  const truoc = quyetDinhGhiGanDong({ soDuyet: input.soDuyet, keHoach: await docKeHoachGanDong(c, input.phamVi), ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiGanDongTrongTx(tx, input), { timeout: 120_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối là `throw` (luật rollback: `return` KHÔNG rollback). */
export async function ghiGanDongTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiGanDong): Promise<KetQuaGhiGanDong> {
  const ma = maCua(input.phamVi);
  const ghiDanhIds = ghiDanhCua(input.phamVi);
  // 1) KHOÁ hàng sẽ đọc/ghi, theo thứ tự cố định (tránh khoá chéo).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE code = ANY(${ma}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE code = ANY(${ma}::text[])) OR "enrollmentId" = ANY(${ghiDanhIds}::text[]) ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Enrollment" WHERE id = ANY(${ghiDanhIds}::text[]) ORDER BY id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng số duyệt/lệch.
  const kh = await docKeHoachGanDong(tx, input.phamVi);
  const loi = quyetDinhGhiGanDong({ soDuyet: input.soDuyet, keHoach: kh, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Mọi dòng đã gắn ĐÚNG (chạy lại) ⇒ không có gì để duyệt: 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.ghi.length === 0) return { daGhi: 0, daGanHet: kh.daGanHet, keHoachSha: kh.sha };

  // 3) Ảnh chụp bất biến «trước».
  const truoc = await anhChupBatBienGanDong(tx, input.phamVi);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng (digest + số dòng tính lại ở đây). Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.ganDongDonTheoKhoan, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.ghi.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang NULL» trong `where`: lệch (ai đó vừa gắn) ⇒ THROW cả lô — không `continue`.
  let daGhi = 0;
  for (const g of kh.ghi) {
    const i = await tx.orderItem.updateMany({
      where: { id: g.orderItemId, orderId: g.orderId, type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null },
      data: { studentId: g.studentId, enrollmentId: g.enrollmentId },
    });
    if (i.count !== 1) throw new Error(`Gắn dòng đơn ${g.code}: dòng đơn không còn «chưa gắn» giữa chừng — lùi cả lô.`);
    daGhi++;
    await writeAudit({
      actor: input.actor,
      module: "nguon-hoa-hong",
      entityType: "Order",
      entityId: g.orderId,
      action: HANH_DONG_GAN_DONG_THEO_KHOAN,
      oldValues: { orderItemId: g.orderItemId, orderItemStudentId: null, orderItemEnrollmentId: null },
      newValues: { orderItemId: g.orderItemId, orderItemStudentId: g.studentId, orderItemEnrollmentId: g.enrollmentId },
      changedFields: ["OrderItem.studentId", "OrderItem.enrollmentId"],
      reason: "Gắn dòng đơn ↔ ghi danh theo khoản thu đã gắn (không đụng Payment/Receipt/giá/công nợ/hoa hồng)",
      orgUnitId: null,
      tx,
    });
  }

  // 6) ĐỌC LẠI: mọi dòng phải ra «đã gắn ĐÚNG», và không bất biến nào bị đổi.
  const sau = await docKeHoachGanDong(tx, input.phamVi);
  if (sau.dung || !sau.daGanHet) {
    throw new Error(`Sau khi ghi, kế hoạch không ra «mọi dòng đã gắn đúng» (${sau.loi.map((x) => `${x.code}:${x.ma}`).join(" · ") || "chưa đủ"}) — lùi cả lô.`);
  }
  const anhSau = await anhChupBatBienGanDong(tx, input.phamVi);
  if (anhSau !== truoc) throw new Error("Ảnh chụp bất biến (đơn · khoản thu · biên lai · ghi danh) ĐỔI sau phép ghi — lùi cả lô.");

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction: có phép ghi thì có dấu vết, lùi thì lùi cùng.
  if (input.soDuyet === null) throw new Error("ghiGanDongTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "nguon-hoa-hong",
    entityType: "GanDongDonTheoKhoan",
    entityId: khoaLuotChayGanDong(input.luotChay.nguonChay),
    action: HANH_DONG_GAN_DONG_THEO_KHOAN_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotGanDong({ luot: input.luotChay, soDuyet: input.soDuyet, keHoach: kh, daGhi }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy gắn dòng đơn theo khoản thu: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi, daGanHet: true, keHoachSha: kh.sha };
}

/** KIỂM SAU GHI (chỉ đọc): mọi dòng đã gắn đúng + đếm những thứ KHÔNG được đổi. */
export async function kiemSauGhiGanDong(
  c: KhachGanDong,
  phamVi: readonly MucPhamVi[],
): Promise<{ keHoach: KeHoachGanDong; soKhoanSong: number; tongKhoanSong: number; soPhieuThu: number; soPhanBo: number }> {
  const keHoach = await docKeHoachGanDong(c, phamVi);
  const donIds = (await c.order.findMany({ where: { code: { in: maCua(phamVi) } }, select: { id: true } })).map((d) => d.id);
  const khoan = await c.payment.aggregate({ where: { orderId: { in: donIds }, deletedAt: null, accountantStatus: { not: "REJECTED" } }, _count: { _all: true }, _sum: { amount: true } });
  const soPhieuThu = await c.paymentRequest.count({ where: { orderId: { in: donIds } } });
  const soPhanBo = await c.paymentAllocation.count({ where: { paymentRequest: { orderId: { in: donIds } } } });
  return { keHoach, soKhoanSong: khoan._count._all, tongKhoanSong: khoan._sum.amount ?? 0, soPhieuThu, soPhanBo };
}
