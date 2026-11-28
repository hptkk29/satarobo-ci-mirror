import type { NextResponse } from "next/server";

import { chayDaDangNhap } from "@/lib/mobile-api/cong";
import { phatHocThu } from "@/lib/mobile-api/dich-vu/free-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET|HEAD /api/mobile/v1/online/preview/video/play?ve=… — PHÁT video học thử (Range 206, `no-store`). BẮT BUỘC `Authorization: Bearer`; vé phải đúng tài khoản của phiên. Cả phiên học sinh dùng được (cổng chế độ học sinh có dòng cho phép tường minh). */
export async function GET(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => (await phatHocThu(req, nguoi)) as unknown as NextResponse);
}

// HEAD tường minh: không có nó Next chạy HEAD bằng GET và luồng R2 không ai đọc ⇒ treo (cùng bài học với app/api/public/elearning-online/video/phat).
export async function HEAD(req: Request) {
  return chayDaDangNhap(req, async (nguoi) => (await phatHocThu(req, nguoi)) as unknown as NextResponse);
}
