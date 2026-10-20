// Tab 2 — SỔ CHIA LEAD. Server Component: lọc + phân trang đều ở server.
//
// Bảng này chỉ có THÊM, không bao giờ bớt — nó là bằng chứng. Không có nút sửa,
// không có nút xoá: sổ sửa được thì nó thôi là bằng chứng.
//
// Mặc định 30 ngày gần nhất. Không mặc định "tất cả": bảng này lớn nhanh, và người
// mở nó gần như luôn đang tra một việc vừa xảy ra.
import Link from "next/link";
import { Download } from "lucide-react";
import { laySoChia } from "@/lib/lead/pool-board";

const MOI_TRANG = 25;

const NHAN_NGUON: Record<string, string> = {
  AUTO: "Máy chia",
  SELF: "Sale tự nhập",
  MANAGER: "Quản lý giao",
  IMPORT: "Nhập Excel",
  AFFILIATE: "Mã giới thiệu",
  DUPLICATE: "Nhập lại (trùng)",
};

function ngay(d: Date): string {
  return new Date(d).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

/** `poolSnapshot` → chuỗi cho tooltip: ai đang bật, lượt bao nhiêu LÚC ĐÓ. */
function moTaAnhChup(snap: unknown): string {
  if (!Array.isArray(snap) || snap.length === 0) return "";
  return snap
    .map((m) => {
      const x = m as { userId?: string; turns?: number };
      return `${String(x.userId ?? "?").slice(0, 8)}…: ${x.turns ?? "?"}`;
    })
    .join(" · ");
}

export async function SoChiaLead({
  orgUnitIds,
  nguoiTrongPool,
  centerId,
  sp,
}: {
  orgUnitIds: string[];
  nguoiTrongPool: { id: string; name: string | null }[];
  centerId: string;
  sp: {
    tu?: string;
    den?: string;
    sale?: string;
    nguon?: string;
    tieu_luot?: string;
    trang?: string;
  };
}) {
  const den = sp.den ? new Date(`${sp.den}T23:59:59`) : new Date();
  const tu = sp.tu
    ? new Date(`${sp.tu}T00:00:00`)
    : new Date(den.getTime() - 30 * 24 * 3600 * 1000);
  const trang = Math.max(1, Number(sp.trang ?? "1") || 1);

  const { rows, tong } = await laySoChia({
    orgUnitIds,
    tuNgay: tu,
    denNgay: den,
    saleId: sp.sale || null,
    source: sp.nguon || null,
    tieuLuot: sp.tieu_luot === "co" || sp.tieu_luot === "khong" ? sp.tieu_luot : null,
    trang,
    moiTrang: MOI_TRANG,
  });

  const oCls =
    "rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <form
        method="get"
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4"
      >
        <input type="hidden" name="co_so" value={centerId} />
        <input type="hidden" name="tab" value="so-chia" />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Từ ngày</span>
          <input type="date" name="tu" defaultValue={sp.tu ?? iso(tu)} className={oCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Đến ngày</span>
          <input type="date" name="den" defaultValue={sp.den ?? iso(den)} className={oCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Sale</span>
          <select name="sale" defaultValue={sp.sale ?? ""} className={oCls}>
            <option value="">Tất cả</option>
            {nguoiTrongPool.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name ?? p.id}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Nguồn</span>
          <select name="nguon" defaultValue={sp.nguon ?? ""} className={oCls}>
            <option value="">Tất cả</option>
            {Object.entries(NHAN_NGUON).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Tiêu lượt</span>
          <select name="tieu_luot" defaultValue={sp.tieu_luot ?? ""} className={oCls}>
            <option value="">Tất cả</option>
            <option value="co">Có</option>
            <option value="khong">Không</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Lọc
        </button>
        {/* Xuất theo ĐÚNG bộ lọc đang xem — route tự dựng lại tập cơ sở từ tầm nhìn
            của actor, không tin `orgUnitId` gửi lên. */}
        <a
          href={`/api/admin/crm/so-chia-lead-export?${new URLSearchParams({
            co_so: centerId,
            ...(sp.tu ? { tu: sp.tu } : {}),
            ...(sp.den ? { den: sp.den } : {}),
            ...(sp.sale ? { sale: sp.sale } : {}),
            ...(sp.nguon ? { nguon: sp.nguon } : {}),
            ...(sp.tieu_luot ? { tieu_luot: sp.tieu_luot } : {}),
          }).toString()}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
        >
          <Download className="h-4 w-4" /> Xuất Excel
        </a>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Thời gian</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3">SĐT</th>
              <th className="px-4 py-3">Cơ sở</th>
              <th className="px-4 py-3">Người nhập</th>
              <th className="px-4 py-3">Chia cho</th>
              <th className="px-4 py-3">Nguồn</th>
              <th className="px-4 py-3">Tiêu lượt</th>
              <th className="px-4 py-3 text-right">Lượt sau khi chia</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                  Không có lượt chia nào trong khoảng đã chọn.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-0"
                // Chỉ dòng máy chia mới có ảnh chụp pool — dòng khác không có gì để soi.
                title={r.source === "AUTO" ? moTaAnhChup(r.poolSnapshot) : undefined}
              >
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground tabular-nums">
                  {ngay(r.createdAt)}
                </td>
                <td className="px-4 py-3">
                  {r.leadId ? (
                    <Link href={`/leads/${r.leadId}`} className="text-primary hover:underline">
                      {r.parentName ?? r.leadId.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.phone ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.centerName ?? "—"}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.nguoiNhap ?? "—"}</td>
                <td className="px-4 py-3 text-foreground">
                  {r.chiaCho ?? <span className="font-medium text-state-warning-ink">Chưa phân công</span>}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {NHAN_NGUON[r.source] ?? r.source}
                </td>
                <td className="px-4 py-3">
                  {r.consumedTurn ? (
                    <span className="rounded-full bg-state-success-soft px-2 py-0.5 text-xs font-semibold text-state-success-ink">
                      Có
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Không</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {r.turnCountAfter ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phân trang PHÍA SERVER — `PhanTrangBang` của repo cắt trang trong trình
          duyệt, tức phải tải hết sổ về trước. Sổ này chỉ có thêm, không bao giờ bớt. */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {tong === 0
            ? "Không có dòng nào"
            : `Dòng ${(trang - 1) * MOI_TRANG + 1}–${Math.min(trang * MOI_TRANG, tong)} / ${tong}`}
        </span>
        <div className="flex gap-2">
          <Trang nhan="← Trước" toi={trang - 1} tat={trang <= 1} sp={sp} centerId={centerId} />
          <Trang
            nhan="Sau →"
            toi={trang + 1}
            tat={trang * MOI_TRANG >= tong}
            sp={sp}
            centerId={centerId}
          />
        </div>
      </div>
    </div>
  );
}

function Trang({
  nhan,
  toi,
  tat,
  sp,
  centerId,
}: {
  nhan: string;
  toi: number;
  tat: boolean;
  sp: Record<string, string | undefined>;
  centerId: string;
}) {
  if (tat) {
    return <span className="rounded-lg border border-border px-3 py-1.5 opacity-40">{nhan}</span>;
  }
  const u = new URLSearchParams({ co_so: centerId, tab: "so-chia" });
  for (const k of ["tu", "den", "sale", "nguon", "tieu_luot"]) {
    if (sp[k]) u.set(k, sp[k] as string);
  }
  u.set("trang", String(toi));
  return (
    <Link
      href={`/quan-ly-chia-lead?${u.toString()}`}
      // Sang trang khác của CÙNG sổ — chỉ đổi `?trang=`. Không tắt thì App Router
      // cuốn về đầu, mất chỗ đang đọc.
      scroll={false}
      className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted"
    >
      {nhan}
    </Link>
  );
}
