// lib/hoc-bu/huy-lop.ts — "huỷ lớp" nhìn từ phía HỌC BÙ (T05, QUYẾT ĐỊNH 10 của chủ dự án, 07/10/2026).
//
// Trước T05 huỷ lớp CASCADE huỷ mọi dòng cần bù đang mở của lớp (QA 21/07 B12) — và để `MakeupCaseStudent` PLACED mồ côi (đúng trạng
// thái CRITICAL TV-15) vì không đụng case. Quyết định 10: huỷ lớp KHÔNG tự huỷ dòng/case; đánh giá phụ thuộc THEO TỪNG HỌC VIÊN. Học
// viên vẫn nợ buổi bù: lớp đóng không xoá việc bé đã vắng một bài mà chưa học lại. Việc có bù tiếp hay không do quản lý quyết
// (nút "Huỷ" có lý do ở /admin/hoc-bu), không phải do một nút ở chỗ khác.
//
// Hàm này KHÔNG ghi gì: chỉ trả ra ai còn nợ bao nhiêu buổi và có đang học khoá đó ở lớp khác không — để audit/sự kiện huỷ lớp nói đúng,
// và để người quyết có số liệu. Gọi TRONG giao dịch huỷ lớp, SAU khi ghi danh đã chuyển WITHDREW (thấy ghi danh còn lại ở lớp KHÁC).
import "server-only";
import type { Prisma } from "@prisma/client";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";

type Tx = Prisma.TransactionClient;

export type HocBuConMo = {
  studentId: string;
  needIds: string[];
  /** Học viên còn ghi danh ĐANG HỌC cùng khoá ở một lớp khác — dòng của họ có chỗ để bù tiếp. */
  conGhiDanKhoaKhac: boolean;
};

export async function danhGiaHocBuKhiHuyLop(tx: Tx, classId: string): Promise<HocBuConMo[]> {
  const lop = await tx.class.findUnique({ where: { id: classId }, select: { courseId: true } });
  if (!lop) return [];
  const dong = await tx.makeupNeed.findMany({
    where: { classId, status: { in: ["PENDING", "SCHEDULED"] } },
    select: { id: true, studentId: true },
    orderBy: [{ studentId: "asc" }, { id: "asc" }],
  });
  if (dong.length === 0) return [];
  const sids = [...new Set(dong.map((d) => d.studentId))];
  const khac = await tx.enrollment.findMany({
    where: {
      studentId: { in: sids },
      classId: { not: classId },
      courseId: lop.courseId,
      deletedAt: null,
      status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
    },
    select: { studentId: true },
  });
  const conLai = new Set(khac.map((k) => k.studentId));
  return sids.map((studentId) => ({
    studentId,
    needIds: dong.filter((d) => d.studentId === studentId).map((d) => d.id),
    conGhiDanKhoaKhac: conLai.has(studentId),
  }));
}
