// lib/pdf/sap-xep-buoi.ts — thứ tự các trang của PDF nhận xét gộp nhiều buổi. THUẦN, tách khỏi trình dựng PDF để test không kéo react-pdf.

/** Theo LỚP rồi BUỔI tăng dần; buổi không tra được số thì xuống cuối lớp, các buổi đó xếp theo ngày. */
export function sapXepTheoBuoi<T extends { lop: string; soBuoi: number | null; ngay: number }>(xs: T[]): T[] {
  return [...xs].sort(
    (a, b) =>
      a.lop.localeCompare(b.lop, "vi") ||
      (a.soBuoi ?? Number.MAX_SAFE_INTEGER) - (b.soBuoi ?? Number.MAX_SAFE_INTEGER) ||
      a.ngay - b.ngay,
  );
}
