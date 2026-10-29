// lib/ai-lead/dich-vu/bo-quy-tac-schema.ts — SCHEMA của BỘ QUY TẮC (Rule Builder). THUẦN: chỉ zod, không DB/env/đồng hồ.
//
// Bộ quy tắc = danh sách `rules` gồm đúng BỐN loại (primitive) — không biểu thức tự do, không danh sách userId, không loại lạ:
//   · ROUTE_PAGE_TO_CAMPUS  {agentId, pageId, centerId|null}  — cơ sở nhận mặc định của Page (khi khách chưa chọn). Ghi ra cột `AiLeadAgentPage.routingCenterId`.
//   · AUTO_CREATE           {agentId, pageId, enabled, requireConsent?, campusCenterIds?} — tự tạo lead cho Page. `enabled` ghi ra cột `autoCreate`; hai ràng buộc còn lại chỉ có thể THU HẸP
//                           (không bao giờ nới): chỉ tự tạo khi khách đã đồng ý liên hệ / chỉ cho các cơ sở trong danh sách. Hồ sơ không thoả ⇒ vẫn chờ nhân viên duyệt.
//   · SLA                   {scope: DEFAULT | PAGE | CAMPUS, claimMinutes, resolveMinutes} — hạn nhận/xử lý hồ sơ; ưu tiên CAMPUS > PAGE > DEFAULT > tham số `ai.sla*`.
//   · NOTIFY                {event, centerId|null, afterMinutes, to[]} — ai được báo khi nào; `afterMinutes > 0` là bậc LEO THANG (báo thêm sau chừng đó phút nếu việc chưa xong).
//                           `to` là enum ĐÓNG (vai/quyền), cố ý không có userId: người rời đi thì quy tắc vẫn đúng, và không ai bị gắn vào quy tắc bằng tay.
//
// Khoá duy nhất của mỗi quy tắc (trùng khoá ⇒ từ chối cả bộ): xem `khoaQuyTac`. Giới hạn kích thước để payload không thành kênh nhồi dữ liệu.
import { z } from "zod";
import { RE } from "../hop-dong";
import { maCoSo } from "./cau-hinh-thuan";

// `agentId` là cuid do Gateway sinh; mã CƠ SỞ dùng `maCoSo` (Center.id thật trên PROD là slug — xem cau-hinh-thuan.ts).
const id = z.string().regex(/^[a-z0-9]{20,40}$/, "Mã không hợp lệ");
const pageId = z.string().regex(RE.pageId, "pageId gồm chữ, số, _ hoặc -, dài 5–64 ký tự");

export const SU_KIEN_THONG_BAO = ["DRAFT_NEEDS_STAFF", "SLA_CLAIM_OVERDUE", "SLA_RESOLVE_OVERDUE", "INCIDENT"] as const;
export type SuKienThongBao = (typeof SU_KIEN_THONG_BAO)[number];

/** Nhóm người nhận — enum ĐÓNG. Mỗi nhóm được phân giải ở `thong-bao.ts` qua nguồn quyền thật (UserOrgRole→RoleDef), không qua danh sách tay. */
export const NHOM_NGUOI_NHAN = ["CENTER_MANAGER", "HO_REVIEWERS", "HO_CONFIGURERS", "INTEGRATION_VIEWERS"] as const;
export type NhomNguoiNhan = (typeof NHOM_NGUOI_NHAN)[number];

export const CAU_NHOM_NGUOI_NHAN: Record<NhomNguoiNhan, string> = {
  CENTER_MANAGER: "Quản lý cơ sở của cơ sở xử lý hồ sơ",
  HO_REVIEWERS: "Người duyệt hồ sơ AI ở Hội sở",
  HO_CONFIGURERS: "Người cấu hình AI Lead ở Hội sở",
  INTEGRATION_VIEWERS: "Người xem Trung tâm kết nối AI",
};

export const quyTacRoute = z.strictObject({ kind: z.literal("ROUTE_PAGE_TO_CAMPUS"), agentId: id, pageId, centerId: maCoSo.nullable() });

export const quyTacAutoCreate = z.strictObject({
  kind: z.literal("AUTO_CREATE"),
  agentId: id,
  pageId,
  enabled: z.boolean(),
  /** Thu hẹp: chỉ tự tạo khi khách ĐÃ đồng ý liên hệ (có bằng chứng). */
  requireConsent: z.boolean().optional(),
  /** Thu hẹp: chỉ tự tạo khi cơ sở của hồ sơ nằm trong danh sách (rỗng/không khai = mọi cơ sở). */
  campusCenterIds: z.array(maCoSo).max(50).optional(),
});

export const phamViSla = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("DEFAULT") }),
  z.strictObject({ type: z.literal("PAGE"), pageId }),
  z.strictObject({ type: z.literal("CAMPUS"), centerId: maCoSo }),
]);

export const quyTacSla = z
  .strictObject({
    kind: z.literal("SLA"),
    scope: phamViSla,
    claimMinutes: z.number().int().min(5).max(10_080),
    resolveMinutes: z.number().int().min(5).max(43_200),
  })
  .refine((r) => r.claimMinutes <= r.resolveMinutes, { message: "Hạn nhận không được lớn hơn hạn xử lý", path: ["claimMinutes"] });

export const quyTacNotify = z.strictObject({
  kind: z.literal("NOTIFY"),
  event: z.enum(SU_KIEN_THONG_BAO),
  /** null = mọi cơ sở (kể cả hồ sơ chưa biết cơ sở). */
  centerId: maCoSo.nullable(),
  /** 0 = báo ngay; > 0 = bậc leo thang sau chừng đó phút kể từ mốc sự kiện (hạn SLA / lúc tạo sự cố). */
  afterMinutes: z.number().int().min(0).max(10_080),
  to: z.array(z.enum(NHOM_NGUOI_NHAN)).min(1).max(NHOM_NGUOI_NHAN.length),
});

export const quyTac = z.discriminatedUnion("kind", [quyTacRoute, quyTacAutoCreate, quyTacSla, quyTacNotify]);
export type QuyTac = z.infer<typeof quyTac>;
export type QuyTacRoute = z.infer<typeof quyTacRoute>;
export type QuyTacAutoCreate = z.infer<typeof quyTacAutoCreate>;
export type QuyTacSla = z.infer<typeof quyTacSla>;
export type QuyTacNotify = z.infer<typeof quyTacNotify>;

/**
 * Trần TỔNG số quy tắc của một phiên bản (định tuyến + tự tạo lead theo Page + SLA + thông báo). Vì sao có trần: mỗi phiên bản là một dòng JSON BẤT BIẾN lưu mãi; cron/intake đọc nó mỗi lượt ⇒ không để một
 * lần dán nhầm hàng nghìn dòng làm phình bảng lịch sử và chậm đường nóng. 300 ≈ 6× nhu cầu thực (mỗi Page tối đa 2 quy tắc ROUTE/AUTO + vài chục SLA/thông báo). Màn Quy tắc hiện «đã dùng X/300» và
 * khoá nút Thêm khi đầy; muốn nâng thì đổi hằng này kèm đo thời gian đọc phiên bản (không phải tham số vận hành vì nó là rào an toàn, không phải chính sách).
 */
export const SO_QUY_TAC_TOI_DA = 300;
export const CAU_QUA_SO_QUY_TAC = `Một phiên bản chỉ chứa tối đa ${SO_QUY_TAC_TOI_DA} quy tắc (tính cả định tuyến và tự tạo lead theo Page). Gộp bớt hoặc xoá quy tắc không còn dùng.`;

// ─── Đầu vào của Server Action (màn Rule Builder) ───────────────────────────────────────────────────────────────────────────
const lyDoNguyHiem = z.string().trim().min(10, "Nhập lý do (ít nhất 10 ký tự) — lý do được ghi vào nhật ký.").max(500, "Lý do tối đa 500 ký tự.");
/** `rules` để `unknown`: dịch vụ tự kiểm bằng `boQuyTacSchema` và trả câu tiếng Việt (không để zod dịch lỗi kiểu khác nhau ở hai tầng). */
/** Phiên bản bộ quy tắc mà người sửa ĐÃ THẤY lúc mở màn (0 = chưa có phiên bản nào). Lưu lên một phiên bản khác ⇒ từ chối, không ghi đè lặng lẽ thay đổi của người khác. */
export const baseVersion = z.number().int().min(0).max(1_000_000);
export const luuSlaThongBaoSchema = z.strictObject({ baseVersion, rules: z.array(z.unknown()).max(SO_QUY_TAC_TOI_DA, CAU_QUA_SO_QUY_TAC), lyDo: lyDoNguyHiem });
export const rangBuocTuTaoSchema = z.strictObject({ baseVersion, agentId: id, pageId, requireConsent: z.boolean(), campusCenterIds: z.array(maCoSo).max(50), lyDo: lyDoNguyHiem });
export const khoiPhucBoQuyTacSchema = z.strictObject({ version: z.number().int().min(1).max(1_000_000), lyDo: lyDoNguyHiem });
export const xemTruocKhoiPhucSchema = z.strictObject({ version: z.number().int().min(1).max(1_000_000) });

/** Khoá duy nhất: mỗi khoá chỉ MỘT quy tắc (giá trị sau không âm thầm đè giá trị trước). */
export function khoaQuyTac(r: QuyTac): string {
  switch (r.kind) {
    case "ROUTE_PAGE_TO_CAMPUS":
      return `ROUTE|${r.agentId}|${r.pageId}`;
    case "AUTO_CREATE":
      return `AUTO|${r.agentId}|${r.pageId}`;
    case "SLA":
      return `SLA|${r.scope.type}|${r.scope.type === "PAGE" ? r.scope.pageId : r.scope.type === "CAMPUS" ? r.scope.centerId : "-"}`;
    case "NOTIFY":
      return `NOTIFY|${r.event}|${r.centerId ?? "-"}|${r.afterMinutes}`;
  }
}

export const boQuyTacSchema = z
  .strictObject({ rules: z.array(quyTac).max(SO_QUY_TAC_TOI_DA, CAU_QUA_SO_QUY_TAC) })
  .superRefine((b, ctx) => {
    const thay = new Set<string>();
    b.rules.forEach((r, i) => {
      const k = khoaQuyTac(r);
      if (thay.has(k)) ctx.addIssue({ code: "custom", path: ["rules", i], message: `Trùng quy tắc: ${k}` });
      thay.add(k);
    });
  });
export type BoQuyTac = z.infer<typeof boQuyTacSchema>;

/** Dạng CHUẨN để so sánh / băm: sắp theo khoá, mảng con sắp xếp, khoá thừa không có (strict). Hai bộ cùng nội dung ⇒ cùng chuỗi. */
export function chuanHoaBoQuyTac(b: BoQuyTac): BoQuyTac {
  const rules = b.rules
    .map((r): QuyTac => {
      if (r.kind === "AUTO_CREATE") {
        const { campusCenterIds, requireConsent, ...gop } = r;
        return {
          ...gop,
          ...(requireConsent === true ? { requireConsent: true } : {}),
          ...(campusCenterIds && campusCenterIds.length > 0 ? { campusCenterIds: [...new Set(campusCenterIds)].sort() } : {}),
        };
      }
      if (r.kind === "NOTIFY") return { ...r, to: [...new Set(r.to)].sort() };
      return r;
    })
    .sort((a, b2) => khoaQuyTac(a).localeCompare(khoaQuyTac(b2)));
  return { rules };
}

export function chuoiChuan(b: BoQuyTac): string {
  return JSON.stringify(chuanHoaBoQuyTac(b));
}
