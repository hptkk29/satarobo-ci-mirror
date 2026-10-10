// lib/crm/commission-assignee.ts — AI HƯỞNG QC 1% VÀ QUẢN LÝ TT 2% (chủ dự án chốt 27/08/2026).
//
// ─────────────────────────────────────────────────────────────────────────────
// VẤN ĐỀ FILE NÀY GIẢI
//
// PR #192 nối hoa hồng vào tiền đã thu, nhưng chỉ 5/8 phần trăm chảy được: tầng SALE
// (4%) và SALE_ADMIN (1%) có nguồn người hưởng trên `Lead`, còn QC (1%) và QL_TT (2%)
// thì KHÔNG — kho không có chỗ nào ghi "QC phụ trách cơ sở", và `Center.managerName`
// là CHUỖI TÊN chứ không phải liên kết tài khoản. 3% nằm treo mỗi kỳ.
//
// Chốt: cả hai tầng gán theo CƠ SỞ, bằng LIÊN KẾT TÀI KHOẢN, CÓ HIỆU LỰC THEO THỜI GIAN.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO PHẢI CÓ HIỆU LỰC THEO THỜI GIAN (chứ không phải một cột "người phụ trách")
//
// Kỳ hoa hồng được CHỐT LẠI nhiều lần (`chotKyHoaHong` xoá rồi ghi lại cả kỳ), và kỳ
// cũ có thể được REOPEN. Nếu người hưởng là một cột "hiện tại" thì đổi QC hôm nay sẽ
// viết lại hoa hồng của tháng trước cho người mới — người đã làm việc tháng trước mất
// tiền, người mới nhận tiền của việc chưa từng làm, và không dòng nào báo lỗi.
//
// Nên quan hệ là một SỔ có `effectiveFrom`/`effectiveTo`, và câu hỏi luôn là "AI phụ
// trách cơ sở X TẠI THỜI ĐIỂM t", với t = lúc kế toán XÁC NHẬN thu tiền.
//
// ⚠️ BIÊN PHẢI MỞ: `effectiveFrom <= t < effectiveTo`. Giống hệt `khoangKy` và
// `pickEffectiveRates`. Dùng `<=` ở biên phải là người cũ và người mới CÙNG khớp tại
// đúng thời khắc bàn giao ⇒ một bút toán rơi trúng nửa đêm bị chia đôi cho hai người.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUYẾT ĐỊNH: MỘT CƠ SỞ NHIỀU NGƯỜI → CHIA ĐỀU (không phải "một người đứng tên")
//
// Chọn phương án AN TOÀN VỀ TIỀN, và tiêu chí là "hỏng thì hỏng kiểu nào":
//   • Chia đều — nhập thừa một dòng thì 1% bị chia cho 3 người thay vì 2. Tổng chi
//     VẪN đúng 1%. Sai người, đúng tiền: nhìn thấy được trên bảng kê và sửa được.
//   • Một người đứng tên (cờ `isPrimary`) — hai dòng cùng bật cờ thì engine hoặc chọn
//     bừa (bảng kê hết TẤT ĐỊNH, chốt lại kỳ ra số khác) hoặc trả cả hai (2% thay vì
//     1% — vượt trần 8% trong TIỀN THẬT, mà `validateRates` không kêu vì nó chỉ canh
//     CẤU HÌNH tỉ lệ). Hỏng theo hướng mất tiền và không ai nhìn ra.
// ⇒ Chia đều. Phép chia dùng phần dư lớn nhất (`chiaDeuTien`) nên Σ các phần ĐÚNG BẰNG
//   tổng tầng, không hụt đồng lẻ.
//
// Vai QL_TT trên thực tế chỉ có một người (cột `Center.managerUserId` là số ít, và
// đường ghi đóng dòng cũ trước khi mở dòng mới). Luật chia đều vẫn áp cho nó — như
// một LƯỚI AN TOÀN: dữ liệu lọt vào bằng đường khác (import, SQL tay) cũng không thể
// làm tầng đó chi quá 2%.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUYẾT ĐỊNH: CƠ SỞ CHƯA KHAI NGƯỜI HƯỞNG → TREO, HIỆN RÕ, KHÔNG GÁN BỪA
//
// Giữ nguyên cơ chế đang chạy. Các phương án khác đều tệ hơn: dồn về Hội sở là trả
// tiền cho người không làm; chia cho các cơ sở đã khai là lấy tiền cơ sở này đưa cơ
// sở kia; bỏ im lặng là kế toán tưởng đã chi đủ 8%. Treo thì số tiền hiện lên màn chốt
// kỳ KÈM TÊN CƠ SỞ còn thiếu, khai xong chốt lại kỳ là tiền chảy — không mất gì.
import type { CommissionTier } from "@/lib/crm/commission";

/**
 * Hai vai hưởng hoa hồng gắn theo CƠ SỞ.
 *
 * Tên vai TRÙNG KHỚP tên tầng trong `COMMISSION_TIERS` — cố ý, để `commission-run`
 * ánh xạ vai → tầng bằng chính chuỗi đó thay vì một bảng tra thứ hai có thể lệch.
 * Hai tầng còn lại (SALE, SALE_ADMIN) gắn theo NGƯỜI trên `Lead`, không theo cơ sở.
 */
export const VAI_HOA_HONG_CO_SO = ["QC", "QL_TT"] as const;

export type VaiHoaHongCoSo = (typeof VAI_HOA_HONG_CO_SO)[number];

/** Kiểm ở tầng biên dịch: mọi vai theo cơ sở PHẢI là một tầng hoa hồng có thật. */
const _vaiLaTang: readonly CommissionTier[] = VAI_HOA_HONG_CO_SO;
void _vaiLaTang;

/**
 * Một dòng sổ "ai phụ trách cơ sở nào, từ khi nào tới khi nào".
 * Dựng từ `CenterCommissionAssignee`; file này KHÔNG chạm DB.
 */
export type PhanCongCoSo = {
  centerId: string;
  role: VaiHoaHongCoSo;
  /** Liên kết TÀI KHOẢN (`User.id`) — không phải chuỗi tên. */
  userId: string;
  effectiveFrom: Date;
  /** `null` = đang phụ trách. */
  effectiveTo: Date | null;
};

/**
 * THUẦN — ai hưởng vai `role` của cơ sở `centerId` tại thời điểm `at`.
 *
 * Trả về danh sách đã KHỬ TRÙNG và SẮP theo `userId` (tất định). Rỗng nghĩa là
 * "chưa khai" ⇒ caller phải treo tiền chứ không được gán bừa.
 */
export function nguoiHuongHieuLuc(
  rows: readonly PhanCongCoSo[],
  centerId: string | null,
  role: VaiHoaHongCoSo,
  at: Date,
): string[] {
  // Bút toán không quy được về cơ sở nào (đơn vãng lai, dữ liệu cũ) → không có ai.
  // Đoán bừa ở đây là chuyển tiền thật sang cơ sở không liên quan.
  if (!centerId) return [];
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.centerId !== centerId || r.role !== role) continue;
    if (r.effectiveFrom > at) continue;
    if (r.effectiveTo != null && at >= r.effectiveTo) continue; // biên PHẢI MỞ
    ids.add(r.userId);
  }
  return [...ids].sort();
}

/** Dòng đang hiệu lực tại `at` của một cơ sở × vai (cho màn quản trị). */
export function dangHieuLuc(row: PhanCongCoSo, at: Date): boolean {
  return row.effectiveFrom <= at && (row.effectiveTo == null || at < row.effectiveTo);
}
