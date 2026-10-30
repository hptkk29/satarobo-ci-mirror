"use server";

// CẤU HÌNH AI LEAD (lát K) — Server Actions. Mỗi action: ĐĂNG NHẬP → QUYỀN (ngay đầu thân, qua `vaoCong`) → zod → dịch vụ (`lib/ai-lead/dich-vu/cau-hinh.ts`).
//
// Quyền (design §3, đã đối chiếu `lib/auth/permissions.ts`):
//   · agent · khoá · công tắc khẩn · contractStatus          → `ai-integration:manage`   (chỉ Quản trị tối cao)
//   · Page (cấp/gỡ/tạm dừng/cơ sở nhận) · cơ sở xuất bản · catalog → `ai-leads:configure`   (Quản trị tối cao · Marketing HO). Cấp/gỡ/tạm dừng Page nhận THÊM
//     `ai-integration:manage` vì Trung tâm kết nối cũng có nút "Tạm dừng Page" và người giữ công tắc khẩn không được kẹt ở màn kia.
//   · cổng chính sách PROD                                   → `ai-leads:policy`, rồi `setGlobalSetting` (đòi thêm isSuperAdmin — "quyền trên giấy", xem cai-dat.ts).
//   · tự tạo lead theo Page (E2)                             → `ai-integration:manage` (KHÔNG `ai-leads:configure`: tạo lead + chia sale không qua duyệt là quyết định rủi ro).
//
// KHOÁ AGENT chỉ đi ra ở GIÁ TRỊ TRẢ của `taoAgentAction` / `taoLaiKhoaAction`. Không `console.*`, không `revalidatePath` mang nó, không vào nhật ký.
// File 'use server' chỉ export async function (và kiểu) — không export hằng.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireLiveSession } from "@/lib/auth/live-session";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { getAuditActor } from "@/lib/audit/log";
import { originTuHeaders } from "@/lib/push/origin";
import {
  datContractStatus,
  datCoSoNhanMacDinh,
  datHoatDongAgent,
  datRangBuocTuTao,
  datTrangThaiPage,
  datTuTaoLeadChoPage,
  doiChinhSach,
  goCoSoXuatBan,
  goPageKhoiAgent,
  khoiPhucBoQuyTac,
  luuCoSoXuatBan,
  luuSlaThongBao,
  taoAgent,
  taoLaiKhoa,
  themPageChoAgent,
  voHieuHoaAgentTestTrenProd,
  xuatBanCatalog,
  xuatBanLai,
  type KetQua,
  type NguoiThaoTac,
  type ThayDoiKhoiPhuc,
} from "@/lib/ai-lead/dich-vu/cau-hinh";
import { khoiPhucBoQuyTacSchema, luuSlaThongBaoSchema, rangBuocTuTaoSchema, xemTruocKhoiPhucSchema } from "@/lib/ai-lead/dich-vu/bo-quy-tac-schema";
import {
  datContractSchema,
  datHoatDongSchema,
  doiChinhSachSchema,
  goPageSchema,
  goXuatBanSchema,
  loiDauTien,
  luuXuatBanSchema,
  routingSchema,
  taoAgentSchema,
  taoLaiKhoaSchema,
  themPageSchema,
  trangThaiPageSchema,
  xuatBanLaiSchema,
  xuatBanSchema,
} from "@/lib/ai-lead/dich-vu/cau-hinh-thuan";
import { datTuTaoLeadSchema, voHieuHoaTestTrenProdSchema } from "@/lib/ai-lead/dich-vu/quy-tac-page-schema";

type Cong = { ok: true; ng: NguoiThaoTac; userId: string } | { ok: false; error: string };

/** Cổng vào MỌI action: phiên + quyền. Đứng ngay đầu thân từng action — layout gate chưa đủ (CLAUDE.md luật 5). */
async function vaoCong(quyen: readonly string[], loiQuyen: string): Promise<Cong> {
  // Phiên phải còn SỐNG so với DB (isActive / deletedAt / tokenVersion): JWT sống 30 ngày và layout chỉ chặn lúc render, không chặn Server Action.
  const session = await requireLiveSession();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkAnyPermission(quyen))) return { ok: false, error: loiQuyen };
  const { actorId, actorName } = getAuditActor(session);
  return { ok: true, ng: { userId: actorId ?? session.user.id, userName: actorName }, userId: session.user.id };
}

const MANAGE = ["ai-integration:manage"] as const;
const CAU_HINH = ["ai-leads:configure"] as const;
const PAGE = ["ai-leads:configure", "ai-integration:manage"] as const;
const POLICY = ["ai-leads:policy"] as const;
const LOI_MANAGE = "Chỉ Quản trị tối cao (quyền ai-integration:manage) làm được thao tác này.";
const LOI_CAU_HINH = "Bạn không có quyền cấu hình AI Lead (ai-leads:configure).";
const LOI_PAGE = "Bạn không có quyền quản lý Page AI Lead (ai-leads:configure hoặc ai-integration:manage).";
const LOI_POLICY = "Chỉ người có quyền ai-leads:policy (Quản trị tối cao) đổi được cổng PROD.";

function lamMoi() {
  for (const p of ["/admin/ai-lead/cau-hinh", "/ai-lead/cau-hinh", "/admin/ai-lead/ket-noi", "/ai-lead/ket-noi"]) revalidatePath(p);
}

export type CauHinhKhoa = {
  agentId: string;
  name: string;
  environment: "TEST" | "PROD";
  secretVersion: number;
  agentSecret: string;
  /** Địa chỉ gốc để Agent gọi (đuôi `/api/ai-lead-agent/v1`). Rỗng nếu không suy được — màn nhắc điền tay. */
  baseUrl: string;
  /** Chỉ có khi tạo Agent: false = Agent ra đời ở trạng thái TẮT (cổng PROD đóng). */
  active?: boolean;
};

async function diaChiGoc(): Promise<string> {
  const o = originTuHeaders(await headers());
  return o ? `${o}/api/ai-lead-agent/v1` : "";
}

export async function taoAgentAction(input: unknown): Promise<KetQua<CauHinhKhoa>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = taoAgentSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await taoAgent(c.ng, p.data);
  if (!r.ok) return r;
  lamMoi();
  return { ...r, baseUrl: await diaChiGoc() };
}

export async function taoLaiKhoaAction(input: unknown): Promise<KetQua<CauHinhKhoa>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = taoLaiKhoaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await taoLaiKhoa(c.ng, p.data);
  if (!r.ok) return r;
  lamMoi();
  return { ...r, baseUrl: await diaChiGoc() };
}

/** Công tắc khẩn: tắt/bật một Agent. */
export async function datHoatDongAgentAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = datHoatDongSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datHoatDongAgent(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

// ─── Rule Builder: bộ quy tắc có version. Cổng `ai-leads:configure` (người cấu hình AI Lead ở Hội sở); thay đổi tự tạo lead BẬT/TẮT vẫn ở `datTuTaoLeadChoPageAction` (cổng riêng, Quản trị tối cao). ───

/** Lưu TOÀN BỘ quy tắc SLA + người nhận thông báo/leo thang (phiên bản MỚI, có lý do). */
export async function luuSlaThongBaoAction(input: unknown): Promise<KetQua<{ version: number }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = luuSlaThongBaoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await luuSlaThongBao(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

/** Ràng buộc THU HẸP của tự tạo lead cho một Page (chỉ đòi thêm điều kiện, không bao giờ nới). */
export async function datRangBuocTuTaoAction(input: unknown): Promise<KetQua<{ version: number }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = rangBuocTuTaoSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datRangBuocTuTao(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

/** Xem trước khôi phục: KHÔNG ghi gì, chỉ liệt kê cột sẽ đổi. */
export async function xemTruocKhoiPhucAction(input: unknown): Promise<KetQua<{ thayDoi: ThayDoiKhoiPhuc[] }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = xemTruocKhoiPhucSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await khoiPhucBoQuyTac(c.ng, { version: p.data.version, lyDo: "Xem trước khôi phục", xemTruoc: true }, await checkAnyPermission(MANAGE));
  return r.ok ? { ok: true, thayDoi: r.thayDoi } : r;
}

export async function khoiPhucBoQuyTacAction(input: unknown): Promise<KetQua<{ version: number }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = khoiPhucBoQuyTacSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  // Quyền bật tự tạo lead hỏi LẠI ở đây (không tin client): khôi phục có thể lật `autoCreate` false→true.
  const r = await khoiPhucBoQuyTac(c.ng, p.data, await checkAnyPermission(MANAGE));
  if (r.ok) lamMoi();
  return r.ok ? { ok: true, version: r.version } : r;
}

/** FIX-03: tắt MỌI Agent TEST đang bật trên máy chủ PROD (không xoá). Máy chủ không phải PROD ⇒ dịch vụ từ chối. */
export async function voHieuHoaAgentTestTrenProdAction(input: unknown): Promise<KetQua<{ soAgent: number; agentIds: string[] }>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = voHieuHoaTestTrenProdSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await voHieuHoaAgentTestTrenProd(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function datContractStatusAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = datContractSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datContractStatus(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function themPageAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(PAGE, LOI_PAGE);
  if (!c.ok) return c;
  const p = themPageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await themPageChoAgent(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function goPageAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(PAGE, LOI_PAGE);
  if (!c.ok) return c;
  const p = goPageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await goPageKhoiAgent(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

/** Tạm dừng / bật lại một Page của một Agent (dùng ở CẢ Cấu hình và Trung tâm kết nối). */
export async function datTrangThaiPageAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(PAGE, LOI_PAGE);
  if (!c.ok) return c;
  const p = trangThaiPageSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datTrangThaiPage(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function datCoSoNhanAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(PAGE, LOI_PAGE);
  if (!c.ok) return c;
  const p = routingSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datCoSoNhanMacDinh(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function luuCoSoXuatBanAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = luuXuatBanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await luuCoSoXuatBan(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function goCoSoXuatBanAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = goXuatBanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await goCoSoXuatBan(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function xuatBanCatalogAction(input: unknown): Promise<KetQua<{ version: number; etag: string }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = xuatBanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await xuatBanCatalog(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

export async function xuatBanLaiAction(input: unknown): Promise<KetQua<{ version: number; etag: string }>> {
  const c = await vaoCong(CAU_HINH, LOI_CAU_HINH);
  if (!c.ok) return c;
  const p = xuatBanLaiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await xuatBanLai(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

/** Cổng PROD: `ai.prodEnabled` / `ai.consentPolicyStatus`. Chỉ đường này (và màn Cấu hình vận hành, dành cho SUPER_ADMIN) ghi được hai khoá. */
export async function doiChinhSachAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(POLICY, LOI_POLICY);
  if (!c.ok) return c;
  const p = doiChinhSachSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const actor = await resolveActor(c.userId);
  const r = await doiChinhSach(actor, c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}

/**
 * Quy tắc theo Page (E2): bật / tắt TỰ TẠO LEAD cho MỘT Page. Gác `ai-integration:manage` (chỉ Quản trị tối cao), KHÔNG phải `ai-leads:configure`:
 * tự tạo lead = tạo lead + chia sale không qua duyệt, nên người cấu hình catalog (Marketing HO) không được tự bật. Lý do ≥ 10 ký tự cả hai chiều.
 */
export async function datTuTaoLeadChoPageAction(input: unknown): Promise<KetQua<object>> {
  const c = await vaoCong(MANAGE, LOI_MANAGE);
  if (!c.ok) return c;
  const p = datTuTaoLeadSchema.safeParse(input);
  if (!p.success) return { ok: false, error: loiDauTien(p.error) };
  const r = await datTuTaoLeadChoPage(c.ng, p.data);
  if (r.ok) lamMoi();
  return r;
}
