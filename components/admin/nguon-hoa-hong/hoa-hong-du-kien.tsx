// components/admin/nguon-hoa-hong/hoa-hong-du-kien.tsx — KHỐI "Hoa hồng dự kiến của bạn" trên chi tiết LEAD và chi tiết ĐƠN (06 §5.6).
//
// Chỉ phần CỦA CHÍNH MÌNH: view-model (`dungDuKienManHinh`) không có chỗ chứa tổng hay tên của vai khác. Mỗi dòng ĐÃ GHI có nút "Vì sao" mở ngăn giải thích — ngăn đọc qua
// cùng cổng phạm vi (`docViSaoDayDu`), nên người có `view-center` mở dòng của người khác vẫn không thấy gì ở đây (khối này không bao giờ liệt kê dòng của người khác).
//
// Chưa tính được ⇒ "Chưa thể tính" + lý do; KHÔNG BAO GIỜ "0đ". Đọc hỏng ⇒ nói "chưa tải được". Không có gì để nói ⇒ khối không hiện (hàm gọi trả `AN`).
// Server component (không state); chỉ ngăn "Vì sao" là client. Không thẻ lồng thẻ: một khối viền, bên trong là danh sách dòng.
import Link from "next/link";

import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import type { DuKienManHinh } from "@/lib/hoa-hong/du-kien-man-hinh";
import { TienDong } from "./vi-sao-noi-dung";
import { ViSaoSheet } from "./vi-sao-sheet";

const TOI_DA_DONG = 5;

export function HoaHongDuKien({ du }: { du: DuKienManHinh }) {
  if (du.loai === "AN") return null;
  if (du.loai === "LOI") {
    return (
      <section aria-labelledby="hh-du-kien" className="rounded-xl border border-border bg-card p-4">
        <h2 id="hh-du-kien" className="text-sm font-semibold">
          Hoa hồng dự kiến của bạn
        </h2>
        <p role="status" className="mt-1.5 text-sm text-muted-foreground">
          Chưa tải được hoa hồng dự kiến. Tải lại trang để thử lại.
        </p>
      </section>
    );
  }
  const hien = du.daGhi.dong.slice(0, TOI_DA_DONG);
  const conLai = du.daGhi.dong.length - hien.length;
  const coDaGhi = du.daGhi.dong.length > 0;
  return (
    <section aria-labelledby="hh-du-kien" className="rounded-xl border border-border bg-card p-4">
      <h2 id="hh-du-kien" className="text-sm font-semibold">
        Hoa hồng dự kiến của bạn
      </h2>

      {/* Điều khối này sinh ra để nói — "dự kiến thêm" — đứng ĐẦU và lớn nhất; phần đã ghi sổ là bối cảnh, hạ xuống một bậc khi có dự kiến. */}
      {du.duKien && (
        <div className="mt-3">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>Dự kiến thêm</span>
            <span className="text-xl font-semibold text-foreground">
              <TienDong soTien={du.duKien.tong} />
            </span>
          </p>
          {du.duKien.dong.length > 1 && (
            <ul className="mt-1 text-sm text-muted-foreground">
              {du.duKien.dong.map((d, i) => (
                <li key={`${d.vai}-${i}`}>
                  {d.vai}: <TienDong soTien={d.soTien} className="text-foreground" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {coDaGhi && (
        <div className={du.duKien ? "mt-4 border-t border-border pt-3" : "mt-3"}>
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
            <span>Đã ghi vào sổ</span>
            <span className={du.duKien ? "text-base font-semibold text-foreground" : "text-xl font-semibold text-foreground"}>
              <TienDong soTien={du.daGhi.tong} />
            </span>
          </p>
          <ul className="mt-2 divide-y divide-border/60 text-sm">
            {hien.map((d) => (
              // Ba phần: ngữ cảnh (khoản nào · kỳ nào) | số tiền căn phải (cột thẳng hàng chữ số) | "Vì sao". Dòng âm là HOÀN TIỀN, không phải "khoản −2.000.000đ đã thu".
              <li key={d.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <span className="min-w-0 text-muted-foreground">
                  {d.khoanThu < 0 ? "Hoàn " : "Khoản "}
                  <span className="tabular-nums">{dinhDangDong(Math.abs(d.khoanThu))}</span>
                  {d.khoanThu < 0 ? "" : " đã thu"} · kỳ <span className="tabular-nums">{d.ky}</span>
                </span>
                <span className="flex shrink-0 items-baseline justify-between gap-3 sm:justify-end">
                  <span className="text-left sm:min-w-[6.5rem] sm:text-right">
                    <TienDong soTien={d.soTien} className="font-medium" />
                  </span>
                  <ViSaoSheet
                    entryId={d.id}
                    moTa={`${d.vai} · kỳ ${d.ky}`}
                    triggerAriaLabel={`Vì sao ${dinhDangDong(d.soTien)} kỳ ${d.ky}`}
                    triggerClassName="text-sm font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Vì sao
                  </ViSaoSheet>
                </span>
              </li>
            ))}
          </ul>
          {conLai > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              và {conLai} dòng khác —{" "}
              <Link href="/nguon-hoa-hong/so?xem=tat-ca" className="font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                xem ở Sổ hoa hồng
              </Link>
            </p>
          )}
        </div>
      )}

      {du.chuaThe.length > 0 && (
        <div className={coDaGhi || du.duKien ? "mt-4 border-t border-border pt-3" : "mt-3"}>
          <p className="text-sm font-medium text-state-warning-ink">Chưa thể tính hoa hồng dự kiến</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {du.chuaThe.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}

      {du.giaDinh.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
          {du.giaDinh.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
