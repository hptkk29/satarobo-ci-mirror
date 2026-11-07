/**
 * [HDNAV-*] Điều hướng khu Hoá đơn — luật THUẦN (S5b Invoice Hub, 01/11/2026).
 *
 * Canh ba thứ mà test hành vi của component KHÔNG chạm tới:
 *   · bảng ngăn → khu vực là một PHÂN HOẠCH (thêm ngăn vào CAC_NGAN mà quên xếp chỗ là ngăn biến mất im lặng);
 *   · link giữa các khu vực mang đúng phạm vi và BỎ đúng thứ phải bỏ (chon/ngan/trang);
 *   · đường dẫn cũ (`?ngan=lech`…) được chỉ về khu vực đúng mà không mất tham số nào.
 * Không đọc đồng hồ thật, không chạm DB.
 */
import { describe, expect, it } from "vitest";
import { CAC_NGAN } from "@/lib/finance/hoa-don/ngan-hang-cho";
import {
  KHU_VUC,
  NGAN_THEO_KHU_VUC,
  chonNganTheoKhuVuc,
  chuyenKhuVuc,
  coOThang,
  hrefDoiPhamVi,
  hrefKhuVuc,
  hrefTrangPhu,
  khuVucCuaNgan,
  khuVucDangMo,
  khuVucHienThi,
  nganTrongKhuVuc,
  phamViTuQuery,
} from "./dieu-huong-hoa-don";

const QUYEN_DU = { "/payments/hoa-don": true, "/payments/hoa-don/cau-hinh": true } as const;

describe("[HDNAV-01] ngăn → khu vực là một PHÂN HOẠCH của CAC_NGAN", () => {
  it("mọi ngăn thuộc đúng MỘT khu vực; không khu vực nào giữ ngăn lạ", () => {
    const tatCa = CAC_NGAN.map((n) => n.ngan).sort();
    const gop = [...NGAN_THEO_KHU_VUC["hoa-don"], ...NGAN_THEO_KHU_VUC["canh-bao"]].sort();
    expect(gop).toEqual(tatCa);
    expect(new Set(gop).size).toBe(gop.length);
  });

  it("ngăn cũ Lệch số · Cần điều chỉnh · Đơn đã huỷ chuyển sang Cảnh báo; năm ngăn việc nằm ở Hoá đơn", () => {
    for (const n of ["lech", "can-dieu-chinh", "don-huy"] as const) expect(khuVucCuaNgan(n)).toBe("canh-bao");
    for (const n of ["cho", "nhap", "phat-hanh", "da-xuat", "khong-xuat"] as const) expect(khuVucCuaNgan(n)).toBe("hoa-don");
  });

  it("thứ tự ngăn trong khu vực theo CAC_NGAN (một nguồn thứ tự), mô tả lấy nguyên từ CAC_NGAN", () => {
    expect(nganTrongKhuVuc("hoa-don").map((n) => n.ngan)).toEqual(["cho", "nhap", "phat-hanh", "da-xuat", "khong-xuat"]);
    expect(nganTrongKhuVuc("canh-bao").map((n) => n.ngan)).toEqual(["lech", "don-huy", "can-dieu-chinh"]);
    expect(nganTrongKhuVuc("canh-bao")[0]).toBe(CAC_NGAN.find((n) => n.ngan === "lech"));
  });
});

describe("[HDNAV-03] link giữa các khu vực MANG phạm vi, BỎ dòng chọn/ngăn/trang", () => {
  const PV = { coSo: "cs1", thang: "2026-08", sapXep: "cu-nhat" as const };

  it("cơ sở + tháng + sắp xếp sang đủ ba khu vực", () => {
    expect(hrefKhuVuc("hoa-don", PV)).toBe("/payments/hoa-don?coSo=cs1&thang=2026-08&sapXep=cu-nhat");
    expect(hrefKhuVuc("canh-bao", PV)).toBe("/payments/hoa-don/canh-bao?coSo=cs1&thang=2026-08&sapXep=cu-nhat");
    expect(hrefKhuVuc("cau-hinh", PV)).toBe("/payments/hoa-don/cau-hinh?coSo=cs1&thang=2026-08&sapXep=cu-nhat");
  });

  it("đối chứng: chưa có phạm vi ⇒ đường dẫn trần, không dấu ?", () => {
    expect(hrefKhuVuc("hoa-don", { coSo: null, thang: null, sapXep: null })).toBe("/payments/hoa-don");
  });

  it("bỏ chon / ngan / trang / hoaDon: dựng từ phạm vi đã đọc, không sao chép nguyên query", () => {
    const pv = phamViTuQuery(new URLSearchParams("ngan=da-xuat&chon=dot%3Aa&trang=3&hoaDon=hd1&coSo=cs2&thang=2026-07"));
    const href = hrefKhuVuc("canh-bao", pv);
    expect(href).toBe("/payments/hoa-don/canh-bao?coSo=cs2&thang=2026-07");
    for (const k of ["ngan", "chon", "trang", "hoaDon"]) expect(href).not.toContain(`${k}=`);
  });
});

describe("[HDNAV-03b] link sang trang phụ (Chứng từ ngân hàng) cũng MANG phạm vi — lỗi G1 'đi sang trang anh em là mất cơ sở'", () => {
  it("cơ sở + tháng + sắp xếp đi theo; không mang ngăn / dòng chọn", () => {
    expect(hrefTrangPhu({ coSo: "cs1", thang: "2026-08", sapXep: "cu-nhat" })).toBe(
      "/payments/hoa-don/chung-tu-ngan-hang?coSo=cs1&thang=2026-08&sapXep=cu-nhat",
    );
  });

  it("từng thành phần đi theo ĐỘC LẬP (bỏ một thành phần là mất đúng thành phần đó)", () => {
    expect(hrefTrangPhu({ coSo: "cs2", thang: null })).toBe("/payments/hoa-don/chung-tu-ngan-hang?coSo=cs2");
    expect(hrefTrangPhu({ coSo: null, thang: "2026-07" })).toBe("/payments/hoa-don/chung-tu-ngan-hang?thang=2026-07");
  });

  it("đối chứng: chưa có phạm vi ⇒ đường dẫn trần, không dấu ?", () => {
    expect(hrefTrangPhu({ coSo: null, thang: null, sapXep: null })).toBe("/payments/hoa-don/chung-tu-ngan-hang");
  });
});

describe("[HDNAV-04] đọc phạm vi từ URL — fail-closed như docBoLoc", () => {
  it("tháng sai dạng ⇒ bỏ; sắp xếp lạ ⇒ bỏ; cơ sở rỗng/trắng ⇒ null", () => {
    expect(phamViTuQuery(new URLSearchParams("thang=2026-13&sapXep=xxx&coSo=%20"))).toEqual({ coSo: null, thang: null, sapXep: null });
    expect(phamViTuQuery(new URLSearchParams("thang=banana"))).toMatchObject({ thang: null });
  });

  it("đối chứng: giá trị hợp lệ đi qua nguyên vẹn", () => {
    expect(phamViTuQuery(new URLSearchParams("coSo=cs1&thang=2026-01&sapXep=cu-nhat"))).toEqual({ coSo: "cs1", thang: "2026-01", sapXep: "cu-nhat" });
  });
});

describe("[HDNAV-05] chọn ngăn theo khu vực — URL cũ về đúng chỗ, không đoán", () => {
  it("?ngan=lech ở khu vực Hoá đơn ⇒ báo lạc sang Cảnh báo (đường 307 cho URL cũ)", () => {
    expect(chonNganTheoKhuVuc({ tuUrl: "lech", dongDangChon: null, khuVuc: "hoa-don" })).toEqual({ ngan: "lech", lacSang: "canh-bao" });
  });

  it("không ghi ngăn ở Cảnh báo ⇒ ngăn ĐẦU của chính khu vực đó (không rơi về 'Chờ xuất' rồi bị đá đi)", () => {
    expect(chonNganTheoKhuVuc({ tuUrl: null, dongDangChon: null, khuVuc: "canh-bao" })).toEqual({ ngan: "lech", lacSang: null });
    expect(chonNganTheoKhuVuc({ tuUrl: undefined, dongDangChon: null, khuVuc: "hoa-don" })).toEqual({ ngan: "cho", lacSang: null });
  });

  it("?chon= không kèm ngăn: theo ngăn CỦA DÒNG; dòng ở khu vực kia ⇒ lạc", () => {
    expect(chonNganTheoKhuVuc({ tuUrl: null, dongDangChon: { ngan: "can-dieu-chinh" }, khuVuc: "hoa-don" })).toEqual({
      ngan: "can-dieu-chinh",
      lacSang: "canh-bao",
    });
    expect(chonNganTheoKhuVuc({ tuUrl: null, dongDangChon: { ngan: "da-xuat" }, khuVuc: "hoa-don" })).toEqual({ ngan: "da-xuat", lacSang: null });
  });

  it("ngăn lạ trên URL ⇒ coi như không ghi (không ném, không đá đi)", () => {
    expect(chonNganTheoKhuVuc({ tuUrl: "bay-ba", dongDangChon: null, khuVuc: "canh-bao" })).toEqual({ ngan: "lech", lacSang: null });
  });

  it("URL ghi ngăn thì URL thắng dòng (cùng luật chonNgan cũ)", () => {
    expect(chonNganTheoKhuVuc({ tuUrl: "nhap", dongDangChon: { ngan: "da-xuat" }, khuVuc: "hoa-don" }).ngan).toBe("nhap");
  });
});

describe("[HDNAV-06] chuyển khu vực giữ MỌI tham số (thông báo cũ `?hoaDon=` vẫn chạy)", () => {
  it("đổi đường dẫn, giữ nguyên tham số; ghi đè ngăn/cơ sở/tháng khi được yêu cầu", () => {
    expect(chuyenKhuVuc({ ngan: "lech", coSo: "cs1" }, "canh-bao")).toBe("/payments/hoa-don/canh-bao?ngan=lech&coSo=cs1");
    expect(chuyenKhuVuc({ hoaDon: "hd1" }, "hoa-don", { coSo: "cs1", thang: "2026-08" })).toBe("/payments/hoa-don?hoaDon=hd1&coSo=cs1&thang=2026-08");
  });

  it("bỏ giá trị rỗng/undefined; không tham số ⇒ đường dẫn trần", () => {
    expect(chuyenKhuVuc({ ngan: "", chon: undefined }, "canh-bao")).toBe("/payments/hoa-don/canh-bao");
  });

  it("ghi đè chỉ áp khi có giá trị (null không xoá tham số đang có)", () => {
    expect(chuyenKhuVuc({ coSo: "cs9" }, "hoa-don", { coSo: null })).toBe("/payments/hoa-don?coSo=cs9");
  });
});

describe("[HDNAV-07] tab ẩn theo quyền — kèm ĐỐI CHỨNG DƯƠNG", () => {
  it("đủ quyền ⇒ ba tab theo đúng thứ tự; KHÔNG BAO GIỜ có Nhật ký (O-6 chưa chốt)", () => {
    const ds = khuVucHienThi(QUYEN_DU);
    expect(ds.map((k) => k.nhan)).toEqual(["Hoá đơn", "Cảnh báo & sai sót", "Cấu hình"]);
    expect(KHU_VUC.some((k) => k.key === "nhat-ky")).toBe(true); // chỗ đã để sẵn…
    expect(ds.some((k) => k.key === "nhat-ky")).toBe(false); // …nhưng ẩn
  });

  it("thiếu quyền Cấu hình ⇒ không có tab Cấu hình, hai tab còn lại VẪN thấy", () => {
    const ds = khuVucHienThi({ "/payments/hoa-don": true, "/payments/hoa-don/cau-hinh": false });
    expect(ds.map((k) => k.key)).toEqual(["hoa-don", "canh-bao"]);
  });

  it("chỉ có quyền Cấu hình ⇒ chỉ tab Cấu hình", () => {
    expect(khuVucHienThi({ "/payments/hoa-don": false, "/payments/hoa-don/cau-hinh": true }).map((k) => k.key)).toEqual(["cau-hinh"]);
  });

  it("không quyền nào ⇒ rỗng", () => {
    expect(khuVucHienThi({ "/payments/hoa-don": false, "/payments/hoa-don/cau-hinh": false })).toEqual([]);
  });
});

describe("[HDNAV-08] ô tháng chỉ khi CÓ tác dụng (luật 12)", () => {
  it("chỉ ở khu vực Hoá đơn + hai ngăn sổ đã xong", () => {
    expect(coOThang("/payments/hoa-don", "da-xuat")).toBe(true);
    expect(coOThang("/payments/hoa-don", "khong-xuat")).toBe(true);
  });

  it("đối chứng: ngăn việc tồn, Cảnh báo, Cấu hình, Chứng từ, không ghi ngăn ⇒ không có ô tháng", () => {
    expect(coOThang("/payments/hoa-don", "cho")).toBe(false);
    expect(coOThang("/payments/hoa-don", null)).toBe(false);
    expect(coOThang("/payments/hoa-don/canh-bao", "da-xuat")).toBe(false);
    expect(coOThang("/payments/hoa-don/cau-hinh", "da-xuat")).toBe(false);
    expect(coOThang("/payments/hoa-don/chung-tu-ngan-hang", "da-xuat")).toBe(false);
  });
});

describe("[HDNAV-09] đổi phạm vi từ thanh phạm vi", () => {
  const PV = { coSo: "cs1", thang: "2026-08", sapXep: null };

  it("đổi cơ sở: giữ ngăn + tháng, BỎ dòng chọn (dòng của cơ sở cũ)", () => {
    expect(hrefDoiPhamVi("/payments/hoa-don", PV, "da-xuat", { coSo: "cs2" })).toBe("/payments/hoa-don?ngan=da-xuat&coSo=cs2&thang=2026-08");
  });

  it("đổi tháng về tháng mặc định ⇒ bỏ khỏi URL", () => {
    expect(hrefDoiPhamVi("/payments/hoa-don", PV, "da-xuat", { thang: null })).toBe("/payments/hoa-don?ngan=da-xuat&coSo=cs1");
  });

  it("không ghi ngăn ⇒ không tự bịa ngăn", () => {
    expect(hrefDoiPhamVi("/payments/hoa-don/cau-hinh", { coSo: null, thang: null, sapXep: null }, null, { coSo: "cs2" })).toBe(
      "/payments/hoa-don/cau-hinh?coSo=cs2",
    );
  });
});

describe("[HDNAV-10] khu vực đang mở theo đường dẫn", () => {
  it("khớp đường dẫn dài nhất; trang phụ (Chứng từ ngân hàng) thuộc khu vực Hoá đơn", () => {
    expect(khuVucDangMo("/payments/hoa-don")).toEqual({ key: "hoa-don", chinhXac: true });
    expect(khuVucDangMo("/payments/hoa-don/canh-bao")).toEqual({ key: "canh-bao", chinhXac: true });
    expect(khuVucDangMo("/payments/hoa-don/cau-hinh")).toEqual({ key: "cau-hinh", chinhXac: true });
    expect(khuVucDangMo("/payments/hoa-don/chung-tu-ngan-hang")).toEqual({ key: "hoa-don", chinhXac: false });
  });

  it("ngoài khu Hoá đơn ⇒ null (không sáng tab nào)", () => {
    expect(khuVucDangMo("/payments")).toBeNull();
    expect(khuVucDangMo("/payments/hoa-don-khac")).toBeNull();
  });
});
