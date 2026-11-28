// Test THUẦN cho luật "ai được làm mới đồng hồ chăm sóc của một phiếu khách".
//
// ─────────────────────────────────────────────────────────────────────────────
// S-9 (27/08/2026) — chốt của chủ dự án: **chỉ chủ phiếu và cấp quản lý mới tắt
// được đồng hồ**. Người khác VẪN GHI CHÚ ĐƯỢC — ghi chú của họ chỉ không làm mới
// mốc SLA.
//
// Đây là một ĐẢO CHIỀU có chủ đích so với S-6 (đợt 1, cùng ngày): lần đó lỗ hổng
// "đồng nghiệp tắt hộ đồng hồ" được bịt bằng cách CẤM LUÔN việc ghi chú. Cách đó
// đóng được lỗ, nhưng đóng cả một việc hợp lệ: người trực máy, người nhận cuộc
// gọi nhỡ, Sale Hội sở đã nhập phiếu — họ vẫn cần ghi lại điều khách vừa nói,
// và ghi lại một câu nói thì không có gì nguy hiểm. Thứ nguy hiểm là cái HỆ QUẢ
// ĐI KÈM mà không ai nhìn thấy: dòng ghi chú làm mới `lastActivityAt` và đóng
// vĩnh viễn `firstContactAt`, tức tắt chuông SLA-3/SLA-4 trên phiếu người khác.
//
// Nên luật đúng là tách hai thứ đó ra, và đó là việc của hàm dưới đây.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { QUYEN_DIEU_PHOI_LEAD, duocLamMoiDongHoChamSoc } from "./sla-clock";

describe("[S-9] ai được làm mới đồng hồ chăm sóc", () => {
  it("chính người phụ trách phiếu → ĐƯỢC", () => {
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-sale-a",
        assignedToId: "u-sale-a",
        coQuyenDieuPhoi: false,
      }),
    ).toBe(true);
  });

  it("đồng nghiệp cùng cơ sở, không phụ trách, không quyền điều phối → KHÔNG", () => {
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-sale-a",
        assignedToId: "u-sale-b",
        coQuyenDieuPhoi: false,
      }),
    ).toBe(false);
  });

  it("cấp quản lý (có quyền điều phối lead) → ĐƯỢC, kể cả trên phiếu người khác", () => {
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-ql",
        assignedToId: "u-sale-b",
        coQuyenDieuPhoi: true,
      }),
    ).toBe(true);
  });

  it("phiếu CHƯA GIAO cho ai → chỉ cấp quản lý làm mới được", () => {
    // Phiếu chưa có người phụ trách thì không ai là "chủ phiếu". Cho người đầu
    // tiên đi ngang qua đóng mốc "đã liên hệ lần đầu" là tắt chuông của một
    // phiếu chưa ai gọi — đúng thứ SLA-3 sinh ra để kêu.
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-sale-a",
        assignedToId: null,
        coQuyenDieuPhoi: false,
      }),
    ).toBe(false);
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-ql",
        assignedToId: null,
        coQuyenDieuPhoi: true,
      }),
    ).toBe(true);
  });

  it("người NHẬP phiếu không tự động thành chủ đồng hồ", () => {
    // "Khách của tôi" (được XEM) rộng hơn "tôi phải gọi ai" (đồng hồ SLA). Phiếu
    // Sale Hội sở nhập được chia về Sale cơ sở; người phải gọi là Sale cơ sở,
    // nên mốc SLA của phiếu thuộc về người đó. Xem `lib/lead/ownership.ts`.
    expect(
      duocLamMoiDongHoChamSoc({
        userId: "u-ho",
        assignedToId: "u-sale-cs1",
        coQuyenDieuPhoi: false,
      }),
    ).toBe(false);
  });
});

describe("[S-9] quyền dùng để hỏi 'cấp quản lý' là quyền ĐIỀU PHỐI lead", () => {
  it("là `leads:assign`, không phải `leads:view-all`", () => {
    // `leads:view-all` là quyền ĐỌC và đang cấp cho cả Marketing — lấy nó làm
    // cửa tắt đồng hồ thì Marketing tắt được SLA của Sale. `leads:assign` mới
    // đúng nghĩa "người điều phối lead" (Quản lý cơ sở / Super Admin), và đã có
    // tiền lệ dùng đúng cách ở `toggleLeadShareAction`.
    expect(QUYEN_DIEU_PHOI_LEAD).toBe("leads:assign");
  });

  it("khoá quyết định ở MỘT hàm — không ai gõ lại điều kiện tại chỗ", () => {
    const s = fs
      .readFileSync("app/(admin)/admin/leads/actions.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(s).toContain("duocLamMoiDongHoChamSoc(");
    expect(s).toContain("QUYEN_DIEU_PHOI_LEAD");
  });
});
