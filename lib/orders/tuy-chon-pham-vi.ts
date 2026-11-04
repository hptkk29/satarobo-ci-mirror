import "server-only";
import { db } from "@/lib/db";
import { getCenterOptions } from "@/lib/org/center-options";
import type { Actor } from "@/lib/auth/actor";
import type { CoSoCoKhuVuc, TuyChonPhamVi } from "@/lib/orders/loc-pham-vi";

/**
 * Danh sách CƠ SỞ + KHU VỰC mà một người được lọc theo, trên màn Đơn hàng [25/09/2026].
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ DÙNG LẠI `getCenterOptions(actor)`, KHÔNG tự tra `Center`.
 *
 * Hàm đó đã lọc theo `actor.visibleCenterIds` và mang sẵn một chú thích đắt giá:
 * *"Giữ hai đường khớp nhau, kẻo ô lọc bày ra thứ mà bảng bên dưới không bao giờ trả
 * về."* Viết bản thứ hai ở đây là mở đúng cái lệch mà câu ấy cảnh báo — ô lọc liệt kê
 * một cơ sở, người dùng chọn, và bảng trả về 0 dòng vì `scopedDb` không cho.
 *
 * ⚠️ KHU VỰC suy từ CÂY, không từ một cột. `OrgUnit` type `CENTER` trỏ `centerId` sang
 * bảng `Center` cũ, và cha của nó là `REGION`. Không có đường tắt nào khác, và cũng
 * không nên có: CLAUDE.md cấm dùng `address` hay bất cứ thứ gì để SUY quan hệ quản lý.
 *
 * ⚠️ Khu vực trả về chỉ gồm khối CÓ ÍT NHẤT MỘT cơ sở trong tầm nhìn. Trả cả khối rỗng
 * là bày cho người ta một lựa chọn chắc chắn ra 0 dòng — lời hứa suông (luật 12).
 */
export async function tuyChonPhamViDon(actor: Actor): Promise<{
  coSo: CoSoCoKhuVuc[];
  khuVuc: TuyChonPhamVi[];
}> {
  const coSoThay = await getCenterOptions(actor);
  if (coSoThay.length === 0) return { coSo: [], khuVuc: [] };

  const idCoSo = coSoThay.map((c) => c.id);

  // Hai câu KHÔNG cần kết quả của nhau ⇒ một lô. Trang đơn đã có bài học "độ sâu tuần tự".
  const [nutCoSo, khoi] = await Promise.all([
    db.orgUnit.findMany({
      where: { type: "CENTER", centerId: { in: idCoSo }, deletedAt: null },
      select: { centerId: true, parentId: true },
    }),
    db.orgUnit.findMany({
      where: { type: "REGION", deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const khuVucCuaCoSo = new Map(
    nutCoSo
      .filter((n): n is { centerId: string; parentId: string | null } => n.centerId !== null)
      .map((n) => [n.centerId, n.parentId]),
  );

  const coSo: CoSoCoKhuVuc[] = coSoThay.map((c) => ({
    id: c.id,
    // Nhãn ô chọn: mã đi trước cho dễ quét mắt ("CS1 · Cơ sở 1"), rơi về tên khi thiếu mã.
    ten: c.code ? `${c.code} · ${c.name}` : c.name,
    khuVucId: khuVucCuaCoSo.get(c.id) ?? null,
  }));

  const khoiCoCoSo = new Set(coSo.map((c) => c.khuVucId).filter((x): x is string => x !== null));

  return {
    coSo,
    khuVuc: khoi.filter((k) => khoiCoCoSo.has(k.id)).map((k) => ({ id: k.id, ten: k.name })),
  };
}
