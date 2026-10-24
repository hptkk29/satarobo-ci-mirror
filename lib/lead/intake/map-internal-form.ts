// lib/lead/intake/map-internal-form.ts — biểu mẫu "Nhập khách hàng"
// (`satarobo.vn/nhap-khach-hang`, có đăng nhập).
//
// Thay hẳn biểu mẫu tĩnh công khai ở `sale.satarobo.vn` (nghỉ 22/08/2026). Hai
// khác biệt bản chất so với biểu mẫu cũ:
//   1. **Mã nhân viên không còn là một ô để gõ** — lấy từ phiên đăng nhập. Không
//      gõ sai được, không gõ hộ nhau được, không cần nhớ mã của mình.
//   2. **Không ô nào bắt buộc** (chủ dự án chốt 22/08). Kể cả SĐT: lead từ quảng
//      cáo Facebook thường chỉ có link FB lúc mới thu về. Thiếu thì CẢNH BÁO chứ
//      không từ chối — người nhập đang ngồi trước mặt khách/inbox, họ biết rõ
//      hơn ta là phiếu này có đáng lưu không.
//
// Bộ ô (đúng 7, chốt 22/08): tên PH · SĐT PH · tên con · nguồn · link FB · cơ sở
// · ghi chú. Ô email/trường/lớp của bản trước đã BỎ.
//
// Giữ nguyên mọi thứ còn lại của đường nhập đang chạy: vẫn trả `MappedLead` để
// `ingestIntakeLead()` xử lý (chống trùng, tra cơ sở, tra người phụ trách theo
// mã NV, tự chia). KHÔNG mở đường ghi lead thứ hai.
import { canonicalPhone } from "@/lib/phone";
import {
  centerHintFromCode,
  normalizeFacebookUrl,
  parentNameFallback,
  str,
} from "./normalize";
import type { MapResult } from "./types";

/** Dữ liệu người nhập gõ trên biểu mẫu (đã qua zod ở tầng action). */
export type InternalFormInput = {
  parentName?: string | null;
  /** Đã chuẩn hoá `84…` bởi `phoneVnNullable`; `null` = người nhập bỏ trống. */
  phone?: string | null;
  childName?: string | null;
  /**
   * NHIỀU CON, mỗi em một khoá quan tâm (03/09/2026). Dòng không có tên bị bỏ
   * ngay trong mapper.
   */
  children?: { fullName?: string | null; courseId?: string | null }[] | null;
  /** Ô "Nguồn" gõ tự do → `Lead.source`. */
  source?: string | null;
  facebookUrl?: string | null;
  /** Mã cơ sở thật (`Center.code`), vd "CS1" — không phải số thứ tự của form cũ. */
  centerCode?: string | null;
  note?: string | null;
};

/** Danh tính người nhập, lấy từ phiên đăng nhập — KHÔNG lấy từ payload. */
export type InternalFormStaff = {
  /** `Employee.employeeCode` của tài khoản đang đăng nhập; null nếu chưa gắn. */
  employeeCode: string | null;
  /** Tên hiển thị để ghi vết khi chưa có mã nhân viên. */
  displayName: string;
};

export function mapInternalForm(
  input: InternalFormInput,
  staff: InternalFormStaff,
): MapResult {
  const warnings: string[] = [];
  const noteLines: string[] = [];

  // SĐT: zod đã chuẩn hoá hoặc từ chối. `canonicalPhone` chạy lại ở đây để
  // mapper vẫn đúng khi được gọi từ test/đường khác với chuỗi thô.
  const phone = input.phone ? (canonicalPhone(input.phone) ?? "") : "";
  if (input.phone && !phone) {
    warnings.push(`Số điện thoại "${input.phone}" không đọc được — chưa lưu.`);
  }

  // ── Danh sách con ───────────────────────────────────────────────────────
  // Bỏ dòng KHÔNG có tên: người dùng bấm "Thêm con" rồi để trống là chuyện
  // thường, và một `LeadChild` không tên thì không tra được, không gọi được,
  // chỉ làm bẩn hồ sơ.
  //
  // Khử trùng tên NGAY Ở ĐÂY (không phân biệt hoa/thường, gộp khoảng trắng):
  // gõ hai dòng cùng tên là đẻ hai bản ghi cho một đứa trẻ, và mọi màn đếm số
  // con sau đó đều sai. Tầng ingest cũng khử lần nữa cho nhánh trùng SĐT.
  const children: { fullName: string; interestedCourseId: string | null }[] = [];
  for (const c of input.children ?? []) {
    const ten = str(c.fullName);
    if (!ten) continue;
    const khoaGon = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
    if (children.some((x) => khoaGon(x.fullName) === khoaGon(ten))) continue;
    children.push({ fullName: ten, interestedCourseId: str(c.courseId) });
  }

  // Cột phẳng cũ: ưu tiên ô `childName` nếu nguồn còn gửi, không thì lấy em đầu.
  // `parentNameFallback` bên dưới cần nó để suy tên phụ huynh khi phiếu chỉ có
  // tên con.
  const childName = str(input.childName) ?? children[0]?.fullName ?? null;
  let parentName = str(input.parentName) ?? "";
  if (!parentName) {
    parentName = parentNameFallback(childName);
    warnings.push(
      childName
        ? "Phiếu không có tên phụ huynh — cần hỏi lại khi gọi."
        : "Phiếu không có tên phụ huynh lẫn tên bé — cần hỏi lại khi gọi.",
    );
  }

  const fb = normalizeFacebookUrl(input.facebookUrl);
  if (fb.warning) {
    warnings.push(fb.warning);
    // Không đọc được KHÔNG có nghĩa là vứt: giữ nguyên chuỗi người nhập gõ
    // trong ghi chú để còn cứu được bằng mắt người.
    noteLines.push(`Link Facebook (chưa đọc được): ${str(input.facebookUrl)}`);
  }

  // Không có SĐT lẫn link FB thì lead này không có cách nào liên hệ. Vẫn lưu
  // (không ô nào bắt buộc) nhưng phải nói thẳng ra, không để im.
  if (!phone && !fb.url) {
    warnings.push(
      "Phiếu chưa có số điện thoại lẫn link Facebook — chưa có cách liên hệ khách.",
    );
  } else if (!phone) {
    warnings.push("Phiếu chưa có số điện thoại — liên hệ qua link Facebook.");
  }

  // Dấu vết người nhập. Có mã NV thì tầng ingest còn dùng nó để tra người phụ
  // trách; chưa có mã thì ít nhất phải biết ai đã nhập, nếu không là mất dấu.
  if (staff.employeeCode) {
    noteLines.push(`Nhân viên nhập: ${staff.employeeCode}`);
  } else {
    noteLines.push(`Nhân viên nhập: ${staff.displayName} (chưa gắn mã nhân viên)`);
    warnings.push(
      "Tài khoản người nhập chưa gắn mã nhân viên — lead không tự giao cho người nhập được.",
    );
  }

  const note = str(input.note);
  if (note) noteLines.push(note);

  return {
    ok: true,
    lead: {
      parentName,
      phone,
      email: null,
      facebookUrl: fb.url,
      leadSource: str(input.source),
      centerHint: centerHintFromCode(input.centerCode),
      // Bộ ô mới không hỏi trường/lớp ⇒ `LeadChild` mang tên bé + khoá quan tâm.
      // Nguồn nào chỉ gửi `childName` (không gửi mảng) vẫn ra đúng một con.
      children:
        children.length > 0
          ? children
          : childName
            ? [{ fullName: childName, interestedCourseId: null }]
            : [],
      // ⭐ Danh tính đến từ phiên, không từ ô nhập.
      employeeCode: staff.employeeCode,
      noteLines,
      // Giữ đúng hành vi của phiếu Sale đang chạy (nhân viên nhập hộ khi tư vấn
      // trực tiếp, không có ô tick). Đổi giá trị này là đổi nghiệp vụ consent —
      // phải là một quyết định riêng, không kèm lén vào đây.
      consentMarketing: true,
      // Phiếu nội bộ không mang mã từ hệ ngoài ⇒ chống trùng dựa trên SĐT.
      externalId: null,
      warnings,
    },
  };
}
