// lib/hoa-hong/vi-sao-day-du.ts — NGĂN "VÌ SAO CON SỐ NÀY" đầy đủ (06 §2.3): chuỗi nhân quả của MỘT dòng sổ + điều chỉnh liên quan + dòng thời gian. THUẦN.
//
// Mở rộng `dungViSao` (vi-sao.ts) chứ không thay: công thức và kiểm trần lấy lại từ chính nó (một nguồn chữ, luật 12b). Thêm những thứ mà ảnh chụp
// trên dòng KHÔNG tự mang được — TÊN (nguồn, vai, người, học viên), khoản thu gốc, các dòng liên quan, nhật ký — do tầng đọc (`vi-sao-doc.ts`) tra theo id
// rồi đưa vào đây dưới dạng thuần.
//
// Thứ tự = thứ tự NHÂN QUẢ, không phải thứ tự bảng: khoản thu → cơ sở tính → VAT → loại giao dịch → nguồn → người hưởng → chính sách → tỉ lệ → hoa hồng →
// trần → kỳ → chi trả. Mỗi bước trả lời "vì sao" của bước sau nó.
//
// ⚠️ KHÔNG đọc chính sách live, KHÔNG tính lại tiền. Mọi con số đều là con số đã ghi trên dòng.
import type { CommissionPayoutStatus } from "@prisma/client";

import { gioVN, ngayVN } from "@/lib/format/thoi-gian-vn";

import { kyHienThi } from "./dinh-dang";
import { dungNhanGiaiThich, type DongKhongPhatSinhTho, type NhanGiaiThich } from "./giai-thich-khong-tien";
import { dinhDangDong, dungViSao, NHAN_BUOC_VI_SAO, phanTram, tenLoaiDong, type DongChoViSao } from "./vi-sao";

// ── Định dạng ngày (ISO UTC → giờ VN) ───────────────────────────────────────────────────────────────────────
const ddmmyyyy = (iso: string): string => {
  const [y, m, d] = ngayVN(new Date(iso)).split("-");
  return `${d}/${m}/${y}`;
};
/** "2026-10" → "10/2026". Chuỗi lạ giữ nguyên (không đoán). */
/** "dd/MM/yyyy HH:mm" giờ VN. */
export function ngayGioHienThi(iso: string): string {
  const g = gioVN(new Date(iso)); // 2026-10-12T09:00:00+07:00
  return `${g.slice(8, 10)}/${g.slice(5, 7)}/${g.slice(0, 4)} ${g.slice(11, 16)}`;
}

// ── Cách phân giải người hưởng ─────────────────────────────────────────────────────────────────────────────
const CAN_CU: Record<string, string> = {
  LEAD_CONVERTED_BY: "Người chốt lead",
  LEAD_ADMIN: "Người phụ trách lead (admin)",
  TRIAL_TEACHER: "Giáo viên dạy buổi Trial",
  ASSIGNEE_QC: "Người phụ trách cơ sở được khai",
  ASSIGNEE_QL_TT: "Người phụ trách cơ sở được khai",
  QC: "Người phụ trách cơ sở được khai",
  QL_TT: "Người phụ trách cơ sở được khai",
  REFERRER_PARENT: "Người giới thiệu ghi trên nguồn",
  REFERRER_EMPLOYEE: "Người giới thiệu ghi trên nguồn",
  AFFILIATE: "Người giới thiệu ghi trên nguồn",
};

/** `resolverBasis` là JSON do engine ghi — đọc phòng thủ, không in JSON thô ra màn. */
export function cachPhanGiaiNguoiHuong(_resolverType: string, basis: unknown): string {
  const MAC_DINH = "Theo chính sách của vai";
  if (typeof basis !== "object" || basis === null || Array.isArray(basis)) return MAC_DINH;
  const b = basis as Record<string, unknown>;
  if (b.engineCu === true) return "Bảng kê của sổ hoa hồng cũ";
  const canCu = b.canCu;
  if (typeof canCu !== "string") return MAC_DINH;
  const khoa = canCu.split("@")[0]!.split(":")[0]!.trim();
  return CAN_CU[khoa] ?? MAC_DINH;
}

/** Chi tiết Affiliate trong `resolverBasis.affiliate` (đã đọc phòng thủ). Không bao giờ in `parentPartyId` — chỉ biết "đối tác tổ chức". */
/**
 * Cửa sổ nào đã quyết "còn đủ điều kiện" cho vai AFFILIATE (D-A) — đọc từ `resolverBasis.affiliate.cuaSo`. `ap`: "BAO_VE_CAMPAIGN" = cửa sổ bảo vệ của campaign thay cửa sổ nguồn; "NGUON" = cửa sổ ghi công
 * của nguồn vẫn là luật. `lyDo` là MÃ máy (không in thô): bảng `CAU_CUA_SO` bên dưới dựng chữ.
 */
export type ChiTietCuaSo = { ap: "BAO_VE_CAMPAIGN" | "NGUON"; lyDo: string | null; baoVeDen: string | null; cuaSoNguonNgay: number | null; ngoaiCuaSoNguon: boolean | null };
export type ChiTietAffiliate = { tuNhan: string | null; typeCode: string | null; laToChuc: boolean; cuaSo: ChiTietCuaSo | null; protectWindowDays: number | null };

export function docChiTietAffiliate(basis: unknown): ChiTietAffiliate | null {
  if (typeof basis !== "object" || basis === null || Array.isArray(basis)) return null;
  const a = (basis as Record<string, unknown>).affiliate;
  if (typeof a !== "object" || a === null || Array.isArray(a)) return null;
  const r = a as Record<string, unknown>;
  const chu = (x: unknown): string | null => (typeof x === "string" && x.trim().length > 0 ? x : null);
  const so = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const cs = r.cuaSo;
  let cuaSo: ChiTietCuaSo | null = null;
  if (typeof cs === "object" && cs !== null && !Array.isArray(cs)) {
    const c = cs as Record<string, unknown>;
    if (c.ap === "BAO_VE_CAMPAIGN" || c.ap === "NGUON") {
      cuaSo = { ap: c.ap, lyDo: chu(c.lyDo), baoVeDen: chu(c.baoVeDen), cuaSoNguonNgay: so(c.cuaSoNguonNgay), ngoaiCuaSoNguon: typeof c.ngoaiCuaSoNguon === "boolean" ? c.ngoaiCuaSoNguon : null };
    }
  }
  const camp = r.campaign;
  const protectWindowDays = typeof camp === "object" && camp !== null && !Array.isArray(camp) ? so((camp as Record<string, unknown>).protectWindowDays) : null;
  return { tuNhan: chu(r.tuNhan), typeCode: chu(r.typeCode), laToChuc: r.partyKind === "ORGANIZATION", cuaSo, protectWindowDays };
}

/** Mã lý do `cuaSo.lyDo` → một câu tiếng Việt (không in mã trần). Mã lạ ⇒ không đoán (null). */
const CAU_CUA_SO: Readonly<Record<string, string>> = {
  MIEN_CUA_SO_NGUON: "Chính sách riêng của campaign áp dụng, nên cửa sổ ghi công của nguồn KHÔNG vô hiệu khoản này lần hai.",
  TRONG_CUA_SO_NGUON: "Khoản về trong cửa sổ ghi công của nguồn nên không cần đến cửa sổ bảo vệ của campaign.",
  CHINH_SACH_DUNG_CUA_SO_NGUON_HOAC_KHONG_PHAI_CAMPAIGN: "Khoản về ngoài cửa sổ ghi công của nguồn; chính sách thắng yêu cầu dùng cửa sổ nguồn hoặc không phải chính sách của campaign — nên cửa sổ nguồn vẫn là luật.",
  KHONG_CO_THANH_VIEN: "Đối tác không có tư cách thành viên của campaign vào ngày thu — cửa sổ nguồn vẫn là luật.",
  KHONG_CO_REFERRAL_HOP_LE: "Không có referral hợp lệ của đối tác cho khách này — cửa sổ nguồn vẫn là luật.",
  NGUON_KHONG_KHOP: "Nguồn của khách đã khác nguồn campaign ghi nhận lúc giới thiệu — cửa sổ nguồn vẫn là luật.",
  REFERRAL_KHONG_CO_HAN_BAO_VE: "Referral không có hạn bảo vệ — cửa sổ nguồn vẫn là luật.",
  HET_HAN_BAO_VE: "Ngày thu đã quá hạn bảo vệ của campaign — cửa sổ nguồn vẫn là luật.",
  THANH_VIEN_CHUA_HIEU_LUC: "Ngày thu trước khi đối tác có hiệu lực trong campaign — cửa sổ nguồn vẫn là luật.",
  THANH_VIEN_DA_HET_HIEU_LUC: "Ngày thu sau khi đối tác hết hiệu lực trong campaign — cửa sổ nguồn vẫn là luật.",
  CAMPAIGN_NGOAI_HIEU_LUC: "Ngày thu nằm ngoài thời gian hiệu lực của campaign — cửa sổ nguồn vẫn là luật.",
};

/** Mục «Cửa sổ ghi công» của ngăn: nói cửa sổ NÀO đã áp và VÌ SAO (D-A). `null` khi dòng không mang phép đo nào. */
export function mucCuaSo(c: ChiTietCuaSo | null, protectWindowDays: number | null): MucViSao | null {
  if (c === null) return null;
  const cau = c.lyDo ? (CAU_CUA_SO[c.lyDo] ?? null) : null;
  if (c.ap === "BAO_VE_CAMPAIGN") {
    const den = c.baoVeDen ? ` đến ${ddmmyyyy(c.baoVeDen)}` : "";
    const cuaSo = protectWindowDays !== null ? ` (${protectWindowDays} ngày)` : "";
    return { nhan: "Cửa sổ ghi công", giaTri: `Bảo vệ của campaign${den}${cuaSo}`, ...(cau ? { ghiChu: cau } : {}) };
  }
  const ngay = c.cuaSoNguonNgay !== null ? ` (${c.cuaSoNguonNgay} ngày)` : "";
  return { nhan: "Cửa sổ ghi công", giaTri: `Của nguồn${ngay}`, ...(cau ? { ghiChu: cau } : {}) };
}

// ── Kiểu ───────────────────────────────────────────────────────────────────────────────────────────────────
export type DongLienQuanTho = {
  id: string;
  entryKind: string;
  amount: number;
  kyGhi: string;
  kyHieuLuc: string;
  lateArrival: boolean;
  reasonCode: string | null;
  /** Đây có phải dòng đang xem không. */
  laDongNay: boolean;
};

export type MocNhatKyTho = { luc: string; hanhDong: string; nguoi: string | null; lyDo: string | null };

export type DuLieuViSaoDayDu = {
  dong: DongChoViSao;
  hienTongTiLe: boolean;
  nguoiHuong: { ten: string; kind: "USER" | "AFFILIATE" };
  tenVai: string;
  tenNhomNguon: string;
  /** Mã nhóm nguồn → TÊN nhóm (mọi nhóm của danh mục, kể cả nhóm admin thêm): câu giải thích chính sách do engine ghi có nhắc MÃ nhóm khác (UNKNOWN → mức thấp nhất = nhóm PARENT_REFERRAL…). KHÔNG có giá trị mặc định (luật 7). */
  tenNhomTheoMa: Readonly<Record<string, string>>;
  /** TÊN campaign Affiliate của dòng (`affiliateCampaignId`); `null` = khoản không đến từ link Affiliate (AFF-P2). BẮT BUỘC khai (luật 7). */
  tenCampaign: string | null;
  /** Cá nhân hay TỔ CHỨC lúc ghi sổ (AFF-L2, D-B); `null` = dòng đời cũ. BẮT BUỘC khai (luật 7). */
  loaiNguoiHuong: "PERSON" | "ORGANIZATION" | null;
  resolverType: string;
  hocVien: { ten: string | null };
  /** `null` = dòng không gắn với một khoản thu (PERIOD_BONUS · LEGACY…). Ngày là ISO. */
  khoanThu: { ngayThu: string; xacNhanLuc: string | null; soTien: number } | null;
  chiTra: { trangThai: CommissionPayoutStatus; luc: string | null };
  taoLuc: string;
  lienQuan: readonly DongLienQuanTho[];
  /** `null` = người xem KHÔNG có quyền xem nhật ký thao tác (chỉ `view-self`): khi đó nhật ký có thể chứa tiền của người khác. */
  nhatKy: readonly MocNhatKyTho[] | null;
  /**
   * Những vai KHÔNG phát sinh tiền ở khoản này (Hướng G): chỉ dòng người xem được thấy (cùng phạm vi sổ). Rỗng = không có gì để nói — KHÔNG vẽ mục. BẮT BUỘC (luật 7): quên truyền
   * là lỗi biên dịch, không phải mục «biến mất» im lặng.
   */
  khongPhatSinh: readonly DongKhongPhatSinhTho[];
};

export type MucViSao = { nhan: string; giaTri: string; ghiChu?: string };

/** Một vai không phát sinh tiền, đã dựng chữ. `nhan` mang đủ: Nguồn · Chính sách · Điều kiện · Lý do (+ mã máy) · Hoa hồng 0đ · «Lẽ ra». */
export type VaiKhongPhatSinh = { id: string; nguoiHuong: string | null; vai: string; nhan: NhanGiaiThich };

export type DongLienQuan = {
  id: string;
  nhan: string;
  soTien: number;
  ky: string;
  lyDo: string | null;
  laDongNay: boolean;
  laDongGoc: boolean;
  /** Vẽ mũi tên ↳ trước dòng này (dòng điều chỉnh trỏ về dòng gốc). */
  muiTen: boolean;
};

export type MocThoiGian = { luc: string; nhan: string; nguoi: string | null; lyDo: string | null };

export type ViSaoDayDu = {
  tieuDe: string;
  tomTat: { nguoiHuong: string; vai: string; soTien: number };
  muc: MucViSao[];
  canhBao: string[];
  dieuChinh: DongLienQuan[];
  thoiGian: MocThoiGian[];
  khongPhatSinh: VaiKhongPhatSinh[];
};

export const NHAN_TRANG_THAI_CHI: Record<CommissionPayoutStatus, string> = {
  ON_HOLD: "Đang giữ — chưa đủ hồ sơ để chi",
  PENDING: "Chưa chi",
  APPROVED: "Đã duyệt chi",
  EXPORTED: "Đã xuất bảng chi",
  PAID: "Đã chi",
};

/** Mã thao tác trong AuditLog (module hoa-hong) → nhãn. `CALCULATE`/`LATE_ARRIVAL` không có ở đây: chúng CHÍNH LÀ dòng "Ghi vào sổ". */
const NHAN_THAO_TAC: Record<string, string> = {
  ADJUST: "Điều chỉnh",
  SOURCE_CORRECTION: "Điều chỉnh do đổi nguồn",
  LEGACY_REVERSAL: "Thu hồi khoản của sổ cũ",
  APPLY: "Áp dụng thay đổi",
  DISMISS: "Giữ nguyên",
  LOCK: "Khoá kỳ",
  EXPORT: "Xuất bảng chi",
  MARK_PAID: "Đánh dấu đã chi",
  RETURN: "Trả kỳ về rà soát",
  REVIEW: "Chuyển rà soát",
  DEFER: "Dời sang kỳ sau",
};
const THAO_TAC_LA_GHI_SO: ReadonlySet<string> = new Set(["CALCULATE", "LATE_ARRIVAL"]);

const LY_DO_DIEU_CHINH: Record<string, string> = {
  KY_GOC_DA_DONG: "Vì kỳ hiệu lực đã đóng nên được ghi vào kỳ đang mở kế tiếp",
  KY_TRUOC_MOC: "Vì kỳ hiệu lực nằm trước mốc chuyển sang sổ mới",
  HOAN_TIEN: "Vì khoản thu bị hoàn hoặc điều chỉnh giảm",
};

const LA_DONG_GOC: ReadonlySet<string> = new Set(["ORIGINAL", "LATE_ARRIVAL", "PERIOD_BONUS"]);

function kyCuaDong(d: Pick<DongChoViSao, "lateArrival" | "naturalPeriod" | "kyGhi">): string {
  return d.lateArrival ? `Hiệu lực ${kyHienThi(d.naturalPeriod)} · ghi vào kỳ ${kyHienThi(d.kyGhi)}` : `Kỳ ${kyHienThi(d.kyGhi)}`;
}

/**
 * Câu `reason` của dòng sổ do ENGINE ghi (ảnh chụp, không đổi được) có thể nhắc MÃ nhóm nguồn ("nhóm PARENT_REFERRAL", "UNKNOWN → …") và in tiền kiểu "440.000 đ".
 * Màn đọc cho kế toán: đổi mã → TÊN nhóm (chỉ mã CÓ trong bảng tên — mã lạ giữ nguyên, không bịa) và gộp "đ" sát số như mọi chỗ khác của ngăn. Ảnh chụp trên dòng sổ KHÔNG bị sửa.
 */
export function lamSachLyDoChinhSach(reason: string, tenNhom: Readonly<Record<string, string>>): string {
  return reason
    .replace(/\b[A-Z][A-Z0-9_]{2,}\b/g, (ma) => (Object.prototype.hasOwnProperty.call(tenNhom, ma) ? (tenNhom[ma] as string) : ma))
    .replace(/(\d)\s+đ/g, "$1đ");
}

export function dungViSaoDayDu(p: DuLieuViSaoDayDu): ViSaoDayDu {
  const d = p.dong;
  const goc = dungViSao(d, p.hienTongTiLe);
  const buocGoc = (nhan: string) => goc.buoc.find((b) => b.nhan === nhan);
  const laThuHoi = d.entryKind === "REVERSAL";

  const muc: MucViSao[] = [];

  // 1 — Khoản thu gốc.
  if (p.khoanThu) {
    muc.push({
      nhan: "Khoản thu gốc",
      giaTri: `${ddmmyyyy(p.khoanThu.ngayThu)} · ${dinhDangDong(d.grossAmount)}`,
      ghiChu: p.khoanThu.xacNhanLuc ? `Kế toán xác nhận ${ddmmyyyy(p.khoanThu.xacNhanLuc)}` : "Kế toán chưa xác nhận",
    });
  } else {
    muc.push({ nhan: "Khoản thu gốc", giaTri: "Không gắn với một khoản thu" });
  }

  // 2–3 — Cơ sở tính + VAT.
  muc.push({
    nhan: "Cơ sở tính",
    giaTri: dinhDangDong(d.netBase),
    ghiChu: laThuHoi
      ? "Thu hồi theo TỈ LỆ TIỀN của chính dòng gốc trên phần cơ sở còn lại, không nhân lại tỉ lệ chính sách hôm nay."
      : "Chỉ tính trên thành phần học phí.",
  });
  const daBoVat = Math.abs(d.grossAmount) - Math.abs(d.netBase);
  muc.push({
    nhan: "VAT",
    giaTri: d.vatRate > 0 ? `${phanTram(d.vatRate)} — đã bỏ ${dinhDangDong(daBoVat)}` : "0% — không có VAT",
  });

  // 4 — Loại giao dịch + học viên.
  const loaiGd = d.transactionTypeCode === "NEW" ? "Khách mới" : d.transactionTypeCode === "RENEWAL" ? "Tái tục" : d.transactionTypeCode;
  // Dấu "·" chứ không "—": tên học viên có thể tự mang dấu gạch dài ("Nguyễn Bảo Minh — MAKEUP") và hai dấu liền nhau đọc không ra đâu là ranh giới.
  muc.push({ nhan: "Loại giao dịch", giaTri: p.hocVien.ten ? `${loaiGd} · ${p.hocVien.ten}` : loaiGd });

  // 5 — Nguồn.
  muc.push({
    nhan: "Nguồn",
    giaTri: p.tenNhomNguon,
    ...(d.sourceGroupCode === "UNKNOWN" ? { ghiChu: "Chưa rõ nguồn — tính theo mức thấp nhất trong các nhóm." } : {}),
  });

  // 5b — Campaign Affiliate (AFF-P2): chỉ vẽ khi dòng THẬT SỰ mang campaign. Tên campaign + loại đối tác + tuyến/bậc đã quyết nguồn — mọi thứ đọc từ ảnh chụp trên dòng, không tra lại hôm nay.
  const aff = docChiTietAffiliate(d.resolverBasis);
  if (p.tenCampaign !== null || aff !== null) {
    const phan = [aff?.laToChuc ? "Đối tác tổ chức" : aff ? "Đối tác cá nhân" : null, aff?.typeCode ? `loại ${aff.typeCode}` : null].filter((x): x is string => x !== null);
    muc.push({
      nhan: "Campaign Affiliate",
      giaTri: p.tenCampaign ?? "(campaign không còn tên)",
      ...(phan.length > 0 || aff?.tuNhan ? { ghiChu: [phan.join(" · "), aff?.tuNhan ? `Nguồn khách do: ${aff.tuNhan}` : null].filter((x) => x && x.length > 0).join(" — ") } : {}),
    });
    // D-A: cửa sổ nào đã quyết «còn đủ điều kiện» và vì sao — chỉ vẽ khi dòng THẬT SỰ mang phép đo.
    const cs = mucCuaSo(aff?.cuaSo ?? null, aff?.protectWindowDays ?? null);
    if (cs) muc.push(cs);
  }

  // 6 — Người hưởng + cách phân giải.
  // D-B: người hưởng là TỔ CHỨC — nói thẳng, và nói tiền KHÔNG chạy sang người đại diện; dòng ở trạng thái giữ cho tới khi đủ hồ sơ.
  const laToChuc = p.loaiNguoiHuong === "ORGANIZATION";
  muc.push({
    nhan: "Người hưởng",
    giaTri: `${p.nguoiHuong.ten}${laToChuc ? " (tổ chức)" : ""} · vai ${p.tenVai}`,
    ghiChu: laToChuc ? `${cachPhanGiaiNguoiHuong(p.resolverType, d.resolverBasis)} — tiền trả cho chính tổ chức, không chuyển sang người đại diện; đang GIỮ cho tới khi đủ hồ sơ pháp lý, ngân hàng, thuế` : cachPhanGiaiNguoiHuong(p.resolverType, d.resolverBasis),
  });

  // 7 — Chính sách thắng (+ phiên bản + văn bản + lý do).
  muc.push({
    nhan: "Chính sách",
    giaTri: d.documentNumber ? `${d.documentNumber}${d.versionNo ? ` · phiên bản ${d.versionNo}` : ""}` : "(không ghi)",
    // `reason` của dòng THU HỒI là câu máy ghi cho người kiểm toán ("đảo 160000đ của dòng cmuz…" — mang id nội bộ, tiền không định dạng); lý do thật đã nằm ở ô "Tỉ lệ"
    // và "Cơ sở tính". Chỉ dòng PHÁT SINH mới có `reason` = "vì sao chính sách này thắng", thứ người đọc cần.
    ...(laThuHoi ? {} : { ghiChu: lamSachLyDoChinhSach(d.reason, p.tenNhomTheoMa) }),
  });

  // 8 — Tỉ lệ.
  if (laThuHoi) muc.push({ nhan: "Tỉ lệ", giaTri: "Theo tỉ lệ tiền của dòng gốc" });
  else if (d.calcKind === "PERCENT" && d.rate !== null) muc.push({ nhan: "Tỉ lệ", giaTri: phanTram(d.rate) });
  else if (d.calcKind === "FIXED_PER_PURCHASE" && d.fixedAmount !== null) muc.push({ nhan: "Tỉ lệ", giaTri: `Mức cố định ${dinhDangDong(d.fixedAmount)} / lần mua`, ghiChu: "Trả một lần cho mỗi lần mua, tại khoản thu đầu tiên đủ điều kiện." });
  else muc.push({ nhan: "Tỉ lệ", giaTri: "Không theo tỉ lệ" });

  // 9 — Hoa hồng: công thức nếu có, không thì con số đã ghi.
  const congThuc = buocGoc(NHAN_BUOC_VI_SAO.CONG_THUC);
  const thuHoi = buocGoc(NHAN_BUOC_VI_SAO.SO_THU_HOI);
  const soTien = buocGoc(NHAN_BUOC_VI_SAO.SO_TIEN);
  if (congThuc) {
    muc.push({
      nhan: "Hoa hồng",
      giaTri: congThuc.giaTri,
      ghiChu: `Phần của người này: ${dinhDangDong(d.amount)}. ${congThuc.ghiChu ?? ""}`.trim(),
    });
  } else {
    muc.push({ nhan: "Hoa hồng", giaTri: (thuHoi ?? soTien)?.giaTri ?? dinhDangDong(d.amount) });
  }

  // 10 — Kiểm trần (đã tuân luật "chỉ người có tầm nhìn cơ sở mới thấy tổng tỉ lệ" trong dungViSao).
  const tran = buocGoc(NHAN_BUOC_VI_SAO.KIEM_TRAN);
  if (tran) muc.push({ nhan: "Kiểm trần", giaTri: tran.giaTri, ...(tran.ghiChu ? { ghiChu: tran.ghiChu } : {}) });

  // 11 — Kỳ.
  const ky = buocGoc(NHAN_BUOC_VI_SAO.KY);
  muc.push({ nhan: "Kỳ", giaTri: kyCuaDong(d), ...(ky?.ghiChu ? { ghiChu: ky.ghiChu } : {}) });

  // 12 — Chi trả.
  muc.push({ nhan: "Chi trả", giaTri: NHAN_TRANG_THAI_CHI[p.chiTra.trangThai] });

  // ── Điều chỉnh liên quan ────────────────────────────────────────────────────────────────────────────────
  const dieuChinh: DongLienQuan[] =
    p.lienQuan.length <= 1
      ? []
      : [...p.lienQuan]
          .sort((a, b) => {
            const ga = LA_DONG_GOC.has(a.entryKind) ? 0 : 1;
            const gb = LA_DONG_GOC.has(b.entryKind) ? 0 : 1;
            return ga - gb || (a.kyGhi < b.kyGhi ? -1 : a.kyGhi > b.kyGhi ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
          })
          .map((r) => ({
            id: r.id,
            nhan: tenLoaiDong(r.entryKind, r.reasonCode),
            soTien: r.amount,
            ky: kyCuaDong({ lateArrival: r.lateArrival, naturalPeriod: r.kyHieuLuc, kyGhi: r.kyGhi }),
            lyDo: r.reasonCode ? (LY_DO_DIEU_CHINH[r.reasonCode] ?? null) : null,
            laDongNay: r.laDongNay,
            laDongGoc: LA_DONG_GOC.has(r.entryKind),
            muiTen: !LA_DONG_GOC.has(r.entryKind),
          }));

  // ── Dòng thời gian ──────────────────────────────────────────────────────────────────────────────────────
  const thoiGian: MocThoiGian[] = [{ luc: p.taoLuc, nhan: "Ghi vào sổ", nguoi: null, lyDo: null }];
  for (const m of p.nhatKy ?? []) {
    if (THAO_TAC_LA_GHI_SO.has(m.hanhDong)) continue;
    thoiGian.push({ luc: m.luc, nhan: NHAN_THAO_TAC[m.hanhDong] ?? "Thao tác khác", nguoi: m.nguoi, lyDo: m.lyDo });
  }
  if (p.chiTra.trangThai !== "PENDING" && p.chiTra.luc) {
    thoiGian.push({ luc: p.chiTra.luc, nhan: NHAN_TRANG_THAI_CHI[p.chiTra.trangThai], nguoi: null, lyDo: null });
  }
  thoiGian.sort((a, b) => (a.luc < b.luc ? -1 : a.luc > b.luc ? 1 : 0));

  return {
    // Tên loại + TÊN vai (`p.tenVai`), không phải `goc.tieuDe`: tiêu đề của bản cũ ghép MÃ vai (`· SALE`) — in ra màn ngay dưới dòng mô tả đã nói "vai Sale (người chốt đơn)".
    tieuDe: `${tenLoaiDong(d.entryKind, d.reasonCode)} · ${p.tenVai}`,
    tomTat: { nguoiHuong: p.nguoiHuong.ten, vai: p.tenVai, soTien: d.amount },
    muc,
    canhBao: goc.canhBao,
    dieuChinh,
    thoiGian,
    khongPhatSinh: p.khongPhatSinh.map((g) => ({ id: g.id, nguoiHuong: g.tenNguoiHuong, vai: g.tenVai, nhan: dungNhanGiaiThich(g) })),
  };
}
