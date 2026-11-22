// lib/parttime/cong-tac-doc.ts — HAI nguồn sự thật của công tắc Parttime, tách riêng một module để test giả được ở đúng ranh giới:
//   · `docPhamViCongTac` — mặc định toàn hệ thống qua `getSetting` (cùng cache + cùng đường giả lập với mọi khoá cấu hình) +
//     mọi ghi đè theo cơ sở (`CenterSetting`).
//   · `rbacV2ChoParttime` — MỘT chỗ hỏi "đang chạy RBAC v2 không" cho Parttime = `isRbacV2Enabled()` (lưới [CT-RBAC-W]).
import { safeCache } from "@/lib/cache/safe-cache";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { db } from "@/lib/db";
import { isRbacV2Enabled } from "@/lib/flags";
import { getSettingDef, type SettingDef } from "@/lib/settings/registry";
import { resolveSettingValue } from "@/lib/settings/resolve";
import { getSetting } from "@/lib/settings/service";
import { KHOA_CONG_TAC, type LoaiCongTac, type PhamViCongTac } from "./cong-tac-thuan";

type PhamViTho = { donVi: [string, boolean][]; coSo: [string, boolean][] };

// Chỉ phần GHI ĐÈ đi qua cache riêng (mặc định toàn hệ thống đã có cache của `getSetting`). Cùng thẻ `settings` ⇒ sửa ở màn
// Cấu hình vận hành là xoá cả hai.
const docGhiDeCache = safeCache(
  async (key: string): Promise<PhamViTho> => {
    const def = getSettingDef(key) as SettingDef<boolean> | undefined;
    if (!def) throw new Error(`Unknown setting key: ${key}`);
    const rows = await db.centerSetting.findMany({ where: { key }, select: { orgUnitId: true, valueJson: true } });
    if (rows.length === 0) return { donVi: [], coSo: [] };
    // Giá trị hỏng ⇒ bỏ dòng (rơi về mặc định) — đúng luật `resolveSettingValue`, không đoán.
    const donVi = rows.flatMap((r) => {
      const v = def.schema.safeParse(r.valueJson);
      return v.success ? [[r.orgUnitId, resolveSettingValue({ def, centerRow: r })] as [string, boolean]] : [];
    });
    const ou = await db.orgUnit.findMany({ where: { id: { in: donVi.map(([id]) => id) } }, select: { id: true, centerId: true } });
    const coSoCua = new Map(ou.map((o) => [o.id, o.centerId]));
    const coSo = donVi.flatMap(([id, v]) => (coSoCua.get(id) ? [[coSoCua.get(id)!, v] as [string, boolean]] : []));
    return { donVi, coSo };
  },
  ["parttime-cong-tac-ghi-de"],
  { tags: [CACHE_TAGS.settings], revalidate: 300 },
);

export async function docPhamViCongTac(loai: LoaiCongTac): Promise<PhamViCongTac> {
  const key = KHOA_CONG_TAC[loai];
  const [macDinh, t] = await Promise.all([getSetting(key) as Promise<boolean>, docGhiDeCache(key)]);
  return { macDinh, theoDonVi: new Map(t.donVi), theoCoSo: new Map(t.coSo) };
}

export function rbacV2ChoParttime(): boolean {
  return isRbacV2Enabled();
}
