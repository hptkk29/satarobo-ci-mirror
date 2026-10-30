// lib/ai-lead/trang-thai.ts — QUYẾT ĐỊNH phản hồi `POST /lead-intakes` (design §5, error-codes.md §6.1). HÀM THUẦN.
//
// ═══ NGUYÊN TẮC N1 (trung tính) — LÝ DO TỆP NÀY TỒN TẠI NHƯ MỘT HÀM THUẦN TÁCH RIÊNG ═══════════════════════════════════
// Phản hồi chỉ được phụ thuộc vào (a) dữ liệu Agent VỪA GỬI và (b) trạng thái cuộc HỘI THOẠI. Nó KHÔNG BAO GIỜ được phụ thuộc việc SĐT đã có trong
// CRM hay chưa — một mã/nhánh khác nhau cho "khách cũ" biến Gateway thành công cụ dò dữ liệu khách hàng.
//
// Cách bảo đảm KHÔNG dựa vào kỷ luật của người viết: `DauVaoQuyetDinh` KHÔNG CÓ chỗ nào để nhét dữ liệu CRM (lead, liên hệ, sale, nguồn, kết quả
// kiểm trùng). Tệp này không import DB, không import `lib/lead`/`lib/crm` (lưới [AIL-TT-N1] đọc chính tệp nguồn). Muốn phản hồi phụ thuộc CRM thì
// phải sửa kiểu ở đây — và test sẽ đỏ.
//
// Thứ tự ưu tiên (CỐ ĐỊNH, hợp đồng): INVALID_SELECTION > NEED_INFO > HUMAN_QUEUED > ACCEPTED.
//
// NGOẠI LỆ ĐỨNG TRÊN CÙNG (OD-02, chốt 27/10/2026): hội thoại đã KHÔNG còn do AI giữ (`ownerState ≠ AI_ACTIVE`) ⇒ LUÔN HUMAN_QUEUED, bất kể dữ liệu
// thiếu hay sai. Lý do: NEED_INFO/INVALID_SELECTION bảo Agent HỎI TIẾP khách — trong khi hội thoại đang giao cho người thì đó chính là AI và người
// cùng nhắn một khách. Dữ liệu khách gửi vẫn được LƯU (tầng dịch vụ), chỉ phản hồi bị khoá. Ca [AIL-TT-09] ghim.
import { canonicalPhone } from "@/lib/phone";
import type { CoSoCatalog, FbNameSource, OwnerState, QuyetDinhLeadIntake, TruongHoiTiep } from "./kieu";

/**
 * Đầu vào của quyết định — TOÀN BỘ. Cố ý hẹp: không có `leadId`, `existing`, `duplicate`, `saleId`, `sourceId`… (N1).
 * `catalog` là danh mục HIỆN HÀNH của đúng Page (đã xuất bản), không phải toàn bộ cơ sở trong hệ thống.
 */
export type DauVaoQuyetDinh = {
  candidate: { phoneRaw?: string | undefined; campusCode?: string | undefined };
  conversation: { fbName?: string | null | undefined; fbNameSource?: FbNameSource | undefined };
  catalog: readonly Pick<CoSoCatalog, "campusCode" | "acceptingLeads">[];
  ownerState: OwnerState;
};

/** Danh sách khoá của `DauVaoQuyetDinh` — test so với kiểu để thêm một khoá (đặc biệt khoá nhìn như dữ liệu CRM) là phải sửa test. */
export const TRUONG_DAU_VAO = ["candidate", "conversation", "catalog", "ownerState"] as const;

/** Tên Facebook ĐÃ có nguồn do runtime cung cấp (không phải khách tự gõ). Tên rỗng/toàn khoảng trắng coi như không có. */
export function fbNameDaXacMinh(c: DauVaoQuyetDinh["conversation"]): boolean {
  if (typeof c.fbName !== "string" || c.fbName.trim() === "") return false;
  return c.fbNameSource === "META_PROFILE_API" || c.fbNameSource === "WEBHOOK_PAYLOAD";
}

/**
 * `consentMarketing` truyền vào ingest = `true` CHỈ khi `consent.contactAllowed === true` kèm `messageMid` (OD-08, design §5). Không có bằng chứng ⇒ false.
 * KHÔNG suy diễn từ "khách chủ động nhắn tin". Kiểu nhận `unknown`-an toàn: dữ liệu đã qua zod, nhưng hàm này là chốt cuối nên tự kiểm lại.
 */
export function consentChoIngest(candidate: { consent?: { contactAllowed?: unknown; messageMid?: unknown } | undefined }): boolean {
  const c = candidate.consent;
  return c !== undefined && c.contactAllowed === true && typeof c.messageMid === "string" && c.messageMid.length > 0;
}

export function quyetDinhLeadIntake(x: DauVaoQuyetDinh): QuyetDinhLeadIntake {
  // 0) Hội thoại không còn do AI giữ ⇒ khoá đường thu thập (xem ghi chú đầu tệp).
  if (x.ownerState !== "AI_ACTIVE") return { status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" };

  // 1) INVALID_SELECTION — cơ sở khách chọn không có trong catalog của Page, hoặc đã ngừng nhận khách.
  const maCoSo = x.candidate.campusCode;
  if (maCoSo !== undefined) {
    const coSo = x.catalog.find((c) => c.campusCode === maCoSo);
    if (!coSo || !coSo.acceptingLeads) return { status: "INVALID_SELECTION", nextAction: "RE_ASK_CAMPUS", refreshCatalog: true };
  }

  // 2) NEED_INFO — thứ khách CÓ THỂ cung cấp. SĐT sai định dạng (số bàn…) và SĐT thiếu cho CÙNG kết quả (Agent không phân biệt được).
  //    Thứ tự CỐ ĐỊNH [phone, campus].
  const hoi: TruongHoiTiep[] = [];
  if (x.candidate.phoneRaw === undefined || canonicalPhone(x.candidate.phoneRaw) === null) hoi.push("phone");
  if (maCoSo === undefined) hoi.push("campus");
  if (hoi.length > 0) return { status: "NEED_INFO", nextAction: "ASK_FIELDS", askFields: hoi };

  // 3) HUMAN_QUEUED — thiếu thứ KHÁCH KHÔNG cung cấp được (tên Facebook chưa xác minh). (Ca hội thoại không còn do AI giữ đã trả ở bước 0.)
  if (!fbNameDaXacMinh(x.conversation)) {
    return { status: "HUMAN_QUEUED", nextAction: "TELL_STAFF_WILL_CONTACT" };
  }

  // 4) ACCEPTED — chỉ cảm ơn chung chung; KHÔNG bảo đảm lead mới được tạo.
  return { status: "ACCEPTED", nextAction: "ACKNOWLEDGE_GENERIC" };
}
