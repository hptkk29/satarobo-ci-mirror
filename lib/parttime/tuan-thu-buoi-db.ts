// lib/parttime/tuan-thu-buoi-db.ts — ĐỌC đầu vào tuân thủ buổi dạy theo LÔ cho một danh sách bằng chứng P4 (đã lọc theo quyền ở nơi gọi).
// Số câu tra KHÔNG phụ thuộc số buổi (`[TT-DB-Q]`). Chỉ đọc — không ghi bảng nào.
//
// Nguồn (21-TEACHING-SESSION-COMPLIANCE.md §1–§2):
//   · Lớp: sĩ số = tập GHI ĐƯỢC của `getSessionRosterStudentIds` (ghi danh đang học, trừ bảo lưu theo quy chế tại ngày buổi, trừ em chưa tới
//     lượt, cộng học viên học bù luồng cũ xếp vào buổi) — ca `[TT-DB-PAR]` so hai tập trên DB thật. Điểm danh = `Attendance`; nhận xét =
//     `StudentSessionFeedback` (tác giả `createdById`). Nhận xét CHUNG (`ClassSession.classComment`) KHÔNG được đọc ở đây.
//   · Học bù: sĩ số = bé của case trừ REMOVED; điểm danh = `MakeupCaseParticipant.attendanceStatus` ≠ PENDING; nhận xét = phiếu trên mục.
//   · Trial: không có đường ghi của GV ⇒ `hocVien: null`.
// `db` trần (B6): `Attendance` thuộc SCOPED_MODELS — GV dạy thay khác cơ sở đọc qua scopedDb ra RỖNG.
import "server-only";
import { db } from "@/lib/db";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { CHON_HO_SO_BAO_LUU, laDangBaoLuuTheoQuyChe } from "@/lib/bao-luu/roster";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { xetBuoiDuocHoc } from "@/lib/orders/buoi-duoc-hoc";
import { FEEDBACK_ATTENDED_STATUSES } from "@/lib/lms/session-feedback-roster";
import type { BangChungPhanCong } from "./bang-chung-cong";
import { CHON_MUC_NHAN_XET_BU, KET_QUA_MUC_CO_MAT, mucNhanXetBu, nhanXetHocBuTheoBe } from "./nhan-xet-hoc-bu";
import type { DichHoSo } from "./nhan-tuan-thu";
import { danhGiaTuanThu, type HocVienCuaBuoi, type TuanThuBuoi } from "./tuan-thu-buoi";

const CO_MAT_LOP = new Set<string>(FEEDBACK_ATTENDED_STATUSES);
const mocVn = (ymd: string, hhmm: string) => new Date(`${ymd}T${hhmm}:00+07:00`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Sĩ số GHI ĐƯỢC của từng buổi lớp (theo lô). Khớp `getSessionRosterStudentIds` — giữ hai nơi cùng luật bằng `[TT-DB-PAR]`. */
export async function siSoGhiDuocTheoBuoi(sessionIds: readonly string[]): Promise<Map<string, string[]>> {
  const ra = new Map<string, string[]>();
  if (!sessionIds.length) return ra;
  const [buoi, khach] = await Promise.all([
    db.classSession.findMany({
      where: { id: { in: [...sessionIds] } },
      select: { id: true, classId: true, date: true, plan: { select: { order: true } }, lesson: { select: { order: true } } },
    }),
    db.makeupNeed.findMany({ where: { makeupSessionId: { in: [...sessionIds] }, status: "SCHEDULED" }, select: { makeupSessionId: true, studentId: true } }),
  ]);
  const lopIds = [...new Set(buoi.map((b) => b.classId))];
  const ghiDanh = lopIds.length
    ? await db.enrollment.findMany({
        where: { classId: { in: lopIds }, status: { in: ENROLLMENT_ACTIVE_STATUS_LIST }, deletedAt: null, student: { deletedAt: null } },
        select: { classId: true, studentId: true, buoiBatDau: true, ...CHON_HO_SO_BAO_LUU },
      })
    : [];
  for (const b of buoi) {
    const soBuoiLoTrinh = soBuoiTheoLoTrinh({ planOrder: b.plan?.order ?? null, lessonOrder: b.lesson?.order ?? null });
    const ids = new Set<string>();
    for (const e of ghiDanh) {
      if (e.classId !== b.classId || laDangBaoLuuTheoQuyChe(e, b.date)) continue;
      if (e.buoiBatDau !== null && !xetBuoiDuocHoc({ buoiBatDau: e.buoiBatDau, soBuoiLoTrinh }).duocHoc) continue;
      ids.add(e.studentId);
    }
    for (const k of khach) if (k.makeupSessionId === b.id) ids.add(k.studentId);
    ra.set(b.id, [...ids]);
  }
  return ra;
}

/** Tuân thủ cho từng phân công (khoá = assignmentId). */
export async function docTuanThu(bcs: readonly BangChungPhanCong[], now: Date): Promise<Map<string, TuanThuBuoi>> {
  const ra = new Map<string, TuanThuBuoi>();
  if (!bcs.length) return ra;
  const ids = bcs.map((b) => b.assignmentId);
  const lopIds = [...new Set(bcs.filter((b) => b.sourceType === "CLASS_SESSION").map((b) => b.sourceId))];
  const buIds = [...new Set(bcs.filter((b) => b.sourceType === "MAKEUP_CASE").map((b) => b.sourceId))];
  const [pcs, siSo, diemDanh, nhanXet, beBu, mucBu] = await Promise.all([
    db.sessionStaffAssignment.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, ngay: true, gioBatDau: true, gioKetThuc: true, acceptances: { where: { decision: "ACCEPTED" }, select: { assignmentVersion: true } } },
    }),
    siSoGhiDuocTheoBuoi(lopIds),
    lopIds.length ? db.attendance.findMany({ where: { sessionId: { in: lopIds } }, select: { sessionId: true, studentId: true, status: true } }) : [],
    lopIds.length
      ? db.studentSessionFeedback.findMany({ where: { classSessionId: { in: lopIds } }, select: { classSessionId: true, studentId: true, createdAt: true, createdById: true } })
      : [],
    buIds.length ? db.makeupCaseParticipant.findMany({ where: { caseId: { in: buIds } }, select: { caseId: true, studentId: true, attendanceStatus: true } }) : [],
    buIds.length ? db.makeupCaseStudent.findMany({ where: { caseId: { in: buIds }, result: { in: [...KET_QUA_MUC_CO_MAT] } }, select: CHON_MUC_NHAN_XET_BU }) : [],
  ]);
  const pcTheoId = new Map(pcs.map((p) => [p.id, p]));

  const hocVienCua = (b: BangChungPhanCong): HocVienCuaBuoi | null => {
    if (b.sourceType === "CLASS_SESSION") {
      const dd = diemDanh.filter((a) => a.sessionId === b.sourceId);
      return {
        siSo: siSo.get(b.sourceId) ?? [],
        daDiemDanh: dd.map((a) => a.studentId),
        coMat: dd.filter((a) => CO_MAT_LOP.has(a.status)).map((a) => a.studentId),
        nhanXet: nhanXet.filter((n) => n.classSessionId === b.sourceId).map((n) => ({ studentId: n.studentId, createdAt: n.createdAt, tacGia: n.createdById })),
      };
    }
    if (b.sourceType === "MAKEUP_CASE") {
      const be = beBu.filter((x) => x.caseId === b.sourceId && x.attendanceStatus !== "REMOVED");
      const coMatBe = new Set(be.filter((x) => x.attendanceStatus === "PRESENT").map((x) => x.studentId));
      const phieu = nhanXetHocBuTheoBe(mucBu.filter((m) => m.caseId === b.sourceId).map(mucNhanXetBu));
      return {
        siSo: be.map((x) => x.studentId),
        daDiemDanh: be.filter((x) => x.attendanceStatus !== "PENDING").map((x) => x.studentId),
        coMat: phieu.coMat.filter((id) => coMatBe.has(id)),
        nhanXet: phieu.nhanXet,
      };
    }
    return null; // TRIAL_SESSION — GV không có đường ghi điểm danh / nhận xét trial
  };

  for (const b of bcs) {
    const pc = pcTheoId.get(b.assignmentId);
    if (!pc) continue;
    const ngay = ymd(pc.ngay);
    ra.set(
      b.assignmentId,
      danhGiaTuanThu({
        bc: b,
        trangThaiPhanCong: pc.status,
        daNhanPhienBanCu: pc.acceptances.some((x) => x.assignmentVersion < b.assignmentVersion),
        batDau: mocVn(ngay, pc.gioBatDau),
        ketThuc: mocVn(ngay, pc.gioKetThuc),
        hocVien: hocVienCua(b),
        now,
      }),
    );
  }
  return ra;
}

/**
 * Đích lối tắt điểm danh / nhận xét cho từng phân công (một câu tra).
 * R-TT-1 (bản phát hành từ `main`): `main` CHƯA có màn "Dạy thay" (`/teacher/day-thay`, `laNguoiDayThay` — chỉ ở `test`). Người dạy
 * thay trên `main` điểm danh ở `/teacher/lop?classId=&sessionId=` (nhánh (c) gác bằng `isSessionOwnedByTeacher` — xét cả
 * `substituteTeacherId` / `actualTeacherId`) và nhận xét qua `/teacher/lop?tab=nhan-xet` ⇒ `/teacher/nhan-xet` ⇒ `dayThay: false`.
 * Gộp `test` → `main` sau này: lấy bản `test` (dùng `laNguoiDayThay`).
 */
export async function docDichHoSo(bcs: readonly BangChungPhanCong[]): Promise<Map<string, DichHoSo>> {
  const ra = new Map<string, DichHoSo>();
  const lopIds = [...new Set(bcs.filter((b) => b.sourceType === "CLASS_SESSION").map((b) => b.sourceId))];
  const buoi = lopIds.length
    ? await db.classSession.findMany({
        where: { id: { in: lopIds } },
        select: { id: true, classId: true, actualTeacherId: true, substituteTeacherId: true, class: { select: { teacherId: true } } },
      })
    : [];
  const theoId = new Map(buoi.map((b) => [b.id, b]));
  for (const b of bcs) {
    if (b.sourceType === "MAKEUP_CASE") ra.set(b.assignmentId, { loai: "BU", caseId: b.sourceId });
    const s = b.sourceType === "CLASS_SESSION" ? theoId.get(b.sourceId) : undefined;
    if (s) ra.set(b.assignmentId, { loai: "LOP", sessionId: s.id, classId: s.classId, dayThay: false });
  }
  return ra;
}
