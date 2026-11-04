/**
 * lib/affiliate/hoa-hong-campaign-dau-vao.ts — PHẦN THUẦN của mục «Hoa hồng» ở trang chi tiết campaign (AFF-L1, docs/source-commission/closeout/l1-chinh-sach-campaign.md).
 * Không `db`, không đồng hồ, không `"use server"`; client import được.
 *
 * Mục này KHÔNG có engine hay bảng chính sách thứ hai. Chính sách của campaign là `CommissionPolicy` + `CommissionPolicyVersion` (`scopeType = CAMPAIGN`, `scopeCampaignId`) soạn bằng CHÍNH trình soạn
 * ở tab Chính sách; mục này chỉ (1) cho chọn «có thưởng / không có mức riêng» (cột `AffiliateCampaign.rewardMode`), (2) liệt kê các phiên bản của campaign kèm trạng thái, (3) nói THẬT cái gì
 * engine có và không có (bảng `ANH_XA_TRUONG`), (4) chỉ đường tới trình soạn.
 *
 * ── Hai trường, hai nghĩa (người điều phối chốt) ───────────────────────────────────────────────────────────────
 *  · `CommissionPolicyVersion.scopeCampaignId` = phạm vi THỰC THI: chính sách áp cho campaign nào; engine khớp theo nó (và chỉ nó).
 *  · `AffiliateCampaignRule.policyId` = cột cũ «NULL cho tới AFF-P2»: KHÔNG ai ghi, KHÔNG ai đọc ở đường tiền. Đợt này THU GỌN: không có ô, không có đường ghi; cột giữ nullable (không DROP).
 *    Nếu DB mang giá trị (SQL tay) thì cổng kích hoạt đòi nhất quán — xem `kiemKichHoatCampaign` (`POLICY_RULE_LECH`).
 */
import { KIEU_TINH_CHUA_HO_TRO } from "@/lib/hoa-hong/guardrail-kich-hoat";
import type { KhoaTrangThaiPhienBan, ToneTrangThai } from "@/lib/hoa-hong/trang-thai-phien-ban";
import type { CheDoThuong } from "./ghi-campaign-dau-vao";

/** Kiểu tính mà một chính sách campaign CÓ THỂ có — tập của engine (`CommissionCalcKind` trừ `EXCLUDE`, vốn là «không trả», và `TIER_PERIOD_BONUS`, vốn không có nghĩa theo campaign). */
export const KIEU_TINH_CAMPAIGN = ["PERCENT", "FIXED_PER_PURCHASE"] as const;
export type KieuTinhCampaign = (typeof KIEU_TINH_CAMPAIGN)[number];

export const NHAN_KIEU_TINH_CAMPAIGN: Readonly<Record<KieuTinhCampaign, string>> = {
  PERCENT: "Phần trăm",
  FIXED_PER_PURCHASE: "Cố định (số tiền)",
};

/**
 * Một câu NÓI ĐÚNG cách engine tính từng kiểu (AFF-L2b, Q14) — hiển thị ở mục «Cách tính» của campaign khi kiểu đó dùng được. Chữ ở đây là điều engine THẬT SỰ làm (`tinhChinhSachChoPhan`), không phải điều ta mong:
 * cố định = MỘT lần cho mỗi lần mua, ở khoản thu ĐẦU; khoản đầu nhỏ làm tỉ lệ hiệu dụng vượt trần thì cả khoản vào hàng chờ.
 */
export const MO_TA_KIEU_TINH_CAMPAIGN: Readonly<Record<KieuTinhCampaign, string>> = {
  PERCENT: "Dùng được — mỗi khoản học phí đã thu trả theo phần trăm của khoản đó.",
  FIXED_PER_PURCHASE:
    "Dùng được — Cố định: trả một lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện (các khoản thu sau của cùng lần mua không trả thêm; hoàn tiền thu hồi theo tỉ lệ khoản đã hoàn). Số cố định được kiểm trần theo tỉ lệ hiệu dụng = số cố định ÷ khoản thu đầu — khoản đầu quá nhỏ làm vượt trần thì khoản ấy vào hàng chờ, không tự cắt.",
};

export type TrangThaiKieuTinh = { kieu: KieuTinhCampaign; nhan: string; dungDuoc: boolean; ghiChu: string };

/**
 * Từng kiểu tính: dùng được hay chưa — suy từ CHÍNH hằng của guardrail (`KIEU_TINH_CHUA_HO_TRO`), không gõ cứng «PERCENT dùng được / FIXED không». Gỡ một kiểu khỏi hằng đó
 * (engine mở nó) thì dòng này tự đổi, không phải sửa giao diện.
 */
export function trangThaiCacKieuTinh(): TrangThaiKieuTinh[] {
  const khoa = KIEU_TINH_CHUA_HO_TRO as readonly string[];
  return KIEU_TINH_CAMPAIGN.map((kieu) => {
    const dungDuoc = !khoa.includes(kieu);
    return {
      kieu,
      nhan: NHAN_KIEU_TINH_CAMPAIGN[kieu],
      dungDuoc,
      ghiChu: dungDuoc ? MO_TA_KIEU_TINH_CAMPAIGN[kieu] : "Chưa kích hoạt được — chờ quy chế (soạn nháp được, kích hoạt thì hệ thống chặn).",
    };
  });
}

/**
 * Trường trong yêu cầu → khái niệm ĐÃ CÓ của engine. Trường nào engine KHÔNG có thì nói thẳng, không bịa cột (luật 12). Dùng ở mục «Cách tính» của trang và ở notes closeout.
 * `coTrongEngine = false` ⇒ KHÔNG có ô nhập tương ứng ở bất kỳ đâu.
 */
export type DongAnhXaTruong = { truong: string; khaiNiem: string; coTrongEngine: boolean };

export const ANH_XA_TRUONG: readonly DongAnhXaTruong[] = [
  { truong: "Kiểu tính · giá trị", khaiNiem: "Quy tắc (CommissionRule): calcKind + rate / fixedAmount, theo từng vai và loại giao dịch", coTrongEngine: true },
  { truong: "Sự kiện đủ điều kiện", khaiNiem: "Chỉ một sự kiện: khoản học phí đã thu (đã xác nhận). Engine không có sự kiện khác (đăng ký, nhập học…)", coTrongEngine: true },
  { truong: "Khách mới / tái tục", khaiNiem: "Loại giao dịch của quy tắc: NEW hoặc RENEWAL", coTrongEngine: true },
  { truong: "Hiệu lực từ · đến", khaiNiem: "Phiên bản chính sách: effectiveFrom / effectiveTo (đến ngày D ⇒ biên mở 00:00 ngày D+1)", coTrongEngine: true },
  { truong: "Cơ sở tính", khaiNiem: "Thực thu của phần học phí sau VAT (netBase). Không chọn được", coTrongEngine: true },
  { truong: "Trần", khaiNiem: "Một trần CHUNG cho Σ mọi vai trên một khoản thu (cấu hình vận hành crm.commissionMaxTotalRate). Không có trần riêng theo campaign", coTrongEngine: true },
  { truong: "Số ngày giữ (hold)", khaiNiem: "Không có. Hold của engine là hàng chờ theo LÝ DO (thiếu người hưởng, vượt trần…), không phải thời hạn theo ngày", coTrongEngine: false },
  { truong: "Cách cộng dồn (stacking)", khaiNiem: "Không có lựa chọn. Với cùng một vai × loại chỉ MỘT quy tắc thắng — không cộng dồn, không lấy cao nhất — theo thứ tự phạm vi đọc từ cấu hình (mặc định: đối tác > campaign > nhóm nguồn > … > toàn hệ thống); các vai khác nhau thì cộng, rồi kiểm trần", coTrongEngine: false },
];

// ── View-model cho mục «Hoa hồng» ───────────────────────────────────────────────────────────────────────────

export type DongTiLeCampaignView = { loaiGd: string; vai: string; mucTien: string };

export type PhienBanCuaCampaignView = {
  versionId: string;
  policyId: string;
  policyCode: string;
  versionNo: number;
  khoa: KhoaTrangThaiPhienBan;
  nhan: string;
  tone: ToneTrangThai;
  tuNgay: string;
  denNgay: string | null;
  mucTien: DongTiLeCampaignView[];
  coVanBan: boolean;
  capNhatLuc: string;
};

export type HoaHongCampaignView = {
  cheDoThuong: CheDoThuong | null;
  phienBan: PhienBanCuaCampaignView[];
};

/** Quyền người xem có trên mục này — mỗi cờ ứng ĐÚNG một khoá mà action tương ứng kiểm (luật 12). BẮT BUỘC khai đủ (luật 7). */
export type QuyenHoaHongCampaign = {
  /** `affiliate_campaigns:manage` — đổi lựa chọn «thưởng». */
  doiCheDo: boolean;
  /** `commission_policies:view` — xem danh sách phiên bản (số tiền hoa hồng). */
  xemChinhSach: boolean;
  /** `commission_policies:manage` ∧ engine hoa hồng BẬT — có lối vào trình soạn (tab Chính sách 404 khi engine tắt). */
  soanChinhSach: boolean;
};

/** Đường tới trình soạn. `maCampaign` là MÃ (không phải id) — trình soạn tự tra id từ danh sách máy chủ nạp. */
export function hrefSoanChinhSachCampaign(maCampaign: string): string {
  return `/nguon-hoa-hong/chinh-sach/moi?campaign=${encodeURIComponent(maCampaign)}`;
}

/** Nháp ĐÃ CÓ ⇒ mở thẳng nháp đó (trình soạn của chính sách đã có), không đẻ thêm chính sách song song. */
export function hrefSuaNhapChinhSach(policyId: string, versionId: string): string {
  return `/nguon-hoa-hong/chinh-sach/${encodeURIComponent(policyId)}/soan?v=${encodeURIComponent(versionId)}`;
}
