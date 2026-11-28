import type { PrismaClient } from "@prisma/client";

/**
 * V8.40 — THÔNG BÁO CHO PHỤ HUYNH khi yêu cầu hoàn tiền Online đổi trạng thái (đã duyệt / từ chối / đã hoàn). Dùng bảng `Notification` sẵn có (cùng nguồn chuông web + `GET /notifications` của app).
 *   · KHÔNG có tải có kiểu (bảng không có cột loại/dữ liệu): tiêu đề + nội dung trung tính; app mở màn «Đơn của tôi» để tra lại — không kèm số tiền, tên người duyệt, ghi chú nội bộ hay mã giao dịch hoàn;
 *   · gửi theo HỌC VIÊN của dòng (audience=STUDENT — cách phụ huynh nhận thông báo của con), `centerId` null (Online không thuộc cơ sở);
 *   · idempotent: `dedupeKey` UNIQUE theo (yêu cầu, trạng thái) — gọi lại/phát trùng không tạo dòng thứ hai;
 *   · BEST-EFFORT: không bao giờ làm hỏng phép tiền đã commit (lỗi bị nuốt, ghi `console.warn` không chứa nội dung).
 */
type Db = PrismaClient;
export type TrangThaiThongBaoHoan = "DA_DUYET" | "TU_CHOI" | "DA_HOAN";

const NOI_DUNG: Record<TrangThaiThongBaoHoan, { title: string; body: string }> = {
  DA_DUYET: { title: "Yêu cầu hoàn tiền đã được duyệt", body: "Yêu cầu hoàn tiền khoá học Online của ba mẹ đã được duyệt. Xem chi tiết trong mục Đơn của tôi." },
  TU_CHOI: { title: "Yêu cầu hoàn tiền chưa được chấp thuận", body: "Yêu cầu hoàn tiền khoá học Online của ba mẹ chưa được chấp thuận. Xem lý do trong mục Đơn của tôi." },
  DA_HOAN: { title: "Đã hoàn tiền khoá học Online", body: "Khoản hoàn tiền khoá học Online của ba mẹ đã được thực hiện. Xem chi tiết trong mục Đơn của tôi." },
};

export async function guiThongBaoHoanOnline(db: Db, input: { yeuCauId: string; trangThai: TrangThaiThongBaoHoan }): Promise<void> {
  try {
    const r = await db.refundRequest.findFirst({ where: { id: input.yeuCauId, kenh: "ONLINE" }, select: { id: true, orderItem: { select: { studentId: true } } } });
    const studentId = r?.orderItem?.studentId;
    if (!r || !studentId) return;
    const nd = NOI_DUNG[input.trangThai];
    await db.notification.createMany({
      data: [{ title: nd.title, body: nd.body, audience: "STUDENT" as const, studentId, centerId: null, isPublished: true, dedupeKey: `online_refund:${r.id}:${input.trangThai}` }],
      skipDuplicates: true,
    });
  } catch {
    console.warn("[hoan-tien-online] không gửi được thông báo (bỏ qua, không ảnh hưởng tiền)");
  }
}
