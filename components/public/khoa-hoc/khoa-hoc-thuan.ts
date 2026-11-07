// Hàm THUẦN của các trang khoá học công khai (không DB, không React) — test ở khoa-hoc-thuan.test.ts.
import { dinhDangTien } from "@/lib/gia-cong-khai";
import type { BaiHocNoiDung, KhoaNoiDung, LoaiKhoa, TheDanhSach } from "./kieu";

export const BASE_URL = "https://satarobo.vn";

/** Khoá theo năm: 12 tháng × 4 buổi. Học phí tháng = học phí năm / 12. */
export const SO_THANG_TRONG_NAM = 12;
/** Mỗi buổi 90 phút = 1,5 giờ. */
export const GIO_MOI_BUOI = 1.5;

export function giaThangTuNam(giaNam: number): number {
  return Math.round(giaNam / SO_THANG_TRONG_NAM);
}

export type NhanGia = {
  /** "880.000đ" */
  so: string;
  /** "/tháng" */
  donVi: string;
  /** "880.000đ/tháng" — dùng ở thẻ thông tin và nút. */
  ngan: string;
};

const DON_VI_THEO_LOAI: Record<LoaiKhoa, string> = {
  nam: "/tháng",
  "luyen-thi": "/khoá",
  combo: "/combo",
  "ve-vang": "/gói",
};

/** Nhãn giá của một trang khoá. `giaNiemYet` là học phí NIÊM YẾT cả khoá (năm / combo / gói). */
export function nhanGia(loai: LoaiKhoa, giaNiemYet: number): NhanGia {
  const donVi = DON_VI_THEO_LOAI[loai];
  const so = dinhDangTien(loai === "nam" ? giaThangTuNam(giaNiemYet) : giaNiemYet);
  return { so, donVi, ngan: `${so}${donVi}` };
}

/** Dòng ghi chú dưới số tiền ở khối học phí (trang chi tiết). */
export function ghiChuGia(slug: string, loai: LoaiKhoa, giaNiemYet: number): string {
  if (loai === "nam") {
    return `Trọn năm ${dinhDangTien(giaNiemYet)} · ${SO_THANG_TRONG_NAM} tháng × 4 buổi · đã gồm VAT · hỗ trợ trả góp`;
  }
  if (slug === "sata1") return "Đã gồm VAT · 11 buổi tính phí + 5 buổi luyện đề miễn phí";
  if (slug === "sata2") return "Đã gồm VAT · combo Sata1 + Sata2 tiết kiệm hơn";
  if (loai === "combo") return "Đã gồm VAT · ~147.000đ/buổi · tiết kiệm 704.000đ";
  return "Đã gồm VAT · cam kết hoàn tiền bằng văn bản";
}

/** Giá + đơn vị dài + ghi chú ở bộ khám phá lộ trình ("/khoá · 16 buổi"). */
export function giaBoKhamPha(slug: string, loai: LoaiKhoa, giaNiemYet: number, tongBuoi: number) {
  const nh = nhanGia(loai, giaNiemYet);
  const donVi = loai === "nam" ? nh.donVi : `${nh.donVi} · ${tongBuoi} buổi`;
  let ghiChu: string;
  if (loai === "nam") ghiChu = ghiChuGia(slug, loai, giaNiemYet);
  else if (slug === "sata1") ghiChu = "11 buổi tính phí + 5 buổi luyện đề miễn phí · đã gồm VAT";
  else if (slug === "sata2") ghiChu = "Đã gồm VAT · combo Sata1 + Sata2 tiết kiệm hơn";
  else if (loai === "combo") ghiChu = "~147.000đ/buổi · tiết kiệm 704.000đ · đã gồm VAT";
  else ghiChu = "Hoàn 100% nếu không vượt vòng loại";
  return { so: nh.so, donVi, ghiChu };
}

/** Số giờ học, dấu phẩy thập phân kiểu Việt ("7,5"). */
export function soGio(soBuoi: number): string {
  return String(soBuoi * GIO_MOI_BUOI).replace(".", ",");
}

/** "16 buổi · 24 giờ" */
export function nhanThoiLuong(tongBuoi: number): string {
  return `${tongBuoi} buổi · ${soGio(tongBuoi)} giờ`;
}

// ─── Bộ khám phá lộ trình ───────────────────────────────────────────────────────────────

export type BaiHocHienThi = BaiHocNoiDung;
export type HocPhanHienThi = {
  ma: string;
  tieuDe: string;
  tomTat: string;
  ketQua: string;
  baiHoc: BaiHocHienThi[];
};

/** Lớp CSS của nhãn loại buổi (màu theo loại). */
export function lopNhanBuoi(loai: string): string {
  if (loai.indexOf("Ôn tập") === 0) return "stag t-on";
  if (loai.indexOf("Demo") === 0) return "stag t-demo";
  if (loai.indexOf("Báo cáo") === 0) return "stag t-bc";
  if (loai.indexOf("Dự án cuối") === 0) return "stag t-end";
  if (loai === "Giải đề") return "stag t-de";
  if (loai === "Thi thử") return "stag t-thi";
  if (loai === "Lý thuyết" || loai === "Kiểm tra") return "stag t-lt";
  return "stag";
}

export type ThongKeHocPhan = {
  soBuoi: number;
  gio: string;
  soDuAn: number;
  nhanDuAn: string;
  tieuDeBai: string;
  tieuDeKetQua: string;
};

/**
 * Số liệu một học phần. Khoá theo năm đếm buổi "Dự án"; khoá luyện thi đếm thêm "Giải đề" và
 * "Thi thử" vì đó là bài thực hành của khoá thi.
 */
export function thongKeHocPhan(baiHoc: BaiHocHienThi[], theoNam: boolean): ThongKeHocPhan {
  const loaiDem = theoNam ? ["Dự án"] : ["Dự án", "Giải đề", "Thi thử"];
  return {
    soBuoi: baiHoc.length,
    gio: soGio(baiHoc.length),
    soDuAn: baiHoc.filter((b) => loaiDem.includes(b.loai)).length,
    nhanDuAn: theoNam ? "Dự án" : "Bài thực hành",
    tieuDeBai: `Nội dung chi tiết ${baiHoc.length} buổi`,
    tieuDeKetQua: theoNam ? "Sản phẩm / thành tích cuối học phần" : "Kết quả sau giai đoạn",
  };
}

export function tongBuoiCuaKhoa(hocPhan: { baiHoc: unknown[] }[]): number {
  return hocPhan.reduce((a, p) => a + p.baiHoc.length, 0);
}

/** Phần trăm đã đi qua của thanh tiến trình học phần (0 ở học phần đầu, 100 ở học phần cuối). */
export function phanTramTienTrinh(chiSo: number, tong: number): number {
  return tong > 1 ? Math.round((chiSo / (tong - 1)) * 100) : 100;
}

/** Giữ chỉ số trong [0, tong-1]. */
export function gioiHanChiSo(chiSo: number, tong: number): number {
  if (tong <= 0) return 0;
  return Math.min(Math.max(chiSo, 0), tong - 1);
}

type GiaoTrinhNam = { modules: { sessionList: { content: string; type: string }[] }[] };

/**
 * Dựng danh sách học phần hiển thị: tiêu đề / tóm tắt / kết quả của học phần lấy từ nội dung thiết
 * kế; TÊN BÀI của khoá theo năm lấy từ giáo trình (`roadmap-5-years.ts`), khoá luyện thi mang bài
 * học trong nội dung. Thiếu giáo trình của khoá theo năm ⇒ học phần rỗng bài, không bịa.
 */
export function dungHocPhan(nd: KhoaNoiDung, giaoTrinhNam: GiaoTrinhNam | null): HocPhanHienThi[] {
  return nd.hocPhan.map((hp, i) => {
    const tuGiaoTrinh = giaoTrinhNam?.modules[i]?.sessionList.map((s) => ({ ten: s.content, loai: s.type }));
    return {
      ma: hp.ma,
      tieuDe: hp.tieuDe,
      tomTat: hp.tomTat,
      ketQua: hp.ketQua,
      baiHoc: hp.baiHoc ?? tuGiaoTrinh ?? [],
    };
  });
}

// ─── Danh sách khoá ─────────────────────────────────────────────────────────────────────

export function locThe<T extends { cat: string }>(the: T[], tab: string): T[] {
  return tab === "all" ? the : the.filter((t) => t.cat === tab);
}

/** Lớp thẻ lọc: đang chọn thêm "on". */
export function lopTabLoc(tab: string, dangChon: string): string {
  return tab === dangChon ? "pill on" : "pill";
}

/** Thẻ gộp nhiều khoá (Sata4·Sata6, Sata5·Sata7) lấy giá của khoá nhỏ nhất, kèm hậu tố "+". */
const KHOA_CUA_THE: Record<string, string[]> = {
  sata4: ["sata4", "sata6"],
  sata5: ["sata5", "sata7"],
};

/**
 * Giá in trên thẻ danh sách. Có giá thật (theo slug) thì tính từ đó; thiếu thì GIỮ chuỗi gốc của
 * thiết kế — không bịa. Khoá theo năm in học phí THÁNG.
 */
export function giaTheDanhSach(the: TheDanhSach, gia: Record<string, number>): { so: string; donVi: string } {
  const slugs = KHOA_CUA_THE[the.slug] ?? [the.slug];
  const co = slugs.map((s) => gia[s]).filter((v): v is number => typeof v === "number" && v > 0);
  if (co.length === 0) return { so: the.price, donVi: the.unit };
  const nho = Math.min(...co);
  const theoNam = the.unit === DON_VI_THEO_LOAI.nam;
  const hauTo = the.price.endsWith("+") ? "+" : "";
  return { so: dinhDangTien(theoNam ? giaThangTuNam(nho) : nho) + hauTo, donVi: the.unit };
}

// ─── JSON-LD ────────────────────────────────────────────────────────────────────────────

export function jsonLdKhoa(nd: KhoaNoiDung, giaNiemYet: number, moTaNgan: string) {
  const url = `${BASE_URL}/khoa-hoc/${nd.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "EducationalOrganization", "@id": `${BASE_URL}/#org`, name: "Sata Robo", url: `${BASE_URL}/` },
      {
        "@type": "Course",
        name: `${nd.ma} – ${nd.ten}`,
        description: moTaNgan,
        provider: { "@id": `${BASE_URL}/#org` },
        inLanguage: "vi-VN",
        educationalLevel: nd.lop,
        offers: {
          "@type": "Offer",
          price: String(giaNiemYet),
          priceCurrency: "VND",
          category: "Paid",
          url,
        },
        hasCourseInstance: { "@type": "CourseInstance", courseMode: "onsite" },
      },
      {
        "@type": "FAQPage",
        mainEntity: nd.trang.faqs.map(([q, a]) => ({
          "@type": "Question",
          name: q,
          acceptedAnswer: { "@type": "Answer", text: a },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${BASE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Khoá học", item: `${BASE_URL}/khoa-hoc` },
          { "@type": "ListItem", position: 3, name: nd.ma, item: url },
        ],
      },
    ],
  };
}

export function jsonLdDanhSach(muc: { name: string; description: string }[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${BASE_URL}/khoa-hoc#webpage`,
        url: `${BASE_URL}/khoa-hoc`,
        name: "Khoá học Robotics & STEM — Sata Robo Đà Nẵng",
        inLanguage: "vi-VN",
      },
      {
        "@type": "ItemList",
        itemListElement: muc.map((m, i) => ({
          "@type": "ListItem",
          position: i + 1,
          item: {
            "@type": "Course",
            name: m.name,
            description: m.description,
            provider: { "@id": `${BASE_URL}/#org` },
            inLanguage: "vi",
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${BASE_URL}/` },
          { "@type": "ListItem", position: 2, name: "Khoá học", item: `${BASE_URL}/khoa-hoc` },
        ],
      },
    ],
  };
}

/** Mô tả meta của trang chi tiết: tên, đối tượng, thời lượng, học phí. */
export function moTaMetaKhoa(nd: KhoaNoiDung, tongBuoi: number, giaNgan: string): string {
  return `${nd.ma} ${nd.ten}: ${nd.lop}, ${nhanThoiLuong(tongBuoi)}, học phí ${giaNgan}. Học thử 1-1 miễn phí.`;
}
