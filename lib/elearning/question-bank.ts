import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import type { Actor } from "@/lib/auth/actor";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { duocVaoDe, laCauSo, LOAI_CHUA_MO, MUC_KHO } from "@/lib/elearning/exam-grading";
import { chanGhiBanGhiChung } from "@/lib/elearning/global-write-guard";
import {
  TRAN_NOI_DUNG_CAU,
  TRAN_LUA_CHON,
} from "@/lib/assignments/question-content-db";
import { docCauSoTuNoiDung, dungNoiDungCauHoi } from "@/lib/elearning/question-content-map";
import { docSoNhap, type SoNhap } from "@/lib/elearning/cham-so";
export { docSoNhap };

/**
 * EL-14b — KHO CÂU HỎI đào tạo nội bộ.
 *
 * ⚠️ `scopedDb` CHỈ che đường ĐỌC. Mọi `create`/`update`/`delete` ở đây phải tự
 * đặt đơn vị và tự kiểm phạm vi — quên là câu hỏi của cơ sở này sửa được từ cơ sở
 * kia, im lặng.
 *
 * ⚠️ `centerId = NULL` ở bảng này nghĩa là CÂU DÙNG CHUNG TOÀN CÔNG TY (an toàn lao
 * động, phòng cháy…), không phải "chưa gán". Đó là lý do `TrnQuestion` nằm trong
 * `NULL_IS_GLOBAL_MODELS` — thiếu dòng khai đó thì kho chung tàng hình với mọi
 * người dùng cấp cơ sở, và họ chỉ thấy một kho rỗng mà không gì báo lỗi.
 */

export { MUC_KHO } from "@/lib/elearning/exam-grading";

const bankPathSchema = z
  .string()
  .trim()
  .min(2)
  .max(200)
  // Đường trong cây phải chuẩn hoá ngay ở tầng nhập: `/an-toan/` và `an-toan` mà
  // cùng tồn tại thì cây tách làm hai nhánh trông giống hệt nhau, và người soạn
  // không hiểu vì sao câu mình vừa tạo không nằm cùng chỗ với câu cũ.
  .regex(/^\/([a-z0-9-]+\/)+$/, "Đường trong cây phải dạng /nhom-cha/nhom-con/");

/**
 * Nội dung câu hỏi.
 *
 * ⚠️ Chỉ nhận loại ĐƯA VÀO ĐỀ ĐƯỢC. Cho soạn `FILL_BLANK`/`MATCHING`/`ORDERING`/
 * `CASE` là để người soạn bỏ công viết những câu không bao giờ dùng được — đúng
 * cái bẫy "mở một lựa chọn khi chưa có đường đi" vừa phải gỡ ở loại bài học.
 */
const loaiSchema = z.string().refine(duocVaoDe, {
  message: `Loại câu hỏi này chưa dùng được trong đề thi (${LOAI_CHUA_MO.join(", ")} chưa mở)`,
});

/**
 * Khuôn gốc, tách khỏi phép kiểm chéo.
 *
 * ⚠️ `.superRefine()` trả về `ZodEffects`, và `ZodEffects` KHÔNG `.extend()` được.
 * Nên khuôn gốc và phép kiểm phải là hai thứ rời, rồi ghép lại cho từng đường —
 * nếu không, đường SỬA sẽ phải chép tay lại toàn bộ luật của đường TẠO, và hai
 * bản chép tay sớm muộn trôi khỏi nhau.
 */
const cauHoiBase = z
  .object({
    bankPath: bankPathSchema,
    type: loaiSchema,
    // ⚠️ Trần lấy từ khuôn ĐỌC, không tự đặt. Cho dài hơn khuôn đọc là cho người
    // soạn tạo ra câu mà đường thi không parse nổi — và cách nó hỏng là hàng trăm
    // lượt thi treo ở "chờ người chấm", không phải một thông báo lỗi.
    stem: z.string().trim().min(5, "Đề bài quá ngắn").max(TRAN_NOI_DUNG_CAU),
    explanation: z.union([z.null(), z.string().trim().max(4000)]).optional(),
    difficulty: z.enum(MUC_KHO).optional(),
    skillTags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    defaultPoints: z.number().int().min(1).max(100).optional(),
    /**
     * Lựa chọn. Bắt buộc với câu trắc nghiệm, cấm với câu tự luận.
     *
     * ⚠️ `isCorrect` là SỰ THẬT, và nó KHÔNG BAO GIỜ được đi xuống người học —
     * mọi đường đọc cho người thi phải qua một hàm lọc.
     */
    choices: z
      .array(
        z.object({
          text: z
            .string()
            .trim()
            .min(1, "Lựa chọn không được trống")
            .max(TRAN_LUA_CHON),
          isCorrect: z.boolean(),
        }),
      )
      .max(10)
      .optional(),
    /**
     * Chỉ cho câu NHẬP SỐ (`type = NUMERIC`). Người soạn GÕ CHUỖI; việc đọc ra SỐ làm ở `docSo` (một dấu `,` hoặc `.`, không đoán dấu ngăn nghìn) — KHÔNG `Number()`
     * (`Number("1.000,5")` là NaN còn `Number("")` là 0: hai cách im lặng sai).
     */
    so: z
      .object({
        dapAn: z.string().trim().max(40),
        saiSo: z.string().trim().max(40),
        donVi: z.string().trim().max(20, "Đơn vị tối đa 20 ký tự").optional(),
        goiY: z.string().trim().max(500, "Gợi ý tối đa 500 ký tự").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

type CauHoiBase = z.infer<typeof cauHoiBase>;


/** Kiểm CHÉO giữa loại câu và bộ lựa chọn — dùng chung cho tạo và sửa. */
function kiemChoLuaChon(d: CauHoiBase, ctx: z.RefinementCtx): void {
  {
    const canLuaChon = d.type === "SINGLE" || d.type === "MULTIPLE" || d.type === "TRUE_FALSE";
    const ds = d.choices ?? [];

    // ── Câu NHẬP SỐ: cần `so` hợp lệ, cấm lựa chọn; mọi loại KHÁC cấm `so` ──
    if (d.type === "NUMERIC") {
      if (ds.length > 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: "Câu nhập số không có lựa chọn" });
      if (!d.so) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["so"], message: "Câu nhập số phải có đáp án và sai số" });
        return;
      }
      const r = docSoNhap(d.so);
      if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["so", r.loi.truong], message: r.loi.message });
      return;
    }
    if (d.so) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["so"], message: "Chỉ câu nhập số mới có đáp án số" });
    }

    if (!canLuaChon) {
      if (ds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["choices"],
          message: "Câu tự luận không có lựa chọn",
        });
      }
      return;
    }

    if (ds.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Câu trắc nghiệm phải có ít nhất 2 lựa chọn",
      });
      return;
    }

    const soDung = ds.filter((c) => c.isCorrect).length;
    // ⚠️ KIỂM CHÉO hai trường phụ thuộc nhau (quy ước 30). Zod kiểm từng trường
    // riêng lẻ sẽ để lọt một câu KHÔNG ĐÁP ÁN NÀO đúng — và câu đó không ai trả
    // lời đúng được, vĩnh viễn.
    if (soDung === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Phải đánh dấu ít nhất một đáp án đúng",
      });
    }
    if (d.type !== "MULTIPLE" && soDung > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Câu một-đáp-án chỉ được đánh dấu MỘT đáp án đúng",
      });
    }
    if (d.type === "TRUE_FALSE" && ds.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["choices"],
        message: "Câu Đúng/Sai phải có đúng 2 lựa chọn",
      });
    }
  }
}

/** `so` đã qua kiểm của schema; ở đây chỉ chuyển ra SỐ (câu không phải nhập số ⇒ `undefined`). */
function soCuaInput(d: { type: string; so?: { dapAn: string; saiSo: string; donVi?: string; goiY?: string } }): SoNhap | undefined {
  if (d.type !== "NUMERIC" || !d.so) return undefined;
  const r = docSoNhap(d.so);
  if (!r.ok) throw new ActionError("VALIDATION", r.loi.message);
  return r.so;
}

export const taoCauHoiSchema = cauHoiBase.superRefine(kiemChoLuaChon);

export type TaoCauHoiInput = z.infer<typeof taoCauHoiSchema>;

/**
 * Cơ sở của một câu hỏi mới.
 *
 * ⚠️ Người Hội sở soạn câu DÙNG CHUNG (`null`), người cấp cơ sở soạn cho cơ sở
 * mình. Đây là chỗ nghĩa của `NULL` khác hẳn các bảng khác của module: ở
 * `TrnEnrollment` thì `NULL` là "chưa backfill", ở đây là "cả công ty".
 *
 * Không đoán khi actor thấy nhiều cơ sở mà không phải Hội sở — đoán sai là gắn câu
 * hỏi vào cơ sở khác, và nó biến mất khỏi tầm nhìn của chính người vừa tạo.
 */
export function coSoCuaCauHoi(actor: Actor): string | null {
  if (actor.isHoLevel) return null;
  if (actor.visibleCenterIds.length === 1) return actor.visibleCenterIds[0]!;
  throw new ActionError(
    "MISSING_CENTER",
    "Không xác định được cơ sở để lưu câu hỏi — liên hệ quản trị",
  );
}

export const cauHinhTaoCauHoi: ActionConfig<TaoCauHoiInput, { questionId: string }> = {
  name: "taoCauHoi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnQuestion",
  auditAction: "CREATE",
  schema: taoCauHoiSchema,
  handler: async ({ db, actor, input }) => {
    const centerId = coSoCuaCauHoi(actor);
    // ⚠️ Gọi TƯỜNG MINH, không nhờ dual-write. Dual-write cố ý không đoán khi
    // `centerId` là `null`, mà ở bảng này `null` là giá trị THẬT — nên nếu trông
    // chờ nó thì câu dùng chung sẽ có `orgUnitId` bỏ trống mà không ai để ý.
    const orgUnitId = await orgUnitIdForCenter(centerId);

    const id = await db.$transaction(async (t) => {
      const q = await t.trnQuestion.create({
        data: {
          bankPath: input.bankPath,
          type: input.type as never,
          stem: input.stem,
          explanation: input.explanation ?? null,
          difficulty: input.difficulty ?? "MEDIUM",
          skillTags: input.skillTags ?? [],
          defaultPoints: input.defaultPoints ?? 1,
          // Chỗ giữ chỗ; ghi nội dung THẬT ngay dưới, khi đã có `id` — khuôn dùng
          // chung đòi `id`, và dùng một giá trị ngẫu nhiên là làm bản ghi đổi nội
          // dung mà không đổi gì.
          contentJson: {},
          centerId,
          orgUnitId,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });

      // ⚠️ Đi QUA `dungNoiDungCauHoi`, không tự dựng hình dạng tại chỗ. Bản đầu ghi
      // `{ type: "SINGLE", choices: [...] }` — một khuôn mà đường THI không bao giờ
      // đọc được, nên mọi câu trắc nghiệm hiện ra không có nút đáp án nào và mọi
      // lượt thi treo `PENDING_GRADE` vĩnh viễn. Không gì bắt được, vì `contentJson`
      // khai `Json` và TypeScript không nối writer với reader.
      await t.trnQuestion.update({
        where: { id: q.id },
        data: {
          contentJson: dungNoiDungCauHoi({
            questionId: q.id,
            type: input.type,
            stem: input.stem,
            choices: input.choices,
            so: soCuaInput(input),
          }) as object,
        },
      });

      // ⚠️ Hai bên ghi trong CÙNG transaction. Tách ra thì một lỗi ở giữa để lại
      // câu hỏi không có lựa chọn nào — và nó vẫn hiện trong kho, vẫn thêm được
      // vào đề, rồi mới nổ lúc người học mở ra.
      if (input.choices?.length) {
        await t.trnChoice.createMany({
          data: input.choices.map((c, i) => ({
            questionId: q.id,
            text: c.text,
            isCorrect: c.isCorrect,
            orderIndex: i,
          })),
        });
      }
      return q.id;
    });

    return {
      entityId: id,
      data: { questionId: id },
      newValues: {
        bankPath: input.bankPath,
        type: input.type,
        // KHÔNG ghi `stem` hay đáp án vào audit: nhật ký audit đọc được rộng hơn
        // kho câu hỏi, và ghi đề bài vào đó là rò nội dung qua đường vòng.
        soLuaChon: input.choices?.length ?? 0,
      },
    };
  },
};

export const suaCauHoiSchema = cauHoiBase
  .extend({ questionId: z.string().min(1) })
  .strict()
  .superRefine(kiemChoLuaChon);

export type SuaCauHoiInput = z.infer<typeof suaCauHoiSchema>;

/**
 * Nạp một câu hỏi QUA `scopedDb` — chính lượt đọc đó là cổng cách ly.
 *
 * `scopedDb` không che đường ghi, nên đường ghi phải mượn một lượt ĐỌC để kiểm
 * phạm vi. Bỏ bước này thì `update` theo `id` sửa được câu của cơ sở khác.
 */
async function napCauHoi(db: ScopedDb, questionId: string) {
  const q = await db.trnQuestion.findFirst({
    where: { id: questionId, deletedAt: null },
    select: { id: true, bankPath: true, type: true, centerId: true },
  });
  if (!q) throw new ActionError("NOT_FOUND", "Không tìm thấy câu hỏi");
  return q;
}

export const cauHinhSuaCauHoi: ActionConfig<SuaCauHoiInput, { questionId: string }> = {
  name: "suaCauHoi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnQuestion",
  auditAction: "UPDATE",
  schema: suaCauHoiSchema,
  handler: async ({ db, actor, input }) => {
    const cu = await napCauHoi(db, input.questionId);
    // ⚠️ Câu DÙNG CHUNG toàn công ty đọc được từ mọi cơ sở (`NULL_IS_GLOBAL`) —
    // nhưng đọc được không có nghĩa là sửa được.
    chanGhiBanGhiChung({
      actor,
      centerId: cu.centerId,
      permission: "elearning:content:author",
      viec: "sửa câu này",
    });

    // ⚠️ Câu ĐÃ nằm trong một đề thì KHÔNG sửa tại chỗ. Sửa nội dung hay đáp án
    // của một câu đã có người thi làm LỆCH ĐIỂM của mọi lượt đã chấm, im lặng —
    // và điểm đó nằm trong hồ sơ nhân sự.
    const daDungTrongDe = await db.trnExamQuestion.findFirst({
      where: { questionId: cu.id },
      select: { id: true },
    });
    if (daDungTrongDe) {
      throw new ActionError(
        "CAU_DA_VAO_DE",
        "Câu này đã nằm trong một đề thi — nhân bản thành câu mới thay vì sửa tại chỗ",
        "questionId",
      );
    }

    await db.$transaction(async (t) => {
      await t.trnQuestion.update({
        where: { id: cu.id },
        data: {
          bankPath: input.bankPath,
          type: input.type as never,
          stem: input.stem,
          explanation: input.explanation ?? null,
          difficulty: input.difficulty ?? "MEDIUM",
          skillTags: input.skillTags ?? [],
          defaultPoints: input.defaultPoints ?? 1,
          contentJson: dungNoiDungCauHoi({
            questionId: cu.id,
            type: input.type,
            stem: input.stem,
            choices: input.choices,
            so: soCuaInput(input),
          }) as object,
        },
      });
      // Thay TRỌN bộ lựa chọn: sửa từng dòng thì `orderIndex` cũ còn sót và
      // `@@unique([questionId, orderIndex])` va khoá.
      await t.trnChoice.deleteMany({ where: { questionId: cu.id } });
      if (input.choices?.length) {
        await t.trnChoice.createMany({
          data: input.choices.map((c, i) => ({
            questionId: cu.id,
            text: c.text,
            isCorrect: c.isCorrect,
            orderIndex: i,
          })),
        });
      }
    });

    return {
      entityId: cu.id,
      data: { questionId: cu.id },
      oldValues: { bankPath: cu.bankPath, type: cu.type },
      newValues: { bankPath: input.bankPath, type: input.type },
    };
  },
};

export const xoaCauHoiSchema = z.object({ questionId: z.string().min(1) }).strict();
export type XoaCauHoiInput = z.infer<typeof xoaCauHoiSchema>;

export const cauHinhXoaCauHoi: ActionConfig<XoaCauHoiInput, { daXoa: boolean }> = {
  name: "xoaCauHoi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnQuestion",
  auditAction: "DELETE",
  schema: xoaCauHoiSchema,
  handler: async ({ db, actor, input }) => {
    const cu = await napCauHoi(db, input.questionId);
    // ⚠️ Câu DÙNG CHUNG toàn công ty đọc được từ mọi cơ sở (`NULL_IS_GLOBAL`) —
    // nhưng đọc được không có nghĩa là sửa được.
    chanGhiBanGhiChung({
      actor,
      centerId: cu.centerId,
      permission: "elearning:content:author",
      viec: "xoá câu này",
    });

    const daDungTrongDe = await db.trnExamQuestion.findFirst({
      where: { questionId: cu.id },
      select: { id: true },
    });
    if (daDungTrongDe) {
      throw new ActionError(
        "CAU_DA_VAO_DE",
        "Câu này đang nằm trong một đề thi — gỡ khỏi đề trước khi xoá",
        "questionId",
      );
    }

    // XOÁ MỀM. Xoá cứng là mất luôn ngữ cảnh của những lượt thi cũ trỏ tới nó —
    // và `TrnExamQuestion.questionId` khai `onDelete: Restrict` chính vì thế.
    await db.trnQuestion.update({
      where: { id: cu.id },
      data: { deletedAt: new Date() },
    });

    return {
      entityId: cu.id,
      data: { daXoa: true },
      oldValues: { bankPath: cu.bankPath, type: cu.type },
    };
  },
};

// ── P8/QtCauHoi — thao tác HÀNG LOẠT: chuyển nhánh + nhân bản ────────────────────────────────────────────────────────────

const dsIdCau = (toiDa: number) => z.array(z.string().min(1)).min(1, "Chưa chọn câu nào").max(toiDa, `Mỗi lần tối đa ${toiDa} câu`);

export const chuyenNhanhSchema = z.object({ questionIds: dsIdCau(200), bankPath: bankPathSchema }).strict();
export type ChuyenNhanhInput = z.infer<typeof chuyenNhanhSchema>;

/**
 * CHUYỂN NHÁNH hàng loạt: chỉ đổi `bankPath` (cách xếp trong cây kho) — KHÔNG đụng nội dung, đáp án hay điểm, nên câu đã nằm trong đề vẫn chuyển được (khác với SỬA).
 *
 * ⚠️ Cổng TRƯỚC phép ghi và TẤT CẢ HOẶC KHÔNG: chỉ cần một câu không đọc được qua `scopedDb` (không tồn tại / cơ sở khác) hoặc là câu DÙNG CHUNG mà người gọi không có quyền
 * toàn cục (`chanGhiBanGhiChung`) thì KHÔNG câu nào bị chuyển — chuyển nửa vời là để người dùng tưởng cả lô đã sang nhánh mới.
 */
export const cauHinhChuyenNhanh: ActionConfig<ChuyenNhanhInput, { soCau: number }> = {
  name: "chuyenNhanhCauHoi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnQuestion",
  auditAction: "UPDATE",
  schema: chuyenNhanhSchema,
  handler: async ({ db, actor, input }) => {
    const ids = [...new Set(input.questionIds)];
    const cu = await db.trnQuestion.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, bankPath: true, centerId: true },
    });
    if (cu.length !== ids.length) {
      throw new ActionError("NOT_FOUND", "Có câu hỏi không tìm thấy hoặc không thuộc phạm vi của bạn — chưa chuyển câu nào");
    }
    for (const q of cu) {
      chanGhiBanGhiChung({ actor, centerId: q.centerId, permission: "elearning:content:author", viec: "chuyển nhánh câu này" });
    }
    await db.trnQuestion.updateMany({ where: { id: { in: ids } }, data: { bankPath: input.bankPath } });
    return {
      entityId: ids[0]!,
      data: { soCau: ids.length },
      // KHÔNG ghi đề bài vào audit (như tạo/sửa) — chỉ nhánh cũ/mới và số câu.
      oldValues: { nhanhCu: [...new Set(cu.map((q) => q.bankPath))].slice(0, 20) },
      newValues: { bankPath: input.bankPath, soCau: ids.length },
    };
  },
};

export const nhanBanSchema = z.object({ questionIds: dsIdCau(50), bankPath: bankPathSchema.optional() }).strict();
export type NhanBanInput = z.infer<typeof nhanBanSchema>;

/**
 * NHÂN BẢN hàng loạt: tạo câu MỚI giống hệt (đề bài, đáp án, giải thích, độ khó, điểm, nhãn kỹ năng, bộ lựa chọn) — đường đúng khi câu đã nằm trong đề và không sửa tại chỗ được
 * ("câu đã nằm trong đề thi nhân bản thay vì sửa"). Bản sao thuộc CƠ SỞ NGƯỜI NHÂN BẢN (người Hội sở ⇒ dùng chung), nên nhân bản một câu dùng chung là cách một cơ sở có bản riêng để sửa.
 *
 * ⚠️ Nội dung chấm (`contentJson`) KHÔNG sao chép nguyên văn mà DỰNG LẠI qua `dungNoiDungCauHoi` với id mới (khuôn nội dung mang `id` của câu). Mọi câu nguồn được kiểm đọc được TRƯỚC khi ghi
 * câu nào (cổng trước phép ghi); một câu nhập số hỏng ⇒ từ chối cả lô. Chạy trong MỘT transaction ⇒ tất cả hoặc không câu nào.
 */
export const cauHinhNhanBan: ActionConfig<NhanBanInput, { questionIds: string[] }> = {
  name: "nhanBanCauHoi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnQuestion",
  auditAction: "CREATE",
  schema: nhanBanSchema,
  handler: async ({ db, actor, input }) => {
    const ids = [...new Set(input.questionIds)];
    const nguon = await db.trnQuestion.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        bankPath: true,
        type: true,
        stem: true,
        explanation: true,
        difficulty: true,
        skillTags: true,
        defaultPoints: true,
        contentJson: true,
        choices: { select: { text: true, isCorrect: true }, orderBy: { orderIndex: "asc" } },
      },
    });
    if (nguon.length !== ids.length) {
      throw new ActionError("NOT_FOUND", "Có câu hỏi không tìm thấy hoặc không thuộc phạm vi của bạn — chưa nhân bản câu nào");
    }
    const centerId = coSoCuaCauHoi(actor);
    const orgUnitId = await orgUnitIdForCenter(centerId);

    // Cổng TRƯỚC phép ghi đầu tiên: dựng được nội dung của MỌI câu nguồn thì mới ghi.
    const ke = nguon.map((q) => {
      const so = laCauSo(q.type) ? docCauSoTuNoiDung(q.contentJson) : null;
      if (laCauSo(q.type) && !so) {
        throw new ActionError("CAU_HONG", "Có câu nhập số không đọc được đáp án/sai số — mở câu đó ra sửa lại rồi nhân bản", "questionIds");
      }
      return { q, so };
    });

    const moiIds = await db.$transaction(async (t) => {
      const ra: string[] = [];
      for (const { q, so } of ke) {
        const moi = await t.trnQuestion.create({
          data: {
            bankPath: input.bankPath ?? q.bankPath,
            type: q.type,
            stem: q.stem,
            explanation: q.explanation,
            difficulty: q.difficulty,
            skillTags: q.skillTags,
            defaultPoints: q.defaultPoints,
            contentJson: {},
            centerId,
            orgUnitId,
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });
        await t.trnQuestion.update({
          where: { id: moi.id },
          data: {
            contentJson: dungNoiDungCauHoi({
              questionId: moi.id,
              type: q.type,
              stem: q.stem,
              choices: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect })),
              so: so ? { answer: so.answer, tolerance: so.tolerance, ...(so.unit ? { unit: so.unit } : {}), ...(so.hint ? { hint: so.hint } : {}) } : undefined,
            }) as object,
          },
        });
        if (q.choices.length > 0) {
          await t.trnChoice.createMany({
            data: q.choices.map((c, i) => ({ questionId: moi.id, text: c.text, isCorrect: c.isCorrect, orderIndex: i })),
          });
        }
        ra.push(moi.id);
      }
      return ra;
    });

    return {
      entityId: moiIds[0]!,
      data: { questionIds: moiIds },
      newValues: { soCau: moiIds.length, bankPath: input.bankPath ?? null },
    };
  },
};
