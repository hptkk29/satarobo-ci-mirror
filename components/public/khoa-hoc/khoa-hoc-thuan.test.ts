import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { roadmap5Years } from "@/components/legacy-laptrinhrobot/_data/roadmap-5-years";
import { ANH_KHOA_HOC } from "./anh-khoa-hoc";
import {
  dungHocPhan,
  ghiChuGia,
  giaBoKhamPha,
  giaTheDanhSach,
  giaThangTuNam,
  gioiHanChiSo,
  jsonLdDanhSach,
  jsonLdKhoa,
  locThe,
  lopNhanBuoi,
  lopTabLoc,
  nhanGia,
  nhanThoiLuong,
  phanTramTienTrinh,
  soGio,
  thongKeHocPhan,
  tongBuoiCuaKhoa,
} from "./khoa-hoc-thuan";
import { DANH_SACH_THE, NOI_DUNG_KHOA, THU_TU_KHOA_NAM, THU_TU_KHOA_THI } from "./noi-dung-khoa";
import { st } from "./st";

const SLUGS = [...THU_TU_KHOA_NAM, ...THU_TU_KHOA_THI];

function giaoTrinhNam(slug: string) {
  return roadmap5Years.find((r) => r.productCode.toLowerCase() === slug) ?? null;
}

describe("[KH-01] học phí hiển thị", () => {
  it("khoá theo năm in học phí THÁNG = học phí năm / 12", () => {
    expect(giaThangTuNam(10_560_000)).toBe(880_000);
    expect(nhanGia("nam", 10_560_000).ngan).toBe("880.000đ/tháng");
    expect(nhanGia("nam", 14_400_000).ngan).toBe("1.200.000đ/tháng");
  });
  it("khoá luyện thi in giá niêm yết kèm đơn vị đúng loại", () => {
    expect(nhanGia("luyen-thi", 2_400_000).ngan).toBe("2.400.000đ/khoá");
    expect(nhanGia("combo", 4_690_000).ngan).toBe("4.690.000đ/combo");
    expect(nhanGia("ve-vang", 2_500_000).ngan).toBe("2.500.000đ/gói");
  });
  it("ghi chú giá của khoá theo năm tính từ giá năm, không gõ cứng", () => {
    expect(ghiChuGia("sata3", "nam", 10_560_000)).toBe("Trọn năm 10.560.000đ · 12 tháng × 4 buổi · đã gồm VAT · hỗ trợ trả góp");
    expect(ghiChuGia("sata4", "nam", 11_520_000)).toContain("11.520.000đ");
  });
  it("bộ khám phá ghép đơn vị với số buổi cho khoá không theo năm", () => {
    expect(giaBoKhamPha("sata1", "luyen-thi", 2_400_000, 16)).toEqual({
      so: "2.400.000đ",
      donVi: "/khoá · 16 buổi",
      ghiChu: "11 buổi tính phí + 5 buổi luyện đề miễn phí · đã gồm VAT",
    });
    expect(giaBoKhamPha("sata3", "nam", 10_560_000, 48).donVi).toBe("/tháng");
  });
});

describe("[KH-02] thời lượng", () => {
  it("giờ học = buổi × 1,5, dấu phẩy kiểu Việt", () => {
    expect(soGio(48)).toBe("72");
    expect(soGio(5)).toBe("7,5");
    expect(nhanThoiLuong(16)).toBe("16 buổi · 24 giờ");
    expect(nhanThoiLuong(5)).toBe("5 buổi · 7,5 giờ");
  });
});

describe("[KH-03] nhãn loại buổi và thống kê học phần", () => {
  it("lớp nhãn theo loại buổi", () => {
    expect(lopNhanBuoi("Dự án")).toBe("stag");
    expect(lopNhanBuoi("Ôn tập kiến thức")).toBe("stag t-on");
    expect(lopNhanBuoi("Demo cuối học phần")).toBe("stag t-demo");
    expect(lopNhanBuoi("Báo cáo cuối học phần")).toBe("stag t-bc");
    expect(lopNhanBuoi("Dự án cuối học phần")).toBe("stag t-end");
    expect(lopNhanBuoi("Giải đề")).toBe("stag t-de");
    expect(lopNhanBuoi("Thi thử")).toBe("stag t-thi");
    expect(lopNhanBuoi("Lý thuyết")).toBe("stag t-lt");
    expect(lopNhanBuoi("Kiểm tra")).toBe("stag t-lt");
  });
  it("khoá theo năm chỉ đếm 'Dự án'; khoá luyện thi đếm thêm Giải đề và Thi thử", () => {
    const bai = [
      { ten: "a", loai: "Dự án" },
      { ten: "b", loai: "Giải đề" },
      { ten: "c", loai: "Thi thử" },
      { ten: "d", loai: "Ôn tập" },
    ];
    expect(thongKeHocPhan(bai, true)).toMatchObject({ soBuoi: 4, gio: "6", soDuAn: 1, nhanDuAn: "Dự án" });
    expect(thongKeHocPhan(bai, false)).toMatchObject({ soDuAn: 3, nhanDuAn: "Bài thực hành", tieuDeKetQua: "Kết quả sau giai đoạn" });
  });
  it("thanh tiến trình và chỉ số học phần", () => {
    expect(phanTramTienTrinh(0, 4)).toBe(0);
    expect(phanTramTienTrinh(1, 4)).toBe(33);
    expect(phanTramTienTrinh(3, 4)).toBe(100);
    expect(phanTramTienTrinh(0, 1)).toBe(100);
    expect(gioiHanChiSo(9, 4)).toBe(3);
    expect(gioiHanChiSo(-2, 4)).toBe(0);
    expect(gioiHanChiSo(5, 0)).toBe(0);
  });
});

describe("[KH-04] giáo trình: tên bài đi theo nguồn", () => {
  it("Sata3–7: 4 học phần × 12 buổi lấy từ roadmap-5-years.ts, đúng tên bài của nguồn", () => {
    for (const slug of THU_TU_KHOA_NAM) {
      const hp = dungHocPhan(NOI_DUNG_KHOA[slug], giaoTrinhNam(slug));
      expect(hp, slug).toHaveLength(4);
      expect(tongBuoiCuaKhoa(hp), slug).toBe(48);
      const goc = giaoTrinhNam(slug)!;
      expect(hp[0].baiHoc[0].ten, slug).toBe(goc.modules[0].sessionList[0].content);
      expect(hp[3].baiHoc[11].loai, slug).toBe(goc.modules[3].sessionList[11].type);
    }
  });
  it("thiếu giáo trình của khoá theo năm ⇒ học phần rỗng bài, KHÔNG bịa", () => {
    const hp = dungHocPhan(NOI_DUNG_KHOA.sata3, null);
    expect(hp.every((p) => p.baiHoc.length === 0)).toBe(true);
  });
  it("khoá luyện thi mang bài học trong nội dung: Sata1/2 = 16, Combo = 32, Sata8 = 5", () => {
    const dem = (s: string) => tongBuoiCuaKhoa(dungHocPhan(NOI_DUNG_KHOA[s], null));
    expect(dem("sata1")).toBe(16);
    expect(dem("sata2")).toBe(16);
    expect(dem("combo-sata1-sata2")).toBe(32);
    expect(dem("sata8")).toBe(5);
  });
  it("tiêu đề học phần khớp số học phần của giáo trình", () => {
    for (const slug of THU_TU_KHOA_NAM) expect(NOI_DUNG_KHOA[slug].hocPhan, slug).toHaveLength(giaoTrinhNam(slug)!.modules.length);
  });
});

describe("[KH-05] nội dung các trang khoá nhất quán", () => {
  it("mỗi khoá đủ 4 thẻ, 4 ý ở khối học phí, 3 khoá khác, đủ câu hỏi", () => {
    for (const slug of SLUGS) {
      const t = NOI_DUNG_KHOA[slug].trang;
      expect(t.nhanDuoc, slug).toHaveLength(4);
      expect(t.facts, slug).toHaveLength(4);
      expect(t.diemGia, slug).toHaveLength(4);
      expect(t.khac, slug).toHaveLength(3);
      expect(t.faqs.length, slug).toBeGreaterThanOrEqual(3);
      expect(t.chips, slug).toHaveLength(3);
    }
  });
  it("màu trang (vầng sáng, nền hộp giá) cùng một nguồn với màu khoá", () => {
    for (const slug of SLUGS) {
      const nd = NOI_DUNG_KHOA[slug];
      expect(nd.trang.glow, slug).toBe(`${nd.mau}55`);
      expect(nd.trang.nenGia, slug).toContain(`${nd.mau}33`);
    }
  });
  it("khoá theo năm có 8 kỹ năng trên trang; khoá luyện thi thì không có khối kỹ năng", () => {
    for (const slug of THU_TU_KHOA_NAM) expect(NOI_DUNG_KHOA[slug].trang.kyNangTrang, slug).toHaveLength(8);
    for (const slug of THU_TU_KHOA_THI) expect(NOI_DUNG_KHOA[slug].trang.kyNangTrang, slug).toHaveLength(0);
  });
  it("liên kết 'khoá khác' trỏ tới trang có thật", () => {
    const co = new Set([...SLUGS, "laptrinhrobot", "luyenthirobosim"]);
    for (const slug of SLUGS) for (const k of NOI_DUNG_KHOA[slug].trang.khac) expect(co.has(k.slug), `${slug} → ${k.slug}`).toBe(true);
  });
  it("loại khoá khớp bố cục hero", () => {
    expect(NOI_DUNG_KHOA.sata3.trang.hero.kieu).toBe("bp");
    expect(NOI_DUNG_KHOA.sata1.trang.hero.kieu).toBe("scoreb");
    expect(NOI_DUNG_KHOA["combo-sata1-sata2"].trang.hero.kieu).toBe("scoreb");
    expect(NOI_DUNG_KHOA.sata8.trang.hero.kieu).toBe("ticket");
  });
});

describe("[KH-06] danh sách khoá", () => {
  it("lọc theo thẻ", () => {
    expect(locThe(DANH_SACH_THE, "all")).toHaveLength(8);
    expect(locThe(DANH_SACH_THE, "chuyen-sau").map((t) => t.slug)).toEqual(["sata3", "sata4", "sata5"]);
    expect(locThe(DANH_SACH_THE, "luyen-thi")).toHaveLength(4);
    expect(locThe(DANH_SACH_THE, "online").map((t) => t.slug)).toEqual(["luyenthirobosim"]);
  });
  it("lớp của thẻ lọc đang chọn", () => {
    expect(lopTabLoc("all", "all")).toBe("pill on");
    expect(lopTabLoc("online", "all")).toBe("pill");
  });
  it("giá thẻ: khoá theo năm in học phí tháng, thẻ gộp lấy khoá nhỏ nhất kèm '+'", () => {
    const the = (s: string) => DANH_SACH_THE.find((t) => t.slug === s)!;
    const gia = { sata3: 10_560_000, sata4: 11_520_000, sata6: 13_440_000, sata5: 12_480_000, sata7: 14_400_000, sata1: 2_400_000 };
    expect(giaTheDanhSach(the("sata3"), gia)).toEqual({ so: "880.000đ", donVi: "/tháng" });
    expect(giaTheDanhSach(the("sata4"), gia)).toEqual({ so: "960.000đ+", donVi: "/tháng" });
    expect(giaTheDanhSach(the("sata5"), gia)).toEqual({ so: "1.040.000đ+", donVi: "/tháng" });
    expect(giaTheDanhSach(the("sata1"), gia)).toEqual({ so: "2.400.000đ", donVi: "/khoá" });
  });
  it("thiếu giá thật ⇒ giữ chuỗi của thiết kế (không in số lạ)", () => {
    const the = DANH_SACH_THE.find((t) => t.slug === "sata3")!;
    expect(giaTheDanhSach(the, {})).toEqual({ so: the.price, donVi: the.unit });
  });
});

describe("[KH-07] JSON-LD", () => {
  it("trang khoá: Course có Offer đúng giá niêm yết, FAQPage và breadcrumb 3 cấp", () => {
    const nd = NOI_DUNG_KHOA.sata3;
    const ld = jsonLdKhoa(nd, 10_560_000, "mô tả");
    const g = ld["@graph"];
    const course = g.find((x) => x["@type"] === "Course") as { offers: { price: string; priceCurrency: string; url: string } };
    expect(course.offers).toMatchObject({ price: "10560000", priceCurrency: "VND", url: "https://satarobo.vn/khoa-hoc/sata3" });
    const faq = g.find((x) => x["@type"] === "FAQPage") as { mainEntity: unknown[] };
    expect(faq.mainEntity).toHaveLength(nd.trang.faqs.length);
    const bc = g.find((x) => x["@type"] === "BreadcrumbList") as { itemListElement: { name: string }[] };
    expect(bc.itemListElement.map((x) => x.name)).toEqual(["Trang chủ", "Khoá học", "Sata3"]);
  });
  it("trang danh sách: ItemList đánh số từ 1 và có breadcrumb", () => {
    const ld = jsonLdDanhSach([
      { name: "A", description: "a" },
      { name: "B", description: "b" },
    ]);
    const list = ld["@graph"].find((x) => x["@type"] === "ItemList") as { itemListElement: { position: number }[] };
    expect(list.itemListElement.map((x) => x.position)).toEqual([1, 2]);
    expect(ld["@graph"].some((x) => x["@type"] === "BreadcrumbList")).toBe(true);
  });
});

describe("[KH-08] ảnh: mọi mã ảnh dùng trong nội dung có tệp thật", () => {
  const thuMuc = resolve(process.cwd(), "public/images/khoa-hoc");
  const maDung = new Set<string>();
  for (const nd of Object.values(NOI_DUNG_KHOA)) {
    maDung.add(nd.anhBo);
    nd.thuVien.forEach((h) => maDung.add(h));
    const hero = nd.trang.hero;
    maDung.add(hero.sticker);
    if (hero.kieu === "bp") maDung.add(hero.anhBo);
    if (hero.kieu === "scoreb") maDung.add(hero.anh);
    nd.trang.khac.forEach((k) => maDung.add(k.img));
  }
  DANH_SACH_THE.forEach((t) => maDung.add(t.img));

  it("mỗi mã có kích thước đã đo và tệp nằm trong public/images/khoa-hoc", () => {
    for (const h of maDung) {
      const a = ANH_KHOA_HOC[h];
      expect(a, h).toBeDefined();
      expect(a.w, h).toBeGreaterThan(0);
      expect(a.h, h).toBeGreaterThan(0);
      expect(existsSync(resolve(thuMuc, `${h}.${a.ext}`)), h).toBe(true);
    }
  });
  it("bảng kích thước không còn mã mồ côi không có tệp", () => {
    const co = new Set(readdirSync(thuMuc).map((f) => f.replace(/\.\w+$/, "")));
    for (const h of Object.keys(ANH_KHOA_HOC)) expect(co.has(h), h).toBe(true);
  });
});

describe("[KH-09] st(): chuỗi CSS của thiết kế → style React", () => {
  it("đổi tên thuộc tính, giữ biến CSS, tách đúng dấu ; trong hàm", () => {
    expect(st("display: flex; gap: 10px")).toEqual({ display: "flex", gap: "10px" });
    expect(st("--c: #fe8f2d")).toEqual({ "--c": "#fe8f2d" });
    expect(st("-webkit-text-fill-color: var(--muted)")).toEqual({ WebkitTextFillColor: "var(--muted)" });
    expect(st("background: url(data:image/png;base64,AAAA); color: red")).toEqual({ background: "url(data:image/png;base64,AAAA)", color: "red" });
  });
  it("cùng một chuỗi trả cùng một đối tượng (nhớ đệm)", () => {
    expect(st("margin: 0")).toBe(st("margin: 0"));
  });
});

describe("[KH-10] lưới ghim mã: không <img> trần, dangerouslySetInnerHTML chỉ ở JSON-LD", () => {
  const thuMuc = resolve(process.cwd(), "components/public/khoa-hoc");
  const tep = readdirSync(thuMuc).filter((f) => f.endsWith(".tsx"));
  it("mọi tệp .tsx của khu này dùng next/image qua <Anh>, không <img", () => {
    for (const f of tep) {
      const nd = readFileSync(resolve(thuMuc, f), "utf8");
      expect(/<img\b/.test(nd), f).toBe(false);
    }
  });
  it("dangerouslySetInnerHTML chỉ có ở json-ld.tsx", () => {
    for (const f of tep) {
      const nd = readFileSync(resolve(thuMuc, f), "utf8");
      expect(nd.includes("dangerouslySetInnerHTML"), f).toBe(f === "json-ld.tsx");
    }
  });
});
