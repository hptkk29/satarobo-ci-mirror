// @vitest-environment node
/** [CNM-*] P8/QtMauCN — đặc tả khuôn hiện hành. Lưới đối chiếu với MÃ NGUỒN khuôn PDF thật (bỏ chú thích). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TRUONG_TU_DIEN, danhGiaAnhHuong, truongDungTrongKhuon } from "./chung-nhan-mau";

const khuon = () => readFileSync(resolve(process.cwd(), "lib/pdf/certificate.tsx"), "utf8");

describe("[CNM] bảng chữ tự điền khớp khuôn PDF thật", () => {
  it("[CNM-01] 🔴 MỌI trường `d.<ten>` khuôn PDF in ra đều được khai ở TRUONG_TU_DIEN (không có chữ in mà bảng trên màn không nói)", () => {
    const dung = truongDungTrongKhuon(khuon());
    expect(dung.length).toBeGreaterThanOrEqual(7);
    const khai = new Set(TRUONG_TU_DIEN.map((t) => t.truong));
    expect(dung.filter((x) => !khai.has(x))).toEqual([]);
  });

  it("[CNM-02] 🔴 chiều ngược: trường khai là in-được (nhân viên) phải THẬT SỰ có trong khuôn; không khai ma", () => {
    const dung = new Set(truongDungTrongKhuon(khuon()));
    for (const t of TRUONG_TU_DIEN.filter((x) => x.nhanVien)) expect(dung.has(t.truong), t.truong).toBe(true);
    expect(new Set(TRUONG_TU_DIEN.map((t) => t.truong)).size).toBe(TRUONG_TU_DIEN.length);
  });

  it("[CNM-03] bộ tách `d.<ten>` bỏ chú thích: chuỗi trong chú thích không tính; trường lặp tính một lần", () => {
    expect(truongDungTrongKhuon("/* d.ma */ // d.khac\nconst x = d.a + d.a + d.b;")).toEqual(["a", "b"]);
  });

  it("[CNM-04] 🔴 ghi rõ thời điểm đọc: tên khoá là ĐỌC SỐNG, tên người/mã nhân viên/mã chứng nhận là chụp lúc cấp (đây là lý do đổi mẫu/đổi tên khoá lan ra bản tải lại)", () => {
    const tm = new Map(TRUONG_TU_DIEN.map((t) => [t.truong, t.thoiDiem]));
    expect(tm.get("courseName")).toBe("doc-song");
    for (const k of ["studentName", "studentCode", "certificateCode", "completedAt"]) expect(tm.get(k), k).toBe("chup-luc-cap");
  });
});

describe("[CNM] đánh giá ảnh hưởng đổi khuôn", () => {
  it("[CNM-05] 🔴 tổng ảnh hưởng = còn hiệu lực + hết hạn + thu hồi; luôn cảnh báo KHÔNG có phiên bản; chỉ nhắc thu hồi khi có", () => {
    const a = danhGiaAnhHuong({ conHieuLuc: 5, hetHan: 2, thuHoi: 1 });
    expect(a.soAnhHuong).toBe(8);
    expect(a.canhBao.join(" ")).toMatch(/không ghi phiên bản/);
    expect(a.canhBao.some((c) => c.includes("1 chứng nhận đã thu hồi"))).toBe(true);
    const b = danhGiaAnhHuong({ conHieuLuc: 0, hetHan: 0, thuHoi: 0 });
    expect(b.soAnhHuong).toBe(0);
    expect(b.canhBao).toHaveLength(2);
  });
});
