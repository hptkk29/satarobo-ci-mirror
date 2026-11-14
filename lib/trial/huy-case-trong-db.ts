// lib/trial/huy-case-trong-db.ts — "bé vừa rời case ⇒ case trống thì tự huỷ": phép kiểm + phép ghi, MỘT chỗ cho mọi đường
// (dời `rescheduleTrialEnrollment` · gỡ khỏi case `goHocVienKhoiCase` · rút khỏi lớp `unenrollLeadChild`). Luật thuần ở
// `canHuyCaseTrong` (lib/trial/ket-cuc-case.ts). Chủ dự án chốt 21/10/2026 (dời), mở rộng 22/10/2026 (gỡ · rút).
//
// Gọi TRONG giao dịch của phép ghi làm bé rời case, SAU phép ghi đó: câu đếm phải thấy trạng thái MỚI. Phép huỷ là `updateMany`
// CÓ ĐIỀU KIỆN trạng thái vừa đọc (mẫu chống-đua FIX-H9): ai đó vừa đổi case thì đổi 0 dòng, không đè; gọi lại trên case đã huỷ
// thì `canHuyCaseTrong` trả không huỷ ⇒ không ghi gì, không trả gì ⇒ nơi gọi không chạy phần sau-huỷ lần hai.
//
// Phần SAU huỷ (Parttime, lịch sử lead, báo GV) KHÔNG ở đây — nơi gọi chạy `sauKhiHuyCase` sau khi giao dịch commit.
import type { Prisma } from "@prisma/client";
import { TRANG_THAI_GHI_DANH_HIEU_LUC, canHuyCaseTrong, type ViecRoiCase } from "./ket-cuc-case";

export async function huyCaseNeuTrong(
  tx: Prisma.TransactionClient,
  p: { sessionId: string; viec: ViecRoiCase },
): Promise<{ id: string; lyDo: string } | undefined> {
  const ca = await tx.trialClassSession.findUnique({
    where: { id: p.sessionId },
    select: { id: true, status: true, date: true, trialClass: { select: { theoKhung: true, centerId: true } } },
  });
  if (!ca || ca.status === "CANCELLED") return undefined;
  const [soBeHieuLuc, soCoMat, ky] = await Promise.all([
    tx.trialEnrollment.count({ where: { scheduledSessionId: ca.id, status: { in: [...TRANG_THAI_GHI_DANH_HIEU_LUC] } } }),
    tx.trialAttendance.count({ where: { trialSessionId: ca.id, status: "PRESENT" } }),
    // Cột `date` là @db.Date (nửa đêm UTC của NGÀY VN) ⇒ 7 ký tự đầu là đúng tháng VN.
    tx.attendancePeriod.findFirst({
      where: { centerId: ca.trialClass.centerId, periodKey: ca.date.toISOString().slice(0, 7), status: "LOCKED" },
      select: { id: true },
    }),
  ]);
  const xet = canHuyCaseTrong({
    lopTheoKhung: ca.trialClass.theoKhung === true,
    trangThaiCase: ca.status,
    soBeHieuLuc,
    soCoMat,
    kyDaChot: !!ky,
    viec: p.viec,
  });
  if (!xet.huy) return undefined;
  const h = await tx.trialClassSession.updateMany({ where: { id: ca.id, status: ca.status }, data: { status: "CANCELLED" } });
  return h.count > 0 ? { id: ca.id, lyDo: xet.lyDo } : undefined;
}
