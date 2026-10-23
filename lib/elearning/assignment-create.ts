import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { LoiLuatLoc } from "@/lib/elearning/assignment-rule";
import { traTapNguoiHoc } from "@/lib/elearning/audience-query";
import { dungHangGhiDanh } from "@/lib/elearning/enrollment-rows";
import type { NguoiTrongTap } from "@/lib/elearning/audience";
import type { Actor } from "@/lib/auth/actor";
import { publishEvent } from "@/lib/events/publish";
import { phatSuKienGhiDanhMoi } from "@/lib/elearning/enrollment-events";
import { orgUnitIdForCenter } from "@/lib/org/org-service";

/**
 * EL-05 — TẠO LƯỢT GIAO và nở tập ghi danh.
 *
 * ⚠️ Quyết định đọc kỹ nhất của ticket: người thiếu `centerId` KHÔNG chặn cả lượt
 * giao. Kế hoạch nói rõ (§ hàng rào QĐ-CDA-10, dòng "Test"): *một người thiếu
 * `centerId` ⇒ 0 dòng `TrnEnrollment` cho người đó, thông báo có TÊN người đó,
 * **những người còn lại vẫn được giao đủ***.
 *
 * Chặn cả lượt giao nghe "an toàn hơn" nhưng thực tế là tê liệt: prod chỉ 4/15
 * người có `centerId`, nên Đào tạo sẽ không giao được gì cho tới khi Nhân sự vá
 * xong toàn bộ — và áp lực đó đổ lên người không gây ra lỗi.
 */

const KENH = z.enum(["IN_APP", "EMAIL"]);

export const taoLuotGiaoSchema = z
  .object({
    contentType: z.enum(["LESSON", "COURSE", "PATH"]),
    contentId: z.string().min(1),
    title: z.string().trim().min(1, "Tên lượt giao không được trống"),
    isMandatory: z.boolean().default(false),
    audienceMode: z.enum(["STATIC", "DYNAMIC"]).default("STATIC"),
    startAt: z.coerce.date().optional(),
    // ⚠️ Thứ tự nhánh: `null` đứng TRƯỚC nhánh ép kiểu. `z.coerce.date()` nuốt
    // `null` thành 1970-01-01 — một hạn chót đã quá hạn 56 năm.
    dueAt: z.union([z.null(), z.coerce.date()]).optional(),
    dueRelativeDays: z.union([z.null(), z.number().int().min(1).max(3650)]).optional(),
    dueAnchor: z.enum(["ASSIGNED_AT", "JOINED_AT"]).default("ASSIGNED_AT"),
    allowLate: z.boolean().default(false),
    // QĐ-CDA-08 — bỏ hẳn Zalo ZNS. Zod chặn kênh thứ ba ngay ở tầng nhập.
    notifyChannels: z.array(KENH).default([]),
    reminderSchedule: z.array(z.string().min(1)).default([]),
    luat: z.array(z.unknown()).max(20).default([]),
    themTayUserId: z.array(z.string().min(1)).max(500).default([]),
    loaiTruUserId: z.array(z.string().min(1)).max(500).default([]),
    completionRuleJson: z.record(z.string(), z.unknown()).default({}),
    maxAttempts: z.number().int().min(1).max(10).default(1),
    blockSeek: z.boolean().default(true),
    maxPlaybackRate: z.number().min(1).max(3).default(1.5),
  })
  .strict();

export type TaoLuotGiaoInput = z.infer<typeof taoLuotGiaoSchema>;

export type TaoLuotGiaoKetQua = {
  assignmentId: string;
  soGhiDanh: number;
  /** Nêu ĐÍCH DANH — xem luật 6. Ở quy mô 15 người thì nêu tên là làm được. */
  thieuCoSo: { fullName: string; employeeCode: string }[];
  thieuTaiKhoan: { fullName: string; employeeCode: string }[];
  khongTinhDuocHan: { fullName: string; employeeCode: string }[];
  /** Cơ sở chưa gắn đơn vị tổ chức ⇒ dòng ghi danh của người ở đó bị loại. */
  coSoChuaCoDonVi: string[];
};

const gonTen = (ds: NguoiTrongTap[]) =>
  ds.map((x) => ({ fullName: x.fullName, employeeCode: x.employeeCode }));

export const cauHinhTaoLuotGiao: ActionConfig<TaoLuotGiaoInput, TaoLuotGiaoKetQua> = {
  name: "taoLuotGiao",
  permission: "elearning:assignment:create",
  module: "elearning",
  entityType: "TrnAssignment",
  auditAction: "CREATE",
  schema: taoLuotGiaoSchema,
  handler: async ({ db, actor, input, reason }) => {
    // ── Ngoại lệ phải nhập lý do (QĐ-CDA-05 điều 1) ───────────────────────────
    // Không cấm cứng: có khoá bắt buộc mà vẫn cho nộp trễ là hợp lệ. Nhưng đó là
    // NGOẠI LỆ, nên phải có lý do và phải vào sổ audit — `requireReason` của
    // factory là cờ tĩnh nên điều kiện này kiểm ở đây.
    if (input.isMandatory && input.allowLate && !reason?.trim()) {
      throw new ActionError(
        "VALIDATION",
        "Bài BẮT BUỘC mà cho phép nộp trễ là ngoại lệ — nhập lý do",
        "reason",
      );
    }

    const courseIds = await noNoiDung(db, input.contentType, input.contentId);
    if (!courseIds.length) {
      throw new ActionError(
        "NOT_FOUND",
        "Không tìm thấy khoá học nào cho nội dung đã chọn",
        "contentId",
      );
    }

    let tap;
    try {
      tap = await traTapNguoiHoc(db, {
        luat: input.luat,
        mode: input.audienceMode,
        now: new Date(),
        themTayUserId: input.themTayUserId,
        loaiTruUserId: input.loaiTruUserId,
      });
    } catch (e) {
      if (e instanceof LoiLuatLoc) throw new ActionError(e.code, e.message, e.field);
      throw e;
    }

    // Lượt giao TĨNH mà không ai nhận gần như luôn là luật gõ sai. Lượt ĐỘNG thì
    // khác: tập rỗng hôm nay là bình thường, người mới vào sẽ rơi vào đêm sau.
    if (input.audienceMode === "STATIC" && tap.tong === 0) {
      throw new ActionError(
        "EMPTY_AUDIENCE",
        "Không có người học nào khớp — xem lại luật lọc trước khi giao",
        "luat",
      );
    }

    const centerId = await coSoCuaLuotGiao(db, actor);
    // ⚠️ `orgUnitId` gọi TƯỜNG MINH ở đây, không nhờ `lib/org/dual-write.ts`.
    // Dual-write chỉ điền được cột BỎ TRỐNG ĐƯỢC; trên hai bảng này `orgUnitId`
    // là NOT NULL nên trình biên dịch đòi giá trị, và ép kiểu để né chỉ giấu mất
    // mọi lỗi cột khác của cùng lời gọi. Dual-write tôn trọng giá trị đã set nên
    // không có nguồn ghi thứ hai (luật 1 của nó).
    const orgUnitId = await orgUnitIdForCenter(centerId);
    if (!orgUnitId) {
      throw new ActionError(
        "MISSING_CENTER",
        "Cơ sở chưa gắn với đơn vị tổ chức nào — liên hệ quản trị",
      );
    }

    const managerMap = await traTaiKhoanQuanLy(db, tap.nhan);
    const now = new Date();

    const ketQua = await db.$transaction(async (tx) => {
      const assignment = await tx.trnAssignment.create({
        data: {
          contentType: input.contentType,
          contentId: input.contentId,
          title: input.title,
          isMandatory: input.isMandatory,
          audienceMode: input.audienceMode,
          startAt: input.startAt ?? now,
          dueAt: input.dueAt ?? null,
          dueRelativeDays: input.dueRelativeDays ?? null,
          dueAnchor: input.dueAnchor,
          allowLate: input.allowLate,
          completionRuleJson: input.completionRuleJson,
          maxAttempts: input.maxAttempts,
          blockSeek: input.blockSeek,
          maxPlaybackRate: input.maxPlaybackRate,
          notifyChannels: input.notifyChannels,
          reminderSchedule: input.reminderSchedule,
          centerId,
          orgUnitId,
          createdByUserId: actor.userId,
          rules: {
            create: input.luat.map((l, i) => ({
              filterJson: l as object,
              orderIndex: i,
            })),
          },
          includes: {
            create: input.themTayUserId.map((userId) => ({
              userId,
              addedByUserId: actor.userId,
            })),
          },
          excludes: {
            create: input.loaiTruUserId.map((userId) => ({
              userId,
              addedByUserId: actor.userId,
              // Cột NOT NULL: loại trừ luôn phải có lý do đọc được, vì người bị
              // loại sẽ hỏi vì sao mình không có bài.
              reason: reason?.trim() || "Loại trừ thủ công khi tạo lượt giao",
            })),
          },
        },
        select: { id: true },
      });

      const { rows, khongTinhDuocHan } = dungHangGhiDanh({
        nguoi: tap.nhan,
        courseIds,
        assignmentId: assignment.id,
        han: {
          dueAt: input.dueAt ?? null,
          dueRelativeDays: input.dueRelativeDays ?? null,
          dueAnchor: input.dueAnchor,
        },
        now,
        managerUserIdTheoEmployeeId: managerMap,
      });

      // ⚠️ `orgUnitId` của TỪNG dòng suy từ cơ sở của NGƯỜI HỌC, không phải từ cơ
      // sở của lượt giao: một lượt giao toàn công ty (neo Hội sở) vẫn phải sinh
      // ra các dòng nằm đúng đơn vị của từng người.
      //
      // Cơ sở nào không suy được đơn vị thì DÒNG ĐÓ BỊ LOẠI, không lấy đơn vị của
      // lượt giao làm dự phòng: `orgUnitId` là cột quyết định AI NHÌN THẤY, nên
      // điền đại là xếp hồ sơ học của người này vào nhầm đơn vị — và không có
      // thông báo nào cho biết.
      const orgTheoCenter = new Map<string, string>();
      for (const cid of new Set(rows.map((r) => r.centerId))) {
        const ou = await orgUnitIdForCenter(cid);
        if (ou) orgTheoCenter.set(cid, ou);
      }
      const dungDon = rows.filter((r) => orgTheoCenter.has(r.centerId));
      const coSoChuaCoDonVi = [
        ...new Set(rows.filter((r) => !orgTheoCenter.has(r.centerId)).map((r) => r.centerId)),
      ];

      if (dungDon.length) {
        // `skipDuplicates`: `@@unique([courseId, userId, cycle])` giữ cho một
        // người không có hai lượt ghi danh cùng chu kỳ. Va khoá ở đây là chuyện
        // bình thường (giao lại khoá cũ), không phải lỗi cần dừng cả giao dịch.
        await tx.trnEnrollment.createMany({
          data: dungDon.map((r) => ({
            ...r,
            orgUnitId: orgTheoCenter.get(r.centerId)!,
          })),
          skipDuplicates: true,
        });
      }

      // Một sự kiện cho MỖI người: handler thông báo cần id lượt ghi danh để
      // dựng liên kết "vào học". Sự kiện cấp lượt giao ở dưới KHÔNG thay được
      // việc này — nó không biết ai nhận cái gì.
      await phatSuKienGhiDanhMoi(
        tx as never,
        {
          assignmentId: assignment.id,
          userIds: dungDon.map((r) => r.userId),
          tx,
        },
      );

      // Sự kiện đi TRONG giao dịch: outbox và dữ liệu cùng sống hoặc cùng chết.
      await publishEvent(
        "elearning.assignment.created",
        {
          assignmentId: assignment.id,
          audienceMode: input.audienceMode,
          soGhiDanh: dungDon.length,
          courseIds,
        },
        { tx: tx as never, dedupeKey: `assignment-created:${assignment.id}` },
      );

      return {
        assignmentId: assignment.id,
        soGhiDanh: dungDon.length,
        khongTinhDuocHan,
        coSoChuaCoDonVi,
      };
    });

    return {
      entityId: ketQua.assignmentId,
      data: {
        assignmentId: ketQua.assignmentId,
        soGhiDanh: ketQua.soGhiDanh,
        thieuCoSo: gonTen(tap.thieuCoSo),
        thieuTaiKhoan: gonTen(tap.thieuTaiKhoan),
        khongTinhDuocHan: gonTen(ketQua.khongTinhDuocHan),
        coSoChuaCoDonVi: ketQua.coSoChuaCoDonVi,
      },
      newValues: {
        title: input.title,
        contentType: input.contentType,
        audienceMode: input.audienceMode,
        isMandatory: input.isMandatory,
        allowLate: input.allowLate,
        soGhiDanh: ketQua.soGhiDanh,
        soThieuCoSo: tap.thieuCoSo.length,
      },
    };
  },
};

/** LESSON nở về khoá chứa bài; PATH nở thành các khoá thành viên (§ TrnEnrollment). */
async function noNoiDung(
  db: ScopedDb,
  contentType: "LESSON" | "COURSE" | "PATH",
  contentId: string,
): Promise<string[]> {
  if (contentType === "COURSE") return [contentId];
  if (contentType === "LESSON") {
    const l = (await db.trnLesson.findFirst({
      where: { id: contentId, deletedAt: null },
      select: { module: { select: { courseId: true } } },
    })) as { module: { courseId: string } } | null;
    return l ? [l.module.courseId] : [];
  }
  const ds = (await db.trnCourse.findMany({
    where: { programId: contentId, deletedAt: null },
    select: { id: true },
  })) as { id: string }[];
  return ds.map((x) => x.id);
}

/**
 * Cơ sở của LƯỢT GIAO (không phải của người học).
 *
 * Người Hội sở không mang cơ sở nào, nhưng `TrnAssignment.centerId` là cột NOT
 * NULL nên lượt giao toàn công ty neo về Hội sở. Điều này KHÔNG nới cách ly: dữ
 * liệu học cách ly theo `centerId` của TỪNG dòng `TrnEnrollment`, lấy theo cơ sở
 * của NGƯỜI HỌC (xem `enrollment-rows.ts`).
 */
async function coSoCuaLuotGiao(db: ScopedDb, actor: Actor): Promise<string> {
  if (!actor.isHoLevel) {
    // Người cấp cơ sở nhìn thấy đúng một cơ sở là trường hợp thường. Thấy nhiều
    // mà không phải Hội sở thì KHÔNG đoán — đoán sai là gắn lượt giao vào cơ sở
    // khác, và nó biến mất khỏi tầm nhìn của chính người vừa tạo.
    if (actor.visibleCenterIds.length === 1) return actor.visibleCenterIds[0]!;
    throw new ActionError(
      "MISSING_CENTER",
      "Không xác định được cơ sở của lượt giao — liên hệ quản trị",
    );
  }
  const c = await db.center.findFirst({
    where: { code: "HO" },
    select: { id: true },
  });
  if (!c) {
    throw new ActionError(
      "MISSING_CENTER",
      "Chưa có cơ sở Hội sở (mã HO) trong hệ thống — liên hệ quản trị",
    );
  }
  return c.id;
}

async function traTaiKhoanQuanLy(
  db: ScopedDb,
  nguoi: NguoiTrongTap[],
): Promise<Record<string, string>> {
  const ids = [...new Set(nguoi.map((n) => n.managerId).filter((x): x is string => !!x))];
  if (!ids.length) return {};
  const rows = (await db.user.findMany({
    where: { employeeId: { in: ids } },
    select: { id: true, employeeId: true },
  })) as { id: string; employeeId: string | null }[];
  const map: Record<string, string> = {};
  for (const r of rows) if (r.employeeId) map[r.employeeId] = r.id;
  return map;
}
