import { maThoatSchema, thoatBangMa } from "@/lib/mobile-api/che-do-hoc-sinh";
import { chayDaDangNhapCoThan, traThanhCong } from "@/lib/mobile-api/cong";

export const dynamic = "force-dynamic";

/** POST /api/mobile/v1/student-mode/exit { ma } — thoát chế độ học sinh bằng mã 4 số của ba mẹ. Sai 5 lần ⇒ khoá + báo chuông ba mẹ (cùng bộ đếm với web). */
export async function POST(req: Request) {
  return chayDaDangNhapCoThan(req, maThoatSchema, async (nguoi, _ctx, thanDl) => traThanhCong(await thoatBangMa(nguoi, thanDl.ma)));
}
