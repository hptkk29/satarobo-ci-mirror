/**
 * [DC-*] Địa chỉ nơi ở của phụ huynh khai ở bước «Lưu» của DISC (05/11/2026).
 *   [DC-01] không khai (máy khách cũ) ⇒ ok, null — «bắt buộc phường/xã» là luật của form + của dữ liệu KHI CÓ gửi
 *   [DC-02] hợp lệ ⇒ làm sạch số nhà (ký tự điều khiển, khoảng trắng), cơ sở trống ⇒ null
 *   [DC-03] phường/xã phải thuộc ĐÚNG thành phố đã chọn (tên có thể trùng giữa các tỉnh)
 *   [DC-04] thành phố lạ · phường trống · cơ sở lạ · sai hình ⇒ từ chối, lỗi chỉ đúng trường
 */
import { describe, expect, it } from "vitest";
import { kiemTraDiaChi, maCoSoChonDuoc } from "./dia-chi";
import { danhSachPhuongCuaTinh, idTinhTheoTen } from "@/lib/lead/phuong-xa";

const HOP_LE = { thanhPho: "Tp Đà Nẵng", phuong: "Phường Hải Châu", soNha: null, coSoGanNha: null };

describe("[DC-01] không khai", () => {
  it.each([[undefined], [null]])("%s ⇒ ok, diaChi null", (raw) => {
    expect(kiemTraDiaChi(raw)).toEqual({ ok: true, diaChi: null });
  });
});

describe("[DC-02] hợp lệ", () => {
  it("giữ nguyên tên; số nhà trống ⇒ null; cơ sở trống ⇒ null", () => {
    expect(kiemTraDiaChi({ ...HOP_LE, soNha: "   ", coSoGanNha: "" })).toEqual({ ok: true, diaChi: HOP_LE });
  });
  it("làm sạch số nhà: ký tự điều khiển → khoảng trắng, gộp khoảng trắng, bỏ rìa", () => {
    const r = kiemTraDiaChi({ ...HOP_LE, soNha: "  12\u0000\n  Lê   Duẩn\t " });
    expect(r).toEqual({ ok: true, diaChi: { ...HOP_LE, soNha: "12 Lê Duẩn" } });
  });
  it("cơ sở chọn tay là một cơ sở đang vận hành ⇒ giữ mã", () => {
    const ma = maCoSoChonDuoc()[0]!;
    expect(kiemTraDiaChi({ ...HOP_LE, coSoGanNha: ma })).toEqual({ ok: true, diaChi: { ...HOP_LE, coSoGanNha: ma } });
  });
});

describe("[DC-03] phường thuộc đúng thành phố", () => {
  it("phường của tỉnh KHÁC ⇒ từ chối (đối chứng: cùng phường, đúng tỉnh ⇒ qua)", () => {
    const hue = "Huế";
    expect(idTinhTheoTen(hue)).not.toBeNull();
    const phuongHue = danhSachPhuongCuaTinh(idTinhTheoTen(hue)!)[0]!;
    expect(kiemTraDiaChi({ ...HOP_LE, thanhPho: hue, phuong: phuongHue }).ok).toBe(true);
    const sai = kiemTraDiaChi({ ...HOP_LE, thanhPho: "Tp Đà Nẵng", phuong: phuongHue });
    expect(sai).toEqual({ ok: false, loi: [{ truong: "diaChi.phuong", thongBao: expect.stringContaining("không thuộc") }] });
  });
});

describe("[DC-04] từ chối", () => {
  it.each([
    ["thành phố lạ", { ...HOP_LE, thanhPho: "Tp Không Có" }, "diaChi.thanhPho"],
    ["phường trống", { ...HOP_LE, phuong: "" }, "diaChi.phuong"],
    ["phường chỉ khoảng trắng", { ...HOP_LE, phuong: "   " }, "diaChi.phuong"],
    ["thành phố trống", { ...HOP_LE, thanhPho: "" }, "diaChi.thanhPho"],
    ["cơ sở lạ", { ...HOP_LE, coSoGanNha: "CS99" }, "diaChi.coSoGanNha"],
    ["số nhà quá dài", { ...HOP_LE, soNha: "x".repeat(201) }, "diaChi.soNha"],
  ])("%s ⇒ lỗi đúng trường", (_ten, raw, truong) => {
    const r = kiemTraDiaChi(raw);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi.map((l) => l.truong)).toContain(truong);
  });
  it.each([["chuỗi"], [5], [[]]])("sai hình %j ⇒ từ chối", (raw) => {
    expect(kiemTraDiaChi(raw).ok).toBe(false);
  });
});
