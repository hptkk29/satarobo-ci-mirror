/**
 * Nhãn NƠI QUÉT — D1, 10/09/2026.
 *
 * Cổng này không CHẶN gì, nhưng luật 16 vẫn áp: nửa "IM LẶNG khi không có gì để nói" phải
 * có ca riêng. Không có nó thì một bản vá in nhãn cho MỌI dòng vẫn xanh, và bảng công ngày
 * đầy chữ thừa.
 */
import { describe, expect, it } from "vitest";

import { nhanNoiQuet, noiQuetKhacNoiChiuCong } from "./noi-quet";

const HO = "hoi-so";
const CS1 = "id-cs1";
const CS2 = "id-cs2";
const MA = new Map([
  [HO, "HO"],
  [CS1, "CS1"],
  [CS2, "CS2"],
]);

describe("noiQuetKhacNoiChiuCong", () => {
  // ── nửa IM LẶNG (luật 16) ───────────────────────────────────────────────────
  it("mọi lượt ở ĐÚNG nơi chịu công ⇒ rỗng, nhãn im lặng", () => {
    const ds = noiQuetKhacNoiChiuCong([{ centerId: CS1 }, { centerId: CS1 }], CS1, MA);
    expect(ds).toEqual([]);
    expect(nhanNoiQuet(ds)).toBe("");
  });

  it("KHÔNG lượt nào ⇒ rỗng, không nổ", () => {
    expect(noiQuetKhacNoiChiuCong([], CS1, MA)).toEqual([]);
    expect(nhanNoiQuet([])).toBe("");
  });

  // ── ca thật đo được trên prod 10/09 ─────────────────────────────────────────
  it("người Hội sở quét ở CS2 ⇒ nhãn nói ĐÚNG TÊN, không phải 'nơi khác'", () => {
    // Ngày công vẫn thuộc HO; lượt quét mang CS2. Đây là dòng thật trên prod
    // (Hoàng Phan Tuấn Kiệt, 10/09 08:39, mã ca HC, không cờ nào).
    const ds = noiQuetKhacNoiChiuCong([{ centerId: CS2 }], HO, MA);
    expect(ds).toEqual(["CS2"]);
    expect(nhanNoiQuet(ds)).toBe(" · quét ở CS2");
  });

  it("nhân viên CS1 sang CS2 học nội bộ ⇒ nói ra nơi, KHÔNG dùng chữ phán xét", () => {
    const nhan = nhanNoiQuet(noiQuetKhacNoiChiuCong([{ centerId: CS2 }], CS1, MA));
    expect(nhan).toContain("CS2");
    for (const cam of ["khác", "lạ", "sai", "bất thường"]) {
      expect(nhan, `nhãn không được mang chữ "${cam}"`).not.toContain(cam);
    }
  });

  // ── check-in một nơi, check-out nơi khác ────────────────────────────────────
  it("check in CS1, check out CS2 ⇒ liệt kê CẢ HAI nơi khác nơi chịu công", () => {
    // Hợp lệ theo chốt 10/09. Ngày chịu công là HO, cả hai lượt đều ở nơi khác.
    const ds = noiQuetKhacNoiChiuCong([{ centerId: CS1 }, { centerId: CS2 }], HO, MA);
    expect(ds).toEqual(["CS1", "CS2"]);
    expect(nhanNoiQuet(ds)).toBe(" · quét ở CS1, CS2");
  });

  it("một nơi lặp nhiều lượt ⇒ chỉ kể MỘT lần", () => {
    const ds = noiQuetKhacNoiChiuCong(
      [{ centerId: CS2 }, { centerId: CS2 }, { centerId: CS2 }],
      CS1,
      MA,
    );
    expect(ds).toEqual(["CS2"]);
  });

  it("giữ THỨ TỰ xuất hiện, không sắp lại", () => {
    // Thứ tự lượt quét là thứ tự thời gian; đảo nó là kể sai câu chuyện của ngày.
    expect(noiQuetKhacNoiChiuCong([{ centerId: CS2 }, { centerId: CS1 }], HO, MA)).toEqual([
      "CS2",
      "CS1",
    ]);
  });

  // ── id lạ ───────────────────────────────────────────────────────────────────
  it("centerId không có trong bản đồ ⇒ BỎ QUA, không in id trần", () => {
    // In một cuid vào ô bảng là rác với người đọc; nhãn nói sai tệ hơn nhãn không nói.
    const ds = noiQuetKhacNoiChiuCong([{ centerId: "id-la-hoac" }, { centerId: CS2 }], HO, MA);
    expect(ds).toEqual(["CS2"]);
  });

  it("CHỈ có id lạ ⇒ nhãn im lặng chứ không in chuỗi rỗng thừa", () => {
    expect(nhanNoiQuet(noiQuetKhacNoiChiuCong([{ centerId: "?" }], HO, MA))).toBe("");
  });
});
