/** [DISC-UI-H*] Phần thuần của hành trình DISC: máy khách API, bản nháp, tiến độ, dịch lỗi. Dữ liệu BỊA ("giả"). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { goiBoDeDisc, goiLuuDisc, laBoDeHopLe } from "./api-client";
import { banNhapSchema, docBanNhap, ghiBanNhap, KHOA_BAN_NHAP, HAN_BAN_NHAP_GIO, type KhoLuuTru } from "./ban-nhap";
import { loiLuuHienThi } from "./loi-luu";
import { tinhTienDo } from "./tien-do";
import type { LuuInput } from "@/lib/disc/luu";

afterEach(() => vi.unstubAllGlobals());

const body = { idempotencyKey: "khoa-gia-0123456789" } as unknown as LuuInput;  // gitleaks:allow
const res = (status: number, json: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => json }) as Response;

describe("[DISC-UI-H1] api-client chỉ coi là thành công khi đúng hình dạng thành công", () => {
  it("200 đúng hình ⇒ ok", async () => {
    const ok = { ok: true, submissionId: "s", tokenTai: "t", maNhan: "ABCDEFGHJK", thongBao: { chinh: "c", email: null } };
    vi.stubGlobal("fetch", vi.fn(async () => res(200, ok)));
    expect(await goiLuuDisc(body)).toEqual(ok);
  });
  it("maNhan null (phát lại khi bài đã nhận) vẫn là thành công; thiếu hẳn maNhan thì KHÔNG", async () => {
    const baseOk = { ok: true, submissionId: "s", tokenTai: "t", thongBao: { chinh: "c", email: null } };
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { ...baseOk, maNhan: null })));
    expect((await goiLuuDisc(body)).ok).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => res(200, baseOk)));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { ...baseOk, maNhan: 123 })));
    expect((await goiLuuDisc(body)).ok).toBe(false);
  });
  it("200 nhưng thiếu trường (hoặc ok:true rỗng) ⇒ KHÔNG phải thành công", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(200, { ok: true })));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
  });
  it("500 kèm body 'ok:true' lạ ⇒ vẫn lỗi", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(500, { ok: true, submissionId: "s", tokenTai: "t", maNhan: null, thongBao: { chinh: "c", email: null } })));
    expect((await goiLuuDisc(body)).ok).toBe(false);
  });
  it("mạng đứt ⇒ MANG; 429 ⇒ QUA_NHIEU_LAN; JSON hỏng ⇒ LUU_THAT_BAI", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "MANG" });
    vi.stubGlobal("fetch", vi.fn(async () => res(429, {})));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "QUA_NHIEU_LAN" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, ok: false, json: async () => { throw new Error("html"); } }) as unknown as Response));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "LUU_THAT_BAI" });
  });
  it("lỗi hợp lệ của server được giữ nguyên kèm chi tiết", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(400, { ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "email", thongBao: "x" }] })));
    expect(await goiLuuDisc(body)).toEqual({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "email", thongBao: "x" }] });
  });
});

const boDeGia = { ma: "GIA-1", phienBan: "gia-1", doiTuong: "TH", nguoiLonTraLoiHo: false, cauHoi: [{ id: "g1", noiDung: "Câu giả" }, { id: "g2", noiDung: "Câu giả hai" }] };

describe("[DISC-UI-H1b] lấy bộ đề từ server (D1)", () => {
  const yc = { vai: "PH" as const, namSinh: 1988 };
  it("200 đúng hình ⇒ ok kèm bộ đề; gọi đúng POST /api/disc/bo-de với JSON", async () => {
    const f = vi.fn(async () => res(200, { ok: true, boDe: boDeGia }));
    vi.stubGlobal("fetch", f);
    expect(await goiBoDeDisc(yc)).toEqual({ ok: true, boDe: boDeGia });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/disc/bo-de");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(yc);
  });
  it("503 ENGINE_CHUA_SAN_SANG ⇒ ENGINE_CHUA_SAN_SANG; 404 ⇒ KHONG_MO; 429; 400", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(503, { ok: false, loi: "ENGINE_CHUA_SAN_SANG" })));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "ENGINE_CHUA_SAN_SANG" });
    vi.stubGlobal("fetch", vi.fn(async () => res(404, {})));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "KHONG_MO" });
    vi.stubGlobal("fetch", vi.fn(async () => res(429, {})));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "QUA_NHIEU_LAN" });
    vi.stubGlobal("fetch", vi.fn(async () => res(400, { ok: false, loi: "DU_LIEU_KHONG_HOP_LE" })));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "KHONG_HOP_LE" });
  });
  it("503 mã khác (hạ tầng) KHÔNG bị nhầm là 'đang hoàn thiện'; mạng đứt; JSON hỏng", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => res(503, { ok: false, loi: "LUU_THAT_BAI" })));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "LOI_MAY_CHU" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "MANG" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, ok: false, json: async () => { throw new Error("html"); } }) as unknown as Response));
    expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "LOI_MAY_CHU" });
  });
  it("200 nhưng bộ đề sai hình (rỗng, thiếu id, trùng id) ⇒ KHÔNG dựng bài", async () => {
    for (const x of [{ ...boDeGia, cauHoi: [] }, { ...boDeGia, cauHoi: [{ id: "", noiDung: "x" }] }, { ...boDeGia, cauHoi: [{ id: "a", noiDung: "x" }, { id: "a", noiDung: "y" }] }, { ...boDeGia, nguoiLonTraLoiHo: "có" }, null, "chuỗi"]) {
      vi.stubGlobal("fetch", vi.fn(async () => res(200, { ok: true, boDe: x })));
      expect(await goiBoDeDisc(yc)).toEqual({ ok: false, loi: "LOI_MAY_CHU" });
    }
    expect(laBoDeHopLe(boDeGia)).toBe(true);
  });
});

const kho = (): KhoLuuTru & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};
const nhap = { buoc: "hoSo" as const, idempotencyKey: "khoa-gia-0123456789", hoSo: { phuHuynh: { hoTen: "A", vaiTro: "", namSinh: "" }, hocSinh: { hoTen: "", namSinh: "", bacHoc: "" }, xacNhanLech: false }, traLoi: { PH: {}, HS: {} }, cau: { PH: 0, HS: 0 } };  // gitleaks:allow

describe("[DISC-UI-H2] bản nháp", () => {
  it("vòng ghi–đọc; hạn đúng mốc 2 giờ", () => {
    const k = kho();
    expect(ghiBanNhap(k, nhap, 1000)).toBe(true);
    expect(docBanNhap(k, 1000 + HAN_BAN_NHAP_GIO * 3_600_000)).not.toBeNull();
    expect(docBanNhap(k, 1001 + HAN_BAN_NHAP_GIO * 3_600_000)).toBeNull();
  });
  it("schema không có chỗ nào cho SĐT/email/điểm", () => {
    const khoa = Object.keys(banNhapSchema.shape);
    expect(khoa.join()).not.toMatch(/sdt|soDienThoai|email|diem|tiepThi/i);
    const k = kho();
    // dữ liệu thừa lén vào bị schema bỏ khi đọc lại
    k.m.set(KHOA_BAN_NHAP, JSON.stringify({ v: 2, luuLuc: 5, ...nhap, soDienThoai: "0905123456" }));
    expect(JSON.stringify(docBanNhap(k, 5))).not.toMatch(/0905123456/);
  });
  it("kho ném lỗi ⇒ ghi false, đọc null, không văng", () => {
    const xau: KhoLuuTru = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
    expect(ghiBanNhap(xau, nhap, 1)).toBe(false);
    expect(docBanNhap(xau, 1)).toBeNull();
    expect(docBanNhap(null, 1)).toBeNull();
  });
});

describe("[DISC-UI-H3] tiến độ & dịch lỗi", () => {
  it("0% ở hồ sơ, tăng đều, tới 100% ở màn lưu không vượt", () => {
    const d = { tongCauPH: 4, tongCauHS: 4 };
    const p = (buoc: "hoSo" | "phuHuynh" | "hocSinh" | "hoanThanh", a: number, b: number) => tinhTienDo({ buoc, ...d, daTraLoiPH: a, daTraLoiHS: b }).phanTram;
    expect(p("hoSo", 0, 0)).toBe(0);
    expect(p("phuHuynh", 2, 0)).toBeGreaterThan(p("phuHuynh", 0, 0));
    expect(p("hocSinh", 4, 0)).toBeGreaterThan(p("phuHuynh", 4, 0) - 1);
    expect(p("hoanThanh", 4, 4)).toBeLessThan(100);
    expect(p("phuHuynh", 99, 0)).toBeLessThanOrEqual(100);
    expect(tinhTienDo({ buoc: "hoSo", tongCauPH: 0, tongCauHS: 0, daTraLoiPH: 0, daTraLoiHS: 0 }).phanTram).toBe(0);
  });
  it("mọi lỗi dịch ra câu có chữ CHƯA và không lộ chi tiết kỹ thuật", () => {
    for (const loi of ["MANG", "QUA_NHIEU_LAN", "THIEU_HO_SO", "DU_LIEU_KHONG_HOP_LE", "LUU_THAT_BAI", "ENGINE_CHUA_SAN_SANG"] as const) {
      const t = loiLuuHienThi({ ok: false, loi } as never).thongBao;
      expect(t).toMatch(/CHƯA|Chưa/);
      expect(t).not.toMatch(/prisma|stack|500|undefined/i);
    }
  });
  it("lỗi theo ô được tách ra", () => {
    const r = loiLuuHienThi({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "email", thongBao: "E" }, { truong: "phuHuynh.hoTen", thongBao: "Z" }] });
    expect(r.truong).toEqual({ email: "E" });
    expect(r.cachSua).toBe("SUA_O");
  });
  it("[LL-BAI] lỗi ở câu trả lời (trả lời phẳng) ⇒ đưa về đúng bài, KHÔNG bảo kiểm tra hồ sơ/số điện thoại", () => {
    const hs = loiLuuHienThi({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "bai.hocSinh.traLoi", thongBao: "Hãy chọn đúng mức." }] });
    expect(hs.cachSua).toBe("SUA_BAI");
    expect(hs.baiCanSua).toBe("hocSinh");
    expect(hs.thongBao).toContain("Hãy chọn đúng mức.");
    expect(hs.thongBao).not.toMatch(/hồ sơ|số điện thoại/);
    const ph = loiLuuHienThi({ ok: false, loi: "DU_LIEU_KHONG_HOP_LE", chiTiet: [{ truong: "bai.phuHuynh.traLoi", thongBao: "x" }] });
    expect(ph.baiCanSua).toBe("phuHuynh");
  });
});
