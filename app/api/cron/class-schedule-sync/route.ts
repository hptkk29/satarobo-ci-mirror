import { NextResponse, type NextRequest } from "next/server";
import { verifyCronAuth } from "@/lib/cron/auth";
import { resyncLegacyScheduleForAllClasses } from "@/lib/classes/phases-service";

export const dynamic = "force-dynamic";

// 07/08/2026 — Đồng bộ bản sao lịch của lớp theo GIAI ĐOẠN HIỆU LỰC HÔM NAY.
//
// Kế hoạch lịch học có giai đoạn TƯƠNG LAI ("từ 01/09 chỉ còn 1 buổi/tuần"). Bản sao
// (`Class.scheduleDays/startTime/endTime` + `ClassScheduleSlot`) được ghi lúc admin bấm
// Lưu, nên tới ngày giai đoạn sau bắt đầu thì nó thiu — mà không có thao tác nào của con
// người kích hoạt việc sửa. Cron này chạy 00:10 giờ VN (17:10 UTC hôm trước) để mọi chỗ
// đọc lịch kiểu cũ (site GV, bảng công, dự phóng bế giảng ở portal, soát trùng phòng/GV)
// đúng ngay từ buổi đầu tiên của giai đoạn mới.
//
// Idempotent: lớp nào bản sao đã khớp thì bỏ qua, không ghi.
export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await resyncLegacyScheduleForAllClasses();
  return NextResponse.json({ ok: true, data: result });
}
