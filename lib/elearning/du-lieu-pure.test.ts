/** [DLP-*] Phần thuần của "Dữ liệu của tôi". */
import { describe, expect, it } from "vitest";
import { dinhDangThoiGian, dongTongThoiGian, moTaDaDocXem } from "./du-lieu-pure";

const r = (o: Partial<Parameters<typeof moTaDaDocXem>[0]>) => ({
  kind: "READ",
  durationSec: null,
  coveredSec: 0,
  readSeconds: 0,
  scrollMaxPct: 0,
  ...o,
});

describe("[DLP-01] dinhDangThoiGian", () => {
  it("giây / phút / giờ", () => {
    expect(dinhDangThoiGian(0)).toBe("0 giây");
    expect(dinhDangThoiGian(45)).toBe("45 giây");
    expect(dinhDangThoiGian(2520)).toBe("42 phút");
    expect(dinhDangThoiGian(4680)).toBe("1 giờ 18 phút");
    expect(dinhDangThoiGian(7200)).toBe("2 giờ");
    expect(dinhDangThoiGian(-5)).toBe("0 giây");
  });
});

describe("[DLP-02] moTaDaDocXem", () => {
  it("video: % theo đoạn đã xem / thời lượng, kẹp 100", () => {
    expect(moTaDaDocXem(r({ kind: "VIDEO", durationSec: 600, coveredSec: 200 }))).toBe("33% video");
    expect(moTaDaDocXem(r({ kind: "VIDEO", durationSec: 100, coveredSec: 400 }))).toBe("100% video");
  });
  it("video thiếu thời lượng: không bịa %", () => {
    expect(moTaDaDocXem(r({ kind: "VIDEO", durationSec: null, coveredSec: 90 }))).toBe("đã xem 1 phút");
    expect(moTaDaDocXem(r({ kind: "VIDEO", durationSec: null, coveredSec: 0 }))).toBe("—");
  });
  it("bài đọc: giây đọc + % cuộn; chưa có số đo ⇒ '—'", () => {
    expect(moTaDaDocXem(r({ readSeconds: 180, scrollMaxPct: 80 }))).toBe("đọc 3 phút · cuộn 80%");
    expect(moTaDaDocXem(r({}))).toBe("—");
  });
});

describe("[DLP-03] dongTongThoiGian", () => {
  it("cộng đọc và xem; xem chỉ tính bài VIDEO", () => {
    expect(
      dongTongThoiGian([
        { kind: "READ", readSeconds: 2520, coveredSec: 999 }, // coveredSec của bài đọc KHÔNG tính vào 'xem'
        { kind: "VIDEO", readSeconds: 0, coveredSec: 4680 },
      ]),
    ).toBe("Đã đọc 42 phút · Đã xem 1 giờ 18 phút");
  });
  it("không có gì ⇒ null", () => {
    expect(dongTongThoiGian([])).toBeNull();
    expect(dongTongThoiGian([{ kind: "READ", readSeconds: 0, coveredSec: 0 }])).toBeNull();
  });
});
