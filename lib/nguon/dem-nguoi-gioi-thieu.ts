/**
 * lib/nguon/dem-nguoi-gioi-thieu.ts — «Đối tượng liên quan» của trang chi tiết một nguồn: bao nhiêu lead của nguồn này mang người giới thiệu LOẠI NÀO
 * (nhân sự · phụ huynh · đối tác). CHỈ ĐỌC; chỉ đếm — không tên, không SĐT, không id người.
 *
 * ── Cách ly cơ sở ─────────────────────────────────────────────────────────────────────────────
 * `LeadAttribution` KHÔNG có cột cơ sở (ngoại lệ có chủ đích luật Nền #3), nên KHÔNG bao giờ đọc thẳng bảng đó. Đi qua `scopedDb(actor).lead` với bộ lọc LỒNG
 * `attribution: { is: … }` — cùng khuôn `doc-danh-muc.ts` (ca `[NCL-03]` chứng minh `scopedDb` không rò cơ sở khác qua đường này): QLCS CS1 không đếm lead CS2.
 *
 * Mã nguồn tra bằng quan hệ (`group: { code }`) chứ không qua một câu tìm `id` riêng — một lượt đi-về ít hơn, và nguồn không tồn tại ra toàn số 0 (nơi gọi đã 404 trước).
 */
import { ReferrerKind } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

export type NguoiGioiThieuTheoLoai = Record<ReferrerKind, number>;

export const CAC_LOAI_GIOI_THIEU: readonly ReferrerKind[] = Object.values(ReferrerKind);

export async function demNguoiGioiThieuTheoLoai(actor: Actor, code: string): Promise<NguoiGioiThieuTheoLoai> {
  const sdb = scopedDb(actor);
  const so = await Promise.all(
    CAC_LOAI_GIOI_THIEU.map((k) => sdb.lead.count({ where: { deletedAt: null, attribution: { is: { group: { code }, referrerKind: k } } } })),
  );
  return Object.fromEntries(CAC_LOAI_GIOI_THIEU.map((k, i) => [k, so[i]!])) as NguoiGioiThieuTheoLoai;
}
