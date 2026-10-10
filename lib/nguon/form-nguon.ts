/**
 * lib/nguon/form-nguon.ts — PHẦN THUẦN của biểu mẫu Tạo / Sửa nguồn (SPEC nguồn động §4, giao diện tab Nguồn). Không `db`, không React, không đồng hồ thật.
 *
 * ── Vì sao có tệp này ──────────────────────────────────────────────────────────────────────────────────────
 * Luật ĐƯỢC / KHÔNG ĐƯỢC của danh mục nguồn đã nằm Ở MỘT CHỖ (`danh-muc-ghi-dau-vao.ts`) và cổng ghi (`danh-muc-ghi.ts`) chạy nó. Biểu mẫu KHÔNG được có bản luật thứ hai:
 * một ô vẽ sửa được mà bấm Lưu mới bị từ chối (hoặc ngược lại) là affordance nói dối (luật 12). Nên tệp này CHẠY LẠI chính `taoNguonSchema` / `suaNguonSchema` /
 * `kiemSuaNguon` / `lamHongDichMacDinh` / `canQuyenKichHoat` trên payload dựng từ ô nhập, và chỉ làm hai việc luật không làm:
 *   1. dịch ô nhập (chuỗi) ↔ payload (số, ngày ISO giờ VN, null) — kèm kiểm tiền xử lý để lỗi ra tiếng Việt, không lọt câu Anh của Zod;
 *   2. dịch lỗi của luật về ĐÚNG ô, và dựng lời cảnh báo / lý do khoá nút Lưu từ cùng các hàm đó.
 *
 * ── Ngày ───────────────────────────────────────────────────────────────────────────────────────────────────
 * Ô ngày (`<input type="date">`) đọc/ghi NGÀY GIỜ VIỆT NAM (UTC+7, không giờ mùa hè): "2026-10-10" ⇄ 00:00 ngày 10/10 VN = `2026-10-09T17:00:00.000Z`. Hết hiệu lực là MỐC
 * (từ 00:00 ngày đó nguồn không còn chọn được cho lead mới — biên kết thúc MỞ, `hieu-luc-nguon.ts`). Gửi lại ô ngày KHÔNG đổi thì không đi vào payload sửa (so chuỗi
 * ô, không so mốc): mốc cũ có giờ lẻ không bị «chuẩn hoá» thành đổi nhạy cảm bắt lý do.
 *
 * ── Đồng hồ ────────────────────────────────────────────────────────────────────────────────────────────────
 * Không hàm nào ở đây gọi `new Date()` không tham số (luật 19): `nowIso` do trang truyền xuống.
 */
import {
  CAU_THIEU_QUYEN_KICH_HOAT,
  CUA_SO_NGAY_TOI_DA,
  LOAI_NGUON_CHON,
  TAT_CA_TRUONG_SUA,
  YEU_CAU_NGUOI,
  canQuyenKichHoat,
  chanNguonHoatDongKhongChu,
  chanTatHoaHongNguon,
  nguonDangDinhTienTheoRule,
  chuanHoaCode,
  kiemCode,
  kiemDoiTrangThai,
  kiemHieuLuc,
  kiemSuaNguon,
  laTruongNhayCam,
  lamHongDichMacDinh,
  lyDoKhoaTruong,
  suaNguonSchema,
  taoNguonSchema,
  truongThatSuDoi,
  type GiaTriNguon,
  type LoaiNguonTatCa,
  type NguonDeSua,
  type TrangThaiNguon,
  type TruongSua,
  type YeuCauNguoi,
} from "./danh-muc-ghi-dau-vao";
import type { NguonDaDung } from "./danh-muc-ghi";

// ── Kiểu ─────────────────────────────────────────────────────────────────────────────────────────

/** Giá trị MỘT biểu mẫu nguồn: mọi ô là chuỗi / boolean (đúng thứ `<input>` giữ). Tên khoá trùng `TruongSua` để một vòng lặp lo cả hai chiều. */
export type GiaTriForm = {
  code: string;
  name: string;
  description: string;
  sourceType: string;
  referrerRequirement: string;
  requiresNote: boolean;
  selectable: boolean;
  sortOrder: string;
  attributionWindowDays: string;
  commissionEnabled: boolean;
  ownerEmployeeId: string;
  ownerOrgUnitId: string;
  /** `yyyy-mm-dd`, giờ VN; "" = không giới hạn. */
  effectiveFrom: string;
  effectiveTo: string;
  /** Chỉ biểu mẫu TẠO: nguồn ra đời ở nháp hay hoạt động. */
  trangThai: "DRAFT" | "ACTIVE";
  /** Chỉ biểu mẫu SỬA: lý do cho đổi nhạy cảm. Không phải trường của nguồn. */
  lyDo: string;
};
export type TruongForm = keyof GiaTriForm;
export type LoiForm = Partial<Record<TruongForm, string>>;

/** Ảnh một nguồn như biểu mẫu sửa cần (tập con của `NguonDeSuaView`, thuần dữ liệu — qua được ranh server → client). */
export type NguonFormView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sourceType: string;
  referrerRequirement: string;
  requiresNote: boolean;
  selectable: boolean;
  status: TrangThaiNguon;
  isSystem: boolean;
  sortOrder: number;
  attributionWindowDays: number | null;
  commissionEnabled: boolean;
  ownerOrgUnitId: string | null;
  ownerEmployee: { id: string; ten: string; maNv: string | null; coTaiKhoan: boolean } | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  /** ISO của `updatedAt` — mốc khoá lạc quan gửi lại khi Lưu. */
  capNhatLuc: string;
  daDung: NguonDaDung;
};

/** Thứ máy chủ biết mà biểu mẫu không tự biết được. */
export type BoiCanhSua = {
  /** Nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn (`maDichMacDinh`) — tắt chọn / đặt hạn sẽ làm lead mới rơi về UNKNOWN. */
  laDichMacDinh: boolean;
  /** Mốc «bây giờ» lúc trang dựng (ISO) — truyền vào cổng đích-mặc-định; biểu mẫu không đọc đồng hồ. */
  nowIso: string;
  /** Người sửa CÓ `commission_policies:activate` không (`coQuyenKichHoatChinhSach`). */
  coQuyenKichHoat: boolean;
  dinhTien: {
    /** Có phiên bản chính sách ACTIVE phạm vi RIÊNG nguồn này. */
    chinhSachRieng: boolean;
    /** …và trong đó có dòng THU HÚT (mọi kiểu tính trừ EXCLUDE) — tắt «tham gia hoa hồng» sẽ làm dòng ấy ngừng chạy im lặng. */
    coDongThuHutRieng: boolean;
    /** Có rule vai SOURCE_OWNER ACTIVE ở BẤT KỲ đâu (rule chung trả cho chủ của mọi nguồn). */
    ruleChuNguonBatKy: boolean;
    /** Rule vai SOURCE_OWNER CHẠY trên nguồn này: rule không gắn nguồn nào hoặc rule của chính nó (`ruleChuChayChoNguon`). */
    ruleChuChay: boolean;
  };
};

// ── Nhãn trường (một nơi) ─────────────────────────────────────────────────────────────────────────

export const NHAN_TRUONG: Readonly<Record<TruongSua, string>> = {
  code: "Mã nguồn",
  name: "Tên nguồn",
  description: "Mô tả",
  sourceType: "Nhóm nguồn",
  referrerRequirement: "Cách xác định nguồn",
  requiresNote: "Bắt buộc giải trình",
  selectable: "Chọn được ở ô nhập",
  sortOrder: "Thứ tự hiển thị",
  attributionWindowDays: "Cửa sổ ghi công",
  commissionEnabled: "Tham gia hoa hồng theo nguồn",
  ownerEmployeeId: "Người phụ trách",
  ownerOrgUnitId: "Phạm vi đơn vị",
  effectiveFrom: "Hiệu lực từ",
  effectiveTo: "Hết hiệu lực từ",
};

/**
 * Phụ đề của trang SỬA nguồn. Với nguồn hệ thống nó LIỆT KÊ ô sửa được lấy từ CHÍNH `lyDoKhoaTruong` (cổng ghi + ô `disabled` dùng chung) — không gõ cứng: bản gõ cứng nói
 * UNKNOWN sửa được cửa sổ / hoa hồng / người phụ trách sau khi các ô đó đã khoá (lời hứa suông, luật 12).
 */
export function phuDeTrangSua(nguon: Pick<NguonDeSua, "code" | "isSystem" | "daDung">): string {
  if (!nguon.isSystem) return "Đổi thông tin, cửa sổ ghi công, người phụ trách hoặc hoa hồng của nguồn.";
  const duoc = TAT_CA_TRUONG_SUA.filter((k) => lyDoKhoaTruong(nguon, k) === null).map((k) => NHAN_TRUONG[k].charAt(0).toLowerCase() + NHAN_TRUONG[k].slice(1));
  return `Nguồn hệ thống: chỉ sửa được ${duoc.join(", ")}.`;
}

// ── Ngày giờ Việt Nam ─────────────────────────────────────────────────────────────────────────────

const GIO_VN_MS = 7 * 60 * 60 * 1000;
const DANG_NGAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO → `yyyy-mm-dd` theo NGÀY VN; null / sai dạng ⇒ "". */
export function ngayVNTuISO(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + GIO_VN_MS).toISOString().slice(0, 10);
}

/** `yyyy-mm-dd` (ngày VN) → ISO của 00:00 ngày đó giờ VN; sai dạng hoặc ngày không có thật (30/02) ⇒ null. */
export function isoTuNgayVN(ngay: string): string | null {
  const m = DANG_NGAY.exec(ngay.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return new Date(utc.getTime() - GIO_VN_MS).toISOString();
}

// ── Dựng giá trị ban đầu ─────────────────────────────────────────────────────────────────────────

/**
 * Biểu mẫu TẠO trống. Mặc định chọn phía AN TOÀN: nháp (lead mới chưa chọn được cho tới khi kích hoạt có chủ đích) · chưa chọn nhóm (bắt chọn) · không cần người ·
 * không hoa hồng theo nguồn (bật có chủ đích) · cửa sổ để trống = dùng mặc định hệ thống.
 */
export function formTrong(p: { thuTuGoiY: number }): GiaTriForm {
  return {
    code: "",
    name: "",
    description: "",
    sourceType: "",
    referrerRequirement: "NONE",
    requiresNote: false,
    selectable: true,
    sortOrder: String(p.thuTuGoiY),
    attributionWindowDays: "",
    commissionEnabled: false,
    ownerEmployeeId: "",
    ownerOrgUnitId: "",
    effectiveFrom: "",
    effectiveTo: "",
    trangThai: "DRAFT",
    lyDo: "",
  };
}

/** Biểu mẫu SỬA: giá trị hiện có của nguồn. */
export function formTuNguon(n: NguonFormView): GiaTriForm {
  return {
    code: n.code,
    name: n.name,
    description: n.description ?? "",
    sourceType: n.sourceType,
    referrerRequirement: n.referrerRequirement,
    requiresNote: n.requiresNote,
    selectable: n.selectable,
    sortOrder: String(n.sortOrder),
    attributionWindowDays: n.attributionWindowDays === null ? "" : String(n.attributionWindowDays),
    commissionEnabled: n.commissionEnabled,
    ownerEmployeeId: n.ownerEmployee?.id ?? "",
    ownerOrgUnitId: n.ownerOrgUnitId ?? "",
    effectiveFrom: ngayVNTuISO(n.effectiveFrom),
    effectiveTo: ngayVNTuISO(n.effectiveTo),
    trangThai: n.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
    lyDo: "",
  };
}

// ── Chuỗi ô → giá trị ─────────────────────────────────────────────────────────────────────────────

const LA_SO_NGUYEN = /^\d+$/;
const soNguyen = (s: string): number => (LA_SO_NGUYEN.test(s.trim()) ? Number(s.trim()) : Number.NaN);
const tuyChonSo = (s: string): number | null => (s.trim() === "" ? null : soNguyen(s));
const tuyChonId = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const tuyChonNgay = (s: string): string | null => {
  if (s.trim() === "") return null;
  return isoTuNgayVN(s) ?? s.trim(); // sai dạng ⇒ giữ nguyên chuỗi để kiểm tiền xử lý báo lỗi ở ô
};

/** Chuyển MỘT trường của biểu mẫu sang giá trị payload. */
function giaTriTruong(f: GiaTriForm, k: TruongSua): unknown {
  switch (k) {
    case "code":
      return chuanHoaCode(f.code);
    case "name":
      return f.name.trim();
    case "description":
      return tuyChonId(f.description);
    case "sourceType":
      return f.sourceType;
    case "referrerRequirement":
      return f.referrerRequirement;
    case "requiresNote":
      return f.requiresNote;
    case "selectable":
      return f.selectable;
    case "sortOrder":
      return soNguyen(f.sortOrder);
    case "attributionWindowDays":
      return tuyChonSo(f.attributionWindowDays);
    case "commissionEnabled":
      return f.commissionEnabled;
    case "ownerEmployeeId":
      return tuyChonId(f.ownerEmployeeId);
    case "ownerOrgUnitId":
      return tuyChonId(f.ownerOrgUnitId);
    case "effectiveFrom":
      return tuyChonNgay(f.effectiveFrom);
    case "effectiveTo":
      return tuyChonNgay(f.effectiveTo);
  }
}

/** Payload TẠO — đúng hình `taoNguonSchema` (lưới `[FRN-04]` so tập khoá). */
export function bienFormTao(f: GiaTriForm): unknown {
  return {
    code: giaTriTruong(f, "code"),
    name: giaTriTruong(f, "name"),
    description: giaTriTruong(f, "description"),
    sourceType: giaTriTruong(f, "sourceType"),
    referrerRequirement: giaTriTruong(f, "referrerRequirement"),
    requiresNote: giaTriTruong(f, "requiresNote"),
    selectable: giaTriTruong(f, "selectable"),
    sortOrder: giaTriTruong(f, "sortOrder"),
    trangThai: f.trangThai,
    attributionWindowDays: giaTriTruong(f, "attributionWindowDays"),
    commissionEnabled: giaTriTruong(f, "commissionEnabled"),
    ownerOrgUnitId: giaTriTruong(f, "ownerOrgUnitId"),
    ownerEmployeeId: giaTriTruong(f, "ownerEmployeeId"),
    effectiveFrom: giaTriTruong(f, "effectiveFrom"),
    effectiveTo: giaTriTruong(f, "effectiveTo"),
  };
}

/** Ô nào của `f` KHÁC `goc` (so ô, không so giá trị đã dịch — xem đầu tệp, mục Ngày). */
function odaDoi(f: GiaTriForm, goc: GiaTriForm, k: TruongSua): boolean {
  if (k === "code") return chuanHoaCode(f.code) !== chuanHoaCode(goc.code);
  return f[k] !== goc[k];
}

/** Payload SỬA: chỉ trường THẬT SỰ đổi (gửi lại mọi ô là biến mọi lần Lưu thành «đổi nhạy cảm»). */
export function bienFormSua(f: GiaTriForm, goc: GiaTriForm): { vao: Record<string, unknown>; lyDo: string | null } {
  const vao: Record<string, unknown> = {};
  for (const k of TAT_CA_TRUONG_SUA) {
    if (odaDoi(f, goc, k)) vao[k] = giaTriTruong(f, k);
  }
  const lyDo = f.lyDo.trim();
  return { vao, lyDo: lyDo === "" ? null : lyDo };
}

// ── Kiểm tiền xử lý + dịch lỗi ────────────────────────────────────────────────────────────────────

const NHOM_HOP_LE: readonly string[] = LOAI_NGUON_CHON;
const YEU_CAU_HOP_LE: readonly string[] = YEU_CAU_NGUOI;
const MO_TA_TOI_DA = 1000;

/**
 * Lỗi mà Zod sẽ nói bằng tiếng Anh (enum sai, NaN, quá dài) hoặc không nói được (ngày sai dạng) — nói TRƯỚC bằng tiếng Việt. Ô nào đã có lỗi ở đây thì bỏ lỗi Zod của ô đó.
 * `chiO` = chỉ kiểm các trường này (biểu mẫu sửa chỉ kiểm cái đã đổi).
 */
function kiemTienXuLy(f: GiaTriForm, chiO: readonly TruongSua[] | null, tao: boolean): LoiForm {
  const loi: LoiForm = {};
  const kiem = (k: TruongSua) => chiO === null || chiO.includes(k);
  if (kiem("sourceType") && !NHOM_HOP_LE.includes(f.sourceType)) loi.sourceType = "Chọn nhóm nguồn.";
  if (kiem("referrerRequirement") && !YEU_CAU_HOP_LE.includes(f.referrerRequirement)) loi.referrerRequirement = "Chọn cách xác định nguồn.";
  if (tao && f.trangThai !== "DRAFT" && f.trangThai !== "ACTIVE") loi.trangThai = "Chọn nháp hoặc kích hoạt ngay.";
  if (kiem("sortOrder")) {
    const n = soNguyen(f.sortOrder);
    if (Number.isNaN(n) || n > 9998) loi.sortOrder = "Thứ tự là số nguyên từ 0 đến 9998.";
  }
  if (kiem("attributionWindowDays") && f.attributionWindowDays.trim() !== "") {
    const n = soNguyen(f.attributionWindowDays);
    if (Number.isNaN(n)) loi.attributionWindowDays = "Cửa sổ ghi công là số ngày nguyên (để trống = dùng mặc định hệ thống).";
    else if (n > CUA_SO_NGAY_TOI_DA) loi.attributionWindowDays = `Cửa sổ ghi công tối đa ${CUA_SO_NGAY_TOI_DA} ngày.`;
    else if (n < 1) loi.attributionWindowDays = "Cửa sổ ghi công phải ≥ 1 ngày.";
  }
  if (kiem("description") && f.description.trim().length > MO_TA_TOI_DA) loi.description = `Mô tả tối đa ${MO_TA_TOI_DA} ký tự.`;
  for (const k of ["effectiveFrom", "effectiveTo"] as const) {
    if (kiem(k) && f[k].trim() !== "" && isoTuNgayVN(f[k]) === null) loi[k] = "Ngày không hợp lệ.";
  }
  // Zod KHÔNG chạy `superRefine` khi bất kỳ ô nào đã lỗi kiểu — nên mã sai và hiệu lực ngược không hiện cùng lúc với lỗi ô khác (người dùng sửa từng vòng một). Chạy lại ĐÚNG hai hàm đó
  // ở đây để mọi lỗi hiện một lượt; cùng hàm với cổng ghi nên không có luật thứ hai.
  if (kiem("code")) {
    const loiMa = kiemCode(chuanHoaCode(f.code));
    if (loiMa) loi.code = loiMa;
  }
  if (tao && loi.effectiveFrom === undefined && loi.effectiveTo === undefined) {
    const tu = isoTuNgayVN(f.effectiveFrom);
    const den = isoTuNgayVN(f.effectiveTo);
    const loiHL = kiemHieuLuc(tu ? new Date(tu) : null, den ? new Date(den) : null);
    if (loiHL) loi.effectiveTo = loiHL;
  }
  return loi;
}

/** Câu của Zod / luật mà người thường không đọc được ⇒ câu chung. (Luật của repo đã có câu tiếng Việt; đây chỉ là lưới cho câu mặc định của Zod.) */
const CAU_ANH = /^(Invalid|Too |Unrecognized|Required|expected)/i;

type VanDeLoi = { path: PropertyKey[]; message: string };

function gopLoiZod(loi: LoiForm, issues: readonly VanDeLoi[]): void {
  for (const i of issues) {
    const k = (typeof i.path[0] === "string" ? i.path[0] : "chung") as TruongForm;
    if (loi[k] !== undefined) continue;
    loi[k] = CAU_ANH.test(i.message) ? "Giá trị không hợp lệ." : i.message;
  }
}

/** Kiểm biểu mẫu TẠO bằng CHÍNH `taoNguonSchema`. `{}` = hợp lệ. */
export function kiemFormTao(f: GiaTriForm): LoiForm {
  const loi = kiemTienXuLy(f, null, true);
  const r = taoNguonSchema.safeParse(bienFormTao(f));
  if (!r.success) gopLoiZod(loi, r.error.issues);
  return loi;
}

/** Thứ máy chủ biết mà biểu mẫu TẠO không tự biết: rule SOURCE_OWNER có chạy trên một nguồn mới không, và người tạo có quyền kích hoạt chính sách không. */
export type BoiCanhTao = {
  /** Có rule vai SOURCE_OWNER ACTIVE ở phạm vi KHÔNG gắn nguồn nào (một nguồn mới chưa có chính sách riêng) — `ruleChuChayChoNguon(dt, null)`. */
  ruleChuChay: boolean;
  coQuyenKichHoat: boolean;
};

/**
 * Hai cổng mà `taoNguon` chạy sau cổng đầu vào, chạy LẠI cho biểu mẫu tạo (nói thật, luật 12): «Kích hoạt ngay» mà nguồn không có người phụ trách khi rule chủ-nguồn đang chạy ⇒ lỗi cạnh ô trạng thái
 * (`chanNguonHoatDongKhongChu`); «Kích hoạt ngay» có người phụ trách khi rule chủ-nguồn đang chạy mà người tạo thiếu `commission_policies:activate` ⇒ khoá nút Lưu và nói câu có tên khoá (`canQuyenKichHoat`).
 * Bản nháp thì không bị cổng nào chặn. Trả lỗi theo ô + `chanLuu`; luật nằm ở các hàm thuần của cổng ghi, không viết lại ở đây.
 */
export function chanKhiTao(f: GiaTriForm, boiCanh: BoiCanhTao): { loi: LoiForm; chanLuu: string | null } {
  const loi: LoiForm = {};
  if (f.trangThai !== "ACTIVE") return { loi, chanLuu: null };
  const chu = tuyChonId(f.ownerEmployeeId);
  const chanChu = chanNguonHoatDongKhongChu({ viec: "tao", trangThaiSau: "ACTIVE", ownerSau: chu, ruleChuNguonDangChay: boiCanh.ruleChuChay });
  if (chanChu) {
    loi[chanChu.truong === "trangThai" ? "trangThai" : "ownerEmployeeId"] = chanChu.loi;
    // Cả CHÂN (khoá Lưu + nói lý do cạnh nút): ô «Người phụ trách» nằm xa nút Tạo và không phải `<input>` để RHF cuộn tới — chụp thật 10/10: bấm Tạo mà không thấy gì.
    return { loi, chanLuu: chanChu.loi };
  }
  const dangDinhTienTheoRule = nguonDangDinhTienTheoRule({ chinhSachRieng: false, coChu: chu !== null, ruleChuChay: boiCanh.ruleChuChay });
  const can = canQuyenKichHoat({ truongDoi: ["status"], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule });
  return { loi, chanLuu: can && !boiCanh.coQuyenKichHoat ? CAU_THIEU_QUYEN_KICH_HOAT : null };
}

// ── Sửa: phân tích thay đổi ───────────────────────────────────────────────────────────────────────

export type CanhBaoSua = { truong: TruongSua | "chung"; noiDung: string };

export type KetQuaPhanTich = {
  /** Lỗi cạnh ô (đã dịch). Có lỗi ⇒ không gửi được. */
  loi: LoiForm;
  /** Trường mà cổng ghi coi là THẬT SỰ đổi (khi chưa tính được vì còn lỗi: tập ô đã khác). */
  truongDoi: TruongSua[];
  /** Có đổi nhạy cảm ⇒ ô lý do bắt buộc. */
  canLyDo: boolean;
  /** Lưu ý trước khi bấm Lưu (không chặn). */
  canhBao: CanhBaoSua[];
  /** Có chữ ⇒ nút Lưu phải KHOÁ và nói đúng câu này (thiếu quyền kích hoạt chính sách). */
  chanLuu: string | null;
  /** Payload gửi lên `suaNguonAction`. */
  vao: Record<string, unknown>;
  lyDo: string | null;
};

/**
 * Câu «thiếu quyền kích hoạt» là MỘT hằng ở `danh-muc-ghi-dau-vao.ts` (máy chủ cùng dùng) — người đọc thấy một câu, trước hay sau khi bấm Lưu. Xuất lại để tên cũ còn dùng được.
 * Trường nào đụng tiền KHÔNG còn danh sách thứ hai ở đây (bản chép tay ba trường từng là bản thứ hai của luật): từng trường được hỏi qua CHÍNH `canQuyenKichHoat`.
 */
export { CAU_THIEU_QUYEN_KICH_HOAT };

function giaTriNguonTuView(n: NguonFormView): GiaTriNguon {
  return {
    code: n.code,
    name: n.name,
    description: n.description,
    sourceType: n.sourceType as LoaiNguonTatCa,
    referrerRequirement: n.referrerRequirement as YeuCauNguoi,
    requiresNote: n.requiresNote,
    selectable: n.selectable,
    sortOrder: n.sortOrder,
    attributionWindowDays: n.attributionWindowDays,
    commissionEnabled: n.commissionEnabled,
    ownerOrgUnitId: n.ownerOrgUnitId,
    ownerEmployeeId: n.ownerEmployee?.id ?? null,
    effectiveFrom: n.effectiveFrom ? new Date(n.effectiveFrom) : null,
    effectiveTo: n.effectiveTo ? new Date(n.effectiveTo) : null,
  };
}

/** Ô lỗi của cổng `kiemSuaNguon` → ô của biểu mẫu. */
function oCuaLoiCong(truong: TruongSua | "lyDo" | "trangThai"): TruongForm {
  return truong === "trangThai" ? "lyDo" : truong;
}

/**
 * MỘT hàm trả lời mọi câu mà biểu mẫu SỬA cần hỏi: lỗi ở ô nào, đổi gì, có cần lý do không, cảnh báo gì, nút Lưu có bị khoá không. Chạy cổng THẬT của máy chủ
 * (`kiemSuaNguon` + `lamHongDichMacDinh` + `canQuyenKichHoat`) — màn hình và cổng ghi không thể lệch nhau.
 *
 * Phần máy chủ còn lại mà đây KHÔNG tái hiện: mã đã tồn tại (cần DB), nhân sự phụ trách còn làm việc, đơn vị có thật, bỏ trống chủ khi rule SOURCE_OWNER chạy, tập chính sách
 * vừa đổi lúc kiểm trần. Các lỗi đó máy chủ trả kèm tên ô và biểu mẫu đặt cạnh ô đúng như vậy.
 */
export function phanTichSua(p: { form: GiaTriForm; goc: GiaTriForm; nguon: NguonFormView; boiCanh: BoiCanhSua }): KetQuaPhanTich {
  const { form, goc, nguon, boiCanh } = p;
  const { vao, lyDo } = bienFormSua(form, goc);
  const daKhac = Object.keys(vao) as TruongSua[];
  const loi = kiemTienXuLy(form, daKhac, false);
  // Chạm vào trường nhạy cảm là phải có ô lý do — kể cả khi trường ấy còn lỗi định dạng (ô lý do hiện cùng lúc, không đợi sửa xong mới hiện).
  const canLyDoSom = daKhac.some(laTruongNhayCam);
  const trong: KetQuaPhanTich = { loi, truongDoi: daKhac, canLyDo: canLyDoSom, canhBao: [], chanLuu: null, vao, lyDo };

  const r = suaNguonSchema.safeParse(vao);
  if (!r.success) {
    gopLoiZod(loi, r.error.issues);
    return trong;
  }
  if (Object.keys(loi).length > 0) return trong;
  const patch = r.data;

  const hienTai = giaTriNguonTuView(nguon);
  const kiem = kiemSuaNguon({
    nguon: { code: nguon.code, isSystem: nguon.isSystem, daDung: nguon.daDung.daDung, status: nguon.status },
    hienTai,
    patch,
    lyDo,
  });
  if (!kiem.ok) {
    loi[oCuaLoiCong(kiem.truong)] = kiem.loi;
    // Thiếu lý do KHÔNG che các cảnh báo / chặn khác (người dùng cần thấy «đổi cái này là đổi ai nhận tiền» ngay, không đợi gõ lý do). Mọi lỗi khác (khoá ô, hiệu lực…) thì dừng ở đây.
    if (kiem.truong !== "lyDo") return trong;
  }
  const truongDoi = truongThatSuDoi(hienTai, patch);

  // Nguồn là đích mặc định của quy nguồn: cùng cổng với máy chủ.
  if (truongDoi.length > 0 && boiCanh.laDichMacDinh) {
    const hong = lamHongDichMacDinh({
      code: nguon.code,
      dichMacDinh: new Set([nguon.code]),
      now: new Date(boiCanh.nowIso),
      selectableMoi: truongDoi.includes("selectable") ? patch.selectable : undefined,
      hieuLucMoi:
        truongDoi.includes("effectiveFrom") || truongDoi.includes("effectiveTo")
          ? {
              effectiveFrom: patch.effectiveFrom !== undefined ? patch.effectiveFrom : nguon.effectiveFrom ? new Date(nguon.effectiveFrom) : null,
              effectiveTo: patch.effectiveTo !== undefined ? patch.effectiveTo : nguon.effectiveTo ? new Date(nguon.effectiveTo) : null,
            }
          : undefined,
    });
    if (hong) {
      const o: TruongForm = hong.truong === "trangThai" ? "lyDo" : hong.truong;
      loi[o] = hong.loi;
      return { ...trong, truongDoi };
    }
  }

  const canhBao: CanhBaoSua[] = [];
  let chanLuu: string | null = null;

  // Chặn tuyệt đối (cổng máy chủ `chanTatHoaHongNguon`): tắt «tham gia hoa hồng» khi chính sách riêng có dòng thu hút. Lỗi đặt cạnh ô; nút Lưu khoá vì còn lỗi.
  const chanTat = chanTatHoaHongNguon({ truongDoi, commissionEnabledMoi: patch.commissionEnabled, coDongThuHutRieng: boiCanh.dinhTien.coDongThuHutRieng });
  if (chanTat) {
    loi[chanTat.truong] = chanTat.loi;
    // Cả chân: công tắc xa nút Lưu — lý do phải hiện ngay cạnh nút (khoá Lưu), không đợi bấm.
    return { ...trong, truongDoi, chanLuu: chanTat.loi };
  }

  const doiChu = truongDoi.includes("ownerEmployeeId");
  const dangDinhTienTheoRule = nguonDangDinhTienTheoRule({ chinhSachRieng: boiCanh.dinhTien.chinhSachRieng, coChu: nguon.ownerEmployee !== null, ruleChuChay: boiCanh.dinhTien.ruleChuChay });
  const chinhSachDangChay = boiCanh.dinhTien.chinhSachRieng || (doiChu && boiCanh.dinhTien.ruleChuNguonBatKy);
  if (canQuyenKichHoat({ truongDoi, chinhSachDangChay, daCoDongSo: nguon.daDung.so, dangDinhTienTheoRule })) {
    if (!boiCanh.coQuyenKichHoat) {
      chanLuu = CAU_THIEU_QUYEN_KICH_HOAT;
    } else {
      // Chỉ gọi tên những trường THẬT SỰ kích cổng (từng trường một qua CHÍNH `canQuyenKichHoat`): một lượt sửa tên + chọn được trên nguồn chỉ có dòng sổ không được nói «chọn được» là đụng tiền.
      const dungTien = truongDoi.filter((k) => canQuyenKichHoat({ truongDoi: [k], chinhSachDangChay, daCoDongSo: nguon.daDung.so, dangDinhTienTheoRule }));
      const ten = dungTien.map((k) => `«${NHAN_TRUONG[k]}»`);
      canhBao.push({
        truong: dungTien[0] ?? "chung",
        noiDung: `Đổi ${ten.join(", ")} của nguồn đang có chính sách hoa hồng chạy hoặc đã có dòng sổ là đổi ai nhận tiền ở các khoản thu SAU lúc lưu. Dòng sổ đã ghi không bị sửa.`,
      });
    }
  }
  const huyChon =
    (truongDoi.includes("selectable") && patch.selectable === false) ||
    (truongDoi.includes("effectiveTo") && patch.effectiveTo != null) ||
    (truongDoi.includes("effectiveFrom") && patch.effectiveFrom != null);
  if (huyChon) {
    canhBao.push({
      truong: truongDoi.includes("selectable") ? "selectable" : truongDoi.includes("effectiveTo") ? "effectiveTo" : "effectiveFrom",
      noiDung: "Lead MỚI sẽ không chọn được nguồn này ngoài khoảng cho phép. Lead đang mang nguồn này giữ nguyên và vẫn được tính hoa hồng.",
    });
  }

  return { loi, truongDoi, canLyDo: truongDoi.some(laTruongNhayCam), canhBao, chanLuu, vao, lyDo };
}

// ── Đổi trạng thái ────────────────────────────────────────────────────────────────────────────────

export type ThaoTacTrangThai = {
  den: TrangThaiNguon;
  nhan: string;
  /** Lý do bắt buộc (≥ 10 ký tự) — cùng cổng `kiemDoiTrangThai`. */
  canLyDo: boolean;
  /** Một câu nói việc này làm gì (hiện trong hộp thoại xác nhận). */
  moTa: string;
};
export type ThaoTacBiChan = { den: TrangThaiNguon; nhan: string; lyDo: string };

const THU_TU_DEN: readonly TrangThaiNguon[] = ["ACTIVE", "INACTIVE", "ARCHIVED"];

function nhanThaoTac(tu: TrangThaiNguon, den: TrangThaiNguon): string {
  if (den === "ARCHIVED") return "Lưu trữ";
  if (tu === "ARCHIVED") return "Khôi phục";
  if (den === "INACTIVE") return "Ngừng";
  return tu === "DRAFT" ? "Kích hoạt" : "Kích hoạt lại";
}

function moTaThaoTac(tu: TrangThaiNguon, den: TrangThaiNguon): string {
  if (den === "ACTIVE") return "Lead mới chọn được nguồn này (nếu còn trong khoảng hiệu lực).";
  if (den === "INACTIVE") {
    return tu === "ARCHIVED"
      ? "Đưa nguồn về «Tạm ngừng»; muốn lead mới chọn lại phải kích hoạt thêm một lần."
      : "Lead mới không chọn được nguồn này nữa. Lead đã có vẫn hiển thị và vẫn được tính hoa hồng.";
  }
  return "Cất nguồn khỏi danh sách đang dùng. Lead đã có vẫn hiển thị; khôi phục được về «Tạm ngừng».";
}

const LOI_KHONG_PHAI_CHUYEN_THAT = /^(Nguồn đã ở trạng thái này|Không chuyển được từ)/;

/**
 * Nút nào VẼ được cho nguồn này, nút nào KHÔNG kèm lý do. Chạy LẠI, theo đúng thứ tự, các cổng mà `doiTrangThaiNguon` (máy chủ) chạy trước phép ghi: `kiemDoiTrangThai` (bảng chuyển + luật hệ thống /
 * UNKNOWN) → `lamHongDichMacDinh` (đích mặc định của quy nguồn) → `chanNguonHoatDongKhongChu` (kích hoạt nguồn chưa có người phụ trách khi rule SOURCE_OWNER đang chạy) → cổng quyền «đụng tiền»
 * (`canQuyenKichHoat`). Chuyển vô nghĩa (DRAFT → INACTIVE, về chính trạng thái hiện tại) không vào `khongDuoc`: chỉ nói lý do cho việc người ta MUỐN làm mà bị chặn.
 *
 * ⚠️ NÓI THẬT VỀ GIỚI HẠN (W2): «nút và cổng ghi không thể lệch nhau» chỉ đúng với những gì hàm này TÁI HIỆN. Bản cũ chỉ chạy hai cổng đầu, nên nút «Kích hoạt» vẫn vẽ cho nguồn chưa có người phụ
 * trách dù máy chủ chắc chắn từ chối. Dữ liệu `dinhTien` / `coQuyenKichHoat` do trang đọc lúc dựng — có thể cũ vài giây; máy chủ vẫn là bên quyết định, và lưới `[FUI-DB-05]` đo đồng thuận trên nhiều tổ hợp.
 */
export function thaoTacTrangThai(p: {
  nguon: Pick<NguonDeSua, "code" | "isSystem" | "status"> & { ownerEmployeeId: string | null };
  dichMacDinh: ReadonlySet<string>;
  /** Nguồn này đang dính chính sách / rule nào — `docDinhTienNguon`. BẮT BUỘC (luật 7): thiếu là nút nói dối. */
  dinhTien: { chinhSachRieng: boolean; ruleChuChay: boolean };
  /** Người xem CÓ `commission_policies:activate` không (`coQuyenKichHoatChinhSach`). BẮT BUỘC. */
  coQuyenKichHoat: boolean;
  /** Đồng hồ — BẮT BUỘC (luật 19). */
  now: Date;
}): { duoc: ThaoTacTrangThai[]; khongDuoc: ThaoTacBiChan[] } {
  const duoc: ThaoTacTrangThai[] = [];
  const khongDuoc: ThaoTacBiChan[] = [];
  for (const den of THU_TU_DEN) {
    const nhan = nhanThaoTac(p.nguon.status, den);
    const kq = kiemDoiTrangThai({ nguon: p.nguon, den, lyDo: "x".repeat(10) });
    if (!kq.ok) {
      if (!LOI_KHONG_PHAI_CHUYEN_THAT.test(kq.loi)) khongDuoc.push({ den, nhan, lyDo: kq.loi });
      continue;
    }
    const hong = lamHongDichMacDinh({ code: p.nguon.code, dichMacDinh: p.dichMacDinh, now: p.now, den });
    if (hong) {
      khongDuoc.push({ den, nhan, lyDo: hong.loi });
      continue;
    }
    const chanChu = chanNguonHoatDongKhongChu({ viec: "kich-hoat", trangThaiSau: den, ownerSau: p.nguon.ownerEmployeeId, ruleChuNguonDangChay: p.dinhTien.ruleChuChay });
    if (chanChu) {
      khongDuoc.push({ den, nhan, lyDo: chanChu.loi });
      continue;
    }
    const dangDinhTienTheoRule = nguonDangDinhTienTheoRule({ chinhSachRieng: p.dinhTien.chinhSachRieng, coChu: p.nguon.ownerEmployeeId !== null, ruleChuChay: p.dinhTien.ruleChuChay });
    if (!p.coQuyenKichHoat && canQuyenKichHoat({ truongDoi: ["status"], chinhSachDangChay: false, daCoDongSo: false, dangDinhTienTheoRule })) {
      khongDuoc.push({ den, nhan, lyDo: CAU_THIEU_QUYEN_KICH_HOAT });
      continue;
    }
    duoc.push({ den, nhan, canLyDo: kq.nhayCam, moTa: moTaThaoTac(p.nguon.status, den) });
  }
  return { duoc, khongDuoc };
}
