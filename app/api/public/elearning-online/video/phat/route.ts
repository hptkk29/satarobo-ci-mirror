// GET|HEAD /api/public/elearning-online/video/phat?ve=… — PHÁT video Online (proxy R2, hỗ trợ Range). Vé do server cấp, hạn ngắn; quyền hỏi lại ở MỖI lượt.
// Cố ý nằm dưới `/api/public/` (không phiên, không `Authorization`): trình phát native chỉ cần một URL. Chứng cứ duy nhất = vé trong query.
import { xuLyPhat } from "@/lib/elearning-online/video-phat-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return xuLyPhat(req);
}

// HEAD tường minh: không có nó Next chạy HEAD bằng GET và luồng R2 không ai đọc ⇒ treo (cùng bài học với app/api/scorm/asset).
export async function HEAD(req: Request) {
  return xuLyPhat(req);
}
