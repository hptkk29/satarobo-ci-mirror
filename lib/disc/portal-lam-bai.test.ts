/**
 * [PLB-*] Làm bài DISC trong cổng học viên — luật thuần + điều phối (không DB, không mạng; dữ liệu GIẢ).
 */
import { describe, expect, it, vi } from "vitest";
import { dungHoSoPortal, luuBaiTrongPortal, type LuuPortalDeps, type NguonHoSoPortal } from "./portal-lam-bai";

const NOW = new Date("2027-01-15T05:00:00Z"); // năm học 2026–2027

const DU: NguonHoSoPortal = {
  soDienThoai: "0905000111",
  tenPhuHuynh: "Mẹ Giả Một",
  tenHocSinh: "Bé Giả Hai",
  namSinhPhuHuynh: 1988,
  namSinhHocSinh: 2017,
  lopDaLuu: null,
};

describe("[PLB-H] dựng hồ sơ từ tài khoản", () => {
  it("[PLB-H1] đủ dữ liệu ⇒ không hỏi gì; lớp tính theo NĂM HỌC (sinh 2017, tháng 1/2027 ⇒ lớp 4)", () => {
    const r = dungHoSoPortal(DU, {}, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hoSo.hocSinh).toEqual({ hoTen: "Bé Giả Hai", namSinh: 2017, bacHoc: "4" });
    expect(r.hoSo.phuHuynh).toEqual({ hoTen: "Mẹ Giả Một", vaiTro: "NGUOI_GIAM_HO", namSinh: 1988 });
  });
  it("[PLB-H2] thiếu năm sinh ⇒ chỉ báo ĐÚNG mục thiếu; bổ sung xong thì dựng được", () => {
    const thieuPH = dungHoSoPortal({ ...DU, namSinhPhuHuynh: null }, {}, NOW);
    expect(thieuPH).toEqual({ ok: false, thieu: ["namSinhPhuHuynh"] });
    const thieuHai = dungHoSoPortal({ ...DU, namSinhPhuHuynh: null, namSinhHocSinh: null }, {}, NOW);
    expect(thieuHai).toEqual({ ok: false, thieu: ["namSinhPhuHuynh", "namSinhHocSinh"] });
    const xong = dungHoSoPortal({ ...DU, namSinhPhuHuynh: null }, { namSinhPhuHuynh: 1985 }, NOW);
    expect(xong.ok && xong.hoSo.phuHuynh.namSinh).toBe(1985);
  });
  it("[PLB-H3] dữ liệu của hệ thống THẮNG phần client bổ sung (không cho client ghi đè năm sinh đã có)", () => {
    const r = dungHoSoPortal(DU, { namSinhPhuHuynh: 1950, namSinhHocSinh: 2000 }, NOW);
    expect(r.ok && r.hoSo.phuHuynh.namSinh).toBe(1988);
    expect(r.ok && r.hoSo.hocSinh.namSinh).toBe(2017);
  });
  it("[PLB-H4] không có tên phụ huynh ⇒ nhãn trung tính, không để trống", () => {
    const r = dungHoSoPortal({ ...DU, tenPhuHuynh: "  " }, {}, NOW);
    expect(r.ok && r.hoSo.phuHuynh.hoTen).toBe("Phụ huynh");
  });
  it("[PLB-H5] năm sinh ngoài khoảng suy được lớp ⇒ dùng lớp đã lưu; không có nữa ⇒ hỏi lại năm sinh", () => {
    const dung = dungHoSoPortal({ ...DU, namSinhHocSinh: 2005, lopDaLuu: 12 }, {}, NOW);
    expect(dung.ok && dung.hoSo.hocSinh.bacHoc).toBe("12");
    const khong = dungHoSoPortal({ ...DU, namSinhHocSinh: 2005, lopDaLuu: null }, {}, NOW);
    expect(khong).toEqual({ ok: false, thieu: ["namSinhHocSinh"] });
  });
  it("[PLB-H6] giá trị rác từ client (NaN, chuỗi, ngoài khoảng) bị coi là chưa có", () => {
    const r = dungHoSoPortal({ ...DU, namSinhPhuHuynh: null }, { namSinhPhuHuynh: Number.NaN }, NOW);
    expect(r).toEqual({ ok: false, thieu: ["namSinhPhuHuynh"] });
    const r2 = dungHoSoPortal({ ...DU, namSinhPhuHuynh: null }, { namSinhPhuHuynh: 12 }, NOW);
    expect(r2).toEqual({ ok: false, thieu: ["namSinhPhuHuynh"] });
  });
});

function deps(o: Partial<LuuPortalDeps> = {}, nguon: NguonHoSoPortal | null = DU) {
  const d = {
    docNguon: vi.fn(async () => nguon),
    luu: vi.fn(async (_raw: unknown) => ({ ok: true as const, submissionId: "sub-1", tokenTai: "t", maNhan: null, thongBao: {} as never })),
    ganChoChu: vi.fn(async () => true),
    huyBai: vi.fn(async () => undefined),
    now: () => NOW,
    ...o,
  };
  return d as unknown as LuuPortalDeps & { luu: ReturnType<typeof vi.fn> };
}
const Y = { userId: "u1", studentId: "s1", idempotencyKey: "khoa-gia-0123456789abcdef", boSung: {}, bai: { phuHuynh: { maBoDe: "A", traLoi: { a: 1 } }, hocSinh: { maBoDe: "B", traLoi: { b: 1 } } } };

describe("[PLB-L] điều phối lưu", () => {
  it("[PLB-L1] con KHÔNG thuộc tài khoản ⇒ KHONG_CO_QUYEN, tuyệt đối không chạm đường lưu", async () => {
    const d = deps({}, null);
    const r = await luuBaiTrongPortal(Y, d);
    expect(r).toEqual({ ok: false, loi: "KHONG_CO_QUYEN" });
    expect(d.luu).not.toHaveBeenCalled();
    expect(d.ganChoChu).not.toHaveBeenCalled();
  });
  it("[PLB-L2] tài khoản chưa có SĐT ⇒ THIEU_SDT, không lưu", async () => {
    const d = deps({}, { ...DU, soDienThoai: null });
    expect(await luuBaiTrongPortal(Y, d)).toEqual({ ok: false, loi: "THIEU_SDT" });
    expect(d.luu).not.toHaveBeenCalled();
  });
  it("[PLB-L3] thiếu năm sinh ⇒ THIEU_HO_SO kèm đúng mục thiếu, không lưu", async () => {
    const d = deps({}, { ...DU, namSinhHocSinh: null });
    expect(await luuBaiTrongPortal(Y, d)).toEqual({ ok: false, loi: "THIEU_HO_SO", thieu: ["namSinhHocSinh"] });
    expect(d.luu).not.toHaveBeenCalled();
  });
  it("[PLB-L4] SĐT lưu = SĐT CỦA TÀI KHOẢN (không phải do client gửi); không email; không đồng ý tiếp thị", async () => {
    const d = deps();
    const r = await luuBaiTrongPortal({ ...Y, boSung: { namSinhHocSinh: 1999 } as never }, d);
    expect(r).toEqual({ ok: true, submissionId: "sub-1" });
    const raw = d.luu.mock.calls[0]![0] as Record<string, unknown>;
    expect(raw.soDienThoai).toBe("0905000111");
    expect(raw.email).toBeNull();
    expect(raw.dongY).toEqual({ xuLyHoSo: true, tiepThi: false });
    expect(raw.hocSinh).toEqual({ hoTen: "Bé Giả Hai", namSinh: 2017, bacHoc: "4" });
    expect(d.ganChoChu).toHaveBeenCalledWith({ submissionId: "sub-1", soDienThoai: "0905000111", userId: "u1", now: NOW });
  });
  it("[PLB-L5] đường lưu từ chối ⇒ trả nguyên lý do + chi tiết; KHÔNG gắn bài", async () => {
    const chiTiet = [{ truong: "bai.hocSinh.traLoi", thongBao: "Hãy chọn đúng mức." }];
    const d = deps({ luu: vi.fn(async () => ({ ok: false as const, loi: "DU_LIEU_KHONG_HOP_LE" as const, chiTiet })) });
    expect(await luuBaiTrongPortal(Y, d)).toEqual({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet });
    expect(d.ganChoChu).not.toHaveBeenCalled();
  });
  it("[PLB-L6] gắn về tài khoản thất bại ⇒ HUỶ bài vừa lưu (không để dữ liệu trẻ chờ người lạ nhận) và báo LUU_THAT_BAI", async () => {
    const d = deps({ ganChoChu: vi.fn(async () => false) });
    expect(await luuBaiTrongPortal(Y, d)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(d.huyBai).toHaveBeenCalledWith({ submissionId: "sub-1", soDienThoai: "0905000111", now: NOW });
  });
  it("[PLB-L7] gắn ném lỗi ⇒ cũng huỷ bài, không ném ra ngoài", async () => {
    const d = deps({ ganChoChu: vi.fn(async () => { throw new Error("db"); }) });
    expect(await luuBaiTrongPortal(Y, d)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    expect(d.huyBai).toHaveBeenCalledTimes(1);
  });
});
