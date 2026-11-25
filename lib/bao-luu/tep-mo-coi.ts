// lib/bao-luu/tep-mo-coi.ts — chọn TỆP MỒ CÔI của kho bảo lưu. THUẦN (không DB, không R2). PHIÊN 7.
//
// Trình duyệt PUT tệp (đơn quét, minh chứng ốm đau — tên trẻ em, tình trạng sức khoẻ) lên kho TRƯỚC khi có hồ sơ nào trỏ tới. Người lập đổi tệp /
// đóng tab / huỷ hồ sơ ⇒ tệp cũ nằm lại vĩnh viễn trong bucket riêng. Khuôn: `lib/finance/hoa-don/tep-mo-coi.ts` (cùng bốn luật).
//
//   1. chỉ khoá đúng hình dạng `KHOA_TEP_BAO_LUU_RE` — thứ gì khác trong bucket không phải của luồng tải lên này thì không xoá;
//   2. chỉ tệp CŨ HƠN 7 ngày theo LastModified — tệp đang tải dở / chờ bấm "Lập hồ sơ" không bị đụng; thiếu LastModified thì giữ;
//   3. không xoá khoá nằm trong tập tham chiếu (`applicationFileKey` ∪ `evidenceFileKeys` của MỌI hồ sơ, MỌI trạng thái — hồ sơ bị từ chối / huỷ
//      vẫn là hồ sơ, tệp của nó là chứng từ);
//   4. trần số tệp mỗi lượt, CŨ NHẤT trước.

import { KHOA_TEP_BAO_LUU_RE } from "@/lib/bao-luu/tep";

export const TIEN_TO_TEP_BAO_LUU = "bao-luu/" as const;
export const TUOI_TOI_THIEU_MS = 7 * 24 * 3600_000;
export const TRAN_XOA_MOI_LUOT = 200;

export type TepTrongKho = { khoa: string; lastModified: Date | null };

export function chonTepMoCoi(input: {
  tep: readonly TepTrongKho[];
  thamChieu: ReadonlySet<string>;
  /** BẮT BUỘC (luật 19) — không rơi về đồng hồ thật. */
  now: Date;
  /** BẮT BUỘC — không có mặc định "không trần". ≤ 0 ⇒ không chọn gì. */
  tran: number;
}): { xoa: string[]; moCoi: number } {
  const moc = input.now.getTime() - TUOI_TOI_THIEU_MS;
  const daThay = new Set<string>();
  const ungVien: { khoa: string; t: number }[] = [];
  for (const f of input.tep) {
    if (daThay.has(f.khoa)) continue;
    daThay.add(f.khoa);
    if (!KHOA_TEP_BAO_LUU_RE.test(f.khoa)) continue;
    if (!f.lastModified) continue;
    const t = f.lastModified.getTime();
    if (!Number.isFinite(t) || t >= moc) continue;
    if (input.thamChieu.has(f.khoa)) continue;
    ungVien.push({ khoa: f.khoa, t });
  }
  ungVien.sort((a, b) => a.t - b.t || a.khoa.localeCompare(b.khoa));
  const tran = Math.max(0, Math.trunc(input.tran));
  return { xoa: ungVien.slice(0, tran).map((u) => u.khoa), moCoi: ungVien.length };
}
