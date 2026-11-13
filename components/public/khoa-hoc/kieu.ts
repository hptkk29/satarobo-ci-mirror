// Kiểu dữ liệu chung của các trang khoá học công khai (thiết kế 02/11/2026).

/** Loại khoá — quyết định nhãn "Dự án" / "Bài thực hành" và cách đếm trong bộ khám phá lộ trình. */
export type LoaiKhoa = "nam" | "luyen-thi" | "combo" | "ve-vang";

export type BaiHocNoiDung = { ten: string; loai: string };

export type HocPhanNoiDung = {
  ma: string;
  tieuDe: string;
  tomTat: string;
  ketQua: string;
  /** Chỉ khoá luyện thi mang bài học tại đây; khoá theo năm lấy từ roadmap-5-years.ts. */
  baiHoc?: BaiHocNoiDung[];
};

export type HeroKhoa =
  | { kieu: "bp"; anhBo: string; nhan: string[]; sticker: string; stickerStyle: string; stickerClass: string }
  | {
      kieu: "scoreb";
      anh: string;
      alt: string;
      sticker: string;
      stickerStyle: string;
      stickerClass: string;
      thanh: { l: string; style: string }[];
    }
  | { kieu: "ticket"; sticker: string; stickerStyle: string; stickerClass: string };

export type TrangKhoaNoiDung = {
  metaTitle: string;
  glow: string;
  nhan: string;
  h1Truoc: string;
  h1Nhan: string;
  dan: string;
  chips: string[];
  hero: HeroKhoa;
  facts: { icon: string; nhan: string }[];
  kyNangTrang: string[];
  nhanDuoc: { icon: string; tieuDe: string; moTa: string }[];
  nenGia: string;
  diemGia: string[];
  faqs: [string, string][];
  khac: { slug: string; tag: string; img: string }[];
};

export type KhoaNoiDung = {
  slug: string;
  loai: LoaiKhoa;
  ma: string;
  ten: string;
  lop: string;
  mau: string;
  maGiaoTrinh: string;
  phienBanGiaoTrinh: string;
  thietBi: string;
  moTa: string;
  suMenh: string;
  kyNang: string[];
  anhBo: string;
  thuVien: string[];
  hocPhan: HocPhanNoiDung[];
  trang: TrangKhoaNoiDung;
};

export type TheDanhSach = {
  cat: string;
  slug: string;
  code: string;
  name: string;
  img: string;
  badge: string | null;
  grade: string;
  sessions: string;
  dur: string;
  price: string;
  unit: string;
  b: [string, string, string];
};
