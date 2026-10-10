/**
 * lib/nguon/tin-hieu.ts — KIỂU của resolver quy nguồn (PR2). THUẦN, chỉ kiểu + hằng.
 *
 * Đặc tả: `docs/source-commission/03 §2.2–§2.7`. Tầng DB (`thu-thap-tin-hieu.ts`) gom mọi tín hiệu thành một
 * `TinHieuQuyNguon`; `quyNguon()` (quy-nguon.ts) quyết định trên đó. Tách như vậy để test resolver không cần Postgres.
 *
 * Mã NHÓM đi theo `code` (`MaNhomGoc` hoặc chuỗi của nhóm admin thêm — danh mục MỞ, 03 T3), KHÔNG theo id: id là việc
 * của tầng ghi, hàm thuần không biết DB.
 */
import type { LeadTouchpointKind, SourceIdentificationMethod, SourceReferrerRequirement } from "@prisma/client";
import type { LyDoXemTay } from "./anh-xa-nhan-cu";
import type { DongVaiSangNguon, MaVaiNguon } from "./danh-muc-goc";
import type { NguonChup } from "./nguon-chup";

/** Mã luật có trong bảng `BO_LUAT` (03 §2.3). `AFF_CHUA_PHAN_LOAI` là luật TẠM (H12) đứng chỗ ba luật `MA_*` tới PR11. */
export type MaLuatQuyNguon =
  | "KE_THUA_SDT"
  | "CHON_NGUON"
  | "MA_GT_CA_NHAN"
  | "QR_SU_KIEN"
  | "MA_DOI_TAC"
  | "MA_CTV"
  | "AFF_CHUA_PHAN_LOAI"
  | "QUANG_CAO"
  | "PAGE_MAPPING"
  | "NV_GIOI_THIEU"
  | "PH_GIOI_THIEU"
  | "KHAI_TAY"
  | "DUONG_VAO_MAC_DINH";

/** Loại tín hiệu — để biết tín hiệu nào THẮNG (đã tiêu thụ) và tín hiệu nào THUA (thành touchpoint). */
export type LoaiTinHieu = "REF" | "QUANG_CAO" | "PAGE" | "NHAN_SU" | "PH_GT" | "NHAN_KHAI" | "CHON_NGUON";

/**
 * Cảnh báo về KHÁCH ghi lúc quy nguồn. «Tự nhận» (`TU_CLAIM`) KHÔNG nằm ở đây: người gõ phiếu được ghi làm người giới thiệu (D12); chặn tự nhận chỉ có ở đường ĐỔI nguồn
 * (`gian-lan.ts` → `doiNguonLead`), nơi nó là mã CHẶN chứ không phải cảnh báo lưu vào dòng quy nguồn.
 */
export type CanhBaoNguon = "SDT_NHAN_VIEN" | "NGUOI_GT_LA_KHACH";

/** Lý do một attribution phải có NGƯỜI xem tay (hàng chờ nguồn). Kế thừa 5 lý do của di trú + 4 lý do của đường sống. */
/**
 * `THIEU_SALE_PH` = giới thiệu bởi phụ huynh mà KHÔNG tìm được Sale phụ trách phụ huynh lúc ghi nhận (ảnh chụp `referrerSaleUserId` = NULL):
 * hoa hồng acquisition của vai `REFERRER_PARENT_SALE` vào hàng chờ, KHÔNG tự gán Sale đang chốt đơn. Chỉ ở `xemTay` (người quyết xong thì gỡ),
 * KHÔNG ở `canhBao` (cột đó là cảnh báo về KHÁCH).
 */
export type LyDoXemTayNguon = LyDoXemTay | "NHAN_NGUON_LA" | "PAGE_CHUA_MAP_NGUON" | "THIEU_SALE_PH" | CanhBaoNguon;

export type NguoiNhapDaGiai = {
  employeeId: string;
  roleCodes: readonly string[];
  vaiTuHienTai: boolean;
  /** Mã nhân viên + đơn vị (`Employee.orgUnitId`) — chỉ để ghi `signals.nguoiGioiThieu`; vắng ⇒ null. */
  employeeCode?: string | null;
  orgUnitId?: string | null;
};

/** `signals.nguoiGioiThieu` — KHÔNG PII ngoài mã (SPEC nguồn động §1.2). */
export type DauVetNguoiGioiThieu = { employeeCode: string | null; roleCodes: readonly string[]; orgUnitId: string | null };

/**
 * ẢNH CHỤP về người giới thiệu LÚC ghi nhận nguồn (SPEC nguồn động §1.2): ghi MỘT LẦN (first-claim), KHÔNG tính lại khi người đổi vai/đổi Sale;
 * chỉ `doiNguon` có kiểm soát mới ghi lại. Vai chỉ là snapshot — KHÔNG chọn nhóm nguồn.
 */
export type AnhChupNguon = {
  /** Vai ngữ nghĩa của nhân sự giới thiệu; null khi người giới thiệu không phải nhân sự. */
  referrerRoleCode: MaVaiNguon | null;
  /** Sale phụ trách phụ huynh giới thiệu (`User.id`); null khi không phải PH giới thiệu HOẶC không tìm được. */
  referrerSaleUserId: string | null;
  nguoiGioiThieu: DauVetNguoiGioiThieu | null;
  /**
   * Bản chụp thuộc tính NGUỒN (người phụ trách · cửa sổ ghi công hiệu lực) lúc ghi nhận — `signals.nguon`. null = chưa có: `hoanTat` tính từ nhóm lúc này;
   * kế thừa từ hàng CHƯA có bản chụp (di trú) cũng tính lại từ nhóm lúc này. Xem `nguon-chup.ts`.
   */
  nguon: NguonChup | null;
};

export const ANH_CHUP_TRONG: AnhChupNguon = Object.freeze({ referrerRoleCode: null, referrerSaleUserId: null, nguoiGioiThieu: null, nguon: null });

export type NguoiGioiThieu =
  | { kind: "EMPLOYEE"; employeeId: string }
  | { kind: "PARENT"; parentUserId: string | null; studentId: string | null }
  | { kind: "AFFILIATE"; affiliateId: string };

/** Bản GỐC NHẤT của chuỗi kế thừa theo SĐT (D3). Tầng DB tra, hàm thuần chỉ dùng. */
export type KeThuaGoc = {
  leadId: string;
  attributedAt: Date;
  /** Nhóm HIỆN HÀNH của bản gốc (đã qua `doiNguon` nếu có). */
  groupCode: string;
  /** Nhóm lúc ghi nhận đầu tiên. */
  originalGroupCode: string;
  nguoi: NguoiGioiThieu | null;
  referrerMissing: boolean;
  otherSourceNote: string | null;
  /** Ảnh chụp của bản gốc — kế thừa NGUYÊN VĂN (không tính lại). */
  anhChup: AnhChupNguon;
};

export type QuangCaoTin = {
  adId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  campaignName: string | null;
  formId: string | null;
  fbclid: string | null;
  gclid: string | null;
  /**
   * Nền tảng của lead quảng cáo Meta (`fb` · `ig` · `messenger`…) — TUỲ CHỌN (09/10/2026): vắng = payload không có.
   * Cố ý KHÔNG nằm trong `KHONG_CO_TIN_HIEU_NGUON` và KHÔNG tính là tín hiệu quảng cáo (`coQuangCao`): nó là mô tả của một tín hiệu khác,
   * đứng một mình thì không chứng minh được gì (cùng nguyên tắc UTM một mình — 03 §2.3). Chỉ để báo cáo biết quảng cáo chạy trên nền tảng nào.
   */
  platform?: string | null;
};

export type UtmTin = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
};

export type PageTin = {
  pageId: string;
  /** Page có trong `FacebookPageMapping` đang hoạt động. */
  trongDanhMuc: boolean;
  /** Dòng của `nguon.bangNguonTheoPage` cho pageId này; null = chưa map nguồn. */
  dich: { groupCode: string; campaignCode: string | null } | null;
};

/**
 * Nguồn do người nhập CHỌN trong ô chọn nguồn (SourcePicker + ReferrerPicker — PR7), ĐÃ giải ở tầng đọc. `groupCode` là nhóm sẽ GHI:
 * chọn nhân sự thì là nhóm suy từ VAI của họ (D5), không phải nhóm radio người nhập bấm. `loi` ≠ null ⇒ lựa chọn không hợp lệ: luật
 * KHÔNG khớp và đường nhập bị CHẶN trước transaction (người nhập đã khai rõ ý mà ta không ghi được thì phải nói, không âm thầm rơi UNKNOWN).
 */
export type NguonChonDaGiai = {
  groupCode: string;
  nguoi: NguoiGioiThieu | null;
  giaiTrinh: string | null;
  loi: string | null;
  /** Ảnh chụp người giới thiệu (nhân sự: vai + dấu vết; PH: Sale phụ trách). */
  anhChup: AnhChupNguon;
};

/** Mọi tín hiệu của MỘT lần nhập. Hàm thuần không đọc đồng hồ: `bayGio` là tham số (luật 19). */
export type TinHieuQuyNguon = {
  bayGio: Date;
  /** Kênh kỹ thuật: facebook · zalo · google-form · quatang · sale-form · sale-form-app · web · nhap-tay · import-excel · import-dang-ky. */
  duongVao: string;
  /** Giá trị sẽ ghi vào `Lead.source` (ảnh chụp đường vào lúc ghi). */
  conversionEntry: string | null;
  /** Nhãn nguồn do NGƯỜI NHẬP/FILE khai (đã trim); null = không khai. Có thể trùng nhãn máy (`sale-form`…). */
  nhanKhai: string | null;
  /** Đường Excel ⇒ `identificationMethod = SYSTEM_IMPORT` thay cho `MANUAL`. */
  laNhapExcel: boolean;
  /** NGƯỜI GÕ MÁY đã giải (khác người giới thiệu): dùng cho nhãn `sale-form`/`sale-form-app` (D12). */
  nguoiNhap: NguoiNhapDaGiai | null;
  /** Mã NV chuẩn hoá có trên phiếu nhưng KHÔNG giải được ra nhân viên. */
  maNvKhongGiai: string | null;
  /** Nhân sự do người nhập CHỌN làm người giới thiệu (picker) — luật `NV_GIOI_THIEU`. */
  nhanSuGioiThieu: NguoiNhapDaGiai | null;
  phuHuynhGioiThieu: { parentUserId: string | null; studentId: string | null } | null;
  /** Sale phụ trách của phụ huynh giới thiệu (ĐÃ tra ở tầng đọc, tại `bayGio`); null = không tìm được / không có PH. */
  saleCuaPhuHuynh: string | null;
  /** Lựa chọn tường minh ở ô chọn nguồn (PR7). Vắng/null = không có ô chọn (đường máy, Excel). */
  nguonChon?: NguonChonDaGiai | null;
  ref: { code: string; hopLe: boolean; affiliateId: string | null } | null;
  refSau: readonly string[];
  quangCao: QuangCaoTin;
  utm: UtmTin;
  page: PageTin | null;
  keThua: KeThuaGoc | null;
  /** `canonicalPhone(SĐT khách)` trùng SĐT một nhân viên (mọi `status`). */
  sdtTrungNhanVien: boolean;
  /** SĐT người giới thiệu trùng SĐT khách. */
  sdtNguoiGioiThieuTrungKhach: boolean;
};

export type ThuocTinhNhom = {
  code: string;
  active: boolean;
  requiresNote: boolean;
  selectable: boolean;
  referrerRequirement: SourceReferrerRequirement;
  /** Cửa sổ ghi công RIÊNG của nguồn (`attributionWindowDays`); null ⇒ setting chung. Chụp vào `signals.nguon` lúc ghi nhận. BẮT BUỘC khai. */
  cuaSoRiengNgay: number | null;
  /** `Employee.id` người phụ trách nguồn (`ownerEmployeeId`); null = chưa khai. Chụp vào `signals.nguon`. BẮT BUỘC khai. */
  chuNhanVienId: string | null;
};

/** Năm cờ ĐÃ giải tổ hợp (`hopCoNguon`): cờ con chỉ true khi master bật. */
export type CoQuyNguon = {
  autoAttribution: boolean;
  pageMapping: boolean;
  referral: boolean;
  manualReview: boolean;
};

export type CauHinhQuyNguon = {
  /** Thứ tự + công tắc ĐÃ áp cờ con (`dungCauHinhQuyNguon`). */
  thuTu: readonly { ma: MaLuatQuyNguon; bat: boolean }[];
  nhom: ReadonlyMap<string, ThuocTinhNhom>;
  vaiSangNguon: readonly DongVaiSangNguon[];
  /** `duongVao` → mã nhóm đích (D11: mọi đường web/ads về nhóm Quảng cáo). */
  duongVaoMacDinh: Readonly<Record<string, string>>;
  /**
   * Nhóm đích của luật `QUANG_CAO` / `PH_GIOI_THIEU` / `NV_GIOI_THIEU` / UNKNOWN — dữ liệu cấu hình, không nằm rải trong luật.
   * `nhanSu` = nhóm khi chỉ biết "đây là nhân sự giới thiệu" (setting `nguon.nhomNhanSuMacDinh`); khi người dùng CHỌN RÕ một nhóm thì giữ nhóm ấy.
   */
  dich: { quangCao: string; phuHuynh: string; nhanSu: string; unknown: string; nhomKhac: string };
  /** Cửa sổ ghi công CHUNG (setting `nguon.cuaSoGhiCongNgay`) lúc ghi — để chụp con số HIỆU LỰC khi nguồn không có cửa sổ riêng. BẮT BUỘC khai. */
  cuaSoMacDinhNgay: number;
};

export type TouchpointThua = {
  kind: Extract<LeadTouchpointKind, "REF_SAU" | "TAO_LEAD">;
  claimedGroupCode: string | null;
  signals: Record<string, unknown>;
};

export type KetQuaQuyNguon = {
  groupCode: string;
  originalGroupCode: string;
  inheritedFromLeadId: string | null;
  /** null ⇒ giờ DB (T7: bên claim trước thắng theo giờ MÁY CHỦ). Kế thừa ⇒ mốc của bản gốc. */
  attributedAt: Date | null;
  luat: MaLuatQuyNguon | "UNKNOWN";
  identificationMethod: SourceIdentificationMethod;
  reasonText: string;
  nguoi: NguoiGioiThieu | null;
  /** THIEU_NGUOI = MANUAL_REVIEW_REQUIRED: nhóm ✅ người mà chưa có người. */
  referrerMissing: boolean;
  otherSourceNote: string | null;
  canhBao: CanhBaoNguon[];
  xemTay: LyDoXemTayNguon[];
  /** Page mapping tự xác định nguồn ⇒ khoá (chỉ quyền `sources:manage` mới đổi — `doi-nguon.ts`). */
  khoaNguon: boolean;
  /** Ảnh chụp người giới thiệu — ghi cùng dòng quy nguồn. */
  anhChup: AnhChupNguon;
  conversionEntry: string | null;
  /** JSON-safe, KHÔNG PII. Chứa `coXemTay`/`xemTay`/`khoaNguon`/`nhanGoc` + metadata quảng cáo. */
  signals: Record<string, unknown>;
  touchpointThua: TouchpointThua[];
};

// ── Tín hiệu NGUỒN do đường gọi khai (đi kèm `IntakeContext.tinHieuNguon`) ──────────────────────────────────

/**
 * Phần tín hiệu nguồn mà chỉ ĐƯỜNG GỌI biết (quảng cáo, page, mã giới thiệu, người được chọn). Phần còn lại
 * (đường vào, nhãn, người nhập, SĐT) `ingestIntakeLead` tự có. BẮT BUỘC khai ở mọi chỗ gọi (luật 7): thêm đường
 * mới mà quên là `tsc` đỏ, không phải lead mới lặng lẽ mất nguồn.
 */
/** Lựa chọn thô từ ô chọn nguồn của form — chỉ id + chữ, chưa kiểm. Tầng đọc (`thu-thap-tin-hieu`) giải + kiểm. */
export type NguonChonDauVao = {
  /** `LeadSourceGroup.id` người nhập bấm (nhân sự: chỉ là nhóm GỢI Ý — nhóm ghi suy từ vai người được chọn). */
  groupId: string;
  employeeId: string | null;
  parentUserId: string | null;
  studentId: string | null;
  affiliateId: string | null;
  giaiTrinh: string | null;
};

export type TinHieuNguonDauVao = {
  quangCao: QuangCaoTin;
  utm: UtmTin;
  pageId: string | null;
  ref: string | null;
  refSau: readonly string[];
  nhanSuGioiThieuEmployeeId: string | null;
  phuHuynhGioiThieu: { parentUserId: string | null; studentId: string | null } | null;
  /** Ô chọn nguồn của form nhập (PR7). null ⇒ đường này không có ô chọn. BẮT BUỘC khai (luật 7). */
  nguonChon: NguonChonDauVao | null;
};

/** Đường gọi KHÔNG có tín hiệu nguồn nào ngoài đường vào + nhãn (sale-form, quatang, replay, form nội bộ). */
export const KHONG_CO_TIN_HIEU_NGUON: TinHieuNguonDauVao = Object.freeze({
  quangCao: Object.freeze({
    adId: null,
    campaignId: null,
    adsetId: null,
    campaignName: null,
    formId: null,
    fbclid: null,
    gclid: null,
  }),
  utm: Object.freeze({ source: null, medium: null, campaign: null, term: null, content: null }),
  pageId: null,
  ref: null,
  refSau: Object.freeze([] as string[]),
  nhanSuGioiThieuEmployeeId: null,
  phuHuynhGioiThieu: null,
  nguonChon: null,
});
