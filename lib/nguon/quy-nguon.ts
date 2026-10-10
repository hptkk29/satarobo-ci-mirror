/**
 * lib/nguon/quy-nguon.ts — RESOLVER QUY NGUỒN (PR2). THUẦN. Đặc tả `docs/source-commission/03 §2.3–§2.7`, `07 §2.6.4`.
 *
 * ── Một VÒNG LẶP chạy trên BẢNG LUẬT (T2) ──────────────────────────────────────────────────────────────────
 * `quyNguon(tin, cauHinh)` duyệt `cauHinh.thuTu` (thứ tự + công tắc do cấu hình), gọi `BO_LUAT[ma]`; luật đầu tiên
 * khớp thắng. KHÔNG có `if/else` về nguồn rải ở nơi gọi. Thêm một luật = thêm một phần tử vào `BO_LUAT` + một dòng vào
 * `THU_TU_LUAT_MAC_DINH`. Hàm TOÀN PHẦN (T4): không ném với dữ liệu nào, luôn trả một đích (UNKNOWN là đáy).
 *
 * ── Hành vi đi theo THUỘC TÍNH, không so mã (T3) ──────────────────────────────────────────────────────────
 * Mã nhóm chỉ xuất hiện ở BA nơi cấu hình: `DICH_MAC_DINH` (nhóm đích của luật QUANG_CAO/PH/UNKNOWN), `DUONG_VAO_MAC_DINH`
 * (D11) và bảng vai (`danh-muc-goc.ts`). Luật không so `=== "PAID_ADS"`. Nhóm "nhân sự giới thiệu" KHÔNG nằm ở đây: nó là SETTING
 * (`nguon.nhomNhanSuMacDinh`) truyền vào `dungCauHinhQuyNguon`, và vai của nhân sự chỉ là ảnh chụp, không chọn nhóm.
 *
 * ── Không đoán, không giả dữ liệu ─────────────────────────────────────────────────────────────────────────
 * · Ba luật `MA_*` + `QR_SU_KIEN` TẮT tới PR11/PR7 (chưa có `Affiliate.kind` / `LeadSource`). Ref hợp lệ trong quãng
 *   đó đi luật TẠM `AFF_CHUA_PHAN_LOAI` (H12): UNKNOWN + xem tay, KHÔNG đoán loại.
 * · Nhãn #10/#14/#22 sau mốc 06/10 (H21) đi MANUAL_REVIEW qua `anhXaNhanCu` — không UNKNOWN, không tự map.
 * · Tín hiệu THUA không bị vứt: thành touchpoint của chính lần nhập đó.
 */
import type { SourceIdentificationMethod } from "@prisma/client";
import { anhXaNhanCu, chuanHoaNhanNguon, type KetQuaAnhXa } from "./anh-xa-nhan-cu";
import { suyVaiNguon, type DongVaiSangNguon } from "./danh-muc-goc";
import { chupNguon } from "./nguon-chup";
import {
  ANH_CHUP_TRONG,
  type AnhChupNguon,
  type CanhBaoNguon,
  type CauHinhQuyNguon,
  type CoQuyNguon,
  type KetQuaQuyNguon,
  type LoaiTinHieu,
  type LyDoXemTayNguon,
  type MaLuatQuyNguon,
  type NguoiGioiThieu,
  type NguoiNhapDaGiai,
  type ThuocTinhNhom,
  type TinHieuQuyNguon,
  type TouchpointThua,
} from "./tin-hieu";

// ── First-claim khi GỘP lead (PR1) ───────────────────────────────────────────────────────────────────────
export type QuyNguonTomTat = { attributedAt: Date };

/** First-claim: bản được GHI NHẬN SỚM HƠN thắng; bằng nhau ⇒ lead CHÍNH giữ (tất định). */
export function chonKhiGopLead(chinh: QuyNguonTomTat, phu: QuyNguonTomTat): { thang: "chinh" | "phu" } {
  return { thang: phu.attributedAt.getTime() < chinh.attributedAt.getTime() ? "phu" : "chinh" };
}

/**
 * "Bản GỐC NHẤT" của chuỗi kế thừa theo SĐT: `attributedAt` nhỏ nhất. Hoà ⇒ bản KHÔNG kế thừa (gốc thật) rồi leadId
 * nhỏ — để lead L3 luôn trỏ thẳng về gốc, không bao giờ qua bản trung gian (03 §2.5).
 */
export function chonGocKeThua<T extends { leadId: string; attributedAt: Date; inheritedFromLeadId: string | null }>(
  ds: readonly T[],
): T | null {
  let tot: T | null = null;
  for (const x of ds) {
    if (tot === null) {
      tot = x;
      continue;
    }
    const a = x.attributedAt.getTime();
    const b = tot.attributedAt.getTime();
    if (a < b) tot = x;
    else if (a === b) {
      const xGoc = x.inheritedFromLeadId === null;
      const totGoc = tot.inheritedFromLeadId === null;
      if ((xGoc && !totGoc) || (xGoc === totGoc && x.leadId < tot.leadId)) tot = x;
    }
  }
  return tot;
}

// ── Cấu hình mặc định ────────────────────────────────────────────────────────────────────────────────────

/** Thứ tự mặc định = 11 bậc PRD (03 §2.3) + luật tạm H12. `DUONG_VAO_MAC_DINH` đứng sát UNKNOWN (luôn là đáy). */
export const THU_TU_LUAT_MAC_DINH: readonly { ma: MaLuatQuyNguon; bat: boolean }[] = [
  { ma: "KE_THUA_SDT", bat: true },
  // PR7 — người nhập CHỌN tường minh ở ô chọn nguồn. Đứng ngay sau kế thừa (first-claim D3 vẫn thắng) và TRƯỚC mọi luật tự động:
  // lời khai có chủ đích của người (nguồn + người + giải trình) không được bị tín hiệu máy ghi đè. Không gắn cờ con (xem CO_CUA_LUAT).
  { ma: "CHON_NGUON", bat: true },
  { ma: "MA_GT_CA_NHAN", bat: false }, // PR11: cần Affiliate.kind
  { ma: "QR_SU_KIEN", bat: false }, // PR7: cần LeadSource
  { ma: "MA_DOI_TAC", bat: false }, // PR11
  { ma: "MA_CTV", bat: false }, // PR11
  { ma: "AFF_CHUA_PHAN_LOAI", bat: true }, // H12 — thay ba luật MA_* tới PR11
  { ma: "QUANG_CAO", bat: true },
  { ma: "PAGE_MAPPING", bat: true },
  { ma: "NV_GIOI_THIEU", bat: true },
  { ma: "PH_GIOI_THIEU", bat: true },
  { ma: "KHAI_TAY", bat: true },
  { ma: "DUONG_VAO_MAC_DINH", bat: true },
];

/**
 * Cờ con nào gác luật nào (`nguon.autoAttribution` · `pageMapping` · `referral` · `manualReview`). null = không gắn cờ con:
 *  · KE_THUA_SDT — nguồn GỐC phải liên tục, tắt nó là làm mất lịch sử nguồn của khách quay lại;
 *  · KHAI_TAY — chữ người gõ phải được tôn trọng.
 * `manualReview` không gác luật nào: cờ xem tay LUÔN được ghi (rẻ, không mất gì); nó gác MÀN hàng chờ.
 */
export const CO_CUA_LUAT: Readonly<Record<MaLuatQuyNguon, keyof CoQuyNguon | null>> = {
  KE_THUA_SDT: null,
  // Lựa chọn tường minh của người: tắt `referral`/`autoAttribution` không được làm nó biến thành UNKNOWN. Cờ master + cờ ép chọn
  // theo cơ sở quyết định ô chọn có HIỆN không; đã chọn rồi thì phải được ghi.
  CHON_NGUON: null,
  MA_GT_CA_NHAN: "referral",
  QR_SU_KIEN: "autoAttribution",
  MA_DOI_TAC: "referral",
  MA_CTV: "referral",
  AFF_CHUA_PHAN_LOAI: "referral",
  QUANG_CAO: "autoAttribution",
  PAGE_MAPPING: "pageMapping",
  NV_GIOI_THIEU: "referral",
  PH_GIOI_THIEU: "referral",
  KHAI_TAY: null,
  DUONG_VAO_MAC_DINH: "autoAttribution",
};

/** D11 — đường vào KHÔNG có tín hiệu nào khác ⇒ nhóm Quảng cáo ("khách tự nhập" về 2). Mã nhóm là DỮ LIỆU CẤU HÌNH. */
export const DUONG_VAO_MAC_DINH: Readonly<Record<string, string>> = {
  facebook: "PAID_ADS",
  zalo: "PAID_ADS",
  "google-form": "PAID_ADS",
  quatang: "PAID_ADS",
  web: "PAID_ADS",
};

const DICH_MAC_DINH = {
  quangCao: "PAID_ADS",
  phuHuynh: "PARENT_REFERRAL",
  unknown: "UNKNOWN",
  nhomKhac: "OTHER",
} as const satisfies Omit<CauHinhQuyNguon["dich"], "nhanSu">;

/**
 * MỌI mã nguồn mà quy nguồn dùng làm ĐÍCH MẶC ĐỊNH — MỘT chỗ liệt kê (res3 MEDIUM-5): đích của luật QUANG_CAO / PH_GIOI_THIEU / UNKNOWN / OTHER (`DICH_MAC_DINH`), đích của
 * đường vào (`DUONG_VAO_MAC_DINH`), nhóm Page đang trỏ tới (`bangPage`) và nhóm «nhân sự giới thiệu» (`nguon.nhomNhanSuMacDinh`). Cổng ghi danh mục không cho làm hỏng
 * một nguồn trong tập này (ngừng · lưu trữ · tắt chọn · đặt hạn). Thêm một cấu hình đích mới = thêm vào ĐÂY.
 */
export function maDichMacDinh(p: { nhomNhanSuMacDinh: string; bangPage: Readonly<Record<string, { groupCode: string }>> }): ReadonlySet<string> {
  return new Set<string>([
    ...Object.values(DICH_MAC_DINH),
    ...Object.values(DUONG_VAO_MAC_DINH),
    p.nhomNhanSuMacDinh,
    ...Object.values(p.bangPage).map((m) => m.groupCode),
  ]);
}

/** Dựng cấu hình từ dữ liệu DB (nhóm) + cờ + bảng vai; áp công tắc cờ con lên `thuTu`. THUẦN. */
export function dungCauHinhQuyNguon(input: {
  nhom: readonly ThuocTinhNhom[];
  co: CoQuyNguon;
  vaiSangNguon: readonly DongVaiSangNguon[];
  /** Nhóm khi chỉ biết "nhân sự giới thiệu" (setting `nguon.nhomNhanSuMacDinh`). BẮT BUỘC, không mặc định (luật 7). */
  nhomNhanSu: string;
  /** Cửa sổ ghi công CHUNG lúc ghi (setting `nguon.cuaSoGhiCongNgay`) — chụp vào `signals.nguon` khi nguồn không có cửa sổ riêng. BẮT BUỘC (luật 7). */
  cuaSoMacDinhNgay: number;
  duongVaoMacDinh?: Readonly<Record<string, string>>;
  thuTu?: readonly { ma: MaLuatQuyNguon; bat: boolean }[];
}): CauHinhQuyNguon {
  const thuTu = (input.thuTu ?? THU_TU_LUAT_MAC_DINH).map((l) => {
    const co = CO_CUA_LUAT[l.ma];
    return { ma: l.ma, bat: l.bat && (co === null || input.co[co]) };
  });
  return {
    thuTu,
    nhom: new Map(input.nhom.map((n) => [n.code, n])),
    vaiSangNguon: input.vaiSangNguon,
    duongVaoMacDinh: input.duongVaoMacDinh ?? DUONG_VAO_MAC_DINH,
    dich: { ...DICH_MAC_DINH, nhanSu: input.nhomNhanSu },
    cuaSoMacDinhNgay: input.cuaSoMacDinhNgay,
  };
}

// ── Luật ─────────────────────────────────────────────────────────────────────────────────────────────────

type KhopLuat = {
  groupCode: string;
  originalGroupCode?: string;
  inheritedFromLeadId?: string;
  attributedAt?: Date;
  method: SourceIdentificationMethod;
  ly: string;
  tieuThu: readonly LoaiTinHieu[];
  nguoi?: NguoiGioiThieu | null;
  thieuNguoi?: boolean;
  giaiTrinh?: string | null;
  xemTay?: readonly LyDoXemTayNguon[];
  khoa?: boolean;
  /** Ảnh chụp người giới thiệu (vai · Sale phụ trách PH · dấu vết) — ghi cùng dòng quy nguồn. */
  anhChup?: AnhChupNguon;
};

/** Phần suy ra MỘT lần cho cả vòng lặp (anhXaNhanCu thuần, rẻ). */
type NguCanh = { nhan: KetQuaAnhXa | null };

export type LuatQuyNguon = (tin: TinHieuQuyNguon, ch: CauHinhQuyNguon, ctx: NguCanh) => KhopLuat | null;

const nhomDung = (ch: CauHinhQuyNguon, code: string): boolean => ch.nhom.get(code)?.active === true;

/**
 * Nhóm đích "nhân sự giới thiệu" ĐỦ ĐIỀU KIỆN nhận một người giới thiệu là nhân sự: còn hoạt động VÀ kiểu nhân sự (THUỘC TÍNH, không so mã).
 * MỘT chỗ cho cả hai đường "chỉ biết đây là nhân sự" — picker (`NV_GIOI_THIEU`) và nhãn theo người nhập (`KHAI_TAY`/sale-form): cấu hình
 * `nguon.nhomNhanSuMacDinh` trỏ nhầm thì CẢ HAI rơi xuống luật sau, không đường nào ghi người giới thiệu nhân sự vào nhóm không cần người.
 */
const nhomNhanSuDung = (ch: CauHinhQuyNguon, code: string): boolean => nhomDung(ch, code) && ch.nhom.get(code)?.referrerRequirement === "EMPLOYEE";

const coGiaTri = (v: string | null | undefined): v is string => v != null && v.trim() !== "";

/** Luật chưa có dữ liệu để khớp (PR7/PR11) — tồn tại để bảng luật ĐỦ 11 bậc và test thấy nó TẮT. */
const chuaCoDuLieu: LuatQuyNguon = () => null;

/** Tín hiệu quảng cáo = MỘT trong sáu (UTM đứng một mình KHÔNG phải — 03 §2.3). `adsetId` chỉ đi kèm, không tự đủ. */
function tomTatQuangCao(q: TinHieuQuyNguon["quangCao"]): string[] {
  return (
    [
      ["quảng cáo", q.adId],
      ["chiến dịch", q.campaignId ?? q.campaignName],
      ["biểu mẫu", q.formId],
      ["fbclid", q.fbclid],
      ["gclid", q.gclid],
    ] as const
  )
    .filter(([, v]) => coGiaTri(v))
    .map(([nhan]) => nhan);
}

function coQuangCao(q: TinHieuQuyNguon["quangCao"]): boolean {
  return [q.adId, q.campaignId, q.campaignName, q.formId, q.fbclid, q.gclid].some(coGiaTri);
}

/** Ảnh chụp của MỘT nhân sự giới thiệu: vai ngữ nghĩa (chỉ là snapshot) + dấu vết không PII. */
function anhChupNhanSu(n: NguoiNhapDaGiai, bang: readonly DongVaiSangNguon[]): AnhChupNguon {
  return {
    referrerRoleCode: suyVaiNguon(n.roleCodes, bang),
    referrerSaleUserId: null,
    nguoiGioiThieu: { employeeCode: n.employeeCode ?? null, roleCodes: [...n.roleCodes], orgUnitId: n.orgUnitId ?? null },
    nguon: null,
  };
}

export const BO_LUAT: Readonly<Record<MaLuatQuyNguon, LuatQuyNguon>> = {
  KE_THUA_SDT: (tin) => {
    const k = tin.keThua;
    if (!k) return null;
    return {
      groupCode: k.groupCode,
      originalGroupCode: k.originalGroupCode,
      inheritedFromLeadId: k.leadId,
      attributedAt: k.attributedAt,
      method: "EXISTING_LEAD",
      ly: "SĐT đã có hồ sơ cũ — kế thừa nguồn gốc của hồ sơ đó, tín hiệu mới chỉ được ghi lại",
      tieuThu: [],
      nguoi: k.nguoi,
      thieuNguoi: k.referrerMissing,
      giaiTrinh: k.otherSourceNote,
      xemTay: k.referrerMissing ? ["THIEU_NGUOI"] : [],
      anhChup: k.anhChup, // kế thừa NGUYÊN VĂN — không tính lại Sale/vai của hôm nay
    };
  },

  // PR7 — nguồn do người nhập chọn ở SourcePicker/ReferrerPicker. Tầng đọc đã giải nhóm GHI (= nhóm đã chọn) và kiểm người/giải
  // trình; `loi` ≠ null ⇒ không khớp (đường nhập bị chặn trước transaction chứ không rơi UNKNOWN).
  CHON_NGUON: (tin, ch) => {
    const c = tin.nguonChon;
    if (!c || c.loi !== null) return null;
    if (!nhomDung(ch, c.groupCode)) return null;
    return {
      groupCode: c.groupCode,
      method: "MANUAL",
      ly: "Người nhập chọn nguồn trong danh mục (ô chọn nguồn) — giữ đúng nhóm đã chọn; vai của nhân sự chỉ ghi làm ảnh chụp",
      tieuThu: ["CHON_NGUON"],
      nguoi: c.nguoi,
      giaiTrinh: c.giaiTrinh,
      anhChup: c.anhChup,
    };
  },

  // Ba luật mã giới thiệu + QR sự kiện: chưa có master (Affiliate.kind — PR11; LeadSource — PR7).
  MA_GT_CA_NHAN: chuaCoDuLieu,
  QR_SU_KIEN: chuaCoDuLieu,
  MA_DOI_TAC: chuaCoDuLieu,
  MA_CTV: chuaCoDuLieu,

  // H12 — luật TẠM đứng chỗ ba luật MA_*: mã giới thiệu HỢP LỆ nhưng chưa phân loại được ⇒ KHÔNG đoán loại.
  AFF_CHUA_PHAN_LOAI: (tin, ch) => {
    if (!tin.ref?.hopLe) return null;
    return {
      groupCode: ch.dich.unknown,
      method: "UNKNOWN",
      ly: "Có mã giới thiệu hợp lệ nhưng loại đối tác chưa được phân loại — chờ người xem, không tự đoán",
      tieuThu: ["REF"],
      xemTay: ["AFF_CHUA_PHAN_LOAI"],
    };
  },

  QUANG_CAO: (tin, ch) => {
    if (!coQuangCao(tin.quangCao)) return null;
    if (!nhomDung(ch, ch.dich.quangCao)) return null;
    return {
      groupCode: ch.dich.quangCao,
      method: "AD_FORM_CAMPAIGN",
      ly: `Có tín hiệu quảng cáo (${tomTatQuangCao(tin.quangCao).join(", ")}) — ưu tiên hơn page và đường vào chung`,
      tieuThu: ["QUANG_CAO"],
    };
  },

  PAGE_MAPPING: (tin, ch) => {
    const p = tin.page;
    if (!p?.trongDanhMuc || !p.dich) return null;
    if (!nhomDung(ch, p.dich.groupCode)) return null;
    return {
      groupCode: p.dich.groupCode,
      method: "PAGE_MAPPING",
      ly: "Page đã được gán nguồn trong bảng nguồn theo Page — nguồn tự xác định và khoá",
      tieuThu: ["PAGE"],
      khoa: true,
    };
  },

  NV_GIOI_THIEU: (tin, ch) => {
    const n = tin.nhanSuGioiThieu;
    if (!n) return null;
    // Chỉ biết "đây là nhân sự giới thiệu" ⇒ nhóm CẤU HÌNH (`ch.dich.nhanSu`). Chọn theo THUỘC TÍNH: nhóm đích phải còn hoạt động VÀ thật sự là nhóm
    // kiểu nhân sự — cấu hình trỏ nhầm sang nhóm không cần người thì rơi xuống luật sau, không ghi người giới thiệu nhân sự vào nhóm NONE.
    const nhom = ch.dich.nhanSu;
    if (!nhomNhanSuDung(ch, nhom)) return null;
    return {
      groupCode: nhom,
      method: "EMPLOYEE_REFERRAL",
      ly: "Nhân sự giới thiệu do người nhập chọn — nhóm nguồn là nhóm nhân sự mặc định của cấu hình; vai của nhân sự chỉ ghi làm ảnh chụp",
      tieuThu: ["NHAN_SU"],
      nguoi: { kind: "EMPLOYEE", employeeId: n.employeeId },
      xemTay: n.vaiTuHienTai ? ["VAI_SUY_TU_HIEN_TAI"] : [],
      anhChup: anhChupNhanSu(n, ch.vaiSangNguon),
    };
  },

  PH_GIOI_THIEU: (tin, ch) => {
    const p = tin.phuHuynhGioiThieu;
    if (!p) return null;
    if (!nhomDung(ch, ch.dich.phuHuynh)) return null;
    return {
      groupCode: ch.dich.phuHuynh,
      method: "PARENT_REFERRAL",
      ly: "Phụ huynh giới thiệu do người nhập chọn",
      tieuThu: ["PH_GT"],
      nguoi: { kind: "PARENT", parentUserId: p.parentUserId, studentId: p.studentId },
      anhChup: { referrerRoleCode: null, referrerSaleUserId: tin.saleCuaPhuHuynh, nguoiGioiThieu: null, nguon: null },
    };
  },

  // Khai tay qua `anhXaNhanCu` — KHÔNG viết nhánh thứ hai (D10, D12, D21).
  KHAI_TAY: (tin, ch, ctx) => {
    const r = ctx.nhan;
    if (!r || r.loai === "INVALID") return null;
    // Nhãn mang NGƯỜI (theo người nhập) ⇒ nhóm đích phải là nhóm nhân sự hợp lệ; nhãn không mang người chỉ cần nhóm còn hoạt động.
    if (r.nguoi ? !nhomNhanSuDung(ch, r.nhom) : !nhomDung(ch, r.nhom)) return null;
    return {
      groupCode: r.nhom,
      method: tin.laNhapExcel ? "SYSTEM_IMPORT" : "MANUAL",
      ly: `Người nhập khai nhãn nguồn "${(tin.nhanKhai ?? "").trim()}" — ánh xạ theo bảng nhãn đã chốt 06/10`,
      tieuThu: ["NHAN_KHAI"],
      nguoi: r.nguoi ? { kind: "EMPLOYEE", employeeId: r.nguoi.employeeId } : null,
      thieuNguoi: r.referrerMissing,
      giaiTrinh: r.giaiTrinh,
      xemTay: r.xemTay,
      anhChup: r.nguoi && tin.nguoiNhap && tin.nguoiNhap.employeeId === r.nguoi.employeeId ? anhChupNhanSu(tin.nguoiNhap, ch.vaiSangNguon) : ANH_CHUP_TRONG,
    };
  },

  DUONG_VAO_MAC_DINH: (tin, ch) => {
    if (!Object.prototype.hasOwnProperty.call(ch.duongVaoMacDinh, tin.duongVao)) return null;
    const nhom = ch.duongVaoMacDinh[tin.duongVao]!;
    if (!nhomDung(ch, nhom)) return null;
    return {
      groupCode: nhom,
      method: "SYSTEM_DEFAULT",
      ly: `Không có tín hiệu nguồn nào khác — theo đường vào "${tin.duongVao}" (D11)`,
      tieuThu: [],
    };
  },
};

// ── Hoàn tất kết quả ─────────────────────────────────────────────────────────────────────────────────────

const khongNull = (o: Record<string, string | null | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => coGiaTri(v))) as Record<string, string>;

/** Nhãn do NGƯỜI khai (không phải chính nhãn máy của đường vào, vd `sale-form-app`). */
function nhanLaCuaNguoi(tin: TinHieuQuyNguon): boolean {
  return tin.nhanKhai !== null && chuanHoaNhanNguon(tin.nhanKhai) !== chuanHoaNhanNguon(tin.duongVao);
}

function hoanTat(
  khop: KhopLuat | null,
  luat: MaLuatQuyNguon | "UNKNOWN",
  tin: TinHieuQuyNguon,
  ch: CauHinhQuyNguon,
  ctx: NguCanh,
): KetQuaQuyNguon {
  const groupCode = khop?.groupCode ?? ch.dich.unknown;
  const tieuThu = new Set<LoaiTinHieu>(khop?.tieuThu ?? []);

  // ── NGƯỜI GÕ LÀ NGƯỜI GIỚI THIỆU (D12, chủ dự án chốt giữ nguyên 09/10/2026) ──
  // Lead nhập từ form nội bộ có PHIÊN ĐĂNG NHẬP ghi NGƯỜI GÕ làm nhân sự giới thiệu (nhóm nhân sự mặc định) kèm snapshot vai + dấu vết (`anhChupNhanSu`), để luôn biết nguồn từ
  // nhân sự là AI nhập. KHÔNG có cổng «người nhập = người hưởng» ở đường TẠO — chặn tự nhận chỉ có ở đường ĐỔI nguồn của lead đã có (`doiNguonLead` → `phatHienGianLan`).
  const nhomKq = ch.nhom.get(groupCode);
  const nguoi = khop?.nguoi ?? null;
  const thieuNguoi = khop?.thieuNguoi ?? false;
  const anhChupGoc = khop?.anhChup ?? ANH_CHUP_TRONG;
  // BẢN CHỤP thuộc tính nguồn (`signals.nguon`): kế thừa nguyên văn nếu hàng gốc đã có; không thì chụp từ nhóm LÚC NÀY (chủ nguồn chụp nguyên, kể cả khi chính họ nhập).
  const nguonChup =
    anhChupGoc.nguon ??
    chupNguon({
      cuaSoRiengNgay: nhomKq?.cuaSoRiengNgay ?? null,
      cuaSoMacDinhNgay: ch.cuaSoMacDinhNgay,
      chuNhanVienId: nhomKq?.chuNhanVienId ?? null,
    });
  const anhChup: AnhChupNguon = { ...anhChupGoc, nguon: nguonChup };

  // ── xem tay ──
  const xemTay: LyDoXemTayNguon[] = [...(khop?.xemTay ?? [])];
  const canhBao: CanhBaoNguon[] = [];
  if (tin.sdtTrungNhanVien) canhBao.push("SDT_NHAN_VIEN");
  if (tin.sdtNguoiGioiThieuTrungKhach) canhBao.push("NGUOI_GT_LA_KHACH");
  xemTay.push(...canhBao);

  const nhanLa = nhanLaCuaNguoi(tin) && ctx.nhan?.loai === "INVALID";
  if (nhanLa) xemTay.push("NHAN_NGUON_LA");

  const trangPageMapping = ch.thuTu.find((l) => l.ma === "PAGE_MAPPING")?.bat === true;
  const pageDaMap = !!tin.page?.trongDanhMuc && !!tin.page.dich && nhomDung(ch, tin.page.dich.groupCode);
  if (tin.page && trangPageMapping && !pageDaMap) xemTay.push("PAGE_CHUA_MAP_NGUON");

  // Giới thiệu bởi PHỤ HUYNH mà không có Sale phụ trách PH trong ảnh chụp ⇒ người xem tay (hoa hồng acquisition của vai Sale-PH vào hàng chờ,
  // KHÔNG tự gán Sale đang chốt đơn). Cờ nằm ở xemTay (người quyết xong thì gỡ), không ở canhBao.
  if (nguoi?.kind === "PARENT" && anhChup.referrerSaleUserId === null) xemTay.push("THIEU_SALE_PH");

  const xemTayDuy = [...new Set(xemTay)];

  // ── signals (KHÔNG PII) ──
  const signals: Record<string, unknown> = { duongVao: tin.duongVao };
  if (nhanLaCuaNguoi(tin)) signals.nhanGoc = (tin.nhanKhai ?? "").trim();
  const qc = khongNull({ ...tin.quangCao });
  if (Object.keys(qc).length > 0) signals.quangCao = qc;
  const utm = khongNull({ ...tin.utm });
  if (Object.keys(utm).length > 0) signals.utm = utm;
  if (tin.page) signals.pageId = tin.page.pageId;
  if (tin.ref) {
    signals.ref = tin.ref.hopLe
      ? { code: tin.ref.code, hopLe: true, affiliateId: tin.ref.affiliateId }
      : { code: tin.ref.code, hopLe: false };
  }
  if (tin.refSau.length > 0) signals.refSau = [...tin.refSau];
  if (tin.maNvKhongGiai !== null) signals.maNvKhongGiai = tin.maNvKhongGiai;
  if (khop?.khoa) signals.khoaNguon = true;
  if (anhChup.nguoiGioiThieu) signals.nguoiGioiThieu = { ...anhChup.nguoiGioiThieu, roleCodes: [...anhChup.nguoiGioiThieu.roleCodes] };
  signals.nguon = { ...nguonChup };
  if (xemTayDuy.length > 0) {
    signals.xemTay = xemTayDuy;
    signals.coXemTay = true;
  }

  // ── tín hiệu THUA ⇒ touchpoint ──
  const thua: TouchpointThua[] = [];
  if (tin.ref && !tieuThu.has("REF")) {
    thua.push({
      kind: "REF_SAU",
      claimedGroupCode: null,
      signals: { ref: tin.ref.code, hopLe: tin.ref.hopLe },
    });
  }
  for (const code of tin.refSau) {
    thua.push({ kind: "REF_SAU", claimedGroupCode: null, signals: { ref: code, laRefSau: true } });
  }
  const loser: Record<string, unknown> = {};
  const nhomLoser: string[] = [];
  if (coQuangCao(tin.quangCao) && !tieuThu.has("QUANG_CAO")) {
    loser.quangCao = qc;
    nhomLoser.push(ch.dich.quangCao);
  }
  if (tin.page && !tieuThu.has("PAGE")) {
    loser.pageId = tin.page.pageId;
    if (tin.page.dich) nhomLoser.push(tin.page.dich.groupCode);
  }
  if (nhanLaCuaNguoi(tin) && !tieuThu.has("NHAN_KHAI")) {
    loser.nhanGoc = (tin.nhanKhai ?? "").trim();
    if (ctx.nhan && ctx.nhan.loai !== "INVALID") nhomLoser.push(ctx.nhan.nhom);
  }
  // Ghi AI (chỉ id, không PII) — cờ boolean làm mất nửa dữ liệu khi tranh chấp hoa hồng / chống TU_CLAIM sau này.
  if (tin.nhanSuGioiThieu && !tieuThu.has("NHAN_SU")) loser.nhanSuGioiThieu = { employeeId: tin.nhanSuGioiThieu.employeeId };
  if (tin.phuHuynhGioiThieu && !tieuThu.has("PH_GT")) {
    loser.phuHuynhGioiThieu = { parentUserId: tin.phuHuynhGioiThieu.parentUserId, studentId: tin.phuHuynhGioiThieu.studentId };
  }
  if (Object.keys(loser).length > 0) {
    thua.push({
      kind: "TAO_LEAD",
      claimedGroupCode: new Set(nhomLoser).size === 1 ? nhomLoser[0]! : null,
      signals: loser,
    });
  }

  return {
    groupCode,
    originalGroupCode: khop?.originalGroupCode ?? groupCode,
    inheritedFromLeadId: khop?.inheritedFromLeadId ?? null,
    attributedAt: khop?.attributedAt ?? null,
    luat,
    identificationMethod: khop?.method ?? "UNKNOWN",
    reasonText: khop?.ly ?? "Không xác định được nguồn từ tín hiệu có sẵn",
    nguoi,
    referrerMissing: thieuNguoi,
    otherSourceNote: khop?.giaiTrinh ?? null,
    canhBao,
    xemTay: xemTayDuy,
    khoaNguon: khop?.khoa === true,
    anhChup,
    conversionEntry: tin.conversionEntry,
    signals,
    touchpointThua: thua,
  };
}

/**
 * Quy nguồn cho MỘT lần nhập. Hàm TOÀN PHẦN: không ném với đầu vào nào (T4).
 * Tín hiệu có mặt mà không thắng sẽ thành `touchpointThua`.
 */
export function quyNguon(tin: TinHieuQuyNguon, ch: CauHinhQuyNguon): KetQuaQuyNguon {
  const nhan: KetQuaAnhXa | null = coGiaTri(tin.nhanKhai)
    ? anhXaNhanCu(
        {
          nhan: tin.nhanKhai,
          createdAt: tin.bayGio,
          affiliate: null,
          nguoiNhap: tin.nguoiNhap,
          maNvTrongNote: tin.maNvKhongGiai,
        },
        ch.vaiSangNguon,
        ch.dich.nhanSu,
      )
    : null;
  const ctx: NguCanh = { nhan };

  for (const { ma, bat } of ch.thuTu) {
    if (!bat) continue;
    const khop = BO_LUAT[ma](tin, ch, ctx);
    if (khop) return hoanTat(khop, ma, tin, ch, ctx);
  }
  return hoanTat(null, "UNKNOWN", tin, ch, ctx);
}
