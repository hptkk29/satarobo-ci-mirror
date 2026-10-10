import { z } from "zod";
import type { ActionConfig, ScopedDb } from "@/lib/actions/factory";
import { ActionError } from "@/lib/actions/factory";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { dungHaiPhaGhiThuTu } from "@/lib/elearning/course-outline";
import { coSoCuaCauHoi } from "@/lib/elearning/question-bank";
import {
  dsMucSchema,
  kiemKhung,
  type Muc,
} from "@/lib/elearning/rubric-shape";
import { chanGhiBanGhiChung } from "@/lib/elearning/global-write-guard";

/**
 * Máy khách BỎ QUA phạm vi, dùng DUY NHẤT để hỏi "mã này có ai dùng chưa".
 *
 * ⚠️ `bypass: true` ở đây là có chủ đích và hẹp: `TrnRubric.code` là `@unique` toàn
 * hệ thống, nên phép kiểm trùng phải nhìn được cả bản ghi ngoài tầm của actor —
 * nếu không thì nó luôn báo "không trùng" và lượt ghi va thẳng vào khoá DB. Lượt
 * đọc này chỉ `select: { id }` và không trả gì của cơ sở khác ra ngoài.
 */
function taoDbBoQuaPhamVi(actor: Actor) {
  return scopedDb(actor, { bypass: true });
}

/**
 * EL-15b — DỰNG KHUNG CHẤM.
 *
 * ⚠️ Khung có hai đời sống, và ranh giới giữa chúng là thứ phải giữ chặt nhất —
 * cùng luật với đề thi, cùng lý do:
 *
 *  · **nháp** (`status = DRAFT`) — sửa gì cũng được;
 *  · **đã kích hoạt** (`ACTIVE`) — bộ tiêu chí, thang điểm và ngưỡng ĐÓNG BĂNG.
 *
 * Sửa tiêu chí của một khung đã chấm bài làm LỆCH ĐIỂM của mọi bài đã chấm, im
 * lặng — và điểm đó nằm trong hồ sơ nhân sự. `TrnRubricScore` trỏ `criterionId`,
 * nên xoá một tiêu chí là cắt luôn đường về của những điểm đã chấm.
 *
 * ⚠️ KHÔNG có khoá quyền thứ 18. Dựng khung dùng `elearning:content:author`, kích
 * hoạt dùng `elearning:content:publish` — y hệt đề thi, vì đây cũng là soạn và phát
 * hành nội dung giảng dạy.
 */

// ── Khung ──────────────────────────────────────────────────────────────────

const khungBaseSchema = z
  .object({
    /**
     * Mã khung, DUY NHẤT toàn hệ thống. Chữ hoa, số, gạch ngang.
     *
     * Có mã để người ta gọi tên khung trong tài liệu và biên bản mà không phải chép
     * một chuỗi `cuid` — và để đổi tên hiển thị không làm mất dấu vết.
     */
    code: z
      .string()
      .trim()
      .min(3, "Mã khung quá ngắn")
      .max(40)
      .regex(/^[A-Z0-9-]+$/, "Mã khung chỉ gồm chữ IN HOA, số và gạch ngang"),
    title: z.string().trim().min(3, "Tên khung quá ngắn").max(200),
    totalPoints: z.number().int().min(1).max(10_000),
    passPoints: z.number().int().min(0).max(10_000),
  })
  .strict();

export const taoKhungSchema = khungBaseSchema;
export type TaoKhungInput = z.infer<typeof taoKhungSchema>;

export const cauHinhTaoKhung: ActionConfig<TaoKhungInput, { rubricId: string }> = {
  name: "taoKhungCham",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubric",
  auditAction: "CREATE",
  schema: taoKhungSchema,
  handler: async ({ db, actor, input }) => {
    const centerId = coSoCuaCauHoi(actor);
    // ⚠️ Gọi TƯỜNG MINH. Dual-write cố ý không đoán khi `centerId` là `null`, mà ở
    // bảng này `null` là giá trị THẬT (khung dùng chung toàn công ty) — trông chờ
    // nó thì khung chung có `orgUnitId` bỏ trống mà không ai để ý.
    const orgUnitId = await orgUnitIdForCenter(centerId);

    // Ngưỡng vượt thang là khung KHÔNG AI qua nổi. Chặn ngay lúc TẠO chứ không đợi
    // tới lúc kích hoạt: người soạn vừa gõ hai con số đó xong, họ sửa được ngay.
    if (input.passPoints > input.totalPoints) {
      throw new ActionError(
        "NGUONG_VUOT_THANG",
        `Ngưỡng đạt (${input.passPoints}) lớn hơn thang điểm (${input.totalPoints}) — không ai qua được`,
        "passPoints",
      );
    }

    // ⚠️ Lượt kiểm trùng phải BỎ QUA phạm vi cơ sở.
    //
    // `code` là `@unique` TOÀN HỆ THỐNG, nhưng `db` ở đây là `scopedDb` — người ở
    // CS1 sẽ KHÔNG THẤY khung của CS2, nên phép kiểm báo "không trùng" rồi `create`
    // va thẳng vào khoá. `P2002` không phải `ActionError` nên `runAction` ném tiếp
    // ra ngoài: không toast, không lỗi trỏ vào ô mã, chỉ một lỗi 500 câm.
    //
    // `bypass: true` ở đây an toàn và hẹp: chỉ hỏi "mã này có ai dùng chưa", select
    // đúng `id`, không trả về gì của cơ sở khác. Thông báo cũng chỉ nói "mã đã
    // dùng", không nói khung nào của ai.
    const trung = await taoDbBoQuaPhamVi(actor).trnRubric.findFirst({
      where: { code: input.code },
      select: { id: true },
    });
    if (trung) {
      throw new ActionError(
        "MA_DA_DUNG",
        `Mã "${input.code}" đã có khung khác dùng — chọn mã khác`,
        "code",
      );
    }

    let khung: { id: string };
    try {
      khung = await db.trnRubric.create({
        data: {
          code: input.code,
          title: input.title,
          totalPoints: input.totalPoints,
          passPoints: input.passPoints,
          status: "DRAFT",
          ownerUserId: actor.userId,
          centerId,
          orgUnitId,
        },
        select: { id: true },
      });
    } catch (e) {
      // Lưới đỡ cho ca hai người cùng gõ một mã trong cùng một khoảnh khắc: phép
      // kiểm ở trên chạy TRƯỚC lượt ghi, nên nó không đóng được cửa sổ đó.
      if (laVaKhoa(e, "code")) {
        throw new ActionError(
          "MA_DA_DUNG",
          `Mã "${input.code}" đã có khung khác dùng — chọn mã khác`,
          "code",
        );
      }
      throw e;
    }

    return {
      entityId: khung.id,
      data: { rubricId: khung.id },
      newValues: {
        code: input.code,
        title: input.title,
        totalPoints: input.totalPoints,
        passPoints: input.passPoints,
      },
    };
  },
};

type TxDb = Parameters<Parameters<ScopedDb["$transaction"]>[0]>[0];

/**
 * Va khoá DUY NHẤT trên một cột cụ thể.
 *
 * ⚠️ Đọc `e.code`, KHÔNG soi chuỗi thông báo: Prisma đặt mã ở `code`, còn `message`
 * không chứa "P2002". Một nhánh bắt lỗi soi chuỗi sẽ không bao giờ chạy — repo đã
 * mắc đúng lỗi đó một lần.
 */
function laVaKhoa(e: unknown, cot: string): boolean {
  const p = e as { code?: string; meta?: { target?: unknown } };
  if (p?.code !== "P2002") return false;
  const t = p.meta?.target;
  const ds = Array.isArray(t) ? t.map(String) : typeof t === "string" ? [t] : [];
  return ds.some((x) => x.includes(cot));
}

/**
 * Nạp khung QUA `scopedDb`.
 *
 * ⚠️ Lượt đọc này là cổng cách ly cho khung CÓ CƠ SỞ, và CHỈ cho khung có cơ sở.
 * `TrnRubric` nằm trong `NULL_IS_GLOBAL_MODELS` nên khung dùng chung
 * (`centerId = null`) lọt qua nó với MỌI actor — cố ý, để kho chung không tàng
 * hình. Mượn nó làm cổng GHI là biến "ai cũng đọc được" thành "ai cũng sửa được".
 * Vì vậy mọi đường ghi còn phải gọi `chanGhiBanGhiChung`.
 */
async function napKhung(db: ScopedDb, rubricId: string) {
  const khung = await db.trnRubric.findFirst({
    where: { id: rubricId, deletedAt: null },
    select: {
      id: true,
      code: true,
      title: true,
      status: true,
      totalPoints: true,
      passPoints: true,
      // ⚠️ PHẢI đọc `centerId`: lượt đọc này KHÔNG phải cổng ghi cho khung dùng
      // chung. Xem `chanGhiBanGhiChung`.
      centerId: true,
    },
  });
  if (!khung) throw new ActionError("NOT_FOUND", "Không tìm thấy khung chấm");
  return khung;
}

/**
 * Khung đã KHOÁ chưa.
 *
 * ⚠️ Khoá theo `status`, KHÔNG theo "đã chấm bài nào chưa". Đợi tới bài đầu tiên
 * mới khoá nghĩa là người soạn sửa được khung trong khoảng giữa lúc phát cho người
 * học và lúc người đầu tiên nộp — và hai người cùng nộp một bài bị chấm bằng hai
 * thước mà bảng điểm coi như một.
 */
function chanKhiDaKichHoat(
  khung: { status: string },
  viec: string,
): void {
  if (khung.status !== "DRAFT") {
    throw new ActionError(
      "KHUNG_DA_KICH_HOAT",
      `Khung đã kích hoạt — không ${viec} được nữa. Tạo khung mới nếu cần thay đổi.`,
    );
  }
}

export const suaKhungSchema = khungBaseSchema
  .extend({ rubricId: z.string().min(1) })
  .strict();
export type SuaKhungInput = z.infer<typeof suaKhungSchema>;

export const cauHinhSuaKhung: ActionConfig<SuaKhungInput, { id: string }> = {
  name: "suaKhungCham",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubric",
  auditAction: "UPDATE",
  schema: suaKhungSchema,
  handler: async ({ db, actor, input }) => {
    const khung = await napKhung(db, input.rubricId);
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:author",
      viec: "sửa khung này",
    });
    chanKhiDaKichHoat(khung, "sửa thông số");

    if (input.passPoints > input.totalPoints) {
      throw new ActionError(
        "NGUONG_VUOT_THANG",
        `Ngưỡng đạt (${input.passPoints}) lớn hơn thang điểm (${input.totalPoints}) — không ai qua được`,
        "passPoints",
      );
    }

    if (input.code !== khung.code) {
      // Cùng lý do với đường TẠO: `scopedDb` mù mã của cơ sở khác.
      const trung = await taoDbBoQuaPhamVi(actor).trnRubric.findFirst({
        where: { code: input.code, NOT: { id: khung.id } },
        select: { id: true },
      });
      if (trung) {
        throw new ActionError(
          "MA_DA_DUNG",
          `Mã "${input.code}" đã có khung khác dùng — chọn mã khác`,
          "code",
        );
      }
    }

    try {
      await db.trnRubric.update({
        where: { id: khung.id },
        data: {
          code: input.code,
          title: input.title,
          totalPoints: input.totalPoints,
          passPoints: input.passPoints,
        },
      });
    } catch (e) {
      if (laVaKhoa(e, "code")) {
        throw new ActionError(
          "MA_DA_DUNG",
          `Mã "${input.code}" đã có khung khác dùng — chọn mã khác`,
          "code",
        );
      }
      throw e;
    }

    return {
      entityId: khung.id,
      data: { id: khung.id },
      oldValues: {
        code: khung.code,
        title: khung.title,
        totalPoints: khung.totalPoints,
        passPoints: khung.passPoints,
      },
      newValues: {
        code: input.code,
        title: input.title,
        totalPoints: input.totalPoints,
        passPoints: input.passPoints,
      },
    };
  },
};

// ── Tiêu chí ───────────────────────────────────────────────────────────────

const tieuChiBaseSchema = z
  .object({
    label: z.string().trim().min(2, "Tên tiêu chí quá ngắn").max(200),
    description: z.union([z.null(), z.string().trim().max(2000)]).optional(),
    levels: dsMucSchema,
  })
  .strict();

export const themTieuChiSchema = tieuChiBaseSchema
  .extend({ rubricId: z.string().min(1) })
  .strict();
export type ThemTieuChiInput = z.infer<typeof themTieuChiSchema>;

export const cauHinhThemTieuChi: ActionConfig<
  ThemTieuChiInput,
  { criterionId: string }
> = {
  name: "themTieuChi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubricCriterion",
  auditAction: "CREATE",
  schema: themTieuChiSchema,
  handler: async ({ db, actor, input }) => {
    const khung = await napKhung(db, input.rubricId);
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:author",
      viec: "thêm tiêu chí cho khung này",
    });
    chanKhiDaKichHoat(khung, "thêm tiêu chí");

    const cuoi = await db.trnRubricCriterion.findFirst({
      where: { rubricId: khung.id },
      orderBy: { orderIndex: "desc" },
      select: { orderIndex: true },
    });

    // `weight` = điểm mức CAO NHẤT của tiêu chí. Giữ một cột suy được để báo cáo và
    // màn soạn khỏi phải mở `levelsJson` ra tính lại — nhưng nó KHÔNG phải nguồn
    // sự thật: phép cộng thang điểm luôn đọc `levelsJson`.
    //
    // KHÔNG cần `Math.round`: điểm mức đã là số nguyên ở tầng Zod. Làm tròn ở đây
    // từng là chỗ audit ghi một con số KHÁC con số đã lưu — CREATE ghi bản chưa làm
    // tròn, UPDATE ghi bản đã làm tròn, và dấu vết kiểm toán sinh ra một thay đổi
    // không ai thực hiện.
    const weight = Math.max(...input.levels.map((m: Muc) => m.points));

    // ⚠️ Đọc `orderIndex` lớn nhất rồi mới ghi là một cửa sổ đua: hai tab cùng thêm
    // tiêu chí sẽ tính ra cùng một số và va `@@unique([rubricId, orderIndex])`.
    // `P2002` không phải `ActionError` nên nó thoát khỏi `runAction` thành lỗi 500
    // câm — người soạn thấy nút quay tít rồi thôi, không biết đã lưu hay chưa.
    let tc: { id: string };
    try {
      tc = await db.trnRubricCriterion.create({
        data: {
          rubricId: khung.id,
          label: input.label,
          description: input.description ?? null,
          weight,
          orderIndex: (cuoi?.orderIndex ?? -1) + 1,
          levelsJson: input.levels,
        },
        select: { id: true },
      });
    } catch (e) {
      if (laVaKhoa(e, "orderIndex")) {
        throw new ActionError(
          "DANG_CO_NGUOI_SUA",
          "Có người vừa thêm tiêu chí cho khung này — tải lại trang rồi thêm lại",
        );
      }
      throw e;
    }

    return {
      entityId: tc.id,
      data: { criterionId: tc.id },
      newValues: { rubricId: khung.id, label: input.label, weight },
    };
  },
};

export const suaTieuChiSchema = tieuChiBaseSchema
  .extend({ criterionId: z.string().min(1) })
  .strict();
export type SuaTieuChiInput = z.infer<typeof suaTieuChiSchema>;

/**
 * Nạp tiêu chí QUA khung của nó — cổng cách ly nằm ở bảng CHA.
 *
 * ⚠️ `TrnRubricCriterion` KHÔNG mang cột đơn vị (đúng thiết kế), nên `scopedDb`
 * không lọc gì trên nó. Đọc thẳng bằng `criterionId` là sửa được tiêu chí của cơ
 * sở khác — cùng bẫy với các bảng con của đề thi.
 */
async function napTieuChi(db: ScopedDb, criterionId: string) {
  const tc = await db.trnRubricCriterion.findFirst({
    where: { id: criterionId },
    select: {
      id: true,
      rubricId: true,
      label: true,
      orderIndex: true,
      weight: true,
    },
  });
  if (!tc) throw new ActionError("NOT_FOUND", "Không tìm thấy tiêu chí");
  // Lượt đọc NÀY mới là cổng: khung đi qua `scopedDb`.
  const khung = await napKhung(db, tc.rubricId);
  return { tc, khung };
}

export const cauHinhSuaTieuChi: ActionConfig<SuaTieuChiInput, { id: string }> = {
  name: "suaTieuChi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubricCriterion",
  auditAction: "UPDATE",
  schema: suaTieuChiSchema,
  handler: async ({ db, actor, input }) => {
    const { tc, khung } = await napTieuChi(db, input.criterionId);
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:author",
      viec: "sửa tiêu chí của khung này",
    });
    chanKhiDaKichHoat(khung, "sửa tiêu chí");

    const weight = Math.max(...input.levels.map((m: Muc) => m.points));

    await db.trnRubricCriterion.update({
      where: { id: tc.id },
      data: {
        label: input.label,
        description: input.description ?? null,
        weight,
        levelsJson: input.levels,
      },
    });

    return {
      entityId: tc.id,
      data: { id: tc.id },
      oldValues: { label: tc.label, weight: tc.weight },
      newValues: { label: input.label, weight },
    };
  },
};

export const xoaTieuChiSchema = z
  .object({ criterionId: z.string().min(1) })
  .strict();
export type XoaTieuChiInput = z.infer<typeof xoaTieuChiSchema>;

export const cauHinhXoaTieuChi: ActionConfig<XoaTieuChiInput, { id: string }> = {
  name: "xoaTieuChi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubricCriterion",
  auditAction: "DELETE",
  schema: xoaTieuChiSchema,
  handler: async ({ db, actor, input }) => {
    const { tc, khung } = await napTieuChi(db, input.criterionId);
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:author",
      viec: "xoá tiêu chí của khung này",
    });
    chanKhiDaKichHoat(khung, "xoá tiêu chí");

    await db.trnRubricCriterion.delete({ where: { id: tc.id } });

    return {
      entityId: tc.id,
      data: { id: tc.id },
      oldValues: { rubricId: khung.id, label: tc.label },
    };
  },
};

export const sapXepTieuChiSchema = z
  .object({
    rubricId: z.string().min(1),
    thuTu: z.array(z.string().min(1)).min(1).max(100),
  })
  .strict();
export type SapXepTieuChiInput = z.infer<typeof sapXepTieuChiSchema>;

export const cauHinhSapXepTieuChi: ActionConfig<
  SapXepTieuChiInput,
  { soTieuChi: number }
> = {
  name: "sapXepTieuChi",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnRubric",
  auditAction: "UPDATE",
  schema: sapXepTieuChiSchema,
  handler: async ({ db, actor, input }) => {
    const khung = await napKhung(db, input.rubricId);
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:author",
      viec: "sắp xếp tiêu chí của khung này",
    });
    chanKhiDaKichHoat(khung, "sắp xếp tiêu chí");

    const hienCo = await db.trnRubricCriterion.findMany({
      where: { rubricId: khung.id },
      select: { id: true },
    });
    const tapHienCo = new Set(hienCo.map((x) => x.id));

    // ⚠️ Danh sách gửi lên phải PHỦ ĐỦ và KHÔNG THỪA. Thiếu một id thì tiêu chí đó
    // giữ `orderIndex` cũ và chen vào giữa các số mới — thứ tự trên màn hình khác
    // thứ tự trong DB, và không gì báo.
    if (
      input.thuTu.length !== hienCo.length ||
      new Set(input.thuTu).size !== input.thuTu.length ||
      input.thuTu.some((id) => !tapHienCo.has(id))
    ) {
      throw new ActionError(
        "THU_TU_KHONG_KHOP",
        "Danh sách sắp xếp không khớp bộ tiêu chí hiện tại — tải lại trang rồi thử lại",
        "thuTu",
      );
    }

    // Hai pha: `@@unique([rubricId, orderIndex])` đụng nhau nếu ghi thẳng số mới
    // đè lên số cũ. Pha 1 đẩy hết sang miền âm, pha 2 hạ về số thật.
    const { pha1, pha2 } = dungHaiPhaGhiThuTu(input.thuTu);
    await db.$transaction(async (t: TxDb) => {
      for (const b of pha1) {
        await t.trnRubricCriterion.update({
          where: { id: b.id },
          data: { orderIndex: b.orderIndex },
        });
      }
      for (const b of pha2) {
        await t.trnRubricCriterion.update({
          where: { id: b.id },
          data: { orderIndex: b.orderIndex },
        });
      }
    });

    return {
      entityId: khung.id,
      data: { soTieuChi: input.thuTu.length },
      newValues: { soTieuChi: input.thuTu.length },
    };
  },
};

// ── Kích hoạt ──────────────────────────────────────────────────────────────

export const kichHoatKhungSchema = z
  .object({ rubricId: z.string().min(1) })
  .strict();
export type KichHoatKhungInput = z.infer<typeof kichHoatKhungSchema>;

export const cauHinhKichHoatKhung: ActionConfig<
  KichHoatKhungInput,
  { soTieuChi: number; totalPoints: number }
> = {
  name: "kichHoatKhungCham",
  // Kích hoạt là đưa khung ra dùng thật ⇒ quyền XUẤT BẢN, không phải quyền soạn.
  permission: "elearning:content:publish",
  module: "elearning",
  entityType: "TrnRubric",
  auditAction: "UPDATE",
  schema: kichHoatKhungSchema,
  handler: async ({ db, actor, input }) => {
    const khung = await napKhung(db, input.rubricId);
    // ⚠️ Kích hoạt là ĐÓNG BĂNG và KHÔNG có đường đảo lại trong ứng dụng. Một lượt
    // kích hoạt nhầm trên khung dùng chung chỉ gỡ được bằng tay trên DB, trong khi
    // mọi cơ sở đã chấm bằng nó.
    chanGhiBanGhiChung({
      actor,
      centerId: khung.centerId,
      permission: "elearning:content:publish",
      viec: "kích hoạt khung này",
    });
    if (khung.status !== "DRAFT") {
      throw new ActionError("KHUNG_DA_KICH_HOAT", "Khung này đã kích hoạt rồi");
    }

    const tieuChi = await db.trnRubricCriterion.findMany({
      where: { rubricId: khung.id },
      select: { levelsJson: true },
      orderBy: { orderIndex: "asc" },
    });

    // ⚠️ Đọc `levelsJson` QUA Zod, không tin cột. Một tiêu chí có `levelsJson` hỏng
    // khuôn sẽ làm màn chấm không dựng nổi ô nhập cho nó — và bài nộp treo lại y
    // như câu thi hỏng nội dung ở EL-14e. Bắt tại cổng là lần cuối còn sửa được.
    const doc = tieuChi.map((tc, i) => ({
      so: i + 1,
      r: dsMucSchema.safeParse(tc.levelsJson),
    }));
    const hong = doc.filter((d) => !d.r.success).map((d) => d.so);
    if (hong.length > 0) {
      throw new ActionError(
        "TIEU_CHI_HONG",
        `Không đọc được các mức của tiêu chí ${hong.join(", ")} — mở ra lưu lại rồi kích hoạt lại`,
      );
    }

    const loi = kiemKhung({
      totalPoints: khung.totalPoints,
      passPoints: khung.passPoints,
      tieuChi: doc.map((d) => ({ levels: d.r.success ? d.r.data : [] })),
    });
    if (loi.length > 0) {
      // Trả HẾT lỗi trong một lượt: bấm kích hoạt ba lần để lộ ra ba lỗi là cách
      // chắc chắn khiến người soạn bỏ dở.
      throw new ActionError(loi[0]!.ma, loi.map((l) => l.noi).join(" · "));
    }

    await db.trnRubric.update({
      where: { id: khung.id },
      data: { status: "ACTIVE" },
    });

    return {
      entityId: khung.id,
      data: { soTieuChi: tieuChi.length, totalPoints: khung.totalPoints },
      oldValues: { status: "DRAFT" },
      newValues: { status: "ACTIVE", soTieuChi: tieuChi.length },
    };
  },
};

// ── Gắn khung vào bài ──────────────────────────────────────────────────────

export const ganKhungVaoBaiSchema = z
  .object({
    lessonId: z.string().min(1),
    /** `null` = gỡ khung khỏi bài. */
    rubricId: z.union([z.null(), z.string().min(1)]).optional(),
  })
  .strict();

export type GanKhungVaoBaiInput = z.infer<typeof ganKhungVaoBaiSchema>;

export const cauHinhGanKhungVaoBai: ActionConfig<
  GanKhungVaoBaiInput,
  { rubricId: string | null }
> = {
  name: "ganKhungVaoBai",
  permission: "elearning:content:author",
  module: "elearning",
  entityType: "TrnLesson",
  auditAction: "UPDATE",
  schema: ganKhungVaoBaiSchema,
  handler: async ({ db, actor, input }) => {
    const bai = await db.trnLesson.findFirst({
      where: { id: input.lessonId, deletedAt: null },
      select: {
        id: true,
        kind: true,
        rubricId: true,
        module: { select: { courseId: true } },
      },
    });
    if (!bai) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    // Cách ly đi qua chuỗi cha — `TrnLesson` không nằm trong `SCOPED_MODELS`, và
    // `scopedDb` không che đường ghi.
    const khoa = await db.trnCourse.findFirst({
      where: { id: bai.module.courseId, deletedAt: null },
      select: { id: true, centerId: true },
    });
    if (!khoa) throw new ActionError("NOT_FOUND", "Không tìm thấy bài học");

    // ⚠️ `TrnCourse` nằm trong `NULL_IS_GLOBAL_MODELS`, nên lượt đọc ngay trên CỐ Ý
    // cho khoá DÙNG CHUNG toàn công ty (`centerId = null`) lọt với MỌI actor — kho
    // chung không được tàng hình. Mượn nó làm cổng GHI là biến "ai cũng đọc được"
    // thành "ai cũng sửa được", đúng bẫy `chanGhiBanGhiChung` sinh ra để bịt ở
    // EL-15b. Ở đây bản ghi bị sửa là `TrnLesson` của khoá chung.
    chanGhiBanGhiChung({
      actor,
      centerId: khoa.centerId,
      permission: "elearning:content:author",
      viec: "đổi khung chấm của bài trong khoá này",
    });

    if (bai.kind !== "TASK") {
      throw new ActionError(
        "WRONG_KIND",
        `Chỉ bài dạng "Bài tập" mới gắn được khung chấm. Bài này là ${bai.kind}.`,
        "lessonId",
      );
    }

    // ⚠️ ĐỔI KHUNG khi còn lượt CHỜ CHẤM là để người chấm mở bài ra và thấy một bộ
    // tiêu chí khác với bộ mà người học đã làm bài theo.
    //
    // Lượt nộp có đóng băng `rubricId` riêng nên điểm KHÔNG lệch — nhưng màn chấm
    // vẫn nên nói không, vì người soạn hầu như luôn đang sửa nhầm chỗ. (Đường của
    // bài THI — `ganDeVaoBai` — chưa có phép kiểm này; ghi thành nợ.)
    if (input.rubricId !== bai.rubricId) {
      const dangCho = await db.trnSubmission.findFirst({
        where: {
          lessonId: bai.id,
          status: { in: ["SUBMITTED", "NEEDS_REVISION"] },
        },
        select: { id: true },
      });
      if (dangCho) {
        throw new ActionError(
          "CON_LUOT_CHO_CHAM",
          "Bài này còn lượt nộp đang chờ chấm — chấm xong rồi mới đổi khung được",
          "rubricId",
        );
      }
    }

    if (input.rubricId) {
      const khung = await db.trnRubric.findFirst({
        where: { id: input.rubricId, deletedAt: null },
        select: { id: true, status: true, centerId: true },
      });
      if (!khung) throw new ActionError("NOT_FOUND", "Không tìm thấy khung chấm");

      // ⚠️ Khung của MỘT CƠ SỞ không gắn được vào khoá DÙNG CHUNG.
      //
      // Không chặn thì người chấm ở cơ sở khác mở lượt nộp ra và `napLuotNopDeCham`
      // đọc khung qua `scopedDb` — khung của cơ sở kia bị lọc mất, hàm trả `null`,
      // trang báo "không mở được lượt nộp này". Bài KHÔNG AI chấm được, `dueGradeAt`
      // trôi, và cron nới hạn của người học vì một lỗi cấu hình họ không gây ra.
      if (khung.centerId !== null && khoa.centerId === null) {
        throw new ActionError(
          "KHUNG_HEP_HON_KHOA",
          "Khoá này dùng chung toàn công ty nên chỉ gắn được khung dùng chung — khung của một cơ sở sẽ làm người chấm ở cơ sở khác không mở được bài",
          "rubricId",
        );
      }
      // ⚠️ Chỉ gắn khung ĐÃ KÍCH HOẠT. Gắn khung nháp là để bài đi ra với người học
      // trên một bộ tiêu chí còn sửa được — và khung sửa xong thì điểm của người
      // nộp trước lệch khỏi thang của người nộp sau.
      if (khung.status !== "ACTIVE") {
        throw new ActionError(
          "KHUNG_CHUA_KICH_HOAT",
          "Chỉ gắn được khung đã kích hoạt — kích hoạt khung trước",
          "rubricId",
        );
      }
    }

    await db.trnLesson.update({
      where: { id: bai.id },
      data: { rubricId: input.rubricId ?? null },
    });

    return {
      entityId: bai.id,
      data: { rubricId: input.rubricId ?? null },
      oldValues: { rubricId: bai.rubricId },
      newValues: { rubricId: input.rubricId ?? null },
    };
  },
};
