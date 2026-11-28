import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { layUrlTaiTep } from "@/lib/lms/tep-bai-nop";

export const dynamic = "force-dynamic";

/** GET /api/lms/submission-file/:fileId — tải tệp bài nộp trong kho RIÊNG (phụ huynh chủ bài hoặc nhân sự có quyền chấm đúng lớp/cơ sở) ⇒ 302 tới URL ký 5 phút. Xem lib/lms/tep-bai-nop.ts. */
export async function GET(_req: Request, ctx: { params: Promise<{ fileId: string }> }) {
  const session = await auth();
  const { fileId } = await ctx.params;
  const r = await layUrlTaiTep(session?.user?.id, fileId);
  if (!r.ok) return new NextResponse(null, { status: r.ma, headers: { "Cache-Control": "no-store" } });
  return NextResponse.redirect(r.url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
