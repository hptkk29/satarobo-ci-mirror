// lib/auth/menu-gon-db.ts — nạp danh sách mục menu ẩn của các vai (luật ở `./menu-gon.ts`).
// Một câu tra nhỏ trên bảng RoleDef (vài chục dòng) cho mỗi lượt vẽ khung admin; layout chạy nó
// CÙNG LÚC với câu đọc cờ hoá đơn, không nối đuôi thêm một nhịp.
import "server-only";
import { db } from "@/lib/db";

export async function napAnMenuCuaVai(vai: readonly string[]): Promise<Map<string, string[]>> {
  if (vai.length === 0) return new Map();
  const dong = await db.roleDef.findMany({
    where: { code: { in: [...vai] } },
    select: { code: true, anMenu: true },
  });
  return new Map(dong.map((d) => [d.code, d.anMenu]));
}
