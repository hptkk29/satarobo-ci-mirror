// lib/bao-luu/mau-don.ts — phần THUẦN của "Đơn đăng ký bảo lưu khóa học" (Phụ lục 02, SR.QD.236.002).
// Không DB, không file, không DOM: client import được kiểu + hàm điền sẵn; server/route dùng cùng một bộ giá trị.
//
// MỘT BỘ GIÁ TRỊ cho cả hai đầu ra (bản in trên màn + file .docx): `DonBaoLuu` là thứ Sale thấy và sửa trong khối
// "Đơn bảo lưu", và là thứ route nhận lại để điền .docx. Server KHÔNG tính lại từ DB lúc xuất — nếu tính lại thì giấy
// và file có thể ghi hai nội dung khác nhau cho cùng một đơn (cùng họ lỗi "hai nguồn" của mã QR 24/09).
//
// MẪU THEO CƠ SỞ, KHÔNG THEO TRẠNG THÁI: hai cơ sở là HAI PHÁP NHÂN khác nhau (STEM Robotics & AI · New Vision) nên
// tên công ty, MST, địa chỉ, "Kính gửi" khác nhau. Khoá tra là `Center.code`. Cơ sở chưa có mẫu ⇒ `mauTheoMaCoSo` trả
// null và nút In/Tải bị khoá kèm lý do — KHÔNG rơi về mẫu của cơ sở khác (in sai pháp nhân lên giấy tờ ký là lỗi pháp lý).
// Mở cơ sở mới = thêm MỘT tệp .docx vào `lib/bao-luu/mau-don/` + MỘT dòng ở `MAU_DON`.
import { z } from "zod";
import type { LyDoBaoLuu } from "@/lib/bao-luu/hoso";
import { CHIEU_RONG_COT_PT, LE_CHAM_PT, doRongPt } from "@/lib/bao-luu/mau-don-do-rong";

export const MA_MAU_DON = ["CS1", "CS2"] as const;
export type MaMauDon = (typeof MA_MAU_DON)[number];

export type ThongTinMau = {
  /** Tên tệp .docx trong `lib/bao-luu/mau-don/` (tên ASCII — repo + CI gương không ưa dấu cách/dấu tiếng Việt). */
  tep: string;
  /** Dòng đầu trang (header): công ty · MST · địa chỉ · hotline · email — đúng chữ trong mẫu .docx. */
  dauTrang: { congTy: string; mst: string; diaChi: string; hotline: string; email: string };
  /** `CÔNG TY CỔ PHẦN …` in hoa ở góc trái và ở "Kính gửi". */
  congTyHoa: string;
  /** Dòng ngoặc dưới "Kính gửi". */
  trungTam: string;
  /** Cuối trang (footer). */
  chanTrang: string;
};

export const MAU_DON: Record<MaMauDon, ThongTinMau> = {
  CS1: {
    tep: "SR.QD.236.002-CS1.docx",
    dauTrang: {
      congTy: "Công Ty Cổ Phần Công Nghệ Giáo Dục STEM Robotics & AI",
      mst: "0402341056",
      diaChi: "211 Nguyễn Hữu Thọ, Phường Hòa Cường, Thành phố Đà Nẵng",
      hotline: "0818.823.720",
      email: "ketoan.cs1@satarobo.vn",
    },
    congTyHoa: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC STEM ROBOTICS & AI",
    trungTam: "(Trung tâm Sata Robo – Cơ sở 1 – 211 Nguyễn Hữu Thọ)",
    chanTrang: "Mã tài liệu: SR.QD.236.002   |   Hệ thống đào tạo Sata Robo – Cơ sở 1 – 211 Nguyễn Hữu Thọ",
  },
  CS2: {
    tep: "SR.QD.236.002-CS2.docx",
    dauTrang: {
      congTy: "Công Ty Cổ Phần Công Nghệ Giáo Dục New Vision",
      mst: "0402341070",
      diaChi: "114 - 116 Hoàng Diệu, Phường Hải Châu, Thành phố Đà Nẵng",
      hotline: "0702.193.933",
      email: "ketoan.cs2@satarobo.vn",
    },
    congTyHoa: "CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC NEW VISION",
    trungTam: "(Trung tâm Sata Robo – Cơ sở 2 – 114 - 116 Hoàng Diệu)",
    chanTrang: "Mã tài liệu: SR.QD.236.002   |   Hệ thống đào tạo Sata Robo – Cơ sở 2 – 114 - 116 Hoàng Diệu",
  },
};

/** Mẫu của một cơ sở theo `Center.code`; cơ sở chưa có mẫu (hoặc chưa có mã) ⇒ null. KHÔNG có đường lùi. */
export function mauTheoMaCoSo(maCoSo: string | null | undefined): MaMauDon | null {
  const ma = (maCoSo ?? "").trim().toUpperCase();
  return (MA_MAU_DON as readonly string[]).includes(ma) ? (ma as MaMauDon) : null;
}

export const LOI_CHUA_CO_MAU_DON =
  "Cơ sở này chưa có mẫu đơn bảo lưu (SR.QD.236.002). Báo người vận hành bổ sung mẫu trước khi in.";

/** Năm ô chọn trên mẫu giấy, theo thứ tự. Mỗi lý do trong hệ thống ứng với đúng MỘT ô. */
export const NHAN_O_TREN_DON: Record<LyDoBaoLuu, string> = {
  ILLNESS: "Ốm đau, sức khỏe (*)",
  FAMILY: "Gia đình có việc dài ngày",
  RELOCATION: "Đi xa, chuyển nơi ở tạm thời",
  SCHEDULE: "Lịch học chính khóa/lịch cá nhân thay đổi",
  OTHER: "Lý do khác:",
};

/** Thứ tự các ô như in trên mẫu (hai cột đọc từ trái sang phải, rồi "khác"). */
export const THU_TU_Y_DO: readonly LyDoBaoLuu[] = ["ILLNESS", "FAMILY", "RELOCATION", "SCHEDULE", "OTHER"];

const chuoi = (max: number) => z.string().trim().max(max);

/** Mọi ô chữ trên đơn. Chuỗi rỗng = để chấm chấm cho phụ huynh/Quản lý tự điền tay. */
export const donBaoLuuSchema = z.object({
  phuHuynh: z.object({ hoTen: chuoi(120), quanHe: chuoi(60), dienThoai: chuoi(40), email: chuoi(120) }),
  hocVien: z.object({ hoTen: chuoi(120), ngaySinh: chuoi(20), ma: chuoi(40), khoa: chuoi(300), lop: chuoi(300), giaoVien: chuoi(300) }),
  /**
   * Danh sách khoá in NGAY DƯỚI mục II khi một ô (Khóa học / Lớp / Giáo viên) quá dài và chỉ ghi `CAU_XEM_DANH_SACH`.
   * Mỗi phần tử là một dòng đã dựng sẵn. In hay không do `coDanhSachKhoa` quyết (xem bên dưới), không do độ dài mảng.
   */
  danhSachKhoa: z.array(chuoi(300)).max(20),
  /** Có thể tích nhiều ô như trên giấy. */
  lyDo: z.array(z.enum(["ILLNESS", "FAMILY", "RELOCATION", "SCHEDULE", "OTHER"])).max(5),
  lyDoKhac: chuoi(300),
  thoiGian: z.object({ baoLuuTu: chuoi(20), hocLaiDuKien: chuoi(20), nghiTuNgay: chuoi(20) }),
});
export type DonBaoLuu = z.infer<typeof donBaoLuuSchema>;

/** `yyyy-MM-dd` (ô `type=date`) → `dd/MM/yyyy`. Không đúng hình dạng thì giữ nguyên (người dùng có thể đã gõ tay). */
export function ngayTrenDon(ymd: string | null | undefined): string {
  const s = (ymd ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/**
 * Mỗi ô chấm chấm của mẫu: chữ nhãn (đúng như trong .docx) và cột nó nằm. Cột 1 = trái (rộng 244pt), 2 = phải (218pt), 0 = cả dòng.
 * Một giá trị VỪA ô khi nhãn + giá trị + chỗ chừa cho đường chấm không vượt cột (`vuaOGiay`). Dài hơn thì Word đẩy tab sang dòng
 * khác và đơn lệch/tràn trang — ô khoá/lớp/giáo viên khi ấy chỉ ghi `CAU_XEM_DANH_SACH` và danh sách đủ in ngay dưới mục II.
 * ⚠️ Ngưỡng là ĐỘ RỘNG theo từng ô, không phải số ký tự chung: "Giáo viên phụ trách: " ăn gần nửa cột phải (còn ~22 ký tự),
 * "Mã học viên: " còn ~45. Đếm ký tự chung đã làm đơn 2 khoá ngắn tràn sang trang hai khi in từ Word (đo 13/10/2026).
 */
export const O_GIAY = {
  "ph.hoTen": { nhan: "Họ và tên: ", cot: 1 },
  "ph.quanHe": { nhan: "Quan hệ với học viên: ", cot: 2 },
  "ph.dienThoai": { nhan: "Số điện thoại / Zalo: ", cot: 1 },
  "ph.email": { nhan: "Email: ", cot: 2 },
  "hv.hoTen": { nhan: "Họ và tên học viên: ", cot: 1 },
  "hv.ngaySinh": { nhan: "Ngày sinh: ", cot: 2 },
  "hv.ma": { nhan: "Mã học viên: ", cot: 1 },
  "hv.khoa": { nhan: "Khóa học: ", cot: 2 },
  "hv.lop": { nhan: "Lớp đang học: ", cot: 1 },
  "hv.giaoVien": { nhan: "Giáo viên phụ trách: ", cot: 2 },
  "lyDoKhac": { nhan: "☐ Lý do khác: ", cot: 0 },
  "tg.baoLuuTu": { nhan: "Bảo lưu từ ngày: ", cot: 1 },
  "tg.hocLaiDuKien": { nhan: "Dự kiến học lại (nếu có): ", cot: 2 },
  "tg.nghiTuNgay": { nhan: "Học viên đã nghỉ từ ngày (nếu bảo lưu lùi, tối đa 02 buổi): ", cot: 0 },
} as const satisfies Record<string, { nhan: string; cot: 0 | 1 | 2 }>;
export type TruongO = keyof typeof O_GIAY;

/** Giá trị có VỪA ô chấm chấm của trường này trên mẫu giấy không (Word không phải tự lệch dòng). */
export function vuaOGiay(truong: TruongO, giaTri: string): boolean {
  const o = O_GIAY[truong];
  return doRongPt(o.nhan) + doRongPt(giaTri.trim()) + LE_CHAM_PT <= CHIEU_RONG_COT_PT[o.cot];
}

export const CAU_XEM_DANH_SACH = "Xem danh sách khoá bên dưới";
/**
 * Bản rút gọn của câu trỏ, CHỈ cho ô quá hẹp để chứa cả câu đầy đủ. Đo 13/10/2026: "Giáo viên phụ trách: " chừa ~110pt còn câu đầy đủ
 * cần 145pt — nếu để nguyên, chính câu trỏ làm Word xuống dòng và đơn tràn sang trang hai (đúng lỗi nó sinh ra để tránh).
 */
export const CAU_XEM_DANH_SACH_NGAN = "Xem bên dưới";
export const laCauTro = (s: string): boolean => s.trim() === CAU_XEM_DANH_SACH || s.trim() === CAU_XEM_DANH_SACH_NGAN;
/** Giá trị ghi vào một ô: chính nó nếu vừa; không thì câu trỏ đầy đủ nếu vừa; không thì câu rút gọn. */
export function giaTriVuaO(truong: TruongO, giaTri: string): string {
  if (vuaOGiay(truong, giaTri)) return giaTri;
  return vuaOGiay(truong, CAU_XEM_DANH_SACH) ? CAU_XEM_DANH_SACH : CAU_XEM_DANH_SACH_NGAN;
}
export const TIEU_DE_DANH_SACH_KHOA = "Danh sách khóa học bảo lưu:";

/** Một dòng của danh sách khoá in dưới mục II: "Sata 3 (lớp CS1.03) — GV: Lê Nhật Thuận". */
export function dongDanhSachKhoa(g: { tenKhoa: string; maLop: string; giaoVien: string | null }): string {
  const gv = (g.giaoVien ?? "").trim();
  return `${g.tenKhoa} (lớp ${g.maLop})${gv ? ` — GV: ${gv}` : ""}`;
}

/**
 * Danh sách khoá có được IN không: chỉ khi MỘT trong ba ô còn đúng câu trỏ. Sale sửa tay ô thành chữ khác thì không còn gì để
 * trỏ — danh sách không in (in mà không ô nào nhắc tới là một khối chữ lạc chỗ trên giấy tờ ký). Một nguồn cho bản in, .docx, màn hình.
 */
export function coDanhSachKhoa(don: Pick<DonBaoLuu, "hocVien" | "danhSachKhoa">): boolean {
  const { khoa, lop, giaoVien } = don.hocVien;
  return don.danhSachKhoa.some((d) => d.trim()) && [khoa, lop, giaoVien].some(laCauTro);
}

/**
 * Số khoá tối đa trong danh sách mà đơn còn vừa MỘT trang A4 (đo bằng Word thật 13/10/2026, cả CS1 và CS2: 4 khoá vừa, 5 khoá sang
 * trang hai). Quá ngưỡng vẫn in được nhưng thành hai tờ — form báo trước để Sale chia đơn hoặc chấp nhận.
 */
export const TOI_DA_KHOA_MOT_TRANG = 4;
export function danhSachQuaMotTrang(don: Pick<DonBaoLuu, "hocVien" | "danhSachKhoa">): boolean {
  return coDanhSachKhoa(don) && don.danhSachKhoa.filter((d) => d.trim()).length > TOI_DA_KHOA_MOT_TRANG;
}

/** Gộp các giá trị khác nhau của nhiều khoá thành một ô ("Sata 3; Sata 4"); bỏ trống/trùng. */
export function gopGiaTri(giaTri: readonly (string | null | undefined)[]): string {
  const ra: string[] = [];
  for (const g of giaTri) {
    const s = (g ?? "").trim();
    if (s && !ra.includes(s)) ra.push(s);
  }
  return ra.join("; ");
}

export type DauVaoDienSan = {
  hocVien: { hoTen: string; ma: string | null; ngaySinh: string | null };
  phuHuynh: { hoTen: string | null; quanHe: string | null; dienThoai: string | null; email: string | null };
  /**
   * Chỉ các khoá đang được chọn trên form (một hồ sơ mỗi khoá, một đơn cho cả lượt lập).
   * `tenLop` = tên đầy đủ (dùng khi chỉ MỘT khoá); `maLop` = mã lớp ngắn (dùng khi nhiều khoá: "Sata 3 (lớp CS1.03)").
   */
  khoaDaChon: readonly { tenKhoa: string; tenLop: string; maLop: string; giaoVien: string | null }[];
  lyDo: LyDoBaoLuu | null;
  ghiChu: string;
  /** Ba ô ngày của form lập, dạng `yyyy-MM-dd` hoặc rỗng. */
  ngayHenBatDau: string;
  ngayQuayLai: string;
  ngayNghiDau: string;
};

/**
 * Giá trị điền sẵn từ những gì Sale đã nhập trên form lập.
 *
 * KHÔNG điền (để giấy trống, có chủ đích):
 *  · "Bảo lưu từ ngày": chỉ điền khi Sale HẸN ngày. Không hẹn = bắt đầu lúc Quản lý duyệt, ngày chưa tồn tại.
 *  · "Ngày … tháng … năm" cuối đơn: phụ huynh tự ghi lúc ký.
 *  · Toàn bộ "Phần dành cho Trung tâm" (mã ghi danh, ngày duyệt, số buổi còn lại, học phí còn lại, hạn, công nợ): các số đó
 *    CHỤP LÚC DUYỆT. Điền số ước tính lên tờ đã ký là tạo ra con số thứ hai lệch với hồ sơ.
 *  · "Lý do khác": chỉ khi lý do là OTHER (ghi chú tự do của form thuộc về lý do đó, không phải của ô khác).
 */
export function dienSanDon(v: DauVaoDienSan): DonBaoLuu {
  const chon = v.khoaDaChon;
  const nhieu = chon.length > 1;
  // Một khoá: ghi tên khoá / tên lớp như cũ. Nhiều khoá: MỖI khoá ghi kèm lớp của nó — "Sata 3 (lớp CS1.03); Sata 4 (lớp CS1.05)".
  const khoa = nhieu ? gopGiaTri(chon.map((g) => `${g.tenKhoa} (lớp ${g.maLop})`)) : gopGiaTri(chon.map((g) => g.tenKhoa));
  // Một khoá: tên lớp đầy đủ; dài quá ô thì lùi về MÃ LỚP (đủ định danh một lớp, thường vừa) trước khi phải dùng danh sách.
  const lop = gopGiaTri(chon.map((g) => (nhieu || !vuaOGiay("hv.lop", g.tenLop) ? g.maLop : g.tenLop)));
  const giaoVien = gopGiaTri(chon.map((g) => g.giaoVien));
  // Ô quá dài thì KHÔNG để Word tự lệch dòng: ô chỉ ghi câu trỏ, danh sách đủ in ngay dưới mục II.
  const o = { khoa: giaTriVuaO("hv.khoa", khoa), lop: giaTriVuaO("hv.lop", lop), giaoVien: giaTriVuaO("hv.giaoVien", giaoVien) };
  const canDanhSach = Object.values(o).some(laCauTro);
  return {
    phuHuynh: {
      hoTen: (v.phuHuynh.hoTen ?? "").trim(),
      quanHe: (v.phuHuynh.quanHe ?? "").trim(),
      dienThoai: (v.phuHuynh.dienThoai ?? "").trim(),
      email: (v.phuHuynh.email ?? "").trim(),
    },
    hocVien: {
      hoTen: v.hocVien.hoTen.trim(),
      ngaySinh: ngayTrenDon(v.hocVien.ngaySinh),
      ma: (v.hocVien.ma ?? "").trim(),
      khoa: o.khoa,
      lop: o.lop,
      giaoVien: o.giaoVien,
    },
    danhSachKhoa: canDanhSach ? chon.map(dongDanhSachKhoa) : [],
    lyDo: v.lyDo ? [v.lyDo] : [],
    lyDoKhac: v.lyDo === "OTHER" ? v.ghiChu.trim() : "",
    thoiGian: {
      baoLuuTu: ngayTrenDon(v.ngayHenBatDau),
      hocLaiDuKien: ngayTrenDon(v.ngayQuayLai),
      nghiTuNgay: ngayTrenDon(v.ngayNghiDau),
    },
  };
}
