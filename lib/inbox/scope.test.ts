// @vitest-environment node
/**
 * CÁCH LY ĐƠN VỊ CỦA HỘP THƯ — lưới bảo vệ THAY CHO `scopedDb`.
 *
 * Bộ test này quan trọng hơn bình thường vì ở đây KHÔNG có lưới tự động: ba bảng
 * `Inbox*` mang `orgUnitId` chứ không mang `centerId`, mà `scopedDb` chỉ lọc
 * `centerId`. Viết sai ở đây thì hội thoại của cơ sở này hiện cho cơ sở kia, và
 * không có gì báo — màn hình vẫn đầy dữ liệu, chỉ là dữ liệu của người khác.
 */
import { describe, it, expect } from "vitest";
import type { Actor } from "@/lib/auth/actor";
import { inboxOrgScopeWhere, passesInboxScope, nhinXuyenDonVi } from "@/lib/inbox/scope";

function actor(patch: Partial<Actor>): Actor {
  return {
    userId: "u1",
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: [],
    visibleOrgUnitIds: [],
    grantsAllow: new Set(),
    assignedClassIds: new Set(),
    ...patch,
  } as Actor;
}

const CS1 = actor({ visibleOrgUnitIds: ["ou-cs1"] });
const CS2 = actor({ visibleOrgUnitIds: ["ou-cs2"] });
const HO = actor({ isHoLevel: true, visibleOrgUnitIds: ["ou-ho", "ou-cs1", "ou-cs2"] });
const SUPER = actor({ isSuperAdmin: true });

describe("nhìn xuyên đơn vị", () => {
  it("HO và quản trị tối cao thấy tất cả ⇒ where rỗng", () => {
    expect(nhinXuyenDonVi(HO)).toBe(true);
    expect(nhinXuyenDonVi(SUPER)).toBe(true);
    expect(inboxOrgScopeWhere(HO)).toEqual({});
    expect(inboxOrgScopeWhere(SUPER)).toEqual({});
  });

  it("người cấp cơ sở KHÔNG nhìn xuyên", () => {
    expect(nhinXuyenDonVi(CS1)).toBe(false);
  });
});

describe("where của người cấp cơ sở", () => {
  it("chỉ đơn vị mình + nhóm chưa gán đơn vị", () => {
    expect(inboxOrgScopeWhere(CS1)).toEqual({
      OR: [{ orgUnitId: { in: ["ou-cs1"] } }, { orgUnitId: null }],
    });
  });

  it("KHÔNG có đơn vị nào ⇒ `in: []`, không phải bỏ trống điều kiện", () => {
    // Bỏ trống điều kiện khi danh sách rỗng là lỗi kinh điển: nó biến "không thấy
    // gì" thành "thấy tất cả". `{ in: [] }` khớp 0 dòng — đúng ý.
    const w = inboxOrgScopeWhere(actor({}));
    expect(w).toEqual({ OR: [{ orgUnitId: { in: [] } }, { orgUnitId: null }] });
    expect(w).not.toEqual({});
  });

  it("`visibleOrgUnitIds` thiếu (Actor dựng tay) ⇒ vẫn ra `in: []`, không nổ", () => {
    // ~35 chỗ trong repo dựng Actor literal thiếu field. Nổ ở đây là làm chết cả
    // trang vì một chuyện đáng ra chỉ là "không thấy gì".
    const thieu = { ...actor({}) } as Actor;
    delete (thieu as { visibleOrgUnitIds?: string[] }).visibleOrgUnitIds;
    expect(inboxOrgScopeWhere(thieu)).toEqual({
      OR: [{ orgUnitId: { in: [] } }, { orgUnitId: null }],
    });
  });
});

describe("passesInboxScope — cổng GHI (where chỉ che đường đọc)", () => {
  it("CS1 KHÔNG đụng được dòng của CS2", () => {
    expect(passesInboxScope(CS1, { orgUnitId: "ou-cs2" })).toBe(false);
    expect(passesInboxScope(CS2, { orgUnitId: "ou-cs1" })).toBe(false);
  });

  it("CS1 đụng được dòng của chính mình", () => {
    expect(passesInboxScope(CS1, { orgUnitId: "ou-cs1" })).toBe(true);
  });

  it("dòng mồ côi (orgUnitId null) ai cũng xử lý được", () => {
    // Đây là chủ đích, không phải lỗ: hội thoại chưa nối được cơ sở nào mà không
    // ai đụng vào được thì nó nằm đó mãi và khách không được trả lời.
    expect(passesInboxScope(CS1, { orgUnitId: null })).toBe(true);
    expect(passesInboxScope(CS2, { orgUnitId: null })).toBe(true);
  });

  it("HO và quản trị tối cao đụng được mọi dòng", () => {
    expect(passesInboxScope(HO, { orgUnitId: "ou-cs2" })).toBe(true);
    expect(passesInboxScope(SUPER, { orgUnitId: "ou-cs2" })).toBe(true);
  });

  it("dòng không tồn tại ⇒ false (fail-closed), kể cả với quản trị tối cao", () => {
    // `findFirst` trả null rồi code cứ chạy tiếp là lỗi phổ biến; chặn ở đây thì
    // chỗ gọi không cần nhớ.
    expect(passesInboxScope(SUPER, null)).toBe(false);
    expect(passesInboxScope(CS1, undefined)).toBe(false);
  });
});
