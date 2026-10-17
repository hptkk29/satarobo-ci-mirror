import "server-only";
import { db } from "@/lib/db";
import { withMakeupException } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { ENROLLMENT_ACTIVE_STATUS_LIST } from "@/lib/enrollment-status";
import { CHON_HO_SO_BAO_LUU, laDangBaoLuuTheoQuyChe } from "@/lib/bao-luu/roster";
import { soBuoiTheoLoTrinh } from "@/lib/lms/session-order";
import { nhanChuaToiLuot, xetBuoiDuocHoc } from "@/lib/orders/buoi-duoc-hoc";
import { docKetQuaBuoi } from "@/lib/hoc-bu/ket-qua-buoi-db";
import { gonKetQua, khoaCapBuoi, type KetQuaBuoiGon } from "@/lib/hoc-bu/ket-qua-buoi";

// Roster điểm danh của 1 buổi (ClassSession) — tách từ attendance/page.tsx để
// trang chi tiết lớp đa-tab (FL-R2 W4 R2-CLASS-1) nhúng AttendanceGrid mà KHÔNG
// dựng lại logic enrollments + học bù liên cơ sở. Mô hình null-row: mọi HV đã ghi
// danh đều có dòng; `existing: null` = chưa điểm danh (không tạo bản ghi PENDING).

export type AttendanceRosterRow = {
  studentId: string;
  studentName: string;
  studentPhone: string | null;
  enrollmentStatus: string;
  existing: {
    id: string;
    status: "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "ABSENT_EXCUSED" | "ABSENT_UNEXCUSED";
    note: string | null;
    makeupStatus: "NONE" | "NEEDS_MAKEUP" | "MADE_UP";
    absenceReason: string | null;
  } | null;
  // R7-08 — HS học bù LIÊN CƠ SỞ: chỉ hiện trong đúng buổi này, KHÔNG lộ hồ sơ.
  makeupFromCenter?: string | null;
  /**
   * `null` = được học buổi này. Chuỗi = LÝ DO chưa tới lượt [28/09/2026].
   *
   * Học viên mua ít hơn cả khoá học các buổi CUỐI (`Enrollment.buoiBatDau`). Buổi trước
   * mốc ấy: **vẫn hiện tên**, kèm lý do, nhưng KHÔNG điểm danh được.
   *
   * 🔴 VÌ SAO HIỆN CHỨ KHÔNG ẨN (luật 12): ẩn trắng là để giáo viên tự đoán vì sao thiếu
   * người — họ sẽ nghĩ hệ thống lỗi, hoặc nghĩ em đó đã nghỉ học. Và buổi sẽ không bao
   * giờ "đủ sĩ số" nếu em ấy nằm trong mẫu số mà không có cách chấm.
   */
  chuaToiLuot: string | null;
  /**
   * T08 — kết quả HỌC BÙ của buổi này với học viên này, đọc qua MÔ HÌNH ĐỌC DUY NHẤT (`lib/hoc-bu/ket-qua-buoi.ts`). `null` = không có dòng cần bù.
   * Điểm danh gốc (`existing.status`) KHÔNG đổi vì học bù — đây là phần THÊM ("Vắng có phép" + "✓ Đã học bù ngày …"). BẮT BUỘC khai: nhánh nào
   * quên khai là lỗi biên dịch chứ không phải một dòng lặng lẽ không hiện kết quả bù.
   */
  ketQuaBu: KetQuaBuoiGon | null;
};

export type SessionAttendanceRoster = {
  session: { id: string; date: Date; topic: string | null; className: string } | null;
  rows: AttendanceRosterRow[];
};

/**
 * Dựng roster điểm danh cho 1 buổi. KHÔNG tự kiểm tra scope cơ sở — caller PHẢI
 * xác minh `sessionId` thuộc lớp trong tầm nhìn actor trước (chống IDOR). `actor`
 * dùng cho exception đọc HS học bù liên cơ sở (withMakeupException).
 */
export async function buildSessionAttendanceRows(
  actor: Actor,
  sessionId: string,
): Promise<SessionAttendanceRoster> {
  const sess = await db.classSession.findFirst({
    where: { id: sessionId },
    include: {
      class: {
        select: {
          id: true,
          name: true,
          enrollments: {
            // `student: { deletedAt: null }` là hàng rào 2 (07/08): cascade lúc xoá HV đã
            // hạ status, nhưng roster này nuôi CẢ điểm danh admin lẫn site GV và còn là
            // guard chống ghi attendance ngoài danh sách — dữ liệu hỏng sẵn không được lọt.
            where: {
              status: { in: ENROLLMENT_ACTIVE_STATUS_LIST },
              deletedAt: null,
              student: { deletedAt: null },
            },
            select: {
              status: true,
              // Phạm vi buổi đã đăng ký — `null` = đủ khoá (mọi ghi danh trước 28/09).
              buoiBatDau: true,
              // Bảo lưu theo quy chế (BR-13): em nằm trong khoảng bảo lưu TẠI NGÀY CỦA BUỔI này thì không vào điểm danh.
              // Lọc ở dưới theo `sess.date` (ngày buổi chỉ biết sau truy vấn này) — buổi TRƯỚC khi bảo lưu vẫn hiện em.
              ...CHON_HO_SO_BAO_LUU,
              student: { select: { id: true, name: true, phone: true } },
            },
            orderBy: { student: { name: "asc" } },
          },
        },
      },
      // Hai nguồn suy "buổi thứ mấy của LỘ TRÌNH" — đúng thang fallback của
      // `soBuoiTheoLoTrinh`. Phải là lộ trình chứ không phải lịch: lớp dời ngày thì số
      // theo lịch đổi, số theo giáo trình giữ nguyên (sự cố 07/09).
      plan: { select: { order: true } },
      lesson: { select: { order: true } },
      attendances: {
        select: {
          id: true,
          studentId: true,
          status: true,
          note: true,
          makeupStatus: true,
          absenceReason: true,
        },
      },
    },
  });
  if (!sess) return { session: null, rows: [] };

  const existingMap = new Map(sess.attendances.map((a) => [a.studentId, a]));
  // MỘT lần cho cả buổi — số buổi theo LỘ TRÌNH không phụ thuộc học viên nào.
  const soBuoiLoTrinh = soBuoiTheoLoTrinh({
    planOrder: sess.plan?.order ?? null,
    lessonOrder: sess.lesson?.order ?? null,
  });
  const rows: AttendanceRosterRow[] = sess.class.enrollments
    .filter((enr) => !laDangBaoLuuTheoQuyChe(enr, sess.date))
    .map((enr) => {
    const existing = existingMap.get(enr.student.id);
    const xet = xetBuoiDuocHoc({ buoiBatDau: enr.buoiBatDau, soBuoiLoTrinh });
    return {
      studentId: enr.student.id,
      studentName: enr.student.name,
      studentPhone: enr.student.phone,
      enrollmentStatus: enr.status,
      chuaToiLuot:
        xet.duocHoc || enr.buoiBatDau === null
          ? null
          : nhanChuaToiLuot({ buoiBatDau: enr.buoiBatDau }),
      ketQuaBu: null, // điền một lượt cho cả buổi ở dưới (không N+1)
      existing: existing
        ? {
            id: existing.id,
            status: existing.status,
            note: existing.note,
            makeupStatus: existing.makeupStatus,
            absenceReason: existing.absenceReason,
          }
        : null,
    };
  });

  // R7-08 (AC4) — HS được xếp HỌC BÙ vào buổi này (có thể từ cơ sở khác). GV lớp
  // đích thấy HS bù trong ĐÚNG buổi này + badge "Học bù từ <CS>"; KHÔNG lộ hồ sơ.
  const xdb = withMakeupException(actor);
  const guests = await xdb.makeupNeed.findMany({
    where: { makeupSessionId: sessionId, status: "SCHEDULED" },
    select: { studentId: true, centerId: true, student: { select: { name: true } } },
  });
  const enrolledIds = new Set(rows.map((r) => r.studentId));
  const visitors = guests.filter((g) => !enrolledIds.has(g.studentId));
  if (visitors.length > 0) {
    const centerIds = [...new Set(visitors.map((g) => g.centerId).filter(Boolean))] as string[];
    const centers = centerIds.length
      ? await db.center.findMany({
          where: { id: { in: centerIds } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const centerName = new Map(centers.map((c) => [c.id, c.code ?? c.name]));
    for (const g of visitors) {
      const existing = existingMap.get(g.studentId);
      rows.push({
        studentId: g.studentId,
        studentName: g.student.name,
        studentPhone: null, // T5 hẹp — không lộ hồ sơ HS cơ sở khác
        enrollmentStatus: "MAKEUP",
        existing: existing
          ? {
              id: existing.id,
              status: existing.status,
              note: existing.note,
              makeupStatus: existing.makeupStatus,
              absenceReason: existing.absenceReason,
            }
          : null,
        makeupFromCenter: (g.centerId && centerName.get(g.centerId)) || "cơ sở khác",
        // Học bù liên cơ sở: buổi này là buổi ĐƯỢC XẾP cho em, nên luật phạm vi không áp.
        // Ghi rõ thay vì để `undefined` — trường bắt buộc thì mọi nhánh phải tự khai.
        chuaToiLuot: null,
        // Buổi này là buổi học bù của em (luồng cũ), không phải buổi em vắng ⇒ không có kết quả bù của "buổi gốc" để hiện.
        ketQuaBu: null,
      });
    }
  }

  // T08 — MỘT truy vấn cho cả buổi: học viên ĐANG HỌC lớp này mà có điểm danh vắng ở đúng buổi này. `db` trần vì roster nuôi cả site GV
  // (cùng lý do với phần học bù liên cơ sở ở trên); `rows` đã là roster hợp lệ của buổi.
  const canXet = rows.filter((r) => r.enrollmentStatus !== "MAKEUP" && r.existing !== null && r.existing.makeupStatus !== "NONE");
  if (canXet.length > 0) {
    const kq = await docKetQuaBuoi(
      db,
      canXet.map((r) => ({ sessionId, studentId: r.studentId })),
    );
    for (const r of canXet) r.ketQuaBu = gonKetQua(kq.get(khoaCapBuoi(sessionId, r.studentId)));
  }

  return {
    session: { id: sess.id, date: sess.date, topic: sess.topic, className: sess.class.name },
    rows,
  };
}

/**
 * SEC-M02 — Tập studentId HỢP LỆ của buổi = ROSTER hiển thị (enrolled active trong lớp
 * ∪ HS học bù có MakeupNeed SCHEDULED vào buổi này, kể cả liên cơ sở). TÁI DÙNG
 * buildSessionAttendanceRows để không lệch với roster đang hiển thị. Dùng để chặn
 * upsert attendance/feedback với studentId ngoài roster (chống inject thông báo giả).
 * Trả về set RỖNG nếu session không tồn tại.
 */
export async function getSessionRosterStudentIds(
  actor: Actor,
  sessionId: string,
): Promise<Set<string>> {
  const { rows } = await buildSessionAttendanceRows(actor, sessionId);
  // 🔴 LOẠI học viên CHƯA TỚI LƯỢT [28/09/2026].
  //
  // Đây là cổng GHI: nó chặn upsert điểm danh/nhận xét cho `studentId` ngoài roster. Em
  // mua 24 buổi thì buổi 1–24 không phải buổi của em — ghi điểm danh vào đó là ghi một
  // buổi em không trả tiền, và nó sẽ đi thẳng vào học bạ lẫn báo cáo chuyên cần.
  //
  // ⚠️ Cố ý KHÁC `rows`: hàng vẫn HIỆN trên màn (kèm lý do, không chấm được) nhưng không
  // nằm trong tập ghi được. Hai câu hỏi khác nhau — "bày ai ra" và "cho ghi cho ai" —
  // nên hai tập khác nhau. Trả cùng một tập là phải chọn: hoặc ẩn người (giáo viên tự
  // đoán vì sao thiếu), hoặc cho ghi (thủng cổng).
  return new Set(rows.filter((r) => r.chuaToiLuot === null).map((r) => r.studentId));
}

/**
 * Bản ghi điểm danh HIỆN CÓ của một buổi, theo học viên — đọc bằng `db` TRẦN.
 *
 * ⚠️ Vì sao không dùng `scopedDb`/`withMakeupException`: `Attendance` ∈ SCOPED_MODELS
 * nhưng KHÔNG ∈ MAKEUP_EXCEPTION_MODELS, nên cả hai đường đều chèn
 * `centerId IN visibleCenterIds`. Giáo viên cơ sở CS1 dạy thay một buổi của CS2 sẽ đọc
 * ra RỖNG — và chỗ gọi (đường lưu điểm danh) hiểu "rỗng" là "chưa có gì", rồi ghi đè
 * `makeupStatus`/`absenceReason` bằng giá trị suy ra ⇒ học viên đã học bù xong tụt về
 * "cần bù" và lý do phụ huynh xin nghỉ bị xoá. Chính roster hiển thị ngay trên màn hình
 * cũng đọc bằng `db` trần vì lý do này.
 *
 * Cách ly: giống buildSessionAttendanceRows — caller PHẢI xác minh quyền trên `sessionId`
 * trước (isSessionOwnedByTeacher / canManageSessionClass).
 */
export async function getExistingAttendanceByStudent(
  sessionId: string,
  studentIds: string[],
): Promise<
  Map<string, { makeupStatus: string; absenceReason: string | null; status: string }>
> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.attendance.findMany({
    where: { sessionId, studentId: { in: studentIds } },
    select: { studentId: true, status: true, makeupStatus: true, absenceReason: true },
  });
  return new Map(
    rows.map((r) => [
      r.studentId,
      { status: r.status, makeupStatus: r.makeupStatus, absenceReason: r.absenceReason },
    ]),
  );
}
