/**
 * "LEAD CỦA TÔI" — hai vế (mệnh đề Prisma cho cửa ĐỌC, hàm thuần cho cửa GHI) phải nói
 * CÙNG một điều.
 *
 * Chốt 17/09/2026: Sale chỉ thêm được học viên thuộc lead của mình vào lớp trải nghiệm.
 * Lọc ở ô tìm là gợi ý; cửa ghi (`enrollLeadChildLopTrialAction`) mới là cổng. Hai chỗ
 * lệch nhau thì cổng hẹp hơn là cổng không ai đi.
 */
import { describe, expect, it } from "vitest";
import { laLeadCuaToi, leadCuaToiOrClause } from "./sharing";

const TOI = "u-sale-1";
const NGUOI_KHAC = "u-sale-2";

function lead(over: Partial<Parameters<typeof laLeadCuaToi>[0]> = {}) {
  return { assignedToId: null, createdById: null, isSharedWithTeam: false, ...over };
}

describe("laLeadCuaToi — cửa GHI", () => {
  it("được GIAO cho tôi ⇒ của tôi (Sale cơ sở)", () => {
    expect(laLeadCuaToi(lead({ assignedToId: TOI }), TOI)).toBe(true);
  });

  // ⭐ Vế dễ quên nhất. Sale Hội sở nhập phiếu rồi phiếu tự chia về cơ sở, nên họ KHÔNG
  // BAO GIỜ là assignee — bỏ vế này thì họ không xếp được học viên nào của chính mình.
  it("do tôi NHẬP ⇒ của tôi (Sale Hội sở, không bao giờ là assignee)", () => {
    expect(laLeadCuaToi(lead({ createdById: TOI }), TOI)).toBe(true);
  });

  it("của người khác ⇒ KHÔNG phải của tôi", () => {
    expect(laLeadCuaToi(lead({ assignedToId: NGUOI_KHAC, createdById: NGUOI_KHAC }), TOI)).toBe(
      false,
    );
  });

  it("lead trống chủ ⇒ KHÔNG phải của tôi (fail-closed, không suy diễn)", () => {
    expect(laLeadCuaToi(lead(), TOI)).toBe(false);
  });
});

describe("leadCuaToiOrClause — cửa ĐỌC, cùng định nghĩa với cửa GHI", () => {
  it("luôn có đủ hai vế assignedToId + createdById", () => {
    const ors = leadCuaToiOrClause(TOI);
    expect(ors).toEqual(
      expect.arrayContaining([{ assignedToId: TOI }, { createdById: TOI }]),
    );
  });

  // Đây là ca giữ cho hai vế không trôi lệch: mọi nhánh mà mệnh đề ĐỌC chấp nhận thì hàm
  // thuần của cửa GHI cũng phải chấp nhận. Thêm một vế vào một bên mà quên bên kia ⇒ ĐỎ.
  it("mọi nhánh của mệnh đề ĐỌC đều được cửa GHI chấp nhận", () => {
    for (const nhanh of leadCuaToiOrClause(TOI)) {
      expect(laLeadCuaToi(lead(nhanh as Record<string, unknown>), TOI), JSON.stringify(nhanh)).toBe(
        true,
      );
    }
  });
});
