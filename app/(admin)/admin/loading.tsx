/**
 * Skeleton MẶC ĐỊNH cho toàn bộ admin (07/08/2026).
 *
 * VÌ SAO: 162/205 trang admin là `force-dynamic` — mỗi lần bấm là một lượt render server
 * trọn vẹn. App Router KHÔNG điều hướng cho tới khi server trả xong, nên không có
 * `loading.tsx` thì bấm xong màn hình đứng im nguyên vẹn ~0,3–1s: người dùng tưởng máy
 * treo hoặc bấm hụt, bấm lại lần nữa. Trước file này chỉ 2/205 trang có khung chờ
 * (dashboard, bao-cao) — 203 trang còn lại rơi vào cảnh trên.
 *
 * Đặt ở gốc segment `admin` nên áp cho MỌI trang con chưa tự khai; trang nào có
 * `loading.tsx` riêng (khớp bố cục sát hơn) vẫn thắng vì Next lấy boundary gần nhất.
 *
 * Nằm TRONG layout admin → sidebar + topbar giữ nguyên, chỉ vùng nội dung đổi thành
 * khung chờ, nên điều hướng "ăn" ngay lập tức.
 */
export default function AdminLoading() {
  return (
    <div
      className="animate-pulse space-y-6"
      aria-busy="true"
      aria-label="Đang tải…"
    >
      {/* Tiêu đề trang + mô tả */}
      <div className="space-y-2">
        <div className="h-7 w-64 rounded-lg bg-muted" />
        <div className="h-4 w-44 rounded bg-muted" />
      </div>

      {/* Thanh công cụ: ô tìm kiếm + bộ lọc + nút thao tác */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 w-72 rounded-lg bg-muted" />
        <div className="h-9 w-36 rounded-lg bg-muted" />
        <div className="h-9 w-36 rounded-lg bg-muted" />
        <div className="ml-auto h-9 w-32 rounded-lg bg-muted" />
      </div>

      {/* Khối nội dung chính — đa số trang admin là bảng dữ liệu */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="h-11 border-b border-border bg-muted" />
        <div className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-1/4 rounded bg-muted" />
              <div className="h-4 w-1/6 rounded bg-muted" />
              <div className="h-4 w-1/5 rounded bg-muted" />
              <div className="ml-auto h-4 w-16 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
