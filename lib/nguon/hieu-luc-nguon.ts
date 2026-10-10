/**
 * lib/nguon/hieu-luc-nguon.ts — «LEAD MỚI CHỌN ĐƯỢC NGUỒN NÀY LÚC `now` KHÔNG»: MỘT định nghĩa cho mọi ô chọn và mọi cổng ghi
 * (SPEC nguồn động §1.1 «ngoài khoảng ⇒ không chọn được cho lead MỚI»). THUẦN, không DB, không Zod (trình duyệt cũng import).
 *
 * Nơi dùng (mỗi nơi có ca): ô chọn ở form nhập + Sheet «Gán nguồn» (`locNhomChon`) · cổng đổi nguồn (`doiNguonLead`) · cổng ghi nguồn theo Page
 * (`bang-nguon-theo-page`) · đường thu thập tín hiệu của lead mới (`thuThapTinHieuTheoLo`). Một nơi tự viết lại điều kiện là nơi nguồn hết hạn
 * mà vẫn chọn được — hoặc ngược lại — và không test nào đỏ (luật 12b).
 *
 * Lead CŨ mang nguồn đã ngừng/hết hạn vẫn hiển thị và vẫn được tính hoa hồng: hàm này chỉ trả lời «CHỌN MỚI», không trả lời «còn hiển thị».
 */

export type NguonChonDuocTho = {
  status: string;
  selectable: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/**
 * ACTIVE ∧ selectable ∧ trong khoảng hiệu lực (biên: bắt đầu ĐÓNG, kết thúc MỞ — cùng quy ước hiệu lực chính sách).
 * `now` BẮT BUỘC (luật 19).
 */
export function nguonChonDuoc(g: NguonChonDuocTho, now: Date): boolean {
  if (g.status !== "ACTIVE" || !g.selectable) return false;
  return trongKhoangHieuLuc(g, now);
}

/** Chỉ phần KHOẢNG HIỆU LỰC — cho nơi đã có `status`/`selectable` riêng (đường thu thập tín hiệu). `now` BẮT BUỘC. */
export function trongKhoangHieuLuc(g: Pick<NguonChonDuocTho, "effectiveFrom" | "effectiveTo">, now: Date): boolean {
  const t = now.getTime();
  if (g.effectiveFrom && t < g.effectiveFrom.getTime()) return false;
  if (g.effectiveTo && t >= g.effectiveTo.getTime()) return false;
  return true;
}
