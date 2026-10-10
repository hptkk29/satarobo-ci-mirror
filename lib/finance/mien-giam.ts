// lib/finance/mien-giam.ts — MIỄN GIẢM NỢ CỦA MỘT CON. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN G1 · US-22 "Miễn giảm và vượt giới hạn"
//
//   AC1 — *"`billing:waive`: thêm QUYẾT TOÁN âm có lý do, KHÔNG LỚN HƠN còn nợ của ghi danh."*
//   AC3 — *"Sale gọi trực tiếp action miễn giảm → TỪ CHỐI (test deny ở action, không chỉ ẩn
//          nút)."*
//
// ─────────────────────────────────────────────────────────────────────────────
// QUYỀN: `orders:manage`, KHÔNG PHẢI `billing:waive`
//
// BA khai một quyền tên `billing:waive`. Quyền ấy **KHÔNG TỒN TẠI** trong repo — đo
// `prisma/seed-roles.ts` 22/09/2026, cả bộ chỉ có `payments:{view,record,confirm,manage,
// adjust,view-pii}` và `orders:{view,create,manage,view-pii}`.
//
// Và đây là chỗ KHÔNG được tự chế một key mới: bài học `audit-logs:view` (CLAUDE.md) — một
// quyền không vai nào được cấp biến cả màn hình thành cửa khoá, và người ta mất hàng giờ đi
// tìm "lỗi phân quyền" cho một thứ chưa bao giờ được khai.
//
// Nên cổng là `orders:manage`, và phép đo cho thấy nó khớp KHÍT với AC:
//
//   | vai                | orders:manage | US-22 muốn |
//   |--------------------|---------------|------------|
//   | CENTER_MANAGER     | ✓             | ✓ (QLCS)   |
//   | HO_ACCOUNTANT      | ✓             | ✓          |
//   | CENTER_SALES_CSM   | ✗             | ✗ (AC3)    |
//   | CENTER_ACCOUNTANT  | ✗             | —          |
//
// ⚠️ Muốn tách riêng `billing:waive` thì phải SỬA SEED + bấm chạy `seed-prod-roles.yml`
// (RBAC v2 đọc quyền từ DỮ LIỆU — merge file seed KHÔNG đổi gì trên prod). Đó là một ticket
// có chủ đích, không phải hệ quả phụ của PR này.
//
// ─────────────────────────────────────────────────────────────────────────────
// MIỄN GIẢM GHI VÀO ĐÂU — HAI CỘT, TUỲ BÉ ĐÃ DỪNG HỌC CHƯA
//
// "Phải thu của một con" được `docSoTheoCon` tính theo HAI công thức khác nhau:
//
//   · bé còn học  → `totalPrice − discountAmount`
//   · bé đã dừng  → `usedValue` (giá trị quyết toán, PHIÊN D)
//
// Nên một khoản miễn giảm phải hạ ĐÚNG cột đang được đọc. Ghi nhầm cột là con số trên màn
// KHÔNG NHÚC NHÍCH trong khi nhật ký nói đã miễn — đúng loại lỗi câm tệ nhất về tiền: người
// vận hành bấm lại lần nữa, rồi lần nữa.

/** Bé đã dừng học chưa — quyết định miễn giảm ghi vào cột nào. */
export const CHO_GHI = {
  /** Bé còn học ⇒ cộng vào `OrderItem.discountAmount` (một khoản giảm muộn). */
  GIAM_GIA: "GIAM_GIA",
  /** Bé đã dừng ⇒ hạ `OrderItem.usedValue` (quyết toán âm, đúng chữ của AC1). */
  QUYET_TOAN: "QUYET_TOAN",
} as const;
export type ChoGhi = (typeof CHO_GHI)[keyof typeof CHO_GHI];

export type KiemMienGiam =
  | { ok: true; soTien: number; choGhi: ChoGhi; phaiThuMoi: number }
  | { ok: false; loi: string };

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

/**
 * Miễn `soTien` nợ của một con được không, và ghi vào cột nào.
 *
 * Thứ tự cổng có chủ đích: HÌNH DẠNG → LÝ DO → TRẦN. Báo "vượt trần" cho một người quên gõ
 * lý do sẽ khiến họ đi sửa nhầm chỗ.
 */
export function kiemMienGiam(input: {
  soTien: number;
  /** `phaiThu − daThu` của bé. Có thể ÂM (bé đang đóng thừa). */
  conNo: number;
  /** `phaiThu` hiện tại của bé — để tính `phaiThuMoi`. */
  phaiThu: number;
  daDungHoc: boolean;
  lyDo: string;
  tenCon: string;
}): KiemMienGiam {
  const soTien = tron(input.soTien);
  if (!Number.isFinite(input.soTien) || soTien <= 0) {
    return { ok: false, loi: "Số tiền miễn giảm phải lớn hơn 0" };
  }
  if (!input.lyDo.trim()) {
    // Miễn giảm là tiền KHÔNG BAO GIỜ về. Câu giải trình là thứ duy nhất trả lời được
    // "vì sao nhà này bớt mà nhà kia không" khi báo cáo tháng hỏi tới.
    return { ok: false, loi: "Phải ghi lý do miễn giảm" };
  }

  const conNo = tron(input.conNo);
  if (conNo <= 0) {
    return {
      ok: false,
      loi:
        conNo === 0
          ? `${input.tenCon} không còn nợ đồng nào — không có gì để miễn.`
          : `${input.tenCon} đang ĐÓNG THỪA ${vnd(-conNo)} — miễn giảm ở đây là làm khoản ` +
            `thừa to thêm, không phải xoá nợ. Xử lý khoản thừa bằng đường chuyển sang bé khác ` +
            `hoặc hoàn tiền.`,
    };
  }
  if (soTien > conNo) {
    return {
      ok: false,
      loi: `Miễn tối đa ${vnd(conNo)}đ — đúng phần ${input.tenCon} còn nợ (AC1: không lớn hơn còn nợ).`,
    };
  }

  return {
    ok: true,
    soTien,
    choGhi: input.daDungHoc ? CHO_GHI.QUYET_TOAN : CHO_GHI.GIAM_GIA,
    phaiThuMoi: Math.max(0, tron(input.phaiThu) - soTien),
  };
}
