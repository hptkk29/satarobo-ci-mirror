import { describe, it, expect } from "vitest";
import { originTuHeaders } from "./origin";

/** Headers giả tối thiểu — hàm chỉ cần `.get()`. */
function hd(m: Record<string, string>) {
  return { get: (k: string) => m[k.toLowerCase()] ?? null };
}

describe("[PUSH-D3-T06] dựng origin từ header", () => {
  it("6 host thật của hệ thống đều ra đúng origin", () => {
    for (const h of [
      "satarobo.vn",
      "admin.satarobo.vn",
      "hocvien.satarobo.vn",
      "giaovien.satarobo.vn",
      "sale.satarobo.vn",
      "e-learning.satarobo.vn",
    ]) {
      expect(originTuHeaders(hd({ host: h, "x-forwarded-proto": "https" }))).toBe(`https://${h}`);
    }
  });

  it("x-forwarded-host THẮNG host — sau proxy thì host là tên nội bộ", () => {
    expect(
      originTuHeaders(hd({ host: "abc.vercel.app", "x-forwarded-host": "admin.satarobo.vn" })),
    ).toBe("https://admin.satarobo.vn");
  });

  it("header dạng DANH SÁCH → lấy phần tử ĐẦU", () => {
    // Qua nhiều tầng proxy, header thành "a, b". Lấy cả chuỗi là cột origin mang một giá trị
    // không mở được — trông như số đo nhưng vô nghĩa.
    expect(
      originTuHeaders(
        hd({ "x-forwarded-host": "admin.satarobo.vn, internal.local", "x-forwarded-proto": "https, http" }),
      ),
    ).toBe("https://admin.satarobo.vn");
  });

  it("hạ chữ thường — HOST viết hoa vẫn ra một giá trị duy nhất", () => {
    expect(originTuHeaders(hd({ host: "ADMIN.SataRobo.VN", "x-forwarded-proto": "https" }))).toBe(
      "https://admin.satarobo.vn",
    );
  });

  it("localhost không có x-forwarded-proto → http, không phải https", () => {
    expect(originTuHeaders(hd({ host: "localhost:3000" }))).toBe("http://localhost:3000");
    expect(originTuHeaders(hd({ host: "127.0.0.1:3000" }))).toBe("http://127.0.0.1:3000");
  });

  it("host thật không có x-forwarded-proto → https (fail-safe đúng chiều)", () => {
    // Web Push đòi ngữ cảnh bảo mật, nên một origin http cho host thật chắc chắn sai.
    expect(originTuHeaders(hd({ host: "admin.satarobo.vn" }))).toBe("https://admin.satarobo.vn");
  });
});

describe("[PUSH-D3-T07] trả null thay vì bịa", () => {
  it("thiếu cả hai header host", () => {
    expect(originTuHeaders(hd({}))).toBeNull();
  });

  it("host rỗng hoặc chỉ khoảng trắng", () => {
    expect(originTuHeaders(hd({ host: "" }))).toBeNull();
    expect(originTuHeaders(hd({ host: "   " }))).toBeNull();
  });

  it("host chứa ký tự không hợp lệ — chặn nhồi header", () => {
    // Một origin SAI còn tệ hơn ô trống: nó trông như số đo.
    for (const h of ["admin.satarobo.vn/evil", "admin satarobo vn", "admin.satarobo.vn?x=1", "a@b"]) {
      expect(originTuHeaders(hd({ host: h }))).toBeNull();
    }
  });

  it("proto lạ → null, không rơi về https", () => {
    expect(originTuHeaders(hd({ host: "admin.satarobo.vn", "x-forwarded-proto": "ftp" }))).toBeNull();
    expect(
      originTuHeaders(hd({ host: "admin.satarobo.vn", "x-forwarded-proto": "javascript" })),
    ).toBeNull();
  });
});
