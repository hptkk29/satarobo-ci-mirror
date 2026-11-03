// @vitest-environment node
/**
 * [NHH-DSP-02] — QUAN HỆ giữa người khiếu nại và khoản thu "không có dòng của mình" (05 §1.2 `coTheKhieuNaiKhoanThu`, vế (b), H11). THUẦN.
 *
 * Ca nguy hiểm nhất của hàm này không phải "người lạ được vào" mà là `null === null`: lead có `adminId = null` còn người khiếu nại cũng
 * "không có id" thì phép so lỏng khớp. Ca `[NHH-DSP-02q-null]` ghim điều đó — cùng họ bài học `[GTD-04]` (CLAUDE.md).
 */
import { describe, it, expect } from "vitest";

import { quanHeVoiKhoan, type NguCanhQuanHe } from "./khieu-nai-quan-he";

const rong: NguCanhQuanHe = {
  lead: { convertedById: null, adminId: null, assignedToId: null },
  referrerParentUserId: null,
  referrerEmployeeUserId: null,
  gvTrialUserId: null,
};

describe("[NHH-DSP-02q] quanHeVoiKhoan", () => {
  it("chủ lead: người chốt (convertedById), Sale Admin (adminId), người được giao (assignedToId) — mỗi cái đều tính", () => {
    expect(quanHeVoiKhoan("u1", { ...rong, lead: { ...rong.lead!, convertedById: "u1" } })).toEqual(["CHU_LEAD"]);
    expect(quanHeVoiKhoan("u1", { ...rong, lead: { ...rong.lead!, adminId: "u1" } })).toEqual(["CHU_LEAD"]);
    expect(quanHeVoiKhoan("u1", { ...rong, lead: { ...rong.lead!, assignedToId: "u1" } })).toEqual(["CHU_LEAD"]);
  });

  it("người giới thiệu trên nguồn: phụ huynh (User) hoặc nhân sự (đã đổi sang User.id)", () => {
    expect(quanHeVoiKhoan("u1", { ...rong, referrerParentUserId: "u1" })).toEqual(["NGUOI_GIOI_THIEU"]);
    expect(quanHeVoiKhoan("u1", { ...rong, referrerEmployeeUserId: "u1" })).toEqual(["NGUOI_GIOI_THIEU"]);
  });

  it("GV dạy buổi trial của bé", () => {
    expect(quanHeVoiKhoan("u1", { ...rong, gvTrialUserId: "u1" })).toEqual(["GV_TRIAL"]);
  });

  it("nhiều quan hệ cùng lúc ⇒ liệt kê đủ, không trùng, theo thứ tự cố định", () => {
    const c: NguCanhQuanHe = { lead: { convertedById: "u1", adminId: "u1", assignedToId: null }, referrerParentUserId: null, referrerEmployeeUserId: "u1", gvTrialUserId: "u1" };
    expect(quanHeVoiKhoan("u1", c)).toEqual(["CHU_LEAD", "NGUOI_GIOI_THIEU", "GV_TRIAL"]);
  });

  it("người lạ (id khác ở mọi chỗ) ⇒ không quan hệ nào — đối chứng của các ca trên", () => {
    const c: NguCanhQuanHe = { lead: { convertedById: "a", adminId: "b", assignedToId: "c" }, referrerParentUserId: "d", referrerEmployeeUserId: "e", gvTrialUserId: "f" };
    expect(quanHeVoiKhoan("u1", c)).toEqual([]);
  });

  it("[NHH-DSP-02q-null] id rỗng / trường null KHÔNG bao giờ khớp nhau — chuỗi rỗng không phải 'bất kỳ ai'", () => {
    expect(quanHeVoiKhoan("", rong)).toEqual([]);
    expect(quanHeVoiKhoan("", { ...rong, lead: { convertedById: "", adminId: "", assignedToId: "" }, referrerParentUserId: "", gvTrialUserId: "" })).toEqual([]);
    expect(quanHeVoiKhoan("u1", rong)).toEqual([]);
  });

  it("đơn không lead (lead = null) vẫn xét được người giới thiệu / GV trial nếu có, nhưng không có 'chủ lead'", () => {
    expect(quanHeVoiKhoan("u1", { ...rong, lead: null, gvTrialUserId: "u1" })).toEqual(["GV_TRIAL"]);
    expect(quanHeVoiKhoan("u1", { ...rong, lead: null })).toEqual([]);
  });
});
