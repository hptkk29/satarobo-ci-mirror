import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

/**
 * EL-09 — CÔNG NHẬN TƯƠNG ĐƯƠNG.
 *
 * Không có đường này thì ma trận đào tạo ngày mở **tô xám 100%**: người đã học
 * khoá An toàn từ hai năm trước hiện ra như chưa từng học, và khoá tuân thủ 12
 * tháng không có mốc gốc nào để tính hạn tái chứng nhận.
 *
 * BỐN LUẬT THI HÀNH, không diễn giải khác được:
 *
 *   1. Lượt ghi danh sinh ra mang `status = COMPLETED` · `source = EQUIVALENCE` ·
 *      `completedAt = originalEffectiveAt` · `verifiedAt = now()`.
 *   2. Nhãn hiển thị suy từ CỘT `source`, KHÔNG từ một trạng thái mới — không đẻ
 *      trạng thái thứ bảy.
 *   3. Lượt này CÓ `verifiedAt` nên đếm vào tử số lẫn mẫu số M1; nhưng nó KHÔNG
 *      có `dueAtOriginal` nên đứng ngoài phân hoạch đúng-hạn/trễ.
 *   4. Chu kỳ tái chứng nhận tính từ `originalEffectiveAt`, KHÔNG từ ngày bấm nút.
 */

export const congNhanSchema = z
  .object({
    userId: z.string().min(1),
    courseId: z.string().min(1),
    evidenceSource: z
      .string()
      .trim()
      .min(5, "Nêu bằng chứng cụ thể (chứng chỉ, biên bản, quyết định…)"),
    // ⚠️ `null` đứng TRƯỚC nhánh ép kiểu — `z.coerce.date()` nuốt `null` thành
    // 1970-01-01, và ở đây mốc đó còn quyết định hạn tái chứng nhận.
    originalEffectiveAt: z.union([z.null(), z.coerce.date()]),
    note: z.union([z.null(), z.string().trim()]).optional(),
  })
  .strict();

export type CongNhanInput = z.infer<typeof congNhanSchema>;

export const cauHinhCongNhanTuongDuong: ActionConfig<
  CongNhanInput,
  { equivalenceId: string; enrollmentId: string }
> = {
  name: "congNhanTuongDuong",
  // Dùng khoá quản lý chương trình: công nhận tương đương là một QUYẾT ĐỊNH về
  // hồ sơ đào tạo của người khác, không phải một thao tác soạn nội dung.
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnEquivalence",
  auditAction: "CREATE",
  requireReason: true,
  schema: congNhanSchema,
  handler: async ({ db, actor, input, reason }) => {
    if (!input.originalEffectiveAt) {
      throw new ActionError(
        "VALIDATION",
        "Phải nhập ngày hiệu lực GỐC của bằng chứng",
        "originalEffectiveAt",
      );
    }
    const now = new Date();
    if (input.originalEffectiveAt.getTime() > now.getTime()) {
      // Ngày gốc ở tương lai làm hạn tái chứng nhận trôi về phía trước một
      // khoảng không ai quyết — và không có gì báo.
      throw new ActionError(
        "VALIDATION",
        "Ngày hiệu lực gốc không thể ở tương lai",
        "originalEffectiveAt",
      );
    }

    // ⚠️ KHÔNG tự công nhận cho chính mình. Đây là quyết định về hồ sơ đào tạo,
    // và điểm kiểm soát duy nhất của nó là có người thứ hai đứng tên.
    if (input.userId === actor.userId) {
      throw new ActionError(
        "SELF_APPROVAL",
        "Không tự công nhận tương đương cho chính mình",
        "userId",
      );
    }

    const khoa = await db.trnCourse.findFirst({
      where: { id: input.courseId, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá học", "courseId");

    const nv = await db.employee.findFirst({
      where: { userAccount: { id: input.userId } },
      select: { centerId: true, orgUnitId: true, fullName: true, employeeCode: true },
    });
    if (!nv) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy hồ sơ nhân sự", "userId");
    }
    if (!nv.centerId) {
      // Cùng hàng rào với đường giao bài (QĐ-CDA-10): không tạo bản ghi mang
      // `centerId` null, vì nó tàng hình với mọi người cấp cơ sở.
      throw new ActionError(
        "MISSING_CENTER",
        `${nv.fullName} (${nv.employeeCode}) chưa được gán cơ sở — liên hệ Nhân sự`,
        "userId",
      );
    }

    const daCo = await db.trnEquivalence.findFirst({
      where: { userId: input.userId, courseId: input.courseId },
      select: { id: true },
    });
    if (daCo) {
      throw new ActionError(
        "ALREADY_DONE",
        "Người này đã được công nhận tương đương cho khoá này",
      );
    }

    const orgUnitId = nv.orgUnitId ?? (await orgUnitIdForCenter(nv.centerId));
    if (!orgUnitId) {
      throw new ActionError(
        "MISSING_CENTER",
        "Cơ sở chưa gắn với đơn vị tổ chức nào — liên hệ quản trị",
      );
    }

    const ket = await db.$transaction(async (tx) => {
      const eq = await tx.trnEquivalence.create({
        data: {
          userId: input.userId,
          courseId: khoa.id,
          evidenceSource: input.evidenceSource,
          originalEffectiveAt: input.originalEffectiveAt!,
          confirmedByUserId: actor.userId,
          note: input.note ?? reason ?? null,
          centerId: nv.centerId!,
          orgUnitId,
        },
        select: { id: true },
      });

      const en = await tx.trnEnrollment.create({
        data: {
          userId: input.userId,
          courseId: khoa.id,
          // Không sinh từ lượt giao nào — đây chính là lý do `assignmentId` phải
          // nullable trên `TrnEnrollment`.
          assignmentId: null,
          source: "EQUIVALENCE",
          status: "COMPLETED",
          progressPercent: 100,
          // ⚠️ `completedAt` = ngày hiệu lực GỐC, không phải bây giờ: mọi phép
          // tính hạn tái chứng nhận đứng trên cột này.
          completedAt: input.originalEffectiveAt!,
          // `verifiedAt` = BÂY GIỜ: đây là mốc hệ thống xác nhận, khác mốc học.
          verifiedAt: now,
          // ⚠️ KHÔNG đặt `dueAtOriginal`. Lượt này đứng NGOÀI phân hoạch
          // đúng-hạn/trễ (luật 3) — gán một cái hạn giả sẽ kéo nó vào mẫu số của
          // một phép đo mà nó không thuộc về.
          dueAtOriginal: null,
          dueAt: null,
          isLate: false,
          snapJobTitle: "",
          snapOrgUnitId: orgUnitId,
          centerId: nv.centerId!,
          orgUnitId,
        },
        select: { id: true },
      });

      return { eqId: eq.id, enId: en.id };
    });

    return {
      entityId: ket.eqId,
      data: { equivalenceId: ket.eqId, enrollmentId: ket.enId },
      newValues: {
        khoa: khoa.title,
        nguoiHoc: `${nv.fullName} (${nv.employeeCode})`,
        bangChung: input.evidenceSource,
        ngayHieuLucGoc: input.originalEffectiveAt.toISOString(),
      },
    };
  },
};

// ── Điểm danh buổi TRỰC TIẾP (blended) ─────────────────────────────────────

export const diemDanhSchema = z
  .object({
    enrollmentId: z.string().min(1),
    lessonId: z.string().min(1),
    daDu: z.boolean(),
  })
  .strict();

/**
 * EL-09 — GIẢNG VIÊN TICK "ĐÃ DỰ" cho bài dạng `LIVE_SESSION`.
 *
 * Bản tối giản có chủ đích: HAI trạng thái, tick tay, có ngày và có nhật ký ai
 * tick. Không QR, không thiết bị.
 *
 * ⚠️ Vì sao phải có: BR-004 cấp chứng nhận khi mọi bài bắt buộc đã xong. Bài
 * "Buổi trực tiếp" không có chỗ ghi nhận thì nó hoặc luôn xong (cấp chứng nhận
 * cho người mới học phần trực tuyến) hoặc không bao giờ xong (không ai lấy được
 * chứng nhận). Cả hai đều sai, và đều im lặng.
 */
export const cauHinhDiemDanhBuoi: ActionConfig<
  z.infer<typeof diemDanhSchema>,
  { daDu: boolean }
> = {
  name: "diemDanhBuoiTrucTiep",
  // Giảng viên tick, nên dùng khoá soạn nội dung chứ không phải khoá học bài.
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLessonProgress",
  auditAction: "UPDATE",
  schema: diemDanhSchema,
  handler: async ({ db, actor, input }) => {
    const bai = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: { id: true, kind: true, title: true },
    });
    if (!bai) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");
    if (bai.kind !== "LIVE_SESSION") {
      // Cho tick bài trực tuyến là mở một đường qua mặt toàn bộ phép đo tiến độ:
      // ai đó "tick xong" một bài video mà chưa xem phút nào.
      throw new ActionError(
        "WRONG_KIND",
        "Chỉ điểm danh được cho bài dạng Buổi trực tiếp",
        "lessonId",
      );
    }

    const en = await db.trnEnrollment.findFirst({
      where: { id: input.enrollmentId },
      select: { id: true, userId: true },
    });
    if (!en) throw new ActionError("NOT_FOUND", "Không tìm thấy lượt ghi danh");

    const now = new Date();
    await db.trnLessonProgress.upsert({
      where: {
        enrollmentId_lessonId: { enrollmentId: en.id, lessonId: bai.id },
      },
      update: {
        status: input.daDu ? "DONE" : "NOT_STARTED",
        // Bỏ tick thì XOÁ mốc xác nhận, không giữ lại: một dòng vừa "chưa dự"
        // vừa mang `verifiedAt` là hai câu trả lời cho một câu hỏi.
        verifiedAt: input.daDu ? now : null,
        completedAt: input.daDu ? now : null,
        attendanceMarkedByUserId: actor.userId,
        attendanceMarkedAt: now,
        lastActivityAt: now,
      },
      create: {
        enrollmentId: en.id,
        lessonId: bai.id,
        userId: en.userId,
        status: input.daDu ? "DONE" : "NOT_STARTED",
        verifiedAt: input.daDu ? now : null,
        completedAt: input.daDu ? now : null,
        attendanceMarkedByUserId: actor.userId,
        attendanceMarkedAt: now,
        lastActivityAt: now,
      },
    });

    return {
      entityId: en.id,
      data: { daDu: input.daDu },
      newValues: { bai: bai.title, daDu: input.daDu, nguoiTick: actor.userId },
    };
  },
};
