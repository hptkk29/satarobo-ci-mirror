// Bảng ánh xạ trang artifact -> route Next.js (mục [4] của brief PUB-V2).
// `:first` = tự lấy liên kết đầu tiên của trang danh sách (tin tức / tuyển dụng) làm trang chi tiết mẫu.
// Mobile-* KHÔNG có ở đây: trang thật là responsive, một trang cho mọi khổ.
export const KHOA_HOC = ["sata1", "sata2", "sata3", "sata4", "sata5", "sata6", "sata7", "sata8", "combo-sata1-sata2", "laptrinhrobot", "luyenthirobosim"];
export const CHINH_SACH = [
  "cac-dieu-kien-va-han-che",
  "chinh-sach",
  "chinh-sach-bao-mat",
  "chinh-sach-cham-dut-dich-vu",
  "chinh-sach-gia",
  "chinh-sach-giao-hang",
  "chinh-sach-hoan-tra",
  "chinh-sach-thanh-toan",
  "dieu-khoan-su-dung",
  "phuong-thuc-cung-cap-dich-vu",
  "phuong-thuc-tiep-nhan-phan-anh",
  "quyen-rieng-tu",
  "quyen-va-nghia-vu-cac-ben",
];

/** @type {Record<string, string>} */
export const PAGES = {
  Main: "/",
  About: "/ve-chung-toi",
  Courses: "/khoa-hoc",
  News: "/tin-tuc",
  NewsDetail: "/tin-tuc/:first",
  Careers: "/tuyen-dung",
  JobDetail: "/tuyen-dung/:first",
  Contact: "/lien-he",
  Disc: "/disc",
  "Disc-LamBai": "/disc/bat-dau",
  "Disc-NhanKetQua": "/kich-hoat?disc=1",
  Login: "/login",
  Register: "/dang-ky",
  Activate: "/kich-hoat",
  Forgot: "/quen-mat-khau",
  // đường dẫn không tồn tại -> not-found.tsx
  NotFound: "/khong-co-trang-nay-pub-v2",
  ...Object.fromEntries(KHOA_HOC.map((s) => [`KhoaHoc-${s}`, `/khoa-hoc/${s}`])),
  ...Object.fromEntries(CHINH_SACH.map((s) => [`ChinhSach-${s}`, `/${s}`])),
};
