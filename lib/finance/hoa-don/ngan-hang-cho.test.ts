// Ca [NHC-*] — ngăn (tab) của màn hoá đơn: đếm, chọn ngăn khi mở, thứ tự dòng.
import { describe, expect, it } from "vitest";
import { CAC_NGAN, chonNgan, demTheoNgan, laNgan, sapXepTrongNgan } from "./ngan-hang-cho";

const d = (ngan: string, ngayThu: string, key: string) => ({ ngan, ngayThu, key }) as never;

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

describe("[NHC-03] thứ tự trong ngăn", () => {
  const dong = [d("cho", "2026-09-10", "b"), d("cho", "2026-09-01", "a"), d("da-xuat", "2026-09-01", "x"), d("da-xuat", "2026-09-20", "y")];
  it("việc còn làm: cũ nhất lên trước; chỉ dòng của ngăn đó", () => {
    expect(sapXepTrongNgan("cho", dong).map((x) => (x as { key: string }).key)).toEqual(["a", "b"]);
  });
  it("sổ đã xong: mới nhất lên trước", () => {
    expect(sapXepTrongNgan("da-xuat", dong).map((x) => (x as { key: string }).key)).toEqual(["y", "x"]);
  });
});

describe("[NHC-04] ngăn 'Cần điều chỉnh' (GĐ 8)", () => {
  it("nằm cuối, được đếm, và là VIỆC CÒN LÀM ⇒ cũ nhất lên trước", () => {
    const dong = [d("can-dieu-chinh", "2026-09-20", "y"), d("can-dieu-chinh", "2026-09-01", "x"), d("da-xuat", "2026-09-05", "z")];
    expect(CAC_NGAN.at(-1)?.ngan).toBe("can-dieu-chinh");
    expect(demTheoNgan(dong)["can-dieu-chinh"]).toBe(2);
    expect(sapXepTrongNgan("can-dieu-chinh", dong).map((x) => (x as { key: string }).key)).toEqual(["x", "y"]);
    expect(laNgan("can-dieu-chinh")).toBe(true);
  });
});
