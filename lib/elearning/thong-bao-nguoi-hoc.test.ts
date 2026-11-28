/** [TBN-*] Nội dung thông báo kết quả cho người học — phần thuần. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dinhDangDiem, noiDungKetQuaCham } from "./thong-bao-nguoi-hoc";

describe("[TBN-01] noiDungKetQuaCham", () => {
  it("đạt: 'đã được chấm: đạt 10/12'", () => {
    expect(noiDungKetQuaCham({ tenBai: "Bài 1", traVeSua: false, dat: true, tong: 10, toiDa: 12 }).title).toBe(
      'Bài tập "Bài 1" đã được chấm: đạt 10/12',
    );
  });
  it("chưa đạt: nói 'chưa đạt', kèm điểm; số lẻ dùng dấu phẩy", () => {
    const r = noiDungKetQuaCham({ tenBai: "B", traVeSua: false, dat: false, tong: 4.5, toiDa: 12 });
    expect(r.title).toBe('Bài tập "B" đã được chấm: chưa đạt 4,5/12');
    expect(r.body).toContain("nhận xét");
  });
  it("trả về để sửa: KHÔNG nói đạt/chưa đạt và KHÔNG in điểm (điểm lượt này chưa thành kết quả cuối)", () => {
    const r = noiDungKetQuaCham({ tenBai: "B", traVeSua: true, dat: null, tong: null, toiDa: 12 });
    expect(r.title).toBe('Bài tập "B" được trả về để sửa');
    expect(r.title).not.toMatch(/đạt|\d/);
  });
  it("trả về để sửa vẫn KHÔNG in điểm kể cả khi dữ liệu truyền vào có điểm (chống lộ nhầm)", () => {
    const r = noiDungKetQuaCham({ tenBai: "B", traVeSua: true, dat: false, tong: 3, toiDa: 12 });
    expect(r.title).not.toMatch(/\d\/\d|đạt/);
  });
  it("thiếu điểm tối đa ⇒ chỉ in tổng, không bịa mẫu số", () => {
    expect(noiDungKetQuaCham({ tenBai: "B", traVeSua: false, dat: true, tong: 7, toiDa: null }).title).toBe(
      'Bài tập "B" đã được chấm: đạt 7',
    );
  });
});

describe("[TBN-02] dinhDangDiem", () => {
  it("làm tròn 2 chữ số, dấu phẩy", () => {
    expect(dinhDangDiem(10)).toBe("10");
    expect(dinhDangDiem(10.456)).toBe("10,46");
  });
});

describe("[TBN-W] ghim dây nối: mỗi điểm phát GỌI đúng hàm, và nuốt lỗi (việc chính đã commit)", () => {
  // Bỏ chú thích trước khi tìm LỜI GỌI (chú thích giải thích bản vá thường chứa đúng chuỗi đang tìm) — luật 11.
  const doc = (f: string) =>
    readFileSync(resolve(process.cwd(), f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const diem: [string, string, string][] = [
    ["TBN-W1 chấm bài", "lib/elearning/task-grading.ts", "thongBaoDaCham("],
    ["TBN-W2 cấp chứng nhận", "lib/elearning/_handlers/issue-certificate.ts", "thongBaoCapChungNhan("],
    ["TBN-W3 gia hạn theo lượt giao", "lib/elearning/assignment-lifecycle.ts", "thongBaoGiaHan("],
    ["TBN-W4 gia hạn do sự cố", "lib/elearning/incident.ts", "thongBaoGiaHan("],
  ];
  for (const [ten, tep, loiGoi] of diem) {
    it(`${ten}: ${tep} gọi ${loiGoi} đúng 1 lần`, () => {
      const t = doc(tep);
      expect(t.split(loiGoi).length - 1).toBe(1);
    });
  }
  it("điểm phát cấp chứng nhận và chấm bài bọc try/catch; gia hạn dùng .catch", () => {
    expect(doc("lib/elearning/task-grading.ts")).toMatch(/try\s*\{[\s\S]*?thongBaoDaCham\([\s\S]*?\}\s*catch/);
    expect(doc("lib/elearning/_handlers/issue-certificate.ts")).toMatch(/try\s*\{\s*await thongBaoCapChungNhan\([\s\S]*?\}\s*catch/);
    expect(doc("lib/elearning/assignment-lifecycle.ts")).toMatch(/thongBaoGiaHan\(capNhat\)\.catch\(/);
    expect(doc("lib/elearning/incident.ts")).toMatch(/thongBaoGiaHan\(capNhat\)\.catch\(/);
  });
});
