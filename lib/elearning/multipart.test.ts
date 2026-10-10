// @vitest-environment node
/**
 * EL-10 — phần thuần của luồng tải nhiều phần.
 *
 * Case đắt nhất là hai case đầu của nhóm "ghép phần". Cả hai đều là lỗi mà HTTP
 * KHÔNG báo: R2 nhận danh sách phần sai thứ tự (hoặc thiếu một phần ở giữa), ghép
 * lại, và trả về một tệp mp4 **hợp lệ về cấu trúc nhưng hỏng nội dung**. Người
 * soạn chỉ biết khi mở thử — hoặc tệ hơn, khi người học mở.
 */
import { describe, it, expect } from "vitest";
import {
  ghepPhan,
  chiaPhan,
  hanLinkKy,
  PART_MAX,
  PART_MIN_BYTES,
} from "@/lib/elearning/multipart";

const p = (n: number) => ({ partNumber: n, etag: `"etag-${n}"` });

describe("ghép phần — hai lỗi mà HTTP không báo", () => {
  it("SẮP LẠI theo số phần, không tin thứ tự client gửi", () => {
    // Trình duyệt tải song song nên thứ tự hoàn thành là ngẫu nhiên; gửi nguyên
    // thứ tự đó cho R2 là ghép tệp theo thứ tự TẢI XONG.
    const r = ghepPhan([p(3), p(1), p(2)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parts.map((x) => x.partNumber)).toEqual([1, 2, 3]);
  });

  it("THIẾU một phần ở giữa ⇒ từ chối, không để R2 ghép tệp ngắn", () => {
    // R2 sẽ ghép phần còn lại thành một tệp mp4 vẫn hợp lệ về cấu trúc, chỉ mất
    // một khúc giữa. Không có lỗi nào nổ ra.
    const r = ghepPhan([p(1), p(3)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("THIEU_PHAN");
    expect(r.message).toContain("2");
  });
});

describe("từ chối đầu vào hỏng", () => {
  it("danh sách rỗng", () => {
    const r = ghepPhan([]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("KHONG_CO_PHAN_NAO");
  });

  it("số phần ngoài khoảng 1–10000", () => {
    for (const n of [0, -1, PART_MAX + 1, 1.5]) {
      const r = ghepPhan([{ partNumber: n, etag: "x" }]);
      expect(r.ok, String(n)).toBe(false);
    }
  });

  it("gửi trùng số phần", () => {
    const r = ghepPhan([p(1), p(1)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("TRUNG_SO_PHAN");
  });

  it("etag rỗng hoặc chỉ khoảng trắng", () => {
    for (const e of ["", "   "]) {
      const r = ghepPhan([{ partNumber: 1, etag: e }]);
      expect(r.ok, JSON.stringify(e)).toBe(false);
    }
  });

  it("một phần duy nhất, số 1 ⇒ hợp lệ", () => {
    // Tệp nhỏ hơn kích thước một phần vẫn đi đường multipart — không được coi là
    // trường hợp bất thường.
    expect(ghepPhan([p(1)]).ok).toBe(true);
  });
});

describe("chia phần", () => {
  it("kích thước phần không bao giờ nhỏ hơn trần 5MB của R2", () => {
    // R2 từ chối phần < 5MB (trừ phần cuối). Chia nhỏ hơn là đảm bảo lượt tải
    // hỏng ở phần thứ hai.
    const r = chiaPhan(100 * 1024 * 1024, 1024);
    expect("loi" in r).toBe(false);
    if ("loi" in r) return;
    expect(r.partSize).toBeGreaterThanOrEqual(PART_MIN_BYTES);
  });

  it("tệp nhỏ ⇒ đúng 1 phần", () => {
    const r = chiaPhan(1024);
    if ("loi" in r) throw new Error("không nên lỗi");
    expect(r.soPhan).toBe(1);
  });

  it("tệp 200MB, phần 8MB ⇒ 25 phần", () => {
    const r = chiaPhan(200 * 1024 * 1024, 8 * 1024 * 1024);
    if ("loi" in r) throw new Error("không nên lỗi");
    expect(r.soPhan).toBe(25);
  });

  it("vượt trần 10.000 phần ⇒ BÁO LỖI, không cắt bớt", () => {
    // Cắt bớt là mất đuôi tệp mà không ai biết. Đường đúng là tăng kích thước
    // phần.
    const r = chiaPhan(10_000 * PART_MIN_BYTES + 1, PART_MIN_BYTES);
    expect("loi" in r).toBe(true);
  });
});

describe("hạn link ký tính từ SỐ PHẦN, không hardcode", () => {
  it("nhiều phần ⇒ hạn dài hơn", () => {
    // Người soạn tải qua mạng chậm thì cả lượt kéo dài; link hết hạn giữa chừng
    // buộc họ làm lại từ đầu — với tệp 200MB đó là một buổi chiều.
    expect(hanLinkKy({ soPhan: 25 })).toBeGreaterThan(hanLinkKy({ soPhan: 2 }));
  });

  it("có sàn — tệp 1 phần vẫn đủ thời gian tải", () => {
    expect(hanLinkKy({ soPhan: 1 })).toBeGreaterThanOrEqual(600);
  });

  it("có trần — không ký một link sống nửa ngày", () => {
    expect(hanLinkKy({ soPhan: 10_000 })).toBeLessThanOrEqual(6 * 3600);
  });

  it("nhận tham số từ ngoài, không chôn con số trong hàm", () => {
    // Đường SCORM đã hardcode 3600s và bỏ qua setting tương ứng — sửa được một
    // lần thì đừng lặp lại lần hai.
    expect(hanLinkKy({ soPhan: 5, giaySoiPhan: 600, tranGiay: 7200 })).toBe(3000);
    expect(hanLinkKy({ soPhan: 100, giaySoiPhan: 600, tranGiay: 7200 })).toBe(7200);
  });
});
