import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";

// API-18 — wrapper CHUẨN cho cron route: verifyCronAuth + try/catch → JSON error có
// cấu trúc (thay vì lib error nổ ra framework 500 HTML/opaque, khác shape mọi route
// khác + không log). Handler TRẢ VỀ payload success (giữ nguyên shape hiện tại từng
// route). Response no-store.
export function withCron(
  name: string,
  handler: (req: NextRequest) => Promise<unknown>,
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest): Promise<NextResponse> => {
    if (!verifyCronAuth(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    try {
      const result = await handler(req);
      return NextResponse.json(result ?? { ok: true }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (err) {
      console.error(`[cron:${name}]`, err);
      return NextResponse.json(
        { ok: false, error: err instanceof Error ? err.message : "cron failed" },
        { status: 500 },
      );
    }
  };
}
