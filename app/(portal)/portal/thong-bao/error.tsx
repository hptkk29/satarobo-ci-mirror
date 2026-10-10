"use client";

// Error boundary route Thông báo — 1 query hỏng trong fan-out feed không được
// đá phụ huynh ra error screen mặc định của Next (boundary nằm TRONG layout →
// giữ nguyên shell/nav portal).
export default function ThongBaoError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl rounded-2xl border border-border bg-card p-8 text-center">
      <p className="text-sm font-semibold text-foreground">
        Không tải được thông báo.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Đã có lỗi khi tải dữ liệu. Vui lòng thử lại, nếu vẫn lỗi hãy liên hệ
        trung tâm.
      </p>
      <button
        onClick={() => reset()}
        className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-primary/90"
      >
        Thử lại
      </button>
    </div>
  );
}
