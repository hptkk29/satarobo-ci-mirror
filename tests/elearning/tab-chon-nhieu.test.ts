/**
 * [EL-TAB-*] Tab theo URL và [EL-CHON-*] chọn nhiều — hai luật thuần của khung danh sách khu e-learning (P0, C2 + C5).
 */
import { describe, expect, it } from "vitest";
import { hrefTab, tabDangMo } from "@/lib/elearning/tab-url";
import {
  TRAN_THAO_TAC_HANG_LOAT,
  chonTatCaDangHien,
  doiMotDong,
  idGuiLenServer,
  trangThaiChonTatCa,
} from "@/lib/elearning/chon-nhieu";

const TABS = ["can-lam", "qua-han", "da-xong"] as const;
const CU = { khoaCu: ["tt"], bietDanh: { overdue: "qua-han", done: "da-xong" } } as const;

describe("[EL-TAB-01] tabDangMo", () => {
  it("?tab= hợp lệ thắng", () => {
    expect(tabDangMo({ tab: "qua-han" }, TABS, "can-lam", CU)).toBe("qua-han");
  });

  it("không có tab ⇒ mặc định", () => {
    expect(tabDangMo({}, TABS, "can-lam", CU)).toBe("can-lam");
  });

  it("giá trị lạ ⇒ mặc định (không trả tab ngoài danh sách)", () => {
    expect(tabDangMo({ tab: "<script>" }, TABS, "can-lam", CU)).toBe("can-lam");
    expect(tabDangMo({ tab: "" }, TABS, "can-lam", CU)).toBe("can-lam");
  });

  it("liên kết CŨ (?tt=overdue) vẫn mở đúng tab nhờ biệt danh", () => {
    expect(tabDangMo({ tt: "overdue" }, TABS, "can-lam", CU)).toBe("qua-han");
    expect(tabDangMo({ tt: "done" }, TABS, "can-lam", CU)).toBe("da-xong");
  });

  it("?tab= ưu tiên hơn khoá cũ khi có cả hai", () => {
    expect(tabDangMo({ tab: "da-xong", tt: "overdue" }, TABS, "can-lam", CU)).toBe("da-xong");
  });

  it("khoá cũ có giá trị lạ ⇒ mặc định", () => {
    expect(tabDangMo({ tt: "khong-co" }, TABS, "can-lam", CU)).toBe("can-lam");
  });

  it("giá trị mảng (?tab=a&tab=b) lấy phần tử đầu", () => {
    expect(tabDangMo({ tab: ["qua-han", "da-xong"] }, TABS, "can-lam", CU)).toBe("qua-han");
  });
});

describe("[EL-TAB-02] hrefTab", () => {
  it("luôn ghi tab tường minh, kể cả tab mặc định", () => {
    expect(hrefTab("/elearning/khoa-cua-toi", "can-lam")).toBe("/elearning/khoa-cua-toi?tab=can-lam");
  });

  it("giữ tham số lọc, bỏ giá trị rỗng/undefined", () => {
    expect(hrefTab("/x", "qua-han", { q: "robot", sort: "", size: undefined })).toBe("/x?tab=qua-han&q=robot");
  });

  it("KHÔNG giữ `page` (sang tab khác mà ở trang 3 là trang trống) và không cho ghi đè `tab`", () => {
    expect(hrefTab("/x", "da-xong", { page: "3", tab: "can-lam", q: "a" })).toBe("/x?tab=da-xong&q=a");
  });

  it("mã hoá ký tự đặc biệt trong giá trị lọc", () => {
    expect(hrefTab("/x", "t", { q: "a&b=c" })).toBe("/x?tab=t&q=a%26b%3Dc");
  });
});

describe("[EL-CHON-01] trạng thái ô chọn tất cả", () => {
  const dh = ["a", "b", "c"];
  it("không / một phần / tất cả", () => {
    expect(trangThaiChonTatCa(dh, new Set())).toBe("khong");
    expect(trangThaiChonTatCa(dh, new Set(["a"]))).toBe("mot-phan");
    expect(trangThaiChonTatCa(dh, new Set(["a", "b", "c"]))).toBe("tat-ca");
  });

  it("id đã rời danh sách (đã lọc mất) KHÔNG được tính vào 'tất cả'", () => {
    expect(trangThaiChonTatCa(dh, new Set(["a", "b", "x", "y"]))).toBe("mot-phan");
  });

  it("danh sách rỗng ⇒ 'khong' (không bao giờ 'tất cả' trên tập rỗng)", () => {
    expect(trangThaiChonTatCa([], new Set(["a"]))).toBe("khong");
  });
});

describe("[EL-CHON-02] chọn / bỏ chọn", () => {
  it("doiMotDong bật rồi tắt", () => {
    const b1 = doiMotDong(new Set(), "a");
    expect([...b1.tap]).toEqual(["a"]);
    expect([...doiMotDong(b1.tap, "a").tap]).toEqual([]);
  });

  it("không đổi tập đầu vào (bất biến)", () => {
    const goc = new Set(["a"]);
    doiMotDong(goc, "b");
    chonTatCaDangHien(["x", "y"], goc);
    expect([...goc]).toEqual(["a"]);
  });

  it("chạm trần ⇒ không thêm và báo chamTran", () => {
    const day = new Set(["a", "b"]);
    const r = doiMotDong(day, "c", 2);
    expect(r.tap.size).toBe(2);
    expect(r.chamTran).toBe(true);
    // Bỏ chọn khi đang chạm trần vẫn được.
    expect(doiMotDong(day, "a", 2).tap.size).toBe(1);
  });

  it("chonTatCaDangHien: chưa hết ⇒ chọn thêm các dòng còn thiếu, GIỮ id ngoài trang", () => {
    const r = chonTatCaDangHien(["a", "b"], new Set(["z"]));
    expect([...r.tap].sort()).toEqual(["a", "b", "z"]);
    expect(r.biCat).toBe(false);
  });

  it("chonTatCaDangHien: đã chọn hết ⇒ bỏ các dòng đó, vẫn giữ id ngoài trang", () => {
    const r = chonTatCaDangHien(["a", "b"], new Set(["a", "b", "z"]));
    expect([...r.tap]).toEqual(["z"]);
  });

  it("chonTatCaDangHien: trần cắt bớt và báo biCat", () => {
    const r = chonTatCaDangHien(["a", "b", "c", "d"], new Set(), 3);
    expect(r.tap.size).toBe(3);
    expect(r.biCat).toBe(true);
  });

  it("trần mặc định = 500, khớp trần người thêm tay của giao khoá", () => {
    expect(TRAN_THAO_TAC_HANG_LOAT).toBe(500);
  });
});

describe("[EL-CHON-03] idGuiLenServer — chỉ gửi những dòng người dùng còn nhìn thấy", () => {
  it("giao của tập chọn với dòng đang hiển thị, giữ thứ tự hiển thị", () => {
    expect(idGuiLenServer(["c", "a", "b"], new Set(["a", "c", "z"]))).toEqual(["c", "a"]);
  });

  it("id cũ đã lọc mất KHÔNG đi theo thao tác hàng loạt", () => {
    expect(idGuiLenServer(["a"], new Set(["z"]))).toEqual([]);
  });

  it("không trùng id dù danh sách hiển thị lặp", () => {
    expect(idGuiLenServer(["a", "a"], new Set(["a"]))).toEqual(["a"]);
  });
});
