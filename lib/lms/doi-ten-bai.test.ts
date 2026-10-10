// Ca [DTB-*] — phân loại "seed đổi tên bài" là dọn hình thức hay đổi nội dung. Thuần.
//
// 🔴 Đo prod 26/09/2026: seed (`--force`) sẽ đổi tên **240 bài**. Con số ấy một mình
// không quyết được gì — thứ quyết được là **có dòng nào đổi NỘI DUNG không**.
//
// ⚠️ Bộ ca này canh đúng một thứ: phép phân loại KHÔNG được gộp nhầm một lần đổi nội
// dung vào nhóm "dọn rác". Gộp nhầm = giấu đúng dòng mà người ký cần thấy, và báo cáo
// sẽ nói "0 dòng đổi nội dung" một cách rất thuyết phục.
import { describe, it, expect } from "vitest";
import { phanLoaiDoiTen } from "./doi-ten-bai";

describe("[DTB-01] dọn hình thức — KHÔNG phải đổi nội dung", () => {
  it.each([
    // Đo prod 26/09: đây là hình dạng của gần như cả 240 dòng.
    ["HP1 - Bàn tay ma thuật", "Bàn tay ma thuật", "cat-tien-to"],
    ["HP2 — Họa Sĩ Robot", "Họa Sĩ Robot", "cat-tien-to"],
    ["HP4: Dự án cuối", "Dự án cuối", "cat-tien-to"],
    // Ba tên có dấu cách thừa THẬT trên prod (ghi nhận từ 08/09 ở session-project-name).
    ["HP1 -   Chiến Xa Tốc Độ", "Chiến Xa Tốc Độ", "cat-tien-to"],
    ["HP1 -  Ôn tập kiến thức", "Ôn tập kiến thức", "cat-tien-to"],
    ["Ôn  tập   kiến thức", "Ôn tập kiến thức", "don-khoang-trang"],
  ] as const)("%s → %s ⇒ %s", (cu, moi, loai) => {
    expect(phanLoaiDoiTen(cu, moi).loai).toBe(loai);
  });

  it("chỉ khác hoa/thường ⇒ `doi-hoa-thuong`, KHÔNG phải đổi nội dung", () => {
    expect(phanLoaiDoiTen("HP1 - Bàn tay ma thuật", "Bàn Tay Ma Thuật").loai).toBe(
      "doi-hoa-thuong",
    );
  });

  it("tên y hệt ⇒ vẫn là hình thức, không bao giờ là `doi-noi-dung`", () => {
    expect(phanLoaiDoiTen("Vũ Công Robot", "Vũ Công Robot").loai).not.toBe("doi-noi-dung");
  });
});

describe("[DTB-02] ĐỔI NỘI DUNG phải lộ ra — đây là nhóm duy nhất phải đọc", () => {
  it.each([
    ["HP1 - Bàn tay ma thuật", "Cánh tay robot"],
    ["Ôn tập kiến thức", "Kiểm tra giữa kỳ"],
    ["HP2 - Họa Sĩ Robot", "HP2 - Họa Sĩ Robot 2"],
    // Thêm một chữ cũng là đổi nội dung — đừng "khoan dung" ở đây.
    ["Thủy Thủ Tài Ba", "Thủy Thủ Tài Ba Hơn"],
  ])("%s → %s", (cu, moi) => {
    expect(phanLoaiDoiTen(cu, moi).loai).toBe("doi-noi-dung");
  });

  it("KHÔNG bỏ dấu tiếng Việt khi so — `Ôn tập` ≠ `On tap`", () => {
    // ⚠️ Bỏ dấu để so là "khoan dung" đúng chỗ không được phép: hai chuỗi ấy hiện ra
    // khác hẳn nhau trên phiếu gửi phụ huynh.
    expect(phanLoaiDoiTen("Ôn tập kiến thức", "On tap kien thuc").loai).toBe("doi-noi-dung");
  });

  it("tiền tố KHÔNG đúng dạng học phần thì KHÔNG được cắt", () => {
    // `MODULE_PREFIX` đòi có dấu ngăn sau số. `"HPV cảm biến"` không phải tiền tố học
    // phần — coi nó là tiền tố rồi cắt đi là tự tay đổi nội dung một cách im lặng.
    expect(phanLoaiDoiTen("HPV cảm biến", "cảm biến").loai).toBe("doi-noi-dung");
    expect(phanLoaiDoiTen("HP2 trần", "trần").loai).toBe("doi-noi-dung");
  });
});

describe("[DTB-03] chuẩn hoá Unicode — hai chuỗi trông y hệt phải được coi là một", () => {
  it("NFC vs NFD của cùng một chữ ⇒ KHÔNG phải đổi nội dung", () => {
    // ⚠️ Không chuẩn hoá thì báo cáo dựng ra những dòng "đổi nội dung" mà TRƯỚC và SAU in
    // ra không khác một nét — người đọc sẽ mất niềm tin vào cả báo cáo.
    const nfc = "Ôn tập".normalize("NFC");
    const nfd = "Ôn tập".normalize("NFD");
    expect(nfc === nfd, "fixture hỏng: hai dạng phải khác nhau về byte").toBe(false);
    expect(phanLoaiDoiTen(nfd, nfc).loai).not.toBe("doi-noi-dung");
  });
});
