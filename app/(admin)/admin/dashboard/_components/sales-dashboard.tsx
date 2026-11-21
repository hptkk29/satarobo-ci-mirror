// app/(admin)/admin/dashboard/_components/sales-dashboard.tsx — BẢNG ĐIỀU KHIỂN SALE.
//
// ═══ THIẾT KẾ LẠI 22/09/2026 — "MỘT HÀNG ĐỢI, KHÔNG PHẢI SÁU CÁI THẺ" ═══════════
//
// LUẬN ĐỀ. Màn này trả lời đúng MỘT câu: *hôm nay tôi gọi ai trước*. Nên trang có
// đúng MỘT bảng việc, xếp theo độ khẩn, và mọi thứ khác lùi xuống dưới. Cái nó từ
// chối là nếp cũ: xếp năm sáu thẻ `rounded-xl border bg-card p-5` giống hệt nhau
// chồng lên nhau rồi gọi đó là bảng điều khiển.
//
// ĐO ĐƯỢC TRƯỚC KHI SỬA — không phải chuyện thẩm mỹ:
//   · Việc QUÁ HẠN hiện BA lần trên cùng một màn: ô số "Việc của tôi quá hạn",
//     khối "Quá hạn (N)", và mục "Việc cần làm (N quá hạn · M hôm nay)".
//   · Hai trong ba chỗ đó đọc từ HAI TRUY VẤN KHÁC NHAU (`getSaleBoard` lọc qua
//     `leadOwnershipWhere`; khối kia lọc `assignedToId` + phạm vi cơ sở) ⇒ hai con
//     số **có thể nói khác nhau** trên cùng một màn hình. Không có cách nào để
//     người dùng biết cái nào đúng.
//   · Mốc "hôm nay" của khối cũ tính bằng `new Date(y, m, d)` — giờ MÁY CHỦ. Vercel
//     chạy UTC ⇒ từ 17:00 giờ VN trở đi nó đã sang ngày mới, việc hạn tối nay rơi
//     khỏi "hôm nay". `getSaleBoard` dùng `cuoiNgayVN()` nên không dính.
//
// ⇒ MỘT NGUỒN: `getSaleBoard`. Truy vấn `leadTask` thứ hai đã GỠ.
//    Hệ quả đã biết và chấp nhận: một việc giao cho tôi trên phiếu mà tôi KHÔNG
//    giữ và cũng KHÔNG nhập sẽ không còn lên bảng (bản cũ có, vì nó chỉ lọc theo
//    cơ sở). Đổi lại là hết cảnh hai con số cãi nhau, và mốc ngày đúng giờ VN.
//    Muốn lấy lại lớp việc đó thì nới ở `getSaleBoard` — MỘT chỗ, có test.
//
// HÌNH THỨC đi theo hệ đã chốt (DESIGN.md): `StatCard` · `adminTh/Td/Tr` mật độ
// 44px · `StatusPill` thang ngữ nghĩa · `PhanTrangBang`. KHÔNG tự chế thẻ, KHÔNG
// màu rời (`amber-600` của bản cũ đã thay bằng token `state-*`).
//
// ĐỪNG SỬA MÀ KHÔNG ĐỌC `sales-dashboard.test.ts`: bộ đó canh một QUYẾT ĐỊNH —
// bốn ô số phải giữ cách lọc "được giao cho tôi" và phải mang chữ "tôi" trong nhãn.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Users,
  CheckSquare,
  FlaskConical,
  TrendingUp,
  GraduationCap,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { safeCache } from "@/lib/cache/safe-cache";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  KANBAN_COLUMNS,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_BADGE,
  CONVERTED_STATUSES,
} from "@/lib/leads/status";
import { getNearingEndEnrollments } from "@/lib/students/renewal";
import { groupByWeek, type LeadReportRecord } from "@/lib/reports/lead";
import { BarChart } from "@/components/charts/bar-chart";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { formatDateVN } from "@/lib/format/date";
import { getSaleBoard, type ViecItem } from "@/lib/crm/sale-board";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { maskLeadPiiFields, maskPersonName } from "@/lib/lead/pii";
import { StatCard, type StatTone } from "@/components/admin/ui/stat-card";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";

// REQ-04: số liệu tổng hợp dashboard sale. Data THEO USER (assignedToId=userId) → cache
// key = userId. Output PRIMITIVE (countByStatus là object, weeklyBars {string,number},
// đếm số — KHÔNG Date/Map). Việc-cần-làm + học-thử (có Date) giữ LIVE ở component.
async function getSalesStats(userId: string) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 86_400_000);
  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);

  const [pipeline, totalMine, enrolledMonth, nearingEnd, leadsForWeekly] = await Promise.all([
    sdb.lead.groupBy({ by: ["status"], where: { assignedToId: userId, deletedAt: null }, _count: { _all: true } }),
    sdb.lead.count({ where: { assignedToId: userId, deletedAt: null } }),
    sdb.lead.count({ where: { assignedToId: userId, deletedAt: null, status: "DA_DANG_KY", updatedAt: { gte: monthStart } } }),
    getNearingEndEnrollments(),
    // Phễu lead theo TUẦN (8 tuần) — lead CỦA TÔI: tổng mới vs chuyển đổi.
    sdb.lead.findMany({
      where: { assignedToId: userId, deletedAt: null, createdAt: { gte: eightWeeksAgo } },
      select: { createdAt: true, status: true },
    }),
  ]);

  const countByStatus: Record<string, number> = {};
  for (const p of pipeline) countByStatus[p.status] = p._count._all;
  const weeklyRecords: LeadReportRecord[] = leadsForWeekly.map((l) => ({
    status: l.status,
    source: null,
    centerId: null,
    commissionSource: null,
    createdAt: l.createdAt,
  }));
  const weeklyBars = groupByWeek(weeklyRecords, 8, now).map((w) => ({
    week: w.label,
    total: w.total,
    converted: w.converted,
  }));
  // Tỉ lệ chốt = lead đã đăng ký / tổng lead của tôi.
  // ⚠️ `countByStatus` là Record<string, number> nên tra khoá sai KHÔNG làm tsc đỏ —
  // khoá "ENROLLED" cũ chỉ lặng lẽ trả undefined ⇒ mọi sale hiện 0%. Cộng theo
  // CONVERTED_STATUSES (nguồn duy nhất) thay vì gõ tay tên trạng thái.
  const convertedMine = [...CONVERTED_STATUSES].reduce(
    (sum, st) => sum + (countByStatus[st] ?? 0),
    0,
  );
  const closeRate = totalMine > 0 ? Math.round((convertedMine / totalMine) * 100) : 0;

  return { totalMine, enrolledMonth, closeRate, countByStatus, weeklyBars, nearingEndCount: nearingEnd.length };
}

/** Một dòng của hàng đợi — việc follow-up đã gắn nhãn độ khẩn. */
type DongHangDoi = ViecItem & { khan: "QUA_HAN" | "HOM_NAY" };

// Đợt 3C — Dashboard SALES_CSM. Chỉ lead/việc CỦA TÔI. KHÔNG tài chính/quản trị.
export async function SalesDashboard({ userId, name, embedded = false }: { userId: string; name: string; embedded?: boolean }) {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const actor = await resolveActor(userId);
  const sdb = scopedDb(actor);

  // ① Hàng đợi SLA — NGUỒN DUY NHẤT của mọi con số về việc trên màn này.
  // KHÔNG cache: `getSaleBoard` so mốc thời gian (quá hạn / đến hạn hôm nay) nên một
  // bản cache 60 giây là một bảng việc nói sai giờ.
  const canViewPii = await canViewLeadPii();
  const board = await getSaleBoard(actor, userId);
  // S-1 — MỌI khối đều in tên phụ huynh. Che ở SERVER, cùng một cổng: nửa che
  // nửa không trên cùng một màn là kiểu rò khó thấy nhất.
  const cheViec = (ds: ViecItem[], khan: DongHangDoi["khan"]): DongHangDoi[] =>
    ds.map((v) => ({ ...v, khan, tenKhach: canViewPii ? v.tenKhach : maskPersonName(v.tenKhach) }));
  // Quá hạn lên trước, rồi đến hạn hôm nay — trong mỗi nhóm giữ thứ tự `dueAt` mà
  // `getSaleBoard` đã sắp. Đây là toàn bộ "thuật toán ưu tiên", và nó cố ý đơn giản:
  // một thang điểm ẩn là thứ người dùng không kiểm chứng được nên sẽ không tin.
  const hangDoi: DongHangDoi[] = [
    ...cheViec(board.viec.quaHan, "QUA_HAN"),
    ...cheViec(board.viec.homNay, "HOM_NAY"),
  ];
  const soQuaHan = board.viec.quaHan.length;
  const canCham = board.canCham.map((c) => {
    const m = maskLeadPiiFields({ phone: c.phone }, canViewPii);
    return {
      ...c,
      tenKhach: canViewPii ? c.tenKhach : maskPersonName(c.tenKhach),
      phone: m.phone ?? null,
    };
  });

  // 26/08 — đọc V2 sau khi gộp hai hệ Trial.
  //
  // Vào từ LỚP (TrialClassV2 ∈ SCOPED_MODELS) để giữ cách ly cơ sở: `TrialClassSession`
  // không được scopedDb tự lọc, truy vấn thẳng nó là Sale cơ sở này thấy hẹn cơ sở kia.
  // Lọc ghi danh theo Sale phụ trách lead — một lớp trải nghiệm chứa con của nhiều Sale.
  const trialClasses = await sdb.trialClassV2.findMany({
    where: {
      status: { not: "CANCELLED" },
      sessions: { some: { date: { gte: dayStart }, status: "SCHEDULED" } },
      enrollments: { some: { leadChild: { lead: { assignedToId: userId, deletedAt: null } } } },
    },
    take: 20,
    select: {
      sessions: {
        where: { date: { gte: dayStart }, status: "SCHEDULED" },
        select: { id: true, date: true, startTime: true },
      },
      enrollments: {
        where: {
          status: { in: ["ACTIVE", "COMPLETED"] },
          leadChild: { lead: { assignedToId: userId, deletedAt: null } },
        },
        select: {
          id: true,
          scheduledSessionId: true,
          leadChild: {
            select: { fullName: true, lead: { select: { id: true, parentName: true } } },
          },
        },
      },
    },
  });
  // Ghép ghi danh ↔ buổi của nó. `TrialEnrollment.scheduledSessionId` là cột TRẦN
  // (không FK) nên Prisma không join hộ được — ghép tay ở đây.
  // Ngày format bằng `@db.Date` ⇒ đọc theo UTC mới ra đúng ngày lịch VN.
  const trials = trialClasses
    .flatMap((c) =>
      c.enrollments.map((e) => {
        const ses = c.sessions.find((s) => s.id === e.scheduledSessionId);
        if (!ses) return null; // ghi danh trỏ buổi đã qua / chưa xếp → không phải "sắp tới"
        const d = ses.date;
        const ngay = `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return {
          id: e.id,
          leadId: e.leadChild.lead?.id ?? "",
          name: e.leadChild.fullName || (e.leadChild.lead?.parentName ?? "—"),
          when: `${ngay} ${ses.startTime}`,
          sort: d.getTime(),
        };
      }),
    )
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 6);

  // REQ-04: cache số liệu tổng hợp theo USER (userId), TTL 60s.
  const { totalMine, enrolledMonth, closeRate, countByStatus, weeklyBars, nearingEndCount } =
    await safeCache(
      () => getSalesStats(userId),
      ["sales-dashboard-stats", userId],
      { tags: [CACHE_TAGS.dashboard], revalidate: 60 },
    )();

  return (
    <div className="space-y-6">
      {!embedded && (
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Chào {name || "bạn"}
        </h1>
      )}

      {/* ═══ Việc của tôi ═══════════════════════════════════════════════════
          CHỐT 27/08/2026 — LỰA CHỌN CÓ CHỦ ĐÍCH, ĐỪNG "SỬA CHO ĐÚNG":
          bốn ô này lọc theo `assignedToId = tôi` và PHẢI giữ nguyên như vậy.

          Bảng điều khiển của Sale tồn tại để trả lời "hôm nay tôi gọi ai", không
          phải để đếm thành tích của cơ sở. Mở bốn ô này ra thành số của cả cơ sở
          nghe thì "đầy đủ hơn", nhưng nó biến màn hành động thành bảng xếp hạng —
          và Sale mất đúng cái duy nhất họ cần khi vừa đăng nhập.

          Người sau nhìn "Lead của tôi" trên một bảng điều khiển rất dễ tưởng là
          thiếu sót. Nó không phải. Muốn xem theo cơ sở thì đã có màn Danh sách
          khách với bộ lọc riêng. `sales-dashboard.test.ts` canh cả cách lọc lẫn
          nhãn, nên đổi một trong hai sẽ đỏ chứ không lặng lẽ trôi.

          Nhãn cố ý KHÔNG ghi "hôm nay": chỉ "Việc của tôi quá hạn" mới thật sự là
          việc trong ngày; ba ô còn lại là tồn kho / tháng này / tỉ lệ luỹ kế. Ghi
          "hôm nay" lên chúng là thay một nhãn mơ hồ bằng một nhãn sai. */}
      <section aria-labelledby="sale-viec-cua-toi">
        <h2
          id="sale-viec-cua-toi"
          className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground"
        >
          Việc của tôi
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <DashStat label="Khách tôi đang giữ" value={totalMine} href="/leads" icon={Users} />
          <DashStat label="Tôi chốt trong tháng" value={enrolledMonth} href="/leads" tone="success" icon={TrendingUp} />
          <DashStat label="Tỷ lệ chốt của tôi" value={`${closeRate}%`} href="/leads" icon={TrendingUp} />
          <DashStat label="Việc của tôi quá hạn" value={soQuaHan} href="/leads?view=kanban" tone={soQuaHan > 0 ? "danger" : "success"} icon={CheckSquare} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Bốn ô trên chỉ tính phiếu <b>được giao cho bạn</b> — đây là bảng để biết hôm
          nay gọi ai, không phải bảng thành tích. Xem theo cơ sở hoặc theo bộ lọc khác
          thì vào <Link href="/leads" className="underline hover:text-primary">Danh sách khách</Link>.
        </p>
      </section>

      {/* ═══ HÀNG ĐỢI HÔM NAY — trụ của trang ═══════════════════════════════
          MỘT bảng, xếp quá hạn trước. Bản cũ bày cùng nội dung này ở hai khối
          rời ("Quá hạn" + "Đến hạn hôm nay") rồi lặp lại lần nữa ở mục "Việc cần
          làm" phía dưới — ba hình dạng cho cùng một tập dòng.
          Đường dẫn trỏ `/leads/<id>` (màn lead của admin), KHÔNG phải
          `/sale/khach-cua-toi/<id>` như bản trên site Sale cũ. */}
      <section aria-labelledby="sale-hang-doi" className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3.5">
          <h2 id="sale-hang-doi" className="text-sm font-bold text-foreground">
            Hàng đợi hôm nay
          </h2>
          <div className="flex items-center gap-2">
            {soQuaHan > 0 && <StatusPill tone="danger">{soQuaHan} quá hạn</StatusPill>}
            <StatusPill tone={board.viec.homNay.length > 0 ? "warning" : "muted"}>
              {board.viec.homNay.length} đến hạn hôm nay
            </StatusPill>
          </div>
        </div>

        {hangDoi.length === 0 ? (
          <KhongCoGi
            tieuDe="Sạch hàng đợi"
            mo="Không việc nào quá hạn hay đến hạn hôm nay. Việc có hạn ngày khác nằm ở bảng Kanban."
          />
        ) : (
          <PhanTrangBang tenDonVi="việc" khoaGhiNho="sale-hang-doi" cuonNgang>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {/* Ở 375px chỉ vừa HAI cột. Giữ "Khách" + "Việc cần làm" — đó là ai
                      và làm gì; mốc hạn gộp vào ô Khách, nút mở phiếu bỏ hẳn vì chính
                      tên khách đã là đường dẫn. Bản trước đẩy "Việc cần làm" ra ngoài
                      mép màn hình: đúng thứ người ta mở bảng để đọc. */}
                  <th scope="col" className={cn(adminTh, "hidden sm:table-cell")}>Hạn</th>
                  <th scope="col" className={adminTh}>Khách</th>
                  <th scope="col" className={cn(adminTh, "w-full")}>Việc cần làm</th>
                  <th scope="col" className={cn(adminTh, "hidden sm:table-cell")}>
                    <span className="sr-only">Mở phiếu</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {hangDoi.map((v) => (
                  <tr key={v.id} className={adminTr}>
                    <td className={cn(adminTd, "hidden align-top sm:table-cell")}>
                      <PillHan khan={v.khan} dueAt={v.dueAt} />
                    </td>
                    <td className={cn(adminTd, "max-w-[150px] truncate align-top font-medium sm:max-w-[280px]")}>
                      <Link href={`/leads/${v.leadId}`} className="text-primary-ink hover:underline">
                        {v.tenKhach || "(chưa có tên)"}
                      </Link>
                      <span className="mt-1 block sm:hidden">
                        <PillHan khan={v.khan} dueAt={v.dueAt} />
                      </span>
                    </td>
                    <td className={cn(adminTd, "max-w-[185px] truncate align-top text-muted-foreground sm:max-w-[520px]")}>
                      {v.title}
                    </td>
                    <td className={cn(adminTd, "hidden text-right align-top sm:table-cell")}>
                      <Link
                        href={`/leads/${v.leadId}`}
                        aria-label={`Mở phiếu của ${v.tenKhach || "khách chưa có tên"}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary-ink hover:underline"
                      >
                        Mở phiếu
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}

        {board.viec.sapToi.length > 0 && (
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Còn {board.viec.sapToi.length} việc có hạn sau hôm nay —{" "}
            <Link href="/leads?view=kanban" className="font-medium text-primary-ink hover:underline">
              xem ở Danh sách khách
            </Link>
            .
          </p>
        )}
      </section>

      {/* ═══ KHÁCH CẦN CHẠM — bảng thứ hai, phân trang 20 dòng ══════════════
          Chủ dự án chốt 22/09/2026: danh sách này dài (đo trên test: 38 dòng) nên
          nó là BẢNG có phân trang, không phải một `<ul>` đổ hết ra màn hình.
          20 dòng/trang là mặc định chung của hệ (`SO_DONG_MAC_DINH`). */}
      <section aria-labelledby="sale-can-cham" className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3.5">
          <h2 id="sale-can-cham" className="text-sm font-bold text-foreground">
            Khách cần chạm{" "}
            <span className="font-normal tabular-nums text-muted-foreground">({canCham.length})</span>
          </h2>
          {/* Nói rõ vì sao khách có mặt ở đây — một danh sách không giải thích được
              thì người dùng sẽ nghi nó sai rồi bỏ qua. */}
          <p className="text-xs text-muted-foreground">
            Người im lâu nhất xếp trên · ngưỡng lấy từ Cấu hình vận hành
          </p>
        </div>

        {canCham.length === 0 ? (
          <KhongCoGi
            tieuDe="Không ai đang chờ"
            mo="Mọi khách đang mở đều đã được chạm trong ngưỡng cho phép."
          />
        ) : (
          <PhanTrangBang tenDonVi="khách" khoaGhiNho="sale-can-cham" cuonNgang>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {/* Trên điện thoại giữ SĐT — đây là bảng để GỌI. Lý do và ngày chạm
                      gần nhất xuống dưới tên thay vì bị đẩy ra ngoài mép màn hình. */}
                  <th scope="col" className={adminTh}>Khách</th>
                  <th scope="col" className={adminTh}>Số điện thoại</th>
                  <th scope="col" className={cn(adminTh, "hidden w-full sm:table-cell")}>Vì sao có mặt ở đây</th>
                  <th scope="col" className={cn(adminTh, "hidden text-right sm:table-cell")}>Chạm lần cuối</th>
                </tr>
              </thead>
              <tbody>
                {canCham.map((c) => (
                  <tr key={c.id} className={adminTr}>
                    <td className={cn(adminTd, "max-w-[140px] truncate align-top font-medium sm:max-w-[280px]")}>
                      <Link href={`/leads/${c.id}`} className="text-primary-ink hover:underline">
                        {c.tenKhach || "(chưa có tên)"}
                      </Link>
                      <span className="mt-0.5 block truncate text-xs font-normal text-[color:var(--state-warning-ink)] sm:hidden">
                        {c.vi.join(" · ")}
                      </span>
                      <span className="block truncate text-xs font-normal text-muted-foreground sm:hidden">
                        {c.lastActivityAt ? `chạm ${formatDateVN(c.lastActivityAt)}` : "chưa chạm lần nào"}
                      </span>
                    </td>
                    <td className={cn(adminTd, "align-top tabular-nums text-muted-foreground")}>
                      {c.phone || "—"}
                    </td>
                    <td className={cn(adminTd, "hidden max-w-[420px] truncate text-[color:var(--state-warning-ink)] sm:table-cell")}>
                      {c.vi.join(" · ")}
                    </td>
                    <td className={cn(adminTd, "hidden text-right text-muted-foreground sm:table-cell")}>
                      {c.lastActivityAt ? formatDateVN(c.lastActivityAt) : "chưa lần nào"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PhanTrangBang>
        )}
      </section>

      {/* ⚠️ KHỐI NÀY NẰM NGOÀI "Việc của tôi" — CÓ CHỦ ĐÍCH.
          `getNearingEndEnrollments()` gọi KHÔNG tham số ⇒ nó đếm học viên sắp hết
          khoá của MỌI cơ sở: không lọc theo người được giao, cũng không lọc theo cơ
          sở của người đang xem (`lib/students/renewal.ts` dùng `db` trần, tham số
          `centerId` bỏ trống). Nó khác bản chất với bốn ô trên, nên không được đội
          nhãn "của tôi".
          Cách lọc của nó chưa sửa (ngoài phạm vi đợt 27/08 — chốt là "giữ nguyên
          cách lọc, chỉ đổi nhãn"). Đây là việc còn treo, đã báo lại chủ dự án. */}
      {nearingEndCount > 0 && (
        <Link
          href="/enrollments?tab=sap-het-khoa"
          className="flex items-center gap-3 rounded-xl border border-border bg-[color:var(--state-warning-soft)] px-5 py-3.5 text-sm text-[color:var(--state-warning-ink)] transition-colors hover:border-[color:var(--state-warning)]"
        >
          <GraduationCap className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            <b className="tabular-nums">{nearingEndCount}</b> học viên sắp hết khoá (≤ 5 buổi) — nhắc phụ huynh tái tục.
          </span>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0" aria-hidden />
        </Link>
      )}

      {/* ═══ NHÌN LẠI — vùng thứ cấp ════════════════════════════════════════
          Phễu, giai đoạn và lịch trải nghiệm KHÔNG phải việc phải bấm ngay, nên
          chúng nằm dưới hàng đợi chứ không xen vào giữa. Thứ tự trên màn = thứ tự
          ưu tiên trong ngày, đó là toàn bộ lý do sắp xếp lại. */}
      <section aria-labelledby="sale-nhin-lai" className="space-y-4 border-t border-border pt-6">
        <h2
          id="sale-nhin-lai"
          className="text-sm font-bold uppercase tracking-wider text-muted-foreground"
        >
          Nhìn lại
        </h2>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Pipeline của tôi */}
          <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Lead của tôi theo giai đoạn</h3>
            <div className="flex flex-wrap gap-2">
              {KANBAN_COLUMNS.map((s) => (
                <Link
                  key={s}
                  href={`/leads?status=${s}`}
                  className={cn(
                    "inline-flex whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80",
                    LEAD_STATUS_BADGE[s],
                  )}
                >
                  {LEAD_STATUS_LABEL[s]}: <strong className="ml-1 tabular-nums">{countByStatus[s] ?? 0}</strong>
                </Link>
              ))}
            </div>
          </div>

          {/* Học thử sắp tới */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <FlaskConical className="h-4 w-4 text-primary" aria-hidden /> Trải nghiệm sắp tới
            </h3>
            {trials.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có buổi trải nghiệm nào được xếp.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {trials.map((t) => (
                  <li key={t.id} className="flex items-baseline justify-between gap-3">
                    <Link
                      href={`/leads/${t.leadId}`}
                      className="min-w-0 truncate font-medium text-foreground hover:text-primary-ink"
                    >
                      {t.name}
                    </Link>
                    <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {t.when}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Phễu lead theo TUẦN — lead của tôi: mới vs chuyển đổi (8 tuần gần nhất). */}
        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">Phễu lead theo tuần</h3>
          <p className="mb-4 text-xs text-muted-foreground">
            Lead mới so với đã chuyển đổi, 8 tuần gần nhất
          </p>
          <BarChart
            data={weeklyBars}
            xKey="week"
            bars={[
              { key: "total", name: "Lead mới", color: "#F97316" },
              { key: "converted", name: "Chuyển đổi", color: "#7C3AED" },
            ]}
            height={240}
          />
        </div>
      </section>
    </div>
  );
}

/** Mốc hạn của một việc. Hiện ở HAI chỗ (cột riêng trên màn rộng, dưới tên khách
 *  trên điện thoại) nên chỉ giữ MỘT bản — hai bản là hai lần sửa. */
function PillHan({ khan, dueAt }: { khan: DongHangDoi["khan"]; dueAt: Date }) {
  return (
    <StatusPill tone={khan === "QUA_HAN" ? "danger" : "warning"}>
      {khan === "QUA_HAN" ? `Quá hạn · ${formatDateVN(dueAt)}` : "Hôm nay"}
    </StatusPill>
  );
}

/**
 * Dòng rỗng TRONG một thẻ đã có viền — nhẹ hơn `<EmptyState>` (thứ tự dựng cả một
 * thẻ riêng, lồng vào đây là thẻ trong thẻ).
 */
function KhongCoGi({ tieuDe, mo }: { tieuDe: string; mo: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Inbox className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-sm font-semibold text-foreground">{tieuDe}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{mo}</p>
    </div>
  );
}

/**
 * Ô số của bảng điều khiển. Vỏ mỏng quanh `StatCard` của hệ.
 *
 * ⚠️ GIỮ NGUYÊN tên `DashStat` và để prop `label` đứng ĐẦU: `sales-dashboard.test.ts`
 * quét nguồn theo đúng hình dạng đó để bắt lần sửa làm bốn ô rơi mất nghĩa "của tôi".
 * Bộ test đếm trên nguồn THÔ (không bỏ chú thích) nên chú thích cũng không được viết
 * lại hình dạng ấy — đúng một lần nữa là nó đếm thành năm.
 */
function DashStat({
  label, value, href, tone = "brand", icon,
}: {
  label: string;
  value: number | string;
  href: string;
  tone?: StatTone;
  icon: LucideIcon;
}) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <StatCard icon={icon} value={value} label={label} tone={tone} wrapLabel />
    </Link>
  );
}
