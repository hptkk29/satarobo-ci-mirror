import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { chuanHoaThongBao, tabThongBaoKhaiBao } from "@/lib/elearning/thong-bao-tab";
import type { SearchParamsTho } from "@/lib/elearning/tab-url";
import { isNotiGroupKey } from "@/lib/notifications/catalog";
import {
  getNotificationSummary,
  listNotifications,
  mocLocThoiGian,
} from "@/lib/notifications/service";
import { TabNav } from "../_components/ui/tab-nav";
import { ThongBaoClient } from "./_components/thong-bao-client";

// Trang "Tất cả thông báo" của khu học tập — đích của nút "Xem tất cả" trên chuông ở thanh trên. Cùng khuôn với
// bản site GV (`app/(teacher)/teacher/thong-bao`): chuông dùng chung API, href trong DB viết theo đường admin nên
// đi qua `elearningHref` (đường không thuộc khu này ⇒ hiện chữ, không gắn link chết).
// Cổng đăng nhập + hồ sơ nhân sự do `layout.tsx` của khu đã gác.
//
// Tab `?tab=tat-ca|chua-doc` (thiết kế 17/11) DỊCH sang `?status=unread` của bộ lọc dùng chung — xem `thong-bao-tab.ts`. Liên kết
// cũ `?status=unread` vẫn đúng. Thành phần dùng chung KHÔNG đổi hành vi cho site GV/quản trị (chỉ thêm hai prop tuỳ chọn).

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Thông báo | Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

export default async function ElearningThongBaoPage({ searchParams }: { searchParams: Promise<SearchParamsTho> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const sp = await searchParams;
  const t = chuanHoaThongBao(sp);
  if (t.canChuyenHuong) redirect(`/elearning/thong-bao?${t.query}`);

  const nhomTho = Array.isArray(sp.group) ? sp.group[0] : sp.group;
  const group = nhomTho && isNotiGroupKey(nhomTho) ? nhomTho : undefined;
  const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const [summary, trang] = await Promise.all([
    getNotificationSummary(session.user.id),
    listNotifications(session.user.id, {
      group,
      status: t.status,
      from: mocLocThoiGian(mot(sp.range)),
      q: mot(sp.q),
    }),
  ]);

  return (
    <ThongBaoClient
      initialItems={trang.items}
      initialCursor={trang.nextCursor}
      groupCounts={summary.groups}
      duoiTieuDe={
        <TabNav
          duongDan="/elearning/thong-bao"
          nhanDanhSach="Thông báo"
          dangMo={t.tab}
          giuLai={{ group: group ?? "", range: mot(sp.range), q: mot(sp.q) }}
          tab={tabThongBaoKhaiBao(summary.totalUnread)}
        />
      }
    />
  );
}
