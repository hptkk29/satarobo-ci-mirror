import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { isElearningEvalLinkEnabled } from "@/lib/flags";
import { xacMinhNguoiNhanSuDuyet } from "@/lib/elearning/nhan-su-chon-xac-minh";
import { trnEvalLinkConfigSchema } from "@/lib/validators/elearning";
import type { z } from "zod";

/**
 * EL-21 — MỨC GẮN ĐÁNH GIÁ: chế độ chỉ-báo-cáo ↔ có liên kết (QĐ-CDA-06b).
 *
 * Chủ dự án chốt hai vế: (a) giai đoạn đầu CHƯA gắn gì, chỉ báo cáo; (b) sau này
 * admin sẽ bật để xét lương. Vế (b) là tính năng phải xây, không phải hằng số trong
 * mã — nên có bảng cấu hình, và có màn để bật.
 */

export type MucGan = "REPORT_ONLY" | "LINKED";

export type BanGhiCauHinh = {
  mode: string;
  effectiveFrom: Date | null;
} | null;

/**
 * 🔴 RESOLVER — chế độ ĐANG áp dụng cho một chương trình tại một thời điểm.
 *
 * Ba luật, và cả ba đều fail-closed về phía `REPORT_ONLY`:
 *
 *  1. KHÔNG có dòng cấu hình ⇒ `REPORT_ONLY`. Mặc định là "chưa gắn gì", không phải
 *     "chưa biết" — vắng mặt một bản ghi không bao giờ được đọc thành cho phép trừ
 *     lương ai đó.
 *  2. `mode = LINKED` nhưng CHƯA tới `effectiveFrom` ⇒ vẫn `REPORT_ONLY`. Bật trước,
 *     áp sau: người ta phải được báo trước khi luật đổi.
 *  3. `LINKED` mà `effectiveFrom = null` ⇒ `REPORT_ONLY`. Zod đã chặn ở đường ghi,
 *     nhưng đường ĐỌC không được tin vào việc đường ghi luôn đúng — dữ liệu cũ, seed
 *     tay, hay một migration nào đó đều có thể để lại dòng như vậy.
 *
 * ⚠️ Hiệu lực là thuộc tính của RESOLVER, không phải của cron (luật cứng #8). Không
 * job nào ghi bảng này để "kích hoạt" nó — cron chạy trễ một đêm sẽ thành một đêm
 * người ta bị xét theo luật sai.
 */
export function mucGanHienHanh(cauHinh: BanGhiCauHinh, now: Date): MucGan {
  if (!cauHinh) return "REPORT_ONLY";
  if (cauHinh.mode !== "LINKED") return "REPORT_ONLY";
  if (cauHinh.effectiveFrom == null) return "REPORT_ONLY";
  return cauHinh.effectiveFrom.getTime() <= now.getTime() ? "LINKED" : "REPORT_ONLY";
}

/**
 * Câu giải thích cho người đọc báo cáo — vì sao cột "ảnh hưởng đánh giá" đang rỗng.
 *
 * Một cột rỗng không lời giải thích đọc ra thành "hệ thống hỏng"; nói ra thì nó là
 * một quyết định có người ký.
 */
export function cauMucGan(muc: MucGan, cauHinh: BanGhiCauHinh): string {
  if (muc === "LINKED") return "Đang gắn với đánh giá tháng.";
  if (cauHinh?.mode === "LINKED" && cauHinh.effectiveFrom) {
    return `Đã bật nhưng chưa tới ngày áp dụng (${cauHinh.effectiveFrom.toLocaleDateString("vi-VN")}) — vẫn chỉ báo cáo.`;
  }
  return "Chế độ CHỈ BÁO CÁO: quá hạn vẫn gửi thông báo và vẫn vào báo cáo, nhưng không leo thang kỷ luật và không ảnh hưởng đánh giá tháng.";
}

export type CauHinhInput = z.infer<typeof trnEvalLinkConfigSchema>;

export const cauHinhDatMucGanDanhGia: ActionConfig<
  CauHinhInput,
  { programId: string; mode: string }
> = {
  name: "datMucGanDanhGia",
  // ⚠️ Đi bằng `elearning:program:manage` — KHÔNG mở khoá quyền thứ 18. Bộ khoá giữ
  // đúng 17 (kế hoạch §2041). Kiểm soát của màn này KHÔNG nằm ở một khoá mới mà nằm
  // ở HAI CHỮ KÝ trong chính bản ghi: Nhân sự đồng phê duyệt và Đào tạo phê duyệt.
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnEvalLinkConfig",
  auditAction: "UPDATE",
  // Luật 3: ghi audit đầy đủ mọi lần đổi — ai, khi nào, cũ/mới, và LÝ DO bắt buộc.
  requireReason: true,
  schema: trnEvalLinkConfigSchema,
  handler: async ({ db, actor, input }) => {
    // Cờ riêng (đặc tả EL-21 mục 7): OFF ⇒ chặn action, không đụng DB. Ẩn màn mà để action mở
    // thì ai POST thẳng vẫn ghi được cấu hình gắn lương.
    if (!isElearningEvalLinkEnabled()) {
      throw new ActionError("NOT_FOUND", "Tính năng chưa được bật");
    }

    const ct = await db.trnProgram.findFirst({
      where: { id: input.programId },
      select: { id: true, title: true, centerId: true },
    });
    if (!ct) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy chương trình", "programId");
    }

    // Cơ sở của cấu hình LÀ cơ sở của chương trình (bảng con của `TrnProgram`) — không phải thứ giao diện khai. Client nêu một
    // cơ sở khác chương trình thì từ chối rõ ràng, không lặng lẽ ghi theo giá trị của họ (`create` không đi qua scope).
    if (input.centerId != null && input.centerId !== ct.centerId) {
      throw new ActionError("VALIDATION", "Cơ sở của cấu hình phải trùng cơ sở của chương trình", "centerId");
    }

    const now = new Date();

    // Luật 2 phần còn lại: KHÔNG hồi tố. Zod đã chặn `effectiveFrom` sớm hơn ngày
    // hiệu lực của quyết định; ở đây chặn thêm việc đặt nó vào QUÁ KHỨ — kỳ đánh giá
    // đã đóng thì người ta đã được xét theo luật cũ, và tính lại là đổi kết quả sau
    // khi công bố.
    if (
      input.mode === "LINKED" &&
      input.effectiveFrom &&
      input.effectiveFrom.getTime() < now.getTime()
    ) {
      throw new ActionError(
        "VALIDATION",
        "Ngày áp dụng phải ở tương lai — không gắn hồi tố vào kỳ đánh giá đã qua",
        "effectiveFrom",
      );
    }

    // Luật hai người: người Nhân sự đồng phê duyệt phải là người KHÁC người đang lưu, có thật, đang làm việc, tài khoản hợp lệ,
    // cùng phạm vi, và CHÍNH họ thuộc Nhân sự trên cơ sở của chương trình. Kiểm mọi lúc khi có nêu tên (kể cả REPORT_ONLY) —
    // không để lưu một id rác rồi chờ ngày bật LINKED mới phát hiện. Đứng TRƯỚC phép ghi đầu tiên.
    const nguoiDuyet = input.hrApprovedByUserId
      ? await xacMinhNguoiNhanSuDuyet(db, actor, input.hrApprovedByUserId, { centerId: ct.centerId ?? null })
      : null;

    const cu = await db.trnEvalLinkConfig.findFirst({
      where: { programId: input.programId },
      select: { id: true, mode: true, effectiveFrom: true },
    });

    const data = {
      mode: input.mode,
      criteria: input.criteria,
      weightOnTime: input.weightOnTime ?? null,
      weightExamScore: input.weightExamScore ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      decisionDocCode: input.decisionDocCode ?? null,
      decisionDocEffectiveAt: input.decisionDocEffectiveAt ?? null,
      hrApprovedByUserId: nguoiDuyet?.userId ?? null,
      updatedByUserId: actor.userId,
    };

    const ban = cu
      ? await db.trnEvalLinkConfig.update({
          where: { id: cu.id },
          data,
          select: { id: true, mode: true },
        })
      : await db.trnEvalLinkConfig.create({
          data: {
            ...data,
            programId: input.programId,
            centerId: ct.centerId ?? null,
            createdById: actor.userId,
          },
          select: { id: true, mode: true },
        });

    return {
      entityId: ban.id,
      data: { programId: input.programId, mode: String(ban.mode) },
      paths: ["/elearning/muc-danh-gia", "/elearning/chuong-trinh"],
    };
  },
};
