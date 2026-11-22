// lib/hoa-hong/loi-ra-vuot-tran.ts — LỐI RA khi tổng hoa hồng vượt TRẦN, theo QUYỀN của người đang xem. THUẦN, an toàn cho client.
//
// Chủ dự án chốt 09/10/2026: nâng trần là THAO TÁC CỦA ADMIN (sửa `crm.commissionMaxTotalRate` ở Cấu hình vận hành); hệ thống không tự nâng, không tự cắt. `huong-xu-ly-tran.ts` đã
// nói TỔNG · TRẦN · CHÊNH và có đường dẫn khi nâng trần đủ để qua. Chỗ còn thiếu là AI được đi theo đường ấy: một liên kết vẽ cho mọi người, mà người xem bấm vào chỉ gặp màn không sửa được
// ô trần, là lời hứa suông (luật 12). Cổng LƯU của ô là `settings:edit`; liên kết vẽ bằng đúng khoá đó.
//
// Ba kết cục, mỗi kết cục MỘT câu (không rải câu chữ ra các thành phần):
//   · có quyền ∧ nâng trần đủ  ⇒ liên kết tới Cấu hình vận hành;
//   · không quyền ∧ nâng trần đủ ⇒ KHÔNG liên kết, nói «nhờ Quản trị hệ thống nâng»;
//   · nâng trần không đủ (tổng vượt giới hạn của ô) ⇒ không liên kết kể cả có quyền; chỉ còn chỉnh tỉ lệ.
import { DUONG_CAU_HINH_TRAN, type HuongXuLyTran } from "./huong-xu-ly-tran";

/** Quyền SỬA ô «Trần tổng hoa hồng» — ĐÚNG khoá mà action lưu cấu hình hỏi (lưới [LRT-04] đối chiếu với mã nguồn của action). */
export const QUYEN_SUA_TRAN = "settings:edit" as const;

export type LoiRaTran = {
  /** Có ⇒ vẽ liên kết. Chỉ khi người xem CÓ quyền sửa trần ∧ nâng trần là lối hợp lệ. */
  lienKet: { href: string; nhan: string } | null;
  /** Câu hoàn chỉnh cho người đọc (nêu người làm · màn nào · việc gì · rồi kích hoạt lại). */
  cauChu: string;
};

/**
 * `duongDan` lấy từ `HuongXuLyTran.duongDan` (null ⇒ nâng trần không đủ). `coQuyenSuaTran` BẮT BUỘC (luật 7): mặc định nào cũng sai chiều — `true` mời người không có quyền,
 * `false` giấu liên kết của admin.
 */
export function quyetDinhLoiRaTran(d: { duongDan: HuongXuLyTran["duongDan"]; coQuyenSuaTran: boolean }): LoiRaTran {
  const chinhTiLe = "chỉnh lại tỉ lệ trong chính sách";
  if (d.duongDan === null) {
    return { lienKet: null, cauChu: `Nâng trần cũng không đủ: tổng vượt cả giới hạn của ô «Trần tổng hoa hồng». Chỉ còn cách ${chinhTiLe} rồi kích hoạt lại.` };
  }
  if (d.coQuyenSuaTran) {
    return {
      lienKet: { href: d.duongDan.href, nhan: d.duongDan.nhan },
      cauChu: `Hai cách: nâng «Trần tổng hoa hồng» ở ${d.duongDan.nhan}, hoặc ${chinhTiLe}; sau đó kích hoạt lại. Hệ thống không tự nâng trần và không tự cắt tỉ lệ.`,
    };
  }
  return {
    lienKet: null,
    cauChu: `Bạn không có quyền sửa cấu hình. Nhờ Quản trị hệ thống nâng «Trần tổng hoa hồng» tại ${DUONG_CAU_HINH_TRAN.nhan}, hoặc ${chinhTiLe}; sau đó kích hoạt lại. Hệ thống không tự nâng trần và không tự cắt tỉ lệ.`,
  };
}
