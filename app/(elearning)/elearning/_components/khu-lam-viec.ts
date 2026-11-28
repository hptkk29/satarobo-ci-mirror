// Đường dẫn nào thuộc KHU nào của e-learning: Nhân viên (người học) hay Quản trị. Hàm THUẦN.
//
// Thiết kế 17/11/2026 đòi hai khung RIÊNG (HANDOFF §3.1): nhân viên có thanh trên một hàng + thanh dưới điện thoại, quản trị
// có thanh bên. KẾ HOẠCH nêu cách `git mv` trang vào route group `(nhan-vien)` / `(quan-tri)`; lượt này chọn CHỌN KHUNG THEO
// PHÂN ĐOẠN ĐƯỜNG DẪN thay vì dời tệp (DECISIONS.md D-03): ~30 tệp test/lib đang ghim đường dẫn thư mục trang, dời là đổi
// hàng loạt thứ không đổi hành vi. Người dùng thấy đúng hai khung, URL không đổi; dời tệp vẫn làm được sau như một PR thuần.
//
// ⚠️ Mặc định cho phân đoạn LẠ là NHÂN VIÊN, không phải quản trị: fail-closed về phía khung ít quyền nhất — một route mới
// quên khai báo không bao giờ làm lộ thanh bên quản trị cho người học. Lưới `khu-lam-viec.test.ts` đọc thư mục thật và ĐỎ
// nếu có thư mục trang chưa được phân loại, nên "quên khai báo" không âm thầm trượt xuống mặc định.
import { chuanHoaDuongDan } from "./menu";

export type KhuLamViec = "nhan-vien" | "quan-tri";

/** Phân đoạn đầu (sau `/elearning/`) của các trang người học. Trang gốc `/elearning` (Tổng quan) cũng là nhân viên. */
export const DOAN_NHAN_VIEN: readonly string[] = [
  "khoa-cua-toi",
  "de-nghi",
  "hoc",
  "chung-nhan-cua-toi",
  "du-lieu-cua-toi",
  "tim-kiem",
  "huong-dan", // P8 — hướng dẫn cho nhân viên
  "thong-bao", // dùng chung hai vai; khung theo khu người dùng đang đứng là việc của Q20 — hiện rơi về nhân viên
];

/** Phân đoạn đầu của các trang quản trị. */
export const DOAN_QUAN_TRI: readonly string[] = [
  "bao-cao",
  "bao-cao-r4",
  "bao-cao-r5",
  "bao-cao-r7",
  "cham-bai",
  "cham-bai-tap",
  "chung-nhan",
  "chuong-trinh",
  "dao-tao",
  "de-thi",
  "giao-bai",
  "huong-dan-quan-tri", // P8 — hướng dẫn cho quản trị
  "kho-cau-hoi",
  "khung-cham",
  "luot-giao",
  "ma-tran",
  "muc-danh-gia",
  "nguoi-hoc", // P7 — người học (nhân viên): tiến độ gom theo từng người
  "online", // E-learning Online thương mại (ADR 0005)
  "soan",
  "soan-khoa",
  "tu-dong-hoa",
  "yeu-cau",
];

export function khuCuaDuongDan(duongDan: string): KhuLamViec {
  const p = chuanHoaDuongDan(duongDan);
  const doan = p.split("/")[2]; // "", "elearning", <doan đầu>, …
  if (doan && DOAN_QUAN_TRI.includes(doan)) return "quan-tri";
  return "nhan-vien";
}
