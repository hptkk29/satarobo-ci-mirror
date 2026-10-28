// [CTL-*] — luật THUẦN của "QLCS cấp thêm lượt học bù" (22/10/2026). Không đụng DB.
import { describe, expect, it } from "vitest";
import { LY_DO_TOI_THIEU } from "@/lib/hoc-bu/huy";
import { TOI_DA_LUOT_MOI_LAN, kiemCapThemLuot, lyDoCapThem, nguonCapThem } from "@/lib/hoc-bu/cap-them-luot";

const LY_DO = "Học vượt các buổi lớp đã dạy";
const MA = "a1b2c3d4-e5f6-4711-8899-aabbccddeeff";
const ok = (over: Partial<Parameters<typeof kiemCapThemLuot>[0]> = {}) => kiemCapThemLuot({ delta: 3, lyDo: LY_DO, maLanCap: MA, ...over });

describe("[CTL] cấp thêm lượt học bù — luật thuần", () => {
  it("[CTL-01] đầu vào hợp lệ ⇒ null; biên 1 và đúng trần đều qua", () => {
    expect(ok()).toBeNull();
    expect(ok({ delta: 1 })).toBeNull();
    expect(ok({ delta: TOI_DA_LUOT_MOI_LAN })).toBeNull();
    // chiều GIẢM (chủ dự án: "cấp được thì xoá lại được"): dấu âm hợp lệ, cùng trần
    expect(ok({ delta: -1 })).toBeNull();
    expect(ok({ delta: -TOI_DA_LUOT_MOI_LAN })).toBeNull();
  });

  it("[CTL-02] số lượt: 0, âm, thập phân, NaN, vượt trần đều bị từ chối (đối chứng với [CTL-01])", () => {
    for (const delta of [0, -0, 1.5, -1.5, Number.NaN, TOI_DA_LUOT_MOI_LAN + 1, -(TOI_DA_LUOT_MOI_LAN + 1), 1000, -1000]) expect(ok({ delta }), String(delta)).not.toBeNull();
    expect(ok({ delta: TOI_DA_LUOT_MOI_LAN + 1 })).toContain(String(TOI_DA_LUOT_MOI_LAN));
  });

  it("[CTL-03] lý do bắt buộc ≥ ngưỡng chung của module; khoảng trắng hai đầu không được tính", () => {
    expect(ok({ lyDo: "x".repeat(LY_DO_TOI_THIEU - 1) })).not.toBeNull();
    expect(ok({ lyDo: `   ${"x".repeat(LY_DO_TOI_THIEU - 1)}   ` })).not.toBeNull();
    expect(ok({ lyDo: "x".repeat(LY_DO_TOI_THIEU) })).toBeNull();
    expect(ok({ lyDo: "" })).not.toBeNull();
    // chiều giảm cũng đòi lý do, và câu từ chối nói đúng chiều
    expect(ok({ delta: -2, lyDo: "ngắn" })).toContain("giảm");
    expect(ok({ delta: 2, lyDo: "ngắn" })).toContain("cấp thêm");
  });

  it("[CTL-04] mã lần cấp: rỗng / quá ngắn / có ký tự lạ bị từ chối; UUID qua", () => {
    for (const maLanCap of ["", "abc", "a:b:c:d:e:f:g:h", "có dấu tiếng việt đây", "x".repeat(65), "a b c d e f g h"]) expect(ok({ maLanCap }), maLanCap).not.toBeNull();
    expect(ok({ maLanCap: MA })).toBeNull();
  });

  it("[CTL-05] khoá nguồn KHÔNG bao giờ bắt đầu bằng `don:` — `don-doi-db` thu hồi `ADJUSTMENT:don:*` khi đơn khoá học bị huỷ, lượt QLCS cấp tay không được đi theo đơn", () => {
    expect(nguonCapThem(MA).startsWith("don:")).toBe(false);
    expect(`ADJUSTMENT:${nguonCapThem(MA)}`.startsWith("ADJUSTMENT:don:")).toBe(false);
    // hai lần cấp khác nhau ⇒ hai khoá khác nhau (cộng dồn); cùng mã ⇒ cùng khoá (chống bấm đúp)
    expect(nguonCapThem("lan-cap-0001")).not.toBe(nguonCapThem("lan-cap-0002"));
    expect(nguonCapThem(MA)).toBe(nguonCapThem(MA));
  });

  it("[CTL-06] lý do ghi vào bút toán nói số lượt và nội dung đã cắt khoảng trắng", () => {
    expect(lyDoCapThem(3, `  ${LY_DO}  `)).toBe(`QLCS cấp thêm 3 lượt: ${LY_DO}`);
    expect(lyDoCapThem(-2, LY_DO)).toBe(`QLCS giảm 2 lượt: ${LY_DO}`);
  });
});
