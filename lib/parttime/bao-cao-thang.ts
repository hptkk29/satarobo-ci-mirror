// lib/parttime/bao-cao-thang.ts — P5d · TỔNG HỢP THÁNG công Parttime theo người (QLCS + giáo viên). THUẦN.
//
// TỔNG = CHI TIẾT theo cấu trúc: mỗi chỉ số giữ DANH SÁCH dòng nguồn của nó, con số hiển thị là độ dài / tổng của chính danh
// sách đó, và màn "xem chi tiết" in đúng danh sách ấy. Không có con số nào tính riêng một đường rồi kể lại một đường khác.
//
// Không tính TIỀN CUỐI: có đơn vị (tiết, ca trực), đơn giá chụp sẵn, và các khoản điều chỉnh tách riêng (đề xuất / đã xác nhận).
// Thực lĩnh = việc của bảng lương, chưa làm.
import type { DongTruc } from "./truc-van-hanh-db";
import type { DongDieuChinhThang } from "./bao-cao-thang-kieu";

export type { DongDieuChinhThang } from "./bao-cao-thang-kieu";

export const CHI_SO = [
  "mainThuong",
  "mainDayThay",
  "mainHocBu",
  "mainHocVuot",
  "mainKhac",
  "troGiang",
  "trucDu",
  "trucNua",
  "trucKhong",
  "diMuon",
  "veSom",
  "thieuNhanXet",
  "nopTre",
  "deXuat",
  "daXacNhanTru",
  "ngoaiLe",
  "choXacNhan",
  "donViCu",
] as const;
export type ChiSo = (typeof CHI_SO)[number];
export const laChiSo = (x: string | undefined | null): x is ChiSo => !!x && (CHI_SO as readonly string[]).includes(x);

export const NHAN_CHI_SO: Record<ChiSo, string> = {
  mainThuong: "Đứng chính — lớp thường",
  mainDayThay: "Đứng chính — dạy thay",
  mainHocBu: "Đứng chính — học bù",
  mainHocVuot: "Đứng chính — học vượt",
  mainKhac: "Đứng chính — khác",
  troGiang: "Trợ giảng",
  trucDu: "Trực đủ ca (1,0)",
  trucNua: "Trực nửa ca (0,5)",
  trucKhong: "Trực, đơn vị 0 (≥ 2 tiết)",
  diMuon: "Đi muộn",
  veSom: "Về sớm",
  thieuNhanXet: "Thiếu nhận xét (quá 10:00)",
  nopTre: "Nhận xét nộp trễ",
  deXuat: "Khoản trừ đang đề xuất",
  daXacNhanTru: "Khoản trừ đã xác nhận",
  ngoaiLe: "Ngoại lệ cần xem",
  choXacNhan: "Chờ QLCS xác nhận",
  donViCu: "Đơn vị cũ — phải xác nhận lại",
};

export type DongTongHop = {
  userId: string;
  /** Mỗi chỉ số: các KHOÁ dòng (assignmentId cho tiết, dutyId cho trực, id khoản cho điều chỉnh). */
  ds: Record<ChiSo, string[]>;
  soTiet: number;
  phutChuanDay: number;
  donViTruc: number;
  phutCoMatTruc: number;
  tienDeXuat: number;
  tienDaXacNhan: number;
};

const rong = (): Record<ChiSo, string[]> => Object.fromEntries(CHI_SO.map((k) => [k, [] as string[]])) as Record<ChiSo, string[]>;

/** Đơn vị dạy mồ côi (phân công đã bị thay / huỷ) — vẫn phải hiện, không được rơi khỏi báo cáo. */
export type DonViMoCoi = { id: string; userId: string; assignmentId: string | null; workUnitType: string; quantity: string; standardMinutes: number; hieuLuc: "CONFIRMED" | "STALE" | "VOIDED" };
/** Khoản trừ có phân công KHÔNG còn trong tập đọc (bị thay / huỷ) — vẫn là khoản của người đó. */
export type KhoanMoCoi = { id: string; userId: string; amount: number; status: string };

/**
 * `day` = các dòng đối soát dạy của tháng (kèm nhận xét + điều chỉnh) · `truc` = các dòng trực · `moCoi` / `khoanMoCoi` = đơn vị
 * và khoản trừ mà phân công của chúng không còn trong tập đọc. BẮT BUỘC cả bốn (luật 7): bỏ sót một nguồn là một đơn vị chưa VOID
 * hay một khoản trừ sống lặng lẽ biến khỏi báo cáo (`[P5-RDB-05]`). Trả MỘT dòng mỗi người có bất kỳ dữ liệu nào.
 */
export function tongHopThang(day: readonly DongDieuChinhThang[], truc: readonly DongTruc[], moCoi: readonly DonViMoCoi[], khoanMoCoi: readonly KhoanMoCoi[]): DongTongHop[] {
  const theoNguoi = new Map<string, DongTongHop>();
  const cua = (userId: string) => {
    let r = theoNguoi.get(userId);
    if (!r) theoNguoi.set(userId, (r = { userId, ds: rong(), soTiet: 0, phutChuanDay: 0, donViTruc: 0, phutCoMatTruc: 0, tienDeXuat: 0, tienDaXacNhan: 0 }));
    return r;
  };
  const khoan = (r: DongTongHop, a: { id: string; amount: number; status: string }) => {
    if (a.status === "PROPOSED") {
      r.ds.deXuat.push(a.id);
      r.tienDeXuat += a.amount;
    } else if (a.status === "CONFIRMED") {
      r.ds.daXacNhanTru.push(a.id);
      r.tienDaXacNhan += a.amount;
    }
  };

  for (const x of day) {
    const d = x.dong;
    const lop = d.ungVien.lop;
    const dv = d.donVi;
    // Dòng không áp dụng (TRIAL, buổi huỷ, LEGACY) chỉ bỏ qua khi KHÔNG mang đơn vị hay khoản trừ nào — buổi bị huỷ SAU khi đã
    // xác nhận vẫn có một đơn vị (nay cũ) phải hiện.
    if (lop === "KHONG_AP_DUNG" && !dv && x.dieuChinh.length === 0) continue;
    const r = cua(d.bc.userId);
    const k = d.bc.assignmentId;
    if (dv?.hieuLuc === "CONFIRMED") {
      if (dv.workUnitType === "ASSISTANT_TEACHING") r.ds.troGiang.push(k);
      else if (d.bc.activity === "MAKEUP") r.ds.mainHocBu.push(k);
      else if (d.bc.activity === "ADVANCE") r.ds.mainHocVuot.push(k);
      else if (x.assignmentType === "SUBSTITUTE") r.ds.mainDayThay.push(k);
      else if (d.bc.activity === "REGULAR_CLASS") r.ds.mainThuong.push(k);
      else r.ds.mainKhac.push(k);
      r.soTiet += Number(dv.quantity);
      r.phutChuanDay += dv.standardMinutes;
    } else if (dv?.hieuLuc === "STALE") {
      r.ds.donViCu.push(k);
    } else if (lop === "TU_DONG" || lop === "XEM_TAY") {
      r.ds.choXacNhan.push(k);
    }
    if (lop !== "KHONG_AP_DUNG") {
      if ((lop === "XEM_TAY" || lop === "CHAN") && dv?.hieuLuc !== "CONFIRMED" && d.xacNhan?.decision !== "REJECTED") r.ds.ngoaiLe.push(k);
      if (lop !== "CHUA_XONG" && d.bc.diMuon) r.ds.diMuon.push(k);
      if (lop !== "CHUA_XONG" && d.bc.raSom) r.ds.veSom.push(k);
      if (x.nhanXet?.trangThai === "MISSING") r.ds.thieuNhanXet.push(k);
      if (x.nhanXet?.trangThai === "LATE") r.ds.nopTre.push(k);
    }
    for (const a of x.dieuChinh) khoan(r, a);
  }

  for (const w of moCoi) {
    if (w.hieuLuc === "VOIDED") continue;
    const r = cua(w.userId);
    const k = w.assignmentId ?? w.id;
    if (w.hieuLuc === "STALE") r.ds.donViCu.push(k);
    else {
      // Kỳ đã khoá: đơn vị mồ côi vẫn là ảnh chụp đã chốt ⇒ vẫn tính (không biết hoạt động gốc ⇒ "khác").
      (w.workUnitType === "ASSISTANT_TEACHING" ? r.ds.troGiang : r.ds.mainKhac).push(k);
      r.soTiet += Number(w.quantity);
      r.phutChuanDay += w.standardMinutes;
    }
  }
  for (const a of khoanMoCoi) khoan(cua(a.userId), a);

  for (const t of truc) {
    if (t.danhGia.lop === "KHONG_AP_DUNG" && !t.donVi) continue;
    const r = cua(t.userId);
    r.phutCoMatTruc += t.danhGia.phutCoMatTrongCa;
    if (t.donVi?.hieuLuc === "CONFIRMED") {
      (t.donVi.quantity === "1" ? r.ds.trucDu : r.ds.trucNua).push(t.dutyId);
      r.donViTruc += Number(t.donVi.quantity);
    } else if (t.donVi?.hieuLuc === "STALE") {
      r.ds.donViCu.push(t.dutyId);
    } else if (t.xacNhan?.decision === "CONFIRMED" && t.danhGia.donViTra === "0") {
      r.ds.trucKhong.push(t.dutyId);
    } else if (t.danhGia.lop === "TU_DONG" || t.danhGia.lop === "XEM_TAY") {
      r.ds.choXacNhan.push(t.dutyId);
    } else if (t.danhGia.lop === "CHAN") {
      r.ds.ngoaiLe.push(t.dutyId);
    }
  }
  return [...theoNguoi.values()];
}

/** Số hiển thị của một chỉ số = độ dài danh sách (tiền: tổng khoản — vẫn đọc từ chính danh sách đó). */
export const soCua = (r: DongTongHop, k: ChiSo) => r.ds[k].length;
