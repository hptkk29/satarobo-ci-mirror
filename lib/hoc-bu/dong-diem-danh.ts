// lib/hoc-bu/dong-diem-danh.ts — MỘT bộ luật "điểm danh vừa lưu ⇒ dòng cần bù làm gì" (T05, 07/10/2026).
//
// Trước T05 luật này chép tay ở HAI nơi (`teacher/lop/_actions.ts`, `admin/attendance/_actions.ts`) và lệch nhau từng chữ, chạy SAU khi
// điểm danh đã commit với lỗi bị nuốt bằng `console.error` ⇒ điểm danh ghi "cần bù" mà KHÔNG có dòng (TV-08), và không có đường nào
// báo. Nay: hàm này chạy TRONG giao dịch lưu điểm danh. Dòng và điểm danh sinh ra nó commit hoặc rollback CÙNG nhau.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { huyDongKhongCanBu, taoDongHocBu, thuHoiDongKhiCoMat } from "@/lib/hoc-bu/dong-service";
import { ghiNhatKy } from "@/lib/hoc-bu/nhat-ky";
import { dongBoSoCaiNeuBat, tomTatKetQuaDongBo, type SoCaiDiemDanh } from "@/lib/entitlements/dong-bo-bai-db";

// Cổng cờ "thu học phí theo phạm vi học" cho đường điểm danh: ĐỌC NGOÀI giao dịch (trước `giaoDichDiemDanh`), truyền vào `soCai` bên dưới.
// Ba nơi lưu điểm danh (`admin/attendance`, `teacher/lop`, `admin/parent-requests`) import nó từ đây — không import thẳng `lib/entitlements`.
export { docSoCaiDiemDanh, type SoCaiDiemDanh } from "@/lib/entitlements/dong-bo-bai-db";

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

/**
 * XOÁ một bản ghi điểm danh và đồng bộ sổ cái quyền học TRONG CÙNG giao dịch (bản ghi mất thì bằng chứng "có mặt" mất theo: dòng sổ cái của bài phải được huỷ).
 * CHỈ gọi khi cờ BẬT (`soCai` khác null); cờ TẮT thì nơi gọi giữ nguyên phép xoá cũ — hàm này không có nhánh "tắt" để khỏi đổi hành vi đường cũ.
 */
export async function xoaDiemDanhVaDongBoSoCai(p: { attendanceId: string; studentId: string; sessionId: string; soCai: SoCaiDiemDanh }): Promise<void> {
  await giaoDichDiemDanh(async (tx) => {
    await tx.attendance.delete({ where: { id: p.attendanceId } });
    await dongBoSoCaiNeuBat(tx, { soCai: p.soCai, dau: [{ studentId: p.studentId, sessionId: p.sessionId }] });
  });
}

/**
 * Tên các học viên (trong `studentIds`) đang có dòng cần bù ĐÃ XẾP vào case ở buổi vắng này (SCHEDULED). Màn điểm danh dùng để từ chối "Không cần bù" cho họ — dòng đã hẹn với
 * phụ huynh không tự mất sau lưng; gỡ bé khỏi case ở /hoc-bu trước. Đọc bằng `db` trần: học bù liên cơ sở, quyền + roster đã kiểm ở nơi gọi.
 */
export async function docHocVienDaXepCaseO(sessionId: string, studentIds: readonly string[]): Promise<string[]> {
  if (studentIds.length === 0) return [];
  const dong = await db.makeupNeed.findMany({
    where: { missedSessionId: sessionId, studentId: { in: [...studentIds] }, status: "SCHEDULED" },
    select: { student: { select: { name: true } } },
  });
  return dong.map((d) => d.student.name);
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
  /**
   * Lý do của lần chọn "Không cần bù" MỚI (xem `laChonKhongCanBuMoi`). Có ⇒ ghi nhật ký `hoc-bu.khong-can-bu` kể cả khi KHÔNG có dòng nào để thu hồi (quyết định đáng truy:
   * một buổi vắng bị đánh dấu không bù mà chưa từng có dòng thì không còn dấu vết nào khác). Không có ⇒ lựa chọn cũ được giữ, không nhật ký.
   */
  lyDoKhongCanBu?: string | null;
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
 *
 * SỔ CÁI QUYỀN HỌC (thu học phí theo phạm vi học, KV4): `soCai` là kết quả `docSoCaiDiemDanh` — đọc cờ NGOÀI giao dịch. BẮT BUỘC khai (luật 7: `tsc` liệt kê
 * chỗ gọi); `null` = cờ TẮT ⇒ bước cuối KHÔNG chạm DB và hàm này làm đúng như trước. Bước sổ cái chạy CUỐI CÙNG (sau khi mọi khoá điểm danh / dòng cần bù đã lấy):
 * khoá quyền học đứng sau khoá điểm danh, đúng thứ tự `dich-vu.ts`.
 */
export async function dongBoDongSauDiemDanh(
  tx: Tx,
  p: { sessionId: string; createdById: string | null; ghi: readonly BanGhiDiemDanhDaLuu[]; soCai: SoCaiDiemDanh | null },
): Promise<{ tao: number; hoiSinh: number; thuHoi: number; khongCanBu: number }> {
  const kq = { tao: 0, hoiSinh: 0, thuHoi: 0, khongCanBu: 0 };
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
    } else if (r.makeupStatus === "NONE") {
      // VẮNG mà `NONE` chỉ có thể là lựa chọn TƯỜNG MINH "Không cần bù" (`makeupStatusSauKhiLuu` — mặc định vắng luôn là cần bù): không tạo dòng, và thu hồi dòng
      // PENDING còn treo để nút không nói dối (lưới nói "không cần bù" mà /hoc-bu vẫn hiện bé trong danh sách cần bù).
      const id = await huyDongKhongCanBu(tx, { studentId: r.studentId, missedSessionId: p.sessionId });
      if (id) kq.khongCanBu++;
      if (r.lyDoKhongCanBu) {
        await ghiNhatKy(tx, {
          actorId: p.createdById,
          entityType: "Attendance",
          entityId: r.attendanceId,
          action: "hoc-bu.khong-can-bu",
          newValues: { studentId: r.studentId, sessionId: p.sessionId, dongThuHoi: id },
          reason: r.lyDoKhongCanBu.trim(),
        });
      }
    }
  }
  const soCai = await dongBoSoCaiNeuBat(tx, { soCai: p.soCai, dau: p.ghi.map((r) => ({ studentId: r.studentId, sessionId: p.sessionId })) });
  if (soCai.khongGhiDuoc.length > 0 || soCai.buoiKhongCoBai > 0) {
    // Không ném: đó là kết quả nghiệp vụ (hết buổi / ngoài phạm vi / quyền đang bảo lưu / buổi chưa ghim giáo trình). Chỉ để lại dấu vết cho người vận hành.
    console.warn(`[so-cai-quyen-hoc] buổi ${p.sessionId}: ${tomTatKetQuaDongBo(soCai)}`, soCai.khongGhiDuoc);
  }
  return kq;
}
