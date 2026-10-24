"use server";

// app/(admin)/admin/nguon-hoa-hong/referral/_actions.ts — Server Action của tab Referral: XỬ LÝ TAY (duyệt · từ chối · tranh chấp · xin/bổ sung bằng chứng), KHAI TAY, và ô tìm phiếu khách (AFF-L3b).
//
// MỎNG: xác thực → quyền (`affiliate_referrals:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ nút: `scope.has("affiliate_referrals:manage")`) → zod → cờ (`affiliate.enabled` ∧ `nguon.enabled`)
// → gọi hàm ghi → revalidate. Luật ghi (cách ly cơ sở, khoá lạc quan, máy trạng thái, ghi attribution, nhật ký) ở `lib/affiliate/ghi-referral-xu-ly.ts`.
//
// KHÔNG có ô tiền / tỉ lệ / nguồn ở bất kỳ action nào: schema `.strict()` từ chối khoá lạ. Cờ kiểm THEO QUYỀN, không theo trang (action là một endpoint POST độc lập).
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkAnyPermission, checkPermission } from "@/lib/auth/check-permission";
import { khaiTayReferral, xuLyReferral, type KetQuaKhaiTay, type KetQuaXuLyReferral } from "@/lib/affiliate/ghi-referral-xu-ly";
import { timPhieuKhaiTay, type KetQuaTimPhieu } from "@/lib/affiliate/doc-xu-ly-referral";
import { HANH_DONG_XU_LY } from "@/lib/affiliate/xu-ly-referral";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";

const BASE = "/admin/nguon-hoa-hong/referral";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const THIEU_QUYEN = { ok: false, loi: "Không có quyền xử lý referral (affiliate_referrals:manage).", truong: "quyen" } as const;
const CO_TAT = { ok: false, loi: "Affiliate chưa được bật.", truong: "quyen" } as const;
const DU_LIEU_SAI = (loi: string | undefined) => ({ ok: false, loi: loi ?? "Dữ liệu không hợp lệ", truong: "chung" }) as const;

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";

const moc = z
  .string()
  .min(1)
  .max(40)
  .transform((v) => new Date(v))
  .refine((d) => !Number.isNaN(d.getTime()), "Mốc thời gian không hợp lệ");

// `lyDo` / `ghiChu` KHÔNG ràng độ dài ở đây: `xuLyReferral` kiểm bằng cùng bộ luật với giao diện và trả câu lỗi theo ô.
const xuLyInput = z
  .object({
    id: z.string().trim().min(1).max(64),
    hanhDong: z.enum(HANH_DONG_XU_LY),
    updatedAtDaThay: moc,
    lyDo: z.string().max(2000),
    ghiChu: z.string().max(4000).nullish(),
  })
  .strict();

export async function xuLyReferralAction(input: unknown): Promise<KetQuaXuLyReferral> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_referrals:manage"))) return THIEU_QUYEN;
  const parsed = xuLyInput.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const actor = await resolveActor(session.user.id);
  const kq = await xuLyReferral({
    actor,
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    referralId: parsed.data.id,
    hanhDong: parsed.data.hanhDong,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    lyDo: parsed.data.lyDo,
    ghiChu: parsed.data.ghiChu ?? null,
    now: new Date(),
  });
  if (kq.ok) {
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.id}`);
  }
  return kq;
}

export async function khaiTayReferralAction(input: unknown): Promise<KetQuaKhaiTay> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_referrals:manage"))) return THIEU_QUYEN;
  // Kiểm cờ TRƯỚC khi parse: input rác không được lộ câu lỗi của schema khi module đang tắt.
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const actor = await resolveActor(session.user.id);
  const kq = await khaiTayReferral({ actor, nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: input, now: new Date() });
  if (kq.ok) revalidatePath(BASE);
  return kq;
}

const timInput = z.object({ q: z.string().max(80) }).strict();

export type KetQuaTimPhieuAction = { ok: true; phieu: KetQuaTimPhieu[] } | { ok: false; loi: string };

export async function timPhieuKhaiTayAction(input: unknown): Promise<KetQuaTimPhieuAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, loi: CHUA_DANG_NHAP.loi };
  if (!(await checkPermission("affiliate_referrals:manage"))) return { ok: false, loi: THIEU_QUYEN.loi };
  const parsed = timInput.safeParse(input);
  if (!parsed.success) return { ok: false, loi: "Dữ liệu không hợp lệ" };
  if (!(await docCoModule()).affiliate) return { ok: false, loi: CO_TAT.loi };

  const [actor, xemKhach, xemPii] = await Promise.all([
    resolveActor(session.user.id),
    checkAnyPermission(["leads:view-all", "leads:view-own"]),
    checkPermission("leads:view-pii"),
  ]);
  return { ok: true, phieu: await timPhieuKhaiTay(actor, parsed.data.q, { xemKhach, xemPii }) };
}
