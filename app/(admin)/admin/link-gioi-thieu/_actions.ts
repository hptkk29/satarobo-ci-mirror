"use server";

// app/(admin)/admin/link-gioi-thieu/_actions.ts — Server Action của màn «Link giới thiệu của tôi» (nhân sự đồng ý quy định để tham gia + tự tạo link + xin QR cho link CỦA CHÍNH MÌNH).
//
// MỎNG: xác thực (PHIÊN) → cờ module (`linkGioiThieuBat`) → lõi `lib/affiliate/doi-tac-nhan-su.ts`. Sự cô lập KHÔNG nằm ở đây mà ở truy vấn trong lõi: đối tác = `Affiliate.employeeId`
// của hồ sơ nhân sự gắn với `userId` CỦA PHIÊN; client chỉ gửi membershipId / siteId / trang đích / id link — id của người khác ra cùng câu với id không tồn tại.
// Không có khoá RBAC riêng và KHÔNG so vai (lint `no-inline-authz`): quyền ở màn này là «bạn có hồ sơ nhân sự đang làm việc» — DỮ LIỆU SỞ HỮU, như cổng đối tác của phụ huynh
// (`app/(portal)/portal/gioi-thieu/_actions.ts`). Phép GHI đi qua đúng các hàm của màn quản trị (`taoDoiTac` · `doiTrangThaiDoiTac` · `themMembership` · `doiTrangThaiMembership` · `phatLink`).
// KHÔNG có bước duyệt (chủ dự án chốt 21/11/2026): «Tôi đồng ý» là vào luôn.
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { docLinkChoQrNhanSu, linkGioiThieuBat, taoLinkNhanSu, thamGiaLinkGioiThieu, thuHoiLinkNhanSu, type KetQuaThamGia } from "@/lib/affiliate/doi-tac-nhan-su";
import { dungUrlChuyenHuong } from "@/lib/affiliate/dung-url-theo-doi";
import { LY_DO_THIEU_GOC, gocCongKhai } from "@/lib/affiliate/goc-cong-khai";
import { dungQrChoToken, svgThanhDataUri } from "@/lib/affiliate/qr-link";
import { auth } from "@/lib/auth";

const TRANG = "/admin/link-gioi-thieu";
/** Cùng màn trên site giáo viên (`app/(teacher)/teacher/link-gioi-thieu`) — làm mới CẢ HAI. */
const TRANG_GV = "/teacher/link-gioi-thieu";
function lamMoi() {
  revalidatePath(TRANG);
  revalidatePath(TRANG_GV);
}
const CHUA_DANG_NHAP = { ok: false, loi: "Chưa đăng nhập", truong: "quyen" } as const;
const MODULE_TAT = { ok: false, loi: "Chương trình link giới thiệu đang tắt.", truong: "quyen" } as const;

export type KetQuaTaoLinkNhanSu = { ok: true; id: string } | { ok: false; loi: string; truong?: string };
export type KetQuaQrNhanSu = { ok: true; dataUri: string; tenTep: string; lienKetNgan: string } | { ok: false; loi: string; truong?: string };

/** Người đang đăng nhập, hoặc null. userId lấy từ PHIÊN — không từ tham số. */
async function nguoiDung(): Promise<{ id: string; ten: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, ten: session.user.name ?? session.user.email ?? "Nhân sự" };
}

export async function thamGiaLinkGioiThieuAction(): Promise<KetQuaThamGia> {
  const u = await nguoiDung();
  if (!u) return { ok: false, loi: CHUA_DANG_NHAP.loi };
  if (!(await linkGioiThieuBat())) return { ok: false, loi: MODULE_TAT.loi };
  const kq = await thamGiaLinkGioiThieu({ nguoi: { userId: u.id, ten: u.ten }, now: new Date() });
  lamMoi(); // kể cả khi lỗi giữa chừng: bước trước có thể đã ghi (mỗi bước tự hội tụ), màn phải đọc lại
  return kq;
}

export async function taoLinkNhanSuAction(input: unknown): Promise<KetQuaTaoLinkNhanSu> {
  const u = await nguoiDung();
  if (!u) return CHUA_DANG_NHAP;
  if (!(await linkGioiThieuBat())) return MODULE_TAT;
  const kq = await taoLinkNhanSu({ nguoi: { userId: u.id, ten: u.ten }, vao: input, now: new Date() });
  if (!kq.ok) return { ok: false, loi: kq.loi, truong: kq.truong };
  lamMoi();
  return { ok: true, id: kq.id };
}

const qrSchema = z.object({ id: z.string().trim().min(1).max(64) }).strict();

export type KetQuaThuHoiNhanSu = { ok: true } | { ok: false; loi: string; truong?: string };

/** Thu hồi link CỦA CHÍNH MÌNH — sở hữu kiểm trong lõi (`thuHoiLinkNhanSu`), phép ghi là `thuHoiLink` của màn quản trị. */
export async function thuHoiLinkNhanSuAction(input: unknown): Promise<KetQuaThuHoiNhanSu> {
  const u = await nguoiDung();
  if (!u) return CHUA_DANG_NHAP;
  if (!(await linkGioiThieuBat())) return MODULE_TAT;
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return { ok: false, loi: "Dữ liệu không hợp lệ.", truong: "chung" };
  const kq = await thuHoiLinkNhanSu({ nguoi: { userId: u.id, ten: u.ten }, id: parsed.data.id, now: new Date() });
  if (!kq.ok) return { ok: false, loi: kq.loi, truong: kq.truong };
  lamMoi();
  return { ok: true };
}

export async function taoQrNhanSuAction(input: unknown): Promise<KetQuaQrNhanSu> {
  const u = await nguoiDung();
  if (!u) return CHUA_DANG_NHAP;
  if (!(await linkGioiThieuBat())) return MODULE_TAT;
  const parsed = qrSchema.safeParse(input);
  if (!parsed.success) return { ok: false, loi: "Dữ liệu không hợp lệ.", truong: "chung" };

  const link = await docLinkChoQrNhanSu(u.id, parsed.data.id);
  if (!link) return { ok: false, loi: "Không tìm thấy link này.", truong: "khongTimThay" };
  if (link.status !== "ACTIVE") return { ok: false, loi: "Link này đã thu hồi — không tạo QR cho link đã thu hồi.", truong: "trangThai" };
  const goc = gocCongKhai(process.env);
  if (goc === null) return { ok: false, loi: LY_DO_THIEU_GOC, truong: "cauHinh" };
  const svg = await dungQrChoToken(goc, link.token);
  return { ok: true, dataUri: svgThanhDataUri(svg), tenTep: `qr-${link.token}.svg`, lienKetNgan: dungUrlChuyenHuong(goc, link.token) };
}
