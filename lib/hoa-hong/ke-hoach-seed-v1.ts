// lib/hoa-hong/ke-hoach-seed-v1.ts — KẾ HOẠCH seed chính sách v1 = SR.QD.208 (04 §6.7). THUẦN.
//
// Chuyển `CHINH_SACH_MAC_DINH` (chính sách đang chạy ở engine CŨ, `lib/crm/chinh-sach-hoa-hong.ts`) sang bộ chính
// sách MỚI (`CommissionPolicy`/`Version`/`Rule`) để lúc cutover số tiền KHÔNG đổi ngoài các luật đã chốt
// (GV Trial theo thực thu, bỏ học cụ, UNKNOWN = min, D16/D17).
//
//   ACTIVE-ứng-viên  HV_MOI — NEW × 5 vai GLOBAL, Σ 9% = trần (4% Sale · 1% Sale Admin · 2% QLCS · 1% Marketing ·
//                    1% GV Trial).
//   DRAFT            TAI_TUC (RENEWAL — D16: chưa bật, chủ dự án/HR bật có chủ đích) · hai bảng THƯỞNG BẬC theo kỳ
//                    (kiểu TIER_PERIOD_BONUS chưa kích hoạt được ở P0 — 04 §9.2).
//   KHÔNG CHUYỂN    CHUYEN_TRUNG_TAM (loại giao dịch tắt, chưa có bộ nhận diện — 04 §5.3; và vai "giáo viên đã đào
//                    tạo" không phải GV Trial) · BAN_THIET_BI (vai "mọi nhân sự" không có trong master; D17 loại
//                    học cụ khỏi cơ sở). Nằm trong `khongChuyen` kèm lý do — KHÔNG tự bịa vai.
//
// THEO NGUỒN (SPEC nguồn động 09/10/2026 §3 + quyết định «Marketing CHỈ cho nguồn quảng cáo», chủ dự án xác nhận 09/10/2026) — TÁM chính sách NHÁP, phạm vi
// SOURCE_GROUP, loại NEW, mỗi cái MỘT version; tỉ lệ 2%/1% CHỈ sống ở đây (seed policy), KHÔNG là hằng của lõi. Tất cả đều NHÁP — không cái nào là ứng viên kích hoạt:
//   · MỌI nguồn mặc định mang một dòng `EXCLUDE MARKETING` (chính sách của nguồn thắng mức chung CHO ĐÚNG vai Marketing; các vai khác của bộ chung không bị đụng).
//   · PAID_ADS         + SOURCE_OWNER 1%   — Marketing 1% ở nguồn quảng cáo đi tới CHỦ NGUỒN thay cho người phụ trách Marketing của cơ sở. Chưa khai chủ ⇒ guardrail chặn
//                        kích hoạt, và (nếu ép) khoản thu vào hàng chờ — KHÔNG rơi về Marketing cơ sở.
//   · PARENT_REFERRAL  + REFERRER_PARENT_SALE 2% · EMPLOYEE_REFERRAL + REFERRER_EMPLOYEE 2%. Tổng khi kích hoạt đủ có thể VƯỢT trần `crm.commissionMaxTotalRate` ⇒ guardrail
//                        `VUOT_TRAN` CHẶN (không tự cắt) và chỉ đường; nâng trần là THAO TÁC CỦA ADMIN (`huong-xu-ly-tran.ts`), seed không tự nâng.
//   · CENTER_ORGANIC · WALK_IN · EVENT · PARTNER · OTHER: chỉ dòng EXCLUDE MARKETING (không có hoa hồng thu hút).
//   · UNKNOWN: KHÔNG có chính sách (mức của nó là «thấp nhất giữa các nhóm», tính động — D7).
// Hiệu lực của tám nháp KHÔNG kế thừa ngày SR.QD.208 (xem `chuaCoVanBan`): một nháp EXCLUDE kích hoạt với hiệu lực ở quá khứ sẽ gỡ Marketing khỏi kỳ chưa khoá.
//
// Ánh xạ vai: `CENTER_SALES_CSM→SALE · HO_SALE→SALE_ADMIN · CENTER_MANAGER→CENTER_MANAGER · HO_MARKETING→MARKETING
// · TEACHER→TRIAL_TEACHER` (chỉ đúng ở sự kiện HOC_VIEN_MOI, nơi 1% GV là GV dạy Trial — 04 §6.7).
import { CHINH_SACH_MAC_DINH, type ChinhSachHoaHong } from "@/lib/crm/chinh-sach-hoa-hong";

import type { RuleInput } from "./chinh-sach-dau-vao";

export const MA_VAN_BAN_SR208 = "SR.QD.208";

/** Ngày ban hành của SR.QD.208 (CLAUDE.md / 04 §6.7). Ngày CÔNG BỐ chưa có chứng từ ⇒ lấy bằng ngày ban hành, ghi rõ. */
export const NGAY_BAN_HANH_SR208 = "2026-03-01";

/**
 * Hiệu lực bắt đầu mặc định = ban hành 01/03/2026 (Chủ nhật) + 15 ngày làm việc = thứ Sáu 20/03/2026 (giờ VN) —
 * ĐÚNG ngày thứ 15, không dư. Script nhận `--hieu-luc` để đổi (vd khi có ngày công bố chính thức khác).
 */
export const HIEU_LUC_MAC_DINH_SR208 = new Date("2026-03-19T17:00:00.000Z");

const VAI_CU_SANG_MOI: Readonly<Record<string, string>> = {
  CENTER_SALES_CSM: "SALE",
  HO_SALE: "SALE_ADMIN",
  CENTER_MANAGER: "CENTER_MANAGER",
  HO_MARKETING: "MARKETING",
  TEACHER: "TRIAL_TEACHER",
};

export type MucKeHoachSeed = {
  /** Mã policy mới: `SR.QD.208/<mã cũ>`, hoặc `SR.QD.208/NGUON_<mã nguồn>` với chính sách theo nguồn. */
  policyCode: string;
  name: string;
  /** Mã chính sách CŨ nó chép từ đó; `null` với chính sách theo nguồn (không có bản cũ). */
  maCu: string | null;
  /** Mã nguồn (`LeadSourceGroup.code`) nếu phạm vi SOURCE_GROUP; `null` = GLOBAL. Id tra lúc áp dụng — dry-run báo nếu nguồn chưa có. */
  maNhom: string | null;
  /** `true` = ứng viên kích hoạt (cần tệp văn bản + người phụ trách); `false` = để DRAFT. */
  kichHoat: boolean;
  lyDoDraft: string | null;
  /**
   * `true` = chính sách KHÔNG thuộc văn bản SR.QD.208 (quyết định 09/10/2026 chưa có văn bản): tạo nháp KHÔNG gắn văn bản (guardrail đòi admin gắn văn bản + tệp trước khi kích hoạt)
   * và hiệu lực mặc định = ngày 01 THÁNG SAU lúc gieo (hoặc `--hieu-luc` nếu người chạy khai) thay vì 20/03/2026.
   */
  chuaCoVanBan: boolean;
  rules: RuleInput[];
};

export type KeHoachSeedV1 = {
  vanBan: { documentCode: string; title: string; issuedOn: string; publishedOn: string; effectiveOn: string };
  chinhSach: MucKeHoachSeed[];
  khongChuyen: { maCu: string; lyDo: string }[];
};

function ruleTuKhoan(c: ChinhSachHoaHong, loai: "NEW" | "RENEWAL"): RuleInput[] {
  return c.khoan.map((k) => {
    const roleCode = VAI_CU_SANG_MOI[k.vaiNhan];
    if (!roleCode) throw new Error(`Vai cũ "${k.vaiNhan}" của ${c.ma} chưa có ánh xạ sang master mới.`);
    return {
      transactionTypeCode: loai,
      roleCode,
      revenueComponent: "TUITION" as const,
      calcKind: "PERCENT" as const,
      rate: k.giaTri,
      fixedAmount: null,
      tierTable: null,
      note: `Chép từ ${c.nguon}`,
    };
  });
}

/** Bảng bậc → `tierTable` `[{ tu, den, tien, danhHieu }]` (đóng dần: `den` = ngưỡng kế, bậc cuối `null`). */
function bangBac(c: ChinhSachHoaHong): { tu: number; den: number | null; tien: number; danhHieu: string | null }[] {
  const bac = [...(c.bac ?? [])].sort((a, b) => a.nguong - b.nguong);
  return bac.map((b, i) => ({ tu: b.nguong, den: bac[i + 1]?.nguong ?? null, tien: b.thuong, danhHieu: b.danhHieu ?? null }));
}

const LY_DO_NHAP_CHUNG =
  "Nháp theo quyết định của chủ dự án 09/10/2026: Marketing chỉ trả cho nguồn quảng cáo. Kích hoạt = nguồn này thôi trả Marketing theo cơ sở (lệch engine cũ ở nguồn này — đọc runbook shadow-compare). Gắn văn bản + chỉnh hiệu lực (tương lai) trước khi kích hoạt.";
const LY_DO_QUANG_CAO =
  "Người hưởng Marketing chuyển từ người phụ trách Marketing của CƠ SỞ sang CHỦ NGUỒN: phải khai người phụ trách nguồn trước khi kích hoạt (guardrail NGUON_CHUA_CO_NGUOI_PHU_TRACH). Đến hết cửa sổ ghi công của nguồn thì khoản không còn người nhận (vai chủ nguồn chịu cửa sổ, Marketing theo cơ sở thì không).";
const LY_DO_VUOT_TRAN =
  "Cộng tỉ lệ thu hút vào các vai của bộ chung có thể VƯỢT trần `crm.commissionMaxTotalRate` ⇒ guardrail VUOT_TRAN chặn kích hoạt (không tự cắt) và nêu tổng + trần + chênh lệch. Việc của admin: nâng trần ở Cấu hình vận hành (nếu chọn nâng) hoặc chỉnh tỉ lệ rồi kích hoạt lại — hệ thống không tự nâng, không tự cắt.";

const NOTE_KHONG_MARKETING = "Nguồn không phải quảng cáo — không trả Marketing theo cơ sở (chủ dự án xác nhận 09/10/2026: Marketing chỉ cho nguồn quảng cáo)";

const dongSeed = (roleCode: string, calcKind: RuleInput["calcKind"], rate: number | null, note: string): RuleInput => ({
  transactionTypeCode: "NEW",
  roleCode,
  revenueComponent: "TUITION",
  calcKind,
  rate,
  fixedAmount: null,
  tierTable: null,
  note,
});

/** Dòng LOẠI TRỪ Marketing (NEW × TUITION): chính sách của nguồn thắng mức chung cho CHÍNH vai Marketing. */
const dongKhongMarketing = (note: string = NOTE_KHONG_MARKETING): RuleInput => dongSeed("MARKETING", "EXCLUDE", null, note);
/** Dòng thu hút NEW × TUITION × PERCENT. */
const dongThuHut = (roleCode: string, rate: number, note: string): RuleInput => dongSeed(roleCode, "PERCENT", rate, note);

/** Một chính sách NHÁP theo nguồn. Mã chính sách `SR.QD.208/NGUON_<mã nguồn>` (giữ tiền tố SR.QD.208/ cho dọn dẹp + idempotent theo mã). */
function theoNguon(maNhom: string, name: string, lyDoDraft: string, rules: RuleInput[]): MucKeHoachSeed {
  return { policyCode: `${MA_VAN_BAN_SR208}/NGUON_${maNhom}`, name, maCu: null, maNhom, kichHoat: false, lyDoDraft, chuaCoVanBan: true, rules };
}

function chinhSachTheoNguon(): MucKeHoachSeed[] {
  return [
    theoNguon("PAID_ADS", "Nguồn Quảng cáo — Marketing về chủ nguồn", `${LY_DO_NHAP_CHUNG} ${LY_DO_QUANG_CAO}`, [
      dongThuHut("SOURCE_OWNER", 0.01, "Chủ nguồn quảng cáo nhận Marketing 1% (thay người phụ trách Marketing của cơ sở)"),
      dongKhongMarketing("Ở nguồn này người hưởng là chủ nguồn (SOURCE_OWNER); không trả thêm Marketing theo cơ sở — tránh trả hai lần cho một khoản"),
    ]),
    theoNguon("PARENT_REFERRAL", "Nguồn Phụ huynh giới thiệu — Sale phụ trách phụ huynh", `${LY_DO_NHAP_CHUNG} ${LY_DO_VUOT_TRAN}`, [
      dongThuHut("REFERRER_PARENT_SALE", 0.02, "Sale phụ trách phụ huynh giới thiệu — ảnh chụp lúc ghi nhận nguồn"),
      dongKhongMarketing(),
    ]),
    theoNguon("EMPLOYEE_REFERRAL", "Nguồn Nhân sự giới thiệu", `${LY_DO_NHAP_CHUNG} ${LY_DO_VUOT_TRAN}`, [
      dongThuHut("REFERRER_EMPLOYEE", 0.02, "Nhân sự trực tiếp giới thiệu"),
      dongKhongMarketing(),
    ]),
    ...(["CENTER_ORGANIC", "WALK_IN", "EVENT", "PARTNER", "OTHER"] as const).map((maNhom) =>
      theoNguon(maNhom, `Nguồn ${maNhom} — không trả Marketing`, LY_DO_NHAP_CHUNG, [dongKhongMarketing()]),
    ),
  ];
}

export function lapKeHoachSeedV1(): KeHoachSeedV1 {
  const chinhSach: MucKeHoachSeed[] = [];
  const khongChuyen: KeHoachSeedV1["khongChuyen"] = [];

  for (const c of CHINH_SACH_MAC_DINH) {
    const policyCode = `${MA_VAN_BAN_SR208}/${c.ma}`;
    if (c.ma === "HV_MOI") {
      chinhSach.push({ policyCode, name: c.ten, maCu: c.ma, maNhom: null, kichHoat: true, lyDoDraft: null, chuaCoVanBan: false, rules: ruleTuKhoan(c, "NEW") });
    } else if (c.ma === "TAI_TUC") {
      chinhSach.push({
        policyCode,
        name: c.ten,
        maCu: c.ma,
        maNhom: null,
        kichHoat: false,
        lyDoDraft: "D16: tái tục chưa có policy ACTIVE ⇒ không sinh tiền (đúng hành vi hôm nay); HR/BLĐ bật có chủ đích.",
        chuaCoVanBan: false,
        rules: ruleTuKhoan(c, "RENEWAL"),
      });
    } else if (c.kieuTinh === "THUONG_THEO_BAC") {
      const vai = VAI_CU_SANG_MOI[c.khoan[0]!.vaiNhan];
      if (!vai) throw new Error(`Vai cũ "${c.khoan[0]!.vaiNhan}" của ${c.ma} chưa có ánh xạ.`);
      chinhSach.push({
        policyCode,
        name: c.ten,
        maCu: c.ma,
        maNhom: null,
        kichHoat: false,
        lyDoDraft: "TIER_PERIOD_BONUS chưa kích hoạt được ở P0: chưa có văn bản nói \"doanh thu tháng của ai, đo bằng gì\" (04 §9.2).",
        chuaCoVanBan: false,
        rules: [
          {
            transactionTypeCode: "NEW",
            roleCode: vai,
            revenueComponent: "TUITION",
            calcKind: "TIER_PERIOD_BONUS",
            rate: null,
            fixedAmount: null,
            tierTable: bangBac(c),
            note: `Chép từ ${c.nguon}. ${c.ghiChu ?? ""}`.trim(),
          },
        ],
      });
    } else if (c.ma === "CHUYEN_TRUNG_TAM") {
      khongChuyen.push({
        maCu: c.ma,
        lyDo: "Loại giao dịch CHUYEN_TRUNG_TAM đang TẮT (chưa có bộ nhận diện — 04 §5.3, Q4); và vai \"giáo viên đã đào tạo\" 2% không phải GV Trial.",
      });
    } else if (c.ma === "BAN_THIET_BI") {
      khongChuyen.push({
        maCu: c.ma,
        lyDo: "Vai \"mọi nhân sự\" không có trong master vai hưởng; học cụ/thiết bị nằm NGOÀI cơ sở tính (D17).",
      });
    } else {
      throw new Error(`Chính sách cũ "${c.ma}" chưa được xếp vào kế hoạch seed — thêm nhánh ở lapKeHoachSeedV1.`);
    }
  }

  chinhSach.push(...chinhSachTheoNguon());

  return {
    vanBan: {
      documentCode: MA_VAN_BAN_SR208,
      title: "Quy định chính sách hoa hồng — SR.QD.208",
      issuedOn: NGAY_BAN_HANH_SR208,
      publishedOn: NGAY_BAN_HANH_SR208,
      effectiveOn: "2026-03-20",
    },
    chinhSach,
    khongChuyen,
  };
}
