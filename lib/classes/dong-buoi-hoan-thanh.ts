// lib/classes/dong-buoi-hoan-thanh.ts — HOÀN THÀNH LỚP SỚM ⇒ đóng các buổi TƯƠNG LAI còn mở (chủ dự án chốt 13/10/2026).
//
// Trước: `completeClassAction` chỉ đổi lớp + ghi danh sang COMPLETED, KHÔNG đụng buổi ⇒ buổi chưa học của lớp đã hoàn thành
// vẫn SCHEDULED, phân công Parttime của chúng vẫn sống, giáo viên vẫn bấm "nhận" được.
//
// Luật:
//  · CHỈ buổi CHƯA BẮT ĐẦU: `date > now` (ClassSession.date mang GIỜ THẬT) VÀ còn SCHEDULED ⇒ CANCELLED (đúng vòng đời có
//    sẵn). Không xoá cứng, không đổi ngày. Buổi sáng nay đã dạy mà chưa bấm hoàn tất, hay buổi đang IN_PROGRESS, KHÔNG bị
//    huỷ — huỷ chúng là xoá một buổi đã thật sự diễn ra (P4 sẽ báo "buổi huỷ mà có chấm công").
//  · Buổi đã COMPLETED / đã CANCELLED / buổi đã qua giờ bắt đầu: không đụng (lịch sử, điểm danh, kỳ đã khoá giữ nguyên).
//  · Giới hạn đã biết: buổi CŨ còn lưu ở 00:00 VN của hôm nay (dữ liệu trước đợt backfill giờ buổi) nằm TRƯỚC `now` nên
//    KHÔNG bị đóng — giữ mở để người vận hành xử tay, không đoán giờ thật của nó.
//  · Mỗi buổi bị đóng một dòng audit `CANCEL_SESSION` (lý do "hoàn thành lớp sớm").
//  · Phân công: ĐÁNH DẤU trong cùng giao dịch (`danhDauCanDongBo`) — bộ đồng bộ P3a huỷ phân công sống sau commit, có audit
//    riêng từng phân công; xác nhận nhận lớp (bất biến) giữ nguyên.
//  · Idempotent: lần hai không còn buổi mở tương lai ⇒ không ghi gì (và `completeClassAction` vốn chặn lớp đã COMPLETED).
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { danhDauCanDongBo } from "@/lib/parttime/dong-bo";
import type { NguoiThaoTac } from "@/lib/parttime/phan-cong-db";

type Tx = Prisma.TransactionClient;

export type KetQuaDongBuoi = {
  /** Buổi vừa chuyển CANCELLED. */
  daDong: string[];
  /** Nguồn cần chạy đồng bộ ngay sau commit (`dongBoNgay`) — rỗng khi không có gì phải làm. */
  nguonDongBo: { sourceType: "CLASS_SESSION"; sourceId: string }[];
  canDongBo: boolean;
};

export async function dongBuoiTuongLaiKhiHoanThanh(
  tx: Tx,
  p: { classId: string; now: Date; actor: NguoiThaoTac; lyDo: string },
): Promise<KetQuaDongBuoi> {
  const mo = await tx.classSession.findMany({
    where: { classId: p.classId, date: { gt: p.now }, status: "SCHEDULED" },
    select: { id: true, status: true, date: true },
    orderBy: { date: "asc" },
  });
  if (mo.length === 0) return { daDong: [], nguonDongBo: [], canDongBo: false };

  // Có điều kiện trạng thái: buổi vừa được hoàn tất / huỷ bởi người khác giữa lúc đọc và lúc ghi thì KHÔNG bị ghi đè.
  const r = await tx.classSession.updateMany({
    where: { id: { in: mo.map((s) => s.id) }, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });
  if (r.count !== mo.length) throw new Error("Buổi của lớp vừa thay đổi trong lúc hoàn thành — thử lại.");

  for (const s of mo) {
    await writeAudit({
      actor: { id: p.actor.id, name: p.actor.name },
      module: "classes",
      entityType: "ClassSession",
      entityId: s.id,
      action: "CANCEL_SESSION",
      oldValues: { status: s.status, date: s.date },
      newValues: { status: "CANCELLED" },
      reason: p.lyDo,
      tx,
    });
  }
  const nguonDongBo = mo.map((s) => ({ sourceType: "CLASS_SESSION" as const, sourceId: s.id }));
  const canDongBo = await danhDauCanDongBo(tx, nguonDongBo, "HOAN_THANH_LOP", p.actor);
  return { daDong: mo.map((s) => s.id), nguonDongBo, canDongBo };
}
