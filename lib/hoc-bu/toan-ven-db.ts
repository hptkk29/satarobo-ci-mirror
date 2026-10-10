import "server-only";
import type { Prisma } from "@prisma/client";
import { rosterWhere } from "@/lib/enrollment-scope";
import { KHOAN_DA_GHI_NHAN } from "@/lib/finance/ghi-nhan";
import { rowsToSlots } from "@/lib/lms/schedule-conflict";
import { vnDateAt, vnYmd } from "@/lib/time/vn";
import type {
  AttendanceRow,
  BangChungDiemDanh,
  CaseRow,
  DonPhHuyMo,
  DonPhi,
  DonPhiMoCoi,
  NeedRow,
  NhomBuoiTrung,
  NhomBuoiTrungNgay,
  SessionRef,
  SessionSlot,
  Snapshot,
  VangChuaCoDong,
} from "@/lib/hoc-bu/toan-ven";

// NỬA ĐỌC của checker toàn vẹn học bù (T01). Chỉ ĐỌC; người gọi bọc trong transaction
// `READ ONLY` (xem `scripts/kiem-hoc-bu.ts`) nên một lời gọi ghi lỡ gõ vào đây bị Postgres từ chối.
//
// ⚠️ Cố ý KHÔNG lọc theo `scopedDb`: checker là công cụ vận hành chạy bằng user chỉ-đọc, cần
// nhìn THẤY MỌI cơ sở. Nó không bao giờ chạy trong ngữ cảnh một người dùng ứng dụng.
//
// ⚠️ SOFT DELETE: `Order`, `Payment`, `Enrollment` bị tầng base tự chèn `deletedAt: null` vào mọi
// câu đọc cấp cao nhất. Chỗ nào cần NHÌN THẤY bản ghi đã xoá (đơn phí bị xoá) thì lấy qua quan hệ
// lồng — Prisma không hook được quan hệ lồng — hoặc truyền `deletedAt` tường minh.

type Tx = Prisma.TransactionClient;

/** Cắt mảng để `IN (...)` không vượt giới hạn tham số của Postgres. */
function chia<T>(xs: readonly T[], co = 5000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += co) out.push(xs.slice(i, i + co));
  return out;
}

async function gop<T, K>(xs: readonly K[], doc: (phan: K[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const phan of chia(xs)) out.push(...(await doc(phan)));
  return out;
}

const uniq = <T>(xs: readonly (T | null | undefined)[]): T[] => [...new Set(xs.filter((x): x is T => x != null))];

export async function docSnapshot(tx: Tx, o: { now: Date; tuNgayYmd: string }): Promise<Snapshot> {
  // ── 1. Dòng cần bù ────────────────────────────────────────────────────────────────────────
  const needsTho = await tx.makeupNeed.findMany({
    select: {
      id: true,
      studentId: true,
      classId: true,
      centerId: true,
      missedSessionId: true,
      missedLessonId: true,
      status: true,
      makeupSessionId: true,
      usedQuota: true,
      waivedAt: true,
      feeOrderItemId: true,
      freeApprovedAt: true,
      createdAt: true,
      completedAt: true,
      student: { select: { name: true } },
      class: {
        select: {
          name: true,
          centerId: true,
          status: true,
          deletedAt: true,
          courseId: true,
          course: { select: { choPhepHocBu: true } },
        },
      },
    },
  });
  const needs: NeedRow[] = needsTho.map((n) => ({
    id: n.id,
    studentId: n.studentId,
    studentName: n.student.name,
    classId: n.classId,
    className: n.class.name,
    courseId: n.class.courseId,
    choPhepHocBu: n.class.course.choPhepHocBu,
    lopDaXoa: n.class.deletedAt !== null,
    lopDaHuy: n.class.status === "CANCELLED",
    // Cơ sở HIỆU LỰC — cùng phép với đường xếp case (`danh-sach-db.ts`: `n.centerId ?? n.class.centerId`).
    // Cột thô của dòng có thể NULL (các đường tạo cũ cho phép) mà case vẫn lấy cơ sở của lớp; so cột thô
    // sẽ báo "lệch cơ sở" cho mọi dòng như vậy.
    centerId: n.centerId ?? n.class.centerId,
    missedSessionId: n.missedSessionId,
    missedLessonId: n.missedLessonId,
    status: n.status,
    makeupSessionId: n.makeupSessionId,
    usedQuota: n.usedQuota,
    waivedAt: n.waivedAt,
    feeOrderItemId: n.feeOrderItemId,
    freeApprovedAt: n.freeApprovedAt,
    createdAt: n.createdAt,
    completedAt: n.completedAt,
  }));

  // ── 2. Case + bé trong case ───────────────────────────────────────────────────────────────
  const casesTho = await tx.makeupCase.findMany({
    select: {
      id: true,
      centerId: true,
      courseId: true,
      lessonId: true,
      date: true,
      startTime: true,
      endTime: true,
      roomId: true,
      teacherId: true,
      status: true,
      students: { select: { id: true, makeupNeedId: true, status: true, dungLuot: true } },
    },
  });
  const cases: CaseRow[] = casesTho;

  // ── 3. Tham chiếu không có khoá ngoại ────────────────────────────────────────────────────
  const buoiIds = uniq(needs.map((n) => n.missedSessionId));
  const buoiTho = await gop(buoiIds, (phan) =>
    tx.classSession.findMany({
      where: { id: { in: phan } },
      select: { id: true, classId: true, date: true, lessonId: true, status: true },
    }),
  );
  const buoiGoc: SessionRef[] = buoiTho;

  const lessonIds = uniq([...needs.map((n) => n.missedLessonId), ...cases.map((c) => c.lessonId), ...buoiGoc.map((b) => b.lessonId)]);
  const lessonIdsConTon = new Set(
    (await gop(lessonIds, (phan) => tx.lesson.findMany({ where: { id: { in: phan } }, select: { id: true } }))).map((l) => l.id),
  );
  const roomIds = uniq(cases.map((c) => c.roomId));
  const roomIdsConTon = new Set(
    (await gop(roomIds, (phan) => tx.room.findMany({ where: { id: { in: phan } }, select: { id: true } }))).map((r) => r.id),
  );
  const courseIds = uniq(cases.map((c) => c.courseId));
  const courseIdsConTon = new Set(
    (await gop(courseIds, (phan) => tx.course.findMany({ where: { id: { in: phan } }, select: { id: true } }))).map((c) => c.id),
  );
  const teacherIds = uniq(cases.map((c) => c.teacherId));
  const gvHoatDong = new Map(
    (await gop(teacherIds, (phan) => tx.user.findMany({ where: { id: { in: phan } }, select: { id: true, isActive: true } }))).map((u) => [u.id, u.isActive]),
  );

  // ── 4. Điểm danh gốc của các dòng ────────────────────────────────────────────────────────
  const studentIds = uniq(needs.map((n) => n.studentId));
  const cap = new Set(needs.map((n) => `${n.studentId}|${n.missedSessionId}`));
  const diemDanh: AttendanceRow[] = (
    await gop(buoiIds, (phan) =>
      tx.attendance.findMany({
        where: { sessionId: { in: phan }, studentId: { in: studentIds.length ? studentIds : ["-"] } },
        select: { sessionId: true, studentId: true, status: true, makeupStatus: true },
      }),
    )
  ).filter((a) => cap.has(`${a.studentId}|${a.sessionId}`));

  // ── 5. Buổi vắng từ mốc, để tìm buổi chưa có dòng ───────────────────────────────────────
  const [ty, tm, td] = o.tuNgayYmd.split("-").map(Number);
  const tuNgay = vnDateAt(ty!, tm! - 1, td!);
  const vangTho = await tx.attendance.findMany({
    where: {
      status: { notIn: ["PRESENT", "LATE"] },
      session: { date: { gte: tuNgay }, status: { not: "CANCELLED" } },
      student: { deletedAt: null },
    },
    select: {
      sessionId: true,
      studentId: true,
      status: true,
      makeupStatus: true,
      student: { select: { name: true } },
      session: {
        select: {
          date: true,
          class: { select: { name: true, deletedAt: true, course: { select: { choPhepHocBu: true } } } },
        },
      },
    },
  });
  const vangChuaCoDong: VangChuaCoDong[] = vangTho.map((v) => ({
    sessionId: v.sessionId,
    studentId: v.studentId,
    studentName: v.student.name,
    className: v.session.class.name,
    status: v.status,
    makeupStatus: v.makeupStatus,
    ngayVn: vnYmd(v.session.date),
    choPhepHocBu: v.session.class.course.choPhepHocBu,
    lopDaXoa: v.session.class.deletedAt !== null,
  }));

  // ── 6. Phí ───────────────────────────────────────────────────────────────────────────────
  const feeIds = uniq(needs.map((n) => n.feeOrderItemId));
  const feeTho = await gop(feeIds, (phan) =>
    tx.orderItem.findMany({
      where: { id: { in: phan } },
      select: { id: true, order: { select: { id: true, code: true, status: true, deletedAt: true, totalAmount: true } } },
    }),
  );
  const moCoiTho = await tx.orderItem.findMany({
    where: { type: "MAKEUP_FEE" },
    select: {
      id: true,
      itemName: true,
      studentId: true,
      order: { select: { id: true, code: true, status: true, deletedAt: true, totalAmount: true } },
    },
  });
  const orderIds = uniq([...feeTho.map((f) => f.order.id), ...moCoiTho.map((f) => f.order.id)]);
  const thu = new Map(
    (
      await gop(orderIds, (phan) =>
        tx.payment.groupBy({
          by: ["orderId"],
          where: { orderId: { in: phan }, ...KHOAN_DA_GHI_NHAN },
          _sum: { amount: true },
        }),
      )
    ).map((r) => [r.orderId, r._sum.amount ?? 0]),
  );
  const donPhi: DonPhi[] = feeTho.map((f) => ({
    itemId: f.id,
    orderId: f.order.id,
    orderCode: f.order.code,
    orderStatus: f.order.status,
    orderDaXoa: f.order.deletedAt !== null,
    tongTien: f.order.totalAmount,
    daThu: thu.get(f.order.id) ?? 0,
  }));
  const donPhiMoCoi: DonPhiMoCoi[] = moCoiTho.map((f) => ({
    itemId: f.id,
    orderId: f.order.id,
    orderCode: f.order.code,
    orderStatus: f.order.status,
    orderDaXoa: f.order.deletedAt !== null,
    tongTien: f.order.totalAmount,
    daThu: thu.get(f.order.id) ?? 0,
    hocVienId: f.studentId,
    tenDong: f.itemName,
  }));

  // ── 7. Đơn xin bù của phụ huynh ──────────────────────────────────────────────────────────
  const donPh: DonPhHuyMo[] = await tx.parentRequest.findMany({
    // Chỉ PENDING: APPROVED là trạng thái cuối, không còn đường đóng, và trần 10 đơn chỉ đếm PENDING.
    where: { type: "MAKEUP", status: "PENDING" },
    select: { id: true, studentId: true, sessionId: true, status: true },
  });

  // ── 8. Buổi lớp trùng ────────────────────────────────────────────────────────────────────
  const trung = await tx.$queryRaw<
    {
      classId: string;
      luc: Date;
      id: string;
      trangThai: string;
      soDiemDanh: bigint;
      soNhanXet: bigint;
      soThamChieu: bigint;
      taoLuc: Date;
    }[]
  >`
    SELECT s."classId", s."date" AS "luc", s."id", s."status"::text AS "trangThai",
           (SELECT count(*) FROM "Attendance" a WHERE a."sessionId" = s."id") AS "soDiemDanh",
           (SELECT count(*) FROM "StudentSessionFeedback" f WHERE f."classSessionId" = s."id") AS "soNhanXet",
           (
             (SELECT count(*) FROM "StudentSkillAssessment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "Assignment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "ClassSessionMedia" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "HomeworkAssignment" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "EvalResponse" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "MediaAsset" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "SessionMediaReview" x WHERE x."classSessionId" = s."id")
             + (SELECT count(*) FROM "ParentRequest" x WHERE x."sessionId" = s."id")
             + (SELECT count(*) FROM "MakeupNeed" x WHERE x."missedSessionId" = s."id" OR x."makeupSessionId" = s."id")
             + (SELECT count(*) FROM "Attendance" x WHERE x."makeupSessionId" = s."id")
           ) AS "soThamChieu",
           s."createdAt" AS "taoLuc"
    FROM "ClassSession" s
    WHERE s."status" <> 'CANCELLED'
      AND EXISTS (
        SELECT 1 FROM "ClassSession" t
        WHERE t."classId" = s."classId" AND t."date" = s."date" AND t."status" <> 'CANCELLED' AND t."id" <> s."id"
      )
    ORDER BY s."classId", s."date", s."createdAt"
  `;
  // T03: KHÔNG còn `JOIN "Class" … deletedAt IS NULL`. Đúng vị từ của chỉ mục duy nhất `ClassSession_class_date_active_key`
  // (không biết lớp đã xoá mềm): "báo cáo sạch" nay đồng nghĩa "tạo được chỉ mục". Bản cũ bỏ qua buổi trùng của lớp đã
  // xoá mềm — migration vẫn phát hiện ra chúng và BỎ QUA việc tạo chỉ mục, mà báo cáo thì nói sạch.
  const nhom = new Map<string, NhomBuoiTrung>();
  for (const r of trung) {
    const k = `${r.classId}|${r.luc.toISOString()}`;
    const g = nhom.get(k) ?? { classId: r.classId, luc: r.luc.toISOString(), buoi: [] };
    g.buoi.push({
      id: r.id,
      soDiemDanh: Number(r.soDiemDanh),
      soNhanXet: Number(r.soNhanXet),
      soThamChieu: Number(r.soThamChieu),
      trangThai: r.trangThai,
      taoLuc: r.taoLuc,
    });
    nhom.set(k, g);
  }
  const buoiTrung = [...nhom.values()];

  const trungNgayTho = await tx.$queryRaw<{ classId: string; ngay: string; ids: string[] }[]>`
    SELECT s."classId",
           to_char((s."date" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS "ngay",
           array_agg(s."id" ORDER BY s."date") AS "ids"
    FROM "ClassSession" s
    JOIN "Class" c ON c."id" = s."classId" AND c."deletedAt" IS NULL
    WHERE s."status" <> 'CANCELLED'
    GROUP BY s."classId", (s."date" AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
    HAVING count(*) > 1 AND count(DISTINCT s."date") > 1
  `;
  const buoiTrungNgay: NhomBuoiTrungNgay[] = trungNgayTho.map((r) => ({
    classId: r.classId,
    ngayVn: r.ngay,
    buoiIds: r.ids,
  }));

  // ── 9. Cửa sổ lịch cho kiểm trùng GV / phòng / học viên ─────────────────────────────────
  const caseXet = cases.filter((c) => c.status !== "CANCELLED" && c.date.toISOString().slice(0, 10) >= o.tuNgayYmd);
  let slotBuoi: SessionSlot[] = [];
  const lopCuaHocVien = new Map<string, string[]>();
  if (caseXet.length > 0) {
    const ngays = caseXet.map((c) => c.date.toISOString().slice(0, 10)).sort();
    const [ay, am, ad] = ngays[0]!.split("-").map(Number);
    const [by, bm, bd] = ngays[ngays.length - 1]!.split("-").map(Number);
    const tu = vnDateAt(ay!, am! - 1, ad!);
    const den = vnDateAt(by!, bm! - 1, bd! + 1);
    const buoiLop = await tx.classSession.findMany({
      where: { date: { gte: tu, lt: den }, status: { not: "CANCELLED" }, class: { deletedAt: null } },
      select: {
        id: true,
        classId: true,
        date: true,
        roomId: true,
        actualRoomId: true,
        actualTeacherId: true,
        substituteRoomId: true,
        substituteTeacherId: true,
        class: { select: { roomId: true, teacherId: true, startTime: true, endTime: true } },
      },
    });
    const slot = rowsToSlots(buoiLop);
    slotBuoi = buoiLop.map((b, i) => ({ ...slot[i]!, id: b.id, classId: b.classId }));

    const needTheoId = new Map(needs.map((n) => [n.id, n]));
    const hocVienTrongCase = uniq(
      caseXet.flatMap((c) => c.students.map((sv) => needTheoId.get(sv.makeupNeedId)?.studentId)),
    );
    const ghiDanh = await gop(hocVienTrongCase, (phan) =>
      tx.enrollment.findMany({
        where: { ...rosterWhere("dang-hoc"), studentId: { in: phan } },
        select: { studentId: true, classId: true },
      }),
    );
    for (const g of ghiDanh) {
      const ds = lopCuaHocVien.get(g.studentId) ?? [];
      ds.push(g.classId);
      lopCuaHocVien.set(g.studentId, ds);
    }
  }

  // ── 10. Bằng chứng trạng thái vắng gốc từ nhật ký audit ─────────────────────────────────
  // Chỉ `attendance.edited` (admin) mang giá trị cũ/mới. Mỗi bản ghi chứa NGUYÊN ảnh chụp cả buổi trước và
  // sau lần sửa, nên với mỗi bé ta giữ CẢ CHUỖI theo thời gian — luật TV-20 tự cắt theo lúc dòng chốt
  // COMPLETED (nhật ký sau đó đã mang trạng thái bị ghi đè) và chỉ tin khi chuỗi đó nhất quán.
  const buoiCanBangChung = uniq(needs.filter((n) => n.status === "COMPLETED").map((n) => n.missedSessionId));
  const audit = await gop(buoiCanBangChung, (phan) =>
    tx.auditLog.findMany({
      where: { entityType: "ClassSession", action: "attendance.edited", entityId: { in: phan } },
      orderBy: { createdAt: "asc" },
      select: { entityId: true, createdAt: true, oldValues: true, newValues: true },
    }),
  );
  const trangThaiTheoBe = (v: unknown): Map<string, string> => {
    const out = new Map<string, string>();
    const ds = (v as { records?: { studentId?: string; status?: string }[] } | null)?.records;
    if (!Array.isArray(ds)) return out;
    for (const r of ds) if (r.studentId && r.status) out.set(r.studentId, r.status);
    return out;
  };
  const bangChungVangGoc = new Map<string, BangChungDiemDanh[]>();
  for (const a of audit) {
    const cu = trangThaiTheoBe(a.oldValues);
    const moi = trangThaiTheoBe(a.newValues);
    for (const studentId of new Set([...cu.keys(), ...moi.keys()])) {
      const k = `${a.entityId}|${studentId}`;
      const ds = bangChungVangGoc.get(k) ?? [];
      ds.push({ luc: a.createdAt, cu: cu.get(studentId) ?? null, moi: moi.get(studentId) ?? null });
      bangChungVangGoc.set(k, ds);
    }
  }

  return {
    needs,
    cases,
    buoiGoc,
    lessonIdsConTon,
    roomIdsConTon,
    courseIdsConTon,
    gvHoatDong,
    diemDanh,
    vangChuaCoDong,
    donPhi,
    donPhiMoCoi,
    donPh,
    buoiTrung,
    buoiTrungNgay,
    slotBuoi,
    lopCuaHocVien,
    bangChungVangGoc,
  };
}
