// lib/nguon/sua-nguoi-chot.ts — SỬA `Lead.convertedById` LEGACY: người chốt bị ghi là TÀI KHOẢN CHẠY IMPORT. THUẦN — không chạm DB, không đọc đồng hồ.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ FILE NÀY (audit chỉ-đọc PROD 22/10/2026)
//
// Cả hai engine hoa hồng trả tầng SALE theo `Lead.convertedById`: engine cũ ở `lib/crm/commission-run.ts` (`nguoiHuong`), engine mới ở
// `lib/hoa-hong/nguoi-huong.ts` (`LEAD_CONVERTED_BY`). Với lead nhập từ Excel, công cụ `BACKFILL_IMPORT` chuyển lead sang ĐÃ ĐĂNG KÝ và ghi
// người chạy công cụ vào `convertedById` — nên Admin / tài khoản Đào tạo trở thành "người chốt" của đơn họ không bán. `noi-don` chỉ nối
// `Order.leadId`; nối xong thì phần SALE của các đơn ấy đi thẳng vào tài khoản kỹ thuật ở lần chốt kỳ.
//
// Hàm trong tệp này CHỈ QUYẾT ĐỊNH (nhận dữ liệu đã nạp, trả kế hoạch). Tầng DB: `sua-nguoi-chot-db.ts`.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHẠM VI — suy từ BẰNG CHỨNG, không gõ cứng tài khoản
//
//   Lead còn sống ∧ có AuditLog `BACKFILL_IMPORT` (chuyển ĐÃ ĐĂNG KÝ do công cụ import) ∧ có ĐƠN LIÊN QUAN (đã nối `Order.leadId`, hoặc nằm trong
//   kế hoạch `noi-don` loại MOT). Thiếu đơn liên quan ⇒ BỎ QUA (không có tiền hoa hồng nào đi theo lead đó).
//   "Tài khoản kỹ thuật" = `convertedById` TRÙNG người chạy import của chính lead đó (actor của dòng AuditLog `BACKFILL_IMPORT`).
//
// QUYẾT ĐỊNH TỪNG LEAD (cho lead có người chốt = người chạy import)
//
//   E1  Sale TỰ chuyển lead sang ĐÃ ĐĂNG KÝ trước lần import (`LeadStatusHistory`), người đó là Sale hợp lệ.            → đổi sang người đó.
//   E2  Ghi chú import `[Import ĐK Excel] Sales: <tên>` ∧ tên chỉ khớp ĐÚNG MỘT Sale hợp lệ ∧ người đó = `assignedToId` ∧ cùng cơ sở
//       với MỌI đơn liên quan.
//       ⚠️ `Sales:` và `assignedToId` CÙNG MỘT NGUỒN: `lib/lead/import-registered.ts` dựng cả hai từ cột «Sales» của MỘT dòng Excel (lead MỚI:
//       `assignedToId = matchSalesUser(p.salesName)`; chỉ lead đã có người được gán từ trước mới giữ `assignedToId` cũ). Hai giá trị khớp nhau
//       vì thế KHÔNG phải hai bằng chứng. E2 chỉ thành HIGH khi có BẰNG CHỨNG ĐỘC LẬP: chính người đó CÓ HÀNH ĐỘNG trên lead (hoạt động · audit ·
//       gán lead) TRƯỚC lần import; không có ⇒ `E2_MOT_NGUON` và theo CHÍNH SÁCH E2 (xem dưới).
//   Chính sách E2 một nguồn (`ChinhSachE2`, ghi vào dòng PLAN nên được ký):  GIU_XEM_TAY (mặc định) ⇒ NULL (hold, chờ đối chiếu Excel gốc);
//       DOI_MOT_NGUON ⇒ đổi sang người đó với `confidence = MEDIUM` — owner CHỦ ĐỘNG chọn sau khi đối chiếu.
//   Hai bằng chứng cùng có mà chỉ về hai người khác nhau ⇒ MÂU THUẪN. Không bằng chứng / tên trùng / người bán đã nghỉ / Excel khác người được
//   gán / sai cơ sở (chỉ với E2) ⇒ ĐƯA VỀ NULL (fail-closed): cả hai engine coi NULL là «chưa có người» (xem NULL ở dưới).
//   Có dấu vết hoa hồng đã khoá (sổ mới có dòng cho lead/đơn đó; dòng kỳ cũ APPROVED; thu của đơn đã nối nằm trong kỳ APPROVED) ⇒ KHÔNG GHI,
//   chuyển xem tay (MANUAL_REVIEW) — đổi người nhận của bảng kê đã duyệt là quyết định của chủ dự án.
//
// ⚠️ NULL CHỈ fail-closed cho TẦNG SALE. `chonSaleCuaPhuHuynh` (`sale-cua-phu-huynh.ts`) khi `convertedById` NULL lại LÙI về `assignedToId` — tức
//    "Sale phụ trách phụ huynh" suy từ người được gán, không phải một lần treo. Ghim bằng test `[SNC-NULL-*]`; báo owner.
//
// QUYẾT ĐỊNH CỦA OWNER (23/10/2026) — `sua-nguoi-chot-quyet-dinh.ts`: với 7 lead cụ thể mà bằng chứng không quyết được (3 lead «Toại» + 4 lead ngoài mẫu),
//   owner đã chọn đổi sang một Sale cụ thể hoặc giữ nguyên. Bảng đó THẮNG luật suy từ bằng chứng cho đúng các lead đó (và chỉ chúng):
//     · ĐỔI  — người nhận chọn bằng `Employee.employeeCode`, planner giải ra `User.id` từ dữ liệu; phải ra ĐÚNG MỘT người, Sale hợp lệ, cùng cơ sở ⇒ không thì INVALID
//              (cổng ghi từ chối cả lượt). Người chốt hiện tại đã là Sale hợp lệ KHÁC người nhận ⇒ XEM TAY (trạng thái đã trôi so với lúc owner quyết).
//              Đã đúng người nhận ⇒ ALREADY_CORRECT (idempotent: chạy lại sau khi ghi ⇒ 0 dòng GHI). Có dấu vết hoa hồng đã khoá ⇒ XEM TAY như mọi dòng khác.
//     · GIỮ  — ALREADY_CORRECT, không bao giờ ghi.
//   Chỉ đổi `convertedById`: KHÔNG đụng `convertedAt`, `assignedToId`, `CommissionLine`, `CommissionTransaction`.
//
// ⚠️ ALREADY_CORRECT KHÔNG phải «không có gì để nói»: người chốt KHÔNG phải người chạy import mà đã là Sale hợp lệ (ai đó sửa tay sau import), hoặc
//    chính người chạy import được file Excel gọi tên là Sale + là người được gán (ca «Toại»).
import { createHash } from "node:crypto";
import type { HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { TRANG_THAI_NGHI } from "@/lib/hoa-hong/nguoi-huong";
import type { UngVienLead } from "@/lib/nguon/noi-don";
import type { QuyetDinhOwner } from "@/lib/nguon/sua-nguoi-chot-quyet-dinh";

export const MA_LY_DO_SUA = "LEGACY_BACKFILL_CONVERTER_FIX";
/** Lời giải thích trong `reason` của audit khi dòng do OWNER quyết định (`newValues.reasonCode` VẪN là `MA_LY_DO_SUA` để dựng dòng hoàn tác dùng chung). */
export const MA_LY_DO_SUA_OWNER = "OWNER_DECISION_CONVERTER_FIX";
/** Lớp bằng chứng của dòng do owner quyết định. */
export const LOP_OWNER_DOI = "OWNER_QUYET_DINH";
export const LOP_OWNER_GIU = "OWNER_GIU_NGUYEN";
/** Tiền tố dòng đầu ra để ký. Đổi định dạng = đổi digest của mọi artifact đã ký. */
export const TIEN_TO_DONG = "sua-nguoi-chot/v1";
export const LY_DO_IMPORT = "BACKFILL_IMPORT";
export const VAI_SALE = "SALES_CSM";

export type LoaiDong = "REASSIGN" | "CLEAR" | "ALREADY_CORRECT" | "MANUAL_REVIEW" | "INVALID";
/** `OWNER` = người có thẩm quyền đã quyết định (không phải bằng chứng suy ra). */
export type DoTinCay = "HIGH" | "MEDIUM" | "NA" | "OWNER";
export type KiemCoSo = "MATCH" | "MISMATCH" | "UNKNOWN" | "NA";

export type HangLead = {
  id: string;
  convertedById: string | null;
  assignedToId: string | null;
  centerId: string | null;
  note: string | null;
  convertedAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

/** Một dòng AuditLog `BACKFILL_IMPORT` của lead (module `enrollment`, `STATUS_CHANGE`). */
export type HangImport = { leadId: string; actorId: string | null; luc: Date };

export type HangLichSu = { id: string; leadId: string; changedById: string | null; toStatus: string; luc: Date };

export type HangNguoiDung = {
  id: string;
  name: string;
  /** `User.role` ∪ `User.roles`. */
  vaiTro: readonly string[];
  centerId: string | null;
  hoatDong: boolean;
  daXoa: boolean;
  /** `Employee.status` của nhân sự gắn tài khoản (nếu có). */
  trangThaiNhanSu: string | null;
  /** `Employee.employeeCode` của nhân sự gắn tài khoản — khoá nghiệp vụ để owner chọn người nhận (xem `sua-nguoi-chot-quyet-dinh.ts`). */
  maNhanVien: string | null;
};

/** Đơn liên quan của một lead: đã nối, hoặc sắp nối theo `noi-don` (MOT). */
export type DonLienQuan = {
  orderId: string;
  code: string;
  centerId: string | null;
  leadId: string;
  duong: "DA_NOI" | "NOI_DON_MOT";
  /** Σ khoản thực thu (CONFIRMED + REFUNDED, dòng hoàn là số âm). */
  thuTong: number;
  /** Kỳ hoa hồng (giờ VN) của từng khoản thực thu. */
  ky: readonly string[];
};

export type KhoaCommission = {
  /** Lead có dòng ở SỔ MỚI (`CommissionTransaction.leadId`, hoặc `orderId` của đơn liên quan). */
  leadCoSoMoi: ReadonlySet<string>;
  /** Lead có `CommissionLine` thuộc bảng kê ĐÃ DUYỆT. */
  leadCoDongKyDaDuyet: ReadonlySet<string>;
  /** Các kỳ có bảng kê APPROVED. */
  kyDaDuyet: ReadonlySet<string>;
};

/**
 * Một dấu vết cho thấy `nguoi` ĐÃ LÀM GÌ ĐÓ với lead — nguồn ĐỘC LẬP với file Excel: hoạt động / audit do chính họ thực hiện, hoặc một lần gán lead
 * (lịch sử bàn giao · nhật ký chia) trỏ về họ. Công cụ import không ghi được hàng nào mà `nguoi` là Sale (nó chạy bằng tài khoản người chạy import).
 */
export type HangHanhDong = { leadId: string; nguoi: string; luc: Date; loai: "HOAT_DONG" | "AUDIT" | "GAN_LICH_SU" | "GAN_NHAT_KY" };

/** Cách xử lý E2 một nguồn. BẮT BUỘC khai (luật 7) — không có mặc định ngầm. */
export type ChinhSachE2 = "GIU_XEM_TAY" | "DOI_MOT_NGUON";
export const CHINH_SACH_E2: readonly ChinhSachE2[] = ["GIU_XEM_TAY", "DOI_MOT_NGUON"];

export type DauVaoKeHoach = {
  leads: readonly HangLead[];
  imports: readonly HangImport[];
  lichSu: readonly HangLichSu[];
  hanhDong: readonly HangHanhDong[];
  /** Lead KHÔNG có dòng BACKFILL_IMPORT nhưng do một tài khoản người-chạy-import chốt — chỉ để xếp «ngoài mẫu» (xem tay), không bao giờ ghi. */
  leadNgoaiMau: readonly HangLead[];
  nguoiDung: readonly HangNguoiDung[];
  don: readonly DonLienQuan[];
  khoa: KhoaCommission;
  /** Quyết định của owner cho từng lead — BẮT BUỘC khai (luật 7); `[]` = không có quyết định nào. */
  quyetDinhOwner: readonly QuyetDinhOwner[];
  /** Hàng `Lead` của MỌI lead trong `quyetDinhOwner` (đọc theo id, không phụ thuộc lead nằm ở nhóm nào). Thiếu hàng ⇒ dòng INVALID. */
  leadQuyetDinh: readonly HangLead[];
};

export type DongKeHoach = {
  leadId: string;
  oldConvertedById: string | null;
  newConvertedById: string | null;
  loai: LoaiDong;
  reasonCode: string;
  evidenceClass: string;
  confidence: DoTinCay;
  sourceActor: string;
  saleEvidence: string;
  campusCheck: KiemCoSo;
  /** Chỉ để báo cáo — KHÔNG vào dòng ký. */
  soDon: number;
  thuTong: number;
};

export type DongBoQua = { leadId: string; reasonCode: "KHONG_CO_DON_LIEN_QUAN" | "LEAD_DA_XOA" };

export type TomTat = {
  tongPhamVi: number;
  daDung: number;
  seDoi: number;
  seXoaVeXemTay: number;
  xemTay: number;
  khongHopLe: number;
  boQua: number;
  /** Trong `xemTay`: lead chốt bởi tài khoản người-chạy-import nhưng KHÔNG qua BACKFILL_IMPORT. */
  ngoaiMau: number;
  /** E2 (Excel «Sales») trên lead chưa có E1: tổng · có bằng chứng độc lập · chỉ một nguồn · mơ hồ/loại. */
  e2Tong: number;
  e2DocLap: number;
  e2MotNguon: number;
  e2MoHo: number;
  /** Dòng do OWNER quyết định: đổi người chốt · giữ nguyên. */
  ownerDoi: number;
  ownerGiu: number;
};

export type KeHoachSuaNguoiChot = {
  /** Dòng TRONG phạm vi, sắp theo leadId. */
  dong: DongKeHoach[];
  boQua: DongBoQua[];
  tom: TomTat;
  /** sha256 của MỌI dòng trong phạm vi (kể cả dòng xem tay / đã đúng) — ràng chữ ký vào phân loại. */
  sha: string;
  soGhi: number;
  soXemTay: number;
  /** Dòng owner KÝ: dòng PLAN + dòng GHI (REASSIGN/CLEAR). Cùng một hàm dựng cho chạy thử và lõi ghi. */
  dongDauRa: string[];
  chinhSachE2: ChinhSachE2;
};

// ─── Chuẩn hoá tên ────────────────────────────────────────────────────────────────────────

/** NFC + gọn khoảng trắng + chữ thường. Excel hay mang NFD; so sánh không chuẩn hoá là «Liên» ≠ «Liên». */
export function chuanHoaTen(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Tên gọi = từ cuối của họ tên. */
export function tenGoi(hoTen: string): string {
  const p = chuanHoaTen(hoTen).split(" ");
  return p[p.length - 1] ?? "";
}

const RE_SALES = /\[Import ĐK Excel\][ \t]*Sales:[ \t]*([^·\n]+)/g;

/** Các tên Sale (đã chuẩn hoá, không trùng) trong ghi chú import. Rỗng = không có dòng Sales. */
export function docTenSaleTuGhiChu(note: string | null): string[] {
  if (note === null || note === "") return [];
  const ra = new Set<string>();
  for (const m of note.normalize("NFC").matchAll(RE_SALES)) {
    const t = chuanHoaTen(m[1] ?? "");
    if (t !== "") ra.add(t);
  }
  return [...ra].sort();
}

/** Sale HỢP LỆ để nhận hoa hồng: có vai SALES_CSM, đang hoạt động, chưa xoá, nhân sự chưa nghỉ (cùng `TRANG_THAI_NGHI` với engine). */
export function laSaleHopLe(u: HangNguoiDung | undefined): u is HangNguoiDung {
  return u !== undefined && u.hoatDong && !u.daXoa && u.vaiTro.includes(VAI_SALE) && !TRANG_THAI_NGHI.has(u.trangThaiNhanSu ?? "");
}

/** Người dùng còn dùng được (không đòi vai Sale) — cho ca «người import được Excel gọi tên». */
function conHoatDong(u: HangNguoiDung | undefined): u is HangNguoiDung {
  return u !== undefined && u.hoatDong && !u.daXoa && !TRANG_THAI_NGHI.has(u.trangThaiNhanSu ?? "");
}

type KetQuaE2 =
  | { loai: "KHOP"; user: HangNguoiDung; ten: string }
  | { loai: "KHAC_NGUOI_DUOC_GAN"; user: HangNguoiDung; ten: string }
  | { loai: "TRUNG_TEN" | "NGUOI_BAN_DA_NGHI" | "KHONG_KHOP_NHAN_SU" | "MAU_THUAN_TEN" | "KHONG_CO"; ten: string };

function danhGiaE2(lead: HangLead, nguoiDung: readonly HangNguoiDung[]): KetQuaE2 {
  const ten = docTenSaleTuGhiChu(lead.note);
  if (ten.length === 0) return { loai: "KHONG_CO", ten: "-" };
  if (ten.length > 1) return { loai: "MAU_THUAN_TEN", ten: ten.join("/") };
  const t = ten[0]!;
  const khop = nguoiDung.filter((u) => u.vaiTro.includes(VAI_SALE) && (tenGoi(u.name) === t || chuanHoaTen(u.name) === t));
  const hopLe = khop.filter(laSaleHopLe);
  if (hopLe.length === 1) {
    const u = hopLe[0]!;
    return u.id === lead.assignedToId ? { loai: "KHOP", user: u, ten: t } : { loai: "KHAC_NGUOI_DUOC_GAN", user: u, ten: t };
  }
  if (hopLe.length > 1) return { loai: "TRUNG_TEN", ten: t };
  return { loai: khop.length > 0 ? "NGUOI_BAN_DA_NGHI" : "KHONG_KHOP_NHAN_SU", ten: t };
}

const LY_DO_XOA_THEO_E2: Record<Exclude<KetQuaE2["loai"], "KHOP">, string> = {
  KHAC_NGUOI_DUOC_GAN: "EXCEL_KHAC_NGUOI_DUOC_GAN",
  TRUNG_TEN: "TRUNG_TEN_NHAN_SU",
  NGUOI_BAN_DA_NGHI: "NGUOI_BAN_DA_NGHI",
  KHONG_KHOP_NHAN_SU: "EXCEL_KHONG_KHOP_NHAN_SU",
  MAU_THUAN_TEN: "EXCEL_NHIEU_TEN_KHAC_NHAU",
  KHONG_CO: "KHONG_CO_BANG_CHUNG",
};

/** Tên an toàn cho một trường của dòng đầu ra (không `|`, không xuống dòng, không khoảng trắng). */
const trong = (s: string) => s.replace(/[|\s]+/g, "_");

// ─── Dòng đầu ra ──────────────────────────────────────────────────────────────────────────

/** MỘT dòng cho mỗi lead trong phạm vi. Chỉ id/mã/tên gọi nhân viên — không tên khách, SĐT, email. */
export function dongKeHoachChuoi(d: DongKeHoach): string {
  return [
    TIEN_TO_DONG,
    d.loai,
    d.leadId,
    d.oldConvertedById ?? "NULL",
    d.newConvertedById ?? "NULL",
    d.reasonCode,
    d.evidenceClass,
    d.confidence,
    d.sourceActor,
    trong(d.saleEvidence),
    d.campusCheck,
  ].join("|");
}

export const laDongGhi = (d: DongKeHoach) => d.loai === "REASSIGN" || d.loai === "CLEAR";

/**
 * Dòng owner KÝ. Dòng đầu là `PLAN` mang sha của TOÀN KẾ HOẠCH + các số đếm — nhờ vậy chữ ký phủ cả phân loại (xem tay / đã đúng), không chỉ dòng
 * ghi; `--ke-hoach-sha` và `--expect-review` chỉ là phép so thêm. Sau đó là các dòng GHI theo leadId.
 */
export function dongDauRaSuaNguoiChot(dong: readonly DongKeHoach[], sha: string, chinhSachE2: ChinhSachE2): string[] {
  const ghi = dong.filter(laDongGhi).map(dongKeHoachChuoi);
  const xemTay = dong.filter((d) => d.loai === "MANUAL_REVIEW").length;
  const khongHopLe = dong.filter((d) => d.loai === "INVALID").length;
  return [`${TIEN_TO_DONG}|PLAN|${sha}|scope=${dong.length}|write=${ghi.length}|review=${xemTay}|invalid=${khongHopLe}|e2=${chinhSachE2}`, ...ghi];
}

export function shaKeHoach(dong: readonly DongKeHoach[]): string {
  return createHash("sha256").update(dong.map(dongKeHoachChuoi).join("\n"), "utf8").digest("hex");
}

// ─── Lập kế hoạch ─────────────────────────────────────────────────────────────────────────

function kiemCoSo(t: HangNguoiDung, don: readonly DonLienQuan[]): KiemCoSo {
  const coSo = new Set(don.map((d) => d.centerId).filter((c): c is string => c !== null));
  if (coSo.size === 0 || t.centerId === null) return "UNKNOWN";
  return [...coSo].every((c) => c === t.centerId) ? "MATCH" : "MISMATCH";
}

/** Lý do khoá (rỗng = không khoá) cho lead sắp bị GHI. */
export function lyDoKhoa(leadId: string, don: readonly DonLienQuan[], khoa: KhoaCommission): string[] {
  const ra: string[] = [];
  if (khoa.leadCoSoMoi.has(leadId)) ra.push("SO_MOI");
  if (khoa.leadCoDongKyDaDuyet.has(leadId)) ra.push("DONG_KY_DA_DUYET");
  if (don.some((d) => d.duong === "DA_NOI" && d.ky.some((k) => khoa.kyDaDuyet.has(k)))) ra.push("THU_TRONG_KY_DA_DUYET");
  return ra;
}

export function lapKeHoachSuaNguoiChot(i: DauVaoKeHoach, chinhSachE2: ChinhSachE2): KeHoachSuaNguoiChot {
  if (!CHINH_SACH_E2.includes(chinhSachE2)) throw new Error(`chinhSachE2 «${String(chinhSachE2)}» không thuộc {${CHINH_SACH_E2.join(", ")}}`);
  const nd = new Map(i.nguoiDung.map((u) => [u.id, u] as const));
  const hanhDongTheoLead = new Map<string, HangHanhDong[]>();
  for (const h of i.hanhDong) hanhDongTheoLead.set(h.leadId, [...(hanhDongTheoLead.get(h.leadId) ?? []), h]);
  const importTheoLead = new Map<string, HangImport[]>();
  for (const x of i.imports) importTheoLead.set(x.leadId, [...(importTheoLead.get(x.leadId) ?? []), x]);
  const lichSuTheoLead = new Map<string, HangLichSu[]>();
  for (const h of i.lichSu) lichSuTheoLead.set(h.leadId, [...(lichSuTheoLead.get(h.leadId) ?? []), h]);
  const donTheoLead = new Map<string, DonLienQuan[]>();
  for (const d of i.don) donTheoLead.set(d.leadId, [...(donTheoLead.get(d.leadId) ?? []), d]);
  const leadTheoId = new Map(i.leads.map((l) => [l.id, l] as const));
  // Quyết định OWNER: mỗi lead tối đa MỘT quyết định — trùng là lỗi bảng, KHÔNG chọn bừa một cái.
  const quyetDinhTheoLead = new Map<string, QuyetDinhOwner>();
  for (const q of i.quyetDinhOwner) {
    if (q.leadId === "") throw new Error("quyetDinhOwner: leadId rỗng.");
    if (quyetDinhTheoLead.has(q.leadId)) throw new Error(`quyetDinhOwner: lead ${q.leadId} có hơn một quyết định.`);
    quyetDinhTheoLead.set(q.leadId, q);
  }
  const leadQuyetDinhTheoId = new Map(i.leadQuyetDinh.map((l) => [l.id, l] as const));

  const dong: DongKeHoach[] = [];
  const boQua: DongBoQua[] = [];

  // Duyệt theo leadId tăng dần ⇒ kết quả KHÔNG phụ thuộc thứ tự đầu vào (digest tất định).
  const idCanXet = [...importTheoLead.keys()].sort();
  for (const id of idCanXet) {
    if (quyetDinhTheoLead.has(id)) continue; // owner đã quyết ⇒ xử lý ở khối quyết định bên dưới, không suy lại
    const lead = leadTheoId.get(id);
    if (lead === undefined || lead.deletedAt !== null) {
      boQua.push({ leadId: id, reasonCode: "LEAD_DA_XOA" });
      continue;
    }
    const don = [...(donTheoLead.get(id) ?? [])].sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
    if (don.length === 0) {
      boQua.push({ leadId: id, reasonCode: "KHONG_CO_DON_LIEN_QUAN" });
      continue;
    }
    dong.push(
      danhGiaLead({ lead, imports: importTheoLead.get(id) ?? [], lichSu: lichSuTheoLead.get(id) ?? [], hanhDong: hanhDongTheoLead.get(id) ?? [], don, nd, khoa: i.khoa, chinhSachE2 }),
    );
  }

  // «Ngoài mẫu»: lead KHÔNG qua BACKFILL_IMPORT mà do một tài khoản người-chạy-import chốt. Có thể là cùng họ lỗi (người quản trị nhập hộ) hoặc là
  // luồng thiết kế (người bấm convert = người chốt, B5/OI-26) — dữ liệu không phân biệt được ⇒ XEM TAY, KHÔNG ghi. Phạm vi suy từ bằng chứng.
  const taiKhoanImport = new Set(i.imports.map((x) => x.actorId).filter((x): x is string => x !== null));
  for (const l of [...i.leadNgoaiMau].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (importTheoLead.has(l.id) || quyetDinhTheoLead.has(l.id) || l.deletedAt !== null || l.convertedById === null || !taiKhoanImport.has(l.convertedById)) continue;
    const donL = donTheoLead.get(l.id) ?? [];
    if (donL.length === 0) {
      boQua.push({ leadId: l.id, reasonCode: "KHONG_CO_DON_LIEN_QUAN" });
      continue;
    }
    dong.push({
      leadId: l.id,
      oldConvertedById: l.convertedById,
      newConvertedById: l.convertedById,
      loai: "MANUAL_REVIEW",
      reasonCode: "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT",
      evidenceClass: "KHONG_QUA_BACKFILL_IMPORT",
      confidence: "NA",
      sourceActor: l.convertedById,
      saleEvidence: "-",
      campusCheck: "NA",
      soDon: donL.length,
      thuTong: donL.reduce((s, d) => s + d.thuTong, 0),
    });
  }

  // Quyết định OWNER — theo leadId tăng dần. Lead được quyết LUÔN có dòng (kể cả khi không đơn): thiếu hàng/xoá ⇒ INVALID, không im lặng bỏ qua.
  for (const q of [...quyetDinhTheoLead.values()].sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0))) {
    const donQ = [...(donTheoLead.get(q.leadId) ?? [])].sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));
    dong.push(danhGiaQuyetDinh({ q, lead: leadQuyetDinhTheoId.get(q.leadId), imports: importTheoLead.get(q.leadId) ?? [], don: donQ, nd, khoa: i.khoa }));
  }

  dong.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));
  boQua.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));
  const dem = (l: LoaiDong) => dong.filter((d) => d.loai === l).length;
  const sha = shaKeHoach(dong);
  return {
    dong,
    boQua,
    tom: {
      tongPhamVi: dong.length,
      daDung: dem("ALREADY_CORRECT"),
      seDoi: dem("REASSIGN"),
      seXoaVeXemTay: dem("CLEAR"),
      xemTay: dem("MANUAL_REVIEW"),
      khongHopLe: dem("INVALID"),
      boQua: boQua.length,
      ngoaiMau: dong.filter((d) => d.reasonCode === "NGOAI_MAU_NGUOI_CHOT_LA_TAI_KHOAN_IMPORT").length,
      ...demE2(dong),
      ownerDoi: dong.filter((d) => d.loai === "REASSIGN" && d.evidenceClass === LOP_OWNER_DOI).length,
      ownerGiu: dong.filter((d) => d.evidenceClass === LOP_OWNER_GIU).length,
    },
    sha,
    soGhi: dong.filter(laDongGhi).length,
    soXemTay: dem("MANUAL_REVIEW"),
    dongDauRa: dongDauRaSuaNguoiChot(dong, sha, chinhSachE2),
    chinhSachE2,
  };
}

/** Tên người nhận quyết định → các tài khoản mang mã nhân viên đó (0, 1 hay nhiều). */
function nguoiTheoMaNhanVien(ma: string, nguoiDung: readonly HangNguoiDung[]): HangNguoiDung[] {
  return ma === "" ? [] : nguoiDung.filter((u) => u.maNhanVien === ma);
}

function kiemCoSoQuyetDinh(t: HangNguoiDung, lead: HangLead, don: readonly DonLienQuan[]): KiemCoSo {
  const coSo = new Set([...don.map((d) => d.centerId), lead.centerId].filter((c): c is string => c !== null));
  if (coSo.size === 0 || t.centerId === null) return "UNKNOWN";
  return [...coSo].every((c) => c === t.centerId) ? "MATCH" : "MISMATCH";
}

/**
 * MỘT dòng cho một quyết định của owner. Thứ tự kiểm (lỗi đầu tiên thắng): lead có hàng · chưa xoá · người chốt hiện tại không phải id treo ·
 * (GIỮ ⇒ xong) · người nhận giải ra ĐÚNG MỘT tài khoản · là Sale hợp lệ · cùng cơ sở với lead và MỌI đơn · đã đúng người nhận ⇒ không ghi ·
 * người chốt hiện tại là Sale hợp lệ KHÁC ⇒ xem tay · dấu vết hoa hồng đã khoá ⇒ xem tay · còn lại ⇒ REASSIGN.
 */
function danhGiaQuyetDinh(p: {
  q: QuyetDinhOwner;
  lead: HangLead | undefined;
  imports: readonly HangImport[];
  don: readonly DonLienQuan[];
  nd: ReadonlyMap<string, HangNguoiDung>;
  khoa: KhoaCommission;
}): DongKeHoach {
  const { q, lead, don, nd } = p;
  const cu = lead?.convertedById ?? null;
  const nguoiImport = [...new Set(p.imports.map((x) => x.actorId).filter((x): x is string => x !== null))].sort();
  const lop = q.hanhDong === "GIU_NGUYEN" ? LOP_OWNER_GIU : LOP_OWNER_DOI;
  const maNhan = q.hanhDong === "DOI_NGUOI_CHOT" ? q.nguoiNhan.maNhanVien : "-";

  const dongCo = (loai: LoaiDong, reasonCode: string, o: { moi?: string | null; saleEvidence?: string; campusCheck?: KiemCoSo; confidence?: DoTinCay } = {}): DongKeHoach => ({
    leadId: q.leadId,
    oldConvertedById: cu,
    newConvertedById: o.moi === undefined ? cu : o.moi,
    loai,
    reasonCode,
    evidenceClass: lop,
    confidence: o.confidence ?? "NA",
    sourceActor: nguoiImport.length > 0 ? nguoiImport.join("+") : "-",
    saleEvidence: o.saleEvidence ?? `OWNER:${maNhan}`,
    campusCheck: o.campusCheck ?? "NA",
    soDon: don.length,
    thuTong: don.reduce((s, d) => s + d.thuTong, 0),
  });

  if (lead === undefined) return dongCo("INVALID", "QUYET_DINH_LEAD_KHONG_TON_TAI");
  if (lead.deletedAt !== null) return dongCo("INVALID", "QUYET_DINH_LEAD_DA_XOA");
  if (q.hanhDong === "GIU_NGUYEN") return dongCo("ALREADY_CORRECT", "OWNER_QUYET_DINH_GIU_NGUYEN", { confidence: "OWNER" });

  if (cu !== null && !nd.has(cu)) return dongCo("INVALID", "NGUOI_CHOT_KHONG_TON_TAI");
  const nhan = nguoiTheoMaNhanVien(maNhan, [...nd.values()]);
  if (nhan.length !== 1) return dongCo("INVALID", "QUYET_DINH_NGUOI_NHAN_KHONG_GIAI_QUYET_DUOC_DUY_NHAT", { saleEvidence: `OWNER:${maNhan};KHOP:${nhan.length}` });
  const dich = nhan[0]!;
  const idDich = dich.id; // `laSaleHopLe` là type guard: ở nhánh sai `dich` bị thu hẹp thành `never`
  if (!laSaleHopLe(dich)) return dongCo("INVALID", "QUYET_DINH_NGUOI_NHAN_KHONG_PHAI_SALE_HOP_LE", { saleEvidence: `OWNER:${maNhan};UNG_VIEN:${idDich}` });
  const campusCheck = kiemCoSoQuyetDinh(dich, lead, don);
  if (campusCheck !== "MATCH") {
    return dongCo("INVALID", campusCheck === "MISMATCH" ? "QUYET_DINH_SAI_CO_SO" : "QUYET_DINH_KHONG_RO_CO_SO", { saleEvidence: `OWNER:${maNhan};UNG_VIEN:${dich.id}`, campusCheck });
  }
  const saleEvidence = `OWNER:${maNhan};UNG_VIEN:${dich.id}`;
  if (cu === dich.id) return dongCo("ALREADY_CORRECT", "OWNER_QUYET_DINH_DA_AP_DUNG", { saleEvidence, campusCheck, confidence: "OWNER" });

  const uCu = cu === null ? undefined : nd.get(cu);
  if (uCu !== undefined && laSaleHopLe(uCu)) {
    // Owner quyết khi người chốt còn là tài khoản quản trị/kỹ thuật; nay đã là một Sale thật khác ⇒ có người đã sửa SAU quyết định — không ghi đè.
    return dongCo("MANUAL_REVIEW", "QUYET_DINH_NGUOI_CHOT_DA_DOI_SANG_SALE_KHAC", { saleEvidence, campusCheck });
  }
  const khoa = lyDoKhoa(lead.id, don, p.khoa);
  if (khoa.length > 0) return dongCo("MANUAL_REVIEW", `COMMISSION_DA_KHOA_${khoa.join("_")}`, { saleEvidence, campusCheck });
  return dongCo("REASSIGN", "OWNER_QUYET_DINH_DOI_NGUOI_CHOT", { moi: dich.id, saleEvidence, campusCheck, confidence: "OWNER" });
}

export const LOP_E2_DOC_LAP = "E2_EXCEL_SALES_VA_BANG_CHUNG_DOC_LAP";
export const LOP_E2_MOT_NGUON = "E2_MOT_NGUON";

/** Đếm E2 theo LỚP BẰNG CHỨNG của dòng (không đếm ca «Toại» đã đúng và không đếm lead đã được E1 quyết). */
export function demE2(dong: readonly DongKeHoach[]): Pick<TomTat, "e2Tong" | "e2DocLap" | "e2MotNguon" | "e2MoHo"> {
  const e2 = dong.filter((d) => d.loai !== "ALREADY_CORRECT" && d.evidenceClass.startsWith("E2_"));
  const docLap = e2.filter((d) => d.evidenceClass === LOP_E2_DOC_LAP).length;
  const motNguon = e2.filter((d) => d.evidenceClass === LOP_E2_MOT_NGUON).length;
  return { e2Tong: e2.length, e2DocLap: docLap, e2MotNguon: motNguon, e2MoHo: e2.length - docLap - motNguon };
}

function danhGiaLead(p: {
  lead: HangLead;
  imports: readonly HangImport[];
  lichSu: readonly HangLichSu[];
  hanhDong: readonly HangHanhDong[];
  don: readonly DonLienQuan[];
  nd: ReadonlyMap<string, HangNguoiDung>;
  khoa: KhoaCommission;
  chinhSachE2: ChinhSachE2;
}): DongKeHoach {
  const { lead, don, nd } = p;
  const nguoiImport = [...new Set(p.imports.map((x) => x.actorId).filter((x): x is string => x !== null))].sort();
  const sourceActor = nguoiImport.length > 0 ? nguoiImport.join("+") : "-";
  const tImport = Math.min(...p.imports.map((x) => x.luc.getTime()));
  const cu = lead.convertedById;
  const soDon = don.length;
  const thuTong = don.reduce((s, d) => s + d.thuTong, 0);

  const dongCo = (
    loai: LoaiDong,
    reasonCode: string,
    o: { moi?: string | null; evidenceClass: string; confidence?: DoTinCay; saleEvidence?: string; campusCheck?: KiemCoSo },
  ): DongKeHoach => ({
    leadId: lead.id,
    oldConvertedById: cu,
    newConvertedById: o.moi === undefined ? cu : o.moi,
    loai,
    reasonCode,
    evidenceClass: o.evidenceClass,
    confidence: o.confidence ?? "NA",
    sourceActor,
    saleEvidence: o.saleEvidence ?? "-",
    campusCheck: o.campusCheck ?? "NA",
    soDon,
    thuTong,
  });

  // 1) Đã bỏ trống: đã fail-closed, không có gì để ghi.
  if (cu === null) return dongCo("ALREADY_CORRECT", "DA_BO_TRONG_FAIL_CLOSED", { evidenceClass: "NULL" });

  // 2) Người chốt không tồn tại (id treo) — dữ liệu hỏng, KHÔNG đoán.
  const uCu = nd.get(cu);
  if (uCu === undefined) return dongCo("INVALID", "NGUOI_CHOT_KHONG_TON_TAI", { evidenceClass: "ID_TREO" });

  // 3) Người chốt KHÔNG phải người chạy import ⇒ không thuộc mẫu lỗi này.
  if (!nguoiImport.includes(cu)) {
    return laSaleHopLe(uCu)
      ? dongCo("ALREADY_CORRECT", "NGUOI_CHOT_LA_SALE_HOP_LE", { evidenceClass: "KHAC_NGUOI_IMPORT" })
      : dongCo("MANUAL_REVIEW", "NGUOI_CHOT_KHAC_NGUOI_IMPORT_KHONG_PHAI_SALE_HOP_LE", { evidenceClass: "KHAC_NGUOI_IMPORT" });
  }

  // 4) Người chốt = người chạy import. Gom bằng chứng.
  // E1: Sale hợp lệ (khác người import) TỰ chuyển sang ĐÃ ĐĂNG KÝ không muộn hơn lần import đầu.
  const e1Id = [
    ...new Set(
      p.lichSu
        .filter((h) => h.toStatus === "DA_DANG_KY" && h.changedById !== null && h.luc.getTime() <= tImport && !nguoiImport.includes(h.changedById))
        .map((h) => h.changedById as string)
        .filter((id) => laSaleHopLe(nd.get(id))),
    ),
  ].sort();
  const e2 = danhGiaE2(lead, [...nd.values()]);

  // Ca «Toại»: chính người import được Excel gọi tên là Sale + là người được gán ⇒ có bằng chứng ủng hộ, không đổi.
  if (e1Id.length === 0 && conHoatDong(uCu) && lead.assignedToId === cu) {
    const ten = docTenSaleTuGhiChu(lead.note);
    if (ten.length === 1 && ten[0] === tenGoi(uCu.name)) {
      return dongCo("ALREADY_CORRECT", "EXCEL_SALES_TRUNG_NGUOI_CHOT", { evidenceClass: "E2_EXCEL_GOI_TEN_NGUOI_CHOT", confidence: "MEDIUM", saleEvidence: `EXCEL:${ten[0]}` });
    }
  }

  let dich: HangNguoiDung | null = null;
  let evidenceClass: string;
  let saleEvidence = e2.loai === "KHONG_CO" ? "-" : `EXCEL:${e2.ten}`;
  let lyDoXoa: string | null = null;

  if (e1Id.length > 1) {
    lyDoXoa = "E1_NHIEU_NGUOI_CHUYEN_TRANG_THAI";
    evidenceClass = "E1_MAU_THUAN";
  } else {
    const u1 = e1Id.length === 1 ? nd.get(e1Id[0]!)! : null;
    const u2 = e2.loai === "KHOP" || e2.loai === "KHAC_NGUOI_DUOC_GAN" ? e2.user : null;
    if (u1 !== null && u2 !== null && u1.id !== u2.id) {
      lyDoXoa = "BANG_CHUNG_MAU_THUAN";
      evidenceClass = "E1_E2_MAU_THUAN";
      saleEvidence = `LSH:${u1.id}+EXCEL:${e2.ten}`;
    } else if (u1 !== null) {
      dich = u1;
      const dongThuan = u2 !== null;
      evidenceClass = dongThuan ? "E1_E2_DONG_THUAN" : "E1_SALE_TU_CHUYEN_TRANG_THAI";
      saleEvidence = dongThuan ? `LSH:${u1.id}+EXCEL:${e2.ten}` : `LSH:${u1.id}`;
    } else if (e2.loai === "KHOP") {
      // `Sales:` và `assignedToId` cùng một nguồn (xem đầu tệp) ⇒ cần bằng chứng ĐỘC LẬP: chính người đó có hành động trên lead TRƯỚC import.
      const doc = p.hanhDong.filter((h) => h.nguoi === e2.user.id && h.luc.getTime() <= tImport);
      if (doc.length > 0) {
        dich = e2.user;
        evidenceClass = LOP_E2_DOC_LAP;
        const loaiDoc = [...new Set(doc.map((h) => h.loai))].sort().join("/");
        saleEvidence = `EXCEL:${e2.ten}+DOC_LAP:${loaiDoc}`;
      } else if (p.chinhSachE2 === "DOI_MOT_NGUON") {
        dich = e2.user;
        evidenceClass = LOP_E2_MOT_NGUON;
      } else {
        lyDoXoa = "E2_MOT_NGUON_CHO_DOI_CHIEU";
        evidenceClass = LOP_E2_MOT_NGUON;
        saleEvidence = `EXCEL:${e2.ten};UNG_VIEN:${e2.user.id}`;
      }
    } else {
      lyDoXoa = LY_DO_XOA_THEO_E2[e2.loai];
      evidenceClass = e2.loai === "KHONG_CO" ? "KHONG_BANG_CHUNG" : `E2_${e2.loai}`;
    }
  }

  // 5) Cơ sở: E2 đứng một mình đòi KHỚP; E1 (Sale tự bấm) là bằng chứng độc lập mạnh nên cho qua nhưng vẫn ghi lại.
  let campusCheck: KiemCoSo = "NA";
  if (dich !== null) {
    campusCheck = kiemCoSo(dich, don);
    if (evidenceClass.startsWith("E2_") && campusCheck !== "MATCH") {
      lyDoXoa = campusCheck === "MISMATCH" ? "SAI_CO_SO" : "KHONG_RO_CO_SO";
      evidenceClass = "E2_SAI_CO_SO";
      dich = null;
    }
  }

  if (dich !== null && dich.id === cu) {
    return dongCo("ALREADY_CORRECT", "NGUOI_CHOT_DA_DUNG", { evidenceClass, confidence: "HIGH", saleEvidence, campusCheck });
  }

  const loai: LoaiDong = dich !== null ? "REASSIGN" : "CLEAR";
  const moi = dich !== null ? dich.id : null;

  // CLEAR chỉ giữ được «người chốt chưa xác định» khi `convertedAt` còn đó: các đường suy người (`chonSaleCuaPhuHuynh`) chỉ lùi về `assignedToId`
  // với lead CHƯA TỪNG chuyển đổi (`convertedAt = NULL`). Lead mất cả hai ⇒ trở lại đúng đường lùi cũ ⇒ KHÔNG ghi, chuyển xem tay.
  if (loai === "CLEAR" && lead.convertedAt === null) {
    return dongCo("MANUAL_REVIEW", "CLEAR_KHONG_GIU_DUOC_VI_CONVERTEDAT_NULL", { evidenceClass, saleEvidence, campusCheck });
  }
  const reasonCode = dich !== null ? "IMPORT_CONVERTER_THAY_BANG_SALE_THAT" : (lyDoXoa ?? "KHONG_CO_BANG_CHUNG");

  // 6) Dấu vết hoa hồng đã khoá ⇒ không ghi.
  const khoa = lyDoKhoa(lead.id, don, p.khoa);
  if (khoa.length > 0) {
    return dongCo("MANUAL_REVIEW", `COMMISSION_DA_KHOA_${khoa.join("_")}`, { evidenceClass, saleEvidence, campusCheck });
  }

  const confidence: DoTinCay = dich === null ? "NA" : evidenceClass === LOP_E2_MOT_NGUON ? "MEDIUM" : "HIGH";
  return dongCo(loai, reasonCode, { moi, evidenceClass, confidence, saleEvidence, campusCheck });
}

// ─── Cổng ghi ─────────────────────────────────────────────────────────────────────────────

/** Số nguyên không âm từ `--<ten>=<N>`: `null` = không truyền; `NaN` = truyền nhưng KHÔNG phải chuỗi chữ số thập phân thuần. */
export function phanTichSoNguyen(argv: readonly string[], ten: string): number | null {
  const tien = `--${ten}=`;
  const a = argv.find((x) => x.startsWith(tien));
  if (a === undefined) return null;
  const raw = a.slice(tien.length);
  if (!/^[0-9]+$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : Number.NaN;
}

/**
 * `--e2-mot-nguon=giu|doi`. Không truyền ⇒ `GIU_XEM_TAY` (fail-closed). Giá trị lạ ⇒ `null` (script dừng, không đoán).
 * Chính sách đi vào dòng PLAN nên được ký: chạy thử với `doi` thì cũng phải ghi với `doi`, không thì sha lệch.
 */
export function phanTichChinhSachE2(argv: readonly string[]): ChinhSachE2 | null {
  const a = argv.find((x) => x.startsWith("--e2-mot-nguon="));
  if (a === undefined) return "GIU_XEM_TAY";
  if (a === "--e2-mot-nguon=doi") return "DOI_MOT_NGUON";
  if (a === "--e2-mot-nguon=giu") return "GIU_XEM_TAY";
  return null;
}

/** `--ke-hoach-sha=<64 hex>`; `null` = không truyền; `""` = truyền nhưng sai khuôn. */
export function phanTichKeHoachSha(argv: readonly string[]): string | null {
  const a = argv.find((x) => x.startsWith("--ke-hoach-sha="));
  if (a === undefined) return null;
  const raw = a.slice("--ke-hoach-sha=".length).trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(raw) ? raw : "";
}

/**
 * Cổng ghi — gọi HAI lần: trước transaction (báo sớm) và TRONG transaction (chặn thật). Lỗi đầu tiên theo thứ tự dưới đây thắng.
 * Kế hoạch có dòng INVALID ⇒ KHÔNG ghi (dữ liệu hỏng thì không đoán).
 */
export function quyetDinhGhiSuaNguoiChot(i: {
  soDuyet: number | null;
  soDuyetXemTay: number | null;
  keHoachSha: string | null;
  kh: Pick<KeHoachSuaNguoiChot, "soGhi" | "soXemTay" | "sha" | "tom">;
  ghiDuoc: boolean | null;
}): { ok: true } | { ok: false; loi: string } {
  const { soDuyet, soDuyetXemTay, keHoachSha, kh } = i;
  if (soDuyet === null || !Number.isInteger(soDuyet) || soDuyet < 0) {
    return { ok: false, loi: "`--ghi` phải đi kèm `--expect=<N>` (N = số dòng GHI của bản chạy thử đã duyệt)." };
  }
  if (soDuyetXemTay === null || !Number.isInteger(soDuyetXemTay) || soDuyetXemTay < 0) {
    return { ok: false, loi: "`--ghi` phải đi kèm `--expect-review=<M>` (M = số dòng XEM TAY của bản chạy thử đã duyệt)." };
  }
  if (keHoachSha === null || !/^[0-9a-f]{64}$/.test(keHoachSha)) {
    return { ok: false, loi: "`--ghi` phải đi kèm `--ke-hoach-sha=<64 hex>` (sha của TOÀN kế hoạch ở bản chạy thử đã duyệt)." };
  }
  if (i.ghiDuoc === false) return { ok: false, loi: "Có `--ghi` nhưng kết nối chỉ đọc — sai chuỗi kết nối. KHÔNG ghi gì." };
  if (kh.tom.khongHopLe > 0) {
    return { ok: false, loi: `Kế hoạch có ${kh.tom.khongHopLe} dòng INVALID — dữ liệu hỏng, KHÔNG ghi gì (phải xử lý tay trước).` };
  }
  if (soDuyet !== kh.soGhi) {
    return { ok: false, loi: `Số dòng GHI lúc này (${kh.soGhi}) ≠ số đã duyệt (${soDuyet}). KHÔNG ghi gì — dữ liệu đã đổi; chạy lại bản chạy thử và duyệt bảng mới.` };
  }
  if (soDuyetXemTay !== kh.soXemTay) {
    return { ok: false, loi: `Số dòng XEM TAY lúc này (${kh.soXemTay}) ≠ số đã duyệt (${soDuyetXemTay}). KHÔNG ghi gì.` };
  }
  if (keHoachSha !== kh.sha) {
    return { ok: false, loi: "sha của kế hoạch lúc này ≠ sha đã duyệt (--ke-hoach-sha). Phân loại đã đổi — KHÔNG ghi gì; chạy lại bản chạy thử." };
  }
  return { ok: true };
}

// ─── Tác động hoa hồng (THUẦN — đầu vào cho các phép tính của engine thật) ───────────────────────

/** Người chốt MỚI theo lead: chỉ các dòng GHI (REASSIGN → id mới, CLEAR → null). */
export function nguoiChotMoiTheoLead(dong: readonly DongKeHoach[]): Map<string, string | null> {
  return new Map(dong.filter(laDongGhi).map((d) => [d.leadId, d.newConvertedById] as const));
}

/**
 * Trả MẢNG MỚI; ghi đè `order.lead.convertedById` của dòng có `order.leadId ∈ moi` — kịch bản «chỉ sửa người chốt».
 * Không đụng dòng chưa nối (`order.lead = null`).
 */
export function vaNguoiChotTrongBoNho<T extends HangThanhToanHoaHong>(rows: readonly T[], moi: ReadonlyMap<string, string | null>): T[] {
  return rows.map((r) => {
    const leadId = r.order?.leadId;
    if (!r.order || !r.order.lead || !leadId || !moi.has(leadId)) return r;
    return { ...r, order: { ...r.order, lead: { ...r.order.lead, convertedById: moi.get(leadId) ?? null } } };
  });
}

/** Bản sao lead ứng viên với người chốt đã sửa — để kịch bản «sửa + nối đơn» dùng `vaLeadTrongBoNho` của noi-don với lead đã sửa. */
export function leadSauKhiSua(l: UngVienLead, moi: ReadonlyMap<string, string | null>): UngVienLead {
  return moi.has(l.leadId) ? { ...l, convertedById: moi.get(l.leadId) ?? null } : l;
}

/** Ước lượng THÔ = tỉ lệ × thực thu (CHỈ để ra con số nhanh; số thật theo kỳ lấy từ engine — xem `tinhTacDongKy`). */
export const TI_LE_SALE_UOC_LUONG = 0.04;

export type NhomUocLuong = { vai: string; loai: LoaiDong; soDon: number; soLead: number; thuTong: number; uocHoaHong: number };

/** Gom theo (vai của người chốt HIỆN TẠI, loại dòng). */
export function uocLuongTheoNhom(dong: readonly DongKeHoach[], nguoiDung: readonly HangNguoiDung[]): NhomUocLuong[] {
  const vaiCua = new Map(nguoiDung.map((u) => [u.id, u.vaiTro.includes("SUPER_ADMIN") ? "SUPER_ADMIN" : (u.vaiTro[0] ?? "?")] as const));
  const gom = new Map<string, NhomUocLuong>();
  for (const d of dong) {
    const vai = d.oldConvertedById === null ? "(null)" : (vaiCua.get(d.oldConvertedById) ?? "(không rõ)");
    const k = `${vai}|${d.loai}`;
    const g = gom.get(k) ?? { vai, loai: d.loai, soDon: 0, soLead: 0, thuTong: 0, uocHoaHong: 0 };
    g.soDon += d.soDon;
    g.soLead += 1;
    g.thuTong += d.thuTong;
    g.uocHoaHong = Math.round(g.thuTong * TI_LE_SALE_UOC_LUONG);
    gom.set(k, g);
  }
  return [...gom.values()].sort((a, b) => (a.vai + a.loai < b.vai + b.loai ? -1 : 1));
}
