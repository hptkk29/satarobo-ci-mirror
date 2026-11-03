// lib/hoa-hong/so-bong.ts — SO BÓNG engine CŨ ↔ engine MỚI: phần THUẦN (phân loại chênh lệch EXPECTED / UNEXPECTED + tóm tắt + dấu vân).
//
// Nguồn: docs/source-commission/05 §7.5 bước 3 (danh sách chênh lệch được chấp nhận), 08 §3.1 hệ quả 1 (ba kiểu lệch của quyết định Marketing 09/10),
// 04 §4.3 (D17). Hướng D+H của đợt UAT cutover.
//
// ── Câu hỏi mà báo cáo này trả lời ──────────────────────────────────────────────────────────────────────────────
// KHÁC với thử tính (`mo-phong.ts`: cùng engine mới, hai bộ chính sách): ở đây hai ENGINE khác nhau chạy trên CÙNG một khoản thu —
//   · phía CŨ  : `mapButToanHoaHong` → `tinhHoaHongTheoKy` trên MỘT bút toán (4 tầng QC · SALE_ADMIN · SALE · QL_TT);
//   · phía MỚI : `lapThu` → `tinhDongChoKhoan` (chính sách hiệu lực tại đầu kỳ P).
// Khoá so là KHOẢN × VAI × NGƯỜI — KHÔNG so tổng: đổi người nhận mà tổng bằng 0 sẽ lọt nếu so tổng.
//
// ── Phân loại dựa vào LỜI GIẢI THÍCH của engine mới, KHÔNG so mã nguồn ────────────────────────────────────────────
// Mỗi dòng chênh được giải thích bằng `VaiDuKien` (trạng thái vai, phạm vi rule thắng, vai có phải vai thu hút, cách tìm người hưởng, nguồn không rõ).
// Không có chỗ nào trong tệp này hỏi «nguồn nào là nguồn quảng cáo» — lưới `[DYN-NOHARD]` quét thư mục này và sẽ đỏ. Bộ vị từ thứ hai về nguồn
// là một phiên bản thứ hai của sự thật, và nó sẽ lệch khỏi dữ liệu (nguồn thứ 10 do admin tạo).
//
// ── Tập EXPECTED ĐÓNG ───────────────────────────────────────────────────────────────────────────────────────────
// Chỉ mã nào mà tài liệu NÓI RÕ là cố ý (mỗi mã kèm trích dẫn trong `TRICH_DAN`). Mọi chênh khác — kể cả chênh MỘT PHẦN, kể cả chênh 1 đồng —
// là UNEXPECTED. Mặc định đóng: một mã mới phải vào danh sách này bằng một quyết định có văn bản, không bằng một cú sửa lưới.
//   · tái tục (D16): nếu cả hai engine cùng gọi là tái tục thì cả hai trả 0 = MATCH, không có chênh; chênh chỉ xảy ra khi engine mới PHÂN LOẠI KHÁC engine cũ. Từ luật v2 (`BO_LUAT_PHAN_LOAI` 2026-10-16.v2)
//     engine mới phân loại TẤT ĐỊNH theo thứ tự mua (04 §5.2 «Luật v2»; mục 23 của 08 §14 đã được đảo), còn engine cũ chỉ xét cờ tay `renewedFromEnrollmentId` (`commission-run.ts`): hai bên lệch nhau vì HAI ĐỊNH NGHĨA
//     khác nhau chứ không vì giờ quét. ĐÃ CÓ QUYẾT ĐỊNH (người điều phối AFF-L2 D-E, 13/10/2026): engine MỚI là nguồn sự thật; chênh do hai định nghĩa khác nhau là `EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE`
//     — CHỈ trong báo cáo so bóng này, KHÔNG sửa tiền theo engine cũ. v6 (2026-10-26) đưa nó vào tập đóng; ngoại lệ ĐỔI NGƯỜI cùng vai vẫn UNEXPECTED (đó là đổi người nhận, không phải đổi cách gọi tên).
//   · chính sách theo CAMPAIGN Affiliate (D-D, cùng quyết định): `AFFILIATE_CAMPAIGN_POLICY` — CHỈ khi rule thắng là rule phạm vi CAMPAIGN của phiên bản đã phát hành VÀ chuỗi đối tác–thành viên–referral VALID–nguồn–
//     campaign hợp lệ vào ngày sự kiện. Thiếu/khác bất kỳ điều kiện nào ⇒ vẫn UNEXPECTED. KHÔNG phải «mọi chênh của Affiliate đều chấp nhận được».
//   · đã xét và KHÔNG đưa vào: lệ phí thi / phí học bù ra khỏi cơ sở — 04 §4.3 tự ghi «SUY… xác nhận ở Q9» ⇒ UNEXPECTED, chủ dự án xác nhận mới đưa vào.
//   · TRIAL_TEACHER (A10): phía cũ KHÔNG nằm trong chuỗi `tinhHoaHongTheoKy` (ghi lúc convert, 1% × giá ghi danh) nên không so được theo khoản —
//     in riêng ở `ngoai.trialTeacher`, không vào EXPECTED hay UNEXPECTED. Nói thẳng, không giấu.
//
// ⚠️ `asOf` và cửa sổ là THAM SỐ (luật 19): tệp này không đọc đồng hồ.
import { createHash } from "node:crypto";

import type { PhamVi } from "./chon-quy-tac";
import type { KetQuaPhanBo } from "./phan-bo-khoan";
import { BO_LUAT_PHAN_LOAI, type MaLuatPhanLoai } from "./phan-loai-giao-dich";
import type { TrangThaiVai } from "./tinh-chinh-sach";
import { MASTER_VAI_HUONG, type KieuResolver } from "./vai-huong";
import { dinhDangSo } from "./vi-sao";

/**
 * Phiên bản LUẬT PHÂN LOẠI của báo cáo này. Đổi bảng EXPECTED / thuật toán ghép / bộ luật phân loại NEW/RENEWAL mà báo cáo dựa vào / mã chẩn đoán ⇒ nâng số này (nó nằm trong dấu vân).
 * v2 (2026-10-16): theo `BO_LUAT_PHAN_LOAI` v2 (phân loại tất định) + thêm mã chẩn đoán `LOAI_BO_THEO_LUAT_V2`. Lưới `[SBG-18]` buộc hai số đi cùng nhau.
 * v3 (2026-10-17): theo `BO_LUAT_PHAN_LOAI` v3 (không ngày nào do người nhập khai đi vào thứ tự mua; mã giữ `PREVIOUS_PURCHASE_UNRESOLVED` · `BACKFILL_ORDER_TIME_UNVERIFIED`) + báo cáo tách `holdLichSuMua`.
 * v4 (2026-10-17): theo `BO_LUAT_PHAN_LOAI` v4 (phép so huỷ / hoàn của tiền lệ với τ xét CẢ ngày khai lẫn giờ máy chủ; lệch nhau ⇒ giữ khoản với mã MỚI `PRECEDENT_STATUS_DATE_DEPENDENT` — hiện trong `chuaTinh.theoMa`,
 *     chưa có dòng riêng ở `holdLichSuMua`).
 * v5 (2026-10-17): theo `BO_LUAT_PHAN_LOAI` v5 (dòng THÊM MUỘN vào đơn có sẵn là lần mua riêng — khoá K theo giờ máy chủ của lần thêm; bảo lưu xét cả ngày khai lẫn giờ máy chủ). Không mã chẩn đoán mới.
 * v6 (2026-10-26, AFF-L2): BẢNG EXPECTED đổi — thêm `AFFILIATE_CAMPAIGN_POLICY` (D-D) và `EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE` (D-E); thêm mã chẩn đoán `DOI_NGUOI_CUNG_VAI_KHI_PHAN_LOAI_KHAC`. `BO_LUAT_PHAN_LOAI` KHÔNG đổi (v5) —
 *     đây là lần đầu hai số tách nhau: lưới `[SBG-18]` được viết lại để cho phép nhiều phiên bản so bóng trên CÙNG một bộ luật phân loại (vẫn buộc: đổi bộ luật phân loại ⇒ phải có phiên bản so bóng MỚI).
 */
export const PHIEN_BAN_LUAT_SO_BONG = "2026-10-26.v6";

export const MA_EXPECTED = [
  "MARKETING_REMOVED_FOR_NON_AD_SOURCE",
  "MARKETING_MOVED_TO_SOURCE_OWNER",
  "MARKETING_REMOVED_UNKNOWN_SOURCE",
  "ACQUISITION_ADDED_BY_SOURCE_POLICY",
  "MATERIAL_OUT_OF_BASE",
  "AFFILIATE_CAMPAIGN_POLICY",
  "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE",
] as const;
export type MaExpected = (typeof MA_EXPECTED)[number];

/** Trích dẫn tài liệu cho TỪNG mã EXPECTED — bắt buộc có (mã không có trích dẫn không được vào danh sách). */
export const TRICH_DAN: Readonly<Record<MaExpected, string>> = {
  MARKETING_REMOVED_FOR_NON_AD_SOURCE:
    "08 §3.1 (chủ dự án xác nhận 09/10/2026: «Marketing 1% chỉ trả cho nguồn quảng cáo») — hệ quả 1(a): mọi khoản của nguồn không quảng cáo mất 1% Marketing.",
  MARKETING_MOVED_TO_SOURCE_OWNER:
    "08 §3.1 hệ quả 1(b): ở nguồn quảng cáo, NGƯỜI nhận 1% đổi từ người phụ trách Marketing của cơ sở sang chủ nguồn (tổng không đổi).",
  MARKETING_REMOVED_UNKNOWN_SOURCE:
    "08 §3.1 hệ quả 1(c) + hệ quả 4; 04 D7: nguồn không rõ nhận mức THẤP NHẤT giữa các nhóm, nên mất Marketing ngay khi một nhóm có dòng loại trừ.",
  ACQUISITION_ADDED_BY_SOURCE_POLICY:
    "08 §3.1 (bảng «Số tiền trên 10.000.000 đ»: nguồn giới thiệu +2% cho vai thu hút) và 08 §5: vai thu hút chỉ có hiệu lực qua chính sách phạm vi nguồn.",
  MATERIAL_OUT_OF_BASE:
    "04 §4.3 (D17): «Engine cũ tính mọi khoản kể cả đơn kit ⇒ số kỳ đầu dưới engine mới giảm đúng phần học cụ. Phải báo trước.» + 05 §7.5 bước 3 («học cụ loại khỏi base»).",
  AFFILIATE_CAMPAIGN_POLICY:
    "docs/source-commission/closeout/l2-engine.md D-D (người điều phối chốt 13/10/2026): dòng mà rule thắng là rule phạm vi CAMPAIGN của phiên bản chính sách đã phát hành, khi chuỗi đối tác–thành viên–referral VALID–nguồn–campaign hợp lệ vào ngày sự kiện, là kết quả CÓ CHỦ ĐÍCH của chính sách campaign — engine cũ không có khái niệm này.",
  EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE:
    "docs/source-commission/closeout/l2-engine.md D-E (người điều phối chốt 13/10/2026): engine MỚI phân loại NEW/RENEWAL theo thứ tự mua là nguồn sự thật; engine cũ chỉ xét cờ tay `renewedFromEnrollmentId`. Chênh do hai định nghĩa khác nhau là chấp nhận được CHỈ TRONG báo cáo so bóng — không sửa tiền theo engine cũ (08 §14 mục 23, 04 §5.2 «Luật v2»).",
};

/** Căn cứ NGẮN (chỉ chỗ tìm trong tài liệu) cho cột «Căn cứ» của trang cutover; câu đầy đủ ở `TRICH_DAN` (hiện khi rê chuột). */
export const CAN_CU_NGAN: Readonly<Record<MaExpected, string>> = {
  MARKETING_REMOVED_FOR_NON_AD_SOURCE: "08 §3.1 hệ quả 1(a)",
  MARKETING_MOVED_TO_SOURCE_OWNER: "08 §3.1 hệ quả 1(b)",
  MARKETING_REMOVED_UNKNOWN_SOURCE: "08 §3.1 hệ quả 1(c), 4",
  ACQUISITION_ADDED_BY_SOURCE_POLICY: "08 §3.1 · §5",
  MATERIAL_OUT_OF_BASE: "04 §4.3 (D17)",
  AFFILIATE_CAMPAIGN_POLICY: "closeout/l2-engine D-D",
  EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE: "closeout/l2-engine D-E",
};

// ── Vai theo thuộc tính của MASTER, không theo mã gõ tay ───────────────────────────────────────────────────────
const VAI_MARKETING: string = MASTER_VAI_HUONG.find((v) => v.legacyTier === "QC")?.code ?? "";
const VAI_GV_TRIAL: string = MASTER_VAI_HUONG.find((v) => v.legacyTier === "TRIAL_TEACHER")?.code ?? "";
if (VAI_MARKETING === "" || VAI_GV_TRIAL === "") throw new Error("Master vai thiếu tầng cũ QC / TRIAL_TEACHER — so bóng không có chỗ ánh xạ.");

// ── Kiểu ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Thành phần của khoản bị đặt ra ngoài phạm vi hoa hồng mới. `THEO_PHAN_LOAI` = phân bổ khoản ĐÃ cho qua (dòng học phí) nhưng bộ phân loại NEW/RENEWAL vẫn đặt nó ra ngoài —
 * hai bước cùng nhìn một dòng đơn mà không đồng ý nó có phải học phí hay không (hoặc dòng đơn không còn). Dữ liệu lạ, không phải quyết định kinh doanh.
 */
export type ThanhPhanNgoai = "MATERIAL" | "OTHER" | "KHAC" | "THEO_PHAN_LOAI";

/**
 * Từ kết quả `phanBoKhoan` của một khoản mà `lapThu` đã `BO_QUA` suy ra thành phần cho báo cáo. THUẦN.
 * `THEO_PHAN_LOAI` CHỈ khi phân bổ đã cho qua (`TACH`) VÀ lý do loại là «ngoài phạm vi» — khi đó nơi duy nhất còn lại có thể loại khoản là bộ phân loại NEW/RENEWAL. Mọi tổ hợp khác ⇒ `KHAC`
 * (không đoán nguyên nhân khi không chứng minh được).
 */
export function thanhPhanKhoanBoQua(pb: KetQuaPhanBo, lyDoBoQua: string): ThanhPhanNgoai {
  if (pb.loai === "NGOAI_PHAM_VI") return pb.thanhPhan === "MATERIAL" ? "MATERIAL" : pb.thanhPhan === "OTHER" ? "OTHER" : "KHAC";
  return pb.loai === "TACH" && lyDoBoQua === "NGOAI_PHAM_VI" ? "THEO_PHAN_LOAI" : "KHAC";
}

/** Một dòng tiền phía CŨ: tầng cũ đã ánh xạ sang mã vai mới. Người nhận luôn là `User`. */
export type DongCu = { roleCode: string; nguoiId: string; soTien: number };

/** Một dòng tiền phía MỚI (> 0). */
export type DongMoi = { roleCode: string; kind: "USER" | "AFFILIATE"; nguoiId: string; soTien: number };

/** Lời giải thích của engine mới cho MỘT vai của MỘT khoản — thứ duy nhất mà phân loại được phép đọc. */
export type VaiDuKien = {
  roleCode: string;
  trangThai: TrangThaiVai;
  /** Phạm vi của rule thắng; `null` khi không có rule. */
  scopeType: PhamVi | null;
  nguonKhongRo: boolean;
  /** `BeneficiaryRole.isAcquisition`. */
  thuHut: boolean;
  resolverType: KieuResolver;
  /**
   * Bộ quy tắc hiệu lực tại P có ít nhất MỘT dòng loại trừ (EXCLUDE) phạm vi nhóm nguồn cho vai này. BẮT BUỘC (luật 7).
   * Cần riêng cho nguồn KHÔNG RÕ: engine không trả `EXCLUDE` cho UNKNOWN mà trả `KHONG_RULE` (mức thấp nhất giữa các nhóm = 0, `chon-quy-tac.ts` `quyTacChoNguonKhongRo`),
   * và `KHONG_RULE` cũng là kết quả của một lỗ cấu hình (vai không có rule nào). Chỉ khi CÓ dòng loại trừ thì mất Marketing ở nguồn không rõ mới là hệ quả có chủ đích
   * của 08 §3.1 hệ quả 4; không có thì là lỗ cấu hình ⇒ UNEXPECTED.
   */
  coDongLoaiTruNhom: boolean;
  /**
   * Vai này đang thắng bằng rule phạm vi CAMPAIGN (AFF-L2, D-D) ⇒ ba sự thật cần để gọi chênh của nó là DỰ KIẾN; `null` khi rule thắng KHÔNG phải phạm vi CAMPAIGN. BẮT BUỘC (luật 7): quên khai là dòng campaign
   * lặng lẽ ra UNEXPECTED (an toàn nhưng chặn cutover oan) — `tsc` liệt kê mọi chỗ dựng.
   */
  chinhSachCampaign: ChinhSachCampaignDuKien | null;
};

/**
 * Ba điều kiện, mỗi cái do MỘT nguồn khác nhau quyết (nên tách ra để mỗi cái có ca âm riêng):
 *   · `phienBanDaPhatHanh` — phiên bản chứa rule thắng KHÔNG phải DRAFT/CANCELLED (đọc từ trạng thái GỐC của phiên bản, trước khi so bóng ép "ACTIVE");
 *   · `campaignKhop`       — campaign của rule thắng LÀ campaign của khoản (rule `scope.campaignId` = `campaignId` đã tra từ attribution);
 *   · `lienKetHopLe`       — chuỗi đối tác–thành viên–referral VALID–nguồn–campaign hợp lệ vào NGÀY SỰ KIỆN (`xetLienKetCampaign`, bao-ve-campaign.ts).
 */
export type ChinhSachCampaignDuKien = { phienBanDaPhatHanh: boolean; campaignKhop: boolean; lienKetHopLe: boolean };

export type MucHold = "SOFT" | "HARD";

export type PhiaMoi =
  | {
      loai: "TINH";
      dong: readonly DongMoi[];
      vai: readonly VaiDuKien[];
      /** Số vai TREO mà engine thật sẽ ghi hàng chờ (thiếu dữ liệu) — KHÔNG gồm trạng thái bình thường (`TREO_IM_LANG`). */
      treoCoHangCho: readonly { roleCode: string; lyDo: string }[];
    }
  /** Trần bị vượt / chồng lấn quy tắc: engine thật ghi 0 dòng cho khoản này. */
  | { loai: "LOI_CAU_HINH"; ma: "VUOT_TRAN" | "CHONG_LAN"; lyDo: string }
  /** `lapThu` trả `GIU` — thiếu dữ liệu để quyết, engine thật ghi hàng chờ. */
  | { loai: "GIU"; ma: string; /** `detail.maLuat` của hàng chờ (mã của BỘ PHÂN LOẠI khi `ma` là MANUAL_REVIEW_REQUIRED / PENDING_REGULATION); `null` khi hàng chờ không mang mã luật. BẮT BUỘC khai (luật 7). */ maLuat: string | null; mucDo: MucHold }
  /** Khoản ra ngoài cơ sở tính hoa hồng mới (không phải học phí). `KHAC` = bộ phân loại loại khoản này ra, không rõ thành phần. */
  | { loai: "NGOAI_PHAM_VI"; thanhPhan: ThanhPhanNgoai };

export type KhoanSoBong = {
  paymentId: string;
  /** Ngày thu giờ VN, "YYYY-MM-DD". */
  ngayThu: string;
  /** Số tiền của khoản thu (> 0). */
  soTienThu: number;
  /** Phía cũ theo khoản: có thể rỗng (tái tục, thiếu người hưởng). */
  cu: readonly DongCu[];
  /** Engine cũ coi khoản này là tái tục (`renewedFromEnrollmentId`) — chỉ để GỢI Ý nguyên nhân khi hai bên phân loại khác nhau. */
  cuLaTaiTuc: boolean;
  /** Loại giao dịch mà engine mới đã quyết; `null` khi không đến được bước đó. */
  loaiMoi: "NEW" | "RENEWAL" | null;
  moi: PhiaMoi;
};

export type LoaiDong = "MATCH" | "EXPECTED_BUSINESS_DELTA" | "UNEXPECTED";

export type DongSoBong = {
  paymentId: string;
  ngayThu: string;
  roleCode: string;
  /** `USER:<id>` / `AFFILIATE:<id>`; `-` cho dòng cấp khoản. */
  nguoi: string;
  cu: number;
  moi: number;
  chenh: number;
  loai: LoaiDong;
  /** EXPECTED: một trong `MA_EXPECTED`. UNEXPECTED: mã CHẨN ĐOÁN (gợi ý nơi tìm nguyên nhân — KHÔNG làm chênh trở thành chấp nhận được). MATCH: `null`. */
  ma: string | null;
  lyDo: string;
};

export type ChuaTinh = { paymentId: string; ma: string; maLuat: string | null; mucDo: MucHold; soTienThu: number; tienCuDuKien: number };

export type KetQuaKhoan = {
  dong: DongSoBong[];
  chuaTinh: ChuaTinh | null;
  /** Số hàng chờ nghiêm trọng mà engine thật sẽ ghi cho khoản này (khoản GIU = 1; mỗi vai treo có hàng chờ = 1). */
  hold: number;
  trialTeacher: { soDong: number; soTien: number };
};

// ── Phân loại MỘT khoản ────────────────────────────────────────────────────────────────────────────────────────

const khoaNguoi = (roleCode: string, nguoi: string): string => `${roleCode}|${nguoi}`;

function gomCu(cu: readonly DongCu[]): Map<string, { roleCode: string; nguoi: string; so: number }> {
  const m = new Map<string, { roleCode: string; nguoi: string; so: number }>();
  for (const d of cu) {
    if (d.roleCode === VAI_GV_TRIAL) continue; // phía cũ không có tầng này trong chuỗi so (xem đầu tệp)
    const nguoi = `USER:${d.nguoiId}`;
    const k = khoaNguoi(d.roleCode, nguoi);
    const x = m.get(k) ?? { roleCode: d.roleCode, nguoi, so: 0 };
    x.so += d.soTien;
    m.set(k, x);
  }
  return m;
}

function gomMoi(dong: readonly DongMoi[]): Map<string, { roleCode: string; nguoi: string; so: number }> {
  const m = new Map<string, { roleCode: string; nguoi: string; so: number }>();
  for (const d of dong) {
    if (d.roleCode === VAI_GV_TRIAL) continue;
    const nguoi = `${d.kind}:${d.nguoiId}`;
    const k = khoaNguoi(d.roleCode, nguoi);
    const x = m.get(k) ?? { roleCode: d.roleCode, nguoi, so: 0 };
    x.so += d.soTien;
    m.set(k, x);
  }
  return m;
}

const dongVN = (n: number): string => dinhDangSo(n);

/**
 * Dòng thắng bằng rule phạm vi CAMPAIGN và ĐỦ BA điều kiện (D-D): phiên bản đã phát hành · campaign của rule LÀ campaign của khoản · chuỗi liên kết hợp lệ vào ngày sự kiện. Thiếu bất kỳ cái nào ⇒ false ⇒ UNEXPECTED.
 * Chỉ xét vai ĐANG SINH ĐÚNG KẾT QUẢ do rule (SINH_DONG) hoặc bị CHÍNH rule campaign loại trừ (EXCLUDE) — vai TREO/KHONG_TIEN không phải kết quả của chính sách.
 */
function theoChinhSachCampaign(v: VaiDuKien | undefined): boolean {
  if (!v || v.scopeType !== "CAMPAIGN" || v.chinhSachCampaign === null) return false;
  if (v.trangThai !== "SINH_DONG" && v.trangThai !== "EXCLUDE") return false;
  const c = v.chinhSachCampaign;
  return c.phienBanDaPhatHanh && c.campaignKhop && c.lienKetHopLe;
}

type Khung = Pick<KhoanSoBong, "paymentId" | "ngayThu">;

function dongMoiKhoan(k: Khung, p: { roleCode: string; nguoi: string; cu: number; moi: number; loai: LoaiDong; ma: string | null; lyDo: string }): DongSoBong {
  return { paymentId: k.paymentId, ngayThu: k.ngayThu, roleCode: p.roleCode, nguoi: p.nguoi, cu: p.cu, moi: p.moi, chenh: p.moi - p.cu, loai: p.loai, ma: p.ma, lyDo: p.lyDo };
}

/**
 * Hai engine phân loại khoản này KHÁC nhau (cũ: cờ tay trên ghi danh; mới: thứ tự mua — luật v2). Điều kiện để một dòng được gọi là `EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE` (D-E):
 * khoản đã TÍNH được ở engine mới (loại + tính), và hai phía bất đồng về "tái tục".
 */
function khacPhanLoai(k: KhoanSoBong): boolean {
  return k.moi.loai === "TINH" && k.loaiMoi !== null && k.cuLaTaiTuc !== (k.loaiMoi === "RENEWAL");
}

/** Gợi ý nguyên nhân cho một chênh UNEXPECTED. CHỈ để người đọc biết tìm ở đâu — không bao giờ biến chênh thành EXPECTED. */
function chanDoan(k: KhoanSoBong, cu: number, moi: number, vai: VaiDuKien | undefined, doiNguoiCungVai: boolean): { ma: string; lyDo: string } {
  if (khacPhanLoai(k) && doiNguoiCungVai) {
    // Phân loại khác nhau NHƯNG vai này còn đổi người (người cũ mất, người mới xuất hiện): đó là đổi NGƯỜI NHẬN, không phải đổi cách gọi tên. Không tuyên bố «phân loại» làm cớ.
    return {
      ma: "DOI_NGUOI_CUNG_VAI_KHI_PHAN_LOAI_KHAC",
      lyDo: `Hai engine phân loại khoản này khác nhau (cũ: ${k.cuLaTaiTuc ? "tái tục" : "học viên mới"}, mới: ${k.loaiMoi === "RENEWAL" ? "tái tục" : "học viên mới"}) nhưng vai ${vai?.roleCode ?? "?"} còn ĐỔI NGƯỜI nhận giữa hai engine — chênh phân loại không giải thích được việc đổi người. Cần người rà.`,
    };
  }
  if (cu > 0 && moi === 0) {
    const tt = vai?.trangThai ?? "KHONG_CO_VAI";
    return { ma: `MAT_DONG_${tt}`, lyDo: `Phía cũ trả ${dongVN(cu)}đ, engine mới không trả (vai ở trạng thái ${tt}). Không có tài liệu nào gọi đây là cố ý.` };
  }
  if (cu === 0 && moi > 0) return { ma: "DONG_MOI_NGOAI_DANH_SACH", lyDo: `Engine mới trả ${dongVN(moi)}đ mà phía cũ không có dòng này. Không có tài liệu nào gọi đây là cố ý.` };
  return {
    ma: vai?.nguonKhongRo ? "SO_TIEN_KHAC_THEO_NGUON_KHONG_RO" : "SO_TIEN_KHAC",
    lyDo: `Cùng người, cùng vai nhưng khác số tiền: cũ ${dongVN(cu)}đ, mới ${dongVN(moi)}đ (chênh ${dongVN(moi - cu)}đ). Chênh MỘT PHẦN luôn là chưa chấp nhận được.`,
  };
}

/** So MỘT khoản. Thuần, tất định. */
export function soSanhKhoan(k: KhoanSoBong): KetQuaKhoan {
  const cu = gomCu(k.cu);
  const tongCu = [...cu.values()].reduce((s, x) => s + x.so, 0);
  const rong: KetQuaKhoan = { dong: [], chuaTinh: null, hold: 0, trialTeacher: { soDong: 0, soTien: 0 } };

  if (k.moi.loai === "GIU") {
    // Thiếu dữ liệu để quyết: KHÔNG phải chênh lệch — là hàng chờ. Đếm riêng (một lỗ dữ liệu không được hiện hai lần: một ở đây, một ở UNEXPECTED).
    return { ...rong, hold: 1, chuaTinh: { paymentId: k.paymentId, ma: k.moi.ma, maLuat: k.moi.maLuat, mucDo: k.moi.mucDo, soTienThu: k.soTienThu, tienCuDuKien: tongCu } };
  }

  const dong: DongSoBong[] = [];

  if (k.moi.loai === "NGOAI_PHAM_VI") {
    const tp = k.moi.thanhPhan;
    for (const x of cu.values()) {
      dong.push(
        tp === "MATERIAL"
          ? dongMoiKhoan(k, { roleCode: x.roleCode, nguoi: x.nguoi, cu: x.so, moi: 0, loai: "EXPECTED_BUSINESS_DELTA", ma: "MATERIAL_OUT_OF_BASE", lyDo: TRICH_DAN.MATERIAL_OUT_OF_BASE })
          : dongMoiKhoan(k, {
              roleCode: x.roleCode,
              nguoi: x.nguoi,
              cu: x.so,
              moi: 0,
              loai: "UNEXPECTED",
              ma: tp === "OTHER" ? "THANH_PHAN_KHAC_CHUA_CHOT" : tp === "THEO_PHAN_LOAI" ? "LOAI_BO_THEO_LUAT_V2" : "NGOAI_PHAM_VI_KHONG_RO",
              lyDo:
                tp === "OTHER"
                  ? "Khoản thuộc thành phần khác học phí và học cụ (lệ phí thi / phí học bù). 04 §4.3 tự ghi việc loại ra khỏi cơ sở là «SUY… xác nhận ở Q9» — chưa chấp nhận được."
                  : tp === "THEO_PHAN_LOAI"
                    ? "Phân bổ khoản coi đây là học phí, nhưng bộ phân loại NEW/RENEWAL (luật v2) lại đặt dòng đơn của nó ra ngoài phạm vi (không phải học phí hoặc không còn dòng đơn) trong khi engine cũ ĐÃ trả hoa hồng. Hai bước không đồng ý về cùng một dòng đơn — chưa có quyết định coi đây là chấp nhận được; cần chủ dự án xác nhận."
                    : "Engine mới loại khoản này ra ngoài phạm vi mà không xác định được thành phần.",
            }),
      );
    }
    return { ...rong, dong };
  }

  if (k.moi.loai === "LOI_CAU_HINH") {
    for (const x of cu.values()) {
      dong.push(dongMoiKhoan(k, { roleCode: x.roleCode, nguoi: x.nguoi, cu: x.so, moi: 0, loai: "UNEXPECTED", ma: k.moi.ma, lyDo: `Engine mới ghi 0 dòng cho khoản này: ${k.moi.lyDo}` }));
    }
    // Phía cũ rỗng vẫn phải HIỆN: lỗi cấu hình là điều chặn cutover dù không có số tiền để so.
    if (dong.length === 0) dong.push(dongMoiKhoan(k, { roleCode: "-", nguoi: "-", cu: 0, moi: 0, loai: "UNEXPECTED", ma: k.moi.ma, lyDo: `Engine mới ghi 0 dòng cho khoản này: ${k.moi.lyDo}` }));
    return { ...rong, dong };
  }

  // ── TINH ──────────────────────────────────────────────────────────────────────────────────────────────────
  const moi = gomMoi(k.moi.dong);
  const vaiTheo = new Map(k.moi.vai.map((v) => [v.roleCode, v]));
  const trial = k.moi.dong.filter((d) => d.roleCode === VAI_GV_TRIAL);
  const keys = [...new Set([...cu.keys(), ...moi.keys()])].sort();

  type Hang = { khoa: string; roleCode: string; nguoi: string; cu: number; moi: number };
  const hang: Hang[] = keys.map((khoa) => {
    const a = cu.get(khoa);
    const b = moi.get(khoa);
    return { khoa, roleCode: (a ?? b)!.roleCode, nguoi: (a ?? b)!.nguoi, cu: a?.so ?? 0, moi: b?.so ?? 0 };
  });

  // Marketing bị loại BỞI RULE: cũ > 0, mới đúng 0, và LỜI GIẢI THÍCH của engine mới là «dòng loại trừ phạm vi nguồn».
  const biLoai = (h: Hang): boolean => {
    const v = vaiTheo.get(h.roleCode);
    if (h.roleCode !== VAI_MARKETING || h.cu <= 0 || h.moi !== 0 || !v) return false;
    if (v.trangThai === "EXCLUDE" && v.scopeType === "SOURCE_GROUP") return true;
    // Nguồn không rõ: engine trả KHONG_RULE (min = 0) — chỉ chấp nhận khi chính bộ quy tắc có dòng loại trừ nhóm cho vai này.
    return v.nguonKhongRo && v.trangThai === "KHONG_RULE" && v.coDongLoaiTruNhom;
  };
  // Vai thu hút MỚI xuất hiện bởi chính sách phạm vi nguồn: cũ = 0, mới > 0.
  const themThuHut = (h: Hang): boolean => {
    const v = vaiTheo.get(h.roleCode);
    return h.cu === 0 && h.moi > 0 && v?.thuHut === true && v.scopeType === "SOURCE_GROUP" && v.trangThai === "SINH_DONG";
  };
  const laChuNguon = (h: Hang): boolean => vaiTheo.get(h.roleCode)?.resolverType === "SOURCE_OWNER";

  const hangBiLoai = hang.filter(biLoai);
  const hangChuNguon = hang.filter((h) => themThuHut(h) && laChuNguon(h));
  const tongBiLoai = hangBiLoai.reduce((s, h) => s + h.cu, 0);
  const tongChuNguon = hangChuNguon.reduce((s, h) => s + h.moi, 0);
  // «Chuyển người nhận»: số tiền chủ nguồn nhận ĐÚNG BẰNG số Marketing mất. Lệch dù 1 đồng ⇒ không phải chuyển — phần lệch là chưa giải thích được.
  const chuyenNguoi = hangChuNguon.length > 0 && hangBiLoai.length > 0 && tongChuNguon === tongBiLoai;

  // Vai nào còn ĐỔI NGƯỜI giữa hai engine (có người cũ mất ∧ có người mới xuất hiện): chênh phân loại KHÔNG giải thích được việc đổi người (D-E).
  const vaiDoiNguoi = new Set<string>();
  for (const a of hang) for (const b of hang) if (a.roleCode === b.roleCode && a.cu > 0 && a.moi === 0 && b.cu === 0 && b.moi > 0) vaiDoiNguoi.add(a.roleCode);

  for (const h of hang) {
    const v = vaiTheo.get(h.roleCode);
    const mot = (loai: LoaiDong, ma: string | null, lyDo: string) => dong.push(dongMoiKhoan(k, { roleCode: h.roleCode, nguoi: h.nguoi, cu: h.cu, moi: h.moi, loai, ma, lyDo }));

    if (h.cu === h.moi) {
      mot("MATCH", null, "Hai engine trả cùng số tiền cho cùng người, cùng vai.");
      continue;
    }
    if (biLoai(h)) {
      const ma: MaExpected = chuyenNguoi ? "MARKETING_MOVED_TO_SOURCE_OWNER" : v?.nguonKhongRo ? "MARKETING_REMOVED_UNKNOWN_SOURCE" : "MARKETING_REMOVED_FOR_NON_AD_SOURCE";
      mot("EXPECTED_BUSINESS_DELTA", ma, TRICH_DAN[ma]);
      continue;
    }
    if (themThuHut(h)) {
      if (laChuNguon(h) && hangBiLoai.length > 0) {
        if (chuyenNguoi) mot("EXPECTED_BUSINESS_DELTA", "MARKETING_MOVED_TO_SOURCE_OWNER", TRICH_DAN.MARKETING_MOVED_TO_SOURCE_OWNER);
        else {
          mot(
            "UNEXPECTED",
            "CHU_NGUON_LECH_SO_TIEN_MARKETING_BI_LOAI",
            `Chủ nguồn nhận ${dongVN(tongChuNguon)}đ thay cho ${dongVN(tongBiLoai)}đ Marketing bị loại (lệch ${dongVN(tongChuNguon - tongBiLoai)}đ). Chuyển người nhận chỉ chấp nhận khi hai số bằng nhau.`,
          );
        }
      } else mot("EXPECTED_BUSINESS_DELTA", "ACQUISITION_ADDED_BY_SOURCE_POLICY", TRICH_DAN.ACQUISITION_ADDED_BY_SOURCE_POLICY);
      continue;
    }
    // D-E: hai engine bất đồng về "tái tục" và vai KHÔNG đổi người ⇒ chênh do HAI ĐỊNH NGHĨA khác nhau. Engine mới là nguồn sự thật; không sửa tiền theo engine cũ.
    // CHỈ khi vai ĐƯỢC engine mới tính ra một kết quả do rule (SINH_DONG/EXCLUDE/KHONG_RULE/KHONG_TIEN). Vai TREO (NGOAI_CUA_SO · THIEU_NGUOI_GIOI_THIEU · LEGACY_DA_TRA — engine mới KHÔNG trả vì thiếu điều kiện)
    // hoặc vai không còn tồn tại ở engine mới là tiền BIẾN MẤT, không phải «cách gọi tên khác»: gọi nó EXPECTED là che mất mát thật khỏi cổng cutover (reviewer Tài chính, 13/10/2026, HIGH).
    if (khacPhanLoai(k) && !vaiDoiNguoi.has(h.roleCode) && v !== undefined && v.trangThai !== "TREO") {
      mot("EXPECTED_BUSINESS_DELTA", "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE", TRICH_DAN.EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE);
      continue;
    }
    // D-D: rule thắng là rule CAMPAIGN của phiên bản đã phát hành, chuỗi liên kết hợp lệ.
    if (theoChinhSachCampaign(v)) {
      mot("EXPECTED_BUSINESS_DELTA", "AFFILIATE_CAMPAIGN_POLICY", TRICH_DAN.AFFILIATE_CAMPAIGN_POLICY);
      continue;
    }
    const cd = chanDoan(k, h.cu, h.moi, v, vaiDoiNguoi.has(h.roleCode));
    mot("UNEXPECTED", cd.ma, cd.lyDo);
  }

  return {
    dong,
    chuaTinh: null,
    hold: k.moi.treoCoHangCho.length,
    trialTeacher: { soDong: trial.length, soTien: trial.reduce((s, d) => s + d.soTien, 0) },
  };
}

// ── Tóm tắt ────────────────────────────────────────────────────────────────────────────────────────────────────

export type SoTienDong = { soDong: number; cu: number; moi: number; chenh: number };
const khong = (): SoTienDong => ({ soDong: 0, cu: 0, moi: 0, chenh: 0 });
const cong = (a: SoTienDong, d: DongSoBong): void => {
  a.soDong += 1;
  a.cu += d.cu;
  a.moi += d.moi;
  a.chenh += d.chenh;
};

/** Những thứ nằm NGOÀI phép so v1 mà người đọc phải biết — do chỗ nạp đếm (khoản hoàn · chuyển nội bộ · không phải học phí). */
export type NgoaiPhamViNap = {
  khoanHoan: { soKhoan: number; soTien: number };
  khoanChuyenNoiBo: number;
  khoanKhongPhaiHocPhi: { soKhoan: number; soTien: number };
};

/** Chính sách hiệu lực tại đầu kỳ P — vào dấu vân để đổi một phiên bản là đổi dấu. */
export type ChinhSachHieuLuc = { policyCode: string; versionId: string; version: number };

/**
 * Hàng chờ do BỘ PHÂN LOẠI NEW/RENEWAL giữ vì lịch sử mua của học viên chưa chốt — tách khỏi lỗi dữ liệu (thiếu con, thiếu người hưởng…). CHỈ để hiển thị / phân loại cho người vận hành; KHÔNG trừ khỏi
 * `hold.tong` và KHÔNG đổi cổng precheck (trừ ra là nới cổng — quyết định của chủ dự án, không của tệp này). Khoản thuộc CÙNG một khoản `chuaTinh` nên không đếm hai lần.
 *   · `lanMuaTruocChuaChot`  — `PREVIOUS_PURCHASE_UNRESOLVED`: đơn trước chưa thu đồng nào, còn sống. Hold nghiệp vụ ĐƯỢC CHẤP NHẬN: tự nhả khi đơn ấy được thu hoặc huỷ (08 §14 mục 23).
 *   · `thuTuMuaChuaKiem`     — `BACKFILL_ORDER_TIME_UNVERIFIED`: có đơn ghi bù / nhập cũ mà thứ tự mua không kiểm chứng được. KHÔNG tự nhả; cần người có thẩm quyền xác nhận thứ tự (chưa có đường quyết tay).
 */
export type HoldLichSuMua = {
  lanMuaTruocChuaChot: { soKhoan: number; soTienThu: number };
  thuTuMuaChuaKiem: { soKhoan: number; soTienThu: number };
};

/** Hai mã của bộ phân loại mà `holdLichSuMua` đếm. Gõ theo `MaLuatPhanLoai` để đổi tên một mã là `tsc` báo. */
export const MA_LUAT_LAN_MUA_CHUA_CHOT: MaLuatPhanLoai = "PREVIOUS_PURCHASE_UNRESOLVED";
export const MA_LUAT_THU_TU_CHUA_KIEM: MaLuatPhanLoai = "BACKFILL_ORDER_TIME_UNVERIFIED";

export type BaoCaoSoBong = {
  phienBanLuat: string;
  boLuatPhanLoai: string;
  cuaSo: { tuNgay: string; denNgay: string };
  /** Ngày VN mà dữ liệu được đọc (= `denNgay` của cửa sổ). KHÔNG phải một thời điểm đồng hồ — để dấu vân ổn định trong ngày. */
  asOf: string;
  chinhSach: ChinhSachHieuLuc[];
  khoan: { tong: number; tinhDuoc: number; chuaTinh: number; ngoaiPhamVi: number; loiCauHinh: number };
  match: SoTienDong;
  expected: SoTienDong & { theoMa: Record<string, SoTienDong> };
  unexpected: SoTienDong & { theoMa: Record<string, SoTienDong> };
  chuaTinh: { soKhoan: number; soTienThu: number; tienCuDuKien: number; theoMa: Record<string, { soKhoan: number; mucDo: MucHold; soTienThu: number }> };
  hold: { tong: number; khoanGiu: number; treoCoHangCho: number };
  holdLichSuMua: HoldLichSuMua;
  ngoai: NgoaiPhamViNap & { trialTeacher: { soKhoan: number; soDong: number; soTien: number } };
  /** Toàn bộ dòng, sắp tất định — dùng để in báo cáo; KHÔNG lưu. */
  dong: DongSoBong[];
  chuaTinhChiTiet: ChuaTinh[];
  dauVan: string;
};

const sapTheo = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function tongHopSoBong(i: {
  khoan: readonly KhoanSoBong[];
  ngoai: NgoaiPhamViNap;
  cuaSo: { tuNgay: string; denNgay: string };
  asOf: string;
  chinhSach: readonly ChinhSachHieuLuc[];
}): BaoCaoSoBong {
  const match = khong();
  const expected: SoTienDong & { theoMa: Record<string, SoTienDong> } = { ...khong(), theoMa: {} };
  const unexpected: SoTienDong & { theoMa: Record<string, SoTienDong> } = { ...khong(), theoMa: {} };
  const dong: DongSoBong[] = [];
  const chuaTinhChiTiet: ChuaTinh[] = [];
  const chuaTheoMa: BaoCaoSoBong["chuaTinh"]["theoMa"] = {};
  const dem = { tinhDuoc: 0, chuaTinh: 0, ngoaiPhamVi: 0, loiCauHinh: 0 };
  let treo = 0;
  const trial = { soKhoan: 0, soDong: 0, soTien: 0 };

  for (const k of [...i.khoan].sort((a, b) => sapTheo(a.paymentId, b.paymentId))) {
    if (k.moi.loai === "GIU") dem.chuaTinh += 1;
    else if (k.moi.loai === "NGOAI_PHAM_VI") dem.ngoaiPhamVi += 1;
    else if (k.moi.loai === "LOI_CAU_HINH") dem.loiCauHinh += 1;
    else dem.tinhDuoc += 1;

    const r = soSanhKhoan(k);
    treo += r.hold - (r.chuaTinh ? 1 : 0);
    if (r.trialTeacher.soDong > 0) {
      trial.soKhoan += 1;
      trial.soDong += r.trialTeacher.soDong;
      trial.soTien += r.trialTeacher.soTien;
    }
    if (r.chuaTinh) {
      chuaTinhChiTiet.push(r.chuaTinh);
      const x = chuaTheoMa[r.chuaTinh.ma] ?? { soKhoan: 0, mucDo: r.chuaTinh.mucDo, soTienThu: 0 };
      x.soKhoan += 1;
      x.soTienThu += r.chuaTinh.soTienThu;
      chuaTheoMa[r.chuaTinh.ma] = x;
    }
    for (const d of r.dong.sort((a, b) => sapTheo(`${a.roleCode}|${a.nguoi}`, `${b.roleCode}|${b.nguoi}`))) {
      dong.push(d);
      if (d.loai === "MATCH") cong(match, d);
      else {
        const nhom = d.loai === "EXPECTED_BUSINESS_DELTA" ? expected : unexpected;
        cong(nhom, d);
        cong((nhom.theoMa[d.ma ?? "?"] ??= khong()), d);
      }
    }
  }

  const khoanGiu = chuaTinhChiTiet.length;
  const sapMa = <T,>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => sapTheo(a, b)));
  const chinhSach = [...i.chinhSach].sort((a, b) => sapTheo(`${a.policyCode}|${a.versionId}`, `${b.policyCode}|${b.versionId}`));
  const baoCao: Omit<BaoCaoSoBong, "dauVan"> = {
    phienBanLuat: PHIEN_BAN_LUAT_SO_BONG,
    boLuatPhanLoai: BO_LUAT_PHAN_LOAI,
    cuaSo: { ...i.cuaSo },
    asOf: i.asOf,
    chinhSach,
    khoan: { tong: i.khoan.length, ...dem },
    match,
    expected: { ...expected, theoMa: sapMa(expected.theoMa) },
    unexpected: { ...unexpected, theoMa: sapMa(unexpected.theoMa) },
    chuaTinh: {
      soKhoan: khoanGiu,
      soTienThu: chuaTinhChiTiet.reduce((s, c) => s + c.soTienThu, 0),
      tienCuDuKien: chuaTinhChiTiet.reduce((s, c) => s + c.tienCuDuKien, 0),
      theoMa: sapMa(chuaTheoMa),
    },
    hold: { tong: khoanGiu + treo, khoanGiu, treoCoHangCho: treo },
    holdLichSuMua: gomHoldLichSuMua(chuaTinhChiTiet),
    ngoai: { ...i.ngoai, trialTeacher: trial },
    dong,
    chuaTinhChiTiet,
  };
  return { ...baoCao, dauVan: dauVanSoBong(baoCao) };
}

function gomHoldLichSuMua(chuaTinh: readonly ChuaTinh[]): HoldLichSuMua {
  const dem = (maLuat: string) => {
    const cac = chuaTinh.filter((c) => c.maLuat === maLuat);
    return { soKhoan: cac.length, soTienThu: cac.reduce((s, c) => s + c.soTienThu, 0) };
  };
  return { lanMuaTruocChuaChot: dem(MA_LUAT_LAN_MUA_CHUA_CHOT), thuTuMuaChuaKiem: dem(MA_LUAT_THU_TU_CHUA_KIEM) };
}

/**
 * DẤU VÂN của báo cáo. Gồm: phiên bản luật phân loại (của tệp này VÀ của bộ phân loại NEW/RENEWAL), cửa sổ, `asOf` (ngày, không phải thời điểm),
 * danh sách + phiên bản chính sách hiệu lực tại P, tổng theo mã, và dấu của TỪNG dòng (khoản|vai|người|cũ|mới|loại|mã) — đổi một đồng ở một dòng là đổi dấu.
 * Cùng đầu vào ⇒ cùng dấu (tất định: mọi mảng đã sắp, không có đồng hồ).
 */
export function dauVanSoBong(b: Omit<BaoCaoSoBong, "dauVan">): string {
  const dongDau = b.dong.map((d) => `${d.paymentId}|${d.roleCode}|${d.nguoi}|${d.cu}|${d.moi}|${d.loai}|${d.ma ?? ""}`);
  const chuaDau = b.chuaTinhChiTiet.map((c) => `${c.paymentId}|${c.ma}|${c.maLuat ?? ""}|${c.soTienThu}|${c.tienCuDuKien}`);
  const goc = JSON.stringify({
    v: b.phienBanLuat,
    pl: b.boLuatPhanLoai,
    cs: b.cuaSo,
    as: b.asOf,
    ch: b.chinhSach.map((c) => `${c.policyCode}|${c.versionId}|${c.version}`),
    kh: b.khoan,
    m: b.match,
    e: b.expected,
    u: b.unexpected,
    h: b.hold,
    hl: b.holdLichSuMua,
    n: b.ngoai,
    d: dongDau,
    c: chuaDau,
  });
  return createHash("sha256").update(goc).digest("hex");
}
