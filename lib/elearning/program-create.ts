import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import {
  dungMaChuongTrinh,
  kiemGanPhieuNhuCau,
  THONG_BAO_NHU_CAU,
  type FunctionTag,
} from "@/lib/elearning/program-code";

/**
 * EL-08 — TẠO CHƯƠNG TRÌNH ĐÀO TẠO (B2 kế hoạch + B3 thẻ phân loại, gộp một form).
 *
 * SÁU nhóm thẻ phân loại đều BẮT BUỘC khi tạo. Chúng không phải nhãn trang trí:
 * `securityTag` từ `RESTRICTED` trở lên nối thẳng vào hành vi thật (hình mờ động,
 * cấm tải tệp đính kèm), còn `natureTag = MANDATORY_COMPLIANCE` bắt buộc phải có
 * `validityMonths` vì khoá tuân thủ nào cũng có hạn tái chứng nhận.
 *
 * ⚠️ `[STT]` sinh dưới khoá `@@unique([primaryFunctionTag, year, seq])`. Hai người
 * bấm Tạo cùng lúc thì một người phải VA KHOÁ và thử lại — không được cùng đọc
 * "hiện có 3" rồi cùng ghi số 4.
 */

const FUNCTION_TAGS = [
  "SALE",
  "TEACHING",
  "MARKETING",
  "HR",
  "ACCOUNTING",
  "OPERATION",
  "COMPANY_WIDE",
] as const;

export const taoChuongTrinhSchema = z
  .object({
    title: z.string().trim().min(1, "Tên chương trình không được trống"),
    objectives: z
      .array(z.string().trim().min(1))
      .min(3, "Cần 3–5 mục tiêu hành vi")
      .max(5, "Tối đa 5 mục tiêu"),

    // ── Sáu nhóm thẻ phân loại (§8.3) ───────────────────────────────────────
    primaryFunctionTag: z.enum(FUNCTION_TAGS),
    functionTags: z.array(z.enum(FUNCTION_TAGS)).min(1),
    levelTags: z.array(z.enum(["L1", "L2", "L3", "L4"])).min(1),
    stageTag: z.enum(["NEW_HIRE", "IN_SERVICE"]),
    durationTag: z.enum(["S", "M", "LG"]),
    natureTag: z.enum([
      "MANDATORY",
      "MANDATORY_COMPLIANCE",
      "RECOMMENDED",
      "OPTIONAL",
    ]),
    formatTag: z.enum(["ELEARNING", "OFFLINE", "BLENDED", "OJT", "COACHING", "WEBINAR"]),
    securityTag: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "CONFIDENTIAL"]),

    // ── §8.1: phiếu nhu cầu, hoặc lý do miễn ────────────────────────────────
    needId: z.union([z.null(), z.string().min(1)]).optional(),
    needExemptReason: z.union([z.null(), z.string().trim().min(10)]).optional(),

    // ── Kế hoạch (B2) gộp thẳng vào đây ─────────────────────────────────────
    contentOwnerUserId: z.string().min(1, "Chương trình phải có người chịu trách nhiệm nội dung"),
    validityMonths: z.union([z.null(), z.number().int().min(1).max(120)]).optional(),
    budgetPlanned: z.union([z.null(), z.number().min(0)]).optional(),
    // ⚠️ `null` đứng TRƯỚC nhánh ép kiểu — `z.coerce.date()` nuốt `null` thành
    // 1970-01-01.
    expiresAt: z.union([z.null(), z.coerce.date()]).optional(),
  })
  .strict();

export type TaoChuongTrinhInput = z.infer<typeof taoChuongTrinhSchema>;

export const cauHinhTaoChuongTrinh: ActionConfig<
  TaoChuongTrinhInput,
  { programId: string; code: string }
> = {
  name: "taoChuongTrinh",
  permission: "elearning:program:manage",
  module: "elearning",
  entityType: "TrnProgram",
  auditAction: "CREATE",
  schema: taoChuongTrinhSchema,
  handler: async ({ db, actor, input }) => {
    // ── Luật §8.1 ────────────────────────────────────────────────────────────
    const need = input.needId
      ? await db.trnTrainingNeed.findFirst({
          where: { id: input.needId, deletedAt: null },
          select: { id: true, status: true },
        })
      : null;
    if (input.needId && !need) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy phiếu nhu cầu", "needId");
    }

    const kiem = kiemGanPhieuNhuCau({
      needId: input.needId ?? null,
      needStatus: (need?.status as "NEW" | "APPROVED" | undefined) ?? null,
      needExemptReason: input.needExemptReason ?? null,
    });
    if (!kiem.ok) {
      throw new ActionError(
        kiem.code,
        THONG_BAO_NHU_CAU[kiem.code],
        kiem.code === "NEED_AND_EXEMPT" ? "needExemptReason" : "needId",
      );
    }

    // ── Ràng buộc giữa các thẻ ───────────────────────────────────────────────
    if (input.natureTag === "MANDATORY_COMPLIANCE" && !input.validityMonths) {
      // Khoá tuân thủ mà không có hạn tái chứng nhận thì bằng chứng "đã đào tạo"
      // sống mãi — đúng thứ mà luật tuân thủ sinh ra để chống.
      throw new ActionError(
        "VALIDATION",
        "Khoá tuân thủ bắt buộc phải khai số tháng hiệu lực",
        "validityMonths",
      );
    }
    if (!input.functionTags.includes(input.primaryFunctionTag)) {
      // Chức năng chính phải nằm trong tập chức năng — lệch nhau thì mã chương
      // trình nói một đằng, bộ lọc theo thẻ trả một nẻo.
      throw new ActionError(
        "VALIDATION",
        "Chức năng chính phải nằm trong danh sách chức năng đã chọn",
        "primaryFunctionTag",
      );
    }

    const year = new Date().getFullYear();
    const tag = input.primaryFunctionTag as FunctionTag;

    // ── Sinh STT: đọc max rồi ghi, VA KHOÁ thì thử lại ───────────────────────
    let taoDuoc: { id: string; code: string } | null = null;
    let loiCuoi: unknown = null;
    for (let lan = 0; lan < 5 && !taoDuoc; lan += 1) {
      const lonNhat = await db.trnProgram.findFirst({
        where: { primaryFunctionTag: tag, year },
        orderBy: { seq: "desc" },
        select: { seq: true },
      });
      const seq = (lonNhat?.seq ?? 0) + 1;
      try {
        taoDuoc = await db.trnProgram.create({
          data: {
            code: dungMaChuongTrinh({ primaryFunctionTag: tag, year, seq }),
            year,
            seq,
            title: input.title,
            objectivesJson: input.objectives,
            primaryFunctionTag: tag,
            functionTags: input.functionTags,
            levelTags: input.levelTags,
            stageTag: input.stageTag,
            durationTag: input.durationTag,
            natureTag: input.natureTag,
            formatTag: input.formatTag,
            securityTag: input.securityTag,
            needId: input.needId ?? null,
            needExemptReason: input.needExemptReason ?? null,
            contentOwnerUserId: input.contentOwnerUserId,
            validityMonths: input.validityMonths ?? null,
            budgetPlanned: input.budgetPlanned ?? null,
            expiresAt: input.expiresAt ?? null,
            status: "DRAFT",
            ownerUserId: actor.userId,
            // `centerId` để NULL = chương trình TOÀN CÔNG TY. Với model này NULL
            // là nghiệp vụ bình thường, không phải dữ liệu thiếu — nó nằm trong
            // `NULL_IS_GLOBAL_MODELS`.
          },
          select: { id: true, code: true },
        });
      } catch (e) {
        // Va `@@unique([primaryFunctionTag, year, seq])` = hai người bấm cùng
        // lúc. Đọc lại số lớn nhất và thử lại; đây là đường đúng, không phải lỗi.
        loiCuoi = e;
      }
    }
    if (!taoDuoc) {
      // Ghi log lỗi gốc: thông báo cho người dùng nói "thử lại", nhưng nếu
      // nguyên nhân KHÔNG phải va khoá thì người sửa cần thấy lỗi thật.
      console.warn("[elearning] không sinh được mã chương trình", loiCuoi);
      throw new ActionError(
        "CONFLICT",
        "Nhiều người đang tạo chương trình cùng lúc — thử lại giúp tôi",
      );
    }

    return {
      entityId: taoDuoc.id,
      data: { programId: taoDuoc.id, code: taoDuoc.code },
      newValues: {
        code: taoDuoc.code,
        title: input.title,
        natureTag: input.natureTag,
        securityTag: input.securityTag,
        coPhieuNhuCau: Boolean(input.needId),
      },
    };
  },
};
