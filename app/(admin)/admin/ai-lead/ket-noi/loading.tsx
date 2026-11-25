// Khung chờ của Trung tâm kết nối AI — đúng hình dạng nội dung thật (thanh mục + thẻ Agent), không phải spinner giữa màn.
export default function KetNoiAiLeadLoading() {
  return (
    <div className="mx-auto w-full max-w-[96rem] animate-pulse" role="status" aria-busy="true" aria-label="Đang tải trung tâm kết nối…">
      <div className="mb-5 space-y-2">
        <div className="h-7 w-64 max-w-full rounded-lg bg-border" />
        <div className="h-4 w-80 max-w-full rounded bg-border" />
      </div>
      <div className="mb-5 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 w-28 shrink-0 rounded-lg bg-border" />
        ))}
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="h-5 w-48 max-w-full rounded bg-border" />
            <div className="mt-2 h-4 w-72 max-w-full rounded bg-border" />
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <div key={j} className="h-20 rounded-lg bg-border/70" />
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-14 rounded-lg bg-border/70" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
