// hub-diem-danh-badge.tsx — viên thuốc "buổi chưa điểm danh" của tab Điểm danh, tính Ở NỀN.
//
// Trước 24/10/2026 `page.tsx` `await` hai truy vấn badge (buổi 60 ngày gần → bản ghi điểm danh của chúng) NGAY TRONG thân
// trang, trước khi trả JSX ⇒ MỌI tab (kể cả "Tài liệu học phần", vốn chẳng dùng con số đó) phải chờ thêm hai lượt đi-về DB
// nối đuôi. Nay trang truyền `<Suspense fallback={null}><HubDiemDanhBadge/></Suspense>` vào `HubTabBar.badgeDiemDanh`: thanh tab
// — và TAB ĐANG CHỌN được tô — vẽ ngay, chỉ viên thuốc số tới sau mà không chặn nội dung tab. (Bọc cả thanh tab trong Suspense
// thì mỗi lần đổi tab thanh tab giữ nguyên tab CŨ được tô cho tới khi hai câu này xong — nên chỉ bọc viên thuốc.)
//
// Cùng truy vấn, cùng cổng scope (`withMakeupException(actorGiangDay(actor))`) và cùng định nghĩa "chưa điểm danh" như bản
// cũ trong page.tsx — chỉ đổi CHỖ chạy. Đừng đổi sang `count({ attendances: { none } })`: `Attendance` là model SCOPED, quan hệ
// lồng bỏ qua scope ấy nên con số có thể khác với danh sách "Cần xử lý" ở trang danh sách lớp.
import type { Actor } from "@/lib/auth/actor";
import { actorGiangDay, withMakeupException } from "@/lib/db-scope";
import { HubTabBadge } from "./hub-tab-bar";

export async function HubDiemDanhBadge({
  actor,
  classId,
  todayEnd,
}: {
  actor: Actor;
  classId: string;
  /** Mốc hết ngày hôm nay (giờ VN) dạng UTC — cùng giá trị page.tsx dùng cho các cổng "đã tới ngày". */
  todayEnd: Date;
}) {
  const xdb = withMakeupException(actorGiangDay(actor));

  // Buổi (60 ngày gần, đã tới hết hôm nay, chưa hủy) chưa có bản ghi điểm danh —
  // cùng tín hiệu "Cần xử lý" ở danh sách lớp.
  const pendFrom = new Date(todayEnd.getTime() - 60 * 24 * 60 * 60 * 1000);
  const pendSessions = await xdb.classSession.findMany({
    where: {
      classId,
      status: { not: "CANCELLED" },
      date: { gte: pendFrom, lte: todayEnd },
    },
    select: { id: true },
  });
  const attendedSet = new Set(
    pendSessions.length
      ? (
          await xdb.attendance.findMany({
            where: { sessionId: { in: pendSessions.map((s) => s.id) } },
            select: { sessionId: true },
          })
        ).map((a) => a.sessionId)
      : [],
  );
  const attendancePending = pendSessions.filter((s) => !attendedSet.has(s.id)).length;

  return <HubTabBadge n={attendancePending} />;
}
