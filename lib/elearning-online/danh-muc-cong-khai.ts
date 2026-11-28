import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

/**
 * E-LEARNING ONLINE — ĐỌC DANH MỤC CÔNG KHAI (cho Public Site; hợp đồng §4). CHỈ ĐỌC. Không có học viên, không có phiên.
 *
 * Bất biến (mỗi cái có ca DB riêng, `tests/elearning/onl-cong-khai-db.test.ts`):
 * 1. Chỉ khoá ĐÃ PHÁT HÀNH, chưa lưu trữ, và đang ở trạng thái bán CÔNG KHAI (đang bán, hoặc hẹn giờ mở bán). Nháp / chưa bán / tạm ngừng / đã lưu trữ ⇒ không thấy.
 * 2. KHÔNG BAO GIỜ trả `contentJson`, khoá media, id bài đánh giá, thân bài trả phí. Danh sách bài chỉ có tiêu đề · loại · thời lượng · "học thử".
 * 3. Bài ẨN (hoặc trong chương ẨN) không xuất hiện. Số bài/thời lượng tính trên bài HIỂN THỊ.
 * 4. Bài học thử: bài ĐỌC trả thân bài; bài VIDEO KHÔNG trả nguồn (kho video có kiểm soát chưa mở — BLOCKED_INFRA). Bài không "học thử" ⇒ null (không phân biệt "không có" với "trả phí").
 * 5. Trạng thái bán trả ra là HIỆU LỰC: hẹn giờ mà đã tới giờ mở bán ⇒ coi là đang bán (cùng hàm `banDuocLucNay` với cổng mua của quyền học).
 */

type Db = PrismaClient;

export type TrangThaiBanHieuLuc = "ON_SALE" | "SCHEDULED";

/** Khoá có MUA được lúc `now` không: đang bán, hoặc hẹn giờ đã tới giờ. MỘT hàm cho catalog và cổng mua của `capQuyenHoc`. */
export function banDuocLucNay(saleStatus: string, saleOpensAt: Date | null, now: Date): boolean {
  return saleStatus === "ON_SALE" || (saleStatus === "SCHEDULED" && saleOpensAt !== null && saleOpensAt.getTime() <= now.getTime());
}

export const locCongKhaiSchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    /** slug danh mục (cha hoặc con; cha gồm cả khoá của danh mục con). */
    dm: z.string().trim().max(120).optional(),
    trang: z.coerce.number().int().min(1).max(1000).optional(),
    coTrang: z.coerce.number().int().min(1).max(50).optional(),
  })
  .strict();
export type LocCongKhai = z.infer<typeof locCongKhaiSchema>;

export type KhoaCongKhai = {
  slug: string;
  code: string;
  name: string;
  shortDescription: string | null;
  danhMuc: { name: string; slug: string } | null;
  level: string | null;
  gradeFrom: number | null;
  gradeTo: number | null;
  coverImageKey: string | null;
  displayOrder: number;
  listPrice: number;
  salePrice: number;
  validityMonths: number | null;
  renewalEnabled: boolean;
  /** Hiệu lực: `ON_SALE` mua được ngay; `SCHEDULED` chưa tới giờ. */
  banTrangThai: TrangThaiBanHieuLuc;
  moBanLuc: string | null;
  soBai: number;
  tongThoiLuongGiay: number;
};

export type ChiTietCongKhai = KhoaCongKhai & {
  fullDescription: string | null;
  trailerKey: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  renewalPrice: number | null;
  tienQuyet: { slug: string; name: string; cheDo: "RECOMMENDED" | "REQUIRED" } | null;
  chuong: { title: string; bai: { stableId: string; title: string; kind: string; durationSec: number | null; hocThu: boolean }[] }[];
};

const CHON_KHOA = {
  slug: true, code: true, name: true, shortDescription: true, level: true, gradeFrom: true, gradeTo: true, coverImageKey: true, displayOrder: true,
  listPrice: true, salePrice: true, validityMonths: true, renewalEnabled: true, saleStatus: true, saleOpensAt: true, publishedVersionId: true,
  category: { select: { name: true, slug: true } },
} as const;

type DongKhoa = {
  slug: string; code: string; name: string; shortDescription: string | null; level: string | null; gradeFrom: number | null; gradeTo: number | null; coverImageKey: string | null;
  displayOrder: number; listPrice: number; salePrice: number; validityMonths: number | null; renewalEnabled: boolean; saleStatus: string; saleOpensAt: Date | null;
  publishedVersionId: string | null; category: { name: string; slug: string } | null;
};

const dieuKienCongKhai = () => ({
  deletedAt: null,
  publishedVersionId: { not: null },
  OR: [{ saleStatus: "ON_SALE" as const }, { saleStatus: "SCHEDULED" as const }],
  // hẹn giờ phải CÓ ngày mở bán (khoá hẹn giờ mà thiếu ngày là dữ liệu hỏng — không công khai)
  NOT: { saleStatus: "SCHEDULED" as const, saleOpensAt: null },
});

function dongCongKhai(k: DongKhoa, tk: { soBai: number; giay: number }, now: Date): KhoaCongKhai {
  return {
    slug: k.slug,
    code: k.code,
    name: k.name,
    shortDescription: k.shortDescription,
    danhMuc: k.category ? { name: k.category.name, slug: k.category.slug } : null,
    level: k.level,
    gradeFrom: k.gradeFrom,
    gradeTo: k.gradeTo,
    coverImageKey: k.coverImageKey,
    displayOrder: k.displayOrder,
    listPrice: k.listPrice,
    salePrice: k.salePrice,
    validityMonths: k.validityMonths,
    renewalEnabled: k.renewalEnabled,
    banTrangThai: banDuocLucNay(k.saleStatus, k.saleOpensAt, now) ? "ON_SALE" : "SCHEDULED",
    moBanLuc: k.saleStatus === "SCHEDULED" && k.saleOpensAt && k.saleOpensAt.getTime() > now.getTime() ? k.saleOpensAt.toISOString() : null,
    soBai: tk.soBai,
    tongThoiLuongGiay: tk.giay,
  };
}

/** Thống kê bài HIỂN THỊ (không ẩn, chương không ẩn) của các bản đang chạy. */
async function thongKeBai(db: Db, versionIds: string[]): Promise<Map<string, { soBai: number; giay: number }>> {
  const kq = new Map<string, { soBai: number; giay: number }>();
  if (!versionIds.length) return kq;
  const bai = await db.onlLesson.findMany({ where: { versionId: { in: versionIds }, hidden: false, chapter: { hidden: false } }, select: { versionId: true, durationSec: true } });
  for (const b of bai) {
    const t = kq.get(b.versionId) ?? { soBai: 0, giay: 0 };
    t.soBai += 1;
    t.giay += b.durationSec ?? 0;
    kq.set(b.versionId, t);
  }
  return kq;
}

export async function docKhoaCongKhai(db: Db, loc: LocCongKhai, now: Date): Promise<{ khoa: KhoaCongKhai[]; tong: number }> {
  const coTrang = loc.coTrang ?? 12;
  const trang = loc.trang ?? 1;
  let danhMucIds: string[] | undefined;
  if (loc.dm) {
    const dm = await db.onlCategory.findUnique({ where: { slug: loc.dm }, select: { id: true, children: { select: { id: true } } } });
    if (!dm) return { khoa: [], tong: 0 };
    danhMucIds = [dm.id, ...dm.children.map((c) => c.id)];
  }
  const q = loc.q?.trim();
  const where = {
    ...dieuKienCongKhai(),
    ...(danhMucIds ? { categoryId: { in: danhMucIds } } : {}),
    ...(q ? { AND: [{ OR: [{ name: { contains: q, mode: "insensitive" as const } }, { shortDescription: { contains: q, mode: "insensitive" as const } }] }] } : {}),
  };
  const [tong, dong] = await Promise.all([
    db.onlCourse.count({ where }),
    db.onlCourse.findMany({ where, orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }], skip: (trang - 1) * coTrang, take: coTrang, select: CHON_KHOA }),
  ]);
  const tk = await thongKeBai(db, dong.flatMap((k) => (k.publishedVersionId ? [k.publishedVersionId] : [])));
  return { tong, khoa: dong.map((k) => dongCongKhai(k, tk.get(k.publishedVersionId!) ?? { soBai: 0, giay: 0 }, now)) };
}

export async function docChiTietCongKhai(db: Db, slug: string, now: Date): Promise<ChiTietCongKhai | null> {
  const k = await db.onlCourse.findFirst({
    where: { slug, ...dieuKienCongKhai() },
    select: {
      ...CHON_KHOA,
      fullDescription: true, trailerKey: true, seoTitle: true, seoDescription: true, renewalPrice: true, prerequisiteMode: true,
      prerequisite: { select: { slug: true, name: true, deletedAt: true } },
    },
  });
  if (!k?.publishedVersionId) return null;
  const chuong = await db.onlChapter.findMany({
    where: { versionId: k.publishedVersionId, hidden: false },
    orderBy: { orderIndex: "asc" },
    select: {
      title: true,
      // CỐ Ý không chọn `contentJson`/`description`/`thumbnailKey`: không có đường nào để chúng lọt ra ngoài.
      lessons: { where: { hidden: false }, orderBy: { orderIndex: "asc" }, select: { stableId: true, title: true, kind: true, durationSec: true, freePreview: true } },
    },
  });
  const soBai = chuong.reduce((s, c) => s + c.lessons.length, 0);
  const giay = chuong.reduce((s, c) => s + c.lessons.reduce((x, b) => x + (b.durationSec ?? 0), 0), 0);
  const co = dongCongKhai(k, { soBai, giay }, now);
  return {
    ...co,
    fullDescription: k.fullDescription,
    trailerKey: k.trailerKey,
    seoTitle: k.seoTitle,
    seoDescription: k.seoDescription,
    renewalPrice: k.renewalPrice,
    tienQuyet: k.prerequisite && !k.prerequisite.deletedAt && k.prerequisiteMode !== "NONE" ? { slug: k.prerequisite.slug, name: k.prerequisite.name, cheDo: k.prerequisiteMode as "RECOMMENDED" | "REQUIRED" } : null,
    chuong: chuong.map((c) => ({ title: c.title, bai: c.lessons.map((b) => ({ stableId: b.stableId, title: b.title, kind: b.kind, durationSec: b.durationSec, hocThu: b.freePreview })) })),
  };
}

export type BaiHocThu = { title: string; kind: string; durationSec: number | null; noiDung: { loai: "READ"; body: string } | { loai: "VIDEO"; dangPhat: false; lyDo: "KHO_VIDEO_CHUA_MO" } | { loai: "KHAC" } };

/**
 * MỘT vị từ "bài học thử CÔNG KHAI" cho mọi đầu ra của nó: JSON học thử (`docBaiHocThu`) và vé PHÁT video học thử (`video-phat.ts`, V8.44).
 * Khoá công khai (đang bán/hẹn giờ, chưa xoá, có bản phát hành) · bài thuộc BẢN ĐANG CHẠY · không ẩn · chương không ẩn · đánh dấu `freePreview`.
 * Đóng/bỏ đánh dấu học thử ⇒ hàm trả `null` ngay — vé phát video hỏi lại hàm này ở MỖI lượt phát nên quyền xem cắt theo.
 */
export async function timBaiHocThuCongKhai(db: Db, slug: string, lessonStableId: string) {
  const k = await db.onlCourse.findFirst({ where: { slug, ...dieuKienCongKhai() }, select: { id: true, publishedVersionId: true } });
  if (!k?.publishedVersionId) return null;
  const b = await db.onlLesson.findFirst({
    where: { versionId: k.publishedVersionId, stableId: lessonStableId, hidden: false, freePreview: true, chapter: { hidden: false } },
    select: { title: true, kind: true, durationSec: true, contentJson: true },
  });
  if (!b) return null;
  return { ...b, courseId: k.id, versionId: k.publishedVersionId, stableId: lessonStableId };
}

/** Bài học thử. Bài không phải học thử / bị ẩn / khoá không công khai ⇒ `null` (cùng một câu trả lời — không lộ bài trả phí có tồn tại). */
export async function docBaiHocThu(db: Db, slug: string, lessonStableId: string): Promise<BaiHocThu | null> {
  const b = await timBaiHocThuCongKhai(db, slug, lessonStableId);
  if (!b) return null;
  const nd = (b.contentJson ?? {}) as { body?: unknown };
  return {
    title: b.title,
    kind: b.kind,
    durationSec: b.durationSec,
    noiDung:
      b.kind === "READ"
        ? { loai: "READ", body: typeof nd.body === "string" ? nd.body : "" }
        : b.kind === "VIDEO"
          ? { loai: "VIDEO", dangPhat: false, lyDo: "KHO_VIDEO_CHUA_MO" }
          : { loai: "KHAC" },
  };
}
