// app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bo-loc-doi-tac.tsx — bộ lọc danh sách đối tác: chip trạng thái (có số) + ô tìm + chọn loại. TOÀN BỘ nằm trên URL
// (`?trangthai=&loai=&q=`), không JS: chip là `<Link>`, ô tìm + loại là một `<form method="get">`. Đổi bộ lọc luôn về trang 1 (không giữ `trang`).
//
// Ô tìm nói đúng nó tìm gì: `coTheXemLienHe` quyết định có tìm theo SĐT/email không — người chỉ xem không tìm được theo số (tìm theo số là cách dò «số này có phải đối tác không»).
import Link from "next/link";
import { BTN_OUTLINE, CHIP, CHIP_ACTIVE, CHIP_IDLE, NHAN_O, O_NHAP } from "@/components/admin/nguon-hoa-hong/classes";
import { NHAN_TRANG_THAI_DOI_TAC, TRANG_THAI_DOI_TAC, type TrangThaiDoiTac } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { hrefVoi } from "@/lib/nguon-hoa-hong/url";
import { cn } from "@/lib/utils";

export function BoLocDoiTac({
  basePath,
  trangThai,
  loaiMa,
  tuKhoa,
  theoTrangThai,
  cacLoai,
  coTheXemLienHe,
}: {
  basePath: string;
  trangThai: TrangThaiDoiTac | null;
  loaiMa: string | null;
  tuKhoa: string | null;
  theoTrangThai: Record<TrangThaiDoiTac, number>;
  cacLoai: { ma: string; ten: string }[];
  coTheXemLienHe: boolean;
}) {
  const tong = TRANG_THAI_DOI_TAC.reduce((s, t) => s + theoTrangThai[t], 0);
  const coLoc = trangThai !== null || loaiMa !== null || tuKhoa !== null;
  return (
    <div className="mb-4 space-y-3">
      <nav aria-label="Lọc theo trạng thái đối tác" className="flex w-full items-center gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>a]:shrink-0 [&>a]:whitespace-nowrap">
        <Link href={hrefVoi(basePath, { loai: loaiMa, q: tuKhoa })} aria-current={trangThai === null ? "page" : undefined} className={cn(CHIP, trangThai === null ? CHIP_ACTIVE : CHIP_IDLE)}>
          Mọi trạng thái <span className="tabular-nums text-muted-foreground">({tong})</span>
        </Link>
        {TRANG_THAI_DOI_TAC.filter((t) => theoTrangThai[t] > 0 || t === trangThai).map((t) => (
          <Link
            key={t}
            href={hrefVoi(basePath, { trangthai: t, loai: loaiMa, q: tuKhoa })}
            aria-current={trangThai === t ? "page" : undefined}
            className={cn(CHIP, trangThai === t ? CHIP_ACTIVE : CHIP_IDLE)}
          >
            {NHAN_TRANG_THAI_DOI_TAC[t]} <span className="tabular-nums text-muted-foreground">({theoTrangThai[t]})</span>
          </Link>
        ))}
      </nav>

      <form method="get" action={basePath} role="search" aria-label="Tìm đối tác" className="flex flex-wrap items-end gap-3">
        {trangThai !== null && <input type="hidden" name="trangthai" value={trangThai} />}
        <div className="min-w-0 flex-[1_1_16rem]">
          <label htmlFor="aff-q" className={NHAN_O}>
            Tìm đối tác
          </label>
          <input
            id="aff-q"
            name="q"
            type="search"
            defaultValue={tuKhoa ?? ""}
            maxLength={60}
            placeholder={coTheXemLienHe ? "Tên, mã giới thiệu, SĐT hoặc email" : "Tên hoặc mã giới thiệu"}
            className={O_NHAP}
          />
        </div>
        <div className="min-w-0 flex-[0_1_14rem]">
          <label htmlFor="aff-loai" className={NHAN_O}>
            Loại
          </label>
          <select id="aff-loai" name="loai" defaultValue={loaiMa ?? ""} className={O_NHAP}>
            <option value="">Mọi loại</option>
            {cacLoai.map((l) => (
              <option key={l.ma} value={l.ma}>
                {l.ten}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={BTN_OUTLINE}>
          Lọc
        </button>
        {coLoc && (
          <Link href={basePath} className="inline-flex h-11 items-center rounded-lg px-1 text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring md:h-9">
            Bỏ mọi bộ lọc
          </Link>
        )}
      </form>
    </div>
  );
}
