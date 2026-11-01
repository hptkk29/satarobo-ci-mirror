// lib/hoa-hong/hang-cho-so-nhom.ts — NHÓM + NHÃN của hàng chờ SỔ (`CommissionHold`). THUẦN — không DB, không đồng hồ.
//
// Nguồn: docs/source-commission/04 §7.1 (vai "treo"), §10.5 (bảng hàng chờ), 06 §6 ("vai treo tách khỏi danh sách chặn"), 05 TRX-06.
//
// Vì sao tách nhóm: hộp khoá kỳ chỉ đếm hàng chờ CHẶN (`hangChoChanKy`); «Chưa phân giải người hưởng» (đơn không lead, cơ sở chưa khai người
// phụ trách…) là việc cần xử lý nhưng KHÔNG chặn khoá — gộp chung hai loại là làm người duyệt tưởng kỳ bị kẹt vì thứ không kẹt (hoặc ngược
// lại: bỏ sót một khoản tiền không có người nhận vì nó nằm lẫn trong đống "không chặn").
//
// ⚠️ Nhãn dùng `Record<MaHold, string>` / `Record<LyDoTreo, string>`: thêm mã mới vào enum / union mà quên nhãn ⇒ LỖI BIÊN DỊCH (luật 7).
import type { MaHold } from "./hang-cho";
import type { LyDoTreo } from "./nguoi-huong";

export const NHOM_HANG_CHO_SO = ["CHAN_KHOA_KY", "CHUA_PHAN_GIAI_NGUOI_HUONG", "SO_DU_AM"] as const;
export type NhomHangChoSo = (typeof NHOM_HANG_CHO_SO)[number];

export const NHAN_NHOM: Record<NhomHangChoSo, string> = {
  CHAN_KHOA_KY: "Chặn khoá kỳ",
  CHUA_PHAN_GIAI_NGUOI_HUONG: "Chưa phân giải người hưởng",
  SO_DU_AM: "Số dư âm",
};

/** Nhãn tiếng Việt của từng mã hàng chờ — thứ người vận hành đọc, không bao giờ là tên mã. */
export const NHAN_MA_HANG_CHO: Record<MaHold, string> = {
  CHUA_GAN_CON: "Khoản thu chưa gắn bé",
  CHO_HOC_VIEN: "Chờ có học viên",
  CAP_EXCEEDED: "Vượt trần tổng tỉ lệ",
  POLICY_OVERLAP: "Chính sách chồng nhau",
  MANUAL_REVIEW_REQUIRED: "Cần xem tay",
  PENDING_REGULATION: "Chờ văn bản quy định",
  INTERNAL_TRANSFER: "Chuyển tiền giữa hai bé",
  NEGATIVE_WITHOUT_ORIGIN: "Khoản âm không có khoản gốc",
  INPUT_DRIFT: "Đầu vào đã đổi sau khi tính",
  NO_ORG_UNIT: "Chưa quy được đơn vị",
  PAYMENT_WITHDRAWN: "Khoản thu bị rút lại",
  NEGATIVE_BALANCE: "Số dư âm",
  UNRESOLVED_BENEFICIARY: "Chưa phân giải người hưởng",
};

/** Nhóm của một mã — chặn khoá ⇔ `hangChoChanKy` (lưới `[NHH-H-NL-U1]` ghim). */
export function nhomCuaMa(ma: MaHold): NhomHangChoSo {
  if (ma === "UNRESOLVED_BENEFICIARY") return "CHUA_PHAN_GIAI_NGUOI_HUONG";
  if (ma === "NEGATIVE_BALANCE") return "SO_DU_AM";
  return "CHAN_KHOA_KY";
}

/** Mã thuộc nhóm — dùng làm điều kiện `code IN (…)` của truy vấn. Một nguồn với `nhomCuaMa`. */
export function maCuaNhom(nhom: NhomHangChoSo, tatCa: readonly MaHold[]): MaHold[] {
  return tatCa.filter((m) => nhomCuaMa(m) === nhom);
}

// ── LOẠI hiển thị ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `NhomHangChoSo` trả lời «có CHẶN KHOÁ KỲ không» (tab Kỳ); `LoaiHangChoSo` trả lời «cần xử lý VIỆC GÌ» (tab Sổ: hàng chờ nhóm theo loại).
// Hai chiều độc lập, cùng đọc từ một mã — không ai tự đếm lại bằng điều kiện riêng (luật 12b). Thêm mã vào enum mà quên xếp loại ⇒ LỖI BIÊN DỊCH.
export const LOAI_HANG_CHO_SO = [
  "CHUA_PHAN_GIAI_NGUOI_HUONG",
  "CHO_CHINH_SACH",
  "VUOT_TRAN",
  "THIEU_DU_LIEU_THANH_TOAN",
  "CHO_DIEU_CHINH",
  "SO_DU_AM",
] as const;
export type LoaiHangChoSo = (typeof LOAI_HANG_CHO_SO)[number];

export const NHAN_LOAI: Record<LoaiHangChoSo, string> = {
  CHUA_PHAN_GIAI_NGUOI_HUONG: "Chưa phân giải người hưởng",
  CHO_CHINH_SACH: "Chờ chính sách",
  VUOT_TRAN: "Vượt trần / lỗi cấu hình",
  THIEU_DU_LIEU_THANH_TOAN: "Thiếu dữ liệu thanh toán",
  CHO_DIEU_CHINH: "Chờ điều chỉnh",
  SO_DU_AM: "Số dư âm",
};

const LOAI_CUA_MA: Record<MaHold, LoaiHangChoSo> = {
  UNRESOLVED_BENEFICIARY: "CHUA_PHAN_GIAI_NGUOI_HUONG",
  POLICY_OVERLAP: "CHO_CHINH_SACH",
  PENDING_REGULATION: "CHO_CHINH_SACH",
  MANUAL_REVIEW_REQUIRED: "CHO_CHINH_SACH",
  CAP_EXCEEDED: "VUOT_TRAN",
  CHUA_GAN_CON: "THIEU_DU_LIEU_THANH_TOAN",
  CHO_HOC_VIEN: "THIEU_DU_LIEU_THANH_TOAN",
  NO_ORG_UNIT: "THIEU_DU_LIEU_THANH_TOAN",
  INTERNAL_TRANSFER: "CHO_DIEU_CHINH",
  NEGATIVE_WITHOUT_ORIGIN: "CHO_DIEU_CHINH",
  INPUT_DRIFT: "CHO_DIEU_CHINH",
  PAYMENT_WITHDRAWN: "CHO_DIEU_CHINH",
  NEGATIVE_BALANCE: "SO_DU_AM",
};

export function loaiCuaMa(ma: MaHold): LoaiHangChoSo {
  return LOAI_CUA_MA[ma];
}

/** Mã thuộc loại — điều kiện `code IN (…)`. Một nguồn với `loaiCuaMa`. */
export function maCuaLoai(loai: LoaiHangChoSo, tatCa: readonly MaHold[]): MaHold[] {
  return tatCa.filter((m) => loaiCuaMa(m) === loai);
}

/** Lý do «treo» (do resolver ghi vào `detail.lyDo`) → câu tiếng Việt. Phủ ĐỦ `LyDoTreo`. */
export const NHAN_LY_DO_TREO: Record<LyDoTreo, string> = {
  KHONG_CO_LEAD: "Đơn không có lead nên không biết ai phụ trách khoản này",
  LEAD_THIEU_NGUOI: "Lead chưa ghi người phụ trách",
  CHUA_KHAI_NGUOI_PHU_TRACH: "Cơ sở chưa khai người phụ trách (QLCS / Marketing)",
  KHONG_QUY_VE_CO_SO: "Giao dịch không quy được về cơ sở nào",
  KHONG_CO_GV_TRIAL: "Bé chưa có buổi trial có mặt nên chưa có giáo viên",
  THIEU_NGUOI_GIOI_THIEU: "Nguồn cần người giới thiệu nhưng chưa có",
  THIEU_SALE_PHU_HUYNH: "Phụ huynh giới thiệu nhưng chưa xác định được Sale phụ trách phụ huynh lúc ghi nhận nguồn",
  NGUON_CHUA_CO_NGUOI_PHU_TRACH: "Nguồn chưa khai người phụ trách (hoặc người ấy chưa có tài khoản)",
  NGUOI_HUONG_NGHI: "Người hưởng đã nghỉ việc",
  RESOLVER_CHUA_HO_TRO: "Cách xác định người hưởng của vai này chưa được hỗ trợ",
  RESOLVER_KHONG_BIET: "Cách xác định người hưởng của vai này không nhận ra được",
  NGOAI_CUA_SO: "Khoản thu nằm ngoài cửa sổ ghi công",
  LEGACY_DA_TRA: "Đã trả bằng hệ thống cũ lúc chuyển đổi",
};

/** Mã lạ / thiếu ⇒ `null` — KHÔNG bịa nhãn (luật 12: nhãn chỉ khẳng định điều dữ liệu thật sự chứa). */
export function nhanLyDoTreo(ma: unknown): string | null {
  if (typeof ma !== "string") return null;
  return Object.prototype.hasOwnProperty.call(NHAN_LY_DO_TREO, ma) ? NHAN_LY_DO_TREO[ma as LyDoTreo] : null;
}


/** Một câu cho mỗi LOẠI — hiện ở `title` của chip tab Sổ, nói loại này khác loại kia ở đâu. `Record` ⇒ thêm loại mà quên mô tả là lỗi biên dịch (luật 7). */
export const MO_TA_LOAI: Record<LoaiHangChoSo, string> = {
  CHUA_PHAN_GIAI_NGUOI_HUONG: "Khoản thu đã có nhưng chưa tìm ra người nhận một phần hoa hồng (ví dụ đơn chưa nối lead).",
  CHO_CHINH_SACH: "Chưa có chính sách áp dụng được: chính sách chồng nhau, đang chờ văn bản, hoặc cần người xem tay.",
  VUOT_TRAN: "Tổng tỉ lệ vượt trần — lỗi cấu hình, không ghi dòng nào.",
  THIEU_DU_LIEU_THANH_TOAN: "Khoản thu chưa gắn bé / hồ sơ học viên, hoặc chưa quy được đơn vị.",
  CHO_DIEU_CHINH: "Dữ liệu đổi sau khi đã tính, khoản thu bị rút, hoặc bút toán chuyển tiền / khoản âm chưa rõ gốc.",
  SO_DU_AM: "Người hưởng đang âm sau khi trừ các khoản hoàn.",
};

// ── "Dời sang kỳ sau" ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// MỘT câu hỏi "hàng chờ này dời được không?" — nút ở dòng hàng chờ (tab Sổ) và bước kiểm của điều phối server (`doiHangChoSangKyHanhDong`) CÙNG gọi hàm này.
// Tập mã theo 04 §10.5: các hàng chờ CỨNG cần người/văn bản quyết mà bảng ghi «(trừ khi dời kỳ)» — duyệt tay và chờ văn bản. Hai mã cứng còn lại bảng ghi «sửa chính sách rồi
// Tính lại» (vượt trần · chính sách chồng nhau): dời kỳ không giải được gì nên KHÔNG có nút. Hàng chờ MỀM chặn khoá (chưa gắn bé · chờ học viên) tự giải ở lượt quét sau;
// việc có cho dời chúng hay không là quyết định nghiệp vụ còn mở (04 bảng ghi «có (trừ khi dời kỳ)» nhưng đặc tả giao việc chỉ nói nhóm cứng) — chưa cho.
export const MA_DOI_DUOC_SANG_KY_SAU: readonly MaHold[] = ["MANUAL_REVIEW_REQUIRED", "PENDING_REGULATION"];

export type LyDoKhongDoiDuoc = { ma: "HANG_CHO_KHONG_MO" | "HANG_CHO_KHONG_CHAN" | "HANG_CHO_KHONG_DOI_DUOC"; loi: string };

/** `null` = dời được. Chuỗi ma/loi là chính thứ điều phối server trả cho người gọi lén. Trạng thái xét TRƯỚC mã: hàng chờ đã đóng thì không bàn tới loại. */
export function lyDoKhongDoiDuoc(h: { code: MaHold; status: string; blockingPeriodId: string | null }): LyDoKhongDoiDuoc | null {
  if (h.status !== "OPEN") return { ma: "HANG_CHO_KHONG_MO", loi: "Hàng chờ không tồn tại hoặc đã đóng." };
  if (h.blockingPeriodId === null) return { ma: "HANG_CHO_KHONG_CHAN", loi: "Hàng chờ này không chặn kỳ nào — không có gì để dời." };
  if (!MA_DOI_DUOC_SANG_KY_SAU.includes(h.code)) {
    return {
      ma: "HANG_CHO_KHONG_DOI_DUOC",
      loi: `Hàng chờ “${NHAN_MA_HANG_CHO[h.code]}” không dời sang kỳ sau được — chỉ ${MA_DOI_DUOC_SANG_KY_SAU.map((m) => `“${NHAN_MA_HANG_CHO[m]}”`).join(" và ")} dời được. Loại này phải sửa dữ liệu hoặc chính sách rồi Tính lại.`,
    };
  }
  return null;
}

export const laDoiDuocSangKySau = (h: { code: MaHold; status: string; blockingPeriodId: string | null }): boolean => lyDoKhongDoiDuoc(h) === null;

/** `?loai=` trên URL → loại hợp lệ hoặc null (rác ⇒ null, không ném, không đoán). */
export function docLoaiHangCho(raw: string | null | undefined): LoaiHangChoSo | null {
  return LOAI_HANG_CHO_SO.find((l) => l === raw) ?? null;
}

/** Các mã cùng MỘT loại ⇒ loại đó (để một link từ tab khác — vd tab Kỳ — mở đúng chip của tab Sổ); lẫn nhiều loại / rỗng ⇒ null (không lọc, không đoán). */
export function loaiChungCuaCacMa(ma: readonly MaHold[]): LoaiHangChoSo | null {
  const loai = new Set(ma.map(loaiCuaMa));
  return loai.size === 1 ? [...loai][0]! : null;
}
