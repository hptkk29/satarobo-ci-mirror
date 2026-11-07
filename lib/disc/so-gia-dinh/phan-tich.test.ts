import { describe, expect, it } from "vitest";

import { chupBonNguoi, nhaBonNguoi } from "./fixture";
import { dungBanChup, laBanChupHopLe, moiTheChieu, soLatCat, theChieu } from "./phan-tich";

describe("phân tích cả nhà + thẻ cặp hai chiều (doc 18, mục 3–4)", () => {
  const chup = chupBonNguoi();

  it("[SG-PT-01] n người ⇒ đúng n × (n − 1) thẻ chiều (4 người ⇒ 12; 2 ⇒ 2; 6 ⇒ 30)", () => {
    expect(moiTheChieu(chup)).toHaveLength(12);
    expect(soLatCat(chup)).toBe(12);
    const hai = dungBanChup(nhaBonNguoi().slice(0, 2));
    expect(hai.ok && moiTheChieu(hai.chup).length).toBe(2);
    const sau = Array.from({ length: 6 }, (_, i) => ({ ...nhaBonNguoi()[i % 4]!, id: `n${i}`, ten: `N${i}` }));
    const r6 = dungBanChup(sau);
    expect(r6.ok && moiTheChieu(r6.chup).length).toBe(30);
  });

  it("[SG-PT-02] ít hơn 2 người hoặc quá 6 người ⇒ không phân tích, trả lý do (không sinh thư mục rỗng)", () => {
    expect(dungBanChup(nhaBonNguoi().slice(0, 1))).toEqual({ ok: false, lyDo: "CHUA_DU_HAI_NGUOI" });
    expect(dungBanChup([])).toEqual({ ok: false, lyDo: "CHUA_DU_HAI_NGUOI" });
    const bay = Array.from({ length: 7 }, (_, i) => ({ ...nhaBonNguoi()[i % 4]!, id: `n${i}`, ten: `N${i}` }));
    expect(dungBanChup(bay)).toEqual({ ok: false, lyDo: "QUA_NHIEU_NGUOI" });
  });

  it("[SG-PT-03] A→B khác B→A: hướng ngược nhau (cùng chỗ vênh, hai chiều đọc)", () => {
    const ab = theChieu(chup, "bo", "me")!;
    const ba = theChieu(chup, "me", "bo")!;
    expect(ab.lech.length).toBeGreaterThan(0);
    expect(ba.lech.length).toBeGreaterThan(0);
    const huongAB = new Map(ab.lech.map((k) => [k.truc, k.huong]));
    for (const k of ba.lech) {
      const h = huongAB.get(k.truc);
      if (h) expect(h).not.toBe(k.huong);
    }
    expect(ab.lech[0]!.veToi).not.toBe(ba.lech[0]!.veToi);
  });

  it("[SG-PT-04] thế quyền: người lớn → trẻ · trẻ → người lớn · ngang vai", () => {
    expect(theChieu(chup, "bo", "con")!.theQuyen).toBe("nguoi-lon-voi-tre");
    expect(theChieu(chup, "con", "bo")!.theQuyen).toBe("tre-voi-nguoi-lon");
    expect(theChieu(chup, "bo", "me")!.theQuyen).toBe("ngang-vai");
    expect(theChieu(chup, "con", "be")!.theQuyen).toBe("ngang-vai");
  });

  it("[SG-PT-05] chữ đã thay đại từ: không còn dấu {…} và có tên người kia; trẻ đọc xưng «em»", () => {
    for (const t of moiTheChieu(chup)) {
      for (const k of t.lech) {
        for (const chu of [k.veToi, k.veNguoiKia, k.viecCuaToi, k.thoaThuan]) expect(chu).not.toMatch(/\{[A-Za-z]+\}/);
      }
      for (const k of t.trungKhop) expect(k.chu).not.toMatch(/\{[A-Za-z]+\}/);
    }
    const treDoc = theChieu(chup, "con", "bo")!;
    expect(treDoc.lech.some((k) => k.veToi.includes("Người lớn 1") || k.veNguoiKia.includes("Người lớn 1") || k.viecCuaToi.includes("Người lớn 1"))).toBe(true);
  });

  it("[SG-PT-06] hai người trùng khớp cả 4 trục ⇒ thẻ có khối «trùng khớp», KHÔNG để trống", () => {
    const giong = { D: 50, I: 50, S: 50, C: 50 };
    const r = dungBanChup([
      { ...nhaBonNguoi()[0]!, id: "a", ten: "A", diem: giong },
      { ...nhaBonNguoi()[1]!, id: "b", ten: "B", diem: giong },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const t = theChieu(r.chup, "a", "b")!;
    expect(t.lech).toHaveLength(0);
    expect(t.trungKhop).toHaveLength(4);
    expect(t.trungKhop.every((k) => k.chu.length > 0)).toBe(true);
  });

  it("[SG-PT-07] khác phiên bản bộ đề ⇒ vẫn ghép được nhưng gắn cờ «đo bằng hai phiên bản»; hồ sơ ước lượng được đánh dấu", () => {
    const t = theChieu(chup, "bo", "con")!; // 1.1 vs nh:nh1
    expect(t.khacPhienBan).toBe(true);
    expect(theChieu(chup, "con", "be")!.khacPhienBan).toBe(false); // cùng nh:nh1
    expect(theChieu(chup, "bo", "be")!.kiaUocLuong).toBe(true);
    expect(theChieu(chup, "be", "bo")!.toiUocLuong).toBe(true);
    expect(theChieu(chup, "bo", "me")!.kiaUocLuong).toBe(false);
  });

  it("[SG-PT-08] người lạ / chính mình ⇒ null", () => {
    expect(theChieu(chup, "bo", "bo")).toBeNull();
    expect(theChieu(chup, "bo", "khong-co")).toBeNull();
    expect(theChieu(chup, "khong-co", "bo")).toBeNull();
  });

  it("[SG-PT-09] bản chụp lưu tên LÚC CHẠY; qua JSON vẫn hợp lệ; hình dạng hỏng bị từ chối", () => {
    const vong = JSON.parse(JSON.stringify(chup)) as unknown;
    expect(laBanChupHopLe(vong)).toBe(true);
    expect(laBanChupHopLe(null)).toBe(false);
    expect(laBanChupHopLe({ v: 2, nguoi: [], ban: [] })).toBe(false);
    expect(laBanChupHopLe({ ...(vong as object), nguoi: [{ id: 1 }, { id: 2 }] })).toBe(false);
    expect(chup.nguoi.map((n) => n.ten)).toContain("Người lớn 1");
  });
});
