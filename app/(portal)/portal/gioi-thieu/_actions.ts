"use server";

// app/(portal)/portal/gioi-thieu/_actions.ts — Server Action của trang «Giới thiệu bạn bè» (AFF-WEB): ĐỐI TÁC TỰ TẠO LINK và xin QR cho link CỦA CHÍNH MÌNH.
//
// MỎNG: xác thực (PHIÊN) → cờ + «tài khoản này có phải đối tác không» (`coGioiThieuChoNguoiDung`, cùng định nghĩa với menu và trang) → gọi lõi. Sự cô lập KHÔNG nằm ở đây mà ở truy vấn trong lõi:
// `tuTaoLink` suy `partyId` từ `Affiliate.userId = <phiên>` (client chỉ gửi membershipId / siteId / trang đích — mọi khoá khác bị lược đồ `.strict()` từ chối) và đi qua ĐÚNG `phatLink` của Admin
// (quota link/membership, cổng chuỗi, nhật ký). `taoQrCuaToiAction` tra link theo `party.userId` — id của người khác ra cùng kết quả với id không tồn tại.
//
// Không có khoá quyền riêng và KHÔNG so vai ở đây (lint `no-inline-authz` cấm `.role ===` trong Server Action): quyền ở cổng này là «bạn có hồ sơ đối tác» — DỮ LIỆU SỞ HỮU (`Affiliate.userId`),
// nên người gọi chỉ chạm được hồ sơ của CHÍNH mình dù vai gì. Việc chỉ PARENT mới THẤY trang là cổng của `page.tsx` + layout cổng. Thêm khoá RBAC mới nghĩa là phải bấm seed vai trên môi trường rồi mới dùng được.
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { coGioiThieuChoNguoiDung } from "@/lib/affiliate/doc-cua-toi";
import { docLinkChoQrCuaToi } from "@/lib/affiliate/doc-link";
import { dungUrlChuyenHuong } from "@/lib/affiliate/dung-url-theo-doi";
import type { KetQuaPhatLink } from "@/lib/affiliate/ghi-link";
import { LY_DO_THIEU_GOC, gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { dungQrChoToken, svgThanhDataUri } from "@/lib/affiliate/qr-link";
import { tuTaoLink } from "@/lib/affiliate/tu-tao-link";
import { auth } from "@/lib/auth";

const TRANG = "/portal/gioi-thieu";
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const KHONG_PHAI_DOI_TAC = { ok: false, loi: "Tài khoản này chưa là đối tác giới thiệu.", truong: "quyen" } as const;

export type KetQuaTaoLinkCuaToi = { ok: true; id: string } | { ok: false; loi: string; truong?: string };
export type KetQuaQrCuaToi = { ok: true; dataUri: string; tenTep: string; lienKetNgan: string } | { ok: false; loi: string; truong?: string };

/** Người đang đăng nhập, hoặc null. userId lấy từ PHIÊN — không từ tham số. */
async function nguoiDung(): Promise<{ id: string; ten: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, ten: session.user.name ?? session.user.email ?? "Đối tác" };
}

export async function taoLinkCuaToiAction(input: unknown): Promise<KetQuaTaoLinkCuaToi> {
  const u = await nguoiDung();
  if (!u) return CHUA_DANG_NHAP;
  if (!(await coGioiThieuChoNguoiDung(u.id))) return KHONG_PHAI_DOI_TAC;

  const kq: KetQuaPhatLink = await tuTaoLink({ nguoi: { userId: u.id, ten: u.ten }, vao: input, now: new Date() });
  if (!kq.ok) return { ok: false, loi: kq.loi, truong: kq.truong };
  revalidatePath(TRANG);
  return { ok: true, id: kq.id };
}

const qrSchema = z.object({ id: z.string().trim().min(1).max(64) }).strict();

export async function taoQrCuaToiAction(input: unknown): Promise<KetQuaQrCuaToi> {
  const u = await nguoiDung();
  if (!u) return CHUA_DANG_NHAP;
  if (!(await coGioiThieuChoNguoiDung(u.id))) return KHONG_PHAI_DOI_TAC;
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return { ok: false, loi: "Dữ liệu không hợp lệ.", truong: "chung" };

  const link = await docLinkChoQrCuaToi(u.id, parsed.data.id);
  if (!link) return { ok: false, loi: "Không tìm thấy link này.", truong: "khongTimThay" };
  if (link.status !== "ACTIVE") return { ok: false, loi: "Link này đã thu hồi — không tạo QR cho link đã thu hồi.", truong: "trangThai" };
  const goc = gocCongKhai(process.env);
  if (goc === null) return { ok: false, loi: LY_DO_THIEU_GOC, truong: "cauHinh" };
  const svg = await dungQrChoToken(goc, link.token);
  return { ok: true, dataUri: svgThanhDataUri(svg), tenTep: `qr-${link.token}.svg`, lienKetNgan: dungUrlChuyenHuong(goc, link.token) };
}
