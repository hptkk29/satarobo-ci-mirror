/**
 * DISC — ĐƯA THÔNG TIN ĐÃ KHAI Ở TRANG CÔNG KHAI SANG TÀI KHOẢN CỔNG (05/11/2026, chủ dự án: «add bé vào cho PH · thông tin PH đã nhập và bài
 * làm ở public site thì lưu lại đưa qua site portal»).
 *
 * Trước đây nhận bài (OTP + mã) chỉ tạo `User` với SĐT + mật khẩu: tên phụ huynh nằm lại ở `Lead`, bé nằm lại trong kết quả bài, còn Sổ gia
 * đình phải dựng tay từ đầu — nên lời chào hiện «Chào Phụ huynh!» dù người đó đã gõ tên.
 *
 * Phần THUẦN (không DB): từ thứ đã khai + thứ tài khoản ĐÃ CÓ ⇒ kế hoạch ghi. Phần chạy DB: `thong-tin-sau-nhan-db.ts`.
 *
 * ⚠️ CỐ Ý KHÔNG TẠO `Student` (học viên thật). Chủ dự án chọn «làm cả ba» gồm cả tạo học viên, nhưng đo mã cho thấy bốn cái giá:
 *   1. Mọi chỗ đếm «học viên đang học» (bảng điều khiển, báo cáo) sẽ tính cả khách chỉ làm DISC — `StudentStatus` không có trạng thái «tiềm năng».
 *   2. Chốt khoá học (`findExistingStudent`) khớp học viên cũ theo TÊN + NGÀY SINH CHÍNH XÁC; bài DISC chỉ có NĂM sinh ⇒ sinh bản sao thứ hai
 *      của cùng một bé, bản cũ treo vĩnh viễn không ghi danh.
 *   3. Học viên dùng lại ở chốt khoá KHÔNG được cấp mã học viên (`studentCode`) — chỉ học viên MỚI mới gọi `genStudentCodeV2`.
 *   4. `Student.centerId` trống ⇒ vô hình với người cấp cơ sở (`scopedDb` chỉ che ĐỌC).
 * Thay vào đó bé vào `LeadChild` (đúng chỗ chốt khoá cần: `convertLeadV2` đòi `leadChildId`) và vào Sổ gia đình. Hệ quả cho cổng: tài khoản chưa
 * có học viên ⇒ vẫn là bản miễn phí (menu chỉ DISC); đăng ký khoá học xong, lúc đó hệ thống tạo học viên ⇒ cổng tự mở đủ.
 */
import { SO_THANH_VIEN_TOI_DA_SO, TEN_TOI_DA } from "./so-gia-dinh/validators";

/** Vai phụ huynh người ta chọn ở trang công khai (`VAI_TRO_PHU_HUYNH` ở `ho-so.ts`) ⇒ vai chủ sổ (`taoSoSchema`). */
export type VaiChuSo = "bo" | "me" | "nguoi-than";

export type NguoiLonDaKhai = {
  readonly ten: string;
  readonly namSinh: number | null;
  /** `DiscSubmission.consentSubjectRole`: "BO" | "ME" | "NGUOI_GIAM_HO" | null. */
  readonly vaiTro: string | null;
};
export type TreDaKhai = {
  readonly ten: string;
  readonly namSinh: number;
  /** "MN" hoặc "1".."12" (`DiscSubject.grade`). */
  readonly bacHoc: string | null;
};

export type HienCo = {
  /** `User.name` hiện tại (null/rỗng = chưa có). */
  readonly tenTaiKhoan: string | null;
  /** `LeadChild.fullName` đã có trên phiếu. Rỗng nếu bài chưa nối phiếu nào. */
  readonly conTrenPhieu: readonly string[];
  /** Có phiếu để gắn `LeadChild` không (`DiscSubmission.leadId` ≠ null). */
  readonly coPhieu: boolean;
  /** Học viên THẬT của tài khoản (có thể có khi tài khoản cũ nhận bài). */
  readonly hocVien: readonly { readonly id: string; readonly ten: string }[];
  /** Sổ gia đình hiện có; `null` = chưa có sổ. */
  readonly so: null | { readonly thanhVien: readonly { readonly ten: string }[] };
};

export type ThanhVienMoi = {
  readonly ten: string;
  readonly namSinh: number;
  /** Giá trị `LOP_HOP_LE` ("mam-non" | "1".."12") hoặc null. */
  readonly lop: string | null;
  /** Nối học viên thật khi tên khớp học viên đã có của tài khoản; còn lại null. */
  readonly studentId: string | null;
};

export type KeHoach = {
  /** Đặt `User.name` — CHỈ khi tài khoản chưa có tên (không đè tên người dùng đã sửa). */
  readonly datTenTaiKhoan: string | null;
  readonly leadChildMoi: readonly { readonly fullName: string; readonly ageYears: number | null; readonly gradeLevel: string | null; readonly note: string }[];
  /** Tạo sổ khi tài khoản chưa có sổ (chủ sổ = phụ huynh vừa khai). */
  readonly taoSo: null | { readonly tenChuSo: string; readonly vaiTroChuSo: VaiChuSo; readonly namSinhChuSo: number | null };
  readonly thanhVienMoi: readonly ThanhVienMoi[];
};

/** Chuẩn hoá tên để so khớp: bỏ dấu, hạ chữ, gộp khoảng trắng (tên «Bảo Châu» và «bao chau» là một). */
export function chuanTen(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function vaiChuSoTuVaiDaKhai(v: string | null | undefined): VaiChuSo {
  return v === "BO" ? "bo" : v === "ME" ? "me" : "nguoi-than";
}

/** `DiscSubject.grade` ("MN" | "1".."12") → mã lớp của Sổ gia đình. */
export function lopCuaSo(bacHoc: string | null | undefined): string | null {
  if (bacHoc === "MN") return "mam-non";
  return bacHoc && /^(?:[1-9]|1[0-2])$/.test(bacHoc) ? bacHoc : null;
}

/** `DiscSubject.grade` → nhãn lớp trên phiếu khách (cùng dạng ô «Lớp» của biểu mẫu liên hệ: «Lớp 4»). */
export function nhanLopTrenPhieu(bacHoc: string | null | undefined): string | null {
  if (bacHoc === "MN") return "Mầm non";
  return bacHoc && /^(?:[1-9]|1[0-2])$/.test(bacHoc) ? `Lớp ${bacHoc}` : null;
}

const cat = (s: string, n: number) => s.trim().slice(0, n);

export function keHoachSauNhan(input: {
  readonly nguoiLon: NguoiLonDaKhai | null;
  readonly tre: readonly TreDaKhai[];
  readonly hienCo: HienCo;
  /** Năm hiện tại (tính tuổi). Tiêm từ ngoài để test không đọc đồng hồ (luật 19). */
  readonly namNay: number;
}): KeHoach {
  const { nguoiLon, tre, hienCo, namNay } = input;
  const tenPh = nguoiLon?.ten.trim() ?? "";

  // 1) Tên tài khoản: chỉ điền chỗ trống.
  const datTenTaiKhoan = !(hienCo.tenTaiKhoan ?? "").trim() && tenPh ? cat(tenPh, 80) : null;

  // 2) Mỗi bé một lần (cùng bài có thể khai trùng tên ⇒ gộp).
  const daThay = new Set<string>();
  const treDuy: TreDaKhai[] = [];
  for (const t of tre) {
    const k = chuanTen(t.ten);
    if (!k || daThay.has(k)) continue;
    daThay.add(k);
    treDuy.push(t);
  }

  const hocVienTheoTen = new Map(hienCo.hocVien.map((h) => [chuanTen(h.ten), h.id]));
  const conTrenPhieu = new Set(hienCo.conTrenPhieu.map(chuanTen));
  const thanhVienCo = new Set((hienCo.so?.thanhVien ?? []).map((m) => chuanTen(m.ten)));

  const leadChildMoi: KeHoach["leadChildMoi"][number][] = [];
  const thanhVienMoi: ThanhVienMoi[] = [];
  for (const t of treDuy) {
    const k = chuanTen(t.ten);
    const hocVienId = hocVienTheoTen.get(k) ?? null;
    // Bé đã là học viên thật của tài khoản ⇒ không tạo thêm bản «tiềm năng» trên phiếu.
    if (!hocVienId && hienCo.coPhieu && !conTrenPhieu.has(k)) {
      leadChildMoi.push({
        fullName: t.ten.trim(),
        ageYears: t.namSinh >= 1920 && t.namSinh <= namNay ? namNay - t.namSinh : null,
        gradeLevel: nhanLopTrenPhieu(t.bacHoc),
        note: `Từ bài DISC trên trang công khai (năm sinh ${t.namSinh}).`,
      });
    }
    if (!thanhVienCo.has(k)) {
      thanhVienMoi.push({ ten: cat(t.ten, TEN_TOI_DA), namSinh: t.namSinh, lop: lopCuaSo(t.bacHoc), studentId: hocVienId });
    }
  }

  // 3) Sổ: chưa có thì tạo với chủ sổ = phụ huynh vừa khai (chiếm 1 chỗ); thành viên mới chỉ thêm khi còn chỗ.
  const taoSo: KeHoach["taoSo"] = hienCo.so
    ? null
    : {
        tenChuSo: cat(tenPh || "Phụ huynh", TEN_TOI_DA),
        vaiTroChuSo: vaiChuSoTuVaiDaKhai(nguoiLon?.vaiTro),
        namSinhChuSo: nguoiLon?.namSinh ?? null,
      };
  const daCoThanhVien = hienCo.so ? hienCo.so.thanhVien.length : 1; // 1 = chủ sổ sắp tạo
  const conCho = Math.max(0, SO_THANH_VIEN_TOI_DA_SO - daCoThanhVien);

  return { datTenTaiKhoan, leadChildMoi, taoSo, thanhVienMoi: thanhVienMoi.slice(0, conCho) };
}
