// lib/scorm/chung-tien-trinh.ts — trạng thái CẤP TIẾN TRÌNH dùng chung giữa các điểm vào của Next.
//
// Vì sao có (đo 24/10/2026, bản production `next start`): trang play (`after(() => lamNongGoi(...))`) và route asset là HAI điểm vào được đóng gói
// riêng, nên mỗi bên có thể nạp MỘT BẢN `dem-dia.ts` riêng. Bản đồ "đang tải" ở cấp module vì vậy bị nhân đôi: single-flight không gộp được lượt làm nóng
// với lượt của người dùng ⇒ 259/345 khoá bị gọi R2 hai lần (606 GET thay vì ~345), trần 12 tải đồng thời thành 24, tập gói đang làm nóng bị đếm đôi.
// Test chạy trong MỘT tiến trình/MỘT bản module nên không bao giờ thấy lỗi này — chỉ đo trên bản build mới thấy.
//
// Cách làm giống singleton Prisma của repo: đặt trên `globalThis` dưới khoá `Symbol.for(...)` (cùng khoá ⇒ cùng đối tượng dù module nạp bao nhiêu lần).
// CHỈ dùng cho trạng thái thuần trong bộ nhớ (Map/Set/mảng/ô số); không giữ bí mật hay dữ liệu theo người dùng ngoài khoá đã băm.
const TIEN_TO = "satarobo.scorm.";

export function chungTienTrinh<T>(ten: string, khoiTao: () => T): T {
  const kho = globalThis as unknown as Record<symbol, unknown>;
  const khoa = Symbol.for(TIEN_TO + ten);
  if (!(khoa in kho)) kho[khoa] = khoiTao();
  return kho[khoa] as T;
}
