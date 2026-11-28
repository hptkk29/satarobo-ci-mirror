// @vitest-environment node
/**
 * EL-10 — phân tích header `Range`.
 *
 * Trình phát video của trình duyệt KHÔNG tải cả tệp: nó xin từng khoảng, và khi
 * người xem tua thì nó xin một khoảng ở giữa. Trả sai một byte ở biên thì video
 * chạy vài giây rồi đứng — **không có lỗi nào hiện ra**, người học chỉ thấy màn
 * hình treo và không biết báo gì.
 *
 * Nên toàn bộ tệp này là số học biên. Mỗi case là một cách hỏng thật.
 */
import { describe, it, expect } from "vitest";
import { docRange, rangeChoR2 } from "@/lib/elearning/range";

const SIZE = 1000;
const r = (h: string | null) => docRange(h, SIZE);

describe("không có Range ⇒ trả cả tệp", () => {
  it("header vắng hoặc rỗng", () => {
    for (const h of [null, undefined, "", "   "]) {
      expect(docRange(h, SIZE).loai, JSON.stringify(h)).toBe("toan-bo");
    }
  });
});

describe("`bytes=0-` — trình phát mở video lần đầu", () => {
  it("từ 0 tới hết tệp", () => {
    const k = r("bytes=0-");
    expect(k.loai).toBe("mot-phan");
    if (k.loai !== "mot-phan") return;
    expect(k.start).toBe(0);
    expect(k.end).toBe(999);
    expect(k.contentLength).toBe(1000);
    expect(k.contentRange).toBe("bytes 0-999/1000");
  });
});

describe("`bytes=500-` và `bytes=200-299` — người xem tua", () => {
  it("từ mốc tới hết", () => {
    const k = r("bytes=500-");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect([k.start, k.end, k.contentLength]).toEqual([500, 999, 500]);
  });

  it("khoảng ở giữa", () => {
    const k = r("bytes=200-299");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect([k.start, k.end, k.contentLength]).toEqual([200, 299, 100]);
  });

  it("đúng MỘT byte", () => {
    const k = r("bytes=0-0");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(k.contentLength).toBe(1);
  });
});

describe("`bytes=-500` — hậu tố, xin phần ĐUÔI", () => {
  it("lấy 500 byte CUỐI, không phải 500 byte đầu", () => {
    // Đọc nhầm thành "từ 0 tới 500" là trả đúng phần đầu tệp cho một client đang
    // xin phần đuôi — trình phát sẽ dựng sai bảng thời gian và video hỏng.
    const k = r("bytes=-500");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect([k.start, k.end]).toEqual([500, 999]);
  });

  it("hậu tố LỚN HƠN tệp ⇒ kẹp về đầu tệp, không âm", () => {
    const k = r("bytes=-99999");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(k.start).toBe(0);
    expect(k.end).toBe(999);
  });

  it("hậu tố bằng 0 ⇒ 416", () => {
    expect(r("bytes=-0").loai).toBe("khong-thoa-man");
  });
});

describe("biên vượt tệp", () => {
  it("`end` vượt cuối tệp ⇒ KẸP về cuối, không phải lỗi", () => {
    // RFC đòi kẹp. Trả 416 ở đây là chặn một yêu cầu hoàn toàn hợp lệ mà trình
    // phát nào cũng gửi khi nó chưa biết dung lượng thật.
    const k = r("bytes=900-99999");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(k.end).toBe(999);
    expect(k.contentRange).toBe("bytes 900-999/1000");
  });

  it("`start` bằng đúng dung lượng ⇒ 416", () => {
    const k = r("bytes=1000-");
    expect(k.loai).toBe("khong-thoa-man");
    if (k.loai !== "khong-thoa-man") return;
    // Kèm dung lượng thật để client tự chỉnh, không để nó đoán.
    expect(k.contentRange).toBe("bytes */1000");
  });

  it("`start` lớn hơn `end` ⇒ 416", () => {
    expect(r("bytes=500-100").loai).toBe("khong-thoa-man");
  });

  it("byte cuối cùng vẫn phục vụ được", () => {
    const k = r("bytes=999-999");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(k.contentLength).toBe(1);
  });
});

describe("header rác ⇒ bỏ qua, trả cả tệp", () => {
  it("đơn vị khác `bytes`", () => {
    // Không hệ nào dùng thật. Bỏ qua header đúng theo RFC, và an toàn hơn đoán.
    expect(r("items=0-10").loai).toBe("toan-bo");
  });

  it("cú pháp sai", () => {
    for (const h of ["bytes=abc", "bytes=", "bytes=--", "bytes=1-2-3"]) {
      expect(r(h).loai, h).toBe("toan-bo");
    }
  });

  it("chữ HOA và khoảng trắng thừa vẫn hiểu", () => {
    const k = r("  BYTES=0-99  ");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(k.end).toBe(99);
  });
});

describe("nhiều khoảng — chốt MỘT hành vi rõ ràng", () => {
  it("chỉ phục vụ khoảng ĐẦU TIÊN", () => {
    // Nhiều khoảng hợp lệ theo RFC nhưng đòi phản hồi multipart/byteranges, và
    // không hệ phát video nào gửi kiểu đó. Xử im lặng thì về sau không ai biết
    // nó có được xử hay không — nên chốt và test.
    const k = r("bytes=0-99,200-299");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect([k.start, k.end]).toEqual([0, 99]);
  });
});

describe("tệp rỗng", () => {
  it("mọi yêu cầu đều 416, không chia cho 0", () => {
    const k = docRange("bytes=0-", 0);
    expect(k.loai).toBe("khong-thoa-man");
    if (k.loai !== "khong-thoa-man") return;
    expect(k.contentRange).toBe("bytes */0");
  });
});

describe("chuỗi gửi cho R2", () => {
  it("đúng dạng `bytes=start-end`", () => {
    expect(rangeChoR2(0, 99)).toBe("bytes=0-99");
  });

  it("khoảng đọc ra và khoảng gửi đi khớp nhau", () => {
    // Hai chỗ lệch nhau một byte là video thiếu/thừa một byte mỗi lượt xin — đủ
    // để trình phát hỏng mà không lỗi nào nổ ra.
    const k = r("bytes=200-299");
    if (k.loai !== "mot-phan") throw new Error("phải là một phần");
    expect(rangeChoR2(k.start, k.end)).toBe("bytes=200-299");
    expect(k.end - k.start + 1).toBe(k.contentLength);
  });
});
