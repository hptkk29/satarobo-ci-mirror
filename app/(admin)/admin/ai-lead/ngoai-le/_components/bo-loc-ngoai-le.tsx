// Chọn loại ngoại lệ (liên kết thật, kèm số đếm) + bộ lọc Page/cơ sở/mã. Server Component thuần: lọc nằm trên URL, không cần JS, đổi lọc là về trang đầu.
// Số đếm là CHỮ trong nhãn ("Lỗi tạo lead · 3"), trạng thái chọn có `aria-current` + viền đậm — không chỉ bằng màu.
import Link from "next/link";
import { Search } from "lucide-react";
import type { LocNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";
import { NHAN_LOAI, THU_TU_LOAI, type LoaiNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le-thuan";
import { CO_LOC_NGOAI_LE, URL_THEO_LOAI, hrefTheoLoai } from "../_lib/doc-bo-loc";

const O = "h-11 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background px-2.5 text-base text-foreground sm:text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 sm:h-10";
const NHAN = "mb-1 block text-xs font-medium text-muted-foreground";
const THE =
  "flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
const THE_CHON = "border-primary bg-card text-foreground ring-1 ring-primary";
const THE_THUONG = "border-border bg-background text-muted-foreground hover:bg-muted/40";

export function BoLocNgoaiLe({
  loc,
  dem,
  pages,
  coSo,
}: {
  loc: LocNgoaiLe;
  dem: Record<LoaiNgoaiLe, number>;
  pages: string[];
  coSo: { id: string; ten: string }[];
}) {
  const tong = THU_TU_LOAI.reduce((n, l) => n + dem[l], 0);
  const dangChon = loc.loai && loc.loai !== "tat-ca" ? loc.loai : null;
  return (
    <div className="mb-4">
      <nav aria-label="Loại ngoại lệ" className="mb-3 grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <Link href={hrefTheoLoai(loc, null)} aria-current={dangChon === null ? "page" : undefined} className={`${THE} ${dangChon === null ? THE_CHON : THE_THUONG}`}>
          <span>Tất cả</span>
          <span className="tabular-nums">{tong}</span>
        </Link>
        {THU_TU_LOAI.map((l) => (
          <Link key={l} href={hrefTheoLoai(loc, l)} aria-current={dangChon === l ? "page" : undefined} className={`${THE} ${dangChon === l ? THE_CHON : THE_THUONG}`}>
            <span>{NHAN_LOAI[l]}</span>
            <span className="tabular-nums">{dem[l]}</span>
          </Link>
        ))}
      </nav>

      <form method="get" action="/ai-lead/ngoai-le" className="rounded-xl border border-border bg-card p-3 sm:p-4" aria-label="Bộ lọc ngoại lệ">
        {dangChon && <input type="hidden" name="loai" value={URL_THEO_LOAI[dangChon]} />}
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          <div className="min-w-0">
            <label htmlFor="nl-page" className={NHAN}>Page Facebook</label>
            <select id="nl-page" name="page" defaultValue={loc.pageId ?? ""} className={O}>
              <option value="">Mọi Page</option>
              {pages.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label htmlFor="nl-cs" className={NHAN}>Cơ sở</label>
            <select id="nl-cs" name="cs" defaultValue={loc.coSoId ?? ""} className={O}>
              <option value="">Mọi cơ sở bạn phụ trách</option>
              {coSo.map((c) => (
                <option key={c.id} value={c.id}>{c.ten}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0 min-[480px]:col-span-2 lg:col-span-1">
            <label htmlFor="nl-q" className={NHAN}>Tìm theo mã hồ sơ</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input id="nl-q" name="q" type="search" defaultValue={loc.q ?? ""} maxLength={40} autoComplete="off" className={`${O} pl-8`} />
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 sm:h-10">
            Áp dụng
          </button>
          {CO_LOC_NGOAI_LE(loc) && (
            <Link href="/ai-lead/ngoai-le" className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-10">
              Xoá lọc
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
