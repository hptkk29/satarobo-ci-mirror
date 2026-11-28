import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { caiDatKhoiDauChoBanNhap } from "./cai-dat-hoc-tap";

/**
 * E-LEARNING ONLINE — KHOÁ HỌC & DANH MỤC (CRUD lõi, thiết kế QoDanhSach/QoTaoKhoa/QoTongQuan/QoGia).
 *
 * Quy ước:
 * - Hàm nhận `db: PrismaClient` (không phải scopedDb): bảng `Onl*` là dữ liệu CẤP CÔNG TY, không `centerId`.
 * - Lỗi nghiệp vụ trả `{ ok:false, ma, thongBao }` (không ném); lỗi hạ tầng ném.
 * - KHÔNG chạm `Order`/thanh toán (Workstream A). Giá ở đây là GIÁ NIÊM YẾT; đơn hàng chụp snapshot giá của nó.
 * - Đổi giá/thời hạn KHÔNG ảnh hưởng quyền học đã cấp (quyền chụp `validityMonthsSnapshot` lúc cấp).
 */

type Db = PrismaClient;

export type MaLoiKhoa =
  | "MA_TRUNG"
  | "SLUG_TRUNG"
  | "DANH_MUC_KHONG_TON_TAI"
  | "DANH_MUC_VONG"
  | "DANH_MUC_CAP_QUA_SAU"
  | "KHOA_KHONG_TON_TAI"
  | "DANG_BAN_CAN_BAN_PHAT_HANH"
  | "TIEN_QUYET_TU_THAN"
  | "TIEN_QUYET_VONG"
  | "TIEN_QUYET_KHONG_TON_TAI"
  | "KHOA_DA_CO_HOC_VIEN"
  | "DANH_MUC_CON_KHOA";

export type Fail = { ok: false; ma: MaLoiKhoa; thongBao: string };
const fail = (ma: MaLoiKhoa, thongBao: string): Fail => ({ ok: false, ma, thongBao });

// ───────── Slug ─────────

/** "Lập trình Robot cho bé" → "lap-trinh-robot-cho-be". */
export function taoSlug(ten: string): string {
  return ten
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// ───────── Schema nhập ─────────

const gia = z.number().int().min(0).max(100_000_000);
const thang = z.number().int().min(1).max(120);

export const maKhoaSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, "Mã khoá tối thiểu 2 ký tự")
  .max(40)
  .regex(/^[A-Z0-9-]+$/, "Mã khoá chỉ gồm chữ HOA, số và dấu gạch ngang");

const truongChung = {
  name: z.string().trim().min(3, "Tên khoá tối thiểu 3 ký tự").max(200),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  fullDescription: z.string().trim().max(20_000).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  level: z.enum(["INTRO", "BASIC", "INTERMEDIATE", "ADVANCED"]).nullable().optional(),
  gradeFrom: z.number().int().min(1).max(12).nullable().optional(),
  gradeTo: z.number().int().min(1).max(12).nullable().optional(),
  listPrice: gia,
  salePrice: gia,
  /** `null` = TRỌN ĐỜI; ngược lại 1..120 THÁNG LỊCH. Phụ huynh không chọn. */
  validityMonths: thang.nullable(),
  renewalEnabled: z.boolean(),
  renewalPrice: gia.nullable().optional(),
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(400).nullable().optional(),
};

const kiemGiaVaLop = <T extends { listPrice: number; salePrice: number; gradeFrom?: number | null; gradeTo?: number | null; renewalEnabled: boolean; renewalPrice?: number | null; validityMonths: number | null }>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  if (v.salePrice > v.listPrice) ctx.addIssue({ code: "custom", path: ["salePrice"], message: "Giá bán không được cao hơn giá niêm yết" });
  if (v.gradeFrom != null && v.gradeTo != null && v.gradeFrom > v.gradeTo) ctx.addIssue({ code: "custom", path: ["gradeTo"], message: "Lớp đến phải ≥ lớp từ" });
  if (v.renewalEnabled && v.validityMonths === null) ctx.addIssue({ code: "custom", path: ["renewalEnabled"], message: "Khoá trọn đời không có gia hạn" });
  if (v.renewalEnabled && (v.renewalPrice === null || v.renewalPrice === undefined)) ctx.addIssue({ code: "custom", path: ["renewalPrice"], message: "Bật gia hạn thì phải có giá gia hạn" });
};

export const taoKhoaSchema = z
  .object({ code: maKhoaSchema, slug: z.string().trim().max(80).optional(), ...truongChung })
  .strict()
  .superRefine(kiemGiaVaLop);
export type TaoKhoaInput = z.infer<typeof taoKhoaSchema>;

/** Sửa: mọi trường của `taoKhoa` trừ `code` (mã không đổi sau khi tạo — đơn hàng/chứng nhận trỏ vào). */
export const suaKhoaSchema = z
  .object({ courseId: z.string().min(1), slug: z.string().trim().min(2).max(80).optional(), ...truongChung })
  .strict()
  .superRefine(kiemGiaVaLop);
export type SuaKhoaInput = z.infer<typeof suaKhoaSchema>;

export const trangThaiBanSchema = z
  .object({
    courseId: z.string().min(1),
    saleStatus: z.enum(["NOT_ON_SALE", "SCHEDULED", "ON_SALE", "PAUSED"]),
    saleOpensAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.saleStatus === "SCHEDULED" && !v.saleOpensAt) ctx.addIssue({ code: "custom", path: ["saleOpensAt"], message: "Khoá hẹn giờ mở bán phải có ngày mở bán" });
  });
export type TrangThaiBanInput = z.infer<typeof trangThaiBanSchema>;

export const tienQuyetSchema = z
  .object({
    courseId: z.string().min(1),
    mode: z.enum(["NONE", "RECOMMENDED", "REQUIRED"]),
    prerequisiteCourseId: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode !== "NONE" && !v.prerequisiteCourseId) ctx.addIssue({ code: "custom", path: ["prerequisiteCourseId"], message: "Chọn khoá tiên quyết" });
    if (v.mode === "NONE" && v.prerequisiteCourseId) ctx.addIssue({ code: "custom", path: ["prerequisiteCourseId"], message: "Không đặt khoá tiên quyết khi chế độ là 'Không'" });
  });
export type TienQuyetInput = z.infer<typeof tienQuyetSchema>;

export const danhMucSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(2).max(120),
    parentId: z.string().min(1).nullable().optional(),
    displayOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type DanhMucInput = z.infer<typeof danhMucSchema>;

export const sapXepSchema = z.object({ courseIds: z.array(z.string().min(1)).min(1).max(500) }).strict();

const laP2002 = (e: unknown): e is { code: "P2002"; meta?: { target?: string[] | string } } =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const mucTieu = (e: { meta?: { target?: string[] | string } }) => String(e.meta?.target ?? "");

// ───────── Khoá ─────────

export type KetQuaTaoKhoa = { ok: true; courseId: string; draftVersionId: string; slug: string } | Fail;

async function slugKhaDung(db: Db | Prisma.TransactionClient, goc: string): Promise<string> {
  const co = goc || "khoa-hoc";
  for (let i = 1; i < 200; i++) {
    const s = i === 1 ? co : `${co}-${i}`;
    const da = await db.onlCourse.findUnique({ where: { slug: s }, select: { id: true } });
    if (!da) return s;
  }
  return `${co}-${Date.now().toString(36)}`;
}

/** Tạo khoá + bản nháp số 1 (cài đặt khởi đầu tường minh). Chưa bán, chưa phát hành. */
export async function taoKhoa(db: Db, input: TaoKhoaInput, actorUserId: string | null): Promise<KetQuaTaoKhoa> {
  if (input.categoryId) {
    const dm = await db.onlCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!dm) return fail("DANH_MUC_KHONG_TON_TAI", "Danh mục không tồn tại");
  }
  const slugYeuCau = input.slug ? taoSlug(input.slug) : "";
  try {
    return await db.$transaction(async (tx) => {
      const slug = slugYeuCau || (await slugKhaDung(tx, taoSlug(input.name)));
      const khoa = await tx.onlCourse.create({
        data: {
          code: input.code,
          slug,
          name: input.name,
          shortDescription: input.shortDescription ?? null,
          fullDescription: input.fullDescription ?? null,
          categoryId: input.categoryId ?? null,
          level: input.level ?? null,
          gradeFrom: input.gradeFrom ?? null,
          gradeTo: input.gradeTo ?? null,
          listPrice: input.listPrice,
          salePrice: input.salePrice,
          validityMonths: input.validityMonths,
          renewalEnabled: input.renewalEnabled,
          renewalPrice: input.renewalPrice ?? null,
          seoTitle: input.seoTitle ?? null,
          seoDescription: input.seoDescription ?? null,
          saleStatus: "NOT_ON_SALE",
          createdByUserId: actorUserId,
        },
        select: { id: true, slug: true },
      });
      const ban = await tx.onlCourseVersion.create({
        data: { courseId: khoa.id, number: 1, status: "DRAFT", settingsJson: caiDatKhoiDauChoBanNhap() as object, createdByUserId: actorUserId },
        select: { id: true },
      });
      return { ok: true as const, courseId: khoa.id, draftVersionId: ban.id, slug: khoa.slug };
    });
  } catch (e) {
    if (laP2002(e)) {
      const t = mucTieu(e);
      if (t.includes("slug")) return fail("SLUG_TRUNG", "Đường dẫn (slug) đã được khoá khác dùng");
      return fail("MA_TRUNG", "Mã khoá đã tồn tại");
    }
    throw e;
  }
}

export type KetQuaSua = { ok: true; courseId: string; truoc: Record<string, unknown>; sau: Record<string, unknown> } | Fail;

/** Sửa thông tin khoá. KHÔNG đổi quyền học đã cấp; KHÔNG đổi trạng thái bán (có hàm riêng). */
export async function suaKhoa(db: Db, input: SuaKhoaInput): Promise<KetQuaSua> {
  const cu = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null } });
  if (!cu) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  if (input.categoryId) {
    const dm = await db.onlCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } });
    if (!dm) return fail("DANH_MUC_KHONG_TON_TAI", "Danh mục không tồn tại");
  }
  const data = {
    name: input.name,
    shortDescription: input.shortDescription ?? null,
    fullDescription: input.fullDescription ?? null,
    categoryId: input.categoryId ?? null,
    level: input.level ?? null,
    gradeFrom: input.gradeFrom ?? null,
    gradeTo: input.gradeTo ?? null,
    listPrice: input.listPrice,
    salePrice: input.salePrice,
    validityMonths: input.validityMonths,
    renewalEnabled: input.renewalEnabled,
    renewalPrice: input.renewalPrice ?? null,
    seoTitle: input.seoTitle ?? null,
    seoDescription: input.seoDescription ?? null,
    ...(input.slug ? { slug: taoSlug(input.slug) } : {}),
  };
  try {
    await db.onlCourse.update({ where: { id: cu.id }, data });
  } catch (e) {
    if (laP2002(e)) return fail("SLUG_TRUNG", "Đường dẫn (slug) đã được khoá khác dùng");
    throw e;
  }
  const truoc: Record<string, unknown> = {};
  const sau: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const c = (cu as Record<string, unknown>)[k];
    if (c !== v) {
      truoc[k] = c;
      sau[k] = v;
    }
  }
  return { ok: true, courseId: cu.id, truoc, sau };
}

/** Đổi trạng thái bán. `ON_SALE`/`SCHEDULED` chỉ khi đã có bản ĐANG CHẠY (không bán thứ chưa phát hành). */
export async function doiTrangThaiBan(db: Db, input: TrangThaiBanInput): Promise<{ ok: true; truoc: string; sau: string } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true, saleStatus: true, publishedVersionId: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  if ((input.saleStatus === "ON_SALE" || input.saleStatus === "SCHEDULED") && !khoa.publishedVersionId) {
    return fail("DANG_BAN_CAN_BAN_PHAT_HANH", "Phải phát hành một phiên bản trước khi mở bán");
  }
  await db.onlCourse.update({ where: { id: khoa.id }, data: { saleStatus: input.saleStatus, saleOpensAt: input.saleStatus === "SCHEDULED" ? (input.saleOpensAt ?? null) : null } });
  return { ok: true, truoc: khoa.saleStatus, sau: input.saleStatus };
}

/** Khoá tiên quyết: không tự trỏ chính mình, không tạo vòng (A→B→A), khoá đích phải tồn tại. */
export async function datTienQuyet(db: Db, input: TienQuyetInput): Promise<{ ok: true } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  if (input.prerequisiteCourseId) {
    if (input.prerequisiteCourseId === input.courseId) return fail("TIEN_QUYET_TU_THAN", "Khoá không thể là tiên quyết của chính nó");
    const dich = await db.onlCourse.findFirst({ where: { id: input.prerequisiteCourseId, deletedAt: null }, select: { id: true } });
    if (!dich) return fail("TIEN_QUYET_KHONG_TON_TAI", "Khoá tiên quyết không tồn tại");
    // Đi ngược chuỗi tiên quyết của khoá đích: gặp lại `courseId` ⇒ vòng.
    let cur: string | null = input.prerequisiteCourseId;
    for (let i = 0; cur && i < 50; i++) {
      if (cur === input.courseId) return fail("TIEN_QUYET_VONG", "Chuỗi khoá tiên quyết bị vòng");
      const n: { prerequisiteCourseId: string | null } | null = await db.onlCourse.findUnique({ where: { id: cur }, select: { prerequisiteCourseId: true } });
      cur = n?.prerequisiteCourseId ?? null;
    }
  }
  await db.onlCourse.update({ where: { id: input.courseId }, data: { prerequisiteMode: input.mode, prerequisiteCourseId: input.prerequisiteCourseId } });
  return { ok: true };
}

/** Lưu trữ (xoá mềm). KHÔNG cho khi đã có quyền học — lịch sử mua/điểm/chứng nhận phải còn trỏ được. */
export async function luuTruKhoa(db: Db, courseId: string, now: Date): Promise<{ ok: true } | Fail> {
  const khoa = await db.onlCourse.findFirst({ where: { id: courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const coQuyen = await db.onlEntitlement.count({ where: { courseId } });
  if (coQuyen > 0) return fail("KHOA_DA_CO_HOC_VIEN", "Khoá đã có học viên — chỉ có thể ngừng bán, không lưu trữ");
  await db.onlCourse.update({ where: { id: courseId }, data: { deletedAt: now, saleStatus: "NOT_ON_SALE", saleOpensAt: null } });
  return { ok: true };
}

/** STT hiển thị công khai: thứ tự mảng = `displayOrder` 0..n-1. Id lạ bị bỏ qua (không làm hỏng cả lượt). */
export async function sapXepKhoa(db: Db, courseIds: string[]): Promise<{ ok: true; soDaDoi: number }> {
  const co = await db.onlCourse.findMany({ where: { id: { in: courseIds }, deletedAt: null }, select: { id: true, displayOrder: true } });
  const hienTai = new Map(co.map((c) => [c.id, c.displayOrder]));
  const ops = courseIds.flatMap((id, i) => (hienTai.has(id) && hienTai.get(id) !== i ? [db.onlCourse.update({ where: { id }, data: { displayOrder: i } })] : []));
  if (ops.length) await db.$transaction(ops);
  return { ok: true, soDaDoi: ops.length };
}

// ───────── Danh mục (2 cấp: cha → con) ─────────

export async function luuDanhMuc(db: Db, input: DanhMucInput): Promise<{ ok: true; id: string } | Fail> {
  if (input.parentId) {
    const cha = await db.onlCategory.findUnique({ where: { id: input.parentId }, select: { id: true, parentId: true } });
    if (!cha) return fail("DANH_MUC_KHONG_TON_TAI", "Danh mục cha không tồn tại");
    if (cha.parentId) return fail("DANH_MUC_CAP_QUA_SAU", "Danh mục chỉ có 2 cấp");
    if (input.id && input.parentId === input.id) return fail("DANH_MUC_VONG", "Danh mục không thể là cha của chính nó");
  }
  if (input.id) {
    const cu = await db.onlCategory.findUnique({ where: { id: input.id }, select: { id: true, _count: { select: { children: true } } } });
    if (!cu) return fail("DANH_MUC_KHONG_TON_TAI", "Danh mục không tồn tại");
    // Danh mục đang có con không được hạ xuống làm con (sẽ thành 3 cấp).
    if (input.parentId && cu._count.children > 0) return fail("DANH_MUC_CAP_QUA_SAU", "Danh mục đang có danh mục con — không thể đặt làm con của danh mục khác");
  }
  const slug = taoSlug(input.name);
  try {
    if (input.id) {
      const r = await db.onlCategory.update({
        where: { id: input.id },
        data: { name: input.name, slug, parentId: input.parentId ?? null, ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}) },
        select: { id: true },
      });
      return { ok: true, id: r.id };
    }
    const r = await db.onlCategory.create({ data: { name: input.name, slug, parentId: input.parentId ?? null, displayOrder: input.displayOrder ?? 0 }, select: { id: true } });
    return { ok: true, id: r.id };
  } catch (e) {
    if (laP2002(e)) return fail("SLUG_TRUNG", "Đã có danh mục cùng tên");
    throw e;
  }
}

/** Xoá danh mục: chỉ khi không còn danh mục con VÀ không còn khoá nào (khoá lưu trữ cũng tính). */
export async function xoaDanhMuc(db: Db, id: string): Promise<{ ok: true } | Fail> {
  const dm = await db.onlCategory.findUnique({ where: { id }, select: { id: true, _count: { select: { children: true, courses: true } } } });
  if (!dm) return fail("DANH_MUC_KHONG_TON_TAI", "Danh mục không tồn tại");
  if (dm._count.children > 0 || dm._count.courses > 0) return fail("DANH_MUC_CON_KHOA", "Danh mục còn danh mục con hoặc khoá học — chuyển đi trước khi xoá");
  await db.onlCategory.delete({ where: { id } });
  return { ok: true };
}

// ───────── Đọc: danh sách + chi tiết ─────────

export type LocKhoa = { q?: string; saleStatus?: string; categoryId?: string; trang?: number; coTrang?: number };

export type DongKhoa = {
  id: string;
  code: string;
  name: string;
  slug: string;
  categoryName: string | null;
  saleStatus: string;
  displayOrder: number;
  listPrice: number;
  salePrice: number;
  validityMonths: number | null;
  daPhatHanh: boolean;
  /** Số hiệu bản đang chạy; `null` nếu chưa phát hành. */
  banChay: number | null;
  coBanNhap: boolean;
  soBaiBanChay: number;
  soHocVienConQuyen: number;
  capNhatLuc: Date;
};

export async function danhSachKhoa(db: Db, loc: LocKhoa = {}): Promise<{ dong: DongKhoa[]; tong: number }> {
  const coTrang = Math.min(Math.max(loc.coTrang ?? 20, 1), 100);
  const trang = Math.max(loc.trang ?? 1, 1);
  const q = loc.q?.trim();
  const where: Prisma.OnlCourseWhereInput = {
    deletedAt: null,
    ...(loc.saleStatus ? { saleStatus: loc.saleStatus as never } : {}),
    ...(loc.categoryId ? { categoryId: loc.categoryId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q.toUpperCase() } }] } : {}),
  };
  const [tong, khoa] = await Promise.all([
    db.onlCourse.count({ where }),
    db.onlCourse.findMany({
      where,
      orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
      skip: (trang - 1) * coTrang,
      take: coTrang,
      select: {
        id: true, code: true, name: true, slug: true, saleStatus: true, displayOrder: true, listPrice: true, salePrice: true, validityMonths: true,
        publishedVersionId: true, updatedAt: true, category: { select: { name: true } }, versions: { select: { number: true, status: true } },
      },
    }),
  ]);
  const ids = khoa.map((k) => k.id);
  const verIds = khoa.flatMap((k) => (k.publishedVersionId ? [k.publishedVersionId] : []));
  const [baiTheoBan, quyen] = await Promise.all([
    verIds.length ? db.onlLesson.groupBy({ by: ["versionId"], where: { versionId: { in: verIds }, hidden: false }, _count: { _all: true } }) : Promise.resolve([]),
    ids.length ? db.onlEntitlement.groupBy({ by: ["courseId"], where: { courseId: { in: ids }, status: "ACTIVE" }, _count: { _all: true } }) : Promise.resolve([]),
  ]);
  const baiMap = new Map(baiTheoBan.map((b) => [b.versionId, b._count._all]));
  const quyenMap = new Map(quyen.map((b) => [b.courseId, b._count._all]));
  return {
    tong,
    dong: khoa.map((k) => ({
      id: k.id, code: k.code, name: k.name, slug: k.slug, categoryName: k.category?.name ?? null, saleStatus: k.saleStatus, displayOrder: k.displayOrder,
      listPrice: k.listPrice, salePrice: k.salePrice, validityMonths: k.validityMonths, daPhatHanh: !!k.publishedVersionId,
      banChay: k.versions.find((v) => v.status === "PUBLISHED")?.number ?? null,
      coBanNhap: k.versions.some((v) => v.status === "DRAFT"),
      soBaiBanChay: k.publishedVersionId ? (baiMap.get(k.publishedVersionId) ?? 0) : 0,
      // Đếm theo trạng thái LƯU ACTIVE (gồm cả quyền đã quá hạn nhưng chưa ai thu hồi) — bảng chi tiết mới tách còn hạn/hết hạn.
      soHocVienConQuyen: quyenMap.get(k.id) ?? 0,
      capNhatLuc: k.updatedAt,
    })),
  };
}

export async function chiTietKhoa(db: Db, courseId: string) {
  const khoa = await db.onlCourse.findFirst({
    where: { id: courseId, deletedAt: null },
    include: {
      category: { select: { id: true, name: true } },
      prerequisite: { select: { id: true, code: true, name: true } },
      versions: { orderBy: { number: "desc" }, select: { id: true, number: true, status: true, publishedAt: true, progressPolicy: true, createdAt: true } },
    },
  });
  return khoa;
}

export async function danhSachDanhMuc(db: Db) {
  return db.onlCategory.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true, parentId: true, displayOrder: true, _count: { select: { courses: true } } } });
}
