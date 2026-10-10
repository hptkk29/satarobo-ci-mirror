"use server";

// app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts — Server Action của tab Nguồn: bảng Page mapping (06 §5.1) + GHI DANH MỤC NGUỒN
// (`taoNguonAction` · `suaNguonAction` · `doiTrangThaiNguonAction` — SPEC nguồn động §4).
//
// MỎNG: xác thực → quyền (`sources:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ ô sửa) → cờ → gọi hàm ghi.
// Luật ghi (khoá lạc quan, cổng trước phép ghi, audit) nằm ở `lib/nguon/bang-nguon-theo-page.ts` (Page) và `lib/nguon/danh-muc-ghi.ts` (danh mục).
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { luuNguonCuaPage } from "@/lib/nguon/bang-nguon-theo-page";
import { doiTrangThaiNguon, suaNguon, taoNguon } from "@/lib/nguon/danh-muc-ghi";
import { TRANG_THAI_NGUON } from "@/lib/nguon/danh-muc-ghi-dau-vao";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { coQuyenKichHoatChinhSach } from "@/lib/nguon/quyen-kich-hoat";
import type { KetQuaDoiTrangThaiAction, KetQuaLuuPageAction, KetQuaSuaNguonAction, KetQuaTaoNguonAction } from "@/lib/nguon/ket-qua-action";

const luuPageSchema = z.object({
  pageId: z.string().trim().min(1).max(128),
  groupCode: z.string().trim().min(1).max(64).nullable(),
  campaignCode: z.string().max(200).nullish().transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  /** Lý do đổi nguồn của Page (≥ 10 ký tự khi nguồn đổi — cổng ở `luuNguonCuaPage`). */
  lyDo: z.string().max(500).nullish().transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
});

export async function luuPageMappingAction(input: unknown): Promise<KetQuaLuuPageAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền sửa nguồn của Page (sources:manage).", field: "quyen" };
  }
  const parsed = luuPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  const actor = await resolveActor(session.user.id);
  // Gán Page → nguồn là đổi người nhận hoa hồng của mọi lead tương lai: nguồn cũ/mới dính tiền thì cần thêm `commission_policies:activate` (cờ, KHÔNG phải cổng của action — xem `quyen-kich-hoat.ts`).
  const coQuyenKichHoat = await coQuyenKichHoatChinhSach();
  const kq = await luuNguonCuaPage({
    actor,
    actorName: session.user.name ?? session.user.email ?? "Nhân viên",
    pageId: parsed.data.pageId,
    groupCode: parsed.data.groupCode,
    campaignCode: parsed.data.campaignCode,
    lyDo: parsed.data.lyDo,
    coQuyenKichHoat,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  if (kq.doi) revalidatePath("/admin/nguon-hoa-hong/nguon");
  return { ok: true, doi: kq.doi };
}

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";
const dauVaoThuong = z.record(z.string(), z.unknown());
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
const suaSchema = z.object({ id: z.string().trim().min(1).max(64), updatedAtDaThay: moc, vao: dauVaoThuong, lyDo });
const doiTrangThaiSchema = z.object({ id: z.string().trim().min(1).max(64), updatedAtDaThay: moc, den: z.enum(TRANG_THAI_NGUON), lyDo });

export async function taoNguonAction(input: unknown): Promise<KetQuaTaoNguonAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền tạo nguồn (sources:manage).", field: "quyen" };
  }
  const parsed = taoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  // Tạo nguồn HOẠT ĐỘNG có người phụ trách khi rule chủ-nguồn chạy là bắt đầu trả tiền — cùng cờ quyền với sửa nguồn (cổng ghi quyết định có cần không).
  const coQuyenKichHoat = await coQuyenKichHoatChinhSach();
  const kq = await taoNguon({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao, coQuyenKichHoat });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  revalidatePath("/admin/nguon-hoa-hong/nguon");
  return { ok: true, id: kq.id, code: kq.code, updatedAt: kq.updatedAt, canhBao: kq.canhBao };
}

export async function suaNguonAction(input: unknown): Promise<KetQuaSuaNguonAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền sửa nguồn (sources:manage).", field: "quyen" };
  }
  const parsed = suaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  // Đổi người phụ trách / «tham gia hoa hồng» / cửa sổ ghi công của nguồn ĐANG DÍNH TIỀN đòi thêm `commission_policies:activate` (không đẻ quyền mới). Cổng ghi quyết định
  // lượt sửa nào cần nó (nó biết nguồn có chính sách đang chạy / dòng sổ không); action chỉ cho biết người sửa CÓ quyền ấy không — hỏi qua `can()`, không so vai.
  const coQuyenKichHoat = await coQuyenKichHoatChinhSach();
  const kq = await suaNguon({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    vao: parsed.data.vao,
    lyDo: parsed.data.lyDo,
    coQuyenKichHoat,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  if (kq.doi) revalidatePath("/admin/nguon-hoa-hong/nguon", "layout");
  return { ok: true, doi: kq.doi, updatedAt: kq.updatedAt, canhBao: kq.canhBao };
}

export async function doiTrangThaiNguonAction(input: unknown): Promise<KetQuaDoiTrangThaiAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền đổi trạng thái nguồn (sources:manage).", field: "quyen" };
  }
  const parsed = doiTrangThaiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };

  // Ngừng / lưu trữ / kích hoạt nguồn đang dính tiền đòi thêm `commission_policies:activate` (cờ, không phải cổng của action).
  const coQuyenKichHoat = await coQuyenKichHoatChinhSach();
  const kq = await doiTrangThaiNguon({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    den: parsed.data.den,
    lyDo: parsed.data.lyDo,
    coQuyenKichHoat,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  revalidatePath("/admin/nguon-hoa-hong/nguon", "layout");
  return { ok: true, den: kq.den, updatedAt: kq.updatedAt };
}
