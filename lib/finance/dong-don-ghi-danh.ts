// lib/finance/dong-don-ghi-danh.ts — BẤT BIẾN: tiền của MỘT DÒNG ĐƠN phải vào GHI DANH của ĐÚNG HỌC VIÊN dòng đó. THUẦN.
//
// VÌ SAO TỒN TẠI — đối soát T9–T10/2026, quét toàn PROD:
//   · Một đơn hai con: hai khoản mang `enrollmentId` CHÉO so với dòng đơn ⇒ cổng phụ huynh
//     tính công nợ HAI bé đảo nhau (lệch ~529.000đ mỗi bé).
//   · Một đơn khác: studentId của hai DÒNG ĐƠN chéo so với ghi danh.
//   · Một đơn thứ ba: hai dòng KHÔNG có studentId, mỗi giao dịch bị tách 1/2 sang CẢ
//     HAI ghi danh ⇒ lệch 42.000đ mỗi bé.
// Gốc: lúc tạo đơn nhiều con CÙNG KHOÁ, dòng đơn chưa có `studentId`; `chiaKhoanTheoDon` (convert-lead) ghép khoản vào ghi
// danh theo khoá học/thứ tự ⇒ hai dòng giống hệt nhau về khoá thì ghép chéo được mà không lỗi nào báo.
//
// Hàm này KHÔNG sửa gì: nó trả danh sách dòng lệch cho (a) cổng ghi — đứng TRƯỚC phép ghi đầu tiên của tách/gắn/chuyển —
// và (b) script/báo cáo quét. Cổng chỉ chặn khi CẢ HAI phía đều biết học viên mà khác nhau (NULL không bị chặn: NULL là
// "chưa biết", và chặn nó là khoá luôn đường gắn tiền của mọi đơn đời cũ).

export type DongDonGhiDanh = {
  orderItemId: string;
  /** `OrderItem.studentId` — học viên của DÒNG. */
  studentIdDong: string | null;
  /** `Enrollment.studentId` của ghi danh mà tiền sắp/đã vào. NULL = chưa có ghi danh. */
  studentIdGhiDanh: string | null;
};

export type DongLech = DongDonGhiDanh & { ma: "CHEO_HOC_VIEN" };

/** Dòng mà học viên của DÒNG ≠ học viên của GHI DANH (cả hai đều biết). */
export function dongLechGhiDanh(rows: readonly DongDonGhiDanh[]): DongLech[] {
  return rows
    .filter((r) => r.studentIdDong !== null && r.studentIdGhiDanh !== null && r.studentIdDong !== r.studentIdGhiDanh)
    .map((r) => ({ ...r, ma: "CHEO_HOC_VIEN" as const }));
}

/** Đơn nhiều dòng mà có dòng THIẾU học viên — tiền của dòng ấy không quy được về bé nào. */
export function dongThieuHocVienTrongDonNhieuDong(
  rows: readonly { orderId: string; orderItemId: string; studentId: string | null }[],
): { orderId: string; orderItemId: string }[] {
  const dem = new Map<string, number>();
  for (const r of rows) dem.set(r.orderId, (dem.get(r.orderId) ?? 0) + 1);
  return rows.filter((r) => r.studentId === null && (dem.get(r.orderId) ?? 0) > 1).map((r) => ({ orderId: r.orderId, orderItemId: r.orderItemId }));
}

export const CAU_CHEO_HOC_VIEN =
  "Dòng đơn và ghi danh thuộc HAI học viên khác nhau — ghi tiền vào đây là gán nhầm tiền giữa hai bé. " +
  "Sửa liên kết dòng đơn/ghi danh trước (xem docs/doi-soat-thu-tien/THIET-KE-SUA-GOC.md §6).";
