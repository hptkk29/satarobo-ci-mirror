// lib/hoc-bu/dong-diem-danh.ts — MỘT bộ luật "điểm danh vừa lưu ⇒ dòng cần bù làm gì" (T05, 07/10/2026).
//
// Trước T05 luật này chép tay ở HAI nơi (`teacher/lop/_actions.ts`, `admin/attendance/_actions.ts`) và lệch nhau từng chữ, chạy SAU khi
// điểm danh đã commit với lỗi bị nuốt bằng `console.error` ⇒ điểm danh ghi "cần bù" mà KHÔNG có dòng (TV-08), và không có đường nào
// báo. Nay: hàm này chạy TRONG giao dịch lưu điểm danh. Dòng và điểm danh sinh ra nó commit hoặc rollback CÙNG nhau.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { taoDongHocBu, thuHoiDongKhiCoMat } from "@/lib/hoc-bu/dong-service";

type Tx = Prisma.TransactionClient;

/**
 * Giao dịch lưu điểm danh. Đi qua `db` TRẦN, không qua `scopedDb`: học bù có thể LIÊN CƠ SỞ (câu 47) nên đọc buổi/lớp của dòng cần bù
 * không được bị lọc theo cơ sở của người bấm — nơi gọi PHẢI đã kiểm quyền (roster + `attendance:mark`), và `scopedDb` vốn không che
 * phép GHI. Nằm ở đây vì `app/(admin|teacher)/**` bị ESLint cấm import `@/lib/db` trần. Trần 30 giây: 100 học viên × vài câu/học
 * viên qua mạng chậm vượt trần 5 giây mặc định (P2028 — giao dịch bị cắt giữa chừng).
 */
export function giaoDichDiemDanh<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });
}

export type BanGhiDiemDanhDaLuu = {
  studentId: string;
  /** Id bản ghi `Attendance` vừa upsert — trở thành `originalAttendanceId` của dòng. */
  attendanceId: string;
  status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED";
  /** Trạng thái bù HIỆU LỰC sau lần lưu này (`makeupStatusSauKhiLuu`). */
  makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP";
  /** Trạng thái bù TRƯỚC lần lưu (bản ghi cũ); undefined = buổi chưa từng điểm danh học viên này. */
  makeupStatusTruoc: "NONE" | "NEEDS_MAKEUP" | "MADE_UP" | undefined;
  absenceReason: string | null;
};

const CO_MAT = new Set(["PRESENT", "LATE"]);

/**
 * Áp luật cho cả buổi. Thứ tự theo `studentId` để hai lượt đồng thời khoá hàng theo CÙNG thứ tự (tránh khoá vòng).
 *
 *  · `NEEDS_MAKEUP` ⇒ tạo dòng (nguồn ABSENCE, mang điểm danh gốc). `hoiSinh` chỉ khi học viên TRƯỚC ĐÓ chưa ở diện cần bù —
 *    chuyển trạng thái THẬT: lưu lại một buổi vốn đã NEEDS_MAKEUP không được dựng dậy dòng mà quản lý vừa tự huỷ.
 *  · CÓ MẶT (PRESENT/LATE) ⇒ thu hồi dòng PENDING còn treo. ⚠️ CHỈ khi quay lại CÓ MẶT: mở rộng sang "mọi trạng thái không cần bù"
 *    từng huỷ luôn suất bù của học viên vắng CÓ PHÉP (nhu cầu do phiếu xin nghỉ đã duyệt sinh ra) — bản thử 19/08.
 *  · MADE_UP không đụng: dòng đã hoàn tất.
 */
export async function dongBoDongSauDiemDanh(
  tx: Tx,
  p: { sessionId: string; createdById: string | null; ghi: readonly BanGhiDiemDanhDaLuu[] },
): Promise<{ tao: number; hoiSinh: number; thuHoi: number }> {
  const kq = { tao: 0, hoiSinh: 0, thuHoi: 0 };
  for (const r of [...p.ghi].sort((a, b) => a.studentId.localeCompare(b.studentId))) {
    if (r.makeupStatus === "NEEDS_MAKEUP") {
      const t = await taoDongHocBu(tx, {
        studentId: r.studentId,
        missedSessionId: p.sessionId,
        nguon: "ABSENCE",
        originalAttendanceId: r.attendanceId,
        createdById: p.createdById,
        note: r.absenceReason,
        hoiSinh: r.makeupStatusTruoc !== "NEEDS_MAKEUP",
      });
      if (t.ket === "TAO") kq.tao++;
      if (t.ket === "HOI_SINH") kq.hoiSinh++;
    } else if (CO_MAT.has(r.status)) {
      kq.thuHoi += await thuHoiDongKhiCoMat(tx, { studentId: r.studentId, missedSessionId: p.sessionId });
    }
  }
  return kq;
}
