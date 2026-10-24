// @vitest-environment node
/**
 * G-06 · MỐC CHỐT — con nào của một lượt chốt ghi danh được đóng mốc.
 *
 * Bộ này canh đúng một chỗ dễ nhầm: mốc chốt KHÁC đơn hàng. Đợt 3 đã chốt "một đơn –
 * một con" (quyết định B4) nên `inferLeadChildIdForConvert` trả `null` khi lượt chốt có
 * 2 con — tiền của một đơn chung không chia được cho hai đứa. Nhưng SỰ KIỆN "đứa này đã
 * thành học viên" thì KHÔNG mập mờ chút nào: chốt 2 con là 2 đứa cùng vào học.
 *
 * Bê nguyên luật của đơn hàng sang đây là im lặng bỏ mốc chốt của CẢ HAI đứa mỗi khi
 * một phụ huynh cho hai con vào học cùng lúc — và C-03 ("lead đã chuyển đổi", đếm theo
 * học sinh) sẽ thiếu người mà tổng doanh thu vẫn khớp, nên không ai truy ra.
 */
import { describe, expect, it } from "vitest";
import { CLOSED_CHILD_STATUS, resolveClosedLeadChildIds } from "@/lib/lead/close-mark";

describe("[G-06] resolveClosedLeadChildIds", () => {
  it("một con quy được → đóng mốc cho đúng con đó", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: "c1" }])).toEqual(["c1"]);
  });

  it("HAI con cùng lượt chốt → đóng mốc cho CẢ HAI (khác luật một-đơn-một-con)", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: "c1" }, { leadChildId: "c2" }])).toEqual([
      "c1",
      "c2",
    ]);
  });

  it("học viên không gắn con nào → bỏ qua, không đoán", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: null }, { leadChildId: undefined }, {}])).toEqual(
      [],
    );
  });

  it("trộn: chỉ con quy được mới có mốc", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: null }, { leadChildId: "c9" }])).toEqual(["c9"]);
  });

  it("chuỗi rỗng / chỉ khoảng trắng KHÔNG phải một mã con", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: "" }, { leadChildId: "   " }])).toEqual([]);
  });

  it("cắt khoảng trắng thừa quanh mã", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: "  c1  " }])).toEqual(["c1"]);
  });

  it("cùng một con gửi hai lần → chỉ một mã (updateMany không cần trùng)", () => {
    expect(resolveClosedLeadChildIds([{ leadChildId: "c1" }, { leadChildId: "c1" }])).toEqual(["c1"]);
  });

  it("danh sách rỗng → mảng rỗng, không ném", () => {
    expect(resolveClosedLeadChildIds([])).toEqual([]);
  });

  it("trạng thái 'đã chốt' đúng bằng giá trị enum B2 quy định", () => {
    // Quyết định B2 (24/08/2026): "đã chốt" = đã ghi danh thành học viên
    // ⇒ `LeadChildStatus.ENROLLED`. Đổi hằng này là đổi định nghĩa của C-02/C-03.
    expect(CLOSED_CHILD_STATUS).toBe("ENROLLED");
  });
});
