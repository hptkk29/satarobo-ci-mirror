// Bộ lọc danh sách hồ sơ chờ — một <form method="get">: lọc nằm trên URL (bấm vào hồ sơ rồi quay lại vẫn giữ), không cần JS, đổi lọc là về trang đầu.
// Server Component thuần. Mỗi ô: nhãn RÕ phía trên (không dùng placeholder làm nhãn), cao 44px trên điện thoại (vùng chạm), 40px từ `sm`.
import Link from "next/link";
import { Search } from "lucide-react";
import type { LocDanhSach } from "@/lib/ai-lead/dich-vu/duyet";
import { NHAN_TRANG_THAI } from "./hien-thi";
import { CO_LOC } from "./doc-bo-loc";

const O = "h-11 w-full min-w-0 overflow-hidden rounded-lg border border-border bg-background px-2.5 text-base text-foreground sm:text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 sm:h-10";
const NHAN = "mb-1 block text-xs font-medium text-muted-foreground";

export function BoLoc({
  loc,
  pages,
  coSo,
  coTheTimTheoTen,
}: {
  loc: LocDanhSach;
  pages: string[];
  coSo: { id: string; ten: string }[];
  /** Có quyền xem PII lead thì ô tìm mới nhận tên/SĐT; thiếu quyền chỉ tìm theo mã hồ sơ (tìm được là dò được). */
  coTheTimTheoTen: boolean;
}) {
  return (
    <form method="get" action="/ai-lead" className="mb-4 rounded-xl border border-border bg-card p-3 sm:p-4" aria-label="Bộ lọc hồ sơ chờ AI">
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <div className="min-w-0 min-[480px]:col-span-2 lg:col-span-1">
          <label htmlFor="bl-q" className={NHAN}>
            {coTheTimTheoTen ? "Tìm theo tên, SĐT (đủ số) hoặc mã hồ sơ" : "Tìm theo mã hồ sơ"}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input id="bl-q" name="q" type="search" defaultValue={loc.q ?? ""} maxLength={80} autoComplete="off" className={`${O} pl-8`} />
          </div>
        </div>
        <div className="min-w-0">
          <label htmlFor="bl-tt" className={NHAN}>Trạng thái</label>
          <select id="bl-tt" name="tt" defaultValue={loc.trangThai ?? ""} className={O}>
            <option value="">Đang mở (mặc định)</option>
            <option value="tat-ca">Tất cả, kể cả đã đóng</option>
            {Object.entries(NHAN_TRANG_THAI).map(([k, v]) => (
              <option key={k} value={k}>{v.nhan}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="bl-page" className={NHAN}>Page Facebook</label>
          <select id="bl-page" name="page" defaultValue={loc.pageId ?? ""} className={O}>
            <option value="">Mọi Page</option>
            {pages.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="bl-cs" className={NHAN}>Cơ sở</label>
          <select id="bl-cs" name="cs" defaultValue={loc.coSoId ?? ""} className={O}>
            <option value="">Mọi cơ sở bạn phụ trách</option>
            {coSo.map((c) => (
              <option key={c.id} value={c.id}>{c.ten}</option>
            ))}
          </select>
        </div>
        <div className="min-w-0">
          <label htmlFor="bl-nx" className={NHAN}>Người xử lý</label>
          <select id="bl-nx" name="nx" defaultValue={loc.nguoiXuLy ?? ""} className={O}>
            <option value="">Mọi người</option>
            <option value="toi">Của tôi</option>
            <option value="chua-nhan">Chưa ai nhận</option>
          </select>
        </div>
        <div className="flex min-w-0 items-end">
          <label htmlFor="bl-han" className="flex h-11 w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground sm:h-10">
            <input id="bl-han" name="han" type="checkbox" value="1" defaultChecked={loc.quaHanSla === true} className="h-4 w-4 accent-[color:var(--primary)]" />
            <span className="truncate">Chỉ hồ sơ quá hạn SLA</span>
          </label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 sm:h-10">
          Áp dụng
        </button>
        {CO_LOC(loc) && (
          <Link href="/ai-lead" className="inline-flex h-11 items-center rounded-lg px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-10">
            Xoá lọc
          </Link>
        )}
        {/* Lối vào màn «Ngoại lệ» (hồ sơ lỗi tạo lead · lead chưa có sale · quá hạn SLA) — màn con của danh sách này. */}
        <Link href="/ai-lead/ngoai-le" className="inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:ml-auto sm:h-10">
          Xem ngoại lệ cần xử lý
        </Link>
      </div>
    </form>
  );
}
