/**
 * lib/nguon/chup-lai-chu-nguon-luat.ts — LUẬT THUẦN của «chụp lại chủ nguồn» cho các lead đã ghi nhận (W3 · gt2 R1-H1, 10/10/2026). Không DB, không đồng hồ.
 *
 * ── Vấn đề ────────────────────────────────────────────────────────────────────────────────────────────────
 * Chủ nguồn (`LeadSourceGroup.ownerEmployeeId`) được CHỤP vào `LeadAttribution.signals.nguon.chuNhanVienId` lúc ghi nhận (`nguon-chup.ts`) để đổi chủ giữa hai đợt thu của một đơn trả góp
 * KHÔNG làm đợt sau về người khác. Cái giá: bản chụp không tự lành —
 *   (a) lead ghi lúc nguồn CHƯA có chủ ⇒ chụp `null` ⇒ treo `NGUON_CHUA_CO_NGUOI_PHU_TRACH` vĩnh viễn dù admin khai chủ sau;
 *   (b) chủ đã chụp nghỉ việc / bị thay ⇒ mọi lead đã ghi nhận treo `NGUOI_HUONG_NGHI`; mã này không thuộc `MA_GIAI_DUOC` nên hàng chờ không giải được.
 * Lối thoát duy nhất trước đây là «Đổi nguồn» TỪNG lead. Với nguồn quảng cáo (đa số lead) đó là rủi ro lớn khi bật chính sách theo nguồn.
 *
 * ── Luật chọn lead cần chụp lại (MỘT chỗ — tệp này) ───────────────────────────────────────────────────────
 *  · lead thuộc nguồn này, bản chụp ĐÚNG hình dạng (HONG thì để nguyên: fail-closed có chủ đích; CHUA_CO thì đã theo chủ SỐNG rồi);
 *  · bản chụp đang trỏ KHÔNG PHẢI chủ hiện tại, và một trong ba:
 *      THIEU_CHU            chụp `null` (nguồn chưa có chủ lúc ghi nhận);
 *      CHU_NGHI_VIEC        chủ đã chụp có trạng thái nghỉ (CÙNG tập `TRANG_THAI_NGHI` mà engine dùng để từ chối chi tiền — D13);
 *      CHU_KHONG_CON_HO_SO  chủ đã chụp không còn hồ sơ nhân sự.
 *  · KHÔNG đụng lead mà chủ đã chụp CÒN HOẠT ĐỘNG (ACTIVE / ON_LEAVE): đó là người mà đợt thu đầu có thể đã trả — đổi họ là hồi tố tiền đã chốt. Việc «nguồn đổi chủ A→B» với A còn làm việc
 *    vẫn đi bằng «Đổi nguồn» từng lead (có lý do + quyền), chủ ý không có đường hàng loạt cho ca đó.
 *  · KHÔNG đụng chủ đã chụp «còn làm việc nhưng chưa có tài khoản»: việc cần làm là cấp tài khoản cho họ (engine tự tra tài khoản mỗi lượt quét), không phải chuyển tiền sang người khác.
 *
 * Chỉ ghi `chuNhanVienId`. `cuaSoNgay`, `attributedAt`, nhóm nguồn, nguồn gốc KHÔNG đổi (đổi cửa sổ là hồi tố, đổi `attributedAt` là phá first-claim).
 */
import { TRANG_THAI_NGHI } from "@/lib/hoa-hong/nguoi-huong";
import type { LyDoChupLai } from "./chup-lai-chu-nguon-nhan";

export { NHAN_LY_DO_CHUP_LAI, kiemLyDoChupLai, type LyDoChupLai } from "./chup-lai-chu-nguon-nhan";

/**
 * Câu ghi vào nhật ký (`newValues.hauQua`) của mỗi lô: người duyệt hàng chờ INPUT_DRIFT đọc nhật ký của nguồn để biết chênh lệch ở vai chủ nguồn có NGUỒN GỐC từ chụp lại (đã chủ ý, kèm lý do) hay không.
 * Lead đã chi cho chủ cũ KHÔNG nằm trong lô (xem `DA_CHI_CHU_NGUON`) nên không bao giờ là nguồn của vế «chủ cũ −x».
 */
export const HAU_QUA_CHUP_LAI =
  "Khoản thu ĐÃ tính của các lead này hiện INPUT_DRIFT (chênh lệch vai chủ nguồn) ở Sổ → Chờ điều chỉnh sau lượt Tính lại kỳ kế tiếp — người duyệt quyết định áp dụng. Lead đã có khoản chi cho chủ cũ được GIỮ chủ cũ, không thuộc lô này.";

/** Khoá advisory theo NGUỒN của một lượt chụp lại (chuỗi đưa vào `hashtextextended`). MỘT chỗ dựng chuỗi: dịch vụ lấy khoá, ca DB giữ ĐÚNG khoá ấy để chứng minh lô phải chờ. */
export const khoaChupLaiTheoNguon = (nguonId: string): string => `nguon-chup-lai-chu:${nguonId}`;

/**
 * Phạm vi người bấm: lô chạy trên lead của MỌI cơ sở (danh mục nguồn là dữ liệu chung, `scopedDb` không che write), nên chỉ người có tầm nhìn TOÀN HỆ THỐNG mới được chạy. Hai quyền
 * `sources:manage` + `commission_policies:activate` hôm nay chỉ vai Hội sở giữ, nhưng vai neo ở MỘT cơ sở mà được cấp thêm vai thứ hai thì tập quyền vẫn đủ cả hai — cổng phạm vi là lớp thứ ba, fail-closed.
 * Trang vẽ nút và action cùng hỏi hàm này (luật 12: không vẽ nút chắc chắn bị từ chối).
 */
export function duPhamViChupLai(actor: { isSuperAdmin: boolean; isHoLevel: boolean }): boolean {
  return actor.isSuperAdmin === true || actor.isHoLevel === true;
}

/** Số lead tối đa MỘT lô. Mỗi lô là một transaction ngắn (trần 5 giây của Prisma) — lô lớn hơn là mời `P2028`. */
export const CO_LO_TOI_DA = 200;
/** Cỡ lô mà Server Action dùng. */
export const CO_LO_CHUP_LAI = 100;


/**
 * Bản chụp có cần chụp lại không, và vì sao. `trangThaiNhanSu`: `Employee.id` → `status` của những nhân sự CÒN hồ sơ (vắng khoá = hồ sơ không còn).
 * `chuHienTai` BẮT BUỘC và là chuỗi (luật 7): không có chủ hiện tại thì không có gì để chụp — nơi gọi đã chặn từ trước.
 */
export function phanLoaiChuChup(p: {
  chuChup: string | null;
  chuHienTai: string;
  trangThaiNhanSu: ReadonlyMap<string, string>;
}): LyDoChupLai | null {
  if (p.chuChup === p.chuHienTai) return null;
  if (p.chuChup === null) return "THIEU_CHU";
  const tt = p.trangThaiNhanSu.get(p.chuChup);
  if (tt === undefined) return "CHU_KHONG_CON_HO_SO";
  return TRANG_THAI_NGHI.has(tt) ? "CHU_NGHI_VIEC" : null;
}

/** Nhân sự sắp được GHI làm chủ: phải còn làm việc VÀ có tài khoản (không thì chụp xong vẫn treo — vòng lặp vô ích). `null` = hợp lệ. */
export function kiemChuHienTai(e: { status: string; coTaiKhoan: boolean } | null): string | null {
  if (e === null) return "Nguồn chưa khai người phụ trách (hoặc hồ sơ nhân sự không còn). Khai ở «Sửa nguồn» trước khi chụp lại.";
  if (e.status !== "ACTIVE" && e.status !== "ON_LEAVE") return "Người phụ trách hiện tại của nguồn đã nghỉ việc. Đổi người phụ trách ở «Sửa nguồn» trước khi chụp lại.";
  if (!e.coTaiKhoan) return "Người phụ trách hiện tại chưa có tài khoản đăng nhập, nên hoa hồng vẫn chưa chi được. Cấp tài khoản cho họ trước khi chụp lại.";
  return null;
}
