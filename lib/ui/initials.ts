/**
 * Chữ viết tắt cho avatar tròn ("Nguyễn Như Nhật Vy" → "NV").
 *
 * VÌ SAO CÓ FILE NÀY. Bản ngây thơ `name.split(" ").slice(-2).map(w => w[0])`
 * từng được chép ra 10 chỗ trong site giáo viên. Nó vỡ với tên có phần không
 * phải chữ cái: "Thầy Nam (Test)" → "N(" — hai từ cuối là "Nam" và "(Test)".
 * Lỗi đã được phát hiện và vá ở ĐÚNG MỘT chỗ (user-menu), chín chỗ còn lại giữ
 * nguyên bản hỏng. Gom về một hàm để lần sau vá là vá hết.
 *
 * Quy tắc: bỏ mọi phần không bắt đầu bằng chữ cái, rồi lấy chữ đầu của từ ĐẦU
 * và từ CUỐI — tiếng Việt đọc "họ + tên", nên "NV" nhận ra người tốt hơn "NV"
 * kiểu hai từ cuối ("Nhật Vy" → "NV" trùng nhau, nhưng "Nguyễn Văn A" thì
 * "NA" rõ hơn "VA").
 */
export function initialsOf(name: string, fallback = "?"): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p));
  if (parts.length === 0) return fallback;
  const first = parts[0]!;
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  return (first[0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
