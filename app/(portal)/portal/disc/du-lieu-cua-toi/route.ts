// GET /portal/disc/du-lieu-cua-toi — tải JSON dữ liệu DISC của CHÍNH người đăng nhập. Chỉ đọc.
// Cùng cổng với các trang /portal/disc: cờ tắt ⇒ 404; chưa đăng nhập / không phải PARENT ⇒ 401. `userId` từ PHIÊN.
import { docDuLieuCuaToi } from "@/lib/disc/portal-doc";

import { docPhienDisc } from "../_lib/phien-disc";

export const dynamic = "force-dynamic";

const KHO = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" } as const;

export async function GET(): Promise<Response> {
  const phien = await docPhienDisc();
  if (!phien.ok) return phien.loai === "CO_TAT" ? new Response("Không tìm thấy", { status: 404, headers: KHO }) : new Response("Cần đăng nhập", { status: 401, headers: KHO });
  const dl = await docDuLieuCuaToi(phien.userId, new Date());
  return new Response(JSON.stringify(dl, null, 2), {
    status: 200,
    headers: { ...KHO, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="du-lieu-disc-cua-toi.json"' },
  });
}
