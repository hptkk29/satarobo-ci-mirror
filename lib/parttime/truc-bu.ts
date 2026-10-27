// lib/parttime/truc-bu.ts — PR6 lưới phân công GV: GV đang TRỰC được book một buổi HỌC BÙ trong cùng ca (chủ dự án 24/10/2026).
//
// Câu hỏi nghiệp vụ: "Sau khi nhận buổi bù, GV có tiếp tục trực phần còn lại của ca không?"
//   · GIỮ  ⇒ id case được ghi vào `OperationsDutyAssignment.keepWithMakeupCaseIds` ⇒ ô lưới TD (Rank + nửa ca trực).
//   · BỎ   ⇒ dòng trực bị HUỶ qua `huyTruc` (lý do + audit) ⇒ ô lưới D, không còn 45.000đ.
//   · Chưa ai quyết (booking từ cron / API / dời lịch / duyệt không hỏi) ⇒ KHÔNG làm gì ở đây: lưới tự hiện cảnh báo CAN_QUYET_TRUC và
//     không suy TD (`tinhCaDuKien`). Đó là mặc định AN TOÀN của mọi đường book — không tự huỷ trực, không tự khẳng định còn trực.
// Huỷ / dời case bù KHÔNG khôi phục dòng trực đã bị bỏ (phải giao trực lại có chủ đích); dòng trực đã giữ thì vẫn nguyên.
// Nơi gọi (server action) đã kiểm quyền `hr_attendance:assign` ở cơ sở của case.
import "server-only";
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { chinhSachTaiNgay } from "./chinh-sach";
import { docChinhSach, type NguoiThaoTac } from "./phan-cong-db";
import { TRANG_THAI_SONG } from "./phan-cong";
import { xepVaoCa } from "./luoi-tuan";
import { huyTruc } from "./truc-van-hanh-db";
import { CASE_CHO_DUYET } from "@/lib/hoc-bu/duyet-case-thuan";

type Tx = Prisma.TransactionClient;
export type KetQuaTrucBu = { ok: true; daDoi: boolean } | { ok: false; loi: string };
export type TrucTrongCa = { dutyId: string; shiftCode: string; tu: string; den: string; centerId: string; daGiu: boolean };

const LY_DO_TOI_THIEU = 5;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Dòng trực CÒN SỐNG của `userId` ở ca chứa trọn [bat, ket] ngày `ngay` (cùng `xepVaoCa` với lưới). null nếu không có / ngày LEGACY. */
export async function trucTrongCaCuaBuoi(
  tx: Tx,
  p: { userId: string; ngay: string; gioBatDau: string; gioKetThuc: string; caseId: string | null },
): Promise<TrucTrongCa | null> {
  const cs = chinhSachTaiNgay(await docChinhSach(tx), p.ngay);
  if (!cs || cs.thamSo.loai !== "SR_QD_238") return null;
  const maCa = xepVaoCa(cs.thamSo, p.gioBatDau, p.gioKetThuc);
  if (!maCa) return null;
  const ca = cs.thamSo.ca.find((c) => c.ma === maCa)!;
  const d = await tx.operationsDutyAssignment.findFirst({
    where: { userId: p.userId, workDate: new Date(`${p.ngay}T00:00:00Z`), shiftCode: maCa, status: { in: [...TRANG_THAI_SONG] } },
    select: { id: true, centerId: true, keepWithMakeupCaseIds: true },
  });
  if (!d) return null;
  return { dutyId: d.id, shiftCode: maCa, tu: ca.tu, den: ca.den, centerId: d.centerId, daGiu: p.caseId != null && d.keepWithMakeupCaseIds.includes(p.caseId) };
}

/**
 * Ghi quyết định của QLCS cho MỘT case bù. Đọc lại case + dòng trực ở máy chủ (không tin id trực client gửi). Từ chối khi: case không phải
 * lịch thật (chờ duyệt / huỷ), không có trực trùng ca, ca trực đã kết thúc (đi "Sửa buổi đã qua"), bỏ trực mà thiếu lý do.
 * Idempotent: giữ hai lần ⇒ `daDoi: false`.
 */
export async function chotTrucKhiCoBu(
  tx: Tx,
  p: { caseId: string; giu: boolean; lyDo: string | null; actor: NguoiThaoTac; now: Date },
): Promise<KetQuaTrucBu> {
  const c = await tx.makeupCase.findUnique({ where: { id: p.caseId }, select: { id: true, status: true, teacherId: true, date: true, startTime: true, endTime: true } });
  if (!c) return { ok: false, loi: "Không tìm thấy case học bù." };
  if (c.status === CASE_CHO_DUYET) return { ok: false, loi: "Case học bù đang chờ duyệt — quyết trực lúc duyệt (hộp Duyệt case) hoặc trên lưới sau khi duyệt." };
  if (c.status !== "SCHEDULED") return { ok: false, loi: "Chỉ quyết trực cho case học bù đã là lịch thật (đã duyệt, chưa huỷ / hoàn tất)." };
  if (!c.teacherId) return { ok: false, loi: "Case chưa có giáo viên." };
  const ngay = ymd(c.date);
  const t = await trucTrongCaCuaBuoi(tx, { userId: c.teacherId, ngay, gioBatDau: c.startTime, gioKetThuc: c.endTime, caseId: c.id });
  if (!t) return { ok: false, loi: "Giáo viên không có ca trực nào chứa buổi bù này — không có gì để quyết." };
  if (p.now.getTime() >= new Date(`${ngay}T${t.den}:00+07:00`).getTime()) return { ok: false, loi: "Ca trực đã kết thúc — sửa qua “Sửa buổi đã qua” (có lý do + nhật ký)." };
  const moTa = `buổi bù ${ngay.slice(8, 10)}/${ngay.slice(5, 7)} ${c.startTime}–${c.endTime}`;

  if (p.giu) {
    if (t.daGiu) return { ok: true, daDoi: false };
    const d = await tx.operationsDutyAssignment.findUniqueOrThrow({ where: { id: t.dutyId }, select: { keepWithMakeupCaseIds: true, orgUnitId: true } });
    await tx.operationsDutyAssignment.update({ where: { id: t.dutyId }, data: { keepWithMakeupCaseIds: [...new Set([...d.keepWithMakeupCaseIds, c.id])] } });
    await writeAudit({
      actor: p.actor,
      module: "hr_attendance",
      entityType: "OperationsDutyAssignment",
      entityId: t.dutyId,
      action: "PT_DUTY_KEPT_WITH_MAKEUP",
      newValues: { caseId: c.id, ngay, shiftCode: t.shiftCode },
      reason: p.lyDo ?? undefined,
      orgUnitId: d.orgUnitId,
      tx,
    });
    return { ok: true, daDoi: true };
  }

  const lyDo = p.lyDo?.trim() ?? "";
  if (lyDo.length < LY_DO_TOI_THIEU) return { ok: false, loi: `Ghi lý do kết thúc trực (tối thiểu ${LY_DO_TOI_THIEU} ký tự).` };
  const r = await huyTruc(tx, { dutyId: t.dutyId, lyDo: `Nhận ${moTa} — kết thúc trực ca ${t.shiftCode}: ${lyDo}`, actor: p.actor });
  return r.ok ? { ok: true, daDoi: true } : r;
}
