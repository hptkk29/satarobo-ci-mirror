// lib/enrollments/di-theo-gia-va-tien-db.ts — PHẦN DB của «giá và khoản thu đi theo ghi danh mới khi chuyển lớp cùng khoá» (P7-G2, 27/10/2026). Luật + lý do: đầu `di-theo-gia-va-tien.ts`.
import type { Prisma } from "@prisma/client";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { KHOAN_DA_XAC_NHAN, laKhoanDaXacNhan } from "@/lib/finance/debt";
import { GIA_TRONG, SEL_GIA, cungGia, giaTrong, noCua, xetDiTheoGiaVaTien, type KetQuaDiTheoGiaVaTien } from "./di-theo-gia-va-tien";

type Tx = Prisma.TransactionClient;

/**
 * Mang giá + khoản thu + dòng đơn từ ghi danh CŨ sang ghi danh MỚI, TRONG transaction của người gọi. Người gọi PHẢI đã KHOÁ hàng ghi danh cũ (`FOR UPDATE`).
 * Mọi phép ghi có điều kiện "đang đúng trạng thái đã đọc"; lệch số dòng ⇒ NÉM (cuộn ngược cả chuyển lớp). Hậu điều kiện cuối hàm: tổng giá và tổng tiền của hai ghi danh
 * trước = sau, và nợ ghi danh mới = nợ ghi danh cũ trước đó (không tự sinh nợ mới).
 */
export async function diTheoGiaVaTienSangGhiDanhMoi(
  tx: Tx,
  p: { cuId: string; moiId: string; khoaCu: string; khoaMoi: string; actor: AuditActor; lyDo: string; orgUnitId: string | null },
): Promise<KetQuaDiTheoGiaVaTien> {
  const [cu, moi, khoan, hoanTien, baoLuu, dongDon] = await Promise.all([
    tx.enrollment.findUniqueOrThrow({ where: { id: p.cuId }, select: SEL_GIA }),
    tx.enrollment.findUniqueOrThrow({ where: { id: p.moiId }, select: SEL_GIA }),
    tx.payment.findMany({ where: { enrollmentId: p.cuId, deletedAt: null }, select: { id: true, amount: true, accountantStatus: true }, orderBy: { id: "asc" } }),
    tx.refundRequest.count({ where: { enrollmentId: p.cuId } }),
    tx.studentReserve.count({ where: { enrollmentId: p.cuId } }),
    tx.orderItem.findMany({ where: { enrollmentId: p.cuId }, select: { id: true }, orderBy: { id: "asc" } }),
  ]);
  const quyet = xetDiTheoGiaVaTien({ khoaCu: p.khoaCu, khoaMoi: p.khoaMoi, giaCu: cu, giaMoi: moi, soKhoanCu: khoan.length, soHoanTienBaoLuuCu: hoanTien + baoLuu });
  if (!quyet.lam) return { daDoi: false, ma: quyet.ma };

  const coGia = !giaTrong(cu);
  const tongTien = khoan.reduce((s, k) => s + k.amount, 0);
  const daXacNhan = khoan.filter((k) => laKhoanDaXacNhan({ accountantStatus: k.accountantStatus, deletedAt: null })).reduce((s, k) => s + k.amount, 0);
  const noTruoc = noCua(cu.finalPrice, daXacNhan);
  const tongGiaTruoc = (cu.finalPrice ?? 0) + (moi.finalPrice ?? 0);

  // 1 · khoản thu. `id IN` + `enrollmentId = cũ` + chưa xoá: khoản bị phiên khác dời / xoá giữa chừng ⇒ lệch số dòng ⇒ ném.
  if (khoan.length > 0) {
    const r = await tx.payment.updateMany({ where: { id: { in: khoan.map((k) => k.id) }, enrollmentId: p.cuId, deletedAt: null }, data: { enrollmentId: p.moiId } });
    if (r.count !== khoan.length) throw new Error(`Chuyển lớp ${p.cuId}→${p.moiId}: dời ${r.count}/${khoan.length} khoản thu — trạng thái đổi giữa chừng — lùi cả chuyển lớp.`);
  }
  // 2 · giá: ghi danh mới CẢ NĂM cột NULL → giá cũ; ghi danh cũ giá cũ → CẢ NĂM NULL.
  if (coGia) {
    const m = await tx.enrollment.updateMany({ where: { id: p.moiId, ...GIA_TRONG }, data: { ...cu } });
    if (m.count !== 1) throw new Error(`Chuyển lớp ${p.cuId}→${p.moiId}: ghi danh mới không còn trống giá — lùi cả chuyển lớp.`);
    const c = await tx.enrollment.updateMany({ where: { id: p.cuId, ...cu }, data: { ...GIA_TRONG } });
    if (c.count !== 1) throw new Error(`Chuyển lớp ${p.cuId}→${p.moiId}: giá ghi danh cũ đổi giữa chừng — lùi cả chuyển lớp.`);
  }
  // 3 · dòng đơn.
  if (dongDon.length > 0) {
    const r = await tx.orderItem.updateMany({ where: { id: { in: dongDon.map((d) => d.id) }, enrollmentId: p.cuId }, data: { enrollmentId: p.moiId } });
    if (r.count !== dongDon.length) throw new Error(`Chuyển lớp ${p.cuId}→${p.moiId}: dời ${r.count}/${dongDon.length} dòng đơn — lùi cả chuyển lớp.`);
  }

  // 4 · HẬU ĐIỀU KIỆN (đọc lại, cùng transaction).
  const [cuSau, moiSau, conCu, tienMoi] = await Promise.all([
    tx.enrollment.findUniqueOrThrow({ where: { id: p.cuId }, select: SEL_GIA }),
    tx.enrollment.findUniqueOrThrow({ where: { id: p.moiId }, select: SEL_GIA }),
    tx.payment.count({ where: { enrollmentId: p.cuId, deletedAt: null } }),
    tx.payment.findMany({ where: { enrollmentId: p.moiId, ...KHOAN_DA_XAC_NHAN }, select: { amount: true } }),
  ]);
  const daXacNhanMoiSau = tienMoi.reduce((s, k) => s + k.amount, 0);
  const tongGiaSau = (cuSau.finalPrice ?? 0) + (moiSau.finalPrice ?? 0);
  const giaDung = coGia ? giaTrong(cuSau) && cungGia(moiSau, cu) : cungGia(cuSau, cu) && cungGia(moiSau, moi);
  // `daXacNhanMoiSau` có thể lớn hơn `daXacNhan` nếu ghi danh mới đã có khoản trước đó — ghi danh mới vừa tạo thì không; nếu có, nợ khác nhau và ta DỪNG.
  if (conCu !== 0 || !giaDung || tongGiaSau !== tongGiaTruoc || daXacNhanMoiSau !== daXacNhan || noCua(moiSau.finalPrice, daXacNhanMoiSau) !== (coGia ? noTruoc : noCua(moiSau.finalPrice, daXacNhan))) {
    throw new Error(`Chuyển lớp ${p.cuId}→${p.moiId}: hậu điều kiện giá/tiền KHÔNG đúng (còn ${conCu} khoản ở ghi danh cũ; tổng giá ${tongGiaTruoc}→${tongGiaSau}; đã thu ${daXacNhan}→${daXacNhanMoiSau}) — lùi cả chuyển lớp.`);
  }

  // 5 · dấu vết.
  for (const k of khoan) {
    await writeAudit({
      tx, actor: p.actor, module: "finance", entityType: "Payment", entityId: k.id, action: "CHUYEN_LOP_DOI_KHOAN_THEO_GHI_DANH",
      oldValues: { enrollmentId: p.cuId }, newValues: { enrollmentId: p.moiId }, changedFields: ["enrollmentId"], reason: p.lyDo, orgUnitId: p.orgUnitId,
    });
  }
  if (coGia) {
    for (const [eid, truoc, sau] of [[p.cuId, cu, GIA_TRONG], [p.moiId, GIA_TRONG, cu]] as const) {
      await writeAudit({
        tx, actor: p.actor, module: "finance", entityType: "Enrollment", entityId: eid, action: "CHUYEN_LOP_DOI_GIA_THEO_GHI_DANH",
        oldValues: { ...truoc }, newValues: { ...sau }, changedFields: [...Object.keys(SEL_GIA)], reason: p.lyDo, orgUnitId: p.orgUnitId,
      });
    }
  }
  for (const d of dongDon) {
    await writeAudit({
      tx, actor: p.actor, module: "finance", entityType: "OrderItem", entityId: d.id, action: "CHUYEN_LOP_DOI_DONG_DON_THEO_GHI_DANH",
      oldValues: { enrollmentId: p.cuId }, newValues: { enrollmentId: p.moiId }, changedFields: ["enrollmentId"], reason: p.lyDo, orgUnitId: p.orgUnitId,
    });
  }
  return { daDoi: true, soKhoan: khoan.length, tongTien, soDongDon: dongDon.length, giaDiTheo: coGia };
}
