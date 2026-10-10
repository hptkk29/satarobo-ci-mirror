// components/admin/cham-cong/chu-giai-bang-cong.tsx — chú giải của Bảng công tháng.
//
// Server Component: không state, không handler. `<details>` là thẻ gốc của trình duyệt nên
// phần "xem đầy đủ" mở/đóng được mà không cần một byte JavaScript nào.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO DỰNG TỪ `MAU_O` CHỨ KHÔNG GÕ TAY
//
// Chú giải gõ tay sẽ trôi khỏi luật tô màu sau vài đợt sửa, và không ai phát hiện vì hai
// bên không bao giờ gặp nhau: ô đổi màu, chú giải vẫn nói câu cũ, trang vẫn render, test
// vẫn xanh. Ở đây cả hai đọc CHUNG `lib/cham-cong/mau-o-cong.ts`, và ca test
// "bảng nhãn là NGUỒN DUY NHẤT" ghim việc đó.
//
// Hai tầng, có chủ đích: dải ô màu luôn hiện (để LƯỚT), phần giải thích nằm trong `<details>`
// (để TRA khi cần). Bày cả 8 định nghĩa dài ngay trên đầu là đẩy lưới xuống dưới màn hình —
// mà lưới mới là thứ người ta vào đây để xem.
//
// Định nghĩa MÃ CA (giờ vào/ra) KHÔNG nằm ở đây — nó ở `components/cham-cong/ui/bang-gio-ca.tsx`
// và được cắm trên MỌI màn nhiều dữ liệu, không riêng màn này (chốt 25/09/2026). Giữ hai bảng
// song song là đến lượt sửa thứ hai chúng nói hai kiểu giờ khác nhau cho cùng một mã.
import { CalendarX2, Lock, MapPin, PenLine } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAU_HIEU_META,
  MAU_O,
  THU_TU_CHU_GIAI,
  type DauHieu,
} from "@/lib/cham-cong/mau-o-cong";

const ICON: Record<DauHieu, typeof Lock> = {
  KHOA: Lock,
  GHI_DE: PenLine,
  SAI_CHO: MapPin,
  NGOAI_LICH: CalendarX2,
};

export function ChuGiaiBangCong() {
  return (
    <section
      aria-label="Chú giải màu sắc"
      className="rounded-xl border border-border bg-card p-4"
    >
      {/* Dải quét nhanh — luôn hiện. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {THU_TU_CHU_GIAI.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={cn("h-3.5 w-3.5 shrink-0 rounded", MAU_O[k].lopChuGiai)}
            />
            <span className="whitespace-nowrap text-xs text-foreground">{MAU_O[k].nhan}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="relative h-3.5 w-3.5 shrink-0 rounded bg-muted">
            <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-state-info-ink" />
          </span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Chấm góc = có ghi chú
          </span>
        </li>
      </ul>

      {/* Tra đầy đủ — đóng mặc định. */}
      <details className="group mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer list-none text-xs font-semibold text-primary-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          Xem giải thích đầy đủ từng màu
        </summary>

        <div className="mt-3">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Màu nền ô
            </h3>
            <dl className="space-y-2">
              {THU_TU_CHU_GIAI.map((k) => (
                <div key={k} className="flex gap-2">
                  <span
                    aria-hidden
                    className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 rounded", MAU_O[k].lopChuGiai)}
                  />
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold text-foreground">{MAU_O[k].nhan}</dt>
                    <dd className="text-xs text-muted-foreground">{MAU_O[k].moTa}</dd>
                  </div>
                </div>
              ))}
            </dl>

            <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Chấm ở góc ô
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Chấm góc <b className="text-foreground">không đổi màu nền</b> — để &quot;đỏ&quot; giữ
              đúng nghĩa vi phạm giờ giấc. Rê chuột vào ô để xem ghi chú của ngày đó.
            </p>
            <dl className="space-y-2">
              {(Object.keys(DAU_HIEU_META) as DauHieu[]).map((k) => {
                const Icon = ICON[k];
                return (
                  <div key={k} className="flex gap-2">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold text-foreground">
                        {DAU_HIEU_META[k].nhan}
                      </dt>
                      <dd className="text-xs text-muted-foreground">{DAU_HIEU_META[k].moTa}</dd>
                    </div>
                  </div>
                );
              })}
            </dl>
          </div>

        </div>
      </details>
    </section>
  );
}
