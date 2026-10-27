import "server-only";
// lib/portal/tien-do-pham-vi-db.ts — ĐỌC dữ liệu để cổng phụ huynh tính tiến độ THEO PHẠM VI. Tệp DUY NHẤT của cổng phụ huynh hỏi cờ.
//
// Tài liệu: docs/thu-hoc-phi-pham-vi/XEP-LOP.md §6, TRANG-THAI-19-10.md hạng mục 5. Phần tính nằm ở `tien-do-pham-vi.ts` (thuần).
//
// ── CỜ: THEO CƠ SỞ CỦA LỚP, FAIL-CLOSED ────────────────────────────────────────────────────────────────────────────
//   `Class.centerId` → `OrgUnit` → `laThuHocPhiTheoPhamViBat`. Cơ sở không có OrgUnit ⇒ TẮT (hỏi cờ bằng `null` sẽ rơi về giá trị TOÀN HỆ và
//   lặng lẽ bỏ qua cờ riêng của cơ sở — cùng cách `docSoCaiDiemDanh`). Cờ TẮT cho mọi lớp ⇒ trả Map rỗng sau đúng các lần đọc cờ, KHÔNG
//   đụng quyền học / buổi / điểm danh: đường cũ chạy nguyên.
//
// ── KHOÁ ────────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Quyền học tra theo (học viên, khoá) rồi LỌC theo cơ sở của lớp (`locTheoCoSo`). Mỗi lượt gọi chỉ nhận MỘT `studentId` đã qua
//   `requireActiveStudent`, nên hai con của một phụ huynh không bao giờ chung một lần đọc. Học viên có HAI lớp đang học cùng một khoá ⇒
//   quyền học không chỉ ra được thuộc lớp nào (con trỏ `classId` của quyền học còn trỏ ghi danh cũ khi chuyển lớp) ⇒ giữ đường cũ cho cả hai.
//
// ── SỐ BÀI ──────────────────────────────────────────────────────────────────────────────────────────────────────────
//   Bài của một buổi = `soBuoiTheoLoTrinh` (plan.order+1, không plan thì lesson.order) — đúng cách sổ cái điểm danh đếm bài. KHÔNG dùng
//   `Lesson.order` trần (buổi bù huỷ-và-tạo-lại mang cùng lessonId) và KHÔNG dùng hạng theo ngày (`soBuoi` của buoi-hoc.ts).
//
// ── `db` TRẦN Ở ĐÂY ─────────────────────────────────────────────────────────────────────────────────────────────────
//   Cùng chỗ với `learning.ts`: helper `lib/portal/*` nhận `studentId` đã qua `requireActiveStudent`; mọi câu hỏi đều neo `studentId`.
//   `StudyEntitlement`/`StudyEntitlementUsage` không có đường sở hữu trong `portalDb` (pass-through).
import { db } from "@/lib/db";
import { docKhoangBaoLuuTheoLop, ngayTrongKhoangBaoLuu } from "@/lib/bao-luu/roster-db";
import { locTheoCoSo } from "@/lib/entitlements/diem-danh-so-cai";
import { demHocVuotTheoQuyen } from "@/lib/entitlements/hoc-vuot-da-hoc";
import { laThuHocPhiTheoPhamViBat } from "@/lib/entitlements/feature";
import type { QuyenHocChoRoster } from "@/lib/entitlements/roster";
import { baiBoQuaTuSo } from "@/lib/entitlements/tieu-thu";
import type { TrangThaiQuyenHoc } from "@/lib/entitlements/trang-thai";
import { ABSENT_STATUSES, type AttendanceStatusValue, type MakeupStatusValue } from "@/lib/labels";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { vnEndOfDay } from "@/lib/time/vn";
import { baiCuaBuoi, type DongDiemDanhPhamVi, type PhamViLop } from "./tien-do-pham-vi";

/** Map rỗng = đường cũ. Khoá = `classId`. */
export type PhamViCuaCon = Map<string, PhamViLop>;

/** Cờ cho từng cơ sở (đọc song song). Cơ sở không có OrgUnit ⇒ `false`. */
async function docCoTheoCoSo(centerIds: readonly string[]): Promise<Map<string, boolean>> {
  const duyNhat = [...new Set(centerIds)];
  const kq = await Promise.all(
    duyNhat.map(async (centerId) => {
      const orgUnitId = await orgUnitIdForCenter(centerId);
      return [centerId, orgUnitId ? await laThuHocPhiTheoPhamViBat(orgUnitId) : false] as const;
    }),
  );
  return new Map(kq);
}

/**
 * Dữ liệu tiến độ theo phạm vi của các lớp mà học viên đang học. `now` do người gọi truyền (luật 19).
 * Lớp nào KHÔNG áp dụng (cờ tắt, không quyền học ACTIVE, hai lớp cùng khoá…) thì KHÔNG có khoá trong Map.
 */
export async function docPhamViChoCon(studentId: string, classIds: readonly string[], now: Date): Promise<PhamViCuaCon> {
  const out: PhamViCuaCon = new Map();
  if (classIds.length === 0) return out;

  const lop = await db.class.findMany({
    where: { id: { in: [...classIds] } },
    select: { id: true, courseId: true, centerId: true },
  });
  const bat = await docCoTheoCoSo(lop.flatMap((l) => (l.centerId ? [l.centerId] : [])));
  const dungCo = lop.filter((l) => l.centerId !== null && bat.get(l.centerId) === true);
  if (dungCo.length === 0) return out;

  // Hai lớp đang học CÙNG MỘT khoá ⇒ không phân được quyền học cho lớp nào.
  const soLopTheoKhoa = new Map<string, number>();
  for (const l of lop) soLopTheoKhoa.set(l.courseId, (soLopTheoKhoa.get(l.courseId) ?? 0) + 1);
  const duDieuKien = dungCo.filter((l) => soLopTheoKhoa.get(l.courseId) === 1);
  if (duDieuKien.length === 0) return out;

  const quyenTho = await db.studyEntitlement.findMany({
    where: {
      studentId,
      courseId: { in: [...new Set(duDieuKien.map((l) => l.courseId))] },
      status: { not: "VOIDED" },
      startLessonOrder: { not: null },
      endLessonOrder: { not: null },
    },
    select: {
      id: true,
      courseId: true,
      centerId: true,
      status: true,
      purchaseSessions: true,
      startLessonOrder: true,
      endLessonOrder: true,
      skippedSessions: true,
      freeMakeupSessions: true,
      graceSessionsGranted: true,
      graceSessionsUsed: true,
      consumedSessions: true,
    },
  });

  const quyenCuaLop = new Map<string, QuyenHocChoRoster[]>();
  for (const l of duDieuKien) {
    const { dung } = locTheoCoSo(
      quyenTho.filter((q) => q.courseId === l.courseId),
      l.centerId!,
    );
    const ds: QuyenHocChoRoster[] = dung.map((q) => ({
      id: q.id,
      status: q.status as TrangThaiQuyenHoc,
      purchaseSessions: q.purchaseSessions,
      startLessonOrder: q.startLessonOrder!,
      endLessonOrder: q.endLessonOrder!,
      baiBoQua: baiBoQuaTuSo(q.startLessonOrder!, q.skippedSessions),
      freeMakeupSessions: q.freeMakeupSessions,
      graceSessionsGranted: q.graceSessionsGranted,
      graceSessionsUsed: q.graceSessionsUsed,
      consumedSessions: q.consumedSessions,
    }));
    // Chưa có quyền ACTIVE ⇒ không cần đọc buổi / điểm danh (`laApDung` sẽ từ chối).
    if (ds.some((q) => q.status === "ACTIVE")) quyenCuaLop.set(l.id, ds);
  }
  const lopCanDoc = duDieuKien.filter((l) => quyenCuaLop.has(l.id));
  if (lopCanDoc.length === 0) return out;

  const idLop = lopCanDoc.map((l) => l.id);
  const hetNgay = vnEndOfDay(now);
  const idQuyen = [...quyenCuaLop.values()].flatMap((ds) => ds.map((q) => q.id));

  const [buoi, diemDanhTho, khoangTheoLop, hocVuotTheoQuyen] = await Promise.all([
    db.classSession.findMany({
      where: { classId: { in: idLop }, status: { not: "CANCELLED" }, date: { lte: hetNgay } },
      select: { classId: true, date: true, plan: { select: { order: true } }, lesson: { select: { order: true } } },
    }),
    db.attendance.findMany({
      where: { studentId, session: { classId: { in: idLop }, status: { not: "CANCELLED" } } },
      select: {
        status: true,
        makeupStatus: true,
        session: { select: { classId: true, date: true, plan: { select: { order: true } }, lesson: { select: { order: true } } } },
      },
    }),
    docKhoangBaoLuuTheoLop(studentId),
    // Sổ cái chỉ được đọc trong lib/entitlements/** (INV-32b, [ENT-USAGE-PIN-01]).
    demHocVuotTheoQuyen(idQuyen),
  ]);
  const hocVuotCua = hocVuotTheoQuyen;

  for (const l of lopCanDoc) {
    const quyenHoc = quyenCuaLop.get(l.id)!;
    const khoang = khoangTheoLop.get(l.id);
    let buoiKhongCoBai = 0;

    const baiDenHetNgay: number[] = [];
    const baiDenBayGio: number[] = [];
    for (const b of buoi) {
      if (b.classId !== l.id) continue;
      const bai = baiCuaBuoi(b);
      if (bai === null) {
        buoiKhongCoBai++;
        continue;
      }
      baiDenHetNgay.push(bai);
      if (b.date.getTime() <= now.getTime() && !ngayTrongKhoangBaoLuu(b.date, khoang)) baiDenBayGio.push(bai);
    }

    const diemDanh: DongDiemDanhPhamVi[] = [];
    const baiVangKhongBu: number[] = [];
    for (const d of diemDanhTho) {
      if (d.session.classId !== l.id) continue;
      const bai = baiCuaBuoi(d.session);
      if (bai === null) {
        buoiKhongCoBai++;
        continue;
      }
      const status = d.status as AttendanceStatusValue;
      const makeupStatus = d.makeupStatus as MakeupStatusValue | null;
      // Cùng định nghĩa `absentNoMakeup` của getStudentClassProgress: vắng và chưa bù xong (kể cả đang chờ bù).
      if (ABSENT_STATUSES.has(status) && makeupStatus !== "MADE_UP") baiVangKhongBu.push(bai);
      if (!ngayTrongKhoangBaoLuu(d.session.date, khoang)) diemDanh.push({ lessonOrder: bai, status, makeupStatus });
    }

    out.set(l.id, {
      classId: l.id,
      courseId: l.courseId,
      quyenHoc,
      baiDenHetNgay,
      baiDenBayGio,
      baiVangKhongBu,
      diemDanh,
      buoiKhongCoBai,
      hocVuot: quyenHoc.reduce((s, q) => s + (hocVuotCua.get(q.id) ?? 0), 0),
    });
  }
  return out;
}
