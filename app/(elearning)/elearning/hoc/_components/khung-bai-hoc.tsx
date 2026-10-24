import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CirclePlay,
  FileText,
  ListChecks,
  PencilLine,
  Users,
  Package,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { langGieng, type BaiTrongCay, type CayBaiHoc } from "@/lib/elearning/lesson-tree";

/**
 * KHUNG TRÌNH HỌC — cột trái cây chương/bài, thân là bài đang học, dưới là Bài trước / Bài sau.
 *
 * ⚠️ Khung này CHỈ BỌC. Nó đứng SAU toàn bộ chuỗi cổng của trang bài (sở hữu → cổng nội dung → chính sách → cờ VIDEO) và KHÔNG
 * đọc hay quyết điều kiện hoàn thành: trình phát video, bộ đo đọc, bài kiểm tra, nộp bài giữ nguyên là phần tử con. Màn từ chối
 * (`TuChoi`) cố ý KHÔNG đi qua khung — một lời từ chối không cần cây bài bên cạnh.
 *
 * ⚠️ MỌI liên kết rời trang bài ở đây là `<a href>` THƯỜNG, KHÔNG phải `<Link>`. Lý do đo được (24/10/2026): bộ đo đọc/xem chỉ ghi nhịp mỗi 15 giây
 * và nhịp CUỐI chỉ gửi ở `pagehide` (`sendBeacon`). Điều hướng phía client của `<Link>` KHÔNG bắn `pagehide`, nên đọc ~12 giây rồi bấm
 * "Bài sau" = server KHÔNG nhận dòng tiến độ nào. Tải trang đầy đủ thì `pagehide` chạy đúng như thiết kế — mà không phải sửa mã đo.
 * Đừng "tối ưu" lại thành `<Link>`; ca e2e `[EL-UX] rời bài…` canh đúng chỗ này.
 */
const ICON_LOAI: Record<string, LucideIcon> = {
  READ: FileText,
  VIDEO: CirclePlay,
  QUIZ: ListChecks,
  TASK: PencilLine,
  LIVE_SESSION: Users,
  SCORM: Package,
};

function TrangThaiBai({ b }: { b: BaiTrongCay }) {
  if (b.trangThai === "XONG")
    return (
      <>
        <CircleCheck className="h-4 w-4 shrink-0 text-state-success-ink" aria-hidden />
        <span className="sr-only">Đã xong. </span>
      </>
    );
  if (b.trangThai === "DANG_HOC")
    return (
      <>
        <CircleDashed className="h-4 w-4 shrink-0 text-state-info-ink" aria-hidden />
        <span className="sr-only">Đang học. </span>
      </>
    );
  return (
    <>
      <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      <span className="sr-only">Chưa học. </span>
    </>
  );
}

function CayChuong({ enrollmentId, cay, lessonId }: { enrollmentId: string; cay: CayBaiHoc; lessonId: string }) {
  return (
    <ol className="space-y-4">
      {cay.chuong.map((c, i) => (
        <li key={c.moduleId}>
          <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {i + 1}. {c.title}
          </h3>
          {c.bai.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">Chương này chưa có bài.</p>
          ) : (
            <ul className="space-y-0.5">
              {c.bai.map((b) => {
                const Icon = ICON_LOAI[b.kind] ?? FileText;
                const hienTai = b.lessonId === lessonId;
                const noiDung = (
                  <>
                    <TrangThaiBai b={b} />
                    <Icon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{b.title}</span>
                  </>
                );
                return (
                  <li key={b.lessonId}>
                    {b.moDuoc ? (
                      <a
                        href={`/elearning/hoc/${enrollmentId}/${b.lessonId}`}
                        aria-current={hienTai ? "page" : undefined}
                        title={`${b.title} — ${b.nhanLoai}`}
                        className={cn(
                          "flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring lg:min-h-9",
                          hienTai
                            ? "bg-primary-soft font-semibold text-primary-ink"
                            : "text-foreground hover:bg-muted",
                        )}
                      >
                        {noiDung}
                      </a>
                    ) : (
                      // Không có màn người học (buổi trực tiếp): hiện để thấy đủ lộ trình, KHÔNG dựng link chết.
                      <span
                        className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground"
                        title={`${b.title} — ${b.nhanLoai} (giảng viên điểm danh)`}
                      >
                        {noiDung}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function KhungBaiHoc({
  enrollmentId,
  tenKhoa,
  tenChuong,
  tieuDe,
  nhanLoai,
  lessonId,
  cay,
  anChuyenBai = false,
  children,
}: {
  enrollmentId: string;
  tenKhoa: string;
  tenChuong: string;
  tieuDe: string;
  nhanLoai: string;
  lessonId: string;
  cay: CayBaiHoc;
  /** `true` = không vẽ Bài trước/Bài sau (đang có lượt thi dở trong bài này). */
  anChuyenBai?: boolean;
  children: React.ReactNode;
}) {
  const { truoc, sau, viTri, tong } = langGieng(cay.phang, lessonId);
  const tomTat = `${cay.soXong}/${cay.soBai} bài đã xong`;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <nav aria-label="Vị trí bài học" className="mb-4 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
        <a
          href={`/elearning/hoc/${enrollmentId}`}
          className="inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-lg outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Về đề cương: {tenKhoa}</span>
        </a>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside aria-label="Nội dung khoá học" className="min-w-0">
          {/* Điện thoại: gập sẵn, mở bằng một nút. */}
          <details className="group rounded-xl border border-border bg-card lg:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span>Nội dung khoá · {tomTat}</span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="border-t border-border p-2">
              <CayChuong enrollmentId={enrollmentId} cay={cay} lessonId={lessonId} />
            </div>
          </details>
          {/* Desktop: luôn mở, dính khi cuộn. */}
          <div className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 lg:block">
            <p className="px-2 pb-2 pt-1 text-sm font-semibold text-foreground">Nội dung khoá</p>
            <p className="px-2 pb-3 text-xs text-muted-foreground">{tomTat}</p>
            <CayChuong enrollmentId={enrollmentId} cay={cay} lessonId={lessonId} />
          </div>
        </aside>

        <div className="min-w-0">
          <header className="mb-5">
            <p className="truncate text-sm text-muted-foreground">
              {tenKhoa} · {tenChuong}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">{tieuDe}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {nhanLoai}
              {tong > 0 && viTri > 0 ? ` · bài ${viTri}/${tong}` : ""}
            </p>
          </header>

          {children}

          {!anChuyenBai && (truoc || sau) ? (
            <nav aria-label="Chuyển bài" className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
              {truoc ? (
                <a
                  href={`/elearning/hoc/${enrollmentId}/${truoc.lessonId}`}
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">Bài trước: {truoc.title}</span>
                </a>
              ) : (
                <span />
              )}
              {sau ? (
                <a
                  href={`/elearning/hoc/${enrollmentId}/${sau.lessonId}`}
                  className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <span className="truncate">Bài sau: {sau.title}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                </a>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
