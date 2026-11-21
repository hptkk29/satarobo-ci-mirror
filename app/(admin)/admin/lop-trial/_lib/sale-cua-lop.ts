/**
 * "Lớp trải nghiệm này của Sale nào?" — hỏi ở MỘT chỗ.
 *
 * Chủ dự án 18/09/2026: bảng lớp trial "thêm cột của sale nào".
 *
 * ── VÌ SAO CÓ HAI NGUỒN, KHÔNG PHẢI MỘT ───────────────────────────────────────────────
 * `TrialClassV2` trước 18/09/2026 KHÔNG có cột người tạo. Cột `createdById` thêm hôm nay
 * là NULLABLE và KHÔNG backfill — không có nguồn nào đáng tin để đoán ai đã tạo các lớp
 * cũ, mà đoán sai thì con số "lớp của tôi" của từng Sale sẽ sai mà không ai biết.
 *
 * Nên cột này trả lời bằng hai nguồn, theo thứ tự:
 *   1. NGƯỜI TẠO lớp (`createdById`) — chính xác, và là nguồn DUY NHẤT trả lời được cho
 *      lớp còn rỗng (chưa xếp con nào).
 *   2. SUY từ Sale phụ trách lead của các con đang xếp trong lớp — nguồn duy nhất trả lời
 *      được cho lớp tạo trước hôm nay.
 *
 * Nhánh 2 phải TỰ KHAI là nhánh suy (`suyTuLead: true`) và phải khai luôn khi lớp chứa con
 * của nhiều Sale (`soSaleKhac`): hiện một tên rồi im về những người còn lại là nói dối
 * bằng cách bỏ bớt (luật 12 — nhãn phải nói thật).
 */

export type SaleCuaLop = { ten: string; suyTuLead: boolean; soSaleKhac: number } | null;

export type NguonSuySale = {
  /** Tên người tạo lớp, đã tra từ `User`. `null` = lớp cũ hoặc tài khoản đã xoá. */
  tenNguoiTao: string | null;
  /**
   * Sale phụ trách lead của TỪNG con đang xếp trong lớp, theo thứ tự xếp vào.
   * Phần tử `null` = con đó thuộc lead chưa ai phụ trách.
   */
  saleTheoCon: readonly (string | null)[];
};

export function suySaleCuaLop({ tenNguoiTao, saleTheoCon }: NguonSuySale): SaleCuaLop {
  const tao = (tenNguoiTao ?? "").trim();
  if (tao) return { ten: tao, suyTuLead: false, soSaleKhac: 0 };

  // Giữ THỨ TỰ xuất hiện (con xếp vào trước thì Sale của con đó đứng trước) — `Set` của
  // JS giữ thứ tự chèn, nên tên hiện ra ổn định giữa hai lần tải trang.
  const ds = [...new Set(saleTheoCon.map((s) => (s ?? "").trim()).filter(Boolean))];
  const dau = ds[0];
  if (!dau) return null;
  return { ten: dau, suyTuLead: true, soSaleKhac: ds.length - 1 };
}
