/**
 * Xem trước một lượt "mở lớp cho cả kỳ" — ĐẾM số lớp sẽ mở TRƯỚC khi bấm.
 *
 * Vì sao có hàm này (23/09/2026, đợt thiết kế lại màn `/lop-trial/moi`): một lượt bấm
 * có thể đẻ hàng chục lớp cho nhiều cơ sở. Trước đây người dùng chỉ biết con số SAU khi
 * lớp đã sinh ra, và muốn sửa thì phải huỷ từng lớp một.
 *
 * Hàm này đi ĐÚNG đường server đi (`taoLopTrialTheoThuAction`): cùng `sinhNgayTheoThu`,
 * cùng cổng khung giờ theo thứ (`khungChoNgay` + `kiemKhungLop`), cùng khoá khử trùng
 * (ngày × giờ bắt đầu × giờ kết thúc, trong MỘT cơ sở). Bản xem trước lệch server là
 * lời hứa suông (luật 12) — nên nó dùng lại hàm, không chép luật.
 *
 * Không tính được thứ server mới biết: lỗi ghi DB, quyền theo cơ sở. Đó là lý do màn
 * vẫn liệt kê dòng "bỏ qua" do server trả về sau khi bấm.
 */
import { vnWeekday, vnYmd } from "@/lib/time/vn";
import {
  khungChoNgay,
  kiemKhungLop,
  sinhNgayTheoThu,
  TEN_THU,
  THU_KHOA,
  type CauHinhKhung,
  type QuyTacKy,
} from "./khung-gio-mo-lop";

export type XemTruocTuyChon = {
  /** Số lớp tuỳ chọn này mở ra ở MỘT cơ sở (đã trừ ngày trùng tuỳ chọn trước). */
  soLop: number;
  /** Số ngày khớp thứ nhưng bị cổng khung giờ loại. */
  boQua: number;
  /** Tuỳ chọn không sinh được ngày nào — câu nói vì sao. */
  loi: string | null;
};

export type XemTruocKy = {
  /** Lỗi của CẢ lượt (khoảng ngày sai…). Có giá trị thì các số còn lại đều 0. */
  loi: string | null;
  theoTuyChon: XemTruocTuyChon[];
  /** Số lớp ở MỘT cơ sở. */
  moiCoSo: number;
  /** Tổng số lớp = `moiCoSo × soCoSo`. */
  tong: number;
  /** Ngày sớm nhất / muộn nhất sẽ có lớp ("YYYY-MM-DD"), để in "từ … đến …". */
  ngayDau: string | null;
  ngayCuoi: string | null;
};

/** "YYYY-MM-DD" (ngày VN) → mốc UTC 00:00 — đúng cách server đọc ngày (`ngayVnSangUtc`). */
function docNgay(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

const RONG: Omit<XemTruocKy, "loi"> = {
  theoTuyChon: [],
  moiCoSo: 0,
  tong: 0,
  ngayDau: null,
  ngayCuoi: null,
};

export function xemTruocMoKy(input: {
  tu: string;
  den: string;
  quyTac: readonly QuyTacKy[];
  /** Số cơ sở áp dụng — BẮT BUỘC (luật 7): mặc định 1 là đếm thiếu khi chọn nhiều cơ sở. */
  soCoSo: number;
  cauHinh: CauHinhKhung;
}): XemTruocKy {
  const tu = docNgay(input.tu);
  const den = docNgay(input.den);
  if (!tu || !den) return { loi: "Chọn đủ ngày bắt đầu và ngày kết thúc", ...RONG };
  if (input.den < input.tu) return { loi: "Ngày kết thúc phải sau ngày bắt đầu", ...RONG };

  const daMo = new Set<string>();
  const cacNgay: string[] = [];
  const theoTuyChon: XemTruocTuyChon[] = input.quyTac.map((qt) => {
    if (!qt.startTime || !qt.endTime) {
      return { soLop: 0, boQua: 0, loi: qt.thu.length === 0 ? "Chưa chọn thứ" : "Chưa có khung giờ" };
    }
    const ngays = sinhNgayTheoThu({ tu, den, thu: qt.thu });
    if (!ngays.ok) return { soLop: 0, boQua: 0, loi: ngays.loi };
    let soLop = 0;
    let boQua = 0;
    for (const ngay of ngays.ngay) {
      const ymd = vnYmd(ngay);
      const khoa = `${ymd}|${qt.startTime}|${qt.endTime}`;
      if (daMo.has(khoa)) continue;
      const khung = khungChoNgay(ngay, input.cauHinh);
      const tenThu = TEN_THU[THU_KHOA[vnWeekday(ngay)]!] ?? "Ngày này";
      const kiem = khung.ok
        ? kiemKhungLop({ khungHopLe: khung.giaTri, startTime: qt.startTime, endTime: qt.endTime, tenThu })
        : { ok: false as const };
      if (!kiem.ok) {
        boQua += 1;
        continue;
      }
      daMo.add(khoa);
      cacNgay.push(ymd);
      soLop += 1;
    }
    return { soLop, boQua, loi: null };
  });

  const moiCoSo = theoTuyChon.reduce((s, t) => s + t.soLop, 0);
  cacNgay.sort();
  return {
    loi: null,
    theoTuyChon,
    moiCoSo,
    tong: moiCoSo * Math.max(0, input.soCoSo),
    ngayDau: cacNgay[0] ?? null,
    ngayCuoi: cacNgay[cacNgay.length - 1] ?? null,
  };
}
