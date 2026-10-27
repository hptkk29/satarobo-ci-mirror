import { z } from "zod";
import type { ActionConfig } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { trnRequirementCreateSchema } from "@/lib/validators/elearning";
import { khopYeuCau } from "@/lib/elearning/requirement-match";
import { publishEvent } from "@/lib/events/publish";
import type { ScopedDb } from "@/lib/actions/factory";

/** Trần số người phát sự kiện trong MỘT lần khai — xem `phatChoNguoiKhop`. */
const TRAN_PHAT = 500;

/**
 * EL-17 — KHAI và ĐÓNG yêu cầu đào tạo (`TrnRequirement`).
 *
 * Bảng này đã có từ EL-03 (GĐ1) và `trnRequirementCreateSchema` đã viết xong ở đó,
 * nhưng **không action nào dùng** — khoá quyền `elearning:requirement:manage` cũng
 * chưa được gọi ở đâu. Tức mẫu số của toàn bộ North Star Metric chỉ khai được bằng
 * seed hoặc SQL tay. Đây là ticket mở cửa đó.
 *
 * ⚠️ Yêu cầu đào tạo là thứ NẶNG nhất trong module về hệ quả: nó quyết định ai phải
 * học gì, ai bị đếm là chưa tuân thủ, và tên ai xuất hiện trên báo cáo gửi quản lý
 * trực tiếp. Vì vậy: quyền riêng, lý do bắt buộc, và ĐÓNG chứ không xoá (`status = ARCHIVED`).
 */

/**
 * Vai này có ra được nghĩa vụ TOÀN CÔNG TY không.
 *
 * Đọc `scopeType` của bản ghi phân quyền (chính sách), KHÔNG đọc `centerScope` (chỗ
 * người ta ngồi). Xem khối chú thích dài trong `handler` để biết vì sao phân biệt
 * này quan trọng.
 */
function coQuyenRaNghiaVuToanCongTy(actor: {
  isSuperAdmin: boolean;
  permissions: readonly { action: string; scopeType: string }[];
}): boolean {
  if (actor.isSuperAdmin) return true;
  return actor.permissions.some(
    (p) => p.action === "elearning:requirement:manage" && p.scopeType === "GLOBAL",
  );
}

/**
 * ĐÓNG chứ không xoá.
 *
 * Một yêu cầu đã áp cho người ta trong sáu tháng là một phần của lịch sử tuân thủ:
 * xoá nó làm mọi báo cáo cũ đổi nghĩa hồi tố, và những lượt học sinh ra vì nó bỗng
 * không giải thích được. Đặt `effectiveTo` + `status = ARCHIVED` giữ được cả hai câu:
 * "từng áp" và "nay thôi".
 */
const dongSchema = z
  .object({
    requirementId: z.string().min(1),
  })
  .strict();

export type DongYeuCauInput = z.infer<typeof dongSchema>;

export const cauHinhKhaiYeuCau: ActionConfig<
  z.infer<typeof trnRequirementCreateSchema>,
  { requirementId: string; canhBao: string | null }
> = {
  name: "khaiYeuCauDaoTao",
  permission: "elearning:requirement:manage",
  module: "elearning",
  entityType: "TrnRequirement",
  auditAction: "CREATE",
  // Khai một yêu cầu là ra một nghĩa vụ cho người khác — phải nói vì sao, và câu ấy
  // đi vào AuditLog để sau này còn trả lời được "ai bắt tôi học cái này".
  requireReason: true,
  schema: trnRequirementCreateSchema,
  handler: async ({ db, actor, input }) => {
    const khoa = await db.trnCourse.findFirst({
      where: { id: input.courseId },
      select: { id: true, title: true },
    });
    if (!khoa) {
      throw new ActionError("NOT_FOUND", "Không tìm thấy khoá này", "courseId");
    }

    // ⚠️ KHÔNG dùng `chanGhiBanGhiChung` ở đây — tôi đã dùng, và nó SAI.
    //
    // Guard ấy hỏi "người này có NEO ở Hội sở không" (`centerScope === "ALL"`, mà
    // `lib/auth/actor.ts:339` suy thẳng từ `hoRoot`, không đọc `scopeType`). Câu hỏi
    // đó đúng cho nội dung dùng chung ở EL-14 — đề thi, kho câu hỏi, khung chấm — nơi
    // "ai được sửa bản chung" thật sự là chuyện cấp bậc trong cây đơn vị.
    //
    // Ở đây nó chặn nhầm cả vai: `elearning:requirement:manage` chỉ thuộc SUPER_ADMIN,
    // HO_HR và TRAINING — ba chức năng cấp công ty — nhưng người làm Đào tạo NGỒI ở
    // một cơ sở, nên họ neo ở CS1 và `centerScope` của họ không phải "ALL". Kết quả
    // đo bằng e2e: người Đào tạo không khai được một yêu cầu nào, tức bị chặn khỏi
    // đúng việc duy nhất mà quyền ấy tồn tại để làm.
    //
    // Và cách "chữa" hiển nhiên — neo họ ở Hội sở — chính là thứ US-05 đã thử rồi
    // phải gỡ: neo ở HO biến họ thành `isHoLevel` và họ thấy MỌI cơ sở. Nới quyền
    // để lách một guard là đi lùi.
    //
    // Câu hỏi ĐÚNG là: vai của người này có giữ quyền ấy ở tầm TOÀN CỤC không. Đọc
    // `scopeType` của chính bản ghi phân quyền, không đọc chỗ họ ngồi. Vẫn fail-closed:
    // mai kia ai đó cấp quyền này cho một vai cấp cơ sở, nhánh dưới chặn ngay.
    if (!coQuyenRaNghiaVuToanCongTy(actor)) {
      throw new ActionError(
        "PERMISSION_DENIED",
        "Yêu cầu đào tạo áp cho toàn công ty — chỉ vai có quyền ở tầm toàn hệ thống mới ra được. Liên hệ Hội sở.",
      );
    }

    // Trùng lặp: cùng khoá + cùng phạm vi + cùng đích = cùng một nghĩa vụ. Model đã
    // có `@@unique`, nhưng bắt ở đây để trả câu tiếng Việt thay vì P2002.
    const trung = await db.trnRequirement.findFirst({
      where: {
        courseId: input.courseId,
        scopeKind: input.scopeKind,
        positionId: input.positionId ?? null,
        departmentId: input.departmentId ?? null,
        levelTag: input.levelTag ?? null,
        orgUnitId: input.orgUnitId ?? null,
        status: "ACTIVE",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (trung) {
      throw new ActionError(
        "CONFLICT",
        `Đã có một yêu cầu ĐANG HIỆU LỰC y hệt cho khoá "${khoa.title}" với phạm vi này`,
      );
    }

    const yc = await db.trnRequirement.create({
      data: {
        courseId: input.courseId,
        scopeKind: input.scopeKind,
        positionId: input.positionId ?? null,
        departmentId: input.departmentId ?? null,
        levelTag: input.levelTag ?? null,
        orgUnitId: input.orgUnitId ?? null,
        dueDays: input.dueDays,
        validityMonths: input.validityMonths ?? null,
        effectiveFrom: input.effectiveFrom ?? new Date(),
        effectiveTo: input.effectiveTo ?? null,
        status: input.status,
        createdByUserId: actor.userId,
        centerId: input.centerId ?? null,
      },
      select: { id: true },
    });

    // ⚠️ PHÁT sự kiện cho TỪNG NGƯỜI mà yêu cầu này áp — đây là nửa "auto-enroll"
    // của EL-18, và không có nó thì kích hoạt `YEU_CAU_MOI_AP_DUNG` là một luật CHẾT:
    // khai được, bật được, không bao giờ chạy.
    //
    // Đi qua sự kiện chứ không giao thẳng ở đây: giao bài là việc của cỗ máy luật
    // (nó biết luật nào đang bật, hạn bao nhiêu, và ghi nhật ký thi hành). Nhét vào
    // đây là chép cỗ máy ấy ra chỗ thứ hai.
    const daPhat = await phatChoNguoiKhop(db, yc.id, input, actor.userId);

    return {
      entityId: yc.id,
      // Cảnh báo phạm vi tính ở TẦNG MÀN HÌNH (nó cần đếm người, mà phép đếm ấy đi
      // qua `scopedDb` của người đang xem). Ở đây trả `null` và để màn hình lấp —
      // action không đoán hộ.
      data: { requirementId: yc.id, canhBao: null, soNguoiApDung: daPhat },
      paths: ["/elearning/yeu-cau", "/elearning/ma-tran"],
    };
  },
};

/**
 * Phát `elearning.requirement.applied` cho mọi người mà yêu cầu vừa khai áp tới.
 *
 * ⚠️ Có TRẦN (`TRAN_PHAT`). Ở quy mô 15 người thì trần không bao giờ chạm tới, nhưng
 * một yêu cầu `ALL_STAFF` ở quy mô vài nghìn sẽ sinh vài nghìn sự kiện trong một
 * request — và request ấy là một người đang ngồi đợi biểu mẫu phản hồi. Chạm trần thì
 * NÓI RA (trả về số đã phát), không lặng lẽ cắt.
 */
async function phatChoNguoiKhop(
  db: ScopedDb,
  requirementId: string,
  input: { scopeKind: string; departmentId?: string | null; orgUnitId?: string | null },
  boiUserId: string,
): Promise<number> {
  const nhanSu = await db.employee.findMany({
    where: { isActive: true, status: "ACTIVE", userAccount: { is: {} } },
    select: {
      departmentId: true,
      orgUnitId: true,
      userAccount: { select: { id: true } },
    },
    take: TRAN_PHAT,
  });

  const idDonVi = [
    ...new Set(
      [...nhanSu.map((n) => n.orgUnitId), input.orgUnitId ?? null].filter(
        (v): v is string => v != null,
      ),
    ),
  ];
  const pathCua = new Map(
    idDonVi.length === 0
      ? []
      : (
          await db.orgUnit.findMany({
            where: { id: { in: idDonVi } },
            select: { id: true, path: true },
          })
        ).map((r) => [r.id, r.path] as const),
  );

  const yeuCau = [
    {
      id: requirementId,
      scopeKind: input.scopeKind,
      positionId: null,
      departmentId: input.departmentId ?? null,
      levelTag: null,
      orgUnitPath: input.orgUnitId ? (pathCua.get(input.orgUnitId) ?? null) : null,
      validityMonths: null,
    },
  ];

  let so = 0;
  for (const n of nhanSu) {
    const userId = n.userAccount?.id;
    if (!userId) continue;
    const kq = khopYeuCau(
      {
        userId,
        departmentId: n.departmentId,
        orgUnitPath: n.orgUnitId ? (pathCua.get(n.orgUnitId) ?? null) : null,
        positionId: null,
      },
      yeuCau,
    );
    if (kq.apDung.length === 0) continue;
    await publishEvent(
      "elearning.requirement.applied",
      { requirementId, userId, boiUserId },
      { dedupeKey: `el.req.applied:${requirementId}:${userId}` },
    );
    so += 1;
  }
  return so;
}

export const cauHinhDongYeuCau: ActionConfig<
  DongYeuCauInput,
  { requirementId: string }
> = {
  name: "dongYeuCauDaoTao",
  permission: "elearning:requirement:manage",
  module: "elearning",
  entityType: "TrnRequirement",
  auditAction: "UPDATE",
  requireReason: true,
  schema: dongSchema,
  handler: async ({ db, input }) => {
    const yc = await db.trnRequirement.findFirst({
      where: { id: input.requirementId },
      select: { id: true, status: true, centerId: true },
    });
    if (!yc) throw new ActionError("NOT_FOUND", "Không tìm thấy yêu cầu này");
    if (yc.status !== "ACTIVE") {
      throw new ActionError("CONFLICT", "Yêu cầu này đã đóng trước đó rồi");
    }

    const now = new Date();
    await db.trnRequirement.update({
      where: { id: yc.id },
      data: {
        // Enum `TrnReqStatus` là DRAFT/ACTIVE/ARCHIVED — không có `CLOSED`.
        // `ARCHIVED` là giá trị mang đúng nghĩa "từng áp, nay thôi"; đẻ thêm một
        // giá trị enum chỉ để đọc êm tai là bắt mọi truy vấn hiện có phải biết thêm
        // một trạng thái nữa.
        status: "ARCHIVED",
        // ⚠️ Đặt `effectiveTo = HÔM NAY`, không lùi về quá khứ. Lùi ngày là xoá bỏ
        // hồi tố quãng thời gian yêu cầu ĐÃ áp, và mọi báo cáo của quãng ấy đổi nghĩa.
        effectiveTo: now,
      },
    });

    return {
      entityId: yc.id,
      data: { requirementId: yc.id },
      paths: ["/elearning/yeu-cau", "/elearning/ma-tran"],
    };
  },
};
