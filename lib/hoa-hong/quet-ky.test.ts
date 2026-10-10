// @vitest-environment node
/**
 * [NHH-PER-10g] — chọn phần được quét khi đối soát nền bị CẮT theo `gioiHan` (04 §12.1 Q5). THUẦN.
 *
 * Lỗi đo 08/10 (rà độc lập): `sap.slice(0, gioiHan)` trên danh sách sắp theo ngày thu tăng dần — mỗi tuần cắt CÙNG một đầu, nên khoản mới hơn vị trí `gioiHan` không bao giờ được đối soát.
 * Comment của cron hứa "lượt sau quét tiếp phần còn lại"; mã không làm vậy, và `[NHH-PER-10c]` chỉ khẳng định "cắt thì báo", không khẳng định "lượt sau phủ phần bị cắt".
 */
import { describe, it, expect } from "vitest";

import { chonKhoanKhiBiCat } from "./quet-ky";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, "0")}`); // đã sắp (paidDate, id)

describe("[NHH-PER-10g] chonKhoanKhiBiCat", () => {
  it("không cắt oan: gioiHan ≥ số khoản ⇒ chọn đủ, đúng thứ tự (paidDate, id)", () => {
    const sap = ids(5);
    expect(chonKhoanKhiBiCat(sap, new Set(), new Map(sap.map((id) => [id, 1])), 5)).toEqual(sap);
  });

  it("khoản CÓ TÍN HIỆU (hàng chờ · rời thực thu · đầu vào đổi) luôn vào trước khoản chỉ có mặt vì cửa sổ Q5, dù khoản kia cũ hơn", () => {
    const sap = ids(6);
    const tuoi = new Map(sap.map((id, i) => [id, 100 - i])); // p005 cũ nhất... nhưng p002 có tín hiệu
    const r = chonKhoanKhiBiCat(sap, new Set(["p002", "p003"]), tuoi, 3);
    expect(r).toContain("p002");
    expect(r).toContain("p003");
    expect(r).toHaveLength(3);
    expect(r).toContain("p005"); // chỗ còn lại thuộc khoản CŨ NHẤT trong phần Q5 (tuổi = 95)
  });

  it("khoản CHƯA TỪNG so (không có mốc) được coi là cũ nhất", () => {
    const sap = ids(4);
    const r = chonKhoanKhiBiCat(sap, new Set(), new Map([["p000", 50], ["p001", 40], ["p002", 30]]), 1); // p003 không có mốc
    expect(r).toEqual(["p003"]);
  });

  it("thứ tự TRẢ VỀ vẫn là (paidDate, id) của `sap` — khoản gốc đứng trước khoản hoàn của nó", () => {
    const sap = ["gốc", "hoàn", "khác"];
    const r = chonKhoanKhiBiCat(sap, new Set(), new Map([["gốc", 5], ["hoàn", 9], ["khác", 1]]), 2); // xếp hạng theo tuổi: khác (1), gốc (5) — "hoàn" mới nhất bị bỏ
    expect(r).toEqual(["gốc", "khác"]); // KHÔNG phải ["khác", "gốc"]: kết quả giữ thứ tự (paidDate, id) của `sap`
  });

  it("PHỦ HẾT sau ⌈N / gioiHan⌉ lượt: mô phỏng đối soát hằng tuần, mỗi lượt so xong thì mốc của khoản được cập nhật", () => {
    const sap = ids(23);
    const gioiHan = 5;
    const tuoi = new Map(sap.map((id) => [id, 0])); // chưa khoản nào được so
    const daQuet = new Set<string>();
    const soLuot = Math.ceil(sap.length / gioiHan);
    for (let tuan = 1; tuan <= soLuot; tuan++) {
      const chon = chonKhoanKhiBiCat(sap, new Set(), tuoi, gioiHan);
      expect(chon).toHaveLength(Math.min(gioiHan, sap.length));
      for (const id of chon) {
        daQuet.add(id);
        tuoi.set(id, tuan); // `lastCheckedAt` mới
      }
    }
    expect([...daQuet].sort()).toEqual(sap); // không khoản nào bị bỏ đói
  });
});
