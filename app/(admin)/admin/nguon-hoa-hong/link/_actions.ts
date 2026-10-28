"use server";

// app/(admin)/admin/nguon-hoa-hong/link/_actions.ts — Server Action của tab «Link / QR / Mã»: PHÁT · THU HỒI · XOAY link và DỰNG QR.
//
// MỎNG: xác thực → quyền (`affiliate_links:manage`, gác Ở ĐẦU HÀM — đúng khoá mà giao diện dùng để vẽ nút ghi: `scope.has("affiliate_links:manage")`) → zod → cờ
// (`affiliate.enabled` ∧ `nguon.enabled`) → gọi hàm ghi → revalidate. Luật ghi (khoá lạc quan, cổng trước phép ghi, `kiemLienKet` dùng chung, nhật ký cùng transaction)
// nằm ở `lib/affiliate/ghi-link.ts`.
//
// `taoQrAction` cũng gác `affiliate_links:manage`: QR mã hoá TOKEN ĐẦY ĐỦ, mà người chỉ có `affiliates:view` không được nhận token đầy đủ. QR dựng THEO YÊU CẦU ở đây (không dựng sẵn cho từng
// dòng ở RSC) và chỉ cho link ĐANG HOẠT ĐỘNG; thư viện `qrcode` không bao giờ vào bundle trình duyệt.
//
// Cờ KIỂM THEO QUYỀN, KHÔNG theo trang: trang 404 khi cờ tắt, nhưng action là một endpoint POST độc lập.
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { docLinkChoQr } from "@/lib/affiliate/doc-link";
import { dungUrlChuyenHuong } from "@/lib/affiliate/dung-url-theo-doi";
import { LY_DO_THIEU_GOC, gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { phatLink, thuHoiLink, xoayLink, type KetQuaPhatLink, type KetQuaThuHoiLink, type KetQuaXoayLink } from "@/lib/affiliate/ghi-link";
import { dungQrChoToken, svgThanhDataUri } from "@/lib/affiliate/qr-link";
import { docCoModule } from "@/lib/nguon-hoa-hong/module-scope";

const TRANG = "/admin/nguon-hoa-hong/link";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const THIEU_QUYEN = { ok: false, loi: "Không có quyền quản lý link giới thiệu (affiliate_links:manage).", truong: "quyen" } as const;
const CO_TAT = { ok: false, loi: "Affiliate chưa được bật.", truong: "quyen" } as const;
const DU_LIEU_SAI = (loi: string | undefined) => ({ ok: false, loi: loi ?? "Dữ liệu không hợp lệ", truong: "chung" }) as const;

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";

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

const phatSchema = z.object({ vao: z.record(z.string(), z.unknown()) });
const thuHoiSchema = z.object({ id: idChuoi, updatedAtDaThay: moc, lyDo });
const qrSchema = z.object({ id: idChuoi });

export type KetQuaQr = { ok: true; dataUri: string; tenTep: string; lienKetNgan: string } | { ok: false; loi: string; truong?: string };

export async function phatLinkAction(input: unknown): Promise<KetQuaPhatLink> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_links:manage"))) return THIEU_QUYEN;
  const parsed = phatSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await phatLink({ nguoi: { userId: session.user.id, ten: tenNguoi(session.user) }, vao: parsed.data.vao, now: new Date() });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function thuHoiLinkAction(input: unknown): Promise<KetQuaThuHoiLink> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_links:manage"))) return THIEU_QUYEN;
  const parsed = thuHoiSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await thuHoiLink({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    lyDo: parsed.data.lyDo,
    now: new Date(),
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function xoayLinkAction(input: unknown): Promise<KetQuaXoayLink> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_links:manage"))) return THIEU_QUYEN;
  const parsed = thuHoiSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const kq = await xoayLink({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    id: parsed.data.id,
    updatedAtDaThay: parsed.data.updatedAtDaThay,
    lyDo: parsed.data.lyDo,
    now: new Date(),
  });
  if (kq.ok) revalidatePath(TRANG);
  return kq;
}

export async function taoQrAction(input: unknown): Promise<KetQuaQr> {
  const session = await auth();
  if (!session?.user?.id) return CHUA_DANG_NHAP;
  if (!(await checkPermission("affiliate_links:manage"))) return THIEU_QUYEN;
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return DU_LIEU_SAI(parsed.error.issues[0]?.message);
  if (!(await docCoModule()).affiliate) return CO_TAT;

  const link = await docLinkChoQr(parsed.data.id);
  if (!link) return { ok: false, loi: "Không tìm thấy link này.", truong: "khongTimThay" };
  if (link.status !== "ACTIVE") return { ok: false, loi: "Link này đã thu hồi — không tạo QR cho link đã thu hồi.", truong: "trangThai" };
  // Gốc link ngắn do CẤU HÌNH quyết (mỗi môi trường một gốc) — thiếu thì nói thẳng, KHÔNG đoán sang prod: QR in ra mà trỏ nhầm môi trường là QR chết.
  const goc = gocCongKhai(process.env);
  if (goc === null) return { ok: false, loi: LY_DO_THIEU_GOC, truong: "cauHinh" };
  const svg = await dungQrChoToken(goc, link.token);
  return { ok: true, dataUri: svgThanhDataUri(svg), tenTep: `qr-${link.token}.svg`, lienKetNgan: dungUrlChuyenHuong(goc, link.token) };
}
