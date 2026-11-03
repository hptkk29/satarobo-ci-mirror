/**
 * KHUNG GIỜ MỞ LỚP TRẢI NGHIỆM — luật "ngày nào mở được khung nào", giữ ở MỘT chỗ.
 *
 * Chủ dự án 22/09/2026: "Tạo lớp Trial theo ngày, thứ, và khung thời gian có GV đi làm
 * (từ 17h30 - 21h từ t3-t6 & sáng chiều ngày thứ 7, cn)", và "sale … chỉ chọn giờ trong
 * khung giờ của qly tạo".
 *
 * ── ĐÂY LÀ MỘT LƯỢT ĐẢO CHỐT 28/08, PHẢI ĐỌC KỸ ───────────────────────────────────────
 * Chốt 28/08 đẩy giờ XUỐNG TỪNG BUỔI và cố ý để `TrialClassV2.startTime/endTime` = null
 * ("lớp là slot tái sử dụng"). Nay lớp quay lại mang NGÀY + KHUNG GIỜ, vì đó là thứ Sale
 * nhìn vào để chọn chỗ hẹn khách.
 *
 * Hai thứ KHÔNG đảo, đừng gộp lại:
 *   · Giờ của TỪNG BUỔI ("case") vẫn nằm ở `TrialClassSession` — lớp chỉ là KHUNG BAO.
 *   · Giáo viên vẫn gán ở TỪNG BUỔI, không ở lớp (`createTrialClass` vẫn ghi
 *     `teacherId: null`). Lớp mở 17:30–21:00 không có nghĩa một GV trực suốt 3,5 tiếng.
 *
 * ── VÌ SAO KHUNG GIỜ LÀ CẤU HÌNH, KHÔNG PHẢI HẰNG SỐ ──────────────────────────────────
 * Chủ dự án chọn "cấu hình sửa được". Khai thành 7 khoá CHUỖI theo thứ
 * (`trial.khungGio.<thu>`) chứ không một khoá JSON: màn Cấu hình vận hành dựng ô nhập
 * theo KIỂU GIÁ TRỊ (`settings-editor.tsx` — chuỗi ⇒ ô chữ), và repo đã ba lần từ chối
 * cho cấu hình dạng danh sách hiện thành ô JSON thô ("bắt người vận hành gõ tay… gõ sai
 * thì danh sách trông như đã khai mà không khớp ai"). Bảy ô chữ đọc được bằng mắt, sửa
 * được bằng tay, không cần viết thêm một editor nào.
 *
 * ⚠️ KHÔNG đọc đồng hồ trong tệp này (luật 19) và KHÔNG dùng `Date.getDay()` (luật TZ):
 * thứ trong tuần suy bằng `vnWeekday`, kẻo máy chạy UTC ra thứ khác máy dev.
 */
import { vnAddDays, vnWeekday, vnYmd } from "@/lib/time/vn";
import { phutTuHhmm, type KhungGio } from "./lop-moi";

export type { KhungGio };

/** Khoá theo thứ — CHỈ SỐ TRONG MẢNG = `vnWeekday` (0=CN … 6=T7). Đừng đổi thứ tự. */
export const THU_KHOA = ["cn", "t2", "t3", "t4", "t5", "t6", "t7"] as const;
export type ThuKhoa = (typeof THU_KHOA)[number];

export const TEN_THU: Record<ThuKhoa, string> = {
  cn: "Chủ nhật",
  t2: "Thứ 2",
  t3: "Thứ 3",
  t4: "Thứ 4",
  t5: "Thứ 5",
  t6: "Thứ 6",
  t7: "Thứ 7",
};

/**
 * Mặc định theo lời chủ dự án 22/09/2026: T3–T6 tối 17:30–21:00; T7 và CN cả sáng lẫn
 * chiều. T2 để TRỐNG — trung tâm không mở buổi thử thứ 2, và "trống" ở đây là câu trả
 * lời CÓ NGHĨA ("không mở"), không phải thiếu cấu hình.
 */
export const KHUNG_MAC_DINH: Record<ThuKhoa, string> = {
  cn: "08:00-11:30, 14:00-17:30",
  t2: "",
  t3: "17:30-21:00",
  t4: "17:30-21:00",
  t5: "17:30-21:00",
  t6: "17:30-21:00",
  t7: "08:00-11:30, 14:00-17:30",
};

export type CauHinhKhung = Record<ThuKhoa, string>;

type Ket<T> = { ok: true; giaTri: T } | { ok: false; loi: string };

/**
 * Đọc chuỗi cấu hình của MỘT thứ: `"08:00-11:30, 14:00-17:30"` → hai khung.
 *
 * Chuỗi rỗng ⇒ mảng rỗng (ngày đó không mở lớp) — KHÔNG phải lỗi.
 */
export function docKhungGio(chuoi: string): Ket<KhungGio[]> {
  const sach = (chuoi ?? "").trim();
  if (!sach) return { ok: true, giaTri: [] };

  const ra: KhungGio[] = [];
  for (const phan of sach.split(",")) {
    const doan = phan.trim();
    if (!doan) continue;
    // Chấp cả gạch ngang thường lẫn gạch dài — người vận hành dán từ Word ra "–".
    const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(doan);
    if (!m) {
      return { ok: false, loi: `Khung giờ "${doan}" không đúng dạng "HH:MM-HH:MM"` };
    }
    const bd = phutTuHhmm(m[1]!);
    const kt = phutTuHhmm(m[2]!);
    if (bd === null || kt === null) {
      return { ok: false, loi: `Khung giờ "${doan}" có giờ không hợp lệ` };
    }
    if (bd >= kt) {
      return { ok: false, loi: `Khung giờ "${doan}" có giờ kết thúc không sau giờ bắt đầu` };
    }
    ra.push({ startTime: m[1]!, endTime: m[2]! });
  }
  return { ok: true, giaTri: ra };
}

/** Các khung mở của MỘT NGÀY cụ thể, suy từ thứ (giờ VN). */
export function khungChoNgay(ngay: Date, cauHinh: CauHinhKhung): Ket<KhungGio[]> {
  const thu = THU_KHOA[vnWeekday(ngay)];
  if (!thu) return { ok: false, loi: "Không đọc được thứ của ngày này" };
  const doc = docKhungGio(cauHinh[thu]);
  if (!doc.ok) return { ok: false, loi: `${TEN_THU[thu]}: ${doc.loi}` };
  return doc;
}

/** "17:30–21:00 hoặc 08:00–11:30" — để câu lỗi nói ra khung nào đang mở. */
export function keKhung(khung: readonly KhungGio[]): string {
  return khung.map((k) => `${k.startTime}–${k.endTime}`).join(" hoặc ");
}

function trongKhung(con: KhungGio, bao: KhungGio): boolean {
  const c1 = phutTuHhmm(con.startTime);
  const c2 = phutTuHhmm(con.endTime);
  const b1 = phutTuHhmm(bao.startTime);
  const b2 = phutTuHhmm(bao.endTime);
  if (c1 === null || c2 === null || b1 === null || b2 === null) return false;
  return c1 >= b1 && c2 <= b2;
}

/**
 * QL mở lớp: khung lớp phải nằm TRỌN trong MỘT khung cho phép của ngày đó.
 *
 * ⚠️ "Trọn trong MỘT khung", không phải "nằm giữa khung đầu và khung cuối": thứ 7 mở
 * 08:00–11:30 và 14:00–17:30, nên một lớp 11:00–15:00 vắt qua giờ nghỉ trưa phải bị TỪ
 * CHỐI. Kiểm theo kiểu "sau giờ mở sớm nhất và trước giờ đóng muộn nhất" là cho lọt đúng
 * ca này, và nó chỉ lộ ra khi có người xếp GV vào giờ nghỉ.
 */
export function kiemKhungLop(input: {
  khungHopLe: readonly KhungGio[];
  startTime: string;
  endTime: string;
  tenThu: string;
}): { ok: true } | { ok: false; loi: string } {
  const { khungHopLe, startTime, endTime, tenThu } = input;
  if (khungHopLe.length === 0) {
    return { ok: false, loi: `${tenThu} không mở lớp trải nghiệm — sửa ở Cấu hình vận hành nếu cần` };
  }
  const bd = phutTuHhmm(startTime);
  const kt = phutTuHhmm(endTime);
  if (bd === null || kt === null) return { ok: false, loi: "Giờ không hợp lệ" };
  if (bd >= kt) return { ok: false, loi: "Giờ kết thúc phải sau giờ bắt đầu" };

  const vua = khungHopLe.some((k) => trongKhung({ startTime, endTime }, k));
  if (!vua) {
    return {
      ok: false,
      loi: `${tenThu} chỉ mở ${keKhung(khungHopLe)} — khung ${startTime}–${endTime} nằm ngoài`,
    };
  }
  return { ok: true };
}

/**
 * Sale thêm case: giờ case phải nằm TRỌN trong khung lớp mà QL đã mở.
 *
 * Lớp CŨ (tạo trước 22/09/2026) không có khung — `lop` là `null` — thì KHÔNG chặn: chặn
 * hồi tố là khoá cứng mọi lớp đang chạy dở, và dữ liệu cũ không có lỗi gì để phạt.
 */
export function kiemCaseTrongLop(input: {
  lop: KhungGio | null;
  startTime: string;
  endTime: string;
}): { ok: true } | { ok: false; loi: string } {
  const { lop, startTime, endTime } = input;
  const bd = phutTuHhmm(startTime);
  const kt = phutTuHhmm(endTime);
  if (bd === null || kt === null) return { ok: false, loi: "Giờ không hợp lệ" };
  if (bd >= kt) return { ok: false, loi: "Giờ kết thúc phải sau giờ bắt đầu" };
  if (!lop) return { ok: true };

  if (!trongKhung({ startTime, endTime }, lop)) {
    return {
      ok: false,
      loi:
        `Lớp này mở ${lop.startTime}–${lop.endTime}, case ${startTime}–${endTime} nằm ngoài. ` +
        `Chọn giờ trong khung của lớp, hoặc nhờ Quản lý cơ sở mở thêm lớp khung khác.`,
    };
  }
  return { ok: true };
}

/**
 * Case có nằm trọn trong khung lớp VÀ đúng NGÀY của lớp không — MỘT hàm cho HAI cửa ghi
 * (thêm case và sửa case, `app/(admin)/admin/lop-trial/_actions.ts`).
 *
 * Vì sao phải dùng chung (đo 23/09/2026): bản đầu chỉ gác ở cửa THÊM. Cửa SỬA ghi đè
 * thẳng ngày/giờ, nên Sale mở case của mình rồi đổi sang ngày khác lúc 22:00 là server
 * nhận — các bé trong case đi theo sang một ngày mà tên lớp không hề nói tới.
 *
 * Lớp CŨ KHÔNG bị chặn: khoá hồi tố là khoá cứng mọi lớp đang chạy. "Lớp cũ" đọc từ cột
 * `theoKhung`, KHÔNG từ việc có giờ hay không — lớp tạo trước 28/08 VẪN mang giờ ở cấp
 * lớp (xem `lib/trial/nghia-null.ts`), và gác chúng theo giờ đó là khoá cứng cả việc
 * đổi giáo viên của một buổi cũ. `v.date` là "YYYY-MM-DD" theo lịch VN.
 */
export function kiemCaseThuocLop(
  cls: {
    /** BẮT BUỘC (luật 7) — thiếu nó thì hàm không phân biệt nổi lớp cũ mang giờ. */
    theoKhung: boolean;
    startDate: Date | null;
    startTime: string | null;
    endTime: string | null;
  },
  v: { date: string; startTime: string; endTime: string },
): { ok: true } | { ok: false; error: string } {
  if (!cls.theoKhung) return { ok: true };
  const khungLop =
    cls.startTime && cls.endTime ? { startTime: cls.startTime, endTime: cls.endTime } : null;
  const trongKhung = kiemCaseTrongLop({ lop: khungLop, startTime: v.startTime, endTime: v.endTime });
  if (!trongKhung.ok) return { ok: false, error: trongKhung.loi };
  // Lớp CÓ ngày thì case phải đúng ngày đó. Cho lệch ngày là để một "lớp trial ngày
  // 22/09" chứa case ngày 30/09 — Sale chọn lớp theo ngày, nên cái tên lớp sẽ nói dối.
  // `startDate` là @db.Date (nửa đêm UTC của ngày VN) ⇒ `vnYmd` đọc ra đúng ngày đó.
  if (cls.startDate && vnYmd(cls.startDate) !== v.date) {
    return {
      ok: false,
      error: `Lớp này mở ngày ${vnYmd(cls.startDate)} — chọn lớp của ngày ${v.date} hoặc nhờ Quản lý cơ sở mở lớp cho ngày đó`,
    };
  }
  return { ok: true };
}

/**
 * Sinh danh sách NGÀY theo thứ, dùng cho nút "mở lớp cho cả kỳ".
 *
 * Dùng `vnAddDays`/`vnYmd` chứ không cộng mili-giây: cộng tay qua mốc đổi ngày là chỗ đẻ
 * ra lỗi lệch một ngày mà chỉ máy chạy UTC mới thấy.
 */
export function sinhNgayTheoThu(input: {
  tu: Date;
  den: Date;
  /** `vnWeekday`: 0=CN … 6=T7. */
  thu: readonly number[];
  /** Chặn trên số ngày sinh ra — tránh một lần bấm nhầm đẻ vài nghìn lớp. */
  tran?: number;
}): { ok: true; ngay: Date[] } | { ok: false; loi: string } {
  const { tu, den, thu } = input;
  const tran = input.tran ?? 200;
  if (thu.length === 0) return { ok: false, loi: "Chưa chọn thứ nào" };
  if (vnYmd(den) < vnYmd(tu)) return { ok: false, loi: "Ngày kết thúc phải sau ngày bắt đầu" };

  const can = new Set(thu);
  const ra: Date[] = [];
  let d = tu;
  // Vòng chặn bằng SỐ NGÀY duyệt, không bằng số kết quả: khoảng 5 năm mà chỉ chọn CN thì
  // số kết quả vẫn nhỏ, nhưng vòng lặp thì dài — chặn đúng thứ đang tốn.
  for (let i = 0; i <= 400; i += 1) {
    if (vnYmd(d) > vnYmd(den)) break;
    if (can.has(vnWeekday(d))) {
      if (ra.length >= tran) {
        return { ok: false, loi: `Khoảng ngày quá dài — tối đa ${tran} lớp một lần` };
      }
      ra.push(d);
    }
    d = vnAddDays(d, 1);
  }
  if (ra.length === 0) return { ok: false, loi: "Khoảng ngày đã chọn không có thứ nào khớp" };
  return { ok: true, ngay: ra };
}

/**
 * Một TUỲ CHỌN của lượt mở lớp theo kỳ: các thứ + một khung giờ.
 *
 * Chủ dự án 22/09/2026 (vòng 2): "chọn từ ngày đến ngày rồi phải chọn thêm giờ của kỳ
 * đó, và có thể + thêm tuỳ chọn khác, ví dụ: tạo kỳ 22/09-30/09 lịch t3-t6 và lịch
 * t7-cn riêng biệt".
 */
export type QuyTacKy = { thu: number[]; startTime: string; endTime: string };

/**
 * Khung giờ dùng được cho MỘT NHÓM THỨ — giao của các khung, không phải hợp.
 *
 * Chọn T3 (tối) cùng T7 (sáng + chiều) thì giao là RỖNG, và đó là câu trả lời đúng:
 * một tuỳ chọn chỉ mang MỘT khung, nên hai nhóm giờ khác nhau phải tách thành hai tuỳ
 * chọn. Lấy hợp ở đây là bày ra khung `17:30–21:00` cho thứ 7 rồi để server từ chối.
 */
export function khungChungChoThu(
  thu: readonly number[],
  cauHinh: CauHinhKhung,
): KhungGio[] {
  if (thu.length === 0) return [];
  let giao: KhungGio[] | null = null;
  for (const t of thu) {
    const khoa = THU_KHOA[t];
    const doc = khoa ? docKhungGio(cauHinh[khoa]) : { ok: false as const, loi: "" };
    const ds = doc.ok ? doc.giaTri : [];
    giao =
      giao === null
        ? ds
        : giao.filter((a) => ds.some((b) => a.startTime === b.startTime && a.endTime === b.endTime));
    if (giao.length === 0) return [];
  }
  return giao ?? [];
}

/**
 * Bộ tuỳ chọn GỢI Ý dựng từ cấu hình: gom các thứ có CÙNG khung vào một tuỳ chọn.
 *
 * Với cấu hình mặc định, hàm này sinh đúng ba dòng — T3–T6 tối, T7+CN sáng, T7+CN chiều
 * — tức đúng ví dụ chủ dự án đưa ra. Người dùng mở form là thấy sẵn, sửa hoặc xoá bớt.
 */
export function goiYQuyTac(cauHinh: CauHinhKhung): QuyTacKy[] {
  // Khoá gom = "start-end"; giá trị = các thứ có khung đó. `Map` giữ thứ tự chèn nên
  // khung xuất hiện sớm hơn (duyệt theo thứ tự thứ 2 → CN) đứng trước.
  const theoKhung = new Map<string, { khung: KhungGio; thu: number[] }>();
  for (const t of [1, 2, 3, 4, 5, 6, 0]) {
    const khoa = THU_KHOA[t];
    if (!khoa) continue;
    const doc = docKhungGio(cauHinh[khoa]);
    if (!doc.ok) continue;
    for (const k of doc.giaTri) {
      const khoaGom = `${k.startTime}-${k.endTime}`;
      const cu = theoKhung.get(khoaGom);
      if (cu) cu.thu.push(t);
      else theoKhung.set(khoaGom, { khung: k, thu: [t] });
    }
  }
  return [...theoKhung.values()].map((v) => ({
    thu: v.thu,
    startTime: v.khung.startTime,
    endTime: v.khung.endTime,
  }));
}
