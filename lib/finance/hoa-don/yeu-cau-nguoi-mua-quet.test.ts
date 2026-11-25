// Ca [YCQ-*] — pha P3 của cron `hoa-don-misa-doi-soat`: dọn yêu cầu thông tin người mua (hết hạn + xoá dữ liệu quá thời hạn giữ). Cờ TẮT ⇒ không chạm gì; chỉ cơ sở thí điểm.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ laBat: vi.fn(), coSo: vi.fn(), cauHinh: vi.fn(), quet: vi.fn() }));
vi.mock("./feature", () => ({ laHubNguoiMuaBat: h.laBat, coSoNguoiMuaDuoc: h.coSo, docCauHinhNguoiMua: h.cauHinh }));
vi.mock("./yeu-cau-nguoi-mua-db", () => ({ quetHetHan: h.quet }));

import { chayDonDepNguoiMua } from "./yeu-cau-nguoi-mua-quet";

const NOW = new Date("2026-11-02T03:00:00Z");
const CFG = { ttlPhut: 240, toiDaSaiToken: 5, toiDaLanMo: 30, khoaPhut: 15, giuDuLieuNgay: 21, choXuLyToiDaNgay: 9 };

beforeEach(() => {
  vi.clearAllMocks();
  h.laBat.mockResolvedValue(true);
  h.coSo.mockResolvedValue(["cs1", "cs2"]);
  h.cauHinh.mockResolvedValue(CFG);
  h.quet.mockResolvedValue({ hetHan: 2, daXoaDuLieu: 1, choXuLyQuaHan: 0 });
});

describe("[YCQ-01] cổng", () => {
  it("cờ người mua TẮT ⇒ null và KHÔNG đọc cấu hình / không quét; đối chứng: bật thì quét", async () => {
    h.laBat.mockResolvedValue(false);
    expect(await chayDonDepNguoiMua({ now: NOW })).toBeNull();
    expect(h.cauHinh).not.toHaveBeenCalled();
    expect(h.quet).not.toHaveBeenCalled();
    h.laBat.mockResolvedValue(true);
    expect(await chayDonDepNguoiMua({ now: NOW })).toMatchObject({ hetHan: 2, daXoaDuLieu: 1 });
  });

  it("chưa cơ sở nào thí điểm ⇒ null, không quét (KHÔNG BAO GIỜ rơi về «tất cả cơ sở»)", async () => {
    h.coSo.mockResolvedValue([]);
    expect(await chayDonDepNguoiMua({ now: NOW })).toBeNull();
    expect(h.quet).not.toHaveBeenCalled();
  });
});

describe("[YCQ-02] tham số", () => {
  it("phạm vi = đúng danh sách cơ sở thí điểm (mảng, không «TAT_CA»); thời hạn lấy từ CẤU HÌNH; now truyền vào", async () => {
    await chayDonDepNguoiMua({ now: NOW });
    expect(h.quet).toHaveBeenCalledWith(expect.objectContaining({ now: NOW, giuDuLieuNgay: 21, choXuLyToiDaNgay: 9, phamVi: ["cs1", "cs2"] }));
    expect(h.quet.mock.calls[0]![0].phamVi).not.toBe("TAT_CA");
  });
});

describe("[YCQ-03] không bao giờ ném", () => {
  it("quét ném ⇒ trả nhãn ngắn, không kèm câu lỗi gốc (có thể mang dữ liệu)", async () => {
    h.quet.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5 — mật khẩu=abc"));
    const r = await chayDonDepNguoiMua({ now: NOW });
    expect(r).toEqual({ hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0, loi: expect.stringMatching(/^QUET:/) });
    expect(JSON.stringify(r)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(r)).not.toContain("mật khẩu");
  });

  it("đọc cờ ném ⇒ nhãn CO:…, không ném", async () => {
    h.laBat.mockRejectedValue(new Error("db chết"));
    expect(await chayDonDepNguoiMua({ now: NOW })).toMatchObject({ loi: expect.stringMatching(/^CO:/) });
    expect(h.quet).not.toHaveBeenCalled();
  });
});
