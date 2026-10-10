// app/(admin)/admin/hoi-thoai/page.tsx — US-15 AC1 (nửa đầu) + AC5.
//
// Tra cứu METADATA hội thoại: tìm theo lớp / cơ sở / người. Trang này **KHÔNG hiển thị
// một chữ nào của nội dung tin** — kể cả preview: preview của hội thoại mình không thuộc
// về cũng là nội dung, mà nội dung chỉ mở được qua đường có lý do + AuditLog
// (`/hoi-thoai/[conversationId]` → F-AUDIT).
//
// CỔNG QUYỀN (AC5): `chat:admin` — quyền này CHỈ SUPER_ADMIN có (`prisma/seed-roles.ts`;
// QLCS cố ý không có, xem chú thích tại chỗ ở seed). Gate gọi `checkPermission` KHÔNG
// target được vì `chat:admin` seed scope GLOBAL — khác `chat:read`/`chat:send` (CENTER/
// ASSIGNED) vốn không dùng làm gate cấp trang được (xem `lib/auth/page-gates.ts`).
//
// Segment "hoi-thoai" đã nằm sẵn trong `ADMIN_ROUTE_SEGMENTS` (`lib/auth/route-policy.ts`)
// từ US-04 — không phải sửa route policy.
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessagesSquare, ScrollText, Search } from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { scopedDb } from "@/lib/db-scope";
import { listAdminConversations } from "@/lib/chat/admin";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const metadata = { title: "Quản trị hội thoại | Admin" };
export const dynamic = "force-dynamic";

const fmtVN = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  dateStyle: "short",
  timeStyle: "short",
});

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-xs";

const TYPE_LABEL: Record<string, string> = {
  CLASS_GROUP: "Nhóm lớp",
  DM_TEACHER_PARENT: "1-1 GV↔PH",
  DM_SALE_PARENT: "1-1 Sale↔PH",
  DM_STAFF: "1-1 nội bộ",
};

function StatusBadge({ status }: { status: string }) {
  if (status === "LOCKED") return <Badge variant="destructive">Đang khoá</Badge>;
  if (status === "ARCHIVED") return <Badge variant="secondary">Đã lưu trữ</Badge>;
  return <Badge variant="outline">Đang hoạt động</Badge>;
}

export default async function AdminConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; center?: string; type?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!(await checkPermission("chat:admin"))) redirect("/dashboard?error=unauthorized");

  const sp = await searchParams;
  const actor = await resolveActor(session.user.id);
  // Center ∈ SCOPE_EXEMPT (danh mục tổ chức) → sdb pass-through; đi qua scopedDb vì đây
  // là app/(admin) và cổng `@/lib/db` trần đã đóng (ESLint).
  const sdb = scopedDb(actor);

  const [centers, rows] = await Promise.all([
    sdb.center.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Hàm này TỰ kiểm `can(actor, "chat:admin")` lần nữa — gate của trang không phải
    // cổng duy nhất (mai có route/API nào gọi tới thì cổng vẫn đứng đó).
    listAdminConversations(actor, {
      q: sp.q ?? null,
      centerId: sp.center ?? null,
      type: sp.type ?? null,
      status: sp.status ?? null,
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft">
            <MessagesSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Quản trị hội thoại</h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Tra cứu khi xử lý khiếu nại và khoá nhóm vi phạm. Trang này chỉ hiện thông
              tin hồ sơ — <strong>nội dung tin nhắn chỉ mở được sau khi nhập lý do</strong>,
              và mỗi lần mở đều ghi vào nhật ký kèm tên người xem.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/audit-log"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ScrollText className="h-4 w-4" /> Nhật ký (lọc module &quot;chat&quot;)
          </Link>
          <Link
            href="/hoi-thoai/doi-soat"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Đối soát thành viên
          </Link>
        </div>
      </div>

      {/* Form GET thuần: bộ lọc nằm trên URL nên chia sẻ/đánh dấu được, và không cần
          một Client Component nào cho việc tìm kiếm. */}
      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <div className="space-y-1 lg:col-span-2">
          <Label htmlFor="q" className="text-xs">
            Tìm theo lớp / người
          </Label>
          <Input
            id="q"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Tên lớp, mã lớp, tên hoặc SĐT người trong hội thoại"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="center" className="text-xs">
            Cơ sở
          </Label>
          <select id="center" name="center" defaultValue={sp.center ?? ""} className={selectClass}>
            <option value="">— Tất cả —</option>
            {centers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="type" className="text-xs">
            Loại
          </Label>
          <select id="type" name="type" defaultValue={sp.type ?? ""} className={selectClass}>
            <option value="">— Tất cả —</option>
            <option value="CLASS_GROUP">Nhóm lớp</option>
            <option value="DM_TEACHER_PARENT">1-1 GV↔PH</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status" className="text-xs">
            Trạng thái
          </Label>
          <div className="flex gap-2">
            <select
              id="status"
              name="status"
              defaultValue={sp.status ?? ""}
              className={selectClass}
            >
              <option value="">— Tất cả —</option>
              <option value="ACTIVE">Đang hoạt động</option>
              <option value="LOCKED">Đang khoá</option>
              <option value="ARCHIVED">Đã lưu trữ</option>
            </select>
            <Button type="submit" size="sm" className="h-9 shrink-0">
              <Search className="h-4 w-4" aria-hidden /> Tìm
            </Button>
          </div>
        </div>
      </form>

      {/* ⚠️ Lọc theo cơ sở KHÔNG bao giờ ra hội thoại 1-1: DM có `centerId = null` theo
          thiết kế (delta E.3) — nó không thuộc cơ sở nào. Tìm 1-1 thì để trống ô cơ sở. */}
      <div className="rounded-xl border border-border bg-card">
        <PhanTrangBang>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hội thoại</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Cơ sở</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thành viên</TableHead>
                <TableHead className="text-right">Số tin</TableHead>
                <TableHead>Hoạt động cuối</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    Không có hội thoại nào khớp bộ lọc.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.conversationId}>
                    <TableCell className="font-medium">{r.displayName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {TYPE_LABEL[r.type] ?? r.type}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.centerName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">{r.participantCount}</TableCell>
                    <TableCell className="text-right">{r.messageCount}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.lastMessageAt ? fmtVN.format(r.lastMessageAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/hoi-thoai/${r.conversationId}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        Mở hồ sơ →
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </PhanTrangBang>
      </div>
    </div>
  );
}
