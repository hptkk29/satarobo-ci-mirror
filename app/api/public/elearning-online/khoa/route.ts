// GET /api/public/elearning-online/khoa — DANH SÁCH khoá Online công khai (chỉ trường công khai; hợp đồng `ELEARNING-ONLINE-CONTRACTS.md` §4).
// Lõi + luật: `lib/elearning-online/danh-muc-cong-khai.ts` · `cong-khai-http.ts`. Cờ `ELEARNING_ONLINE_ENABLED` tắt ⇒ 404.
import type { NextRequest } from "next/server";
import { xuLyDanhSach } from "@/lib/elearning-online/cong-khai-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return xuLyDanhSach(new URL(req.url));
}
