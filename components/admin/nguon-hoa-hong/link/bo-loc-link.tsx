// components/admin/nguon-hoa-hong/link/bo-loc-link.tsx — bộ lọc danh sách link: chip trạng thái (có số) + chọn campaign + chọn đối tác. TOÀN BỘ nằm trên URL
// (`?trangthai=&campaign=&doitac=`), không JS: chip là `<Link>`, hai ô chọn là một `<form method="get">`. Đổi bộ lọc luôn về trang 1 (không giữ `trang`). SERVER COMPONENT.
import Link from "next/link";
import { BTN_OUTLINE, CHIP, CHIP_ACTIVE, CHIP_IDLE, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import type { TuyChonLoc } from "@/lib/affiliate/doc-link";
import { NHAN_TRANG_THAI_LINK, TRANG_THAI_LINK, type TrangThaiLink } from "@/lib/affiliate/ghi-link-dau-vao";
import { hrefVoi } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export function BoLocLink({
  basePath,
  trangThai,
  campaignMa,
  doiTacMa,
  theoTrangThai,
  tuyChon,
}: {
  basePath: string;
  trangThai: TrangThaiLink | null;
  campaignMa: string | null;
  doiTacMa: string | null;
  theoTrangThai: Record<TrangThaiLink, number>;
  tuyChon: TuyChonLoc;
}) {
  const tong = TRANG_THAI_LINK.reduce((s, t) => s + theoTrangThai[t], 0);
  const coLoc = trangThai !== null || campaignMa !== null || doiTacMa !== null;
  return (
    <div className="mb-4 space-y-3">
      <nav aria-label="Lọc theo trạng thái link" className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
        <Link href={hrefVoi(basePath, { campaign: campaignMa, doitac: doiTacMa })} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
          Mọi trạng thái <span className="tabular-nums text-muted-foreground">({tong})</span>
        </Link>
        {TRANG_THAI_LINK.filter((t) => theoTrangThai[t] > 0 || t === trangThai).map((t) => (
          <Link
            key={t}
            href={hrefVoi(basePath, { trangthai: t, campaign: campaignMa, doitac: doiTacMa })}
            aria-current={trangThai === t ? "page" : undefined}
            className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}
          >
            {NHAN_TRANG_THAI_LINK[t]} <span className="tabular-nums text-muted-foreground">({theoTrangThai[t]})</span>
          </Link>
        ))}
      </nav>

      <form method="get" action={basePath} role="search" aria-label="Lọc link" className="flex flex-wrap items-end gap-3">
        {trangThai !== null && <input type="hidden" name="trangthai" value={trangThai} />}
        <div className="min-w-0 flex-[1_1_14rem]">
          <label htmlFor="link-campaign" className={NHAN_O}>
            Campaign
          </label>
          <select id="link-campaign" name="campaign" defaultValue={campaignMa ?? ""} className={O_NHAP}>
            <option value="">Mọi campaign</option>
            {tuyChon.campaign.map((c) => (
              <option key={c.ma} value={c.ma}>
                {c.ten} ({c.ma})
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-[1_1_14rem]">
          <label htmlFor="link-doitac" className={NHAN_O}>
            Đối tác
          </label>
          <select id="link-doitac" name="doitac" defaultValue={doiTacMa ?? ""} className={O_NHAP}>
            <option value="">Mọi đối tác</option>
            {tuyChon.doiTac.map((d) => (
              <option key={d.ma} value={d.ma}>
                {d.ten} ({d.ma})
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={BTN_OUTLINE}>
          Lọc
        </button>
        {coLoc && (
          <Link href={basePath} className="rounded text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            Bỏ lọc
          </Link>
        )}
      </form>
    </div>
  );
}
