// lib/payments/ke-hoach-dot.ts — LÕI của "thanh toán linh hoạt": kế hoạch n đợt.
//
// ─────────────────────────────────────────────────────────────────────────────
// TRẦN "2 ĐỢT" KHÔNG NẰM Ở KIỂU DỮ LIỆU
//
// `OrderInstallment.soDot` là `Int` và `PaymentRequest.installmentNo` cũng vậy; sổ mới +
// QR + portal + webhook + đối soát ĐÃ n-đợt sạch. Trần 2 đợt là do MÃ: chữ ký
// `recordInstallmentPlan({dot1Amount, dot2Amount, dot2DueDate})`, validator tổng, hai lệnh
// `create` cứng, và cron nhắc nợ lọc `where: { soDot: 2 }` (⇒ đợt 3+ KHÔNG BAO GIỜ được
// nhắc). Nên đổi sang n đợt KHÔNG cần migration.
//
// ─────────────────────────────────────────────────────────────────────────────
// SỐ ĐỢT: 1/2/3/4 LÀ CHÍNH SÁCH CỦA CHỦ DỰ ÁN, KHÔNG PHẢI CÔNG VĂN
//
// Công văn nói khác hướng và phải ghi ra đây để người sau không tưởng đã thi hành:
//   · SR.QD.219 Điều 2 — "đóng toàn bộ một lần hoặc đóng theo THÁNG (chia đều 12 tháng)"
//   · SR.QD.223 — "đóng theo đợt (có thể 2 ĐỢT CÁCH 30 NGÀY)"
//   · Học phần chỉ là mốc HỌC (Điều 4: 48 buổi = 4 học phần × 12 buổi; Điều 7: cuối mỗi
//     học phần thuyết trình dự án) — không câu nào nói "đóng theo học phần".
// Thứ CÓ văn bản: bước hạn 30 ngày, trần 12 kỳ. Hai con số đó lấy từ công văn; con số 4
// là chính sách, nên nó là MẶC ĐỊNH chứ không phải hằng chặn.
// ─────────────────────────────────────────────────────────────────────────────
import { allocateByWeight } from "@/lib/finance/allocate";

/** Trần kỹ thuật — SR.QD.219 Điều 2 cho phép chia đều 12 kỳ (theo tháng). */
export const TRAN_SO_DOT = 12;

/** Bước ngày giữa hai đợt — SR.QD.223 "2 đợt cách 30 ngày". */
export const BUOC_HAN_MAC_DINH = 30;

/**
 * Chia `tongTien` thành `soDot` phần.
 *
 * ⚠️ BẤT BIẾN: Σ các phần === `tongTien`, luôn luôn. Một đồng lệch ở đây là một đồng lệch
 * giữa số phải thu của đơn và tổng phiếu thu, và nó không tự lộ ra ở màn nào.
 *
 * Không có `tiLe` → CHIA ĐỀU, phần lẻ DỒN VÀO ĐỢT CUỐI (các đợt đầu tròn số — đó là thứ
 * người thu tiền mong đợi). Có `tiLe` → dùng `allocateByWeight` (largest-remainder), vì
 * khi đã cho tỉ lệ tuỳ ý thì "đợt cuối gánh lẻ" không còn đúng hơn cách nào khác.
 *
 * Ghi chú số đo: cả 5 khoá Sata3-7 chia 1/2/3/4 đều CHẴN TUYỆT ĐỐI (giá niêm yết = 48 ×
 * bội 10.000). Phần lẻ thật đến từ giảm giá kiểu SỐ TIỀN, không từ bảng giá.
 */
export function chiaDotHocPhi(tongTien: number, soDot: number, tiLe?: number[]): number[] {
  const n = Math.floor(Number.isFinite(soDot) ? soDot : 0);
  if (n <= 0) return [];
  const tong = Number.isFinite(tongTien) ? Math.max(0, Math.round(tongTien)) : 0;

  if (tiLe && tiLe.length === n) return allocateByWeight(tong, tiLe);

  const moi = Math.floor(tong / n);
  const ra = Array.from({ length: n }, () => moi);
  ra[n - 1] = tong - moi * (n - 1);
  return ra;
}

/**
 * Chia lại kế hoạch KHI đã có đợt thu tiền — giữ nguyên các đợt ĐÃ KHOÁ, chia phần
 * CÒN THIẾU cho các đợt sau (15/09/2026).
 *
 * Chủ dự án: *"khi PH đã thanh toán thì ... phải khoá phần đã thu lại, chỉ cho sửa các
 * đợt sau đó với số tiền còn thiếu chưa thanh toán."*
 *
 * ⚠️ VÌ SAO KHÔNG DÙNG `chiaDotHocPhi(tong, n)` RỒI THAY MẤY Ô ĐẦU: hàm đó chia ĐỀU
 * trên TOÀN BỘ tổng, nên đè lại đợt đã khoá bằng một số khác rồi mới sửa về là một
 * khoảnh khắc mà Σ không còn bằng tổng đơn. Ở màn hình thì khoảnh khắc đó vô hình, còn
 * ở cổng `kiemKeHoachDot` nó là một lần từ chối không ai hiểu vì sao.
 *
 * ⚠️ BẤT BIẾN GIỮ NGUYÊN: Σ (đã khoá + chia mới) === `tongTien`. Phần chia cho các đợt
 * sau = `tongTien − Σ đã khoá`, và `chiaDotHocPhi` tự giữ bất biến trên phần đó.
 *
 * ⚠️ Σ đã khoá VƯỢT tổng đơn (giảm giá sau khi đã thu, hoặc khách đóng thừa) ⇒ các đợt
 * sau nhận 0đ, KHÔNG nhận số âm. Số âm ở đây là một phiếu thu âm — thứ không tồn tại
 * trong nghiệp vụ, và `kiemKeHoachDot` sẽ từ chối; trả 0 để người bán tự thấy là không
 * còn gì để chia và đi sửa tổng đơn.
 *
 * `soDotConLai <= 0` ⇒ trả đúng phần đã khoá: kế hoạch chỉ còn những đợt đã thu.
 */
export function chiaDotGiuDotDaKhoa(
  tongTien: number,
  daKhoa: readonly number[],
  soDotConLai: number,
): number[] {
  const tong = Number.isFinite(tongTien) ? Math.max(0, Math.round(tongTien)) : 0;
  const khoa = daKhoa.map((n) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0));
  const daDung = khoa.reduce((a, b) => a + b, 0);
  const n = Math.floor(Number.isFinite(soDotConLai) ? soDotConLai : 0);
  if (n <= 0) return khoa;
  // KHÔNG bọc `Math.max(0, …)` ở đây: `chiaDotHocPhi` ĐÃ kẹp âm về 0 bên trong, nên bọc
  // lần nữa là MÃ CHẾT — và mã chết trông y hệt một cái gác đang làm việc.
  //
  // ⚠️ Biết được điều này nhờ BƯỚC CẤY LỖI: cấy bỏ kẹp của tôi mà cả 40 ca VẪN XANH,
  // tức dòng đó chưa từng có tác dụng và [KHOA-04] đang kiểm cái kẹp của `chiaDotHocPhi`
  // chứ không kiểm dòng này. Ai muốn đổi luật kẹp thì sửa ở `chiaDotHocPhi` — chỗ DUY
  // NHẤT giữ nó.
  return [...khoa, ...chiaDotHocPhi(tong - daDung, n)];
}

/**
 * Hạn đóng cho từng đợt: đợt 1 đến hạn NGAY mốc, các đợt sau cách đều `buoc` ngày.
 *
 * ⚠️ Mốc BẮT BUỘC truyền vào — hàm không đọc `new Date()`. Test có ngày tuyệt đối mà hàm
 * rơi về đồng hồ thật là bom hẹn giờ: mã không đổi, tờ lịch đổi, CI đỏ (luật 19).
 *
 * ⚠️ Đợt 1 đến hạn ngay mốc là CÓ CHỦ ĐÍCH và có hệ quả: nếu đợt 1 chưa thu thì khách
 * ĐANG nợ ngay hôm đó, và cron nhắc nợ sẽ nhắc. Đó là hành vi đúng — người lập kế hoạch
 * vẫn sửa được hạn từng đợt trên form nếu muốn lùi.
 */
export function hanChoDot(moc: Date, soDot: number, buoc = BUOC_HAN_MAC_DINH): Date[] {
  const n = Math.floor(Number.isFinite(soDot) ? soDot : 0);
  if (n <= 0) return [];
  const b = Math.max(1, Math.floor(Number.isFinite(buoc) ? buoc : BUOC_HAN_MAC_DINH));
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(moc.getTime());
    d.setUTCDate(d.getUTCDate() + k * b);
    return d;
  });
}

export type DotKeHoach = {
  amount: number;
  /** Đợt này đã thu tiền rồi (sale cầm tiền trước khi lưu kế hoạch). */
  daThu: boolean;
  dueDate: Date | null;
};

export type KiemKeHoachKetQua =
  | { ok: true; coDotChuaThu: boolean }
  | { ok: false; error: string; coDotChuaThu?: undefined };

const vnd = (n: number) => n.toLocaleString("vi-VN");

export function kiemKeHoachDot(dots: DotKeHoach[], totalAmount: number): KiemKeHoachKetQua {
  if (dots.length === 0) return { ok: false, error: "Kế hoạch phải có ít nhất một đợt" };
  if (dots.length > TRAN_SO_DOT) {
    return { ok: false, error: `Tối đa ${TRAN_SO_DOT} đợt` };
  }
  if (dots.some((d) => !Number.isFinite(d.amount) || d.amount < 0)) {
    return { ok: false, error: "Số tiền của đợt không hợp lệ" };
  }

  const tong = dots.reduce((s, d) => s + Math.round(d.amount), 0);
  const phai = Math.round(totalAmount);
  if (tong !== phai) {
    return { ok: false, error: `Tổng các đợt phải bằng học phí (${vnd(phai)}đ), đang là ${vnd(tong)}đ` };
  }

  // Đợt chưa thu mà không có hạn thì cron nhắc nợ không nhắc được ai, và công nợ quá hạn
  // không bao giờ hiện — khoản đó lặng lẽ biến mất khỏi mọi màn theo dõi.
  const thieuHan = dots.findIndex((d) => !d.daThu && d.dueDate == null);
  if (thieuHan >= 0) {
    return { ok: false, error: `Đợt ${thieuHan + 1} chưa thu — phải có ngày hẹn đóng` };
  }

  // ⚠️ `coDotChuaThu`, KHÔNG phải `dots.length > 1`. Kế hoạch MỘT đợt trả sau là 100% nợ
  // và phải đi qua đúng những cổng mà kế hoạch nhiều đợt đi qua; đếm số đợt thì nó lọt.
  return { ok: true, coDotChuaThu: dots.some((d) => !d.daThu) };
}

/**
 * Phân phần chênh Ledger-A cho TỪNG đợt đã thu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO KHÔNG THỂ DÙNG MỘT CON SỐ CHÊNH CHO N LỜI GỌI
 *
 * `ensureOrderPaymentRecorded` idempotent theo SỰ TỒN TẠI của marker `[auto:order-installment:dotN]`,
 * KHÔNG so số tiền: có marker thì return, không có thì `create`. Marker là per-soDot.
 *
 * Nên "tính chênh theo TỔNG rồi lặp các đợt đã thu, mỗi đợt gọi một lần" là tạo tiền mới:
 * một con số chênh, n marker khác nhau, không marker nào dedupe được marker nào ⇒ n dòng
 * Payment. Còn "dồn hết vào một marker" thì tổng đúng lúc lưu nhưng đợt 2..n PAID mà
 * KHÔNG có marker của nó — bất biến "đợt PAID ⇒ có marker dot_k" gãy, và mọi đường ghi bù
 * sau này (dữ liệu cũ, ca REJECTED→APPROVED) sẽ `create` thêm vì không thấy marker.
 *
 * Luật ở đây giữ CẢ HAI: tổng phần ghi thêm === phần còn thiếu so với sổ (R-01, không
 * cộng đôi với tiền cổng/backfill), VÀ mỗi đợt đã thu nhận phần của riêng nó theo marker
 * riêng. Đổ vào đợt ĐẦU trước — đợt sớm hơn là đợt khách đóng trước.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function phanBoGhiTheoDot(soTienCacDotDaThu: number[], daCoTrongSo: number): number[] {
  const dots = soTienCacDotDaThu.map((n) =>
    Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0,
  );
  if (dots.length === 0) return [];

  const tongKeHoach = dots.reduce((s, x) => s + x, 0);
  const daCo = Number.isFinite(daCoTrongSo) ? Math.max(0, Math.round(daCoTrongSo)) : 0;
  let conPhaiGhi = Math.max(0, tongKeHoach - daCo);

  return dots.map((amount) => {
    const ghi = Math.min(amount, conPhaiGhi);
    conPhaiGhi -= ghi;
    return ghi;
  });
}

/** Một đợt sau khi đã chèn cọc. `laCoc` để màn hình đặt nhãn và để đường ghi đánh dấu phiếu. */
export type DotCoCoc = { amount: number; laCoc: boolean };

/**
 * Chèn TIỀN CỌC vào đầu kế hoạch và trừ dần từ đợt 1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CHỦ DỰ ÁN CHỐT 14/09/2026: "có 1 ô tích cọc tiền… số tiền đó sinh mã QR trước để KH
 * thanh toán, và sau khi KH cọc thì lần sau thanh toán sẽ được trừ cọc trên số tiền khoá
 * học, và cọc trừ vào đợt 1 (tuỳ theo KH chọn đóng bao nhiêu học phần)."
 *
 * ⚠️ CỌC KHÔNG PHẢI KHOẢN THU THÊM. Nó là phần ĐẦU của học phí, đóng sớm. Bất biến phải
 * giữ: Σ (cọc + mọi đợt) === tổng đơn. Cộng cọc ra ngoài tổng là đòi khách trả nhiều hơn
 * giá khoá — và vì mỗi đợt có QR riêng, khách sẽ quét đủ số đó thật.
 *
 * Cọc lớn hơn đợt 1 thì TRÀN sang đợt sau chứ không để đợt nào âm: khách cọc 5tr trong
 * khi đợt 1 chỉ 2,64tr là chuyện thật, và một đợt mang số âm sẽ phá mọi phép cộng phía sau.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function chenCoc(soTienCacDot: number[], coc: number): DotCoCoc[] {
  const dots = soTienCacDot.map((n) =>
    Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0,
  );
  const tong = dots.reduce((s, x) => s + x, 0);

  const c = Number.isFinite(coc) ? Math.max(0, Math.round(coc)) : 0;
  if (c <= 0) return dots.map((amount) => ({ amount, laCoc: false }));

  // Cọc không bao giờ vượt tổng đơn — kẹp lại thay vì tạo tiền từ không khí.
  const cocThuc = Math.min(c, tong);

  let conTru = cocThuc;
  const sau = dots.map((amount) => {
    const tru = Math.min(amount, conTru);
    conTru -= tru;
    return { amount: amount - tru, laCoc: false };
  });

  return [{ amount: cocThuc, laCoc: true }, ...sau];
}

/** Một đợt như FORM gửi lên: ngày là chuỗi `yyyy-mm-dd` của `<input type="date">`. */
export type DotTuForm = {
  amount: number;
  daThu: boolean;
  /** Tuỳ chọn vì Zod cho `.optional().nullable()` — "thiếu" và "null" cùng nghĩa ở đây. */
  dueDate?: string | null;
  reminderDays?: number | null;
};

/** Một đợt đã sẵn sàng GHI (khớp `DotGhi` của `lib/orders/installments.ts`). */
export type DotDeGhi = {
  amount: number;
  daThu: boolean;
  dueDate: Date | null;
  reminderDays: number | null;
};

/**
 * Quy đợt từ FORM về đợt để GHI — BIÊN giữa chuỗi của trình duyệt và Date của DB.
 *
 * Nay có HAI đường ghi kế hoạch: `recordOrderInstallmentsAction` (đơn đã có) và
 * `createOrderManualAction` (kế hoạch lập ngay lúc tạo đơn, 15/09/2026). Phép quy đổi này
 * phải là MỘT — nó quyết định ba thứ mà lệch một cái là lệch tiền hoặc lệch nhắc nợ:
 *
 *  · `Invalid Date` → `null`, KHÔNG đi tiếp. Cho nó qua là ghi `dueDate` rác vào DB và cron
 *    nhắc nợ im lặng bỏ qua đợt đó — khoản nợ biến khỏi mọi màn theo dõi mà không lỗi nào
 *    báo. Để null thì `kiemKeHoachDot` từ chối với một câu nói được.
 *
 *  · `daThu === true` (so TUYỆT ĐỐI, không `truthy`): đây là cái cờ quyết định có ghi một
 *    dòng Ledger-A hay không. Chuỗi `"false"` là truthy.
 *
 *  · Đợt ĐÃ THU thì hạn và số ngày nhắc về `null`. Trước bản này chỉ CLIENT làm việc đó
 *    (`d.daThu ? null : …` trong `order-payment-section.tsx`), còn action thì không — nên
 *    một lời gọi tự chế vẫn gửi được đợt "đã thu" kèm hạn đóng, tức một hàng đợi nhắc nợ
 *    trên số tiền đã nằm trong két.
 */
export function dotsGhiTuForm(dots: readonly DotTuForm[]): DotDeGhi[] {
  return dots.map((d) => {
    const daThu = d.daThu === true;
    const ngay = !daThu && d.dueDate ? new Date(d.dueDate) : null;
    return {
      amount: Number.isFinite(d.amount) ? Math.round(d.amount) : 0,
      daThu,
      dueDate: ngay && !Number.isNaN(ngay.getTime()) ? ngay : null,
      reminderDays:
        daThu || d.reminderDays == null ? null : Math.max(0, Math.round(d.reminderDays)),
    };
  });
}
