// lib/bao-luu/dong-don-cua-ghi-danh.ts — "DÒNG ĐƠN NÀO LÀ CỦA GHI DANH NÀY" cho ảnh chụp quyền lợi (BR-14, chốt 13). THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO CÓ (nghiệm thu bảo lưu vòng 2, ô C13 — 11/10/2026)
//
// Spec chốt 13: tử số của ảnh chụp lấy từ `OrderItem` (`totalPrice − discountAmount`). Mã giao ra lại lấy `Enrollment.finalPrice ?? tuition` và KHÔNG ghi
// vào `CAN-QUYET` rằng nó lệch chốt. Đo PROD chỉ-đọc 11/10/2026 (`docs/bao-luu/do-prod-11-10.md`): trong 104 ghi danh còn mở, 10 ghi danh có cả hai phía để
// so thì **6 lệch** (từ −4,32 triệu đến +2,64 triệu), và **94/104 không tìm thấy dòng đơn nào** — chủ dự án chốt: lệch > 0 ⇒ làm đúng chốt 13.
//
// Hai đường nối dòng đơn ↔ ghi danh (đo trên prod: 2 ghi danh qua (A), 8 qua (B)):
//   (A) `OrderItem.enrollmentId` — nối trực tiếp, có sau khi convert;
//   (B) dòng `COURSE_ENROLLMENT` của đơn CÙNG HỌC VIÊN có `metadata.courseId` = khoá của ghi danh (và `metadata.leadChildId` = `Enrollment.leadChildId` khi
//       CẢ HAI bên có) — cầu nối thật của đơn nhiều con (`lib/finance/gia-tu-dong-don.ts`).
//
// ⚠️ MƠ HỒ ⇒ KHÔNG ĐOÁN. Hai dòng cùng khớp (đơn mua lại, hai lần gia hạn…) ⇒ trả `null`, ảnh chụp rơi về `finalPrice` và đặt `snapTuitionSuyRa = true`. Chọn
// bừa một dòng là in ra con số tiền hoàn mà không ai biết nó lấy từ đâu — tệ hơn nhãn "suy ra".
// ⚠️ CẶP (tiền, số buổi) PHẢI TỪ CÙNG MỘT DÒNG: học phí của dòng 24 buổi mà chia cho 48 buổi của khoá thì đơn giá giảm một nửa. Vì vậy hàm trả cả `soBuoi`.
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata } from "@/lib/orders/hoc-vien-dong-don";

export type DongDonUngVien = {
  enrollmentId: string | null;
  totalPrice: number;
  discountAmount: number;
  metadata: unknown;
};

export type GhiDanhDeTim = { id: string; courseId: string; leadChildId: string | null };

export type DongDonTimDuoc = {
  /** `totalPrice − discountAmount`, không âm. */
  hocPhiRong: number;
  /** `metadata.soBuoi` của CHÍNH dòng này (null = dòng không khai). */
  soBuoi: number | null;
  nguon: "dong-don.enrollmentId" | "dong-don.metadata";
};

const ra = (d: DongDonUngVien, nguon: DongDonTimDuoc["nguon"]): DongDonTimDuoc => ({
  hocPhiRong: Math.max(0, d.totalPrice - d.discountAmount),
  soBuoi: docHinhThucLop(d.metadata).soBuoi,
  nguon,
});

export function chonDongDonChoGhiDanh(gd: GhiDanhDeTim, ungVien: readonly DongDonUngVien[]): DongDonTimDuoc | null {
  // (A) nối trực tiếp — nếu CÓ dòng nối trực tiếp thì chỉ xét chúng (không trộn với đường (B)).
  const truc = ungVien.filter((d) => d.enrollmentId === gd.id);
  if (truc.length > 0) return truc.length === 1 ? ra(truc[0]!, "dong-don.enrollmentId") : null;

  // (B) qua metadata: chỉ dòng CHƯA nối ghi danh nào (dòng đã nối ghi danh khác thuộc về ghi danh đó).
  const khop = ungVien.filter((d) => {
    if (d.enrollmentId !== null) return false;
    if (docHinhThucLop(d.metadata).courseId !== gd.courseId) return false;
    const be = docConLeadTuMetadata(d.metadata);
    return gd.leadChildId === null || be === null || be === gd.leadChildId;
  });
  return khop.length === 1 ? ra(khop[0]!, "dong-don.metadata") : null;
}
