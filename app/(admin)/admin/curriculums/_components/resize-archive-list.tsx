// Danh sách buổi SẼ BỊ LƯU TRỮ trong hộp xác nhận "giảm số buổi" — tách khỏi form (client) để kiểm bằng
// renderToStaticMarkup. Lưu trữ KHÔNG xoá gì; riêng tài liệu lắp ráp 3D phải nói rõ vì giáo viên mất nút
// cho tới khi buổi được khôi phục (owner chốt 23/10/2026: cảnh báo cụ thể, không tự xoá link).

export type ArchiveRow = {
  id: string;
  order: number;
  title: string;
  examCount: number;
  assignmentCount: number;
  documentCount: number;
  hasLinks: boolean;
  isInUse: boolean;
  assemblyManual: { setName: string | null; modelName: string | null } | null;
};

function tenLapRap(m: NonNullable<ArchiveRow["assemblyManual"]>): string {
  const ten = [m.setName, m.modelName].filter(Boolean).join(" · ");
  return ten || "chưa đặt tên";
}

export function ResizeArchiveList({ items }: { items: ArchiveRow[] }) {
  const coLapRap = items.filter((l) => l.assemblyManual);
  return (
    <>
      {coLapRap.length > 0 && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-state-warning-soft bg-state-warning-soft px-3 py-2 text-xs text-state-warning-ink"
        >
          <p className="font-semibold">
            {coLapRap.length} buổi bị lưu trữ đang có tài liệu lắp ráp 3D (bài{" "}
            {coLapRap.map((l) => l.order).join(", ")}).
          </p>
          <p className="mt-0.5">
            Link <strong>không bị xoá</strong> và còn nguyên khi khôi phục buổi, nhưng giáo viên sẽ{" "}
            <strong>không còn thấy nút “Lắp ráp 3D”</strong> của các buổi này cho tới khi khôi phục.
          </p>
        </div>
      )}
      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
        {items.map((l) => (
          <li key={l.id} className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
            <span className="font-semibold text-foreground">
              Bài {l.order}: {l.title}
            </span>
            {l.isInUse && (
              <span className="ml-2 rounded bg-state-danger-soft px-1.5 py-0.5 text-xs font-semibold text-state-danger-ink">
                Đang sử dụng — không thể loại
              </span>
            )}
            {l.hasLinks && (
              <span className="ml-2 text-xs text-state-warning-ink">
                ⚠ {l.examCount} đề thi · {l.assignmentCount} bài tập · {l.documentCount} tài liệu (giữ nguyên link)
              </span>
            )}
            {l.assemblyManual && (
              <span className="ml-2 text-xs text-state-warning-ink">
                ⚠ Lắp ráp 3D: {tenLapRap(l.assemblyManual)} (giữ nguyên link, giáo viên không thấy nút khi buổi bị lưu trữ)
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
