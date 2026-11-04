// lib/settings/read-global.ts — đọc MỘT setting cấp GLOBAL, không kéo theo gì khác.
//
// ── VÌ SAO TÁCH KHỎI `service.ts` ──────────────────────────────────────────────────
// `service.ts` có cả đường GHI, mà đường ghi cần `Actor` (guard quyền) và `writeAudit`.
// Nên `service.ts` → `actor.ts`. Khi `actor.ts` cần đọc một cờ, import ngược lại thành
// VÒNG: actor → service → actor (và vòng dài hơn qua audit-log). `lint:boundaries` chặn
// đúng chỗ đó, và chặn đúng: vòng import làm hai module không tách/test rời được.
//
// File này chỉ có đường ĐỌC cấp GLOBAL nên không cần Actor, không cần audit. Nó dùng
// chung `registry` + `resolve` + cache tag với `service.ts`, nên ghi qua `service.ts`
// vẫn xoá cache của đây — KHÔNG có nguồn sự thật thứ hai.
import { safeCache } from "@/lib/cache/safe-cache";
import { db } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { getSettingDef, type SettingDef } from "./registry";
import { resolveSettingValue } from "./resolve";

async function docTuDb(key: string): Promise<unknown> {
  const def = getSettingDef(key) as SettingDef | undefined;
  if (!def) throw new Error(`Unknown setting key: ${key}`);
  const globalRow = await db.systemSetting.findUnique({ where: { key } });
  return resolveSettingValue({ def, centerRow: null, globalRow });
}

/** Nhịp làm mới mặc định — tham số vận hành đổi vài tháng một lần, 5 phút là quá đủ. */
export const NHIP_MAC_DINH_GIAY = 300;

/**
 * Nhịp làm mới cho các khoá `push.*` — NGẮN HƠN HẲN, và đây không phải vi chỉnh hiệu năng.
 *
 * ── VÌ SAO (14/09/2026) ─────────────────────────────────────────────────────────────────
 * `clearSettingsCache()` ở đường ghi chỉ xoá nhớ đệm CỦA TIẾN TRÌNH ĐANG CHẠY. Trên Vercel
 * mỗi nhánh lambda giữ bản nhớ đệm riêng, nên sau khi bấm Lưu vẫn còn tới `revalidate` giây mà
 * một nhánh khác xét theo danh sách CŨ.
 *
 * Với hầu hết tham số, đọc chậm 5 phút chỉ là chậm. Với `push.tienToDuocDay` thì KHÔNG: một
 * thông báo rơi vào cửa sổ đó bị `lib/push/outbox.ts` chốt thẳng `SKIPPED` — trạng thái CUỐI,
 * engine chỉ quét `PENDING`/`FAILED` — nên nó mất VĨNH VIỄN, im lặng, không lượt gửi nào cứu.
 * Tức một cú bấm Lưu mở ra một cửa sổ 5 phút nuốt thông báo.
 *
 * 30 giây không xoá hẳn cửa sổ ấy (không gì xoá được, trừ khi bỏ nhớ đệm) nhưng thu nó nhỏ
 * gấp mười. Cái giá: thêm tối đa 2 lượt đọc một hàng DB mỗi phút mỗi nhánh — bằng không so với
 * việc mất thông báo.
 *
 * ⚠️ ĐỪNG nới lại thành 300 để "tiết kiệm". Muốn tiết kiệm thì phải sửa chỗ khác trước: để
 * `outbox.ts` ngừng chốt `SKIPPED` ngay lúc ghi, và giao hẳn quyết định cho engine.
 */
export const NHIP_PUSH_GIAY = 30;

const docMacDinh = safeCache(docTuDb, ["setting-global"], {
  tags: [CACHE_TAGS.settings],
  revalidate: NHIP_MAC_DINH_GIAY,
});

// Khoá cache RIÊNG (`setting-global-push`) — dùng chung khoá với bản 300 giây thì Next gộp hai
// lượt gọi làm một và nhịp ngắn không có tác dụng.
const docPush = safeCache(docTuDb, ["setting-global-push"], {
  tags: [CACHE_TAGS.settings],
  revalidate: NHIP_PUSH_GIAY,
});

/** Khoá nào đi đường nhịp ngắn. Suy từ tiền tố, không liệt kê tay từng khoá. */
export function nhipNganChoKhoa(key: string): boolean {
  return key.startsWith("push.");
}

/**
 * Giá trị GLOBAL của một key (bỏ qua override theo cơ sở).
 *
 * Dùng cho cờ hệ thống — thứ KHÔNG được phép lệch nhau giữa các cơ sở. Cần xét override
 * theo cơ sở thì dùng `getSetting` trong `service.ts`.
 */
export async function getGlobalSetting(key: string): Promise<unknown> {
  return nhipNganChoKhoa(key) ? docPush(key) : docMacDinh(key);
}
