/**
 * Khối "tab này chưa có số liệu" — dùng cho cả 4 tab của dashboard QLCS trong lúc khung
 * đã dựng mà nội dung chưa nối.
 *
 * 🔴 RÀNG BUỘC CỦA CHÍNH FILE NÀY: **không thẻ số nào**, kể cả số 0.
 * Một hàng "Doanh thu: 0 ₫ · Chi phí: 0 ₫" trông y hệt kết quả đo thật ⇒ người xem kết
 * luận "tháng này không thu được đồng nào" và đi hỏi kế toán. Chưa đo được thì phải nói
 * bằng CHỮ là đang chờ gì, và chờ ai làm gì thì hết chờ.
 */
export function ChoDuLieu({
  tieuDe,
  giaiThich,
  maSpec,
  daCo = [],
  chuaCo,
}: {
  /** Một câu nói rõ đang chờ gì — vd "Chi phí Marketing: chờ nối tài khoản quảng cáo". */
  tieuDe: string;
  giaiThich: string;
  /** Mã spec của phần nội dung sẽ lấp vào đây (vd "B-02 → B-05"). */
  maSpec: string;
  /** Thứ đã có trong repo nhưng CHƯA nối vào màn — để lần sau không dựng lại từ đầu. */
  daCo?: string[];
  /** Thứ chưa tồn tại. Đây mới là phần quyết định bao giờ tab có số. */
  chuaCo: string[];
}) {
  return (
    <section className="rounded-xl border border-dashed border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-semibold text-foreground">{tieuDe}</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {maSpec}
        </span>
      </div>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {giaiThich}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {daCo.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Đã có, chưa nối vào màn
            </p>
            <ul className="mt-1.5 space-y-1 text-sm text-foreground">
              {daCo.map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground">
                    ·
                  </span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Còn thiếu
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-foreground">
            {chuaCo.map((x) => (
              <li key={x} className="flex gap-2">
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
