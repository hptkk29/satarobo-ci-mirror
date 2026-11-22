// lib/inbox/identity-rules.ts — LUẬT nối danh tính ngoài với `Lead`. THUẦN, không DB.
//
// Tách khỏi tầng DB vì đây là chỗ dễ sai và sai thì im lặng: nối nhầm nghĩa là hội
// thoại của khách A nằm trong hồ sơ khách B, và nó chỉ lộ ra lúc Sale gọi nhầm người.
//
// Nguyên tắc: THÀ MỒ CÔI CÒN HƠN ĐOÁN. Hội thoại chưa nối được lead là trạng thái
// bình thường của hộp thư này, không phải lỗi cần "vá cho hết".
import { canonicalPhone } from "@/lib/phone";

export type QuyetDinhNoiLead =
  | { noi: true; leadId: string; source: "PHONE_MATCH" }
  | {
      noi: false;
      lyDo:
        /** Không có SĐT để tra. Ca THƯỜNG GẶP NHẤT với Zalo OA/Messenger. */
        | "KHONG_CO_SDT"
        /** Có SĐT nhưng chưa phiếu nào mang số đó. KHÔNG tự tạo lead. */
        | "KHONG_KHOP_LEAD"
        /** Nhiều phiếu cùng số — để người chọn, hệ thống không đoán. */
        | "NHIEU_LEAD_KHOP";
    };

/** Nhãn tiếng Việt cho hàng đợi "chưa nối được khách". */
export const LY_DO_MO_COI: Record<
  Extract<QuyetDinhNoiLead, { noi: false }>["lyDo"],
  string
> = {
  KHONG_CO_SDT: "Chưa có số điện thoại — kênh không gửi kèm số.",
  KHONG_KHOP_LEAD: "Số điện thoại chưa khớp phiếu khách nào.",
  NHIEU_LEAD_KHOP: "Nhiều phiếu khách cùng số — cần chọn tay.",
};

/** Mảnh `where` giới hạn ứng viên `Lead` theo đơn vị. `{}` = không lọc. */
export type DieuKienDonViLead =
  | Record<string, never>
  | { OR: [{ orgUnitId: string }, { orgUnitId: null }] };

/**
 * Ứng viên `Lead` được phép nối cho một hội thoại đã biết đơn vị.
 *
 * 🔴 Vì sao phải lọc: `timLeadTheoSdt` vốn tra `Lead` không giới hạn cơ sở nào, nên
 * một số điện thoại trùng giữa hai cơ sở (anh em ruột, phụ huynh chuyển cơ sở, số
 * công ty) là đủ để hội thoại của CS1 chui vào hồ sơ của CS2. Nó im lặng: hai bên
 * đều thấy màn hình bình thường, chỉ là dữ liệu của người khác.
 *
 * Hai lựa chọn cố ý ở đây:
 *  • CHƯA biết đơn vị ⇒ KHÔNG lọc. Tin đầu tiên của người lạ luôn chưa biết cơ sở;
 *    lọc bừa là biến "chưa biết" thành "không khớp phiếu nào" cho mọi hội thoại mới.
 *  • Phiếu `orgUnitId = null` VẪN là ứng viên. Đó là phiếu cũ/chưa gán cơ sở — loại
 *    nó ra thì đúng những phiếu tồn đọng lâu nhất là những phiếu không bao giờ khớp.
 *    (Đổi lại: một số trùng giữa phiếu-chưa-gán và phiếu-cùng-cơ-sở cho ra HAI ứng
 *    viên ⇒ `NHIEU_LEAD_KHOP` ⇒ mồ côi. Thà để người bấm tay.)
 */
export function dieuKienDonViLead(orgUnitId: string | null | undefined): DieuKienDonViLead {
  const donVi = orgUnitId?.trim();
  if (!donVi) return {};
  return { OR: [{ orgUnitId: donVi }, { orgUnitId: null }] };
}

/**
 * Quyết định có tự nối không, dựa trên SĐT và DANH SÁCH ỨNG VIÊN đã tra sẵn.
 *
 * ⚠️ Chỗ gọi phải tra bằng `phone: { in: phoneVariants(sdt) }`, KHÔNG so bằng:
 * DB còn tồn tại CẢ HAI định dạng (`0…` và `84…` — đo trên DEV 03/08: 99 và 8 bản).
 * So bằng một dạng là bỏ sót đúng nửa dữ liệu mà không có dấu hiệu nào.
 */
export function quyetDinhNoiTheoSdt(
  sdt: unknown,
  ungVien: readonly { id: string }[],
): QuyetDinhNoiLead {
  const chuan = canonicalPhone(sdt);
  if (!chuan) return { noi: false, lyDo: "KHONG_CO_SDT" };
  if (ungVien.length === 0) return { noi: false, lyDo: "KHONG_KHOP_LEAD" };
  if (ungVien.length > 1) return { noi: false, lyDo: "NHIEU_LEAD_KHOP" };
  return { noi: true, leadId: ungVien[0]!.id, source: "PHONE_MATCH" };
}
