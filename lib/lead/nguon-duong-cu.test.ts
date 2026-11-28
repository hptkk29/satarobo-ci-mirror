/**
 * Khoá bằng test cái bẫy đã cuốn `quatang` vào đường chia cũ trong im lặng.
 *
 * Luật: danh sách là ĐÓNG. Nguồn không có tên trong đó — kể cả landing page tạo ngày
 * mai — đi đường mới. Nếu ai đó lỡ tay đảo lại thành "mặc định là đường cũ" thì ca
 * `nguồn lạ` dưới đây đỏ ngay, thay vì lỗi lộ ra sau vài trăm lead không có vết
 * trong sổ chia.
 */
import { describe, it, expect } from "vitest";
import { laNguonDuongCu } from "./nguon-duong-cu";

describe("laNguonDuongCu", () => {
  it("bốn nguồn cũ ⇒ đúng", () => {
    for (const n of ["facebook", "zalo", "google-form", "quatang"]) {
      expect(laNguonDuongCu(n), n).toBe(true);
    }
  });

  it("NGUỒN LẠ ⇒ SAI (đi đường mới) — đây là cả mục đích của file", () => {
    // Bất kỳ landing page nào tạo về sau. Trước bản vá, mọi tên ở đây đều ra `true`
    // vì cờ bị đặt cứng, và nguồn mới thừa hưởng nguyên gói khuyết tật của đường cũ.
    for (const n of ["covua", "landing-toan-tu-duy", "tiktok", "form-hoi-thao-2027"]) {
      expect(laNguonDuongCu(n), n).toBe(false);
    }
  });

  it("khoảng trắng thừa / hoa thường KHÔNG làm nguồn đang chạy đổi đường", () => {
    // Tên nguồn đi từ route handler; một dấu cách thừa mà hoá "nguồn lạ" là đổi thầm
    // đường chia của một nguồn thật đang chạy.
    expect(laNguonDuongCu("  quatang  ")).toBe(true);
    expect(laNguonDuongCu("Google-Form")).toBe(true);
  });

  it("rỗng / null ⇒ SAI, không ném", () => {
    expect(laNguonDuongCu(null)).toBe(false);
    expect(laNguonDuongCu(undefined)).toBe(false);
    expect(laNguonDuongCu("")).toBe(false);
  });
});
