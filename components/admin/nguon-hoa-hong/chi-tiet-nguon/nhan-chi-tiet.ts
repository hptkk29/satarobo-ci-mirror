// components/admin/nguon-hoa-hong/chi-tiet-nguon/nhan-chi-tiet.ts — CHỮ người đọc của trang CHI TIẾT một nguồn. THUẦN (test không cần DOM/DB).
//
// Ba việc:
//  1. nhãn nhóm nguồn (`LeadSourceType`) · loại người giới thiệu (`ReferrerKind`) · trạng thái phiên bản chính sách — `Record<enum Prisma, …>` nên thêm giá trị mà quên nhãn là LỖI BIÊN DỊCH;
//  2. nhãn hành động + tên trường trong NHẬT KÝ (audit) — mã lạ in NGUYÊN mã (nhãn sai nghĩa tệ hơn nhãn thô);
//  3. `dungMucThoiGian`: một dòng nhật ký (`MucLichSuNguon`) → mục của `AuditTimeline`. Giá trị trong nhật ký là CẤU HÌNH nhưng có hai kiểu không được in thô: id nhân sự/đơn vị
//     (cuid — người đọc không đọc được) và mốc thời gian ISO (lệch một ngày nếu in theo UTC).
//
// Không liệt kê MÃ nguồn ở đây (nguồn là danh mục MỞ — admin thêm bằng UI): chỉ liệt kê giá trị của các enum cố định.
import type { LeadSourceType, PolicyVersionStatus, ReferrerKind } from "@prisma/client";
import { ngayDMYTuMoc } from "@/lib/hoa-hong/dinh-dang";
import type { MucLichSuNguon } from "@/lib/nguon/doc-chi-tiet-nguon";
import { nhanTrangThaiNguon } from "@/lib/nguon/nhan-hien-thi";
import type { MucThoiGian } from "../audit-timeline";
import { NHAN_NGUOI_GIOI_THIEU } from "../nhan-nguon";

/** Nhóm cấp cao của nguồn (`LeadSourceGroup.sourceType`): lọc / báo cáo, KHÔNG quyết hoa hồng. */
export const NHAN_LOAI_NGUON: Readonly<Record<LeadSourceType, string>> = {
  REFERRAL: "Giới thiệu",
  MARKETING: "Marketing · quảng cáo",
  ORGANIC: "Tự nhiên",
  OFFLINE: "Tại trung tâm",
  EVENT: "Sự kiện",
  PARTNER: "Đối tác",
  OTHER: "Khác",
  SYSTEM: "Hệ thống",
};

export function nhanLoaiNguon(ma: string): string {
  return (NHAN_LOAI_NGUON as Record<string, string>)[ma] ?? ma;
}

/** Loại người giới thiệu ghi trên attribution (`LeadAttribution.referrerKind`). */
export const NHAN_LOAI_GIOI_THIEU: Readonly<Record<ReferrerKind, string>> = {
  EMPLOYEE: "Nhân sự",
  PARENT: "Phụ huynh",
  AFFILIATE: "Đối tác · cộng tác viên",
};

/** Trạng thái một PHIÊN BẢN chính sách. `Record` ⇒ thêm trạng thái ở schema mà quên nhãn là lỗi biên dịch. */
export const NHAN_TRANG_THAI_PHIEN_BAN: Readonly<Record<PolicyVersionStatus, string>> = {
  DRAFT: "Bản nháp — chưa chạy",
  ACTIVE: "Đang hiệu lực",
  EXPIRED: "Đã hết hạn",
  SUPERSEDED: "Đã được bản mới thay",
  CANCELLED: "Đã huỷ",
};

export function nhanTrangThaiPhienBan(ma: string): string {
  return (NHAN_TRANG_THAI_PHIEN_BAN as Record<string, string>)[ma] ?? ma;
}

// ── Nhật ký ──────────────────────────────────────────────────────────────────────────────────────────────

/** Tên hành động audit do `lib/nguon/danh-muc-ghi*.ts` + `bang-nguon-theo-page.ts` ghi → tiêu đề dòng. Ca `[CTN-NH-02]` sinh MỌI tên từ hai hàm đặt tên rồi đối chiếu. */
const NHAN_HANH_DONG: Readonly<Record<string, string>> = {
  NGUON_TAO: "Tạo nguồn",
  NGUON_SUA: "Sửa nguồn",
  NGUON_DOI_CUA_SO: "Đổi cửa sổ ghi công",
  NGUON_DOI_PHU_TRACH: "Đổi người phụ trách",
  NGUON_DOI_HOA_HONG: "Đổi tham gia hoa hồng",
  NGUON_KICH_HOAT: "Kích hoạt nguồn",
  NGUON_NGUNG: "Ngừng nguồn",
  NGUON_MO_LAI: "Mở lại nguồn",
  NGUON_LUU_TRU: "Lưu trữ nguồn",
  NGUON_KHOI_PHUC: "Khôi phục nguồn",
  PAGE_MAPPING: "Gán Page vào nguồn",
};

export function nhanHanhDong(ma: string): string {
  return NHAN_HANH_DONG[ma] ?? ma;
}

const NHAN_TRUONG: Readonly<Record<string, string>> = {
  code: "Mã",
  name: "Tên",
  description: "Mô tả",
  sourceType: "Nhóm nguồn",
  referrerRequirement: "Cách xác định",
  requiresNote: "Bắt buộc giải trình",
  selectable: "Chọn được ở ô nhập",
  sortOrder: "Thứ tự",
  attributionWindowDays: "Cửa sổ ghi công",
  commissionEnabled: "Hoa hồng theo nguồn",
  ownerEmployeeId: "Người phụ trách",
  ownerOrgUnitId: "Phạm vi đơn vị",
  effectiveFrom: "Hiệu lực từ",
  effectiveTo: "Hiệu lực đến",
  status: "Trạng thái",
};

export function nhanTruong(k: string): string {
  return NHAN_TRUONG[k] ?? k;
}

const COT_ID = new Set(["ownerEmployeeId", "ownerOrgUnitId"]);
const COT_NGAY = new Set(["effectiveFrom", "effectiveTo"]);

/** `trong` = chữ khi không có giá trị: «—» ở mục TẠO (AuditTimeline in riêng giá trị mới), «(trống)» ở mục SỬA. */
function dinhDangGiaTri(k: string, v: unknown, trong: string): string {
  if (v === null || v === undefined || v === "") {
    return k === "attributionWindowDays" ? "Mặc định hệ thống" : trong;
  }
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (COT_ID.has(k)) return "Đã chỉ định"; // cuid không đọc được: nói «có hay chưa», không in mã
  if (COT_NGAY.has(k) && typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? trong : ngayDMYTuMoc(d);
  }
  if (k === "attributionWindowDays" && typeof v === "number") return `${v} ngày`;
  if (k === "sourceType" && typeof v === "string") return nhanLoaiNguon(v);
  if (k === "referrerRequirement" && typeof v === "string") return (NHAN_NGUOI_GIOI_THIEU as Record<string, string>)[v] ?? v;
  if (k === "status" && typeof v === "string") return nhanTrangThaiNguon(v);
  if (typeof v === "string" || typeof v === "number") return String(v);
  return trong;
}

type NguonPage = { groupCode?: unknown; campaignCode?: unknown } | null;
const laObj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function moTaNguonPage(v: unknown): string {
  const o = laObj(v) as NguonPage;
  if (!o || typeof o.groupCode !== "string") return "(không gán)";
  return typeof o.campaignCode === "string" && o.campaignCode !== "" ? `${o.groupCode} · chiến dịch ${o.campaignCode}` : o.groupCode;
}

/** Một dòng nhật ký → một mục của `AuditTimeline`. */
export function dungMucThoiGian(m: MucLichSuNguon): MucThoiGian {
  const base = { id: m.id, luc: new Date(m.luc), tieuDe: nhanHanhDong(m.hanhDong), nguoi: m.nguoi, lyDo: m.lyDo };

  if (m.hanhDong === "PAGE_MAPPING") {
    const pageId = String(laObj(m.moi)?.pageId ?? laObj(m.cu)?.pageId ?? "?");
    return { ...base, thayDoi: [{ truong: `Page ${pageId}`, cu: moTaNguonPage(laObj(m.cu)?.nguon), moi: moTaNguonPage(laObj(m.moi)?.nguon) }] };
  }

  const laTao = m.cu === null;
  const trong = laTao ? "—" : "(trống)";
  // Mục TẠO không có `changedFields`: liệt kê trường CÓ giá trị (false/0 vẫn là giá trị; null/rỗng thì bỏ — không ai cần đọc «Mô tả: —»).
  const khoa = m.truongDoi.length > 0 ? m.truongDoi : Object.keys(m.moi ?? {}).filter((k) => m.moi![k] !== null && m.moi![k] !== "" && m.moi![k] !== undefined);
  const thayDoi = khoa.map((k) => ({
    truong: nhanTruong(k),
    cu: laTao ? "—" : dinhDangGiaTri(k, m.cu?.[k], trong),
    moi: dinhDangGiaTri(k, m.moi?.[k], "(trống)"),
  }));
  return { ...base, ...(thayDoi.length > 0 ? { thayDoi } : {}) };
}
