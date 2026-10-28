import { auth } from "@/lib/auth";
import { scopedDb } from "@/lib/db-scope";
import { resolveActor } from "@/lib/auth/actor";
import { StatusPill } from "@/components/admin/ui/status-pill";
// 25/09/2026 — ngày GHIM giờ VN: trang render ở server, Vercel chạy UTC — bản cũ
// `toLocaleDateString` không ghim múi in lùi một ngày cho mốc 00:00–07:00 giờ VN.
import { ngayVN } from "@/lib/format/date";

/**
 * Lịch sử bảo lưu của học viên.
 *
 * 25/09/2026 — chỉ ĐỔI VỎ (khối trong cột "Lớp & tiến độ" của hồ sơ):
 *   · KHÔNG vẽ gì khi chưa có lần bảo lưu nào — hồ sơ đã có dải "đang bảo lưu" khi cần,
 *     một thẻ "Chưa có lần bảo lưu nào" thường trực chỉ là nhiễu cho 95% học viên;
 *   · bỏ viền trái 4px (dải màu cạnh trái là mẫu trang trí, DESIGN.md) — trạng thái đã có
 *     nhãn chữ.
 * Truy vấn (scopedDb + take 50) giữ nguyên.
 */
export async function ReserveHistorySection({
  studentId,
}: {
  studentId: string;
}) {
  const session = await auth();
  if (!session?.user) return null;
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);

  const reserves = await sdb.studentReserve.findMany({
    where: { studentId },
    include: {
      enrollment: { select: { class: { select: { name: true } } } },
    },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  if (reserves.length === 0) return null;

  return (
    <section
      aria-labelledby="lich-su-bao-luu"
      className="rounded-xl border border-border bg-card shadow-sm"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="lich-su-bao-luu" className="text-sm font-semibold text-foreground">
          Lịch sử bảo lưu <span className="font-normal text-muted-foreground">({reserves.length})</span>
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {reserves.map((r) => (
          <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {r.isActive ? (
                <StatusPill tone="warning">Đang bảo lưu</StatusPill>
              ) : (
                <StatusPill tone="muted">Đã kết thúc</StatusPill>
              )}
              <span className="min-w-0 break-words text-foreground">
                {r.enrollment ? `Lớp ${r.enrollment.class.name}` : "Toàn bộ lớp đang học"}
              </span>
            </div>
            <p className="text-xs tabular-nums text-foreground">
              Từ <strong className="font-semibold">{ngayVN(r.startedAt)}</strong>
              {r.expectedEndAt && <> → dự kiến {ngayVN(r.expectedEndAt)}</>}
              {r.endedAt && <> → kết thúc thực tế {ngayVN(r.endedAt)}</>}
            </p>
            <p className="break-words text-xs text-foreground">Lý do: {r.reason}</p>
            {r.endReason && (
              <p className="break-words text-xs text-muted-foreground">
                Ghi chú kết thúc: {r.endReason}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Bởi {r.createdByName}
              {r.endedByName && ` · Kết thúc bởi ${r.endedByName}`}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
