import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { assertKhongTuQuyet } from "@/lib/elearning/self-decision";
import { capChungNhanChoLuot } from "@/lib/elearning/_handlers/issue-certificate";

/**
 * EL-16 — CẤP CHỨNG NHẬN BẰNG TAY cho một lượt đã hoàn thành.
 *
 * ⚠️ Vì sao cần đường này khi chứng nhận đã cấp tự động:
 *
 *  1. `elearning:certificate:issue` là một trong 17 khoá quyền của module, mô tả
 *     đúng chữ "Cấp/cấp lại chứng nhận bằng tay" — và trước PR này KHÔNG mã nào
 *     dùng nó. Một khoá quyền không có đường đi là một dòng trong bảng phân quyền
 *     mà không ai gọi được: đúng kiểu cổng-không-cửa đã lặp lại tám lần ở module này.
 *
 *  2. Lượt học HOÀN THÀNH TRƯỚC khi EL-16 lên chạy sẽ không bao giờ có chứng nhận:
 *     sự kiện `elearning.enrollment.completed` của chúng đã chạy xong từ lâu, và
 *     `verifiedAt` của chúng còn NULL (cột ấy chỉ được đặt từ PR1 trở đi). Không có
 *     đường cấp tay thì những người ấy phải học lại từ đầu để có một tờ giấy.
 *
 * ⚠️ KHÔNG bỏ qua điều kiện. Đường này chỉ CHẠY LẠI đúng phép cấp tự động, kể cả
 * phép suy hạn hiệu lực — nó không phải cửa sau để phát chứng nhận cho lượt chưa
 * học xong. Lượt chưa đủ điều kiện thì trả về lý do, không phải một tờ giấy.
 */

const capTaySchema = z
  .object({
    enrollmentId: z.string().min(1),
  })
  .strict();

export type CapTayInput = z.infer<typeof capTaySchema>;

export const cauHinhCapChungNhanTay: ActionConfig<
  CapTayInput,
  { certificateId: string; certCode: string; daCoTruoc: boolean }
> = {
  name: "capChungNhanTay",
  permission: "elearning:certificate:issue",
  module: "elearning",
  entityType: "TrnCertificate",
  auditAction: "CREATE",
  // Cấp bằng tay là một quyết định ngoài luồng tự động — phải nói vì sao. Lý do vào
  // AuditLog, nên về sau còn trả lời được câu "vì sao người này có chứng nhận mà
  // không thấy lượt học nào tương ứng".
  requireReason: true,
  schema: capTaySchema,
  handler: async ({ db, actor, input }) => {
    // Đọc qua `scopedDb` TRƯỚC là hàng rào IDOR: `enrollmentId` đến thẳng từ biểu
    // mẫu, nên người cấp cơ sở không cấp được chứng nhận cho lượt cơ sở khác. Lõi
    // cấp bên dưới chạy trên `db` trần (nó là đường sự kiện, không có actor).
    const gd = await db.trnEnrollment.findFirst({
      where: { id: input.enrollmentId },
      select: {
        id: true,
        userId: true,
        status: true,
        completedAt: true,
        verifiedAt: true,
        revokedAt: true,
      },
    });
    if (!gd) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy lượt ghi danh này");
    }

    // ⚠️ Không tự cấp chứng nhận cho chính mình bằng tay (ADR-0001) — đường này đóng dấu `verifiedAt` cho lượt
    // cũ, tức là CHÍNH lời xác nhận có tên của một người; người ấy không thể là chủ chứng nhận. Đứng TRƯỚC
    // phép `update` đóng dấu bên dưới.
    assertKhongTuQuyet(actor.userId, gd.userId, "Không tự cấp chứng nhận cho chính mình", "enrollmentId");

    // ⚠️ ĐÓNG DẤU `verifiedAt` cho lượt cũ — và đây là phần khiến đường này có ích
    // thay vì chỉ tồn tại.
    //
    // Lượt hoàn thành TRƯỚC khi EL-16 lên chạy có `completedAt` nhưng `verifiedAt`
    // NULL: cột ấy chỉ được đặt từ PR1 trở đi. Mà `duDieuKienCap` đòi `verifiedAt`.
    // Không xử ở đây thì đường cấp tay TỪ CHỐI đúng những lượt nó sinh ra để phục vụ
    // — một cánh cửa mở ra đúng bức tường.
    //
    // Đóng dấu là hợp lệ về bản chất: lượt ấy đã đi qua CÙNG phép cuộn tiến độ (đếm
    // bài `DONE`, mà `DONE` do server kẹp số giây + phần trăm cuộn mới đặt) — chỉ
    // thiếu con dấu. Cộng thêm một con người có quyền `certificate:issue` và một lý
    // do bắt buộc vào AuditLog, đây là lời xác nhận có tên, không phải đường tắt.
    //
    // ⚠️ Đóng dấu bằng `completedAt`, KHÔNG bằng `now()`: người ta hoàn thành ngày
    // ấy. Lấy hôm nay làm mốc là đẩy hạn tái chứng nhận đi xa thêm đúng khoảng thời
    // gian hệ thống chậm trễ.
    const laHoanThanh =
      gd.status === "COMPLETED" || gd.status === "COMPLETED_LATE";
    if (
      gd.verifiedAt == null &&
      gd.completedAt != null &&
      gd.revokedAt == null &&
      laHoanThanh
    ) {
      await db.trnEnrollment.update({
        where: { id: gd.id },
        data: { verifiedAt: gd.completedAt },
      });
    }

    const r = await capChungNhanChoLuot(gd.id);
    if (!r.ok) {
      throw new ActionError("VALIDATION", r.lyDo);
    }

    return {
      entityId: r.certificateId,
      data: {
        certificateId: r.certificateId,
        certCode: r.certCode,
        daCoTruoc: r.daCoTruoc,
      },
      paths: ["/elearning/chung-nhan", `/elearning/hoc/${gd.id}`],
    };
  },
};
