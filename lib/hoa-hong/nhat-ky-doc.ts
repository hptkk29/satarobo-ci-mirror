// lib/hoa-hong/nhat-ky-doc.ts — ĐỌC nhật ký (AuditLog) cho ba tab con "Đổi nguồn · Lịch sử chính sách · Nhật ký" của tab Khiếu nại & lịch sử.
//
// Nguồn: docs/source-commission/05 §4 ("Đọc audit trong module, không ở /admin/audit-log"), 06 §5.5.
//
// ── Vì sao đọc ở đây mà không qua trang nhật ký chung ────────────────────────────────────────────────────────
// `audit-logs:view` không vai nào được cấp (CLAUDE.md); đừng nới nó để chữa chuyện này. Lịch sử của module nằm CHÍNH TRONG module, dưới cổng quyền của từng
// tab con (page gác), và CHỈ ĐỌC: không hàm nào ở đây ghi/sửa/xoá AuditLog (lưới `[NHH-FRD-08]` + `[NHH-DSP-NK-W]`).
//
// ── Phạm vi người xem ───────────────────────────────────────────────────────────────────────────────────────
// AuditLog KHÔNG nằm trong `scopedDb`; cột `orgUnitId` của nó là cách duy nhất để cách ly theo cơ sở. Người xem thấy:
//   · tầm nhìn "ALL" (neo Hội sở)       → mọi dòng;
//   · tầm nhìn theo cơ sở               → dòng có `orgUnitId` thuộc các cơ sở đó (+ dòng KHÔNG gắn đơn vị nào CHỈ ở Lịch sử chính sách: chính sách Hội sở áp mọi
//                                         cơ sở nên ai xem được chính sách cũng được xem lịch sử của nó).
// Mô hình "tầm nhìn" lấy theo từng kênh: Đổi nguồn ↔ Lead; Lịch sử chính sách ↔ CommissionPolicy; Nhật ký ↔ CommissionTransaction (sổ/kỳ).
//
// ── Hai bảo vệ nội dung ─────────────────────────────────────────────────────────────────────────────────────
//   · Nhật ký chung KHÔNG hiện dòng của khiếu nại cho người không giữ quyền duyệt (lý do/quyết định khiếu nại là chuyện của HR);
//   · giá trị cũ/mới đi qua `maskAuditValues` (che SĐT/email) và bị cắt ngắn — module không có lý do nào cần xem nguyên văn.
import type { Prisma, PrismaClient } from "@prisma/client";

import { maskAuditValues } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { can } from "@/lib/auth/can";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { DANH_MUC_GOC } from "@/lib/nguon/danh-muc-goc";

import { KEY_DUYET_KHIEU_NAI, MODULE_AUDIT_HOA_HONG } from "./khieu-nai-ma";
import { dinhDangDong } from "./vi-sao";

export const KENH_NHAT_KY = ["doi-nguon", "chinh-sach", "nhat-ky"] as const;
export type KenhNhatKy = (typeof KENH_NHAT_KY)[number];

/** Hành động ghi vào `entityType: "Lead"` bởi luồng nguồn (05 §4). */
export const HANH_DONG_DOI_NGUON = ["DOI_NGUON", "DOI_NGUON_SAU_THU", "BO_SUNG_NGUOI", "GOP_LEAD_NGUON", "KHOA_NGUON", "GIAN_LAN_XU_LY"] as const;

export const THUC_THE_CHINH_SACH = ["CommissionPolicy", "CommissionPolicyVersion", "RegulationDocument", "CommissionRule"] as const;

/**
 * Thực thể của kênh "Nhật ký": thao tác của NGƯỜI trên kỳ, hàng chờ, khiếu nại và cấu hình (mốc chuyển sổ). KHÔNG phải `notIn` chính sách: engine ghi audit cho TỪNG ô tính
 * (`CommissionCalcSlot`) và tab này đã ngập 300 dòng "Tính kỳ" mỗi lần Tính — loại tập đó đi mới còn chỗ cho thứ người rà thật sự đọc. Thêm loại thực thể mới = thêm vào đây có chủ đích.
 */
export const THUC_THE_NHAT_KY = ["CommissionPeriod", "CommissionHold", "CommissionDispute", "SystemSetting"] as const;

const NHAN_HANH_DONG: Readonly<Record<string, string>> = {
  CREATE: "Tạo",
  UPDATE: "Sửa",
  STATUS: "Đổi trạng thái",
  ACTIVATE: "Kích hoạt",
  NEW_VERSION: "Tạo phiên bản mới",
  EXPIRE: "Cho hết hiệu lực",
  CANCEL: "Huỷ bản nháp",
  DOI_NGUON: "Đổi nguồn",
  DOI_NGUON_SAU_THU: "Đổi nguồn sau thực thu",
  BO_SUNG_NGUOI: "Bổ sung người giới thiệu",
  GOP_LEAD_NGUON: "Gộp lead (đổi nguồn lead chính)",
  KHOA_NGUON: "Khoá / mở khoá nguồn",
  GIAN_LAN_XU_LY: "Xử lý cảnh báo gian lận",
  MAP_SOURCE: "Gắn trang → nguồn",
  LOCK: "Khoá kỳ",
  EXPORT: "Xuất bảng chi",
  MARK_PAID: "Đánh dấu đã chi",
  CALCULATE: "Tính kỳ",
  REVIEW: "Chuyển rà soát",
  ADJUST: "Điều chỉnh",
  APPLY: "Áp dụng điều chỉnh",
  DISMISS: "Giữ nguyên",
  ASSIGN: "Nhận xử lý",
  REASSIGN: "Giao lại",
  DECIDE: "Quyết định",
  CLOSE: "Đóng",
  CUTOVER_SET: "Đặt mốc chuyển sổ",
};

const NHAN_THUC_THE: Readonly<Record<string, string>> = {
  Lead: "Lead",
  CommissionPolicy: "Chính sách",
  CommissionPolicyVersion: "Phiên bản chính sách",
  CommissionRule: "Quy tắc",
  RegulationDocument: "Văn bản quy định",
  CommissionPeriod: "Kỳ hoa hồng",
  CommissionHold: "Hàng chờ",
  CommissionDispute: "Khiếu nại",
  CommissionTransaction: "Dòng sổ",
  SystemSetting: "Cấu hình",
};

export const nhanHanhDong = (a: string): string => NHAN_HANH_DONG[a] ?? a;
export const nhanThucThe = (t: string): string => NHAN_THUC_THE[t] ?? t;

export type ThayDoi = { truong: string; cu: string; moi: string };
export type MucNhatKy = {
  id: string;
  luc: Date;
  nguoi: string;
  hanhDong: string;
  maHanhDong: string;
  doiTuong: string;
  /** Mã ngắn của đối tượng (6 ký tự cuối id) — đủ để phân biệt hai dòng liền nhau mà không in id dài. */
  maDoiTuong: string;
  thayDoi: ThayDoi[];
  lyDo: string | null;
};

export type KetQuaNhatKy = { muc: MucNhatKy[]; tongSo: number; trang: number; coTrang: number };

type Khach = PrismaClient | Prisma.TransactionClient;

const MOT_GIA_TRI_TOI_DA = 90;
const SO_THAY_DOI_TOI_DA = 6;

/** Nhãn người đọc được cho tên trường thường gặp ở audit của module; trường lạ in nguyên tên (không đoán). */
const NHAN_TRUONG: Readonly<Record<string, string>> = {
  status: "Trạng thái",
  resolution: "Cách giải quyết",
  dich: "Đối tượng",
  kyGhi: "Kỳ ghi",
  kyTuNhien: "Kỳ hiệu lực",
  soDong: "Số dòng",
  tong: "Tổng",
  ketQua: "Kết quả",
  hieuLuc: "Hiệu lực",
  nhom: "Nguồn",
  referrerKind: "Loại người giới thiệu",
  matchedRule: "Căn cứ xác định",
  nguoiGioiThieu: "Người giới thiệu",
  lyDo: "Lý do",
};

/** Khoá kỹ thuật không có nghĩa với người đọc (id, dấu vân tay): ẩn, vì in ra chỉ là chuỗi ngẫu nhiên. */
const TRUONG_KY_THUAT = /(?:Id|Ids|Hash)$/;

const TEN_TRANG_THAI: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  CommissionDispute: { OPEN: "Mới tiếp nhận", UNDER_REVIEW: "Đang xem xét", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối", CLOSED: "Đã đóng" },
  CommissionPeriod: { OPEN: "Đang mở", CALCULATED: "Đã tính", REVIEWING: "Đang rà soát", LOCKED: "Đã khoá", EXPORTED: "Đã xuất bảng chi", PAID: "Đã chi" },
  CommissionHold: { OPEN: "Đang chờ", RESOLVED: "Đã giải", DISMISSED: "Giữ nguyên" },
  CommissionPolicyVersion: { DRAFT: "Nháp", ACTIVE: "Đang hiệu lực", SUPERSEDED: "Đã thay thế", CANCELLED: "Đã huỷ", EXPIRED: "Hết hiệu lực" },
};
const TEN_GIA_TRI: Readonly<Record<string, string>> = {
  SOURCE_CORRECTION: "Sửa nguồn",
  MONEY_ADJUSTMENT: "Điều chỉnh tiền",
  DONG: "Dòng hoa hồng",
  KHOAN: "Khoản thu",
};

/** Mã nhóm nguồn → tên người đọc (nguồn: danh mục gốc của migration PR1 — cùng chuỗi người dùng thấy ở khối Nguồn trên lead). Mã lạ in nguyên mã. */
const TEN_NHOM_NGUON: ReadonlyMap<string, string> = new Map(DANH_MUC_GOC.map((d) => [d.code, d.name]));
const TEN_LOAI_NGUOI_GT: Readonly<Record<string, string>> = { PARENT: "Phụ huynh", EMPLOYEE: "Nhân sự", STUDENT: "Học viên", AFFILIATE: "Cộng tác viên" };

function chuoiHoa(v: unknown, truong: string, loaiThucThe: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" && truong === "nhom" && TEN_NHOM_NGUON.has(v)) return TEN_NHOM_NGUON.get(v)!;
  if (typeof v === "string" && truong === "referrerKind" && TEN_LOAI_NGUOI_GT[v]) return TEN_LOAI_NGUOI_GT[v]!;
  if (typeof v === "string") {
    const ten = (truong === "status" ? TEN_TRANG_THAI[loaiThucThe]?.[v] : undefined) ?? TEN_GIA_TRI[v];
    if (ten) return ten;
  }
  if (truong === "tong" && typeof v === "number") return dinhDangDong(v);
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return s.length > MOT_GIA_TRI_TOI_DA ? `${s.slice(0, MOT_GIA_TRI_TOI_DA - 1)}…` : s;
}

/** Cặp cũ → mới theo từng trường đã đổi; giá trị PII bị che. Trường nhạy cảm của module (lý do khiếu nại, bằng chứng) không bao giờ có ở đây (service không ghi chúng vào audit). */
export function dungThayDoi(
  cu: Prisma.JsonValue | null,
  moi: Prisma.JsonValue | null,
  truongDoi: readonly string[],
  loaiThucThe = "",
): ThayDoi[] {
  const lay = (x: Prisma.JsonValue | null) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
  const co = maskAuditValues(lay(cu), false);
  const mo = maskAuditValues(lay(moi), false);
  const khoa = truongDoi.length > 0 ? [...truongDoi] : [...new Set([...Object.keys(co ?? {}), ...Object.keys(mo ?? {})])];
  return khoa
    .filter((k) => !TRUONG_KY_THUAT.test(k))
    .slice(0, SO_THAY_DOI_TOI_DA)
    .map((k) => ({ truong: NHAN_TRUONG[k] ?? k, cu: chuoiHoa(co?.[k], k, loaiThucThe), moi: chuoiHoa(mo?.[k], k, loaiThucThe) }))
    .filter((t) => t.cu !== t.moi);
}

async function orgUnitCuaCoSo(client: Khach, centerIds: readonly string[]): Promise<string[]> {
  if (centerIds.length === 0) return [];
  const r = await client.orgUnit.findMany({ where: { centerId: { in: [...centerIds] } }, select: { id: true } });
  return r.map((o) => o.id);
}

/** Điều kiện kênh + phạm vi + bảo vệ nội dung. Tách ra để hàm đọc và hàm đếm dùng CHUNG một `where`. */
export async function whereNhatKy(client: Khach, actor: Actor, kenh: KenhNhatKy): Promise<Prisma.AuditLogWhereInput> {
  const dieuKien: Prisma.AuditLogWhereInput[] = [];
  let mo: "ALL" | readonly string[];
  switch (kenh) {
    case "doi-nguon":
      dieuKien.push({ entityType: "Lead", action: { in: [...HANH_DONG_DOI_NGUON] } });
      mo = getModelVisibleCenterIds("Lead", actor);
      break;
    case "chinh-sach":
      dieuKien.push({ module: MODULE_AUDIT_HOA_HONG, entityType: { in: [...THUC_THE_CHINH_SACH] } });
      mo = getModelVisibleCenterIds("CommissionPolicy", actor);
      break;
    case "nhat-ky":
      dieuKien.push({ module: MODULE_AUDIT_HOA_HONG, entityType: { in: [...THUC_THE_NHAT_KY] } });
      // Lý do / quyết định khiếu nại là chuyện của người duyệt.
      if (!can(actor, KEY_DUYET_KHIEU_NAI)) dieuKien.push({ entityType: { not: "CommissionDispute" } });
      mo = getModelVisibleCenterIds("CommissionTransaction", actor);
      break;
  }
  if (mo !== "ALL") {
    const orgIds = await orgUnitCuaCoSo(client, mo);
    // Chính sách của Hội sở (không gắn đơn vị) áp cho mọi cơ sở ⇒ lịch sử của nó mở cho ai xem được chính sách.
    dieuKien.push(kenh === "chinh-sach" ? { OR: [{ orgUnitId: { in: orgIds } }, { orgUnitId: null }] } : { orgUnitId: { in: orgIds } });
  }
  return { AND: dieuKien };
}

export async function docNhatKy(
  client: Khach,
  actor: Actor,
  kenh: KenhNhatKy,
  p: { trang?: number; coTrang?: number },
): Promise<KetQuaNhatKy> {
  const where = await whereNhatKy(client, actor, kenh);
  const coTrang = Math.min(Math.max(p.coTrang ?? 25, 1), 100);
  const trang = Math.max(p.trang ?? 1, 1);
  const [rows, tongSo] = await Promise.all([
    client.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (trang - 1) * coTrang,
      take: coTrang,
      select: { id: true, createdAt: true, actorName: true, action: true, entityType: true, entityId: true, oldValues: true, newValues: true, changedFields: true, reason: true },
    }),
    client.auditLog.count({ where }),
  ]);
  return {
    tongSo,
    trang,
    coTrang,
    muc: rows.map((r) => ({
      id: r.id,
      luc: r.createdAt,
      nguoi: r.actorName,
      hanhDong: nhanHanhDong(r.action),
      maHanhDong: r.action,
      doiTuong: nhanThucThe(r.entityType),
      maDoiTuong: r.entityId.slice(-6).toUpperCase(),
      thayDoi: dungThayDoi(r.oldValues, r.newValues, r.changedFields, r.entityType),
      lyDo: r.reason,
    })),
  };
}
