// @vitest-environment jsdom
/**
 * [NHH-KY-TT-01..02] — tải tệp xlsx từ base64 của Server Action. Lượt Xuất không lặp lại được, nên tệp phải ra ĐÚNG byte, ĐÚNG kiểu, ĐÚNG tên.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { blobTuBase64, taiTep } from "./tai-tep";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("[NHH-KY-TT-01] blobTuBase64", () => {
  it("giải base64 ra đúng từng byte (chữ ký zip 'PK\\x03\\x04' của xlsx) và đúng kiểu MIME", async () => {
    const b = blobTuBase64(btoa(String.fromCharCode(0x50, 0x4b, 0x03, 0x04, 0xff, 0x00)));
    expect(b.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(b.size).toBe(6);
    const bytes = new Uint8Array(await b.arrayBuffer());
    expect([...bytes]).toEqual([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]); // 0xff và 0x00 sống sót: không đi qua chuỗi UTF-8
  });
});

describe("[NHH-KY-TT-02] taiTep", () => {
  it("tạo liên kết tạm với đúng tên tệp, bấm, gỡ khỏi DOM, và thu hồi URL SAU một khoảng (thu ngay có trình duyệt huỷ lượt tải)", () => {
    vi.useFakeTimers();
    const tao = vi.fn(() => "blob:fake");
    const thu = vi.fn();
    Object.assign(URL, { createObjectURL: tao, revokeObjectURL: thu });
    const bam = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("hoa-hong-bang-luong-2026-10.xlsx");
      expect(this.href).toBe("blob:fake");
      expect(document.body.contains(this)).toBe(true); // phải nằm trong DOM lúc bấm (Firefox)
    });
    taiTep({ tenTep: "hoa-hong-bang-luong-2026-10.xlsx", base64: btoa("x") });
    expect(tao).toHaveBeenCalledTimes(1);
    expect(bam).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(thu).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(thu).toHaveBeenCalledWith("blob:fake");
  });
});
