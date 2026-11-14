// lib/finance/dong-don-ghi-danh.test.ts — `[DDG-*]` bất biến "tiền của một DÒNG ĐƠN vào GHI DANH của đúng học viên dòng đó".
// Fixture mang đúng hình dạng 3 đơn anh/chị/em phát hiện khi quét PROD 23–24/10/2026.
import { describe, it, expect } from "vitest";
import { CAU_CHEO_HOC_VIEN, dongLechGhiDanh, dongThieuHocVienTrongDonNhieuDong } from "./dong-don-ghi-danh";

const BE_A = "std-be-a";
const BE_B = "std-be-b";
const BE_C = "std-be-c";
const BE_D = "std-be-d";

describe("[DDG] dongLechGhiDanh", () => {
  it("[DDG-01] hai dòng nhận tiền vào ghi danh của nhau (bé A / bé B) ⇒ cả HAI bị bắt", () => {
    const lech = dongLechGhiDanh([
      { orderItemId: "dong-be-a", studentIdDong: BE_A, studentIdGhiDanh: BE_B },
      { orderItemId: "dong-be-b", studentIdDong: BE_B, studentIdGhiDanh: BE_A },
    ]);
    expect(lech.map((x) => x.orderItemId)).toEqual(["dong-be-a", "dong-be-b"]);
    expect(lech.every((x) => x.ma === "CHEO_HOC_VIEN")).toBe(true);
  });

  it("[DDG-02] sửa đúng (đổi lại) ⇒ không còn dòng lệch", () => {
    expect(
      dongLechGhiDanh([
        { orderItemId: "dong-be-a", studentIdDong: BE_A, studentIdGhiDanh: BE_A },
        { orderItemId: "dong-be-b", studentIdDong: BE_B, studentIdGhiDanh: BE_B },
      ]),
    ).toEqual([]);
  });

  it("[DDG-03] studentId của hai DÒNG chéo so với ghi danh (bé C↔bé D) cũng bị bắt", () => {
    const lech = dongLechGhiDanh([
      { orderItemId: "dong-0pct", studentIdDong: BE_C, studentIdGhiDanh: BE_D },
      { orderItemId: "dong-10pct", studentIdDong: BE_D, studentIdGhiDanh: BE_C },
    ]);
    expect(lech).toHaveLength(2);
  });

  it("[DDG-04] NULL ở MỘT phía là chưa biết — KHÔNG chặn (chặn nó là khoá mọi đơn đời cũ chưa gắn học viên)", () => {
    expect(
      dongLechGhiDanh([
        { orderItemId: "a", studentIdDong: null, studentIdGhiDanh: BE_B },
        { orderItemId: "b", studentIdDong: BE_A, studentIdGhiDanh: null },
        { orderItemId: "c", studentIdDong: null, studentIdGhiDanh: null },
      ]),
    ).toEqual([]);
  });

  it("[DDG-05] câu từ chối nói đúng nguyên nhân và chỉ đường", () => {
    expect(CAU_CHEO_HOC_VIEN).toMatch(/HAI học viên khác nhau/);
    expect(CAU_CHEO_HOC_VIEN).toMatch(/THIET-KE-SUA-GOC/);
  });
});

describe("[DDG] dongThieuHocVienTrongDonNhieuDong", () => {
  it("[DDG-10] đơn hai con — HAI dòng không có studentId ⇒ cả hai bị gắn cờ", () => {
    const r = dongThieuHocVienTrongDonNhieuDong([
      { orderId: "ORD-269900-000001", orderItemId: "dong-a", studentId: null },
      { orderId: "ORD-269900-000001", orderItemId: "dong-b", studentId: null },
    ]);
    expect(r.map((x) => x.orderItemId)).toEqual(["dong-a", "dong-b"]);
  });

  it("[DDG-11] đơn MỘT dòng thiếu studentId KHÔNG bị gắn cờ — tiền không thể của ai khác (khách vãng lai, đơn sản phẩm)", () => {
    expect(dongThieuHocVienTrongDonNhieuDong([{ orderId: "o1", orderItemId: "x", studentId: null }])).toEqual([]);
  });

  it("[DDG-12] đơn nhiều dòng, chỉ MỘT dòng thiếu ⇒ chỉ dòng đó (đơn sau khi tách)", () => {
    const r = dongThieuHocVienTrongDonNhieuDong([
      { orderId: "o7", orderItemId: "dong-be-c", studentId: BE_C },
      { orderId: "o7", orderItemId: "dong-trong", studentId: null },
    ]);
    expect(r).toEqual([{ orderId: "o7", orderItemId: "dong-trong" }]);
  });
});
