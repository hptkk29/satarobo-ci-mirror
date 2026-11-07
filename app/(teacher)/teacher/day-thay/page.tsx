// app/(teacher)/teacher/day-thay/page.tsx — "Dạy thay" (11/10/2026).
//
// Danh sách buổi MÌNH ĐƯỢC XẾP dạy thay. Đi theo BUỔI chứ không theo lớp: người dạy thay không thuộc lớp
// (`assignedClassIds`) nên "Lớp của tôi" không bao giờ có chỗ cho họ. Khuôn giống "Học bù" (/teacher/hoc-bu).
// Mỗi dòng mở một buổi: học viên, điểm danh, nhận xét, bài tập, giáo án — xem `[sessionId]/page.tsx`.
// Số liệu đi qua đúng hàm đếm của "Tổng quan" giáo viên chính (lib/teachers/day-thay.ts) nên không thể lệch.
import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { docDanhSachDayThay, SO_NGAY_DA_DAY, type DongDayThay } from "@/lib/teachers/day-thay";
import { PageHeader } from "../_components/ui/page-header";
import { EmptyState } from "../_components/ui/empty-state";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dạy thay | Giáo viên Sata Robo" };

const thuFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" });
const ngayFmt = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
const thangFmt = new Intl.DateTimeFormat("vi-VN", { month: "numeric", timeZone: "Asia/Ho_Chi_Minh" });

export default async function TeacherDayThayPage() {
  const session = await auth();
  if (!session?.user) return null; // layout đã gate
  const { sapToi, daDay } = await docDanhSachDayThay(session.user.id, new Date());

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dạy thay"
        subtitle="Buổi trung tâm xếp bạn đứng lớp thay giáo viên phụ trách. Mở từng buổi để xem học viên, điểm danh, nhận xét, giáo án và bài tập."
      />
      <Khoi
        tieuDe="Sắp dạy"
        rows={sapToi}
        rong={{
          title: "Chưa có buổi dạy thay nào được xếp cho bạn.",
          description: "Khi quản lý cơ sở xếp bạn dạy thay, buổi sẽ hiện ở đây ngay.",
        }}
      />
      <Khoi
        tieuDe={`Đã dạy (${SO_NGAY_DA_DAY} ngày)`}
        rows={daDay}
        rong={{ title: "Chưa có buổi dạy thay nào đã dạy." }}
      />
    </div>
  );
}

function Khoi({
  tieuDe,
  rows,
  rong,
}: {
  tieuDe: string;
  rows: DongDayThay[];
  rong: { title: string; description?: string };
}) {
  return (
    <section className="space-y-3" aria-label={tieuDe}>
      <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
        {tieuDe} <span className="font-normal normal-case">· {rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title={rong.title} description={rong.description} />
      ) : (
        <ul className="t-card divide-y divide-border overflow-hidden">
          {rows.map((r) => (
            <Dong key={r.id} r={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Dong({ r }: { r: DongDayThay }) {
  // Buổi CHƯA tới ngày thì "chưa điểm danh" là bình thường, không phải việc nợ — đừng tô cảnh báo (luật 12).
  const toiLuot = r.homNay || r.daChot || r.date.getTime() < Date.now();
  return (
    <li className="relative flex gap-3 px-4 py-4 transition-colors hover:bg-muted/50 sm:gap-4 sm:px-5">
      <div
        className={cn(
          "flex w-14 shrink-0 flex-col items-center self-start rounded-lg py-2",
          r.homNay ? "bg-primary text-primary-foreground" : "bg-primary-soft text-primary-ink",
        )}
      >
        <span className="text-[11px] font-semibold uppercase leading-none">{thuFmt.format(r.date)}</span>
        <span className="mt-1 text-xl font-extrabold leading-none tabular-nums">{ngayFmt.format(r.date)}</span>
        <span className="mt-1 text-[11px] leading-none tabular-nums">Th{thangFmt.format(r.date)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/teacher/day-thay/${r.id}`}
            className="truncate font-semibold text-foreground after:absolute after:inset-0 focus-visible:underline"
          >
            {r.lop}
          </Link>
          {r.homNay && !r.daChot && (
            <span className="inline-flex whitespace-nowrap rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-ink">
              Hôm nay
            </span>
          )}
        </div>
        {r.nhanBuoi && <p className="truncate text-sm text-foreground/80">{r.nhanBuoi}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {r.startTime && r.endTime ? `${r.startTime}–${r.endTime}` : "Chưa có giờ"}
          </span>
          {r.phong ? ` · Phòng ${r.phong}` : ""}
          {r.gvChinh ? ` · Thay ${r.gvChinh}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip
            tone={r.diemDanh === "DU" ? "ok" : r.diemDanh === "KHONG_CO_VIEC" ? "muted" : toiLuot ? "warn" : "muted"}
          >
            {r.diemDanh === "KHONG_CO_VIEC"
              ? "Lớp chưa có học viên"
              : r.diemDanh === "DU"
                ? `Đã điểm danh ${r.daDiemDanh}/${r.siSo}`
                : `Điểm danh ${r.daDiemDanh}/${r.siSo}`}
          </Chip>
          {r.coMat > 0 && (
            <Chip tone={r.nhanXetDu ? "ok" : toiLuot ? "warn" : "muted"}>
              Nhận xét {r.daNhanXet}/{r.coMat}
            </Chip>
          )}
          <Chip tone={r.coGiaoAn ? "info" : "muted"}>{r.coGiaoAn ? "Có giáo án" : "Chưa có giáo án"}</Chip>
        </div>
      </div>

      <ChevronRight className="mt-1 h-5 w-5 shrink-0 self-start text-muted-foreground/50" aria-hidden />
    </li>
  );
}

const CHIP: Record<"ok" | "warn" | "info" | "muted", string> = {
  ok: "bg-state-success-soft text-state-success-ink",
  warn: "bg-state-warning-soft text-state-warning-ink",
  info: "bg-state-info-soft text-state-info-ink",
  muted: "bg-muted text-muted-foreground",
};

function Chip({ tone, children }: { tone: keyof typeof CHIP; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", CHIP[tone])}>
      {children}
    </span>
  );
}
