// lib/hoc-bu/phu-thuoc.ts — CỔNG PHỤ THUỘC HỌC BÙ trước khi XOÁ CỨNG một thứ mà học bù trỏ tới (T14, 08/10/2026).
//
// Vấn đề: `MakeupNeed.missedSessionId` / `missedLessonId` / `feeOrderItemId`, `MakeupCaseStudent.originalSessionId` / `lessonId` và
// `MakeupNeed.originalAttendanceId` là cột TRẦN hoặc SET NULL — không có khoá ngoại chặn xoá. Xoá một buổi / bài / điểm danh / đơn phí mà dòng học bù còn
// trỏ tới thì dòng thành MỒ CÔI (checker TV-01/02/03/04), lượt đang giữ thành `held` thừa (TV-33), và lịch sử "bé này vắng bài nào, bù thế nào" biến mất.
//
// Luật (chốt T14): KHÔNG xoá cứng thứ mà học bù từng trỏ tới — kể cả dòng đã huỷ/đã bù xong: đó là LỊCH SỬ. Muốn bỏ buổi thì HUỶ (đổi trạng thái), không xoá.
// Cổng này là MỘT hàm, mọi đường xoá cứng gọi nó TRƯỚC khi xoá; chặn bằng một câu nói được vì sao.
//
// Đọc bằng `db` trần (không `scopedDb`): phép ĐẾM để CHẶN mà bị lọc theo cơ sở thì thấy ít hơn thật, ra 0, và cổng đọc 0 thành "sạch" — mở toang đúng lúc
// phải đóng (cùng bài học của `lib/payments/method-lookup.ts`). Phạm vi cơ sở do nơi gọi gác trước.
import "server-only";
import { db } from "@/lib/db";
import { lyDoChanXoa, type DemPhuThuoc, type LoaiXoa } from "@/lib/hoc-bu/phu-thuoc-thuan";

export async function demPhuThuocHocBu(loai: LoaiXoa, ids: readonly string[]): Promise<DemPhuThuoc> {
  const ds = [...new Set(ids)].filter((x) => x.length > 0);
  const khong: DemPhuThuoc = { dongBu: 0, mucCase: 0, caseTrongBo: 0, diemDanhDaBu: 0 };
  if (ds.length === 0) return khong;
  if (loai === "BUOI") {
    const [dongBu, mucCase, diemDanhDaBu] = await Promise.all([
      db.makeupNeed.count({ where: { OR: [{ missedSessionId: { in: ds } }, { makeupSessionId: { in: ds } }] } }),
      db.makeupCaseStudent.count({ where: { originalSessionId: { in: ds } } }),
      db.attendance.count({ where: { makeupSessionId: { in: ds } } }),
    ]);
    return { ...khong, dongBu, mucCase, diemDanhDaBu };
  }
  if (loai === "BAI") {
    const [dongBu, mucCase, caseLesson, caseChinh] = await Promise.all([
      db.makeupNeed.count({ where: { missedLessonId: { in: ds } } }),
      db.makeupCaseStudent.count({ where: { lessonId: { in: ds } } }),
      db.makeupCaseLesson.count({ where: { lessonId: { in: ds } } }),
      db.makeupCase.count({ where: { lessonId: { in: ds } } }),
    ]);
    return { ...khong, dongBu, mucCase, caseTrongBo: Math.max(caseLesson, caseChinh) };
  }
  const [dongBu, mucCase] = await Promise.all([
    db.makeupNeed.count({ where: { originalAttendanceId: { in: ds } } }),
    db.makeupCaseStudent.count({ where: { originalAttendanceId: { in: ds } } }),
  ]);
  return { ...khong, dongBu, mucCase };
}

/** Cổng cho mọi đường xoá cứng: `null` = xoá được; chuỗi = lý do từ chối. Gọi TRƯỚC phép xoá đầu tiên. */
export async function kiemPhuThuocHocBu(loai: LoaiXoa, ids: readonly string[]): Promise<string | null> {
  return lyDoChanXoa(loai, await demPhuThuocHocBu(loai, ids));
}

/**
 * Đơn có phải ĐƠN PHÍ học bù mà dòng cần bù còn trỏ tới không (`MakeupNeed.feeOrderItemId`). Dùng cho cổng xoá đơn: xoá đơn phí đã huỷ làm con trỏ
 * phí của dòng thành mồ côi (TV-04) và mất vết "phí này từng được tạo, đã huỷ vì sao".
 */
export async function demDongBuTroToiDon(orderId: string): Promise<number> {
  const items = await db.orderItem.findMany({ where: { orderId }, select: { id: true } });
  if (items.length === 0) return 0;
  return db.makeupNeed.count({ where: { feeOrderItemId: { in: items.map((i) => i.id) } } });
}
