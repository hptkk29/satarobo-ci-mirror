// app/api/cron/trial-reminder/route.ts — GĐ6 (V2-d 17/09/2026).
//
// Vỏ mỏng: xác thực cron rồi gọi `chayNhacTrial`. Toàn bộ nghiệp vụ nằm ở
// `lib/trial/nhac-buoi.ts` — tách ra vì thân cũ mở màn bằng `new Date()` nên không ca test
// nào chạm được vào phần rẽ mốc (luật 19: test không đọc đồng hồ thật).
//
// Ba mốc nhắc, chạy chung một route — bề rộng cửa sổ + PHÉP TÍNH ra từng con số: xem `MOC`
// trong `_moc.ts`.
//   · "1-ngay" (23h–25h) và "2-gio" (1,5h–2,5h) → nhắc SALE, để Sale tự nhắn phụ huynh qua
//     Zalo cá nhân. Hệ thống KHÔNG gửi tin tự động cho phụ huynh — chốt nghiệp vụ.
//   · "1-gio" (0,4h–1,5h) → nhắc GIÁO VIÊN dạy buổi; buổi chưa ai dạy thì leo thang Đào tạo.
//
// ⚠️ KHÔNG nhận `?now=`. Cám dỗ rất lớn (nó làm việc smoke-test trên prod dễ hơn hẳn), nhưng
// đây là endpoint chạy thật: mở tham số thời gian ra query là cho người gọi tự chọn mốc và
// phát lại chuông tuỳ ý. Muốn thử mốc thì chạy bộ test của `lib/trial/nhac-buoi.ts`.
import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { chayNhacTrial } from "@/lib/trial/nhac-buoi";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const stats = await chayNhacTrial({ now: new Date() });
  return NextResponse.json({ ok: true, ...stats });
}
