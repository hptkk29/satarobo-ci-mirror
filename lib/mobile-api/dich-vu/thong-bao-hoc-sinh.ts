import { z } from "zod";

import { db } from "@/lib/db";
import { GHI_DANH_DANG_HOC } from "@/lib/portal/trang-thai-ghi-danh";
import { KHONG_HIEN_CHO_PH } from "@/lib/portal/notifications";

import { nhanThoiDiem } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * `GET /students/:id/notifications` — «TIN MỚI» của HỌC SINH (màn H-Thong-bao, BR-HS-NOTIF-01). Dùng được trong CHẾ ĐỘ HỌC SINH (khác `GET /notifications` của ba mẹ vốn bị chặn vì có tên các con).
 *
 * NGUỒN: bảng `Notification` — cùng nguồn chuông phụ huynh của web — nhưng CHỈ hai loại nhắm tới chính học sinh:
 *   · `audience = STUDENT` với `studentId` = học viên này VÀ thuộc DANH SÁCH CHO PHÉP theo tiền tố `dedupeKey` (`TIEN_TO_TIN_HOC_SINH`: «Bài tập mới», «Bài tập đã được chấm», «Bài tập về nhà mới»).
 *     ⚠️ Bảng `Notification` dùng audience STUDENT cho CẢ tin dành cho ba mẹ (xác nhận thanh toán + số tiền, kết quả xử lý yêu cầu, học bù…) — nên KHÔNG được lấy «mọi STUDENT»: danh sách cho phép, tin mới thêm sau mặc định KHÔNG tới học sinh;
 *   · `audience = CLASS` của lớp học viên ĐANG HỌC.
 * KHÔNG có `ALL_PARENTS`/`CENTER` (dành cho ba mẹ: học phí, thông báo cơ sở), KHÔNG có nhắc nợ (`debt.overdue:*`), KHÔNG có tin đã bị gỡ (`isPublished=false`) hay chưa đến giờ đăng.
 * Học viên khác trong nhà không bao giờ lọt vào (lọc theo `studentId`). Nội dung do máy chủ tạo không chứa điểm.
 * Không có trạng thái «đã đọc» riêng cho học sinh (sổ đã-đọc của web là của phụ huynh) ⇒ app tự nhớ cục bộ.
 */
export const locThongBaoHocSinhSchema = z
  .object({
    soLuong: z.coerce.number().int().min(1).max(50).default(30),
    truocLuc: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type LocThongBaoHocSinh = z.infer<typeof locThongBaoHocSinhSchema>;

/** Chỉ các tin do sự kiện giao/chấm bài tạo (nhắm tới học sinh). Thêm loại tin cho học sinh = thêm tiền tố Ở ĐÂY có chủ đích. */
export const TIEN_TO_TIN_HOC_SINH = ["assignment.assigned:", "assignment.graded:", "exam.attempt.graded:", "homework.new:", "media.approved:"] as const;

export type MucTinHocSinhDto = { id: string; title: string; body: string; nhanLuc: string; luc: string; loai: "RIENG" | "LOP" };
export type TinHocSinhDto = { items: MucTinHocSinhDto[]; coTrangSau: boolean; conTro: string | null };

export async function layTinHocSinh(hs: MaHocVienDaKiem, loc: LocThongBaoHocSinh, now: Date = new Date()): Promise<TinHocSinhDto> {
  const lop = (await db.enrollment.findMany({ where: { studentId: hs, deletedAt: null, status: { in: [...GHI_DANH_DANG_HOC] } }, select: { classId: true } })).map((e) => e.classId);
  const truoc = loc.truocLuc ? new Date(loc.truocLuc) : null;
  const rows = await db.notification.findMany({
    where: {
      AND: [
        KHONG_HIEN_CHO_PH,
        { isPublished: true },
        { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
        { OR: [{ audience: "STUDENT", studentId: hs, OR: TIEN_TO_TIN_HOC_SINH.map((t) => ({ dedupeKey: { startsWith: t } })) }, ...(lop.length > 0 ? [{ audience: "CLASS" as const, classId: { in: lop } }] : [])] },
        ...(truoc ? [{ createdAt: { lt: truoc } }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: loc.soLuong + 1,
    select: { id: true, title: true, body: true, audience: true, createdAt: true },
  });
  const trang = rows.slice(0, loc.soLuong);
  return {
    items: trang.map((r) => ({ id: r.id, title: r.title, body: r.body, nhanLuc: nhanThoiDiem(r.createdAt.toISOString(), now), luc: r.createdAt.toISOString(), loai: r.audience === "CLASS" ? "LOP" : "RIENG" })),
    coTrangSau: rows.length > loc.soLuong,
    conTro: trang.length > 0 ? trang[trang.length - 1]!.createdAt.toISOString() : null,
  };
}
