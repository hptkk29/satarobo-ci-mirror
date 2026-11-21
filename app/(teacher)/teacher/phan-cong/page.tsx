// app/(teacher)/teacher/phan-cong/page.tsx — "Công việc của tôi" ĐÃ GỠ khỏi menu (chủ dự án 09/11/2026: "Lịch làm việc" + "Bảng công"
// đã đáp ứng). Nội dung nay ở Lịch làm việc › Danh sách (`lich/_components/cong-viec-danh-sach.tsx`, dữ liệu
// `lib/parttime/danh-sach-cong-viec-db.ts`). GIỮ route này làm lối chuyển hướng: thông báo cũ và đã gửi (`parttime.phan-cong:*`, dải chờ
// xác nhận ở Tổng quan) còn trỏ vào `/teacher/phan-cong[?tab=…]` — tab giữ nguyên tên ở Lịch.
import { redirect } from "next/navigation";
import { laMaTabLich } from "@/lib/parttime/danh-sach-cong-viec-db";

export const dynamic = "force-dynamic";

export default async function CongViecCuaToiChuyenHuong({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  redirect(laMaTabLich(sp.tab) ? `/teacher/lich?view=ds&tab=${sp.tab}` : "/teacher/lich?view=ds");
}
