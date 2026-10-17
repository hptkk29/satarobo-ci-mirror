// Lịch sử thay đổi pool — đọc `LeadAssignmentPoolEvent`.
//
// Trang CHỈ ĐỌC, không nút sửa: đây là chỗ trả lời "ai tắt tôi, lúc nào, vì sao".
// Sổ trả lời được câu đó mà lại sửa được thì nó thôi là câu trả lời.
//
// Nằm dưới `/quan-ly-chia-lead` nên KHÔNG cần khai `ADMIN_ROUTE_SEGMENTS` lần nữa
// (segment đầu đã khai) và KHÔNG cần mục sidebar riêng — vào từ link trong tab
// Cấu hình pool, `nav-coverage` bỏ qua route con.
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { checkAnyPermission } from "@/lib/auth/check-permission";
import { PAGE_GATES } from "@/lib/auth/page-gates";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { orgUnitIdCuaCoSo } from "@/lib/lead/pool";

export const metadata = { title: "Lịch sử thay đổi pool | Admin" };
export const dynamic = "force-dynamic";

const MOI_TRANG = 50;

/** Nhãn tiếng Việt cho `LeadAssignmentPoolEvent.action`. */
const NHAN: Record<string, string> = {
  ADD: "Thêm vào pool",
  ACTIVATE: "Bật lại nhận lead",
  DEACTIVATE: "Tắt nhận lead",
  RESET_UNIT: "Đặt lại lượt toàn cơ sở",
  MANUAL_ADJUST: "Chỉnh lượt thủ công",
  TRANSFER: "Chuyển cơ sở",
};

/** `{turns: 3, isActive: true}` → "lượt 3 · đang nhận". Giá trị lạ thì in thô. */
function moTa(v: unknown): string {
  if (v == null || typeof v !== "object") return "—";
  const o = v as Record<string, unknown>;
  const phan: string[] = [];
  if (typeof o.turns === "number") phan.push(`lượt ${o.turns}`);
  if (typeof o.seedTurns === "number") phan.push(`khởi điểm ${o.seedTurns}`);
  if (typeof o.isActive === "boolean") phan.push(o.isActive ? "đang nhận" : "tạm nghỉ");
  if (typeof o.orgUnitId === "string") phan.push(`đơn vị ${o.orgUnitId.slice(0, 8)}…`);
  return phan.length ? phan.join(" · ") : JSON.stringify(o);
}

function ngay(d: Date): string {
  return d.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

export default async function LichSuPoolPage({
  searchParams,
}: {
  searchParams: Promise<{ co_so?: string; trang?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await checkAnyPermission(PAGE_GATES["/quan-ly-chia-lead"]))) redirect("/dashboard");

  const sp = await searchParams;
  const trang = Math.max(1, Number(sp.trang ?? "1") || 1);
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const nhieuCoSo = actor.isSuperAdmin || actor.isHoLevel;

  // Cùng luật cách ly với màn cha: chỉ nhận cơ sở nằm trong tầm nhìn, nên gõ id lạ
  // vào URL ra rỗng chứ không rò lịch sử cơ sở khác.
  const centers = await sdb.center.findMany({
    where: {
      isActive: true,
      ...(nhieuCoSo ? {} : { id: { in: actor.visibleCenterIds } }),
      ...(sp.co_so ? { id: sp.co_so } : {}),
    },
    select: { id: true, name: true },
  });
  const orgUnitIds = (await Promise.all(centers.map((c) => orgUnitIdCuaCoSo(c.id)))).filter(
    Boolean,
  ) as string[];

  const where = { orgUnitId: { in: orgUnitIds } };
  const [tong, events] = await Promise.all([
    orgUnitIds.length ? sdb.leadAssignmentPoolEvent.count({ where }) : Promise.resolve(0),
    orgUnitIds.length
      ? sdb.leadAssignmentPoolEvent.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (trang - 1) * MOI_TRANG,
          take: MOI_TRANG,
          select: {
            id: true,
            createdAt: true,
            userId: true,
            action: true,
            fromValue: true,
            toValue: true,
            reason: true,
            actorId: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const ids = [...new Set([...events.map((e) => e.userId), ...events.map((e) => e.actorId)])];
  const users = ids.length
    ? await sdb.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const ten = new Map(users.map((u) => [u.id, u.name]));
  const hienTen = (id: string) => ten.get(id) ?? `${id.slice(0, 8)}…`;

  const link = (t: number) => {
    const u = new URLSearchParams();
    if (sp.co_so) u.set("co_so", sp.co_so);
    u.set("trang", String(t));
    return `/quan-ly-chia-lead/lich-su?${u.toString()}`;
  };

  return (
    <div className="max-w-6xl space-y-4 p-6">
      <Link
        href={`/quan-ly-chia-lead${sp.co_so ? `?co_so=${sp.co_so}` : ""}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Quay lại Quản lý chia lead
      </Link>

      <div>
        <h1 className="mb-1 text-2xl font-bold text-foreground">Lịch sử thay đổi pool</h1>
        <p className="text-sm text-muted-foreground">
          Ai bật/tắt ai, chỉnh lượt bao nhiêu, vì sao — theo thứ tự mới nhất trước.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Thời gian</th>
              <th className="px-4 py-3">Người bị tác động</th>
              <th className="px-4 py-3">Thao tác</th>
              <th className="px-4 py-3">Trước</th>
              <th className="px-4 py-3">Sau</th>
              <th className="px-4 py-3">Lý do</th>
              <th className="px-4 py-3">Người thực hiện</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Chưa có thay đổi nào.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">
                  {ngay(e.createdAt)}
                </td>
                <td className="px-4 py-3 text-foreground">{hienTen(e.userId)}</td>
                <td className="px-4 py-3 text-foreground">{NHAN[e.action] ?? e.action}</td>
                <td className="px-4 py-3 text-muted-foreground">{moTa(e.fromValue)}</td>
                <td className="px-4 py-3 text-muted-foreground">{moTa(e.toValue)}</td>
                <td className="px-4 py-3 max-w-[240px] text-muted-foreground" title={e.reason ?? ""}>
                  {e.reason ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{hienTen(e.actorId)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {tong === 0
            ? "Không có dòng nào"
            : `Dòng ${(trang - 1) * MOI_TRANG + 1}–${Math.min(trang * MOI_TRANG, tong)} / ${tong}`}
        </span>
        <div className="flex gap-2">
          {trang > 1 ? (
            // Phân trang chỉ đổi `?trang=` của chính trang này — giữ nguyên chỗ đang đọc.
            <Link href={link(trang - 1)} scroll={false} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">
              ← Trước
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-3 py-1.5 opacity-40">← Trước</span>
          )}
          {trang * MOI_TRANG < tong ? (
            <Link href={link(trang + 1)} scroll={false} className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted">
              Sau →
            </Link>
          ) : (
            <span className="rounded-lg border border-border px-3 py-1.5 opacity-40">Sau →</span>
          )}
        </div>
      </div>
    </div>
  );
}
