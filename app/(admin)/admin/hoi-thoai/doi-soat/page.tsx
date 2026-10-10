import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { checkPermission } from "@/lib/auth/check-permission";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHelp } from "@/components/admin/ui/page-help";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

// US-04 AC3 — trang xem log job đối soát thành viên nhóm chat (cron 02:00 VN).
// Gate `chat:admin` (chỉ SUPER_ADMIN — US-15 AC5 chặn QLCS) qua checkPermission
// (resolveActor + can v2, shadow v1 — KHÔNG viết điều kiện quyền inline).
// Không nằm sidebar → không cần entry PAGE_GATES (bảng đó chỉ giữ bất biến menu≡gate).
export const metadata = { title: "Đối soát thành viên chat | Admin" };
export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ type?: string }>;
}

const DRIFT_LIMIT = 100;
const RUN_LIMIT = 14; // 2 tuần chạy đêm

const fmtVN = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  dateStyle: "short",
  timeStyle: "medium",
});

export default async function ChatReconcileLogPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkPermission("chat:admin")))
    redirect("/dashboard?error=unauthorized");

  const sp = await searchParams;
  const typeFilter =
    sp.type === "REMOVE" || sp.type === "ADD" ? sp.type : undefined;

  const actor = await resolveActor(session.user.id);
  // Drift/Run là log kỹ thuật SCOPE_EXEMPT; viewer chat:admin = SUPER_ADMIN (bypass).
  const sdb = scopedDb(actor);

  const [runs, drifts] = await Promise.all([
    sdb.conversationReconcileRun.findMany({
      orderBy: { ranAt: "desc" },
      take: RUN_LIMIT,
    }),
    sdb.conversationMembershipDrift.findMany({
      where: typeFilter ? { driftType: typeFilter } : undefined,
      orderBy: { createdAt: "desc" },
      take: DRIFT_LIMIT,
    }),
  ]);

  // Tra tên lớp + user cho dòng drift (userId không có FK — join tay).
  const classIds = [...new Set(drifts.map((x) => x.classId))];
  const userIds = [...new Set(drifts.map((x) => x.userId))];
  const [classes, users] = await Promise.all([
    classIds.length
      ? sdb.class.findMany({
          where: { id: { in: classIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? sdb.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const classById = new Map(classes.map((c) => [c.id, c.name]));
  const userById = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const lastRun = runs[0];

  return (
    <div className="space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Đối soát thành viên nhóm chat
        </h1>
      </div>

      <PageHelp>
        <p>
          Cron chạy hằng đêm 02:00 (giờ VN): lệch REMOVE được tự gỡ ngay
          (autoEnforced), lệch ADD chỉ ghi log chờ người xử lý. Không có dòng
          chạy nào 2 đêm liên tiếp là tín hiệu cần điều tra (job không chạy ≠
          đêm sạch).
        </p>
      </PageHelp>

      {/* Cảnh báo lớp ACTIVE chưa có nhóm (09/08/2026). Job CỐ Ý không tự tạo nhóm —
          nó chỉ đếm; tạo là việc chạy tay có dry-run. Không gộp vào badge "0 drift" ở
          dưới: đó là hai loại vấn đề khác nhau (drift = nhóm có mà sai người;
          thiếu nhóm = lớp chưa từng có nhóm, đúng thứ đã giấu 24 lớp trước go-live). */}
      {lastRun && lastRun.missingConversations > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">
            ⚠️ {lastRun.missingConversations} lớp đang hoạt động CHƯA có nhóm
            chat
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Giáo viên và phụ huynh của những lớp này mở màn tin nhắn ra sẽ thấy
            trống. Job đối soát cố ý KHÔNG tự tạo nhóm — chạy{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              pnpm exec tsx scripts/backfill-nhom-lop-chat.ts
            </code>{" "}
            (mặc định dry-run, soi kỹ danh sách rồi thêm{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              --apply
            </code>
            ).
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Lần chạy gần nhất{" "}
          {lastRun ? (
            lastRun.removeCount === 0 && lastRun.addCount === 0 ? (
              <Badge variant="secondary">0 drift</Badge>
            ) : (
              <Badge variant="destructive">
                REMOVE {lastRun.removeCount} · ADD {lastRun.addCount}
              </Badge>
            )
          ) : (
            <Badge variant="outline">chưa từng chạy</Badge>
          )}
        </h2>
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Chạy lúc (VN)</TableHead>
                <TableHead className="text-right">Lớp kiểm</TableHead>
                <TableHead className="text-right">REMOVE (tự gỡ)</TableHead>
                <TableHead className="text-right">ADD (chờ người)</TableHead>
                <TableHead className="text-right">Thiếu nhóm</TableHead>
                <TableHead className="text-right">Thời lượng</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Chưa có lần chạy nào.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{fmtVN.format(r.ranAt)}</TableCell>
                    <TableCell className="text-right">
                      {r.classesChecked}
                    </TableCell>
                    <TableCell className="text-right">{r.removeCount}</TableCell>
                    <TableCell className="text-right">{r.addCount}</TableCell>
                    <TableCell
                      className={
                        r.missingConversations > 0
                          ? "text-right font-medium text-destructive"
                          : "text-right"
                      }
                    >
                      {r.missingConversations}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.durationMs} ms
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Drift mới nhất</h2>
          <nav className="flex gap-2 text-sm">
            {[
              {
                href: "/hoi-thoai/doi-soat",
                label: "Tất cả",
                active: !typeFilter,
              },
              {
                href: "/hoi-thoai/doi-soat?type=REMOVE",
                label: "REMOVE",
                active: typeFilter === "REMOVE",
              },
              {
                href: "/hoi-thoai/doi-soat?type=ADD",
                label: "ADD",
                active: typeFilter === "ADD",
              },
            ].map((t) => (
              <Link
                key={t.label}
                href={t.href}
                className={
                  t.active
                    ? "rounded border bg-muted px-2 py-1 font-medium"
                    : "rounded border px-2 py-1 text-muted-foreground hover:bg-muted"
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lúc (VN)</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Lớp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Ngữ cảnh / luồng nghi vấn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Không có drift nào{typeFilter ? ` loại ${typeFilter}` : ""}.
                  </TableCell>
                </TableRow>
              ) : (
                drifts.map((x) => (
                  <TableRow key={x.id}>
                    <TableCell className="whitespace-nowrap">
                      {fmtVN.format(x.createdAt)}
                    </TableCell>
                    <TableCell>
                      {x.driftType === "REMOVE" ? (
                        <Badge variant="destructive">
                          REMOVE{x.autoEnforced ? " · đã tự gỡ" : ""}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">ADD · chờ người</Badge>
                      )}
                    </TableCell>
                    <TableCell>{classById.get(x.classId) ?? x.classId}</TableCell>
                    <TableCell>{userById.get(x.userId) ?? x.userId}</TableCell>
                    <TableCell className="max-w-xl text-sm text-muted-foreground">
                      {x.detail}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </section>
    </div>
  );
}
