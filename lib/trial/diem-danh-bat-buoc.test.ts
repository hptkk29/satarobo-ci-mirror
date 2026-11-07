import { describe, expect, it } from "vitest";
import { canhBaoCaseTrial, loiHoanTatThieuDiemDanh, soBeChuaDiemDanh } from "./diem-danh-bat-buoc";

describe("[DDB-01] đếm bé chưa điểm danh", () => {
  const be = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("vắng cũng là ĐÃ điểm danh; chỉ bé không có bản ghi mới tính thiếu", () => {
    expect(soBeChuaDiemDanh({ beCuaCase: be, daDiemDanh: new Set(["a", "b"]) })).toBe(1);
  });
  it("đủ ⇒ 0; không ai ⇒ tất cả", () => {
    expect(soBeChuaDiemDanh({ beCuaCase: be, daDiemDanh: new Set(["a", "b", "c"]) })).toBe(0);
    expect(soBeChuaDiemDanh({ beCuaCase: be, daDiemDanh: new Set() })).toBe(3);
  });
  it("câu lỗi nêu đúng số bé", () => {
    expect(loiHoanTatThieuDiemDanh(2)).toMatch(/Còn 2 học viên chưa điểm danh/);
  });
});

describe("[DDB-02] cảnh báo case qua giờ", () => {
  // Case 17:30–18:30 ngày 2026-11-04 (giờ VN) ⇒ kết thúc 18:30 VN = 11:30Z.
  const base = { trangThai: "SCHEDULED" as const, ngayYmd: "2026-11-04", endTime: "18:30", soBe: 2, soChuaDiemDanh: 2 };
  const truoc = new Date("2026-11-04T11:29:00Z");
  const sau = new Date("2026-11-04T11:31:00Z");

  it("chưa qua giờ kết thúc ⇒ không cảnh báo (đối chứng: ngay sau đó thì có)", () => {
    expect(canhBaoCaseTrial({ ...base, now: truoc })).toBeNull();
    expect(canhBaoCaseTrial({ ...base, now: sau })?.loai).toBe("CHUA_DIEM_DANH");
  });
  it("qua giờ, còn bé chưa điểm danh ⇒ CHUA_DIEM_DANH kèm số bé", () => {
    expect(canhBaoCaseTrial({ ...base, soChuaDiemDanh: 1, now: sau })).toEqual({ loai: "CHUA_DIEM_DANH", soChuaDiemDanh: 1 });
  });
  it("qua giờ, điểm danh đủ mà chưa Hoàn tất ⇒ CHUA_HOAN_TAT", () => {
    expect(canhBaoCaseTrial({ ...base, soChuaDiemDanh: 0, now: sau })).toEqual({ loai: "CHUA_HOAN_TAT", soChuaDiemDanh: 0 });
  });
  it("case đã hoàn tất / huỷ / trống ⇒ không cảnh báo", () => {
    expect(canhBaoCaseTrial({ ...base, trangThai: "COMPLETED", now: sau })).toBeNull();
    expect(canhBaoCaseTrial({ ...base, trangThai: "CANCELLED", now: sau })).toBeNull();
    expect(canhBaoCaseTrial({ ...base, soBe: 0, now: sau })).toBeNull();
  });
  it("định dạng giờ/ngày hỏng ⇒ không cảnh báo (không đoán)", () => {
    expect(canhBaoCaseTrial({ ...base, endTime: "abc", now: sau })).toBeNull();
    expect(canhBaoCaseTrial({ ...base, ngayYmd: "04/11/2026", now: sau })).toBeNull();
  });
});
