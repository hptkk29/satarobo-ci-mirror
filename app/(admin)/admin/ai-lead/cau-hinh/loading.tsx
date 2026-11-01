// Khung chờ của Cấu hình AI Lead — thanh mục + vài thẻ, đúng hình dạng nội dung thật.
export default function CauHinhAiLeadLoading() {
  return (
    <div className="mx-auto w-full max-w-[96rem] animate-pulse" role="status" aria-busy="true" aria-label="Đang tải cấu hình…">
      <div className="mb-5 space-y-2">
        <div className="h-7 w-56 max-w-full rounded-lg bg-border" />
        <div className="h-4 w-96 max-w-full rounded bg-border" />
      </div>
      <div className="mb-5 flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 w-32 shrink-0 rounded-lg bg-border" />
        ))}
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <div className="h-5 w-40 max-w-full rounded bg-border" />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-12 rounded-lg bg-border/70" />
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-11 w-28 rounded-lg bg-border" />
              <div className="h-11 w-28 rounded-lg bg-border" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
