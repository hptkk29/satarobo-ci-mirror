// lib/ai-lead/dich-vu/dieu-kien.ts — ĐIỀU KIỆN để một hồ sơ chờ trở thành lead (design §6) + DẤU XÁC MINH CỦA NHÂN VIÊN. HÀM THUẦN (không DB, không đồng hồ).
//
// Hai chỗ dùng chung MỘT luật — `taoLeadTuHoSo` (revalidate lúc ghi) và `duyet.ts` (nút «Duyệt» bị khoá khi thiếu điều kiện, câu «còn thiếu gì»). Viết hai bản là hai luật sẽ lệch nhau:
// nút sáng mà bấm vào bị từ chối, hoặc nút tối mà thật ra ghi được.
//
// ═══ DẤU XÁC MINH CỦA NHÂN VIÊN (provenance) ═══════════════════════════════════════════════════════════════════════════════════════════════
// `AiLeadDraft.fbNameSource` chỉ biết ba giá trị DO AGENT khai (META_PROFILE_API · WEBHOOK_PAYLOAD · CUSTOMER_STATED) — không có «nhân viên đã xác minh», và lát C KHÔNG được
// sửa schema. Dấu của nhân viên nằm ở `evidence.staff` (cột Json có sẵn), theo từng trường: `{ v: <giá trị đã xác minh>, by: <userId>, at: <ISO> }`.
//   · Đối chiếu bằng GIÁ TRỊ `v`, không bằng một cờ true/false: nếu Agent về sau ghi đè tên Facebook bằng một tên khác thì dấu cũ KHÔNG còn áp (giá trị lệch ⇒ chưa xác minh).
//     Đây là chỗ khác với cờ bool — cờ bool sẽ «xác minh» một cái tên mà nhân viên chưa từng thấy.
//   · `evidence` còn chứa `phoneMessageMid`/`campusMessageMid` của Agent. Khoá `staff` là của NHÂN VIÊN — ghi/đọc qua hai hàm dưới đây, luôn GIỮ NGUYÊN các khoá khác.
//     (Yêu cầu cho lát Gateway: khi Agent gửi thêm dữ liệu, MERGE `evidence`, đừng thay cả đối tượng — xem báo cáo lát C.)
import { canonicalPhone } from "@/lib/phone";
import { fbNameDaXacMinh } from "../trang-thai";
import type { FbNameSource } from "../kieu";

export type TruongXacMinh = "fbName" | "phone" | "campus";
export type DauXacMinh = { v: string; by: string; at: string };
export type XacMinhNhanVien = Partial<Record<TruongXacMinh, DauXacMinh>>;

function laDoiTuong(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function laDau(x: unknown): x is DauXacMinh {
  return laDoiTuong(x) && typeof x.v === "string" && typeof x.by === "string" && typeof x.at === "string";
}

/** Đọc `evidence.staff` — dữ liệu hỏng/thiếu ⇒ không có dấu nào (fail-closed: chưa xác minh). */
export function docXacMinhNhanVien(evidence: unknown): XacMinhNhanVien {
  if (!laDoiTuong(evidence) || !laDoiTuong(evidence.staff)) return {};
  const ra: XacMinhNhanVien = {};
  for (const k of ["fbName", "phone", "campus"] as const) {
    const d = evidence.staff[k];
    if (laDau(d)) ra[k] = { v: d.v, by: d.by, at: d.at };
  }
  return ra;
}

/** Trả `evidence` MỚI có thêm dấu của nhân viên cho một trường; mọi khoá khác (mid của Agent…) giữ nguyên. */
export function ghiXacMinhNhanVien(
  evidence: unknown,
  truong: TruongXacMinh,
  giaTri: string,
  nguoi: string,
  luc: Date,
): Record<string, unknown> {
  const goc = laDoiTuong(evidence) ? evidence : {};
  const staff = { ...docXacMinhNhanVien(evidence), [truong]: { v: giaTri, by: nguoi, at: luc.toISOString() } };
  return { ...goc, staff };
}

export type DauVaoDieuKien = {
  fbName: string | null;
  fbNameSource: FbNameSource | null;
  phoneCanonical: string | null;
  phoneRaw: string | null;
  campusCenterId: string | null;
  evidence: unknown;
};

export type NguonTenFacebook = "AGENT_XAC_MINH" | "NHAN_VIEN" | null;

/** Tên Facebook đã có nguồn tin cậy chưa — do runtime Agent cung cấp (Meta API/webhook) HOẶC nhân viên đã xác minh ĐÚNG giá trị đang lưu. */
export function nguonTenFacebook(d: Pick<DauVaoDieuKien, "fbName" | "fbNameSource" | "evidence">): NguonTenFacebook {
  if (fbNameDaXacMinh({ fbName: d.fbName, fbNameSource: d.fbNameSource ?? undefined })) return "AGENT_XAC_MINH";
  const ten = d.fbName?.trim();
  if (!ten) return null;
  const dau = docXacMinhNhanVien(d.evidence).fbName;
  return dau !== undefined && dau.v === ten ? "NHAN_VIEN" : null;
}

/** SĐT chuẩn hoá: ưu tiên cột đã chuẩn hoá; chỉ có bản thô thì chuẩn hoá lại (không tin bản thô). */
export function sdtChuanHoa(d: Pick<DauVaoDieuKien, "phoneCanonical" | "phoneRaw">): string | null {
  if (d.phoneCanonical && canonicalPhone(d.phoneCanonical) === d.phoneCanonical) return d.phoneCanonical;
  return d.phoneRaw ? canonicalPhone(d.phoneRaw) : null;
}

export type ThieuDieuKien = "fbName" | "phone" | "campus";

/** Phần THUẦN của điều kiện (chưa hỏi DB cơ sở): tên Facebook có nguồn · SĐT chuẩn hoá được · đã chọn cơ sở. Thứ tự cố định. */
export function thieuDieuKien(d: DauVaoDieuKien): ThieuDieuKien[] {
  const thieu: ThieuDieuKien[] = [];
  if (nguonTenFacebook(d) === null) thieu.push("fbName");
  if (sdtChuanHoa(d) === null) thieu.push("phone");
  if (!d.campusCenterId) thieu.push("campus");
  return thieu;
}

export const NHAN_THIEU: Record<ThieuDieuKien, string> = {
  fbName: "Tên Facebook chưa có nguồn xác minh",
  phone: "Số điện thoại chưa hợp lệ",
  campus: "Chưa chọn cơ sở",
};

/** Trạng thái hồ sơ KẾT THÚC (design §4.1) — không còn gì để làm. */
export const TRANG_THAI_KET_THUC = ["COMPLETED", "REJECTED", "EXPIRED"] as const;
export function laKetThuc(state: string): boolean {
  return (TRANG_THAI_KET_THUC as readonly string[]).includes(state);
}

/** Hồ sơ ĐÃ ra lead (kể cả lead chưa có chủ). */
export function daRaLead(state: string): boolean {
  return state === "COMPLETED" || state === "ASSIGNMENT_PENDING";
}

/** Nhân viên được phép DUYỆT/BỔ SUNG ở trạng thái nào. `COLLECTING` loại ra: Agent còn đang hỏi khách — người cùng sửa là hai bên cùng viết một hồ sơ. */
export const TRANG_THAI_NHAN_VIEN_XU_LY = ["PENDING_INFO", "WAITING_QLCS", "IN_PROGRESS", "READY_FOR_REVIEW", "SYSTEM_EXCEPTION"] as const;
export function nhanVienXuLyDuoc(state: string): boolean {
  return (TRANG_THAI_NHAN_VIEN_XU_LY as readonly string[]).includes(state);
}

/** Từ chối được ở mọi trạng thái chưa kết thúc và chưa ra lead (kể cả `COLLECTING`: khách bỏ đi, hồ sơ nháp không còn ý nghĩa). */
export function tuChoiDuoc(state: string): boolean {
  return !laKetThuc(state) && state !== "ASSIGNMENT_PENDING";
}
