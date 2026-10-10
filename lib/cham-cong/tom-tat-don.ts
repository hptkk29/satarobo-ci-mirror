// lib/cham-cong/tom-tat-don.ts — MỘT CÂU tiếng Việt nói đơn xin gì, và "khi duyệt sẽ" làm gì.
//
// Vì sao file này tồn tại (chủ dự án 06/10/2026: *"các đơn từ, làm rõ hơn cho QLCS đọc dễ hiểu
// hơn"*): màn duyệt cũ bày đơn thành từng mảnh — cột "Loại", cột "Áp dụng", cột "Thay đổi"
// (`S → CG`), rồi mở panel mới thấy lý do. Người duyệt phải tự ghép mảnh thành câu. Ở đây ghép
// sẵn: "Nguyễn A xin nghỉ phép năm 2 ngày (12–13/10), người làm thay: Trần B (ca S)".
//
// MỘT nguồn cho mọi nơi in câu đó: màn duyệt `/don-tu` (dòng bảng + panel), "Đơn của tôi" ở
// admin + site GV, phần TÓM TẮT trước khi gửi của form nộp, và nội dung thông báo gửi người
// duyệt. Hai bản câu là hai cách hiểu một đơn.
//
// THUẦN — không DB, không `server-only`: form nộp (client) gọi trực tiếp. Mọi tên/mã đã được
// chỗ gọi tra sẵn; thiếu thì câu nói "chưa chọn" chứ không đoán.
//
// ⚠️ LUẬT 12 — `khiDuyetSe` phải nói ĐÚNG việc đường duyệt làm (`decideRequest` +
// `duyetDayThay` — lib/cham-cong/don/lop-hoc.ts). Chế độ ghi đè/ghi thêm của chỉnh công KHÔNG tính lại ở đây:
// chỗ gọi truyền `cheDo` lấy từ `cheDoChoDon` — đúng hàm đường duyệt dùng.
import { vnYmd } from "@/lib/time/vn";
import { maNghiTrenLuoi } from "@/lib/work-request";
import { chuanHoaMoc, huongCuaViTri, type CheDoChinhTay } from "./sua-gio-quet";

/** Dữ liệu đã tra sẵn của MỘT đơn. Mọi trường nullable — đơn cũ/khuyết vẫn phải in được. */
export type DonDeTomTat = {
  kind: string;
  /** `WorkRequest.fromDate` (`@db.Date`, nửa đêm UTC) — hoặc ngày dựng từ "YYYY-MM-DD" ở form. */
  fromDate: Date | null;
  toDate: Date | null;
  startTime: string | null;
  endTime: string | null;
  className: string | null;
  /** `WorkRequest.detail` — đi muộn/về sớm, "Nơi đến: …". */
  detail: string | null;
  /** [Vào 1, Ra 1, Vào 2, Ra 2] "HH:mm" — chỉ chỉnh công. */
  moc: readonly (string | null | undefined)[];
  /** Tên loại nghỉ (`LeaveType.name`) + tỉ lệ lương để nói mã P/X. */
  leaveName: string | null;
  leavePaidRatio: number | null;
  /**
   * Nghỉ / nghỉ bù (đợt 7–8): cả ngày · nửa sáng · nửa chiều · theo giờ. BẮT BUỘC khai (kể cả null) —
   * thiếu là câu tóm tắt nói "nghỉ cả ngày" cho đơn nghỉ 2 tiếng (luật 12).
   */
  leaveDurationType: string | null;
  /** Mã ca mới người nộp xin (đổi ca). */
  newShiftCode: string | null;
  /** Người nhận ca / làm thay / dạy thay. */
  targetName: string | null;
  /** Mã ca chọn cho người nhận/làm thay — null = đơn KHÔNG chọn ⇒ lịch của họ giữ nguyên. */
  targetShiftCode: string | null;
};

export type TuyChonTomTat = {
  /**
   * Chế độ của đơn chỉnh công khi duyệt — `cheDoChoDon(moc, soMocCuaCa(soCapQuetKyVong))`.
   * `null`/bỏ trống = chưa biết ca ngày đó (form, ngày ngoài cửa sổ đã nạp) ⇒ câu nói chung.
   */
  cheDo?: CheDoChinhTay | null;
  /** Số lượt quét CÒN TÍNH của ngày (`LUOT_CON_TINH`); `null` = chưa đọc. */
  soLuotConTinh?: number | null;
};

const NGAY_MS = 86_400_000;

/** `@db.Date` là nửa đêm UTC ⇒ +12h rồi đọc lịch VN (cùng mẹo `requests.ts`) — không lệch ngày. */
function ymd(d: Date): string {
  return vnYmd(new Date(d.getTime() + 12 * 3_600_000));
}

/** "05/10" — ngày/tháng, không năm (đơn từ gần như luôn trong năm hiện hành). */
export function nhanNgay(d: Date | null): string {
  if (!d) return "(chưa chọn ngày)";
  const [, m, dd] = ymd(d).split("-");
  return `${dd}/${m}`;
}

/** Số ngày của khoảng (cả hai đầu). Thiếu đầu nào ⇒ 1. */
export function soNgayDon(from: Date | null, to: Date | null): number {
  if (!from || !to) return 1;
  const n = Math.round((Date.parse(`${ymd(to)}T00:00:00Z`) - Date.parse(`${ymd(from)}T00:00:00Z`)) / NGAY_MS) + 1;
  return n > 0 ? n : 1;
}

/** "05/10" · "12–13/10" · "30/09–02/10". */
export function nhanKhoangNgay(from: Date | null, to: Date | null): string {
  if (!from) return "(chưa chọn ngày)";
  if (!to || ymd(to) === ymd(from)) return nhanNgay(from);
  const [y1, m1, d1] = ymd(from).split("-");
  const [y2, m2, d2] = ymd(to).split("-");
  if (y1 === y2 && m1 === m2) return `${d1}–${d2}/${m1}`;
  return `${d1}/${m1}–${d2}/${m2}`;
}

function sach(v: string | null | undefined): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/** Chữ thường chữ cái đầu: "Nghỉ phép năm" → "nghỉ phép năm" (đứng sau "xin"). */
function thuong(s: string): string {
  return s.charAt(0).toLocaleLowerCase("vi-VN") + s.slice(1);
}

function khoangNgayCoSo(from: Date | null, to: Date | null): string {
  // Chưa chọn ngày ⇒ nói đúng một lần, không "1 ngày ((chưa chọn ngày))" (đo ở form 375px 06/10).
  if (!from) return "(chưa chọn ngày)";
  const n = soNgayDon(from, to);
  return `${n} ngày (${nhanKhoangNgay(from, to)})`;
}

/** "vào 07:30 · ra 11:30 · vào 13:30 · ra 17:30" — chỉ các ô có giờ, nhãn theo VỊ TRÍ. */
export function moTaMocNgan(moc: readonly (string | null | undefined)[]): string {
  return chuanHoaMoc(moc)
    .flatMap((x, i) => (x ? [`${huongCuaViTri(i) === "CHECK_IN" ? "vào" : "ra"} ${x}`] : []))
    .join(" · ");
}

/** "nửa buổi sáng" · "nửa buổi chiều" · "theo giờ 14:00–16:00"; cả ngày / không phải đơn nghỉ ⇒ null. */
function nhanMotPhan(d: DonDeTomTat): string | null {
  if (d.leaveDurationType === "HALF_DAY_AM") return "nửa buổi sáng";
  if (d.leaveDurationType === "HALF_DAY_PM") return "nửa buổi chiều";
  if (d.leaveDurationType === "HOURLY") return `theo giờ ${d.startTime ?? "?"}–${d.endTime ?? "?"}`;
  return null;
}

/** "Đi muộn" ⇒ true · "Về sớm" ⇒ false · khác ⇒ null. Dùng chung với `muon-som-da-duyet.ts`. */
export function laDiMuon(detail: string | null): boolean | null {
  const d = sach(detail)?.toLowerCase();
  if (!d) return null;
  if (d.includes("muộn")) return true;
  if (d.includes("sớm")) return false;
  return null;
}

function noiDen(detail: string | null): string | null {
  const d = sach(detail);
  if (!d) return null;
  const m = /^Nơi đến:\s*(.+)$/i.exec(d);
  return m ? m[1]!.trim() : null;
}

/** Địa điểm của đơn chấm công ngoài địa điểm — form ghi `detail = "Địa điểm: …"`. */
function diaDiem(detail: string | null): string | null {
  const d = sach(detail);
  if (!d) return null;
  const m = /^Địa điểm:\s*(.+)$/i.exec(d);
  return m ? m[1]!.trim() : d;
}

const khungGio = (d: Pick<DonDeTomTat, "startTime" | "endTime">) =>
  d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : null;

function soGio(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const p = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const v = (p(b) - p(a)) / 60;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 10) / 10 : null;
}

/**
 * Phần đứng SAU chữ "xin" — "nghỉ phép năm 2 ngày (12–13/10), người làm thay: Trần B (ca S)".
 * Form nộp in "Bạn xin: <phần này>"; danh sách dùng `tomTatDon`.
 */
export function noiDungXin(d: DonDeTomTat, opts: TuyChonTomTat = {}): string {
  const ngay = nhanNgay(d.fromDate);
  const lop = sach(d.className);
  const nguoi = sach(d.targetName);
  const caNguoi = sach(d.targetShiftCode);

  switch (d.kind) {
    case "CLASS_CHANGE":
      return `đổi lớp dạy${lop ? ` (lớp ${lop})` : ""} từ ${ngay}`;
    case "SUB_TEACH":
      return `người dạy thay buổi ${ngay}${lop ? ` lớp ${lop}` : ""}: ${nguoi ?? "chưa chọn người dạy thay"}`;
    case "CLASS_OFF":
      return `nghỉ buổi dạy ${ngay}${lop ? ` lớp ${lop}` : ""} (lớp học bù sau)`;
    case "SHIFT_SWAP": {
      const moi = sach(d.newShiftCode);
      let s = `đổi ca ${ngay} ${moi ? `sang ca ${moi}` : "(chưa chọn ca mới)"}`;
      if (nguoi) s += `, người nhận ca: ${nguoi}${caNguoi ? ` (ca ${caNguoi})` : ""}`;
      return s;
    }
    case "OT": {
      const tu = sach(d.startTime);
      const den = sach(d.endTime);
      const gio = soGio(tu, den);
      if (!tu && !den) return `tăng ca ${ngay} (chưa ghi giờ)`;
      return `tăng ca ${ngay} từ ${tu ?? "?"} đến ${den ?? "?"}${gio != null ? ` (${gio} giờ)` : ""}`;
    }
    case "LATE_EARLY": {
      const muon = laDiMuon(d.detail);
      const gio = sach(d.startTime);
      if (muon === true) return `đi muộn ${ngay}${gio ? `, đến lúc ${gio}` : ""}`;
      if (muon === false) return `về sớm ${ngay}${gio ? `, về lúc ${gio}` : ""}`;
      return `đi muộn / về sớm ${ngay}${gio ? ` lúc ${gio}` : ""}`;
    }
    case "TIMESHEET_FIX": {
      const moc = moTaMocNgan(d.moc);
      if (!moc) return `chỉnh công ${ngay} (chưa ghi giờ nào)`;
      let duoi = "";
      if (opts.cheDo === "GHI_DE") {
        const n = opts.soLuotConTinh;
        duoi =
          n == null
            ? " (sẽ ghi đè các lượt quét của ngày)"
            : n > 0
              ? ` (sẽ ghi đè ${n} lượt quét hiện có)`
              : " (ngày này chưa có lượt quét nào)";
      } else if (opts.cheDo === "GHI_THEM") {
        duoi = " (ghi thêm, giữ các lượt quét hiện có)";
      }
      return `chỉnh công ${ngay}: ${moc}${duoi}`;
    }
    case "LEAVE": {
      const loai = sach(d.leaveName);
      const phan = nhanMotPhan(d);
      if (phan) return `${loai ? thuong(loai) : "nghỉ"} ${phan} ngày ${ngay}`;
      let s = `${loai ? thuong(loai) : "nghỉ"} ${khoangNgayCoSo(d.fromDate, d.toDate)}`;
      if (nguoi) s += `, người làm thay: ${nguoi}${caNguoi ? ` (ca ${caNguoi})` : ""}`;
      return s;
    }
    case "REMOTE":
      return `làm từ xa ${khoangNgayCoSo(d.fromDate, d.toDate)}${d.startTime && d.endTime ? ` (${d.startTime}–${d.endTime})` : ""}`;
    case "BUSINESS_TRIP": {
      const noi = noiDen(d.detail);
      return `đi công tác ${khoangNgayCoSo(d.fromDate, d.toDate)}${noi ? `, nơi đến: ${noi}` : ""}`;
    }
    case "COMP_LEAVE":
      return `nghỉ bù ${nhanMotPhan(d) ?? "cả ngày"} ngày ${ngay}`;
    case "HOLIDAY_WORK":
      return `làm ngày nghỉ / ngày lễ ${ngay}${khungGio(d) ? ` (${khungGio(d)})` : ""}`;
    case "OUTSIDE_ATTENDANCE": {
      const noi = diaDiem(d.detail);
      return `chấm công ngoài địa điểm ngày ${ngay}${khungGio(d) ? ` (${khungGio(d)})` : ""}${noi ? `, tại: ${noi}` : ""}`;
    }
    default:
      return `${d.kind.toLowerCase()} ${ngay}`;
  }
}

/**
 * Câu tóm tắt đầy đủ — "Nguyễn A xin nghỉ phép năm 2 ngày (12–13/10)". `ai = null` (đơn của
 * chính người xem) ⇒ "Xin nghỉ phép năm …".
 */
export function tomTatDon(d: DonDeTomTat, ai: string | null, opts: TuyChonTomTat = {}): string {
  const ten = sach(ai);
  return ten ? `${ten} xin ${noiDungXin(d, opts)}` : `Xin ${noiDungXin(d, opts)}`;
}

export type DongThongTin = { nhan: string; giaTri: string };

/**
 * Khối "Đơn đề nghị" ở panel duyệt — từng dòng nhãn/giá trị, CHỈ các trường loại đơn này dùng.
 * Đặt cạnh khối "Hiện trạng ngày đó" để người duyệt so hai bên.
 */
export function dongDeNghi(d: DonDeTomTat): DongThongTin[] {
  const out: DongThongTin[] = [];
  const push = (nhan: string, v: string | null | undefined) => {
    const s = sach(v);
    if (s) out.push({ nhan, giaTri: s });
  };
  const nguoi = sach(d.targetName);
  const caNguoi = sach(d.targetShiftCode);
  switch (d.kind) {
    case "TIMESHEET_FIX": {
      const moc = chuanHoaMoc(d.moc);
      const nhan = moc.length > 2 ? ["Vào 1", "Ra 1", "Vào 2", "Ra 2"] : ["Giờ vào", "Giờ ra"];
      moc.forEach((x, i) => out.push({ nhan: nhan[i] ?? `Mốc ${i + 1}`, giaTri: x ?? "(để trống)" }));
      if (moc.length === 0) out.push({ nhan: "Giờ đề nghị", giaTri: "(chưa ghi giờ nào)" });
      break;
    }
    case "SHIFT_SWAP":
      out.push({ nhan: "Ca mới", giaTri: sach(d.newShiftCode) ?? "(chưa chọn)" });
      if (nguoi) out.push({ nhan: "Người nhận ca", giaTri: `${nguoi} — ${caNguoi ? `ca ${caNguoi}` : "giữ nguyên ca"}` });
      break;
    case "LEAVE":
      out.push({ nhan: "Loại nghỉ", giaTri: sach(d.leaveName) ?? "(chưa chọn)" });
      if (nhanMotPhan(d)) out.push({ nhan: "Thời lượng", giaTri: nhanMotPhan(d)! });
      else out.push({ nhan: "Số ngày", giaTri: khoangNgayCoSo(d.fromDate, d.toDate) });
      if (nguoi) out.push({ nhan: "Người làm thay", giaTri: `${nguoi} — ${caNguoi ? `ca ${caNguoi}` : "chưa chọn ca"}` });
      break;
    case "OT": {
      const gio = soGio(sach(d.startTime), sach(d.endTime));
      push("Khung giờ", d.startTime || d.endTime ? `${d.startTime ?? "?"}–${d.endTime ?? "?"}${gio != null ? ` (${gio} giờ)` : ""}` : null);
      break;
    }
    case "LATE_EARLY":
      push("Hình thức", d.detail);
      push("Giờ", d.startTime);
      break;
    case "CLASS_CHANGE":
    case "CLASS_OFF":
      push("Lớp", d.className);
      break;
    case "SUB_TEACH":
      push("Lớp", d.className);
      out.push({ nhan: "Người dạy thay", giaTri: nguoi ?? "(chưa chọn)" });
      break;
    case "REMOTE":
      out.push({ nhan: "Số ngày", giaTri: khoangNgayCoSo(d.fromDate, d.toDate) });
      break;
    case "BUSINESS_TRIP":
      out.push({ nhan: "Số ngày", giaTri: khoangNgayCoSo(d.fromDate, d.toDate) });
      push("Nơi đến", noiDen(d.detail));
      break;
    case "HOLIDAY_WORK":
      out.push({ nhan: "Khung giờ", giaTri: khungGio(d) ?? "(chưa ghi giờ)" });
      break;
    case "OUTSIDE_ATTENDANCE":
      out.push({ nhan: "Khung giờ", giaTri: khungGio(d) ?? "(chưa ghi giờ)" });
      push("Địa điểm", diaDiem(d.detail));
      break;
  }
  return out;
}

/**
 * "Khi duyệt sẽ: …" — việc hệ thống TỰ làm khi quản lý bấm Duyệt, nói bằng dữ liệu của chính
 * đơn này. Không có dấu chấm cuối; chỗ gọi tự ghép tiền tố.
 *
 * `nguoiNop` = tên người nộp ("bạn" ở form của chính họ).
 */
export function khiDuyetSe(d: DonDeTomTat, nguoiNop: string, opts: TuyChonTomTat = {}): string {
  const ngay = nhanNgay(d.fromDate);
  const lop = sach(d.className);
  const nguoi = sach(d.targetName);
  const caNguoi = sach(d.targetShiftCode);

  switch (d.kind) {
    case "SUB_TEACH":
      return nguoi
        ? `gán ${nguoi} dạy thay buổi học${lop ? ` lớp ${lop}` : ""} ngày ${ngay}`
        : "không duyệt được — đơn chưa chọn người dạy thay";
    case "CLASS_OFF":
      return `huỷ buổi học${lop ? ` lớp ${lop}` : ""} ngày ${ngay} và thêm một buổi bù ở cuối lịch của lớp`;
    case "SHIFT_SWAP": {
      const moi = sach(d.newShiftCode);
      if (!moi) return "không duyệt được — đơn chưa chọn ca mới";
      let s = `ghi ca ${moi} cho ${nguoiNop} ngày ${ngay}`;
      if (nguoi) {
        s += caNguoi
          ? `, ghi ca ${caNguoi} cho ${nguoi}`
          : `; lịch của ${nguoi} giữ nguyên (đơn không chọn ca cho người nhận)`;
      }
      return `${s}, rồi tính lại công`;
    }
    case "COMP_LEAVE":
      // Đợt 8 — trừ quỹ dưới khoá theo người, quỹ không bao giờ âm (`nghi-mot-phan.ts`).
      return `kiểm quỹ nghỉ bù; đủ thì trừ đúng số phút nghỉ (${nhanMotPhan(d) ?? "cả ngày"}) khỏi quỹ, miễn chấm công thời gian đó, rồi tính lại công. Không đủ quỹ thì không duyệt được`;
    case "LEAVE": {
      const phan = nhanMotPhan(d);
      if (phan) {
        // Đợt 7 — ca giữ nguyên; chỉ thời gian được duyệt mới được miễn chấm công.
        return `giữ nguyên ca; chỉ thời gian nghỉ (${phan} ngày ${ngay}) được miễn chấm công${(d.leavePaidRatio ?? 0) > 0 ? ", có lương" : ", không lương"} — phần còn lại của ca vẫn chấm như thường`;
      }
      const ma = maNghiTrenLuoi(d.leavePaidRatio);
      let s = `ghi mã ${ma} (${ma === "P" ? "nghỉ có lương" : "nghỉ không lương"}) lên lịch ca ${khoangNgayCoSo(d.fromDate, d.toDate)}`;
      if (nguoi) {
        s += caNguoi
          ? `, xếp ca ${caNguoi} cho ${nguoi} ngày ${ngay}`
          : `; ${nguoi} không được xếp ca tự động (đơn không chọn ca cho người làm thay)`;
      }
      return `${s}, rồi tính lại công. Không trừ vào số ngày phép`;
    }
    case "TIMESHEET_FIX": {
      const k = chuanHoaMoc(d.moc).filter(Boolean).length;
      if (k === 0) return "không duyệt được — đơn chưa có giờ nào";
      if (opts.cheDo === "GHI_DE") {
        const n = opts.soLuotConTinh;
        const cu = n == null ? "các lượt quét cũ" : n > 0 ? `${n} lượt quét cũ` : "không có lượt quét cũ nào";
        return `ghi ${k} mốc giờ chỉnh tay cho ngày ${ngay} — ${cu} giữ để xem nhưng thôi tính công — rồi tính lại công`;
      }
      if (opts.cheDo === "GHI_THEM") {
        return `thêm ${k} mốc giờ chỉnh tay cho ngày ${ngay}, các lượt quét hiện có vẫn tính, rồi tính lại công`;
      }
      return `ghi ${k} mốc giờ chỉnh tay cho ngày ${ngay} rồi tính lại công (đủ mốc của ca thì thay lượt quét cũ, thiếu thì chỉ thêm)`;
    }
    case "CLASS_CHANGE":
      return "chỉ ghi nhận đơn — lịch lớp không tự đổi, quản lý đổi giáo viên phụ trách trên màn lớp học";
    case "BUSINESS_TRIP":
      // Đợt 6 (08/10/2026) — đơn đã duyệt chính là lịch công tác; chế độ công theo `shift.congTacCheDo`.
      return "tự ghi nhận lịch công tác từng ngày (không cần xếp ca công tác); mặc định đủ công theo ca, chấm ngoài văn phòng được";
    case "LATE_EARLY":
      // Đợt 2 đơn từ (Q-5 08/10/2026) — engine đọc đơn đã duyệt mỗi lần tính lại công.
      return "không tính vi phạm phần đi muộn / về sớm nằm trong giờ đã xin, rồi tính lại công ngày đó";
    case "OT":
      // Đợt 4 (08/10/2026) — engine giao khung duyệt với giờ làm thật (`tang-ca.ts`).
      return "chốt khung OT được duyệt; phút được trả = phần làm thật trong khung, ngoài giờ ca (đối chiếu chấm công)";
    case "REMOTE":
      // Đợt 5 — vẫn phải chấm theo ca, chỉ bỏ ràng buộc chấm tại văn phòng trong khung được duyệt.
      return "cho chấm công ngoài văn phòng trong thời gian được duyệt — ca giữ nguyên, vẫn phải chấm đủ lượt";
    case "HOLIDAY_WORK":
      // Đợt 9 — `lam-ngay-nghi.ts`: chỉ ngày lễ / ngày không có ca làm; phút thật trong khung ⇒ cột riêng.
      return `ghi phút chấm công thật trong khung ${khungGio(d) ?? "đã xin"} ngày ${ngay} vào cột "Làm ngày lễ" hoặc "Làm ngày nghỉ" (không cộng công thường / OT). Ngày có ca làm bình thường thì không duyệt được`;
    case "OUTSIDE_ATTENDANCE":
      // Đợt 10 — `cham-ngoai.ts` nguồn 4: chỉ trong khung ± dung sai.
      return `cho chấm công ngoài điểm chấm trong khung ${khungGio(d) ?? "đã xin"} ngày ${ngay} (cộng dung sai hai đầu) — ca và công giữ nguyên, vẫn tính theo lượt chấm thật`;
    default:
      return "chỉ đổi trạng thái đơn";
  }
}
