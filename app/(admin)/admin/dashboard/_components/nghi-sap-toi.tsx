// Khối "Nghỉ sắp tới" trên dashboard quản lý — ai nghỉ trong 7 ngày tới, và còn đơn nghỉ nào
// chưa duyệt cho những ngày đó.
//
// Vì sao có (yêu cầu chủ dự án 06/09): "quản lý trực tiếp nắm thông tin và có hướng bố trí nhân
// sự hỗ trợ… cơ chế thông tin hoặc hiển thị trên màn hình dashboard của quản lý".
//
// Vì sao KHÔNG nhét vào khối "Cần xử lý" ngay trên nó: nghỉ đã duyệt là THÔNG TIN, không phải
// việc phải làm. Đưa vào đó là thổi số badge lên mỗi ngày và làm loãng đúng cái khối tồn tại để
// nói "còn N việc chưa xong". Đơn nghỉ CHƯA duyệt thì đã nằm sẵn trong khối đó rồi.
//
// Dễ vỡ:
// - Ngày TƯƠNG LAI không có dòng `StaffAttendanceDay` (bảng đó chỉ sinh khi tính công cho ngày
//   đã qua). Nên đếm nghỉ bằng `ShiftAssignment.isLeave`, KHÔNG bằng `dayType`.
// - Quyền hỏi một lần bằng `loadModuleScope`; chỉ hiện khối cho người thật sự duyệt đơn ở đâu
//   đó — người không duyệt ai thì đây là nhiễu.
import Link from "next/link";
import { CalendarOff, ChevronRight } from "lucide-react";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { loadModuleScope, type ModuleAction } from "@/lib/cham-cong/module-scope";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { vnAddDays, vnDateOnly, vnYmd } from "@/lib/time/vn";

const APPROVE: ModuleAction = "hr_attendance:approve";
/** Nhìn xa 7 ngày: đủ để xếp người thay cho cả tuần, chưa xa tới mức thành danh sách dài vô ích. */
const SO_NGAY = 7;

const THU = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** "T4 09/09" — đủ để nhận ra ngày mà không chiếm chỗ. */
function nhanNgay(d: Date): string {
  const p = vnYmd(d).split("-");
  const thu = THU[new Date(`${vnYmd(d)}T12:00:00Z`).getUTCDay()];
  return `${thu} ${p[2]}/${p[1]}`;
}

export async function NghiSapToi({ userId }: { userId: string }) {
  const scope = await loadModuleScope(userId);
  const khoi = scope.blocksWith(APPROVE);
  if (khoi.length === 0) return null;

  const sdb = scopedDb(await resolveActor(userId));
  const homNay = vnDateOnly(new Date());
  const den = vnDateOnly(vnAddDays(homNay, SO_NGAY - 1));
  const centerIds = khoi.map((b) => b.id);

  const [nghi, donCho] = await Promise.all([
    // `isLeave` chứ không `dayType`: ngày tương lai chưa có dòng công nào.
    sdb.shiftAssignment.findMany({
      where: { centerId: { in: centerIds }, status: "ACTIVE", isLeave: true, workDate: { gte: homNay, lte: den } },
      select: { userId: true, workDate: true, centerId: true, templateCode: true },
      orderBy: { workDate: "asc" },
      take: 200,
    }),
    sdb.workRequest.count({
      where: {
        centerId: { in: centerIds },
        kind: "LEAVE",
        status: "PENDING",
        fromDate: { lte: den },
        OR: [{ toDate: { gte: homNay } }, { toDate: null, fromDate: { gte: homNay } }],
      },
    }),
  ]);

  if (nghi.length === 0 && donCho === 0) return null;

  const nguoiIds = [...new Set(nghi.map((a) => a.userId))];
  const users = nguoiIds.length
    ? await sdb.user.findMany({ where: { id: { in: nguoiIds } }, select: { id: true, name: true, email: true } })
    : [];
  const tenCua = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const nhanKhoi = new Map(khoi.map((b) => [b.id, b.label]));

  // Gom theo ngày, giữ thứ tự ngày tăng dần.
  const theoNgay = new Map<string, { ten: string; khoi: string }[]>();
  for (const a of nghi) {
    const k = vnYmd(a.workDate);
    const ds = theoNgay.get(k) ?? [];
    ds.push({ ten: tenCua.get(a.userId) ?? a.userId, khoi: nhanKhoi.get(a.centerId) ?? a.centerId });
    theoNgay.set(k, ds);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
          <CalendarOff aria-hidden className="h-4 w-4 text-primary" />
          Nghỉ trong {SO_NGAY} ngày tới
        </h2>
        <Link
          href={hrefWith("/don-tu", { coSo: khoi[0].id })}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Mở hàng chờ duyệt đơn
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
      </div>

      {donCho > 0 && (
        <p className="mb-3 rounded-lg bg-state-warning-soft px-3 py-2 text-sm text-state-warning-ink">
          Còn <b>{donCho}</b> đơn nghỉ chờ duyệt rơi vào khoảng này — duyệt trước khi xếp người thay,
          kẻo xếp xong lại phải xếp lại.
        </p>
      )}

      {theoNgay.size === 0 ? (
        <p className="text-sm text-muted-foreground">
          Chưa ai nghỉ trong {SO_NGAY} ngày tới. Đơn chờ duyệt ở trên có thể làm đổi việc này.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {[...theoNgay.entries()].map(([ymd, ds]) => (
            <li key={ymd} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <Link
                href={hrefWith("/cham-cong", { date: ymd, coSo: khoi[0].id })}
                className="w-20 shrink-0 font-semibold tabular-nums text-foreground hover:underline"
              >
                {nhanNgay(new Date(`${ymd}T12:00:00Z`))}
              </Link>
              <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                {ds.map((x) => x.ten).join(" · ")}
                {khoi.length > 1 && (
                  <span className="ml-2 text-xs">({[...new Set(ds.map((x) => x.khoi))].join(", ")})</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{ds.length}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
