"use server";

// app/(admin)/admin/nguon-hoa-hong/website/_actions.ts — Server Action của tab Website: WEBSITE (tạo · sửa · ngừng/bật lại · xoá) và TRANG ĐÍCH (thêm · sửa · bật/tắt).
//
// MỎNG: xác thực → quyền (`affiliate_campaigns:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ nút ghi: `scope.has("affiliate_campaigns:manage")`) → zod → cờ
// (`affiliate.enabled` ∧ `nguon.enabled`) → gọi hàm ghi → revalidate. Luật ghi (khoá lạc quan, cổng trước phép ghi, host ∈ tên miền được phép trong transaction, nhật ký cùng
// transaction) nằm ở `lib/affiliate/ghi-website.ts`; luật so tên miền/đường dẫn ở `lib/affiliate/website-hop-le.ts`.
//
// Mọi action trả `KetQuaGhi` (`lib/affiliate/chung.ts`): `{ ok: true, … }` hoặc `{ ok: false, loi, truong? }` — `truong` là tên ô để biểu mẫu gắn câu lỗi đúng chỗ.
//
// Cờ KIỂM THEO QUYỀN, KHÔNG theo trang: người gọi thẳng action khi cờ tắt không được ghi gì (trang 404 khi cờ tắt, nhưng action là một endpoint POST độc lập).
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  batTatTrangDich,
  doiTrangThaiWebsite,
  suaTrangDich,
  suaWebsite,
  taoWebsite,
  themTrangDich,
  xoaWebsite,
  type KetQuaBatTatTrangDich,
  type KetQuaDoiTrangThaiWebsite,
  type KetQuaSuaWebsite,
  type KetQuaTaoWebsite,
  type KetQuaTrangDich,
  type KetQuaXoaWebsite,
} from "@/lib/affiliate/ghi-website";
import { TRANG_THAI_WEBSITE } from "@/lib/affiliate/ghi-website-dau-vao";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";

const TRANG = "/admin/nguon-hoa-hong/website";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const THIEU_QUYEN = { ok: false, loi: "Không có quyền quản lý website Affiliate (affiliate_campaigns:manage).", truong: "quyen" } as const;
const CO_TAT = { ok: false, loi: "Affiliate chưa được bật.", truong: "quyen" } as const;
const DU_LIEU_SAI = (loi: string | undefined) => ({ ok: false, loi: loi ?? "Dữ liệu không hợp lệ", truong: "chung" }) as const;

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";

const dauVaoThuong = z.record(z.string(), z.unknown());
const idChuoi = z.string().trim().min(1).max(64);
/** Mốc `updatedAt` mà người dùng đã thấy (ISO). */
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

const taoSchema = z.object({ vao: dauVaoThuong });
const suaSchema = z.object({ id: idChuoi, updatedAtDaThay: moc, vao: dauVaoThuong, lyDo });
const doiTrangThaiSchema = z.object({ id: idChuoi, updatedAtDaThay: moc, den: z.enum(TRANG_THAI_WEBSITE), lyDo });
const xoaSchema = z.object({ id: idChuoi, updatedAtDaThay: moc, lyDo });
const batTatSchema = z.object({ id: idChuoi, updatedAtDaThay: moc, den: z.boolean(), lyDo });

// ── Website ───────────────────────────────────────────────────────────────────────────────────────

export async function taoWebsiteAction(input: unknown): Promise<KetQuaTaoWebsite> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = taoSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await taoWebsite({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function suaWebsiteAction(input: unknown): Promise<KetQuaSuaWebsite> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = suaSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await suaWebsite({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    vao: parsed.data.vao,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok && kq.doi) revalidatePath(TRANG);
  return kq;
}

export async function doiTrangThaiWebsiteAction(input: unknown): Promise<KetQuaDoiTrangThaiWebsite> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = doiTrangThaiSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await doiTrangThaiWebsite({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    den: parsed.data.den,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function xoaWebsiteAction(input: unknown): Promise<KetQuaXoaWebsite> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = xoaSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await xoaWebsite({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

// ── Trang đích ────────────────────────────────────────────────────────────────────────────────────

export async function themTrangDichAction(input: unknown): Promise<KetQuaTrangDich> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = taoSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await themTrangDich({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function suaTrangDichAction(input: unknown): Promise<KetQuaTrangDich> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = suaSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await suaTrangDich({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    vao: parsed.data.vao,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function batTatTrangDichAction(input: unknown): Promise<KetQuaBatTatTrangDich> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_campaigns:manage"))) return THIEU_QUYEN;
  const parsed = batTatSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await batTatTrangDich({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    den: parsed.data.den,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}
