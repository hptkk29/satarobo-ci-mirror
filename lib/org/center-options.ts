import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { getTeachingCenterIds } from "@/lib/org/org-service";

/**
 * NGUỒN DUY NHẤT dựng ô lọc / ô chọn "Cơ sở" ở admin.
 *
 * ─── Vì sao phải có file này ────────────────────────────────────────────────
 * Rà soát 03/09/2026: đếm được **67 lời gọi `center.findMany`** ngoài test/seed,
 * trong đó 43 nằm ở `app/` — tức 43 ô lọc mỗi nơi tự viết một kiểu. Chỉ 8 màn nhớ
 * loại Hội sở, và ĐÚNG 2 chỗ nhớ cắt theo tầm nhìn người dùng. Hệ quả đo được
 * trên máy: ô lọc ở `/admin/students` bày ra 6 cơ sở, gồm Hội sở và 3 dòng rác
 * `ITLI_*` của bộ test — không lựa chọn nào ra dòng nào.
 *
 * ─── Vì sao `scopedDb` KHÔNG tự lo được ─────────────────────────────────────
 * `Center` nằm ở `SCOPE_EXEMPT`, KHÔNG phải `SCOPED_MODELS` (`lib/db-scope.ts:159`).
 * Nên `scopedDb(actor).center.findMany()` là đường thẳng — không lọc gì cả. Chính
 * `db-scope.ts:156-158` để lại TODO "audit các nơi `db.center.findMany`…"; file này
 * là chỗ đóng TODO đó. ĐỪNG đưa `Center` vào `SCOPED_MODELS` để "vá cho nhanh":
 * danh mục cơ sở còn được đọc ở đường quản trị cơ sở và đường dựng cầu OrgUnit,
 * scope cứng ở đó là tự khoá mình ra ngoài.
 *
 * ─── Bốn việc hàm này làm, thiếu việc nào cũng đẻ lại bug cũ ────────────────
 *  1. Bỏ **Hội sở**: HO không dạy học — 0 lớp, 0 học viên (đo prod-shape 03/09).
 *  2. Bỏ **Center mồ côi**: dòng `Center` không OrgUnit `type=CENTER` nào trỏ tới.
 *     Đây là thứ tự động quét sạch 3 dòng `ITLI_*` mà không cần biết tên chúng.
 *  3. Bỏ cơ sở **đã tắt** (`isActive = false`).
 *  4. **Cắt theo tầm nhìn** của người dùng, đúng luật `scopedDb` dùng cho dữ liệu:
 *     quản trị hệ thống và người cấp Hội sở thấy tất cả, còn lại theo
 *     `visibleCenterIds`.
 *
 * KHÔNG hardcode tên/mã cơ sở nào — mở CS3/CS4 là thêm một `OrgUnit type=CENTER`,
 * không sửa dòng code nào ở đây (luật CLAUDE.md).
 */
export type CenterOption = { id: string; name: string; code: string | null };

export type CenterOptionsOpts = {
  /**
   * `"teaching"` (mặc định) — chỉ cơ sở DẠY HỌC. Dùng cho mọi màn giảng dạy:
   * học viên, lớp, điểm danh, ghi danh, chuyển lớp, lớp trải nghiệm, phòng học,
   * đánh giá, học bạ.
   *
   * `"org"` — kèm cả Hội sở, và CHỈ khi người dùng là quản trị hệ thống (chủ dự án
   * chốt 03/09: "ngoại trừ role admin thì các role khác không có lọc HO"). Dùng cho
   * màn tổ chức: nhân sự, chấm công, kho, thông báo, chia lead.
   *
   * ⚠️ Đọc kỹ trước khi dùng `"org"`: dòng `Center` "Hội sở" là bản ghi MỒ CÔI và
   * **không dữ liệu nào mang `centerId` của nó** — nhân sự Hội sở cố ý mang
   * `centerId = null` (`lib/hr/employee-unit.ts`, để không bị neo vai tại HO rồi
   * hoá `isHoLevel`). Nên lọc theo lựa chọn này LUÔN ra 0 dòng. Muốn màn nhân sự
   * lọc đúng người Hội sở thì phải thêm một lựa chọn riêng nghĩa là
   * `centerId IS NULL`, KHÔNG phải dùng id của dòng "Hội sở".
   */
  purpose?: "teaching" | "org";
  /** Kèm cơ sở đã tắt — chỉ cho màn quản trị danh mục cơ sở. Mặc định false. */
  includeInactive?: boolean;
};

/** Phần QUYẾT ĐỊNH, tách thuần để test được không cần DB. */
export function locDanhSachCoSo(
  centers: readonly CenterOption[],
  teachingCenterIds: readonly string[],
  actor: Pick<Actor, "isSuperAdmin" | "isHoLevel" | "visibleCenterIds">,
  purpose: "teaching" | "org",
  /**
   * Id của (các) dòng `Center` ứng với đơn vị HỘI SỞ. Truyền TƯỜNG MINH thay vì
   * suy "không phải cơ sở dạy học thì là Hội sở".
   *
   * ⚠️ VÁ 03/09/2026 — bản đầu suy đúng kiểu đó và SAI: `purpose:"org"` cho lọt
   * MỌI dòng không-phải-cơ-sở, tức cả bản ghi mồ côi (`ITLI_*` — cặn bộ test).
   * Đo được ở màn Duyệt ca, nơi chọn nhầm cơ sở là XOÁ lịch ca cả tháng: ô chọn
   * vẫn bày đủ 6 dòng. "Hội sở" là MỘT đơn vị cụ thể, không phải "phần còn lại".
   */
  hoCenterIds: readonly string[] = [],
): CenterOption[] {
  const laCoSoDayHoc = new Set(teachingCenterIds);
  const laHoiSo = new Set(hoCenterIds);
  // Quản trị hệ thống và người cấp Hội sở thấy mọi cơ sở — đúng cách `scopedDb`
  // quyết định cho dữ liệu (`lib/db-scope.ts:328,333`). Giữ hai đường khớp nhau,
  // kẻo ô lọc bày ra thứ mà bảng bên dưới không bao giờ trả về.
  const thayMoiCoSo = actor.isSuperAdmin || actor.isHoLevel;
  const trongTamNhin = new Set(actor.visibleCenterIds);

  return centers.filter((c) => {
    if (!laCoSoDayHoc.has(c.id)) {
      // Không phải cơ sở dạy học. Chỉ lọt khi ĐÚNG là Hội sở, màn xin "org", VÀ
      // người dùng là quản trị hệ thống. Bản ghi mồ côi KHÔNG BAO GIỜ lọt.
      if (!laHoiSo.has(c.id)) return false;
      if (purpose !== "org" || !actor.isSuperAdmin) return false;
    }
    return thayMoiCoSo || trongTamNhin.has(c.id);
  });
}

export async function getCenterOptions(
  actor: Actor,
  opts: CenterOptionsOpts = {},
): Promise<CenterOption[]> {
  const { purpose = "teaching", includeInactive = false } = opts;

  const [centers, teachingIds, hoUnits] = await Promise.all([
    db.center.findMany({
      where: includeInactive ? {} : { isActive: true },
      // Tie-break `code` TRƯỚC `name`: đo trên DB thật 03/09/2026 thì **mọi** dòng
      // `Center` đều mang `displayOrder = 0` (seed cơ sở không set cột này), nên nấc
      // đầu không phân định gì và thứ tự rơi hết vào nấc sau. Xếp theo `name` khi đó
      // cho ra "Cơ sở Hoàng Diệu" (CS2) đứng TRƯỚC "Trụ sở chính…" (CS1) — trong khi
      // nhãn hiển thị của ô chọn là `code || name`, tức người dùng đọc thấy "CS2, CS1".
      // Các màn trước đây `orderBy: { code: "asc" }` nên vẫn ra CS1 → CS2.
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true },
    }),
    getTeachingCenterIds(),
    // Đơn vị HỘI SỞ trong cây tổ chức. Nối sang dòng `Center` bằng `code` — đúng
    // cây cầu mà `ORG_UNIT_FOR_CENTER_SQL` (lib/org/center-bridge.ts) đã dựng và
    // ghi rõ lý do: `Center("hoi-so")` KHÔNG được OrgUnit nào trỏ tới vì luật V7
    // cấm đơn vị HO mang `centerId`. Không có cầu này thì không cách nào phân
    // biệt "Hội sở" với một bản ghi rác mà không hardcode mã "HO".
    db.orgUnit.findMany({
      where: { type: "HO", deletedAt: null },
      select: { code: true },
    }),
  ]);

  const maHo = new Set(hoUnits.map((u) => u.code));
  const hoCenterIds = centers.filter((c) => c.code && maHo.has(c.code)).map((c) => c.id);

  return locDanhSachCoSo(centers, teachingIds, actor, purpose, hoCenterIds);
}

/**
 * Chuẩn hoá `?centerId=` TRƯỚC khi đưa vào truy vấn. Đi cặp với `getCenterOptions`.
 *
 * Vì sao cần: các màn đang nhét thẳng `searchParams.centerId` vào `where`. Một id
 * không hợp lệ (gõ tay, link cũ, cơ sở vừa bị tắt, hoặc cơ sở NGOÀI tầm nhìn) khi
 * đó cho ra bảng rỗng im lặng — người dùng đọc thành "mất dữ liệu" chứ không phải
 * "lọc sai". Trả `invalid` để màn nói được câu tử tế thay vì bày bảng trắng.
 */
export function resolveCenterParam(
  raw: string | undefined | null,
  options: readonly CenterOption[],
): { centerId?: string; invalid: boolean } {
  const v = raw?.trim();
  if (!v) return { invalid: false };
  return options.some((o) => o.id === v)
    ? { centerId: v, invalid: false }
    : { invalid: true };
}
