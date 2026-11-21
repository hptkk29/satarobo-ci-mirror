/** Khung chờ đúng hình form ban hành: hai khối trường nhập + khối tệp. */
export default function BanHanhKhuyenMaiLoading() {
  return (
    <div className="mx-auto max-w-4xl animate-pulse space-y-5" aria-busy="true" aria-label="Đang tải form ban hành…">
      <div className="h-4 w-36 rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-7 w-72 max-w-full rounded-lg bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted" />
      </div>
      {["h-44", "h-56", "h-28"].map((h) => (
        <div key={h} className={`${h} rounded-xl border border-border bg-card`} />
      ))}
    </div>
  );
}
