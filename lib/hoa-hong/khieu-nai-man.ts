import "server-only";
// lib/hoa-hong/khieu-nai-man.ts — ĐỌC khiếu nại cho MÀN HÌNH (page RSC) và cho số đếm của tab. Page dưới `app/(admin)/**` không được import `@/lib/db` trần
// (ESLint error, CLAUDE.md luật 4) và cũng KHÔNG được đọc bằng `scopedDb` (khiếu nại của chính mình phải thấy ở mọi cơ sở — 02 §11.1), nên đi qua đây.
//
// Phạm vi người xem nằm ở `phamViKhieuNai` (khieu-nai-doc.ts) — hàm này chỉ cấp client và danh sách "ai xử lý được" (cần `nguoiGiuQuyenTaiCoSo`, server-only).
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { nguoiGiuQuyenTaiCoSo } from "@/lib/org/nguoi-giu-quyen-tai-co-so";

import {
  demKhieuNaiCanXuLy,
  docChiTietKhieuNai,
  docDanhSachKhieuNai,
  type BoLocKhieuNai,
  type ChiTietKhieuNai,
  type KetQuaDanhSach,
} from "./khieu-nai-doc";
import { KEY_DUYET_KHIEU_NAI } from "./khieu-nai-ma";
import { docNhatKy, type KenhNhatKy, type KetQuaNhatKy } from "./nhat-ky-doc";

export function docDanhSachChoMan(actor: Actor, boLoc: BoLocKhieuNai, now: Date): Promise<KetQuaDanhSach> {
  return docDanhSachKhieuNai(db, actor, boLoc, now);
}

export function docChiTietChoMan(actor: Actor, id: string): Promise<ChiTietKhieuNai | null> {
  return docChiTietKhieuNai(db, actor, id, async (centerId) => {
    const ids = await nguoiGiuQuyenTaiCoSo(centerId, [KEY_DUYET_KHIEU_NAI]);
    if (ids.length === 0) return [];
    const us = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
    return us.map((u) => ({ id: u.id, ten: u.name ?? u.email ?? u.id }));
  });
}

/** Số khiếu nại đang mở cần người duyệt — `null` khi người xem không giữ quyền duyệt (pill ẩn, không phải 0). */
export function demKhieuNaiChoTab(actor: Actor): Promise<number | null> {
  return demKhieuNaiCanXuLy(db, actor);
}

/** Nhật ký của ba tab con (Đổi nguồn · Lịch sử chính sách · Nhật ký) — CHỈ ĐỌC, phạm vi theo `orgUnitId` (xem `nhat-ky-doc.ts`). */
export function docNhatKyChoMan(actor: Actor, kenh: KenhNhatKy, p: { trang?: number; coTrang?: number }): Promise<KetQuaNhatKy> {
  return docNhatKy(db, actor, kenh, p);
}
