// lib/bao-luu/dang-bao-luu-db.ts — phần chạm DB của `dangBaoLuu`. PHIÊN 1.
//
// Hai câu hỏi, cùng một nguồn (`StudentReserve` còn hiệu lực — xem `dang-bao-luu.ts`):
//
//   · `dangBaoLuu(enrollmentId, ngay)`         — một ghi danh;
//   · `locDonDangBaoLuu(orderIds, ngay)`       — một LÔ đơn (cho cron nhắc nợ / danh sách quá hạn
//                                                đọc `OrderInstallment`, sổ cũ chỉ có mức ĐƠN).
//
// ⚠️ `db` TRẦN là đúng ở đây, không `scopedDb`: đây là cổng AN TOÀN CHO NGƯỜI NHẬN TIN (phụ huynh
// có bị nhắc nợ trong lúc con nghỉ không). Cron chạy không có actor, và một cổng bị lọc theo
// tầm nhìn sẽ coi lượt bảo lưu ngoài tầm nhìn là KHÔNG TỒN TẠI — tức nhắc nợ nhầm đúng người
// đang được tha. Màn hình có actor tự gác quyền ở cửa vào như mọi nơi khác.
//
// ⚠️ HỎI THEO LÔ, một câu cho cả lô (cùng lý do với `locDotCuaConDangBaoLuu`: N+1 đã chết thật
// ở `backfill-orderitem-dry.ts` với P2028).
import "server-only";
import { db } from "@/lib/db";
import {
  capDangBaoLuu,
  capHocVienCuaDon,
  donDangBaoLuu,
  luotConHieuLuc,
  type LuotBaoLuu,
} from "@/lib/bao-luu/dang-bao-luu";

type DocClient = Pick<typeof db, "order" | "studentReserve" | "enrollment">;

/**
 * Các lượt bảo lưu CÓ THỂ còn hiệu lực tại `ngay` của những học viên nói trên.
 *
 * Điều kiện khớp `luotConHieuLuc`: đã bắt đầu, và (chưa đóng + `isActive`) hoặc (đóng SAU `ngay`).
 * Lọc ở DB để không nạp cả lịch sử bảo lưu của học viên; phép quyết định cuối vẫn ở hàm thuần.
 */
async function docLuotCuaHocVien(
  client: DocClient,
  studentIds: readonly string[],
  ngay: Date,
): Promise<LuotBaoLuu[]> {
  if (studentIds.length === 0) return [];
  return client.studentReserve.findMany({
    where: {
      studentId: { in: [...studentIds] },
      startedAt: { lte: ngay },
      OR: [{ isActive: true, endedAt: null }, { endedAt: { gt: ngay } }],
    },
    select: {
      id: true,
      studentId: true,
      enrollmentId: true,
      startedAt: true,
      expectedEndAt: true,
      endedAt: true,
      isActive: true,
    },
  });
}

/** Ghi danh này có đang bảo lưu tại `ngay` không. Ghi danh không tồn tại ⇒ `false`. */
export async function dangBaoLuu(
  enrollmentId: string,
  ngay: Date,
  client: DocClient = db,
): Promise<boolean> {
  const e = await client.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { studentId: true },
  });
  if (!e) return false;
  const luot = await docLuotCuaHocVien(client, [e.studentId], ngay);
  return capDangBaoLuu({ studentId: e.studentId, enrollmentId }, luot, ngay);
}

/**
 * Trong một lô đơn, đơn nào ĐANG BẢO LƯU toàn bộ tại `ngay`. Trả tập `Order.id`.
 *
 * Đơn không suy được bé (dòng khoá học thiếu cả `enrollmentId` lẫn `studentId`) KHÔNG nằm trong
 * tập — xem `capHocVienCuaDon`.
 */
export async function locDonDangBaoLuu(
  orderIds: readonly string[],
  ngay: Date,
  client: DocClient = db,
): Promise<Set<string>> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return new Set();

  const don = await client.order.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      studentId: true,
      items: {
        select: {
          type: true,
          enrollmentId: true,
          studentId: true,
          enrollment: { select: { studentId: true } },
        },
      },
    },
  });

  const capTheoDon = new Map(
    don.map((o) => [
      o.id,
      capHocVienCuaDon({
        orderStudentId: o.studentId,
        items: o.items.map((it) => ({
          type: it.type,
          enrollmentId: it.enrollmentId,
          enrollmentStudentId: it.enrollment?.studentId ?? null,
          studentId: it.studentId,
        })),
      }),
    ]),
  );

  const studentIds = new Set<string>();
  for (const cap of capTheoDon.values()) for (const c of cap ?? []) studentIds.add(c.studentId);
  const luot = await docLuotCuaHocVien(client, [...studentIds], ngay);
  if (luot.length === 0) return new Set();

  const ra = new Set<string>();
  for (const [orderId, cap] of capTheoDon) {
    if (donDangBaoLuu(cap, luot, ngay)) ra.add(orderId);
  }
  return ra;
}

/**
 * Học viên có hồ sơ bảo lưu CÒN HIỆU LỰC nào (bất kể ghi danh) tại `ngay` không. Dùng cho đường gỡ
 * `Student.PAUSED` — xem `chanGoBaoLuuNgoaiHoSo`.
 */
export async function coHoSoMoChoHocVien(
  studentId: string,
  ngay: Date,
  client: DocClient = db,
): Promise<boolean> {
  const luot = await docLuotCuaHocVien(client, [studentId], ngay);
  return luot.some((l) => luotConHieuLuc(l, ngay));
}

/** Trong một lô học viên, ai có hồ sơ bảo lưu còn hiệu lực. Trả tập `studentId`. */
export async function locHocVienCoHoSoMo(
  studentIds: readonly string[],
  ngay: Date,
  client: DocClient = db,
): Promise<Set<string>> {
  const luot = await docLuotCuaHocVien(client, [...new Set(studentIds)], ngay);
  return new Set(luot.filter((l) => luotConHieuLuc(l, ngay)).map((l) => l.studentId));
}

/**
 * Trong một lô GHI DANH, ghi danh nào ĐANG BẢO LƯU tại `ngay`. Trả tập `Enrollment.id`.
 *
 * Một câu cho ghi danh + một câu cho lượt bảo lưu — không N+1. Cho cron nhắc hàng loạt
 * (`renewal-reminder`…) thay cho phép lọc cũ bằng `Student.status`, vốn KHÔNG phải nguồn sự thật:
 * học viên `PAUSED` mà không có hồ sơ (đường tắt cũ) bị tha oan, còn học viên `ACTIVE` mà có hồ sơ
 * (`approveReserveRequest` bỏ sót ghi danh `ACTIVE`) lại bị nhắc.
 */
export async function locGhiDanhDangBaoLuu(
  enrollmentIds: readonly string[],
  ngay: Date,
  client: DocClient = db,
): Promise<Set<string>> {
  const ids = [...new Set(enrollmentIds)];
  if (ids.length === 0) return new Set();
  const gd = await client.enrollment.findMany({
    where: { id: { in: ids } },
    select: { id: true, studentId: true },
  });
  const luot = await docLuotCuaHocVien(client, [...new Set(gd.map((g) => g.studentId))], ngay);
  if (luot.length === 0) return new Set();
  return new Set(
    gd.filter((g) => capDangBaoLuu({ studentId: g.studentId, enrollmentId: g.id }, luot, ngay)).map((g) => g.id),
  );
}
