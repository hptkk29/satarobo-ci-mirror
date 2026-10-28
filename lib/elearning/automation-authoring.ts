import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { luatSchema } from "@/lib/elearning/automation";

/**
 * EL-18 — KHAI / BẬT-TẮT luật tự động hoá, và soạn LỘ TRÌNH.
 *
 * ⚠️ Bật một luật là để hệ thống tự giao việc cho người khác mà không ai bấm nút. Vì
 * vậy: lý do bắt buộc, audit đầy đủ, và luật khai ra ở trạng thái TẮT — người khai
 * phải bật nó bằng một hành động riêng, sau khi đã xem lại.
 */

export const cauHinhKhaiLuat: ActionConfig<
  z.infer<typeof luatSchema>,
  { ruleId: string }
> = {
  name: "khaiLuatTuDong",
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnAutomationRule",
  auditAction: "CREATE",
  requireReason: true,
  schema: luatSchema,
  handler: async ({ db, actor, input }) => {
    const trung = await db.trnAutomationRule.findFirst({
      where: { code: input.code, deletedAt: null },
      select: { id: true },
    });
    if (trung) {
      throw new ActionError("CONFLICT", `Đã có luật mang mã "${input.code}"`, "code");
    }

    // Tham số trỏ vào thứ có thật — nếu không, luật chạy vào hư không và nhật ký đầy
    // dòng FAILED mà người vận hành không biết vì sao.
    if (input.action === "GIAO_KHOA" && input.actionJson.courseId) {
      const k = await db.trnCourse.findFirst({
        where: { id: input.actionJson.courseId },
        select: { id: true },
      });
      if (!k) throw new ActionError("NOT_FOUND", "Không tìm thấy khoá đã chọn");
    }
    if (input.action === "GIAO_LO_TRINH" && input.actionJson.pathId) {
      const lt = await db.trnLearningPath.findFirst({
        where: { id: input.actionJson.pathId, deletedAt: null },
        select: { id: true, _count: { select: { steps: true } } },
      });
      if (!lt) throw new ActionError("NOT_FOUND", "Không tìm thấy lộ trình đã chọn");
      if (lt._count.steps === 0) {
        throw new ActionError(
          "VALIDATION",
          "Lộ trình này chưa có bước nào — giao nó là giao một danh sách rỗng",
        );
      }
    }

    const r = await db.trnAutomationRule.create({
      data: {
        code: input.code,
        title: input.title,
        trigger: input.trigger,
        action: input.action,
        conditionJson: input.conditionJson,
        actionJson: input.actionJson,
        // ⚠️ LUÔN tạo ở trạng thái TẮT, bất kể người khai gửi gì. Bật là một hành
        // động riêng có lý do riêng — không để một luật vừa gõ xong đã bắt đầu giao
        // việc cho cả công ty ngay trong request tạo nó.
        enabled: false,
        dueDays: input.dueDays,
        centerId: input.centerId ?? null,
        createdById: actor.userId,
      },
      select: { id: true },
    });

    return {
      entityId: r.id,
      data: { ruleId: r.id },
      paths: ["/elearning/tu-dong-hoa"],
    };
  },
};

const batTatSchema = z
  .object({
    ruleId: z.string().min(1),
    enabled: z.boolean(),
  })
  .strict();

export const cauHinhBatTatLuat: ActionConfig<
  z.infer<typeof batTatSchema>,
  { ruleId: string; enabled: boolean }
> = {
  name: "batTatLuatTuDong",
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnAutomationRule",
  auditAction: "UPDATE",
  requireReason: true,
  schema: batTatSchema,
  handler: async ({ db, input }) => {
    const r = await db.trnAutomationRule.findFirst({
      where: { id: input.ruleId, deletedAt: null },
      select: { id: true, enabled: true },
    });
    if (!r) throw new ActionError("NOT_FOUND", "Không tìm thấy luật này");
    if (r.enabled === input.enabled) {
      throw new ActionError(
        "CONFLICT",
        input.enabled ? "Luật này đang bật rồi" : "Luật này đang tắt rồi",
      );
    }

    await db.trnAutomationRule.update({
      where: { id: r.id },
      data: { enabled: input.enabled },
    });

    // ⚠️ Tắt KHÔNG xoá nhật ký đã ghi. Lịch sử thi hành là thứ trả lời câu "vì sao
    // tôi được giao khoá này" — và câu ấy hay được hỏi sau khi luật đã tắt.
    return {
      entityId: r.id,
      data: { ruleId: r.id, enabled: input.enabled },
      paths: ["/elearning/tu-dong-hoa"],
    };
  },
};

const loTrinhSchema = z
  .object({
    code: z.string().trim().min(3).max(60),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).nullable().optional().default(null),
    sequential: z.boolean().default(true),
    /** Danh sách khoá theo THỨ TỰ — thứ tự chính là nội dung của lộ trình. */
    courseIds: z.array(z.string().trim().min(1)).min(1).max(30),
    centerId: z.string().trim().min(1).nullable().optional().default(null),
  })
  .strict();

export const cauHinhSoanLoTrinh: ActionConfig<
  z.infer<typeof loTrinhSchema>,
  { pathId: string; soBuoc: number }
> = {
  name: "soanLoTrinh",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLearningPath",
  auditAction: "CREATE",
  requireReason: true,
  schema: loTrinhSchema,
  handler: async ({ db, actor, input }) => {
    const trung = await db.trnLearningPath.findFirst({
      where: { code: input.code, deletedAt: null },
      select: { id: true },
    });
    if (trung) {
      throw new ActionError("CONFLICT", `Đã có lộ trình mã "${input.code}"`, "code");
    }

    // ⚠️ Khoá trùng trong cùng lộ trình bị BÁC ở đây, không để DB ném P2002:
    // `@@unique([pathId, courseId])` bắt được, nhưng thông báo của nó không nói cho
    // người soạn biết họ vừa chọn trùng khoá nào.
    const trungKhoa = input.courseIds.filter(
      (id, i) => input.courseIds.indexOf(id) !== i,
    );
    if (trungKhoa.length > 0) {
      throw new ActionError(
        "VALIDATION",
        "Một khoá chỉ được xuất hiện một lần trong lộ trình",
        "courseIds",
      );
    }

    const co = await db.trnCourse.findMany({
      where: { id: { in: input.courseIds } },
      select: { id: true },
    });
    if (co.length !== input.courseIds.length) {
      throw new ActionError("NOT_FOUND", "Có khoá trong lộ trình không tồn tại");
    }

    const lt = await db.trnLearningPath.create({
      data: {
        code: input.code,
        title: input.title,
        description: input.description ?? null,
        sequential: input.sequential,
        status: "DRAFT",
        centerId: input.centerId ?? null,
        createdById: actor.userId,
        steps: {
          create: input.courseIds.map((courseId, i) => ({
            courseId,
            orderIndex: i,
          })),
        },
      },
      select: { id: true },
    });

    return {
      entityId: lt.id,
      data: { pathId: lt.id, soBuoc: input.courseIds.length },
      paths: ["/elearning/tu-dong-hoa"],
    };
  },
};
