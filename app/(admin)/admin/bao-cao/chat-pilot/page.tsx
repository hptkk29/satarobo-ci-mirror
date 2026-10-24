// app/(admin)/admin/bao-cao/chat-pilot/page.tsx — US-16 AC4: bảng số đo pilot chat.
//
// Trả lời theo TỪNG LỚP: bao nhiêu % phụ huynh đã kích hoạt tài khoản, và bao nhiêu %
// đọc thông báo đầu tiên của nhóm trong vòng 48 giờ. Đây là nguồn số cho cổng Đợt 2.
//
// VÌ SAO ĐẶT Ở `/bao-cao/*` CHỨ KHÔNG PHẢI `/hoi-thoai/*`: segment `bao-cao` đã có sẵn
// trong `ADMIN_ROUTE_SEGMENTS` (lib/auth/route-policy.ts) nên không phải sửa route policy,
// và về bản chất đây là một BÁO CÁO — không phải công cụ quản trị hội thoại.
//
// CỔNG QUYỀN: `chat:admin` — gọi `checkPermission` KHÔNG target được vì action này seed
// scope GLOBAL và chỉ SUPER_ADMIN giữ (prisma/seed-roles.ts). KHÔNG mượn `chat:read`:
// dưới RBAC v2 (đang bật prod) nó seed scope CENTER/ASSIGNED nên gọi trần luôn trả false —
// xanh ở local, khoá cửa trên prod (bài học đã ghi ở lib/auth/page-gates.ts).
// KHÔNG thêm route này vào `PAGE_GATES` vì file đó đang do nhóm khác giữ; gate gọi thẳng.
//
// TRANG NÀY KHÔNG HIỆN MỘT CHỮ NỘI DUNG NÀO: chỉ đếm. Không tên phụ huynh, không tên
// người chưa đọc, không nội dung thông báo — muốn biết ai chưa đọc thì đó là việc của
// giáo viên trong nhóm (`getAnnouncementReadStats`), không phải của bảng số quản trị.
import { redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { getCenterOptions } from "@/lib/org/center-options";
import {
  getChatPilotStats,
  pct,
  sumPilotTotals,
  PILOT_READ_WINDOW_HOURS,
} from "@/lib/chat/pilot-stats";
import { CHAT_POLICY_VERSION } from "@/lib/chat/policy-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

export const metadata = { title: "Đo pilot chat | Admin" };
export const dynamic = "force-dynamic";

const fmtVN = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  dateStyle: "short",
  timeStyle: "short",
});

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs";

/** "12/20 · 60%" — luôn kèm phân số vì 60% của 5 người khác hẳn 60% của 500. */
function ratio(numerator: number, denominator: number) {
  const p = pct(numerator, denominator);
  return (
    <span className="whitespace-nowrap tabular-nums">
      {numerator}/{denominator}
      <span className="ml-1.5 text-muted-foreground">{p === null ? "—" : `${p}%`}</span>
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default async function ChatPilotReportPage({
  searchParams,
}: {
  searchParams: Promise<{ center?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await checkPermission("chat:admin"))) redirect("/dashboard?error=unauthorized");

  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);

  const [centers, rows] = await Promise.all([
    // Bản cũ `center.findMany({ isActive: true })` bày cả Hội sở (không dạy học, không
    // lớp nào) lẫn dòng Center mồ côi, và KHÔNG cắt theo tầm nhìn của người xem — ô lọc
    // rộng hơn bảng số bên dưới. Helper lo cả ba việc đó.
    getCenterOptions(actor),
    getChatPilotStats(actor, { centerId: sp.center || null }),
  ]);

  const totals = sumPilotTotals(rows);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
          aria-hidden
        >
          <BarChart3 className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-bold text-foreground">Đo pilot chat theo lớp</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mỗi dòng là một nhóm lớp đang có trên hệ thống. Mẫu số là{" "}
            <strong>phụ huynh đang là thành viên nhóm</strong> — giáo viên, trợ giảng và
            quản lý cơ sở không tính vào.
          </p>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Label htmlFor="center" className="text-xs">
            Cơ sở
          </Label>
          <select id="center" name="center" defaultValue={sp.center ?? ""} className={selectClass}>
            <option value="">Tất cả cơ sở</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Lọc
        </Button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Nhóm lớp" value={String(totals.classCount)} hint="trong tầm nhìn của bạn" />
        <Stat
          label="Đã kích hoạt tài khoản"
          value={
            pct(totals.activatedCount, totals.parentCount) === null
              ? "—"
              : `${pct(totals.activatedCount, totals.parentCount)}%`
          }
          hint={`${totals.activatedCount}/${totals.parentCount} phụ huynh`}
        />
        <Stat
          label="Đã từng đăng nhập"
          value={
            pct(totals.loggedInCount, totals.parentCount) === null
              ? "—"
              : `${pct(totals.loggedInCount, totals.parentCount)}%`
          }
          hint="tín hiệu thật, xem ghi chú bên dưới"
        />
        <Stat
          label={`Đọc thông báo đầu ≤ ${PILOT_READ_WINDOW_HOURS}h`}
          value={
            pct(totals.readWithinWindowCount, totals.announcementRecipientCount) === null
              ? "—"
              : `${pct(totals.readWithinWindowCount, totals.announcementRecipientCount)}%`
          }
          hint={`${totals.readWithinWindowCount}/${totals.announcementRecipientCount} PH · ${totals.classesWithAnnouncement}/${totals.classCount} lớp đã có thông báo`}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <PhanTrangBang cuonNgang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lớp</TableHead>
                <TableHead>Cơ sở</TableHead>
                <TableHead className="text-right">PH trong nhóm</TableHead>
                <TableHead className="text-right">Đã kích hoạt</TableHead>
                <TableHead className="text-right">Đã đăng nhập</TableHead>
                <TableHead className="text-right">Đồng ý quy định</TableHead>
                <TableHead>Thông báo đầu</TableHead>
                <TableHead className="text-right">Đọc ≤ {PILOT_READ_WINDOW_HOURS}h</TableHead>
                <TableHead className="text-right">Đã đọc (mọi lúc)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    Chưa có nhóm lớp nào. Nhóm sinh ra khi lớp chuyển sang hoạt động — lớp đã
                    ACTIVE từ trước ngày phát hành chat thì phải chạy{" "}
                    <code>scripts/backfill-nhom-lop-chat.ts</code>.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.conversationId}>
                    <TableCell className="font-medium">
                      {r.className}
                      {r.conversationStatus !== "ACTIVE" && (
                        <Badge variant="secondary" className="ml-2">
                          {r.conversationStatus === "ARCHIVED" ? "Đã lưu trữ" : "Đang khoá"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.centerName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.parentCount}</TableCell>
                    <TableCell className="text-right">
                      {ratio(r.activatedCount, r.parentCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {ratio(r.loggedInCount, r.parentCount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {ratio(r.policyAcceptedCount, r.parentCount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.firstAnnouncementAt ? (
                        <>
                          {fmtVN.format(r.firstAnnouncementAt)}
                          {!r.windowClosed && (
                            <Badge variant="outline" className="ml-2">
                              đang trong {PILOT_READ_WINDOW_HOURS}h
                            </Badge>
                          )}
                        </>
                      ) : (
                        <span className="text-state-warning-ink">chưa có thông báo</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.firstAnnouncementAt ? ratio(r.readWithinWindowCount, r.parentCount) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.firstAnnouncementAt ? ratio(r.readTotalCount, r.parentCount) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>

      <div className="space-y-1.5 rounded-xl border border-border bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">Đọc con số cho đúng</p>
        <p>
          • <strong>Đã kích hoạt</strong> = tài khoản ở trạng thái ACTIVE. Tài khoản tạo
          trước cụm cấp tài khoản qua OTP vốn đã ACTIVE sẵn, nên cột này CÓ THỂ cao hơn
          thực tế. Cột <strong>Đã đăng nhập</strong> (có mốc đăng nhập gần nhất) mới là
          tín hiệu chắc chắn rằng phụ huynh vào được hệ thống.
        </p>
        <p>
          • <strong>Thông báo đầu</strong> là thông báo (ANNOUNCEMENT) sớm nhất còn hiển
          thị của nhóm; thông báo đã gỡ không tính. Lớp chưa có thông báo nào thì bỏ khỏi
          mẫu số của cột đọc — không tính thành 0%.
        </p>
        <p>
          • Mốc &quot;đã đọc&quot; ghi khi phụ huynh cuộn tới thông báo (hiện ≥50% trên màn
          hình), không phải khi mở ứng dụng.
        </p>
        <p>
          • <strong>Đồng ý quy định</strong> tính theo bản chính sách đang phát hành (
          <code>{CHAT_POLICY_VERSION}</code>). Đổi nội dung chính sách và tăng version thì
          cột này reset — đó là chủ đích.
        </p>
      </div>
    </div>
  );
}
