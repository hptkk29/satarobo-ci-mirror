/**
 * [EL-KHU-*] Đường dẫn → khu làm việc (khung nhân viên / khung quản trị).
 * Lưới chính: MỌI thư mục trang của khu e-learning phải được phân loại — thêm route mà quên khai báo là đỏ, không rơi lặng lẽ
 * xuống mặc định.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DOAN_NHAN_VIEN, DOAN_QUAN_TRI, khuCuaDuongDan } from "./khu-lam-viec";

const GOC = path.join(process.cwd(), "app/(elearning)/elearning");

/** Thư mục con là một "đoạn" URL: bỏ `_xxx` (riêng tư), `(nhóm)` (không vào URL) và chỉ lấy thư mục có `page.tsx` bên dưới. */
function thuMucTrang(): string[] {
  const co = (dir: string): boolean =>
    fs.readdirSync(dir, { withFileTypes: true }).some((e) => (e.isFile() && e.name === "page.tsx") || (e.isDirectory() && co(path.join(dir, e.name))));
  return fs
    .readdirSync(GOC, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("("))
    .map((e) => e.name)
    .filter((ten) => co(path.join(GOC, ten)));
}

describe("[EL-KHU-01] mọi thư mục trang đều được phân loại", () => {
  it("quét thật thấy ≥ 20 thư mục (chống lưới rỗng)", () => {
    expect(thuMucTrang().length).toBeGreaterThanOrEqual(20);
  });

  it("không thư mục trang nào chưa khai báo ở DOAN_NHAN_VIEN hay DOAN_QUAN_TRI", () => {
    const biet = new Set([...DOAN_NHAN_VIEN, ...DOAN_QUAN_TRI]);
    const chua = thuMucTrang().filter((t) => !biet.has(t));
    expect(chua, `Route mới chưa chọn khung: ${chua.join(", ")} — thêm vào khu-lam-viec.ts`).toEqual([]);
  });

  it("không khai báo thừa: mọi đoạn đã khai đều là thư mục trang có thật", () => {
    const that = new Set(thuMucTrang());
    const thua = [...DOAN_NHAN_VIEN, ...DOAN_QUAN_TRI].filter((d) => !that.has(d));
    expect(thua).toEqual([]);
  });

  it("không đoạn nào ở CẢ HAI danh sách", () => {
    expect(DOAN_NHAN_VIEN.filter((d) => DOAN_QUAN_TRI.includes(d))).toEqual([]);
  });
});

describe("[EL-KHU-02] khuCuaDuongDan", () => {
  it("trang người học → nhân viên (kể cả gốc và trang bài nhiều tầng)", () => {
    for (const p of ["/elearning", "/elearning/khoa-cua-toi", "/elearning/hoc/e1/l2", "/elearning/chung-nhan-cua-toi/SR.CN.2026.00001", "/elearning/du-lieu-cua-toi"]) {
      expect(khuCuaDuongDan(p), p).toBe("nhan-vien");
    }
  });

  it("trang quản trị → quản trị, và `chung-nhan` (quản trị) KHÁC `chung-nhan-cua-toi` (nhân viên)", () => {
    for (const p of ["/elearning/dao-tao", "/elearning/chung-nhan", "/elearning/soan/abc", "/elearning/bao-cao-r4", "/elearning/ma-tran"]) {
      expect(khuCuaDuongDan(p), p).toBe("quan-tri");
    }
    expect(khuCuaDuongDan("/elearning/chung-nhan-cua-toi")).toBe("nhan-vien");
  });

  it("host e-learning (clean URL, không có tiền tố /elearning) cho kết quả y hệt", () => {
    expect(khuCuaDuongDan("/")).toBe("nhan-vien");
    expect(khuCuaDuongDan("/khoa-cua-toi")).toBe("nhan-vien");
    expect(khuCuaDuongDan("/ma-tran")).toBe("quan-tri");
    expect(khuCuaDuongDan("/dao-tao/")).toBe("quan-tri");
  });

  it("đường dẫn LẠ rơi về nhân viên (fail-closed về khung ít quyền nhất)", () => {
    expect(khuCuaDuongDan("/elearning/chua-biet-gi")).toBe("nhan-vien");
  });
});
