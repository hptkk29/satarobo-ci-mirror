import { describe, expect, it } from "vitest";

import { canhBaoDeXuat, loiXacNhanDeXuat } from "@/lib/completion/de-xuat";

describe("canhBaoDeXuat", () => {
  it("đi đủ, khoá đã hết ⇒ không cảnh báo gì", () => {
    expect(
      canhBaoDeXuat({ attended: 11, heldSessions: 11, totalSessions: 11 }),
    ).toEqual([]);
  });

  it("chưa đi buổi nào ⇒ CHUA_DI_BUOI_NAO (ca Đinh Gia Vinh 0/7 trên UAT)", () => {
    expect(
      canhBaoDeXuat({ attended: 0, heldSessions: 7, totalSessions: 7 }),
    ).toEqual(["CHUA_DI_BUOI_NAO"]);
  });

  it("chuyên cần dưới 60% ⇒ CHUYEN_CAN_THAP", () => {
    expect(
      canhBaoDeXuat({ attended: 3, heldSessions: 7, totalSessions: 7 }),
    ).toEqual(["CHUYEN_CAN_THAP"]);
  });

  it("đúng 60% thì KHÔNG cảnh báo — ngưỡng là 'dưới', không phải 'không đạt'", () => {
    expect(
      canhBaoDeXuat({ attended: 6, heldSessions: 10, totalSessions: 10 }),
    ).toEqual([]);
  });

  it("khoá chưa dạy hết ⇒ KHOA_CHUA_KET_THUC (ca lớp CS1.15, 7/11 buổi)", () => {
    expect(
      canhBaoDeXuat({ attended: 7, heldSessions: 7, totalSessions: 11 }),
    ).toEqual(["KHOA_CHUA_KET_THUC"]);
  });

  it("gộp được nhiều cảnh báo cùng lúc", () => {
    expect(
      canhBaoDeXuat({ attended: 0, heldSessions: 7, totalSessions: 11 }),
    ).toEqual(["CHUA_DI_BUOI_NAO", "KHOA_CHUA_KET_THUC"]);
  });

  it("lớp chưa dạy buổi nào ⇒ KHÔNG chia cho 0, không kết luận chuyên cần", () => {
    const r = canhBaoDeXuat({ attended: 0, heldSessions: 0, totalSessions: 11 });
    expect(r).not.toContain("CHUA_DI_BUOI_NAO");
    expect(r).not.toContain("CHUYEN_CAN_THAP");
    expect(r).toEqual(["KHOA_CHUA_KET_THUC"]);
  });

  it("totalSessions = 0 ⇒ không cảnh báo khoá chưa kết thúc", () => {
    expect(
      canhBaoDeXuat({ attended: 0, heldSessions: 0, totalSessions: 0 }),
    ).toEqual([]);
  });
});

describe("loiXacNhanDeXuat", () => {
  it("không cảnh báo ⇒ vẫn hỏi lại, và nói rõ trung tâm mới là nơi duyệt", () => {
    const t = loiXacNhanDeXuat("Đặng Công Trí", []);
    expect(t).toContain("Đặng Công Trí");
    expect(t).toContain("Trung tâm sẽ duyệt");
  });

  it("có cảnh báo ⇒ liệt kê đủ rồi mới hỏi", () => {
    const t = loiXacNhanDeXuat("Đinh Gia Vinh", [
      "CHUA_DI_BUOI_NAO",
      "KHOA_CHUA_KET_THUC",
    ]);
    expect(t).toContain("chưa đi buổi nào");
    expect(t).toContain("chưa dạy hết");
    expect(t).toContain("Vẫn gửi?");
  });
});
