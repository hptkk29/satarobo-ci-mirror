"use server";

// app/(admin)/admin/nguon-hoa-hong/affiliate/_actions.ts — Server Action của tab Affiliate: ĐỐI TÁC (tạo · sửa · đổi trạng thái), LOẠI và NHÃN (tạo · sửa · ngừng/bật lại), và ô tìm NHÂN VIÊN
// cho biểu mẫu đối tác.
//
// MỎNG: xác thực → quyền (`affiliates:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ nút ghi: `scope.has("affiliates:manage")`) → zod → cờ (`affiliate.enabled` ∧ `nguon.enabled`) →
// gọi hàm ghi → revalidate. Luật ghi (khoá lạc quan, cổng trước phép ghi, nhật ký cùng transaction) nằm ở `lib/affiliate/ghi-doi-tac.ts` và `ghi-loai-nhan.ts`.
//
// Mọi action trả `KetQuaGhi` (`lib/affiliate/chung.ts`): `{ ok: true, … }` hoặc `{ ok: false, loi, truong? }` — `truong` là tên ô để biểu mẫu gắn câu lỗi đúng chỗ.
//
// Cờ KIỂM THEO QUYỀN, KHÔNG theo trang: người gọi thẳng action khi cờ tắt không được ghi gì (trang 404 khi cờ tắt, nhưng action là một endpoint POST độc lập).
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { doiTrangThaiDoiTac, suaDoiTac, taoDoiTac, type KetQuaDoiTrangThaiDoiTac, type KetQuaSuaDoiTac, type KetQuaTaoDoiTac } from "@/lib/affiliate/ghi-doi-tac";
import { TRANG_THAI_DOI_TAC } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import {
  batTatLoai,
  batTatNhan,
  suaLoai,
  suaNhan,
  taoLoai,
  taoNhan,
  type KetQuaBatTatDanhMuc,
  type KetQuaSuaDanhMuc,
  type KetQuaTaoDanhMuc,
} from "@/lib/affiliate/ghi-loai-nhan";
import { DO_DAI_TIM_TOI_DA, type NguoiDaChon } from "@/lib/nguon/chon-nguon";
import { timNguoiGioiThieu } from "@/lib/nguon/tim-nguoi-gioi-thieu";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";

// Đường dẫn của ROUTE trong app (có `/admin`), không phải địa chỉ đã rewrite theo host — cùng quy ước với tab Nguồn và phần lớn trang admin.
const BASE = "/admin/nguon-hoa-hong/affiliate";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const THIEU_QUYEN = { ok: false, loi: "Không có quyền quản lý đối tác Affiliate (affiliates:manage).", truong: "quyen" } as const;
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

// ── Đối tác ───────────────────────────────────────────────────────────────────────────────────────

const taoInput = z.object({ vao: dauVaoThuong });
const suaDoiTacInput = z.object({ id: idChuoi, updatedAtDaThay: moc, vao: dauVaoThuong, lyDo });
const doiTrangThaiInput = z.object({ id: idChuoi, updatedAtDaThay: moc, den: z.enum(TRANG_THAI_DOI_TAC), lyDo });

export async function taoDoiTacAction(input: unknown): Promise<KetQuaTaoDoiTac> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = taoInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await taoDoiTac({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

export async function suaDoiTacAction(input: unknown): Promise<KetQuaSuaDoiTac> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = suaDoiTacInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await suaDoiTac({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    vao: parsed.data.vao,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok && kq.doi) revalidatePath(BASE);
  return kq;
}

export async function doiTrangThaiDoiTacAction(input: unknown): Promise<KetQuaDoiTrangThaiDoiTac> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = doiTrangThaiInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await doiTrangThaiDoiTac({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    den: parsed.data.den,
    lyDo: parsed.data.lyDo,
    now: new Date(),
  });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

// ── Loại ──────────────────────────────────────────────────────────────────────────────────────────

const suaDanhMucInput = z.object({ id: idChuoi, updatedAtDaThay: moc, vao: dauVaoThuong });
const batTatInput = z.object({ id: idChuoi, updatedAtDaThay: moc, batLai: z.boolean(), lyDo });

export async function taoLoaiAction(input: unknown): Promise<KetQuaTaoDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = taoInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await taoLoai({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

export async function suaLoaiAction(input: unknown): Promise<KetQuaSuaDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = suaDanhMucInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await suaLoai({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: parsed.data.id, updatedAtDaThay: parsed.data.updatedAtDaThay, vao: parsed.data.vao });
  if (kq.ok && kq.doi) revalidatePath(BASE);
  return kq;
}

export async function batTatLoaiAction(input: unknown): Promise<KetQuaBatTatDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = batTatInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await batTatLoai({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    batLai: parsed.data.batLai,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

// ── Nhãn ──────────────────────────────────────────────────────────────────────────────────────────

export async function taoNhanAction(input: unknown): Promise<KetQuaTaoDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = taoInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await taoNhan({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

export async function suaNhanAction(input: unknown): Promise<KetQuaSuaDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = suaDanhMucInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await suaNhan({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, id: parsed.data.id, updatedAtDaThay: parsed.data.updatedAtDaThay, vao: parsed.data.vao });
  if (kq.ok && kq.doi) revalidatePath(BASE);
  return kq;
}

export async function batTatNhanAction(input: unknown): Promise<KetQuaBatTatDanhMuc> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliates:manage"))) return THIEU_QUYEN;
  const parsed = batTatInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await batTatNhan({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    batLai: parsed.data.batLai,
    lyDo: parsed.data.lyDo,
  });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

// ── Ô tìm nhân viên (biểu mẫu đối tác) ────────────────────────────────────────────────────────────

const timNhanVienInput = z.object({ q: z.string().max(DO_DAI_TIM_TOI_DA * 2) });
type KetQuaTimNhanVien = { ok: true; ketQua: NguoiDaChon[] } | { ok: false; error: string };

/**
 * KHÔNG dùng `timNguoiGioiThieuAction` của module Nguồn: nó gác bằng bốn khoá GHI NGUỒN LEAD (không có `affiliates:manage`), nên Marketing Hội sở — người duy nhất ngoài Quản trị
 * giữ `affiliates:manage` — sẽ nhận «Không có quyền». Ô này gác đúng khoá mà nút «Tạo đối tác» dùng.
 * Chỉ trả tên + mã nhân viên + vai (không SĐT/email/lương — `timNguoiGioiThieu` loại NHAN_SU đã đảm bảo).
 */
export async function timNhanVienAction(input: unknown): Promise<KetQuaTimNhanVien> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("affiliates:manage"))) return { ok: false, error: THIEU_QUYEN.loi };
  const parsed = timNhanVienInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dữ liệu không hợp lệ" };
  if (!(await docCoModule()).affiliate) return { ok: false, error: CO_TAT.loi };

  const actor = await resolveActor(session.user.id);
  const ketQua = await timNguoiGioiThieu(actor, { loai: "NHAN_SU", q: parsed.data.q, gioiHan: 8, coTheTimTheoSdt: false, canViewPii: false, now: new Date() });
  return { ok: true, ketQua };
}
