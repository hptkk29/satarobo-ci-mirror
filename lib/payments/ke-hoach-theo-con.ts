// lib/payments/ke-hoach-theo-con.ts — KẾ HOẠCH ĐÓNG TIỀN CHIA THEO TỪNG CON. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// VIỆC NÀY GIẢI CHÍNH XÁC BÀI TOÁN CHỦ DỰ ÁN ĐẶT 16/09/2026
//
// *"PH có 2 con nhưng đợt 1 đóng học phí cho cả 2 (hoặc cọc học phí) nhưng sang đợt 2 lại
// chỉ muốn đóng cho 1 bạn còn 1 bạn không cho học nữa, thì phải xử lý làm sao cho linh
// hoạt nhất mà chỉ cần sale thao tác, chứ dev không cần đụng vào khâu vận hành nữa."*
//
// Nên cấu trúc ở đây KHÔNG phải "một kế hoạch, chia tỷ lệ cho các con" — mà là **mỗi con
// một kế hoạch riêng**, số đợt của hai con KHÔNG cần bằng nhau. "Đợt 2 chỉ bé A đóng" chỉ
// đơn giản là dòng của bé B không có đợt 2. Sale không phải khai số 0, không phải xin ai.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUAN HỆ VỚI `OrderInstallment` — CHIỀU NÀO SUY RA CHIỀU NÀO
//
// Chủ dự án chốt KHÔNG thêm gì vào `OrderInstallment` (sổ kế hoạch đóng băng). Hệ quả:
//
//     kế hoạch theo con (nguồn)  ──gộp──▶  OrderInstallment (bản tổng, suy ra)
//            │
//            └──sinh──▶ PaymentRequest(orderItemId, installmentNo)   ← sổ thu thật
//
// Chiều suy ra là MỘT chiều. `gopDotTheoDon` là chỗ duy nhất làm phép gộp; đừng ở nơi khác
// cộng lại một lần nữa theo cách riêng — hai phép cộng khác nhau trên cùng một dữ liệu là
// cách repo này đã đẻ ra ba sổ tiền không đồng ý với nhau.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO LỖI PHẢI GỌI TÊN ĐỨA TRẺ
//
// Người sửa là SALE, đứng trước phụ huynh, trên điện thoại. "Tổng các đợt không khớp học
// phí" với đơn hai con là câu bắt họ tự dò hai cột. Mọi câu lỗi ở đây mang TÊN DÒNG và
// CON SỐ LỆCH — chi phí là vài dòng mã, đổi lại là người dùng sửa được ngay tại chỗ.

import { lechTongDotCuaDong, thuTuRot, TRAN_SO_DONG } from "./thu-tu-rot";
import { TRAN_SO_DOT, type DotKeHoach } from "./ke-hoach-dot";

const vnd = (n: number) => n.toLocaleString("vi-VN");

/** Kế hoạch đóng tiền của MỘT dòng hàng (= một con, hoặc một sản phẩm). */
export type DongKeHoach = {
  /**
   * Vị trí dòng trên đơn, tính từ 0, theo đúng thứ tự người bán nhập.
   * Quyết định THỨ TỰ RÓT TIỀN — xem `thu-tu-rot.ts`.
   */
  thuTuDong: number;
  /**
   * `OrderItem.id`. Chuỗi RỖNG là hợp lệ ở tầng thuần này: lúc TẠO đơn, dòng hàng chưa
   * có id cho tới khi `createMany` chạy xong. Người gọi điền id thật rồi mới ghi phiếu.
   */
  orderItemId: string;
  /** Tên để in vào câu lỗi — thường là tên con. Rỗng thì câu lỗi gọi theo số thứ tự. */
  tenDong: string;
  /** Thành tiền SAU giảm của dòng (`totalPrice - discountAmount`). */
  thanhTien: number;
  /** Các đợt của RIÊNG dòng này. Số đợt của hai dòng KHÔNG cần bằng nhau. */
  dots: DotKeHoach[];
};

export type KiemKeHoachTheoConKetQua =
  | { ok: true; coDotChuaThu: boolean }
  | { ok: false; error: string; coDotChuaThu?: undefined };

/** Nhãn gọi dòng trong câu lỗi — tên con nếu có, không thì "dòng thứ k". */
function nhan(d: DongKeHoach, i: number): string {
  const ten = (d.tenDong ?? "").trim();
  return ten.length > 0 ? ten : `dòng thứ ${i + 1}`;
}

/**
 * Kế hoạch theo con có ghi được không.
 *
 * Trả về câu lỗi ĐẦU TIÊN gặp phải, có tên dòng và con số — không trả mảng lỗi, vì màn
 * sửa kế hoạch sửa từng ô một và một câu rõ ràng dẫn tay tốt hơn năm câu cùng lúc.
 */
export function kiemKeHoachTheoCon(
  dongs: readonly DongKeHoach[],
  totalAmount: number,
): KiemKeHoachTheoConKetQua {
  if (dongs.length === 0) return { ok: false, error: "Đơn chưa có dòng hàng nào" };
  if (dongs.length > TRAN_SO_DONG) {
    return { ok: false, error: `Một đơn tối đa ${TRAN_SO_DONG} dòng hàng` };
  }

  // Hai dòng cùng `thuTuDong` ⇒ hai phiếu cùng `sortOrder` ⇒ thứ tự rót rơi về so sánh
  // cuid, tức NGẪU NHIÊN. Đây là lỗi tiền im lặng nên phải chặn ở cổng, không phải sửa
  // ở chỗ đọc.
  const daGap = new Set<number>();
  for (const [i, d] of dongs.entries()) {
    const t = Math.trunc(d.thuTuDong);
    if (!Number.isFinite(d.thuTuDong) || t < 0) {
      return { ok: false, error: `Thứ tự dòng của ${nhan(d, i)} không hợp lệ` };
    }
    if (daGap.has(t)) {
      return { ok: false, error: `Hai dòng hàng trùng thứ tự (${nhan(d, i)})` };
    }
    daGap.add(t);
  }

  for (const [i, d] of dongs.entries()) {
    const ten = nhan(d, i);
    if (d.dots.length === 0) {
      return { ok: false, error: `${ten}: phải có ít nhất một đợt` };
    }
    if (d.dots.length > TRAN_SO_DOT) {
      return { ok: false, error: `${ten}: tối đa ${TRAN_SO_DOT} đợt` };
    }
    if (d.dots.some((x) => !Number.isFinite(x.amount) || x.amount < 0)) {
      return { ok: false, error: `${ten}: số tiền của đợt không hợp lệ` };
    }

    // BẤT BIẾN GỐC của cả thiết kế. Σ sai thì mọi con số "còn thiếu của bé X" đều sai, và
    // cái sai đó không ném ở đâu — nó chỉ làm phụ huynh bị đòi nhầm số.
    const lech = lechTongDotCuaDong(d.thanhTien, d.dots.map((x) => x.amount));
    if (lech !== 0) {
      const huong = lech > 0 ? "thừa" : "thiếu";
      return {
        ok: false,
        error:
          `${ten}: tổng các đợt đang ${huong} ${vnd(Math.abs(lech))}đ ` +
          `so với học phí của bé (${vnd(Math.round(d.thanhTien))}đ)`,
      };
    }

    // Đợt chưa thu mà không có hạn thì cron nhắc nợ không nhắc được ai — khoản đó lặng lẽ
    // biến khỏi mọi màn theo dõi. Cùng luật với `kiemKeHoachDot`, chỉ khác là nói tên bé.
    const thieuHan = d.dots.findIndex((x) => !x.daThu && x.dueDate == null);
    if (thieuHan >= 0) {
      return { ok: false, error: `${ten} — đợt ${thieuHan + 1} chưa thu, phải có ngày hẹn đóng` };
    }
  }

  // Vế TỔNG kiểm SAU vế từng dòng là có chủ ý: nếu tổng lệch thì gần như luôn có một dòng
  // lệch, và câu lỗi chỉ đúng vào dòng đó thì sửa được ngay. Vế này chỉ còn bắt ca tổng
  // các dòng không bằng tổng đơn — tức lỗi ở phép tính THÀNH TIỀN, không ở kế hoạch.
  const tongDong = dongs.reduce((s, d) => s + Math.round(d.thanhTien), 0);
  const phai = Math.round(totalAmount);
  if (tongDong !== phai) {
    return {
      ok: false,
      error: `Tổng tiền các dòng (${vnd(tongDong)}đ) không khớp tổng đơn (${vnd(phai)}đ)`,
    };
  }

  return { ok: true, coDotChuaThu: dongs.some((d) => d.dots.some((x) => !x.daThu)) };
}

/** Một phiếu thu sắp ghi — khớp cột của `PaymentRequest` ở luồng MỚI. */
export type PhieuTheoCon = {
  orderItemId: string;
  /** 1,2,… — số thứ tự đợt TRONG DÒNG, không phải trong đơn. */
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
  /** `thuTuDong * 100 + installmentNo` — thứ tự rót của `planAllocation`. */
  sortOrder: number;
  /** Sale đã cầm tiền trước khi lưu kế hoạch ⇒ người gọi ghi Ledger-A cho đợt này. */
  daThu: boolean;
};

/**
 * Dựng danh sách phiếu thu theo con.
 *
 * ⚠️ KHÔNG kiểm gì ở đây — gọi `kiemKeHoachTheoCon` trước. Tách đôi là có chủ ý: hàm dựng
 * mà tự kiểm thì người gọi hay quên rằng nó CÓ THỂ từ chối, và câu lỗi rơi xuống tầng ghi
 * nơi không còn ngữ cảnh để nói tên bé.
 *
 * ⚠️ `matchKey` KHÔNG sinh ở đây, và đó không phải thiếu sót. Ngân sách nội dung CK là
 * **17 ký tự cho khoá** (17 + 1 dấu nối + 7 tối thiểu cho tên = 25 khít, xem
 * `noi-dung-ck.ts`). `ORD260915000007D1` đã đúng 17 — thêm một chiều DÒNG vào khoá là
 * tràn, và phần tên con bị cắt còn 5 ký tự. Ở luồng MỚI, khoá đối khớp nằm trên PHIẾU GỘP
 * (`PaymentBill.matchKey`), đúng như chủ dự án chốt: *"QR theo ĐƠN"*. Phiếu theo con là sổ
 * NỘI BỘ, không có QR riêng, nên không cần khoá riêng.
 */
export function phieuThuTheoCon(dongs: readonly DongKeHoach[]): PhieuTheoCon[] {
  const ra: PhieuTheoCon[] = [];
  for (const d of dongs) {
    d.dots.forEach((dot, k) => {
      const installmentNo = k + 1;
      ra.push({
        orderItemId: d.orderItemId,
        installmentNo,
        amountDue: Math.round(dot.amount),
        dueDate: dot.dueDate,
        sortOrder: thuTuRot({ thuTuDong: d.thuTuDong, installmentNo }),
        daThu: dot.daThu === true,
      });
    });
  }
  // Sắp theo đúng thứ tự rót để người đọc kết quả (và màn đối soát) thấy ngay thứ tự tiền
  // sẽ đi. `planAllocation` tự sắp lại theo `sortOrder`, nên đây là để NGƯỜI đọc.
  return ra.sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Gộp kế hoạch các con thành kế hoạch CẢ ĐƠN — đây là thứ ghi vào `OrderInstallment`.
 *
 * Số đợt của hai con KHÔNG cần bằng nhau: "đợt 2 chỉ bé A đóng" ra một đợt 2 của đơn bằng
 * đúng tiền của bé A. Đó chính là sự linh hoạt chủ dự án yêu cầu, và nó tự nhiên rơi ra
 * từ phép gộp chứ không cần ô "miễn" nào.
 *
 * Hai quy ước phải nói rõ vì chúng không suy ra được từ tên hàm:
 *  · `dueDate` của đợt gộp = hạn SỚM NHẤT trong các con có đợt đó. Đơn "đến hạn" khi đứa
 *    đầu tiên đến hạn; lấy hạn muộn nhất là hoãn nhắc nợ cho cả nhà vì một bé được gia hạn.
 *  · `daThu` = MỌI con có đợt đó đều đã thu. Trạng thái "một bé đóng rồi, bé kia chưa"
 *    KHÔNG biểu diễn được ở sổ gộp — và đó chính là lý do sổ theo con tồn tại. Đánh dấu
 *    đợt gộp là đã thu khi mới một bé đóng là khai man tiền vào Ledger-A.
 */
export function gopDotTheoDon(dongs: readonly DongKeHoach[]): DotKeHoach[] {
  const soDotToiDa = dongs.reduce((m, d) => Math.max(m, d.dots.length), 0);
  const ra: DotKeHoach[] = [];

  for (let k = 0; k < soDotToiDa; k++) {
    const cua = dongs.map((d) => d.dots[k]).filter((x): x is DotKeHoach => x != null);
    if (cua.length === 0) continue;

    let som: Date | null = null;
    for (const x of cua) {
      if (x.dueDate == null) continue;
      if (som == null || x.dueDate.getTime() < som.getTime()) som = x.dueDate;
    }

    ra.push({
      amount: cua.reduce((s, x) => s + Math.round(x.amount), 0),
      daThu: cua.every((x) => x.daThu === true),
      // Đợt gộp đã thu thì không còn hạn nhắc — cùng luật với `dotsGhiTuForm`, nếu không
      // cron nhắc nợ xếp hàng trên số tiền đã nằm trong két.
      dueDate: cua.every((x) => x.daThu === true) ? null : som,
    });
  }

  return ra;
}
