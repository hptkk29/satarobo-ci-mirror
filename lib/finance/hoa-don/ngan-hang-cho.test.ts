// Ca [NHC-*] — ngăn (tab) của màn hoá đơn: đếm, chọn ngăn khi mở, thứ tự dòng.
import { describe, expect, it } from "vitest";
import { CAC_NGAN, chonNgan, demTheoNgan, docHuongSapXep, laNgan, sapXepTrongNgan } from "./ngan-hang-cho";

const d = (ngan: string, ngayThu: string, key: string, ghiNhanLuc = "") => ({ ngan, ngayThu, key, ghiNhanLuc }) as never;

describe("[NHC-01] đếm + nhận diện ngăn", () => {
  it("đủ tám ngăn (GĐ 8 thêm 'Cần điều chỉnh' ở CUỐI; bước 1 MISA thêm 'Phát hành MISA' sau 'Đã tải tệp'), mỗi ngăn có câu rỗng", () => {
    expect(CAC_NGAN.map((n) => n.ngan)).toEqual([
      "cho",
      "lech",
      "nhap",
      "phat-hanh",
      "da-xuat",
      "khong-xuat",
      "don-huy",
      "can-dieu-chinh",
    ]);
    expect(CAC_NGAN.every((n) => n.rong.length > 10)).toBe(true);
  });
  it("đếm theo ngăn, ngăn không có dòng = 0", () => {
    expect(demTheoNgan([d("cho", "", "a"), d("cho", "", "b"), d("nhap", "", "c")])).toEqual({
      cho: 2,
      lech: 0,
      nhap: 1,
      "phat-hanh": 0,
      "da-xuat": 0,
      "khong-xuat": 0,
      "don-huy": 0,
      "can-dieu-chinh": 0,
    });
  });
  it("chuỗi lạ trên URL không phải ngăn", () => {
    expect(laNgan("cho")).toBe(true);
    expect(laNgan("__proto__")).toBe(false);
    expect(laNgan(undefined)).toBe(false);
  });
});

describe("[NHC-02] ngăn khi mở màn", () => {
  it("URL thắng; không có URL thì theo dòng đang chọn; không nữa thì Chờ xuất", () => {
    expect(chonNgan({ tuUrl: "da-xuat", dongDangChon: d("nhap", "", "k") })).toBe("da-xuat");
    expect(chonNgan({ tuUrl: null, dongDangChon: d("nhap", "", "k") })).toBe("nhap");
    expect(chonNgan({ tuUrl: "bay-ba", dongDangChon: null })).toBe("cho");
  });
});

describe("[NHC-03] thứ tự trong ngăn — MỌI ngăn mới nhất lên trước (đảo 23/10/2026: trước đó việc tồn cũ nhất trước)", () => {
  const dong = [d("cho", "2026-09-10", "b"), d("cho", "2026-09-01", "a"), d("da-xuat", "2026-09-01", "x"), d("da-xuat", "2026-09-20", "y")];
  it("ngăn việc tồn: ngày thu mới nhất lên trước; chỉ dòng của ngăn đó", () => {
    expect(sapXepTrongNgan("cho", dong).map((x) => (x as { key: string }).key)).toEqual(["b", "a"]);
  });
  it("sổ đã xong: cũng mới nhất lên trước", () => {
    expect(sapXepTrongNgan("da-xuat", dong).map((x) => (x as { key: string }).key)).toEqual(["y", "x"]);
  });
});

describe("[NHC-03b] cùng ngày thu: lúc GHI NHẬN mới hơn trước, rồi khoá lần thu — ổn định, không phụ thuộc thứ tự vào", () => {
  const k = (xs: unknown[]) => xs.map((x) => (x as { key: string }).key);
  const v1 = d("cho", "2026-10-20", "z", "2026-10-20T03:00:00.000Z");
  const v2 = d("cho", "2026-10-20", "a", "2026-10-20T09:00:00.000Z");
  const v3 = d("cho", "2026-10-20", "m", "2026-10-20T09:00:00.000Z");
  const cu = d("cho", "2026-10-19", "q", "2026-10-19T23:00:00.000Z");
  it("ghi nhận 09:00 (a, m — cùng giờ nên theo khoá) trước 03:00 (z), ngày cũ cuối", () => {
    expect(k(sapXepTrongNgan("cho", [cu, v1, v3, v2]))).toEqual(["a", "m", "z", "q"]);
  });
  it("đảo thứ tự đầu vào ⇒ KẾT QUẢ y hệt (khoá phụ ổn định)", () => {
    expect(k(sapXepTrongNgan("cho", [v2, cu, v3, v1]))).toEqual(k(sapXepTrongNgan("cho", [v1, v3, cu, v2])));
  });
  it("không sửa mảng đầu vào", () => {
    const vao = [cu, v1];
    sapXepTrongNgan("cho", vao);
    expect(vao).toEqual([cu, v1]);
  });
});

describe("[NHC-04] ngăn 'Cần điều chỉnh' (GĐ 8)", () => {
  it("nằm cuối, được đếm, và xếp mới nhất lên trước như mọi ngăn", () => {
    const dong = [d("can-dieu-chinh", "2026-09-20", "y"), d("can-dieu-chinh", "2026-09-01", "x"), d("da-xuat", "2026-09-05", "z")];
    expect(CAC_NGAN.at(-1)?.ngan).toBe("can-dieu-chinh");
    expect(demTheoNgan(dong)["can-dieu-chinh"]).toBe(2);
    expect(sapXepTrongNgan("can-dieu-chinh", dong).map((x) => (x as { key: string }).key)).toEqual(["y", "x"]);
    expect(laNgan("can-dieu-chinh")).toBe(true);
  });
});

describe("[NHC-05] tuỳ chọn 'cũ nhất trước' — mặc định LUÔN mới nhất trước", () => {
  const k = (xs: unknown[]) => xs.map((x) => (x as { key: string }).key);
  const dong = [
    d("cho", "2026-10-20", "b", "2026-10-20T09:00:00.000Z"),
    d("cho", "2026-10-19", "a", "2026-10-19T09:00:00.000Z"),
    d("cho", "2026-10-20", "c", "2026-10-20T03:00:00.000Z"),
    d("cho", "2026-10-20", "z", "2026-10-20T03:00:00.000Z"),
  ];
  it("không truyền hướng / hướng lạ ⇒ mới nhất trước", () => {
    expect(k(sapXepTrongNgan("cho", dong))).toEqual(["b", "c", "z", "a"]);
    expect(k(sapXepTrongNgan("cho", dong, docHuongSapXep("bay-ba")))).toEqual(["b", "c", "z", "a"]);
    expect(docHuongSapXep(undefined)).toBe("moi-nhat");
    expect(docHuongSapXep(null)).toBe("moi-nhat");
    expect(docHuongSapXep("moi-nhat")).toBe("moi-nhat");
  });
  it("cu-nhat ⇒ thời gian đảo, khoá lần thu VẪN tăng dần ở cuối (ổn định)", () => {
    expect(docHuongSapXep("cu-nhat")).toBe("cu-nhat");
    expect(k(sapXepTrongNgan("cho", dong, "cu-nhat"))).toEqual(["a", "c", "z", "b"]);
  });
  it("cu-nhat áp cho MỌI ngăn như nhau", () => {
    const x = [d("da-xuat", "2026-09-01", "x"), d("da-xuat", "2026-09-20", "y")];
    expect(k(sapXepTrongNgan("da-xuat", x, "cu-nhat"))).toEqual(["x", "y"]);
  });
});
