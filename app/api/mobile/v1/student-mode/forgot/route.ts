import { quenMaSchema, thoatBangMatKhau } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/student-mode/forgot { matKhau } — «ba mẹ quên mã»: xác minh mật khẩu đăng nhập của phụ huynh (giới hạn riêng theo tài khoản) rồi thoát chế độ học sinh. */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, quenMaSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await thoatBangMatKhau(nguoi, thanDl.matKhau)));
}
