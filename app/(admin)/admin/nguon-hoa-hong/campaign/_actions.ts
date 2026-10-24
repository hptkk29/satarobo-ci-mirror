"use server";

// app/(admin)/admin/nguon-hoa-hong/campaign/_actions.ts — Server Action của tab Campaign Affiliate (AFF-P0b): GHI campaign · quy tắc quy nguồn · website · thành viên.
//
// MỎNG: xác thực → quyền (gác Ở ĐẦU HÀM, đúng khoá mà giao diện dùng để vẽ nút — luật 12) → zod → cờ → gọi hàm ghi → làm mới trang.
// Luật ghi (khoá lạc quan, thứ tự khoá, cổng trước phép ghi, audit cùng transaction) nằm ở `lib/affiliate/ghi-campaign.ts` / `ghi-membership.ts`; luật ĐƯỢC / KHÔNG ĐƯỢC ở các tệp `*-dau-vao.ts`.
//
// BA khoá, không lẫn:
//   · `affiliate_campaigns:manage`   — soạn campaign, quy tắc, website;
//   · `affiliate_campaigns:activate` — CHỈ đổi trạng thái (kích hoạt · tạm dừng · chạy lại · kết thúc). Có `manage` mà thiếu `activate` KHÔNG kích hoạt được;
//   · `affiliate_memberships:manage` — thêm / duyệt / tạm ngừng / kết thúc thành viên.
// Cờ `affiliate.enabled` ∧ `nguon.enabled` (qua `docCoModule().affiliate`): tab 404 khi tắt, nên đường ghi cũng đóng — một lời gọi thẳng không được lách màn 404. Hỏi SAU cổng quyền (người
// không có quyền không dò được cờ đang bật hay tắt); đọc cờ hỏng ⇒ TẮT (fail-closed).
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async (kiểu kết quả nằm ở `lib/affiliate/*-dau-vao.ts`).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { datCheDoThuong, datTrangDichCampaign, doiTrangThaiCampaign, ganWebsite, goWebsite, suaCampaign, taoCampaign, themQuyTac, xoaQuyTac } from "@/lib/affiliate/ghi-campaign";
import { CHE_DO_THUONG, TRANG_THAI_CAMPAIGN, type KetQuaDatTrangDich, type KetQuaDoiCheDoThuong, type KetQuaDoiTrangThaiCampaign, type KetQuaSuaCampaign, type KetQuaTaoCampaign, type KetQuaViecCon } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { doiTrangThaiMembership, suaMembership, themMembership } from "@/lib/affiliate/ghi-membership";
import { TRANG_THAI_MEMBERSHIP, type KetQuaDoiMembership, type KetQuaSuaMembership, type KetQuaThemMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";

const CHUA_DANG_NHAP = "Chưa đăng nhập";
const MODULE_TAT = "Affiliate chưa được bật.";

const thieuQuyen = (key: string, viec: string) => ({ ok: false as const, loi: `Không có quyền ${viec} (${key}).`, truong: "quyen" });

async function moduleBat(): Promise<boolean> {
  try {
    return (await docCoModule()).affiliate;
  } catch {
    return false;
  }
}

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";
const dauVaoThuong = z.record(z.string(), z.unknown());
const id = z.string().trim().min(1).max(64);
const moc = z
  .string()
  .min(1)
  .max(40)
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Mốc thời gian không hợp lệ");
const lyDo = z
  .string()
  .max(500)
  .nullish()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

function lamMoi() {
  revalidatePath("/nguon-hoa-hong/campaign", "layout");
}

const loiDauVao = (e: z.ZodError) => ({ ok: false as const, loi: e.issues[0]?.message ?? "Dữ liệu không hợp lệ" });

// ── Campaign ─────────────────────────────────────────────────────────────────────────────────────────────────

const taoSchema = z.object({ vao: dauVaoThuong });

export async function taoCampaignAction(input: unknown): Promise<KetQuaTaoCampaign> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "tạo campaign");
  const p = taoSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await taoCampaign({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: p.data.vao, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

const suaSchema = z.object({ id, updatedAtDaThay: moc, vao: dauVaoThuong, lyDo });

export async function suaCampaignAction(input: unknown): Promise<KetQuaSuaCampaign> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "sửa campaign");
  const p = suaSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await suaCampaign({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: p.data.id, updatedAtDaThay: p.data.updatedAtDaThay, vao: p.data.vao, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok && kq.doi) lamMoi();
  return kq;
}

const doiTrangThaiSchema = z.object({ id, updatedAtDaThay: moc, den: z.enum(TRANG_THAI_CAMPAIGN), lyDo });

export async function doiTrangThaiCampaignAction(input: unknown): Promise<KetQuaDoiTrangThaiCampaign> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  // Kích hoạt · tạm dừng · chạy lại · kết thúc đều là `activate` — KHÔNG phải `manage`. Điểm chạm tiền gián tiếp: campaign ACTIVE là lúc đối tác bắt đầu được ghi công.
  if (!(await checkPermission("affiliate_campaigns:activate"))) return thieuQuyen("affiliate_campaigns:activate", "kích hoạt / tạm dừng / kết thúc campaign");
  const p = doiTrangThaiSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await doiTrangThaiCampaign({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: p.data.id, updatedAtDaThay: p.data.updatedAtDaThay, den: p.data.den, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

// ── Lựa chọn «thưởng» (AFF-L1) ───────────────────────────────────────────────────────────────────────────────

const cheDoThuongSchema = z.object({ id, updatedAtDaThay: moc, den: z.enum(CHE_DO_THUONG), lyDo });

/** Chọn «có thưởng theo chính sách riêng» / «không có mức riêng». Khoá `affiliate_campaigns:manage` — đúng khoá mà mục Hoa hồng dùng để vẽ nút chọn. */
export async function datCheDoThuongAction(input: unknown): Promise<KetQuaDoiCheDoThuong> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "đổi lựa chọn thưởng của campaign");
  const p = cheDoThuongSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await datCheDoThuong({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: p.data.id, updatedAtDaThay: p.data.updatedAtDaThay, den: p.data.den, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok && kq.doi) lamMoi();
  return kq;
}

// ── Quy tắc quy nguồn ────────────────────────────────────────────────────────────────────────────────────────

const themQuyTacSchema = z.object({ campaignId: id, vao: dauVaoThuong, lyDo });

export async function themQuyTacAction(input: unknown): Promise<KetQuaViecCon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "đổi quy tắc quy nguồn");
  const p = themQuyTacSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await themQuyTac({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, campaignId: p.data.campaignId, vao: p.data.vao, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

const xoaQuyTacSchema = z.object({ campaignId: id, ruleId: id, lyDo });

export async function xoaQuyTacAction(input: unknown): Promise<KetQuaViecCon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "đổi quy tắc quy nguồn");
  const p = xoaQuyTacSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await xoaQuyTac({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, campaignId: p.data.campaignId, ruleId: p.data.ruleId, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

// ── Website ──────────────────────────────────────────────────────────────────────────────────────────────────

const websiteSchema = z.object({ campaignId: id, siteId: id });

export async function ganWebsiteAction(input: unknown): Promise<KetQuaViecCon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "gắn website vào campaign");
  const p = websiteSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await ganWebsite({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, campaignId: p.data.campaignId, siteId: p.data.siteId, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

const goWebsiteSchema = z.object({ campaignId: id, siteId: id, lyDo });

export async function goWebsiteAction(input: unknown): Promise<KetQuaViecCon> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "gỡ website khỏi campaign");
  const p = goWebsiteSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await goWebsite({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, campaignId: p.data.campaignId, siteId: p.data.siteId, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

// ── Trang đích của campaign (AFF-L6) ─────────────────────────────────────────────────────────────────────────

const datTrangDichSchema = z.object({ campaignId: id, siteId: id, landingPageIds: z.array(id).max(500), xacNhan: z.boolean(), lyDo }).strict();

export async function datTrangDichCampaignAction(input: unknown): Promise<KetQuaDatTrangDich> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_campaigns:manage"))) return thieuQuyen("affiliate_campaigns:manage", "chọn trang đích của campaign");
  const p = datTrangDichSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await datTrangDichCampaign({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    campaignId: p.data.campaignId,
    siteId: p.data.siteId,
    landingPageIds: p.data.landingPageIds,
    xacNhan: p.data.xacNhan,
    lyDo: p.data.lyDo,
    now: new Date(),
  });
  if (kq.ok) lamMoi();
  return kq;
}

// ── Thành viên ───────────────────────────────────────────────────────────────────────────────────────────────

const themMembershipSchema = z.object({ campaignId: id, vao: dauVaoThuong });

export async function themMembershipAction(input: unknown): Promise<KetQuaThemMembership> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_memberships:manage"))) return thieuQuyen("affiliate_memberships:manage", "thêm đối tác vào campaign");
  const p = themMembershipSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await themMembership({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, campaignId: p.data.campaignId, vao: p.data.vao, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

const doiMembershipSchema = z.object({ id, updatedAtDaThay: moc, den: z.enum(TRANG_THAI_MEMBERSHIP), lyDo });

export async function doiTrangThaiMembershipAction(input: unknown): Promise<KetQuaDoiMembership> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_memberships:manage"))) return thieuQuyen("affiliate_memberships:manage", "đổi trạng thái thành viên");
  const p = doiMembershipSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await doiTrangThaiMembership({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: p.data.id, updatedAtDaThay: p.data.updatedAtDaThay, den: p.data.den, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok) lamMoi();
  return kq;
}

const suaMembershipActionSchema = z.object({ id, updatedAtDaThay: moc, vao: dauVaoThuong, lyDo });

export async function suaMembershipAction(input: unknown): Promise<KetQuaSuaMembership> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP };
  if (!(await checkPermission("affiliate_memberships:manage"))) return thieuQuyen("affiliate_memberships:manage", "sửa thành viên");
  const p = suaMembershipActionSchema.safeParse(input);
  if (!p.success) return loiDauVao(p.error);
  if (!(await moduleBat())) return { ok: false, loi: MODULE_TAT };
  const kq = await suaMembership({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: p.data.id, updatedAtDaThay: p.data.updatedAtDaThay, vao: p.data.vao, lyDo: p.data.lyDo, now: new Date() });
  if (kq.ok && kq.doi) lamMoi();
  return kq;
}
