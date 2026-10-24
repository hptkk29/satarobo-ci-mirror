import {
  SLA_GRADE_DAYS,
  CANH_BAO_SO_BAI_QUA_SLA,
  CANH_BAO_TUOI_CHO_NGAY_LAM,
} from "@/lib/elearning/metrics/constants";
import { demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";

/**
 * EL-15d — CHỈ SỐ HÀNG ĐỢI CHẤM TAY (M9, M10), thuần.
 *
 * Không DB, không giờ hệ thống, không mạng.
 *
 * ⚠️ Vì sao hai chỉ số này quan trọng hơn vẻ ngoài của chúng: hàng đợi chấm tay vỡ
 * SLA là MỘT trong hai dấu hiệu sớm của rủi ro điểm đơn lẻ ở phòng Đào tạo
 * (QĐ-CDA-15) — phòng có 4/15 nhân sự mà gánh cả ba vai. Dấu hiệu còn lại là M12
 * "số khoá xuất bản mỗi tháng" rơi 0 hai kỳ liên tiếp. Cả hai là triệu chứng của
 * CÙNG một nguyên nhân là quá tải, và cả hai xuất hiện TRƯỚC khi hệ thống có vẻ
 * hỏng — chờ tới lúc có người kêu là đã muộn một quý.
 */

export type LuotDaCham = {
  /** Hạn chấm = `submittedAt` + `SLA_GRADE_DAYS` ngày làm việc. */
  dueGradeAt: Date | null;
  gradedAt: Date | null;
};

export type M9 = {
  /** Số bài chấm ĐÚNG HẠN. */
  dungHan: number;
  /** Tổng bài đã chấm trong kỳ. */
  tong: number;
  /** `null` khi chưa có bài nào — KHÔNG phải 0%. */
  tiLe: number | null;
  /** `true` = dưới ngưỡng cảnh báo (< 70%). */
  canhBao: boolean;
};

/**
 * M9 — TUÂN THỦ SLA CHẤM.
 *
 * ⚠️ Chưa có bài nào thì `tiLe` là `null`, KHÔNG phải 0. Một phòng chưa nhận bài nào
 * mà bảng chỉ số báo "0% tuân thủ" là một lời buộc tội sai — và nó sẽ nằm trên cùng
 * báo cáo với những con số thật.
 */
export function tinhM9(ds: LuotDaCham[]): M9 {
  const daCham = ds.filter((x) => x.gradedAt != null);
  if (daCham.length === 0) {
    return { dungHan: 0, tong: 0, tiLe: null, canhBao: false };
  }
  const dungHan = daCham.filter(
    // Không có hạn chấm ⇒ tính là đúng hạn: lượt cũ trước khi có cột này không phải
    // lỗi của ai. Đếm nó là trễ sẽ dìm chỉ số của một phòng vì dữ liệu di cư.
    (x) => !x.dueGradeAt || x.gradedAt!.getTime() <= x.dueGradeAt.getTime(),
  ).length;
  const tiLe = dungHan / daCham.length;
  return { dungHan, tong: daCham.length, tiLe, canhBao: tiLe < 0.7 };
}

export type LuotDangCho = {
  dueGradeAt: Date | null;
};

export type M10 = {
  /** Số bài đang chờ chấm. */
  dangCho: number;
  /** Trong đó, bao nhiêu bài đã QUÁ hạn chấm. */
  quaHan: number;
  /** Tuổi bài chờ lâu nhất, tính bằng NGÀY LÀM VIỆC quá hạn. */
  tuoiLonNhat: number;
  /** Trung vị số ngày làm việc đã quá hạn — 0 nếu không bài nào quá hạn. */
  trungViQuaHan: number;
  /** `true` = chạm ngưỡng cảnh báo. */
  canhBao: boolean;
};

/**
 * M10 — TỒN ĐỌNG HÀNG ĐỢI CHẤM.
 *
 * ⚠️ Công bố KÈM tuổi bài chờ lâu nhất, không chỉ đếm số bài. Mười bài trễ một ngày
 * và một bài trễ ba tuần là hai tình huống khác hẳn nhau, mà phép đếm trần cho ra
 * cùng một con số ở cái thứ hai nhỏ hơn.
 */
export function tinhM10(ds: LuotDangCho[], bayGio: Date): M10 {
  const quaHanNgay = ds
    .map((x) =>
      x.dueGradeAt && x.dueGradeAt.getTime() < bayGio.getTime()
        ? demNgayLamViec(x.dueGradeAt, bayGio)
        : 0,
    )
    .filter((n) => n > 0)
    .sort((a, b) => a - b);

  const tuoiLonNhat = quaHanNgay.length ? quaHanNgay[quaHanNgay.length - 1]! : 0;
  return {
    dangCho: ds.length,
    quaHan: quaHanNgay.length,
    tuoiLonNhat,
    trungViQuaHan: trungVi(quaHanNgay),
    canhBao:
      quaHanNgay.length >= CANH_BAO_SO_BAI_QUA_SLA ||
      tuoiLonNhat > CANH_BAO_TUOI_CHO_NGAY_LAM,
  };
}

/**
 * Trung vị của một mảng ĐÃ SẮP TĂNG DẦN.
 *
 * ⚠️ Trung vị chứ không phải trung bình: một bài bị bỏ quên ba tuần sẽ kéo trung
 * bình lên và làm cả hàng đợi trông tệ hơn thực tế — hoặc ngược lại, chín bài chấm
 * ngay sẽ giấu mất một bài bị quên. Trung vị nói đúng "phần lớn đang thế nào".
 */
export function trungVi(daSap: number[]): number {
  if (daSap.length === 0) return 0;
  const giua = Math.floor(daSap.length / 2);
  return daSap.length % 2 === 1
    ? daSap[giua]!
    : Math.round(((daSap[giua - 1]! + daSap[giua]!) / 2) * 10) / 10;
}

// ── Hợp khoảng chờ, trả nợ `NO_MIEN_TRU_CHONG_KHOANG` ──────────────────────

export type KhoangCho = { tu: Date; den: Date };

/**
 * HỢP các khoảng chờ chấm của MỘT lượt ghi danh, đo bằng NGÀY LÀM VIỆC.
 *
 * ⚠️ Đây là bản vá cho nợ `NO_MIEN_TRU_CHONG_KHOANG` ghi ở EL-15c: miễn trừ khi đó
 * cộng theo TỪNG lượt nộp, mà hạn là của CẢ lượt ghi danh. Hai bài tập cùng nộp một
 * ngày và cùng bị chấm trễ 4 ngày sẽ cộng 4 + 4 = 8, trong khi người học chỉ thực
 * sự mất 4 — hai khoảng chờ CHỒNG LÊN NHAU trên trục thời gian.
 *
 * Sai đó về phía CÓ LỢI cho người học nên chấp nhận được một đợt, nhưng nó nới cả
 * `slaGraceDays` — tức nới luôn phép so đúng-hạn, và một người trễ thật có thể thành
 * "đúng hạn".
 *
 * Cách đúng: gộp các khoảng chồng nhau rồi mới đếm.
 */
export function hopKhoangCho(khoang: KhoangCho[]): number {
  const hopLe = khoang
    .filter((k) => k.den.getTime() > k.tu.getTime())
    .sort((a, b) => a.tu.getTime() - b.tu.getTime());
  if (hopLe.length === 0) return 0;

  const gop: KhoangCho[] = [];
  for (const k of hopLe) {
    const cuoi = gop[gop.length - 1];
    // Chạm nhau hoặc chồng nhau ⇒ nối làm một. So `<=` chứ không `<`: hai khoảng
    // liền kề khít nhau vẫn là một quãng chờ liên tục với người đang chờ.
    if (cuoi && k.tu.getTime() <= cuoi.den.getTime()) {
      if (k.den.getTime() > cuoi.den.getTime()) cuoi.den = k.den;
    } else {
      gop.push({ tu: k.tu, den: k.den });
    }
  }

  return gop.reduce((s, k) => s + demNgayLamViec(k.tu, k.den), 0);
}

/** Ba con số hiện trên màn chỉ số, theo đúng §9.3. */
export type BangChiSo = {
  m9: M9;
  m10: M10;
  slaNgayLam: number;
};

export function dungBangChiSo(input: {
  daCham: LuotDaCham[];
  dangCho: LuotDangCho[];
  bayGio: Date;
}): BangChiSo {
  return {
    m9: tinhM9(input.daCham),
    m10: tinhM10(input.dangCho, input.bayGio),
    slaNgayLam: SLA_GRADE_DAYS,
  };
}
