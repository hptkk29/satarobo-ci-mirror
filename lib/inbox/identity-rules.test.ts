// @vitest-environment node
/**
 * NỐI DANH TÍNH NGOÀI ↔ LEAD — luật quyết định, tách khỏi DB để test được thật.
 *
 * Đây là chỗ một lỗi đắt và im lặng: nối nhầm thì hội thoại của khách A nằm trong
 * hồ sơ khách B. Không có thông báo lỗi nào; nó lộ ra lúc Sale gọi cho nhầm người.
 *
 * Nên luật ở đây nghiêng hẳn về MỒ CÔI: thà để người bấm tay còn hơn đoán.
 */
import { describe, it, expect } from "vitest";
import { dieuKienDonViLead, quyetDinhNoiTheoSdt } from "@/lib/inbox/identity-rules";

describe("không có SĐT ⇒ mồ côi (đây là ca THƯỜNG GẶP NHẤT)", () => {
  it("webhook Zalo `user_send_text` không kèm SĐT ⇒ KHONG_CO_SDT", () => {
    // Ràng buộc nền tảng, không sửa bằng code được: `user_id` chỉ có nghĩa trong
    // phạm vi một OA và payload tin nhắn KHÔNG BAO GIỜ chứa số điện thoại. Đường
    // duy nhất lấy SĐT là khách tự bấm "Chia sẻ thông tin" (`user_submit_info`).
    expect(quyetDinhNoiTheoSdt(null, [])).toEqual({ noi: false, lyDo: "KHONG_CO_SDT" });
    expect(quyetDinhNoiTheoSdt(undefined, [])).toEqual({ noi: false, lyDo: "KHONG_CO_SDT" });
    expect(quyetDinhNoiTheoSdt("", [])).toEqual({ noi: false, lyDo: "KHONG_CO_SDT" });
  });

  it("chuỗi không phải SĐT VN ⇒ KHONG_CO_SDT, không thử tra", () => {
    expect(quyetDinhNoiTheoSdt("chào anh", [{ id: "l1" }])).toEqual({
      noi: false,
      lyDo: "KHONG_CO_SDT",
    });
  });
});

describe("khớp SĐT", () => {
  it("đúng MỘT lead khớp ⇒ nối, nguồn PHONE_MATCH", () => {
    expect(quyetDinhNoiTheoSdt("0905123456", [{ id: "lead-1" }])).toEqual({
      noi: true,
      leadId: "lead-1",
      source: "PHONE_MATCH",
    });
  });

  it("không lead nào khớp ⇒ mồ côi, KHÔNG tạo lead mới", () => {
    // Tự tạo lead từ một tin nhắn "alo" là cách nhanh nhất để đổ rác vào phễu và
    // làm hỏng mọi chỉ số chuyển đổi. Tạo lead là việc của người, có nút riêng.
    expect(quyetDinhNoiTheoSdt("0905123456", [])).toEqual({
      noi: false,
      lyDo: "KHONG_KHOP_LEAD",
    });
  });

  it("NHIỀU lead khớp ⇒ KHÔNG đoán, để người chọn", () => {
    // DB còn tồn tại cả hai định dạng SĐT (`0…` và `84…`, đo 03/08: 99 và 8 bản),
    // và một số điện thoại có thể ứng với nhiều phiếu (hai con, hai lần đăng ký).
    // Lấy "cái đầu tiên" là nối bừa và không ai biết đã nối bừa.
    expect(
      quyetDinhNoiTheoSdt("0905123456", [{ id: "lead-1" }, { id: "lead-2" }]),
    ).toEqual({ noi: false, lyDo: "NHIEU_LEAD_KHOP" });
  });
});

describe("🔴 lọc ứng viên theo ĐƠN VỊ — không nối sang phiếu của cơ sở khác", () => {
  // Lỗi B2 của bản kiểm: `timLeadTheoSdt` tra `db.lead` KHÔNG giới hạn cơ sở. Một số
  // điện thoại trùng giữa hai cơ sở (anh em ruột, phụ huynh chuyển cơ sở, số công ty)
  // là đủ để hội thoại của CS1 chui vào hồ sơ của CS2 — và nó im lặng: hai bên đều
  // thấy màn hình bình thường, chỉ là dữ liệu của người khác.

  it("chưa biết đơn vị (`undefined`/`null`) ⇒ KHÔNG lọc — thà tra rộng còn hơn không nối được gì", () => {
    // Webhook tin đầu tiên của người lạ chưa biết cơ sở nào. Lọc bừa ở đây là biến
    // "chưa biết" thành "không khớp phiếu nào" cho MỌI hội thoại mới.
    expect(dieuKienDonViLead(undefined)).toEqual({});
    expect(dieuKienDonViLead(null)).toEqual({});
    expect(dieuKienDonViLead("   ")).toEqual({});
  });

  it("biết đơn vị ⇒ chỉ phiếu CÙNG đơn vị, CỘNG phiếu chưa có đơn vị", () => {
    // Phiếu `orgUnitId = null` là phiếu cũ/chưa gán cơ sở — vẫn phải nối được, nếu
    // không thì đúng những phiếu tồn đọng lâu nhất là những phiếu không bao giờ khớp.
    expect(dieuKienDonViLead("ou-cs1")).toEqual({
      OR: [{ orgUnitId: "ou-cs1" }, { orgUnitId: null }],
    });
  });
});

describe("chuẩn hoá SĐT — theo canonical của repo, KHÔNG phải E.164", () => {
  it("`84…`, `0…`, có dấu cách đều ra cùng một quyết định", () => {
    // ⚠️ Repo CỐ Ý dùng `84XXXXXXXXX` KHÔNG có dấu `+` (`lib/phone.ts:10-13`):
    // khớp payload ZNS, và dấu `+` bị Excel hiểu là công thức. Tài liệu nào ghi
    // "E.164" là ghi sai — sửa theo đó sẽ phá `phoneVariants` và mọi tra cứu SĐT.
    const uv = [{ id: "lead-1" }];
    for (const p of ["0905123456", "84905123456", " 090 512 3456 "]) {
      expect(quyetDinhNoiTheoSdt(p, uv), p).toEqual({
        noi: true,
        leadId: "lead-1",
        source: "PHONE_MATCH",
      });
    }
  });
});
