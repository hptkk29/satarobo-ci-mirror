import { BUOC, type Buoc } from "@/components/disc/ban-nhap";
import { NHAN_BUOC } from "@/components/disc/tien-do";

/**
 * Thẻ tiến độ của trang làm bài DISC CÔNG KHAI — CHÉP từ artifact "Disc-LamBai" (`.card.dj-prog` > `.row` + `.dj-bar` + `ol.dj-steps`).
 * Cùng hợp đồng với `components/disc/thanh-tien-do.tsx` (vẫn dùng ở cổng phụ huynh): progressbar có nhãn chữ, `aria-current="step"` ở
 * chặng hiện tại, `data-testid` giữ nguyên.
 */
export function ThanhTienDoCongKhai({ buoc, phanTram, daXong, tong, daLuu = false }: { buoc: Buoc; phanTram: number; daXong: number; tong: number; daLuu?: boolean }) {
  const viTri = BUOC.indexOf(buoc);
  return (
    <div className="card dj-prog" data-testid="disc-tien-do">
      <div className="row">
        <b>{daLuu ? "Đã lưu kết quả" : NHAN_BUOC[buoc]}</b>
        <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }} data-testid="disc-tien-do-so">
          {daXong}/{tong} bước
        </span>
      </div>
      <div
        className="dj-bar"
        role="progressbar"
        aria-label="Tiến độ làm bài"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={phanTram}
        aria-valuetext={`${phanTram}% — ${NHAN_BUOC[buoc]}`}
      >
        <i style={{ width: `${phanTram}%` }}></i>
      </div>
      <ol className="dj-steps" aria-label="Các chặng">
        {BUOC.map((b, i) => (
          <li key={b} className={i < viTri ? "done" : i === viTri ? "cur" : ""} aria-current={i === viTri ? "step" : undefined}>
            <span className="n">{i < viTri ? "✓" : String(i + 1)}</span>
            {NHAN_BUOC[b]}
          </li>
        ))}
      </ol>
    </div>
  );
}
