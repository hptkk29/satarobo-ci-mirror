import Link from "next/link";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { napKhoaCuaToi } from "@/lib/elearning/course-view";

/**
 * Trang chủ khu đào tạo nội bộ — KHOÁ CỦA TÔI.
 *
 * ⚠️ Trang này từng là khung tạm 16 dòng của EL-01 với ĐÚNG 0 link, và nó ở nguyên
 * như thế qua mười bốn ticket. Mục menu "Học tập nội bộ" trên thanh trên cùng dẫn
 * thẳng vào đây, nên mọi màn hình đã dựng — kho câu hỏi, đề thi, khung chấm, hàng
 * đợi chấm, báo cáo, chương trình — không ai tới được trừ khi biết sẵn địa chỉ.
 *
 * Đó là lý do một module gần đủ mã vẫn chưa ai đi hết được một vòng nào.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Học tập nội bộ | Sata Robo",
  robots: { index: false, follow: false },
};

const NHAN_TT: Record<string, string> = {
  NOT_STARTED: "chưa bắt đầu",
  IN_PROGRESS: "đang học",
  COMPLETED: "đã hoàn thành",
  COMPLETED_LATE: "hoàn thành (trễ hạn)",
  OVERDUE: "quá hạn",
};

const daXong = (s: string) => s === "COMPLETED" || s === "COMPLETED_LATE";

export default async function ElearningHomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center text-sm">
        Đăng nhập rồi mở lại trang này.
      </main>
    );
  }
  const actor = await resolveActor(session.user.id);
  const ds = await napKhoaCuaToi(scopedDb(actor), session.user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Khoá của tôi</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Những khoá được giao cho bạn. Việc cần làm sớm nhất xếp lên trước.
        </p>
      </div>

      {ds.length === 0 ? (
        // Danh sách rỗng KHÁC lỗi tải. Nói rõ, và nói luôn ai là người giao bài để
        // họ biết hỏi ai thay vì ngồi đợi.
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Bạn chưa được giao khoá nào. Phòng Đào tạo là nơi giao bài — liên hệ họ nếu
          bạn nghĩ đây là nhầm lẫn.
        </p>
      ) : (
        <ul className="space-y-2">
          {ds.map((k) => (
            <li key={k.enrollmentId} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  href={`/elearning/hoc/${k.enrollmentId}`}
                  className="font-medium underline"
                >
                  {k.tenKhoa}
                </Link>
                <span
                  className={`text-xs ${
                    k.status === "OVERDUE"
                      ? "font-medium text-red-600"
                      : "text-muted-foreground"
                  }`}
                >
                  {NHAN_TT[k.status] ?? k.status}
                  {k.dueAt && !daXong(k.status)
                    ? ` · hạn ${k.dueAt.toLocaleDateString("vi-VN")}`
                    : ""}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${Math.min(100, k.progressPercent)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {k.progressPercent}% hoàn thành
              </p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Muốn xem hệ thống lưu gì về việc học của bạn?{" "}
        <Link href="/elearning/du-lieu-cua-toi" className="underline">
          Dữ liệu của tôi
        </Link>
        {/* ⚠️ Lối vào này TỪNG KHÔNG TỒN TẠI: grep toàn kho ra 0 <Link> nào trỏ
            `/elearning/du-lieu-cua-toi`. Đó cũng là màn khiếu nại cờ nghi ngờ xem
            video — cửa sổ 14 ngày chạy im lặng rồi cron đêm tự chốt, trong khi người
            bị gắn cờ không có đường nào tới chỗ khiếu nại. */}
      </p>
    </main>
  );
}
