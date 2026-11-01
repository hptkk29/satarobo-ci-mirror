// lib/finance/doi-chieu-hoc-vien.test.ts — khớp một em trong sheet với hồ sơ hệ thống.
//
// Đây là chỗ quyết định TIỀN VÀO HỒ SƠ NÀO. Gán nhầm thì công nợ hai em đều sai mà tổng
// vẫn đúng — không màn nào lộ ra, và phụ huynh bị đòi tiền đã đóng.
//
// Chủ dự án chốt khoá: SĐT phụ huynh + họ tên (mã học viên hai bên là hai hệ khác nhau).
//
// ⚠️ SỐ ĐO THẬT từ file: 102 SĐT cho 115 em ⇒ 9 SĐT dùng cho HAI em (anh chị em ruột).
// Nên "tìm thấy SĐT" KHÔNG bao giờ đủ để kết luận; phải khớp tiếp bằng tên, và khi tên
// không quyết được thì ĐƯA CHO NGƯỜI, không đoán.
import { describe, it, expect } from "vitest";
import { khopHocVien, MUC_KHOP } from "./doi-chieu-hoc-vien";

const hs = (id: string, name: string, parentPhone: string | null) => ({
  id,
  name,
  parentPhone,
  studentCode: null,
  centerName: null,
});

describe("[DCH-01] khớp chắc", () => {
  it("một hồ sơ, đúng SĐT, đúng tên → KHOP", () => {
    const r = khopHocVien(
      { sdt: "84932014686", hoTen: "Nguyễn Công Hoàng Khải" },
      [hs("s1", "NGUYỄN CÔNG HOÀNG KHẢI", "84932014686")],
    );
    expect(r.muc).toBe(MUC_KHOP.KHOP);
    expect(r.hocVienId).toBe("s1");
  });

  it("tên gõ khác dấu / khác hoa thường vẫn KHỚP", () => {
    const r = khopHocVien(
      { sdt: "84905499860", hoTen: "le nguyen tuan kiet" },
      [hs("s1", "Lê Nguyễn Tuấn Kiệt", "84905499860")],
    );
    expect(r.muc).toBe(MUC_KHOP.KHOP);
  });

  it("HAI ANH EM cùng SĐT → vẫn KHỚP đúng em nhờ tên (ca thật 0905167198)", () => {
    const dsach = [
      hs("s1", "Hoàng Vĩnh Khang", "84905167198"),
      hs("s2", "Hoàng Bảo Thạnh", "84905167198"),
    ];
    expect(khopHocVien({ sdt: "84905167198", hoTen: "HOÀNG BẢO THẠNH" }, dsach).hocVienId).toBe("s2");
    expect(khopHocVien({ sdt: "84905167198", hoTen: "HOÀNG VĨNH KHANG" }, dsach).hocVienId).toBe("s1");
  });
});

describe("[DCH-02] SĐT khớp nhưng tên không — ĐƯA CHO NGƯỜI, không đoán", () => {
  it("tên lệch → LECH_TEN, kèm danh sách ứng viên để người chọn", () => {
    // Ca thật: sheet ghi tắt "QUAN" cho "NGUYỄN NGỌC QUÂN".
    const r = khopHocVien(
      { sdt: "84905285992", hoTen: "QUÂN" },
      [hs("s1", "Nguyễn Ngọc Quân", "84905285992")],
    );
    expect(r.muc).toBe(MUC_KHOP.LECH_TEN);
    expect(r.hocVienId).toBeNull();
    expect(r.ungVien.map((u) => u.id)).toEqual(["s1"]);
  });

  it("hai anh em, tên sheet không khớp em nào → LECH_TEN với CẢ HAI ứng viên", () => {
    const r = khopHocVien({ sdt: "84905167198", hoTen: "HOÀNG AI ĐÓ" }, [
      hs("s1", "Hoàng Vĩnh Khang", "84905167198"),
      hs("s2", "Hoàng Bảo Thạnh", "84905167198"),
    ]);
    expect(r.muc).toBe(MUC_KHOP.LECH_TEN);
    expect(r.ungVien).toHaveLength(2);
  });

  it("KHÔNG tự chọn em duy nhất khi tên lệch — dù chỉ có một ứng viên", () => {
    // Cám dỗ lớn nhất ở đây: "chỉ có một em thôi, chắc là em đó". Sai một lần là tiền
    // vào hồ sơ người khác, và không có đường nào phát hiện ngược.
    const r = khopHocVien({ sdt: "84905000001", hoTen: "TÊN HOÀN TOÀN KHÁC" }, [
      hs("s1", "Trần Gia Bảo", "84905000001"),
    ]);
    expect(r.hocVienId).toBeNull();
  });
});

describe("[DCH-03] trùng tên trong cùng một SĐT", () => {
  it("hai hồ sơ cùng SĐT VÀ cùng tên → TRUNG_HO_SO, không tự chọn", () => {
    // Hồ sơ trùng lặp trong hệ thống là chuyện có thật. Chọn bừa một cái là nửa số tiền
    // nằm ở hồ sơ chết.
    const r = khopHocVien({ sdt: "84905000001", hoTen: "Trần Gia Bảo" }, [
      hs("s1", "Trần Gia Bảo", "84905000001"),
      hs("s2", "TRẦN GIA BẢO", "84905000001"),
    ]);
    expect(r.muc).toBe(MUC_KHOP.TRUNG_HO_SO);
    expect(r.hocVienId).toBeNull();
    expect(r.ungVien).toHaveLength(2);
  });
});

describe("[DCH-04] không tìm thấy", () => {
  it("không hồ sơ nào cùng SĐT → KHONG_THAY", () => {
    const r = khopHocVien({ sdt: "84900000000", hoTen: "AI ĐÓ" }, []);
    expect(r.muc).toBe(MUC_KHOP.KHONG_THAY);
    expect(r.hocVienId).toBeNull();
    expect(r.ungVien).toEqual([]);
  });

  it("giao dịch THIẾU SĐT → KHONG_THAY, không dò mò theo tên toàn hệ thống", () => {
    // Dò theo mỗi tên là mời gán nhầm giữa hai em trùng tên ở hai cơ sở.
    const r = khopHocVien({ sdt: null, hoTen: "Trần Gia Bảo" }, [
      hs("s1", "Trần Gia Bảo", "84905000001"),
    ]);
    expect(r.muc).toBe(MUC_KHOP.KHONG_THAY);
    expect(r.hocVienId).toBeNull();
  });

  it("thiếu CẢ tên → KHONG_THAY", () => {
    expect(khopHocVien({ sdt: "84905000001", hoTen: null }, []).muc).toBe(
      MUC_KHOP.KHONG_THAY,
    );
  });
});

describe("[DCH-05] chỉ xét hồ sơ CÙNG SĐT", () => {
  it("hồ sơ khác SĐT không lọt vào ứng viên dù trùng tên", () => {
    const r = khopHocVien({ sdt: "84905000001", hoTen: "Trần Gia Bảo" }, [
      hs("s1", "Trần Gia Bảo", "84905000001"),
      hs("s2", "Trần Gia Bảo", "84999999999"),
    ]);
    expect(r.muc).toBe(MUC_KHOP.KHOP);
    expect(r.hocVienId).toBe("s1");
  });

  it("hồ sơ không có SĐT phụ huynh thì không bao giờ là ứng viên", () => {
    const r = khopHocVien({ sdt: "84905000001", hoTen: "Trần Gia Bảo" }, [
      hs("s1", "Trần Gia Bảo", null),
    ]);
    expect(r.muc).toBe(MUC_KHOP.KHONG_THAY);
  });
});
