// lib/finance/chia-dot-cho-con.ts — CHIA HỌC PHÍ TỪNG CON VÀO CÁC ĐỢT CỦA ĐƠN.
// THUẦN, không chạm DB, không ghi gì.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN J · Chủ dự án chốt 24/09/2026
//
//   *"Làm công nợ theo con được chia đợt theo số đợt thu tiền của tổng đơn."*
//   Chốt kèm: **GIỮ đợt cấp đơn, chỉ HIỆN chia theo con** · chia **theo TỶ LỆ** của kế
//   hoạch đơn (không phải chia đều).
//
// ⚠️ TỆP NÀY KHÔNG SINH PHIẾU THU NÀO. Nó trả một BẢNG ĐỂ ĐỌC. Mã QR, đối khớp, và mọi
// phép ghi vẫn đi đúng đường cũ qua `PaymentRequest` cấp đơn.
//
// **Vì sao KHÔNG sinh phiếu theo con ở đây** — không phải vì ngại, mà vì cổng tiền đang
// chạy CẤM: `kiemTaoDot` có vế ĐƠN
//
//     số tiền đợt ≤ còn nợ ĐƠN − Σ đợt đang mở của CẢ ĐƠN   (kể cả đợt `orderItemId` NULL)
//
// Trên một đơn đã có kế hoạch phủ trọn học phí, vế đó bằng 0 ⇒ mọi đợt theo con bị từ
// chối. Và đó là cổng ĐÚNG: có cả hai loại đợt nghĩa là mỗi kỳ phát HAI mã QR cùng đòi
// tiền, phụ huynh quét cả hai thì trả hai lần. Muốn sinh phiếu theo con thì phải VOID kế
// hoạch cấp đơn — một quyết định khác, chủ dự án đã chọn KHÔNG làm.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHIA THEO CÁI GÌ: `phaiThu`, KHÔNG PHẢI `conNo`
//
// Kế hoạch đợt của đơn là lịch thu cho TRỌN học phí, nên thứ ánh xạ được vào nó là **học
// phí thực của từng con**. Lấy `conNo` thì bảng nhảy số mỗi lần có tiền về, và tổng cột
// không còn bằng số tiền của đợt — trong khi cột chính là thứ người đọc đối chiếu với
// khối "PHIẾU THU & QR THEO ĐỢT" ngay bên dưới.
//
// Phần ĐÃ ĐÓNG không bị bỏ quên: nó hiện thành `daPhu` trên từng ô (xem dưới), theo lối
// waterfall đợt-sớm-trước — đúng thứ tự rót thật của `lib/payments/thu-tu-rot.ts`.
//
// ⚠️ `daThu` truyền vào phải là **TRỤC A** (`NoCuaCon.daThu`, tức `accountantStatus =
// CONFIRMED`). Đây là con số sale đọc cho phụ huynh; lấy tập rộng hơn là nói "bé đóng rồi"
// cho một khoản kế toán còn có thể TỪ CHỐI.

/** Một đợt của kế hoạch CẤP ĐƠN. */
export type DotDonDeChia = {
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
};

/** Một con, với học phí thực và phần đã thu theo TRỤC A. */
export type ConDeChia = {
  orderItemId: string;
  ten: string;
  /** Học phí thực của con — `NoCuaCon.phaiThu`. */
  phaiThu: number;
  /** TRỤC A — `NoCuaCon.daThu`. */
  daThu: number;
};

/** Một ô của bảng: con × đợt. */
export type ODotCon = {
  /** Phần học phí của con này rơi vào đợt này. */
  soTien: number;
  /**
   * Trong `soTien` đó, bao nhiêu đã được phần ĐÃ THU của con phủ (waterfall đợt sớm trước).
   *
   * `daPhu === soTien` ⇒ ô đã đóng xong. `0 < daPhu < soTien` ⇒ đóng dở. `0` ⇒ chưa đóng.
   */
  daPhu: number;
};

export type HangChia = {
  orderItemId: string;
  ten: string;
  /** Đúng `dot.length` ô, cùng thứ tự với `dot`. */
  o: ODotCon[];
  /** Σ `o[].soTien` — BẤT BIẾN: luôn bằng `phaiThu` của con. */
  tong: number;
};

export type ChiaDotKetQua =
  | { co: false; lyDo: string }
  | {
      co: true;
      dot: DotDonDeChia[];
      hang: HangChia[];
      /** Σ theo từng cột. */
      tongTheoDot: number[];
      /**
       * Σ học phí các con CÓ bằng Σ số tiền các đợt không.
       *
       * `true` ⇒ mỗi cột khớp ĐÚNG số tiền của đợt tương ứng (bất biến cột).
       * `false` ⇒ kế hoạch đơn không phủ đúng học phí (sửa giá sau khi lên kế hoạch, hoặc
       * kế hoạch dựng cho số khác). Bảng vẫn đúng theo HÀNG, nhưng cột sẽ lệch — và màn
       * hình PHẢI nói ra, vì người đọc đối chiếu cột với khối phiếu thu bên dưới.
       */
      khopKeHoach: boolean;
      /** Σ số tiền các đợt của kế hoạch đơn. */
      tongKeHoach: number;
      /** Σ học phí thực các con. */
      tongPhaiThu: number;
    };

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * Chia học phí từng con vào các đợt của đơn, theo TỶ LỆ số tiền từng đợt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HAI BẤT BIẾN, VÀ CÁCH ĐẠT CẢ HAI CÙNG LÚC
 *
 *   HÀNG: Σ ô của một con  = học phí thực của con đó          (LUÔN đúng)
 *   CỘT:  Σ ô của một đợt  = số tiền của đợt đó               (đúng khi `khopKeHoach`)
 *
 * Làm tròn từng ô rồi cộng lại thì **cả hai** vỡ: 2 con × 4 đợt là 8 phép làm tròn độc
 * lập, sai số dồn tới vài đồng, và bảng in ra một tổng khác tổng ở khối phiếu thu ngay
 * dưới — người đọc sẽ tin là hệ thống tính sai.
 *
 * Cách dùng ở đây: **làm tròn trên TÍCH LUỸ HAI CHIỀU**. Đặt
 *
 *     F(a, b) = round( CumCon[a] × CumDot[b] / T )
 *     ô(i, j) = F(i,j) − F(i−1,j) − F(i,j−1) + F(i−1,j−1)
 *
 * Tổng theo hàng thì các hạng tử triệt tiêu, chỉ còn `F(i,N) − F(i−1,N)`; mà
 * `F(i,N) = round(CumCon[i] × T / T) = CumCon[i]` là số NGUYÊN có sẵn, nên hàng khớp
 * TUYỆT ĐỐI — không phải "gần đúng". Cột cũng vậy với `F(M,j) = CumDot[j]`.
 *
 * ⚠️ Đây là lý do KHÔNG viết `Math.round(phaiThu * amountDue / T)` cho từng ô rồi dồn dư
 * vào ô cuối: thủ thuật "dồn dư" chỉ cứu được MỘT chiều, và chiều còn lại vẫn lệch.
 *
 * ⚠️ Ô có thể ÂM về lý thuyết (bốn phép làm tròn cộng lại sai tối đa 2 đồng, nên ô có giá
 * trị thật < 2đ có thể ra −1). Không im lặng kẹp về 0 — kẹp là phá bất biến hàng/cột mà
 * không ai biết. Gặp thì trả `co: false` kèm lý do; ca `[CDC-07]` ghim.
 */
export function chiaDotChoCon(input: {
  dot: readonly DotDonDeChia[];
  con: readonly ConDeChia[];
}): ChiaDotKetQua {
  const dot = input.dot
    .map((d) => ({ ...d, amountDue: tron(d.amountDue) }))
    .filter((d) => d.amountDue > 0);
  const con = input.con.map((c) => ({
    ...c,
    phaiThu: tron(c.phaiThu),
    daThu: Math.max(0, tron(c.daThu)),
  }));

  if (dot.length === 0) return { co: false, lyDo: "Đơn này chưa có kế hoạch chia đợt" };
  if (con.length === 0) return { co: false, lyDo: "Đơn này chưa có dòng nào" };

  const tongKeHoach = dot.reduce((s, d) => s + d.amountDue, 0);
  const tongPhaiThu = con.reduce((s, c) => s + c.phaiThu, 0);
  if (tongPhaiThu <= 0) return { co: false, lyDo: "Học phí các con đang bằng 0" };

  // Chia theo TỶ LỆ kế hoạch, nhưng quy mô là HỌC PHÍ CÁC CON — nhờ vậy hàng luôn khớp kể
  // cả khi kế hoạch không phủ đúng học phí. `T` là mẫu số chung của cả hai chiều.
  const T = tongPhaiThu;

  // Tích luỹ hai chiều. `cumCon[0] = 0`, `cumDot[0] = 0`.
  const cumCon: number[] = [0];
  for (const c of con) cumCon.push(cumCon[cumCon.length - 1]! + c.phaiThu);
  const cumDotTho: number[] = [0];
  for (const d of dot) cumDotTho.push(cumDotTho[cumDotTho.length - 1]! + d.amountDue);
  // Chuẩn hoá chiều ĐỢT về thang `T`: khi kế hoạch khớp học phí thì đây là phép nhân 1.
  const cumDot = cumDotTho.map((v) => (v * T) / tongKeHoach);

  const F = (a: number, b: number) => Math.round((cumCon[a]! * cumDot[b]!) / T);

  const hang: HangChia[] = [];
  const tongTheoDot = dot.map(() => 0);

  for (let i = 1; i <= con.length; i++) {
    const c = con[i - 1]!;
    const o: ODotCon[] = [];
    // Waterfall: phần đã thu của con phủ các đợt theo thứ tự SỚM TRƯỚC — cùng thứ tự rót
    // thật (`lib/payments/thu-tu-rot.ts`). Đừng chia đều phần đã thu cho mọi đợt: làm vậy
    // thì không đợt nào "xong", và bảng mất đúng thông tin sale cần ("bé này đóng tới đâu").
    let conLaiDaThu = c.daThu;
    for (let j = 1; j <= dot.length; j++) {
      const soTien = F(i, j) - F(i - 1, j) - F(i, j - 1) + F(i - 1, j - 1);
      if (soTien < 0) {
        return {
          co: false,
          lyDo:
            `Không chia được: ô "${c.ten} × đợt ${dot[j - 1]!.installmentNo}" ra số âm ` +
            `(${soTien}đ). Số tiền đợt hoặc học phí đang quá nhỏ so với số đợt.`,
        };
      }
      const daPhu = Math.min(conLaiDaThu, soTien);
      conLaiDaThu -= daPhu;
      o.push({ soTien, daPhu });
      tongTheoDot[j - 1] = tongTheoDot[j - 1]! + soTien;
    }
    hang.push({
      orderItemId: c.orderItemId,
      ten: c.ten,
      o,
      tong: o.reduce((s, x) => s + x.soTien, 0),
    });
  }

  return {
    co: true,
    dot,
    hang,
    tongTheoDot,
    khopKeHoach: tongKeHoach === tongPhaiThu,
    tongKeHoach,
    tongPhaiThu,
  };
}
