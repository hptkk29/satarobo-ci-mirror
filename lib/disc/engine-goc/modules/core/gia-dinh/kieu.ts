// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/gia-dinh/kieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * KIỂU CỦA SỔ GIA ĐÌNH (ADR-007) — đơn vị dữ liệu là MỘT GIA ĐÌNH, không phải một bài.
 *
 * Thuộc TẦNG LÕI (ADR-004): chỉ kiểu và hàm thuần, không React, không DOM.
 *
 * 🔴 Một máy = một nhà. KHÔNG có bảng nối giữa gia đình và thành viên: một thành viên
 * thuộc đúng một nhà, nên bảng nối chỉ mua thêm chi phí bảo trì cho một quan hệ
 * nhiều-nhiều không tồn tại.
 */

import type { VaiGiaDinh } from "@/lib/disc/engine-goc/config/disc-gia-dinh";
import type { MaBoDe, MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";

export type ThanhVien = {
  readonly id: string;
  /**
   * 🔴 TÊN THẬT ĐƯỢC PHÉP (ADR-005). Bốn hàng rào giữ nguyên: không rời máy · không vào
   * tệp xuất · không vào ảnh chia sẻ · không vào mã mời. Test luôn dùng tên bịa.
   */
  readonly ten: string;
  readonly vaiTro: VaiGiaDinh;
  /** Chỉ để định tuyến bộ đề khi bấm *Làm bài* từ thẻ. Không đưa vào báo cáo. */
  readonly lop?: string;
  /** Tuổi, nếu đã hỏi. 🔴 KHÔNG BAO GIỜ suy từ lớp — lớp 7 có cả bé 12 lẫn bé 13. */
  readonly tuoi?: number;
  /** Thứ tự hiện trên bảng. Người dùng kéo thả được ở bản sau. */
  readonly thuTu: number;
  /** Ghi chú của phụ huynh về người này. Nằm NGAY TRONG bản ghi, không bảng phụ. */
  readonly ghiChu?: string;
  /**
   * 🔴 HỒ SƠ NHẬN QUA MÃ MỜI (13.1) — người này làm bài ở MÁY KHÁC.
   *
   * Vì sao là một trường riêng chứ không dựng một `BaiLamLuu` giả: mã mời chỉ mang bốn
   * con số, KHÔNG mang câu trả lời. Bịa ra một bảng câu trả lời khớp với bốn con số đó là
   * tạo dữ liệu chưa ai từng nhập — và sáu tháng sau không ai phân biệt được nó với dữ
   * liệu thật. Thà nói thẳng: *"hồ sơ này nhận qua mã mời, máy này không có bài gốc"*.
   */
  readonly nhanQuaMa?: {
    readonly boDe: MaBoDe;
    readonly diem: Readonly<Record<MaTruc, number>>;
    /** Ngày phát mã, `yyyy-mm-dd`. */
    readonly ngayPhat: string;
  };
  readonly taoLuc: string;
  readonly suaLuc: string;
};

/** Bản phân tích cả nhà đã sinh — lưu lại để khỏi tính lại và để so theo thời gian. */
export type PhanTichGiaDinh = {
  readonly id: string;
  /** Mã các bài được đưa vào bản phân tích này. */
  readonly maBai: readonly string[];
  readonly taoLuc: string;
  /** Nội dung đã sinh, dạng tự do — GĐ14 định nghĩa hình dạng cụ thể. */
  readonly noiDung: unknown;
};

/**
 * Chế độ xoá một thành viên.
 *
 * 🔴 CỐ Ý KHÔNG CÓ GIÁ TRỊ MẶC ĐỊNH ở tầng lưu trữ. Xoá dây chuyền là đường mất dữ liệu
 * nhanh nhất, và một tham số mặc định là cách nó lẻn vào: ai đó gọi `xoaThanhVien(id)`,
 * không nghĩ gì thêm, và bài của một đứa trẻ biến mất. Bắt gọi phải NÓI RA mình muốn gì.
 *
 * Giao diện thì mặc định `"giu-bai"` — bài rơi về mục *chưa xếp*, xếp lại được.
 */
export type CheDoXoaThanhVien = "giu-bai" | "xoa-bai";
