// lib/hoa-hong/giai-thich-giao-dien.ts — ĐỌC «vì sao 0đ» cho trang / Server Action (Hướng G): bọc `giai-thich-doc.ts` bằng `db` không scope.
//
// Cùng lý do với `doc-so-giao-dien.ts`: tra theo id/phạm vi ĐÃ qua cổng `dieuKienGiaiThich` (= `phamViNguoiXem` của sổ); `app/(admin)/**` không được import `db` trần (ESLint) nên cửa vào
// là tệp này. KHÔNG kiểm quyền "được vào màn hình" — trang/action gác ở đầu hàm; hàm đọc đóng cửa (ném `PermissionError`) nếu actor thiếu cả hai key.
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";

import { demGiaiThich, docGiaiThichKhongTien, docGiaiThichTheoId, docLuaChonGiaiThich, type BoLocGiaiThich, type KetQuaGiaiThich, type LuaChonGiaiThich } from "./giai-thich-doc";
import { dungGiaiThichMo, type GiaiThichMo } from "./giai-thich-ket-qua";

export const docTrangGiaiThich = (actor: Actor, boLoc: BoLocGiaiThich): Promise<KetQuaGiaiThich> => docGiaiThichKhongTien(db, actor, boLoc);

export async function docGiaiThichMo(actor: Actor, id: string): Promise<GiaiThichMo | null> {
  const d = await docGiaiThichTheoId(db, actor, id);
  return d ? dungGiaiThichMo(d) : null;
}

export const demGiaiThichCuaToi = (actor: Actor, centerId: string | null): Promise<number> => demGiaiThich(db, actor, centerId);

export const docLuaChonCuaGiaiThich = (actor: Actor): Promise<LuaChonGiaiThich> => docLuaChonGiaiThich(db, actor);
