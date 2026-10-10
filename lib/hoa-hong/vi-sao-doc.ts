// lib/hoa-hong/vi-sao-doc.ts — ĐỌC cho ngăn "Vì sao con số này" (06 §2.3): MỘT dòng sổ → `ViSaoDayDu`.
//
// ── Cùng cổng với `docSoHoaHong` ────────────────────────────────────────────────────────────────────────────
// Phạm vi người xem lấy từ `phamViNguoiXem` — hàm mà `docSoHoaHong` và `docViSao` cũng dùng. Ngăn mà tự dựng phạm vi riêng là cửa thứ hai để đọc dòng của người
// khác. Dòng ngoài tầm nhìn ⇒ `null` (KHÔNG ném lỗi riêng: không lộ "dòng này có tồn tại"). Các dòng LIÊN QUAN (gốc ↔ điều chỉnh) cũng đi qua cùng phạm vi:
// Sale chỉ thấy dòng điều chỉnh CỦA MÌNH, không thấy dòng của vai khác trên cùng khoản.
//
// ── Ảnh chụp, không tính lại ───────────────────────────────────────────────────────────────────────────────
// Mọi số tiền/tỉ lệ/chính sách lấy từ cột trên dòng. Chỉ TÊN (nguồn, vai, người, học viên) và khoản thu gốc được tra theo id — chính sách đổi sau đó vẫn giải
// thích đúng con số đã ghi.
//
// ── Nhật ký thao tác ───────────────────────────────────────────────────────────────────────────────────────
// Chỉ người có `view-center` mới đọc `AuditLog` của ô tính: bản ghi audit mang `newValues` (tổng tiền, các vai) — với Sale đó là tiền của người khác. Họ nhận
// dòng thời gian suy ra từ CHÍNH dòng sổ của họ (ghi sổ, chi trả). Chỉ lấy `action` · `actorName` · `reason` · `createdAt`, KHÔNG lấy `oldValues`/`newValues`.
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";

import { duocXemTongTiLe, phamViNguoiXem } from "./doc-so";
import { dungViSaoDayDu, type DongLienQuanTho, type MocNhatKyTho, type ViSaoDayDu } from "./vi-sao-day-du";

const MODULE_AUDIT = "hoa-hong";
const TOI_DA_NHAT_KY = 50;
const TOI_DA_LIEN_QUAN = 30;

export async function docViSaoDayDu(actor: Actor, entryId: string): Promise<ViSaoDayDu | null> {
  const { xemCoSo, tamCoSo, dieuKien } = phamViNguoiXem(actor);
  const d = await db.commissionTransaction.findFirst({
    where: { AND: [{ id: entryId }, ...dieuKien] },
    select: {
      id: true,
      centerId: true,
      entryKind: true,
      amount: true,
      grossAmount: true,
      vatRate: true,
      netBase: true,
      rate: true,
      fixedAmount: true,
      capRate: true,
      equivalentRate: true,
      sourceGroupCode: true,
      sourceGroup: { select: { name: true } },
      transactionTypeCode: true,
      roleCode: true,
      beneficiaryRole: { select: { name: true } },
      beneficiaryKind: true,
      beneficiaryName: true,
      resolverType: true,
      resolverBasis: true,
      splitMethod: true,
      documentNumber: true,
      versionNo: true,
      calcKind: true,
      reason: true,
      reasonCode: true,
      naturalPeriod: true,
      period: { select: { period: true } },
      lateArrival: true,
      refEntryId: true,
      refEventType: true,
      refEventId: true,
      paymentId: true,
      studentId: true,
      calcSlotId: true,
      payoutStatus: true,
      payoutStatusAt: true,
      createdAt: true,
    },
  });
  if (!d) return null;

  const goc = d.refEntryId ?? d.id;
  const [khoan, hocVien, lienQuan, nhatKy, nhomNguon] = await Promise.all([
    d.paymentId ? db.payment.findUnique({ where: { id: d.paymentId }, select: { paidDate: true, confirmedAt: true, amount: true } }) : Promise.resolve(null),
    d.studentId ? db.student.findUnique({ where: { id: d.studentId }, select: { name: true } }) : Promise.resolve(null),
    // Gốc ↔ điều chỉnh: dòng gốc và mọi dòng trỏ về nó — CHỈ những dòng người xem được thấy.
    db.commissionTransaction.findMany({
      where: { AND: [{ OR: [{ id: goc }, { refEntryId: goc }] }, ...dieuKien] },
      select: { id: true, entryKind: true, amount: true, naturalPeriod: true, period: { select: { period: true } }, lateArrival: true, reasonCode: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TOI_DA_LIEN_QUAN,
    }),
    xemCoSo && d.calcSlotId
      ? db.auditLog.findMany({
          where: { module: MODULE_AUDIT, entityType: "CommissionCalcSlot", entityId: d.calcSlotId },
          select: { action: true, actorName: true, reason: true, createdAt: true },
          orderBy: { createdAt: "asc" },
          take: TOI_DA_NHAT_KY,
        })
      : Promise.resolve(null),
    // Bảng TÊN nhóm nguồn (tối đa vài chục dòng, danh mục — không scope): để câu giải thích chính sách của engine không in MÃ nhóm.
    db.leadSourceGroup.findMany({ select: { code: true, name: true } }),
  ]);

  const lienQuanTho: DongLienQuanTho[] = lienQuan.map((r) => ({
    id: r.id,
    entryKind: r.entryKind,
    amount: r.amount,
    kyGhi: r.period.period,
    kyHieuLuc: r.naturalPeriod,
    lateArrival: r.lateArrival,
    reasonCode: r.reasonCode,
    laDongNay: r.id === d.id,
  }));
  const nhatKyTho: MocNhatKyTho[] | null = nhatKy
    ? nhatKy.map((a) => ({ luc: a.createdAt.toISOString(), hanhDong: a.action, nguoi: a.actorName, lyDo: a.reason }))
    : null;

  return dungViSaoDayDu({
    dong: {
      entryKind: d.entryKind,
      amount: d.amount,
      grossAmount: d.grossAmount,
      vatRate: Number(d.vatRate),
      netBase: d.netBase,
      rate: d.rate === null ? null : Number(d.rate),
      fixedAmount: d.fixedAmount,
      capRate: Number(d.capRate),
      equivalentRate: Number(d.equivalentRate),
      sourceGroupCode: d.sourceGroupCode,
      transactionTypeCode: d.transactionTypeCode,
      roleCode: d.roleCode,
      splitMethod: d.splitMethod,
      documentNumber: d.documentNumber,
      versionNo: d.versionNo,
      calcKind: d.calcKind,
      reason: d.reason,
      reasonCode: d.reasonCode,
      naturalPeriod: d.naturalPeriod,
      kyGhi: d.period.period,
      lateArrival: d.lateArrival,
      refEntryId: d.refEntryId,
      refEventType: d.refEventType,
      refEventId: d.refEventId,
      resolverBasis: d.resolverBasis,
      paymentId: d.paymentId,
    },
    hienTongTiLe: duocXemTongTiLe(tamCoSo, d.centerId),
    nguoiHuong: { ten: d.beneficiaryName, kind: d.beneficiaryKind },
    tenVai: d.beneficiaryRole.name,
    tenNhomNguon: d.sourceGroup.name,
    tenNhomTheoMa: Object.fromEntries(nhomNguon.map((n) => [n.code, n.name])),
    resolverType: d.resolverType,
    hocVien: { ten: hocVien?.name ?? null },
    khoanThu: khoan ? { ngayThu: khoan.paidDate.toISOString(), xacNhanLuc: khoan.confirmedAt ? khoan.confirmedAt.toISOString() : null, soTien: khoan.amount } : null,
    chiTra: { trangThai: d.payoutStatus, luc: d.payoutStatusAt ? d.payoutStatusAt.toISOString() : null },
    taoLuc: d.createdAt.toISOString(),
    lienQuan: lienQuanTho,
    nhatKy: nhatKyTho,
  });
}
