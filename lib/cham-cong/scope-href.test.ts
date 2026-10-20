import { describe, it, expect } from "vitest";
import { hrefWith, monthStepDate, scopeHref, shiftKy } from "./scope-href";

// 14/08/2026 12:00 giờ VN — cố định để test không phụ thuộc đồng hồ máy chạy.
const NOW = new Date("2026-08-14T05:00:00.000Z");
const CTX = { ky: "2026-08", coSo: "cs1", date: "2026-08-14", now: NOW };

describe("hrefWith", () => {
  it("bỏ tham số rỗng / null / undefined", () => {
    expect(hrefWith("/cham-cong", { ky: "", coSo: null, date: undefined })).toBe("/cham-cong");
    expect(hrefWith("/cham-cong", { coSo: "  ", date: "2026-08-14" })).toBe("/cham-cong?date=2026-08-14");
  });

  it("giữ thứ tự ky → coSo → date rồi mới tới tham số khác", () => {
    expect(hrefWith("/don-tu", { status: "PENDING", date: "2026-08-14", coSo: "cs1", ky: "2026-08" })).toBe(
      "/don-tu?ky=2026-08&coSo=cs1&date=2026-08-14&status=PENDING",
    );
  });

  it("mã hoá giá trị và nhận số", () => {
    expect(hrefWith("/cham-cong", { coSo: "hoi so", q: "Nguyễn A" })).toBe(
      "/cham-cong?coSo=hoi%20so&q=Nguy%E1%BB%85n%20A",
    );
    expect(hrefWith("/cham-cong", { page: 2 })).toBe("/cham-cong?page=2");
  });
});

describe("scopeHref — 6 tab ModuleNav không làm rơi ngữ cảnh", () => {
  it("mỗi tab giữ đúng tham số nó dùng", () => {
    expect(scopeHref("/cham-cong", CTX)).toBe("/cham-cong?coSo=cs1&date=2026-08-14");
    expect(scopeHref("/cham-cong/phan-ca", CTX)).toBe("/cham-cong/phan-ca?ky=2026-08&coSo=cs1");
    expect(scopeHref("/cham-cong/ky-cong", CTX)).toBe("/cham-cong/ky-cong?ky=2026-08&coSo=cs1");
    expect(scopeHref("/cham-cong/doi-soat", CTX)).toBe("/cham-cong/doi-soat?ky=2026-08&coSo=cs1");
    expect(scopeHref("/cham-cong/danh-muc-ca", CTX)).toBe("/cham-cong/danh-muc-ca?ky=2026-08&coSo=cs1");
    expect(scopeHref("/don-tu", CTX)).toBe("/don-tu?coSo=cs1");
  });

  it("không tab nào rơi mất khối khi khối còn hợp lệ", () => {
    const tabs = [
      "/cham-cong",
      "/cham-cong/phan-ca",
      "/cham-cong/ky-cong",
      "/cham-cong/doi-soat",
      "/cham-cong/danh-muc-ca",
      "/don-tu",
    ];
    for (const t of tabs) expect(scopeHref(t, CTX)).toContain("coSo=cs1");
  });

  it("canCoSo = false thì KHÔNG đẩy khối sang tab đích", () => {
    expect(scopeHref("/don-tu", CTX, false)).toBe("/don-tu");
    expect(scopeHref("/cham-cong/phan-ca", CTX, false)).toBe("/cham-cong/phan-ca?ky=2026-08");
  });

  it("thiếu ky thì suy từ date, thiếu date thì suy từ ky", () => {
    expect(scopeHref("/cham-cong/phan-ca", { coSo: "cs1", date: "2026-08-14", now: NOW })).toBe(
      "/cham-cong/phan-ca?ky=2026-08&coSo=cs1",
    );
    // Kỳ hiện tại ⇒ mở ra ở HÔM NAY.
    expect(scopeHref("/cham-cong", { ky: "2026-08", coSo: "cs1", now: NOW })).toBe(
      "/cham-cong?coSo=cs1&date=2026-08-14",
    );
    // Kỳ khác ⇒ mùng 1, không nhảy sang tháng khác.
    expect(scopeHref("/cham-cong", { ky: "2026-02", coSo: "cs1", now: NOW })).toBe(
      "/cham-cong?coSo=cs1&date=2026-02-01",
    );
  });

  it("ngữ cảnh rỗng hoặc kỳ sai định dạng ⇒ href trần, không đẻ tham số rác", () => {
    expect(scopeHref("/cham-cong", { now: NOW })).toBe("/cham-cong");
    expect(scopeHref("/cham-cong/ky-cong", { ky: "thang-8", now: NOW })).toBe("/cham-cong/ky-cong");
  });

  it("cụm Của tôi / kiosk / ngoài module không nhận ngữ cảnh khối", () => {
    expect(scopeHref("/cham-cong/lich-ca", CTX)).toBe("/cham-cong/lich-ca");
    expect(scopeHref("/don-tu/cua-toi", CTX)).toBe("/don-tu/cua-toi");
    expect(scopeHref("/cham-cong/man-hinh", CTX)).toBe("/cham-cong/man-hinh");
    expect(scopeHref("/holidays", CTX)).toBe("/holidays");
  });

  it("href truyền vào đã có sẵn query thì query đó bị thay, không nhân đôi dấu ?", () => {
    expect(scopeHref("/cham-cong/phan-ca?ky=2020-01", CTX)).toBe("/cham-cong/phan-ca?ky=2026-08&coSo=cs1");
  });
});

describe("shiftKy", () => {
  it("qua năm cả hai chiều", () => {
    expect(shiftKy("2026-01", -1)).toBe("2025-12");
    expect(shiftKy("2026-12", 1)).toBe("2027-01");
    expect(shiftKy("2026-06", 7)).toBe("2027-01");
    expect(shiftKy("2026-06", -18)).toBe("2024-12");
  });

  it("kỳ sai định dạng ⇒ trả nguyên, không đoán hộ", () => {
    expect(shiftKy("2026-13", 1)).toBe("2026-13");
    expect(shiftKy("", 1)).toBe("");
  });
});

describe("monthStepDate", () => {
  it("không bao giờ đẻ ra ngày không tồn tại (31 → mùng 1 tháng sau)", () => {
    expect(monthStepDate("2026-01-31", 1, NOW)).toBe("2026-02-01");
    expect(monthStepDate("2026-03-31", -1, NOW)).toBe("2026-02-01");
    expect(monthStepDate("2026-05-31", 1, NOW)).toBe("2026-06-01");
  });

  it("nhảy vào tháng hiện tại ⇒ về hôm nay", () => {
    expect(monthStepDate("2026-07-03", 1, NOW)).toBe("2026-08-14");
    expect(monthStepDate("2026-09-30", -1, NOW)).toBe("2026-08-14");
  });

  it("ngày sai định dạng ⇒ lấy tháng hiện tại làm mốc", () => {
    expect(monthStepDate("hom-nay", -1, NOW)).toBe("2026-07-01");
  });
});
