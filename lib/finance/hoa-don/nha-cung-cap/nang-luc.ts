// lib/finance/hoa-don/nha-cung-cap/nang-luc.ts — BẢN ĐỒ NĂNG LỰC của một adapter nhà cung cấp hoá đơn. THUẦN.
//
// ⚠️ HAI CỜ, KHÔNG PHẢI MỘT (TD-05, Invoice Hub). Báo cáo 04 trộn hai thứ làm một, báo cáo 10 tách ra:
//   · `providerSupports`  — nhà cung cấp CÓ năng lực này không, theo TÀI LIỆU: "CO" | "KHONG" | "CHUA_XAC_MINH".
//                           "—" trong tài liệu (không nêu) KHÔNG đồng nghĩa "KHONG" ⇒ ghi CHUA_XAC_MINH.
//   · `adapterImplements` — adapter của HỆ THỐNG này đã hiện thực VÀ đã qua bộ test hợp đồng
//                           (`bo-test-hop-dong.ts`) chưa.
// UI và engine CHỈ ĐƯỢC tin `duocPhep()` (= adapterImplements). Đọc `providerSupports` để quyết định hiện nút
// là hứa suông: MISA "có" huỷ hoá đơn, nhưng adapter chưa nối ⇒ nút "Huỷ qua MISA" sẽ gọi vào hư không.
//
// `ghiChu` bắt buộc, và PHẢI mang mức chắc chắn của nguồn (A/B/D/R/—, xem audit 10 mục 0) — một "CO" không kèm
// nguồn là lời nói suông.

/** Mọi năng lực mà Hub có thể đòi ở một nhà cung cấp. Thêm/bớt ở đây là sửa bản đồ của MỌI adapter. */
export const NANG_LUC = [
  "PHAT_HANH",
  "TRA_CUU_THEO_KHOA",
  "TAI_PDF",
  "TAI_XML",
  "KIEM_TRA_KET_NOI",
  "LAY_PHAP_NHAN",
  "DANH_MUC_MAU_KY_HIEU",
  "TRANG_THAI_CQT",
  "GUI_EMAIL",
  "DIEU_CHINH",
  "THAY_THE",
  "HUY",
  "BAO_SAI_SOT",
] as const;

export type NangLuc = (typeof NANG_LUC)[number];

export type ProviderSupports = "CO" | "KHONG" | "CHUA_XAC_MINH";

export type KhaiNangLuc = {
  providerSupports: ProviderSupports;
  adapterImplements: boolean;
  /** Bằng chứng + mức chắc chắn, vd "[A] doc.meinvoice.vn …" — KHÔNG được rỗng. */
  ghiChu: string;
};

export type MucNangLuc = Readonly<KhaiNangLuc>;

export type BanDoNangLuc = Readonly<Record<NangLuc, MucNangLuc>>;

/**
 * Dựng bản đồ từ khai báo đầy đủ. Ném khi:
 *   · thiếu một năng lực (khai thiếu = chưa suy nghĩ về nó — buộc phải nói "KHONG"/"CHUA_XAC_MINH" tường minh);
 *   · `ghiChu` rỗng;
 *   · `adapterImplements` mà `providerSupports ≠ "CO"` (adapter không thể làm thứ nhà cung cấp không có).
 * Trả về bản SAO đóng băng: sửa đầu vào sau đó không đổi bản đồ.
 */
export function taoBanDoNangLuc(khai: Readonly<Record<NangLuc, KhaiNangLuc>>): BanDoNangLuc {
  const ra = {} as Record<NangLuc, MucNangLuc>;
  for (const nl of NANG_LUC) {
    const k = khai[nl] as KhaiNangLuc | undefined;
    if (!k) throw new Error(`Bản đồ năng lực thiếu mục ${nl}.`);
    if (!k.ghiChu || !k.ghiChu.trim()) throw new Error(`Năng lực ${nl} thiếu ghiChu (nguồn + mức chắc chắn).`);
    if (k.adapterImplements && k.providerSupports !== "CO") {
      throw new Error(
        `Năng lực ${nl}: adapterImplements=true nhưng providerSupports=${k.providerSupports} — adapter không thể làm thứ nhà cung cấp không có.`,
      );
    }
    ra[nl] = Object.freeze({
      providerSupports: k.providerSupports,
      adapterImplements: k.adapterImplements,
      ghiChu: k.ghiChu,
    });
  }
  return Object.freeze(ra);
}

/**
 * HÀM DUY NHẤT UI/engine được dùng để hỏi "gọi được không". Chỉ `adapterImplements === true` mới ra true;
 * năng lực lạ (chuỗi ngoài danh sách) ra false — fail-closed.
 */
export function duocPhep(banDo: BanDoNangLuc, nangLuc: NangLuc): boolean {
  if (!(NANG_LUC as readonly string[]).includes(nangLuc)) return false;
  return banDo[nangLuc].adapterImplements === true;
}

/** Câu tiếng Việt nói VÌ SAO không được phép — phân biệt ba tình huống để màn không nói sai sự thật. */
export function lyDoKhongDuocPhep(banDo: BanDoNangLuc, nangLuc: NangLuc): string {
  if (!(NANG_LUC as readonly string[]).includes(nangLuc)) return `Năng lực ${nangLuc} không có trong danh sách của hệ thống.`;
  const muc = banDo[nangLuc];
  if (muc.adapterImplements) return `Năng lực ${nangLuc} đã được nối.`;
  switch (muc.providerSupports) {
    case "CO":
      return `Năng lực ${nangLuc}: nhà cung cấp có hỗ trợ nhưng hệ thống chưa nối (adapter chưa hiện thực / chưa qua test hợp đồng).`;
    case "CHUA_XAC_MINH":
      return `Năng lực ${nangLuc}: chưa xác minh nhà cung cấp có hỗ trợ hay không, và hệ thống chưa nối.`;
    case "KHONG":
      return `Năng lực ${nangLuc}: nhà cung cấp không hỗ trợ.`;
  }
}

export type KetQuaChayNeuDuocPhep<T> = { chay: true; ketQua: T } | { chay: false; lyDo: string };

/**
 * Chạy `chay` CHỈ KHI `duocPhep`. Không được phép ⇒ hàm KHÔNG được gọi và trả lý do. Đây là cổng để engine gọi
 * phương thức tuỳ chọn của adapter — đừng tự kiểm `typeof adapter.huy === "function"` (cờ là nguồn sự thật).
 */
export function chayNeuDuocPhep<T>(banDo: BanDoNangLuc, nangLuc: NangLuc, chay: () => T): KetQuaChayNeuDuocPhep<T> {
  if (!duocPhep(banDo, nangLuc)) return { chay: false, lyDo: lyDoKhongDuocPhep(banDo, nangLuc) };
  return { chay: true, ketQua: chay() };
}
