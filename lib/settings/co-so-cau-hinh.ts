import "server-only";
import { db } from "@/lib/db";
import { getSettingDef } from "./registry";
import type { PhamViCoSo } from "./quyen-co-so";

/**
 * NẠP DỮ LIỆU CHO KHỐI "CÀI RIÊNG THEO CƠ SỞ" — PHIÊN H · 22/09/2026.
 *
 * ⚠️ Danh sách cơ sở ở đây đọc `OrgUnit`, **KHÔNG** đọc `Center`, và không dùng
 * `getCenterOptions`. Không phải vì `getCenterOptions` sai — nó đúng cho mọi ô lọc DỮ LIỆU —
 * mà vì nó trả `Center.id`, còn `CenterSetting` khoá theo `OrgUnit.id`. Đưa `Center.id` vào
 * thì:
 *
 *   · dòng ghi ra **không khớp** với dòng mà `getSetting(key, { orgUnitId })` đi tìm;
 *   · và nó **không báo lỗi gì** — hàm âm thầm rơi về giá trị toàn hệ.
 *
 * Tức người vận hành bật riêng cho một cơ sở, màn hình nói "đã lưu", nhật ký kiểm toán có
 * dòng, mà cờ không có tác dụng. Đó đúng là lớp lỗi câm mà `lib/finance/feature.ts:31-33` đã
 * dán cảnh báo, và lưới `[FEA-…]` ghim ở tầng lời gọi. Ở đây bịt bằng cách **không bao giờ
 * cầm `Center.id`** — id duy nhất đi qua file này là `OrgUnit.id`.
 */

/** Một cơ sở + giá trị riêng của nó cho MỘT khoá. */
export type CoSoCauHinhRow = {
  orgUnitId: string;
  ten: string;
  /**
   * `undefined` = KHÔNG có dòng riêng ⇒ cơ sở theo mức toàn hệ.
   *
   * ⚠️ Phân biệt bằng `undefined`, KHÔNG bằng falsy: `false` và `0` là giá trị cài riêng
   * HỢP LỆ. Coi chúng là "chưa cài" là xoá mất một trong ba trạng thái.
   */
  giaTriRieng?: unknown;
};

export type CoSoCoBan = { orgUnitId: string; ten: string };

/**
 * Phần QUYẾT ĐỊNH, tách thuần để test không cần DB.
 *
 * @param keys       các khoá đang bày trên màn.
 * @param coSo       danh sách cơ sở, đã sắp xếp sẵn.
 * @param dongRieng  mọi dòng `CenterSetting` đọc được cho các khoá ấy.
 */
export function ghepCaiRieng(
  keys: readonly string[],
  coSo: readonly CoSoCoBan[],
  dongRieng: readonly { orgUnitId: string; key: string; valueJson: unknown }[],
): Record<string, CoSoCauHinhRow[]> {
  const tra = new Map<string, unknown>();
  for (const d of dongRieng) tra.set(`${d.key}\u0000${d.orgUnitId}`, d.valueJson);

  const ra: Record<string, CoSoCauHinhRow[]> = {};
  for (const k of keys) {
    // Khoá KHÔNG cho cài riêng thì không dựng hàng nào — màn sẽ không vẽ khối. Để nó hiện
    // ra là một lời hứa suông: `setCenterSetting` từ chối thẳng những khoá này
    // (`"Key này chỉ cấu hình ở cấp toàn hệ thống"`), nên mọi lần bấm đều thất bại.
    if (!getSettingDef(k)?.centerOverridable) continue;
    ra[k] = coSo.map((c) => {
      const khoaTra = `${k}\u0000${c.orgUnitId}`;
      // `has` chứ không `?? undefined`: một dòng đã ghi giá trị `null` vẫn là "cài riêng".
      return tra.has(khoaTra)
        ? { orgUnitId: c.orgUnitId, ten: c.ten, giaTriRieng: tra.get(khoaTra) }
        : { orgUnitId: c.orgUnitId, ten: c.ten };
    });
  }
  return ra;
}

/**
 * Đọc danh sách cơ sở + mọi giá trị cài riêng cho các khoá đang bày.
 *
 * Trả về map `key → hàng theo cơ sở`. Khoá không `centerOverridable` **vắng mặt** khỏi map,
 * nên màn chỉ cần hỏi `caiRieng[key]` có hay không.
 *
 * ⚠️ Đọc THẲNG `db`, không qua `getSetting`: ở đây cần biết **có dòng hay không**, còn
 * `getSetting` trả giá trị ĐÃ HOÀ (cơ sở → toàn hệ → mặc định) nên nó không bao giờ phân biệt
 * được "cơ sở cài `false`" với "cơ sở theo toàn hệ mà toàn hệ đang `false`". Hai thứ đó khác
 * nhau về hậu quả — xem `clearCenterSetting`.
 */
export async function docCaiRiengTheoCoSo(
  keys: readonly string[],
  /**
   * Chỉ bày những cơ sở người xem SỬA ĐƯỢC. BẮT BUỘC, cố ý không mặc định (luật 7).
   *
   * ⚠️ Mặc định ở đây nguy hiểm theo chiều NỚI: bỏ quên thì màn bày mọi cơ sở, ô của cơ sở
   * người ta không quản lý hiện ra MỞ, và lần bấm Lưu nhận "Không có quyền sửa cấu hình cơ
   * sở này" — một lời hứa suông, đúng luật 12. Trước 24/09 hàm này không có tham số ấy vì
   * chỉ Quản trị tối cao mở được màn, và họ quản lý mọi cơ sở nên không ai thấy lỗ.
   */
  phamVi: PhamViCoSo,
): Promise<Record<string, CoSoCauHinhRow[]>> {
  const khoaCoThe = keys.filter((k) => getSettingDef(k)?.centerOverridable);
  if (khoaCoThe.length === 0) return {};
  // Phạm vi RỖNG là "không cơ sở nào", không phải "không lọc" — fail-closed.
  if (phamVi !== "TAT_CA" && phamVi.length === 0) return {};

  const [coSo, dongRieng] = await Promise.all([
    db.orgUnit.findMany({
      where: {
        type: "CENTER",
        status: "ACTIVE",
        deletedAt: null,
        ...(phamVi === "TAT_CA" ? {} : { id: { in: [...phamVi] } }),
      },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    db.centerSetting.findMany({
      where: { key: { in: [...khoaCoThe] } },
      select: { orgUnitId: true, key: true, valueJson: true },
    }),
  ]);

  return ghepCaiRieng(
    khoaCoThe,
    // Mã cơ sở đứng TRƯỚC tên: người vận hành gọi nhau bằng "CS1" / "CS2", còn tên đầy đủ
    // ("Trụ sở chính — 211 Nguyễn Hữu Thọ") thì dài và hai cơ sở dễ nhìn giống nhau ở đoạn
    // đầu. Cùng lý do `getCenterOptions` xếp theo `code`.
    coSo.map((o) => ({ orgUnitId: o.id, ten: `${o.code} — ${o.name}` })),
    dongRieng,
  );
}
