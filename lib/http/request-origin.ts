// Origin THẬT của request phía server (vd `https://admin.satarobo.vn`).
//
// ⚠️ ĐỪNG dùng `req.nextUrl.origin` để dựng link tuyệt đối (QR, redirect, link trong file xuất).
// Từ 28/09/2026 app chạy `next start` standalone sau Caddy trên VPS: `nextUrl.origin` ra
// `https://0.0.0.0:3000` (host:port nơi server lắng nghe), không phải host người dùng gõ.
// Hậu quả đo được: QR chấm công in ra trỏ `https://0.0.0.0:3000/cham-cong/checkin?…` — quét
// không mở được; đăng xuất đẩy về `https://0.0.0.0:3000/login`. Trên Vercel lỗi này ẩn vì
// nền tảng tự điền đúng host.
//
// Caddy giữ nguyên `Host` và đặt `X-Forwarded-Host`/`X-Forwarded-Proto` ⇒ đọc header là đúng.
import type { NextRequest } from "next/server";
import { originTuHeaders } from "@/lib/push/origin";

export function originCuaRequest(req: NextRequest): string {
  return originTuHeaders(req.headers) ?? req.nextUrl.origin;
}
