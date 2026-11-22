import { Check } from "lucide-react";
import { BUOC, type Buoc } from "./ban-nhap";
import { NHAN_BUOC } from "./tien-do";

/** Thanh tiến độ: progressbar có nhãn chữ (không chỉ màu) + danh sách bước hiện tại. */
export function ThanhTienDo({ buoc, phanTram, daXong, tong }: { buoc: Buoc; phanTram: number; daXong: number; tong: number }) {
  const viTri = BUOC.indexOf(buoc);
  return (
    <div data-testid="disc-tien-do">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <p className="font-semibold text-neutral-900">{NHAN_BUOC[buoc]}</p>
        <p className="text-neutral-600" data-testid="disc-tien-do-so">
          {daXong}/{tong} bước
        </p>
      </div>
      <div
        role="progressbar"
        aria-label="Tiến độ làm bài"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={phanTram}
        aria-valuetext={`${phanTram}% — ${NHAN_BUOC[buoc]}`}
        className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-neutral-200"
      >
        <div
          className="h-full rounded-full bg-orange-500 transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${phanTram}%` }}
        />
      </div>
      <ol className="mt-3 hidden gap-2 text-xs sm:flex sm:flex-wrap lg:flex-col lg:items-start" aria-label="Các chặng">
        {BUOC.map((b, i) => (
          <li
            key={b}
            aria-current={i === viTri ? "step" : undefined}
            className={
              "rounded-full px-3 py-1 font-semibold " +
              (i === viTri ? "bg-violet-100 text-violet-800" : i < viTri ? "bg-neutral-100 text-neutral-700" : "text-neutral-500")
            }
          >
            {i < viTri ? <Check className="mr-1 inline h-3 w-3" aria-hidden="true" /> : null}
            {NHAN_BUOC[b]}
          </li>
        ))}
      </ol>
    </div>
  );
}
