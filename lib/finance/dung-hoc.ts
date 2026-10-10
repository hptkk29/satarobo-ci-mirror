// lib/finance/dung-hoc.ts — PHÉP QUYẾT TOÁN khi một CON dừng học. THUẦN, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN D · Chủ dự án chốt 21/09/2026
//
//   *"Buổi đã dùng = số ClassSession của lớp có date ≤ ngày buổi cuối (KHÔNG đếm theo
//   status). Giá trị đã dùng = buổi đã dùng × đơn giá buổi (học phí thực của con ÷ số
//   buổi cam kết; phần lẻ dồn buổi cuối)."*
//
// Phần DB nằm ở `lib/finance/dung-hoc-con.ts`; đây chỉ là số học, nên mọi luật dưới đây
// kiểm được bằng `pnpm test:unit` (bộ đó CẤM chạm Postgres).
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN QUYẾT ĐỊNH ĐÃ CHỐT, GHI LẠI VÌ CHÚNG ĐỀU TỪNG CÓ PHƯƠNG ÁN KHÁC
//
// 1 · **Mẫu số là `Course.totalSessions` (số buổi CAM KẾT), không phải số buổi đã xếp
//     lịch.** Phương án kia — đếm `ClassSession` của lớp, giống `computeRefund` đang chạy
//     — thua vì lớp xếp dư/thiếu buổi so với cam kết sẽ làm đơn giá trượt theo, và phụ
//     huynh mua "48 buổi" chứ không mua "số buổi phòng đào tạo xếp được".
//     ⚠️ Hệ quả PHẢI biết: đơn giá ở đây **có thể khác** đơn giá mà `/admin/hoan-tien` in
//     ra cho cùng một bé (`computeRefund` chia cho số buổi đã xếp). Hai con số, hai câu
//     hỏi — nhưng nếu ai đó gộp chúng lại sau này thì phải gộp có chủ đích, không phải vì
//     tưởng chúng vốn là một. Ticket + cách đo TRƯỚC/SAU:
//     `docs/no-thong-nhat-don-gia-hoan-tien.md` (chủ dự án chốt 21/09: giữ tách).
//
// 2 · **Khoá chưa khai `totalSessions` ⇒ TỪ CHỐI dừng học**, không đoán. Cùng lý lẽ với
//     `lib/finance/lop-chua-chot-buoi.ts`: chia cho một con số không ai khai là chi tiền
//     theo một giả định. `soBuoiCamKet = null | 0` ⇒ `khongTinhDuoc`.
//     Ngoại lệ DUY NHẤT: `soBuoiDaDung === 0` thì không cần mẫu số (0 × gì cũng bằng 0) —
//     đó là ca dòng đơn chưa gắn ghi danh, bé chưa học buổi nào.
//
// 3 · **Đơn giá làm tròn XUỐNG tới 1.000đ**, phần lẻ dồn buổi cuối. Đồng nghĩa: dùng HẾT
//     số buổi cam kết ⇒ giá trị đã dùng = ĐÚNG học phí thực, không phải `đơn giá × số
//     buổi` (phép nhân ấy thiếu đúng phần lẻ vừa bị làm tròn đi).
//     Đo: 10.000.000 ÷ 48 = 208.333,3 → đơn giá 208.000 → ×48 = 9.984.000, hụt 16.000đ.
//     Luật "dồn buổi cuối" là thứ trả lại 16.000đ ấy.
//
// 4 · **`TRUNG_TAM_HUY` ⇒ phí 0.** Trung tâm huỷ thì bé không nợ gì, kể cả đã học 20 buổi.
//     Đây là phép tính, không phải nhãn — đặt nó ở tầng hiển thị là có ngày một đường ghi
//     khác quên mất.

/** Vì sao con này dừng học. Khớp enum `OrderItemStopReason` trong `prisma/schema.prisma`. */
export type LyDoDungHoc = "PH_CHU_DONG" | "TRUNG_TAM_HUY" | "KHAC";

/** Bước làm tròn đơn giá một buổi. Chủ dự án chốt 21/09/2026. */
export const BUOC_LAM_TRON_DON_GIA = 1_000;

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

export type QuyetToanDungHoc = {
  /** Đơn giá một buổi, đã làm tròn xuống tới 1.000đ. `0` khi không cần mẫu số. */
  donGiaBuoi: number;
  /** Số tiền bé này rốt cuộc phải trả. Luôn trong `[0, hocPhiThuc]`. */
  giaTriDaDung: number;
  /**
   * Câu cảnh báo cho sale đọc. KHÔNG phải lỗi — phép tính vẫn ra số.
   *
   * ⚠️ Cảnh báo mà không ai đọc thì bằng không, nên màn xem trước BẮT BUỘC in mảng này.
   */
  canhBao: string[];
};

export type KhongTinhDuoc = { khongTinhDuoc: true; loi: string };

/**
 * Quyết toán phần bé này đã dùng.
 *
 * ⚠️ `soBuoiDaDung` là con số **người xác nhận**, không phải con số hệ thống suy ra. Hàm
 * này cố ý không biết gì về `ClassSession.status` — xem chú thích mục 2 đầu tệp và
 * `lib/finance/lop-chua-chot-buoi.ts` (nơi đã trả giá cho việc tin vào `status`).
 */
export function tinhQuyetToan(input: {
  /** Học phí thực của con = `OrderItem.totalPrice − discountAmount`. */
  hocPhiThuc: number;
  /** `Course.totalSessions`. `null`/`0` = khoá chưa khai. */
  soBuoiCamKet: number | null;
  soBuoiDaDung: number;
  lyDo: LyDoDungHoc;
  /** Tên khoá, chỉ để dựng câu lỗi cho người vận hành đọc. */
  tenKhoa?: string | null;
}): QuyetToanDungHoc | KhongTinhDuoc {
  const hocPhiThuc = Math.max(0, tron(input.hocPhiThuc));
  const daDung = Math.max(0, Math.trunc(tron(input.soBuoiDaDung)));
  const camKet = input.soBuoiCamKet == null ? 0 : Math.trunc(tron(input.soBuoiCamKet));
  const canhBao: string[] = [];

  // QUYẾT ĐỊNH 4 — trung tâm huỷ thì phí bằng 0, và nó thắng MỌI phép tính khác. Đặt cổng
  // này TRƯỚC cổng "chưa khai số buổi": khoá chưa khai `totalSessions` vẫn phải huỷ được,
  // vì phép tính không cần mẫu số nữa.
  if (input.lyDo === "TRUNG_TAM_HUY") {
    return {
      donGiaBuoi: 0,
      giaTriDaDung: 0,
      canhBao: [
        `Trung tâm huỷ — phí bằng 0. Toàn bộ ${vnd(hocPhiThuc)}đ học phí không thu, ` +
          `mọi khoản đã thu của bé thành khoản dư phải phân hết.`,
      ],
    };
  }

  // Chưa học buổi nào ⇒ không cần mẫu số. Đây là ca dòng đơn chưa gắn ghi danh (không có
  // lớp, không có buổi nào để đếm) — và nó KHÔNG được rơi vào cổng "khoá chưa khai".
  if (daDung === 0) {
    return {
      donGiaBuoi: camKet > 0 ? donGiaMotBuoi(hocPhiThuc, camKet) : 0,
      giaTriDaDung: 0,
      canhBao: [],
    };
  }

  // QUYẾT ĐỊNH 2 — từ chối, không đoán.
  if (camKet <= 0) {
    return {
      khongTinhDuoc: true,
      loi:
        `Khoá ${input.tenKhoa ? `"${input.tenKhoa}" ` : ""}chưa khai số buổi cam kết — ` +
        `admin điền "Tổng số buổi" của khoá rồi thử lại.`,
    };
  }

  const donGiaBuoi = donGiaMotBuoi(hocPhiThuc, camKet);

  // QUYẾT ĐỊNH 3 — dùng hết (hoặc lố) số buổi cam kết thì giá trị là ĐÚNG học phí thực.
  // Phần lẻ bị làm tròn đi nằm trọn ở buổi cuối.
  if (daDung >= camKet) {
    if (daDung > camKet) {
      canhBao.push(
        `Bé đã học ${daDung} buổi, nhiều hơn ${camKet} buổi cam kết của khoá. ` +
          `Giá trị đã dùng CHẶN ở đúng học phí thực (${vnd(hocPhiThuc)}đ) — ` +
          `hệ thống không đòi quá học phí. Phần dạy thêm xử lý ngoài đơn này.`,
      );
    }
    return { donGiaBuoi, giaTriDaDung: hocPhiThuc, canhBao };
  }

  return { donGiaBuoi, giaTriDaDung: donGiaBuoi * daDung, canhBao };
}

/**
 * Đơn giá một buổi — làm tròn XUỐNG tới `BUOC_LAM_TRON_DON_GIA`.
 *
 * ⚠️ Làm tròn xuống chứ không `Math.round`: làm tròn lên thì `đơn giá × số buổi` có thể
 * VƯỢT học phí thực ở những buổi gần cuối, tức hệ thống đòi bé một số tiền lớn hơn thứ
 * phụ huynh đã ký. Hụt thì còn thu thêm được; thừa là đòi tiền không có căn cứ.
 */
function donGiaMotBuoi(hocPhiThuc: number, soBuoiCamKet: number): number {
  const tho = hocPhiThuc / soBuoiCamKet;
  return Math.floor(tho / BUOC_LAM_TRON_DON_GIA) * BUOC_LAM_TRON_DON_GIA;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHÂN HẾT KHOẢN DƯ
//
// Chủ dự án chốt 21/09/2026: *"> 0 → bắt buộc phân HẾT khoản dư trước khi xác nhận…
// Σ phải đúng bằng chênh. Không có lựa chọn 'không hoàn' trong phiên này."*
//
// ⚠️ "ĐÚNG BẰNG", không phải "≤". Cho phép phân thiếu là để lại một khoản tiền của phụ
// huynh nằm trong sổ mà không ai còn lý do đi tìm nó — đúng cái chết câm mà module này
// sinh ra để chặn. Cho phép phân thừa thì khỏi nói.
// ─────────────────────────────────────────────────────────────────────────────

export type PhanDu =
  /** Chuyển sang một con KHÁC của CÙNG đơn. */
  | { kieu: "CHUYEN"; orderItemId: string; soTien: number }
  /** Kế toán hoàn cho phụ huynh — sinh `RefundRequest` PENDING, KHÔNG chi tiền ngay. */
  | { kieu: "HOAN"; soTien: number };

export type TranNhanCuaCon = {
  orderItemId: string;
  ten: string;
  /** Bé này còn nợ bao nhiêu — trần của phần CHUYỂN sang bé đó. */
  conNo: number;
};

export type KiemPhanDu =
  | { ok: true; phan: PhanDu[]; tongChuyen: number; tongHoan: number }
  | { ok: false; loi: string };

/**
 * Phép phân khoản dư có hợp lệ không.
 *
 * Thứ tự cổng: HÌNH DẠNG trước → TRẦN từng bé → TỔNG sau cùng.
 *
 * ⚠️ Thứ tự ấy có chủ đích, giống `kiemTachKhoan`: báo "Σ chưa đủ" trong khi thứ sai thật
 * sự là "gõ số âm" sẽ khiến người vận hành đi sửa nhầm chỗ, rồi họ học cách không tin câu
 * lỗi nữa.
 */
export function kiemPhanDu(input: {
  /** Khoản dư phải phân hết (luôn > 0 khi hàm này được gọi). */
  du: number;
  phan: readonly PhanDu[];
  /** Các con CÒN LẠI của đơn — KHÔNG gồm bé vừa dừng học. */
  tranNhan: readonly TranNhanCuaCon[];
}): KiemPhanDu {
  const du = tron(input.du);
  if (du <= 0) return { ok: false, loi: "Không có khoản dư nào để phân" };
  if (input.phan.length === 0) {
    return {
      ok: false,
      loi:
        `Phải phân hết ${vnd(du)}đ dư trước khi xác nhận: chuyển sang bé còn lại ` +
        `và/hoặc để kế toán hoàn. Không có lựa chọn "để đó".`,
    };
  }

  const tranTheoId = new Map(input.tranNhan.map((t) => [t.orderItemId, t]));
  const daNhan = new Map<string, number>();
  let tongChuyen = 0;
  let tongHoan = 0;

  for (const p of input.phan) {
    const soTien = tron(p.soTien);
    if (!Number.isFinite(p.soTien) || soTien <= 0) {
      return { ok: false, loi: "Mỗi phần phải lớn hơn 0đ" };
    }
    if (p.kieu === "HOAN") {
      tongHoan += soTien;
      continue;
    }
    const tran = tranTheoId.get(p.orderItemId);
    // Gộp hai ca: bé thuộc đơn khác, và bé CHÍNH LÀ bé vừa dừng (người gọi đã loại nó
    // khỏi `tranNhan`). Chuyển tiền cho chính bé vừa dừng là một vòng tròn vô nghĩa.
    if (!tran) {
      return {
        ok: false,
        loi: "Chỉ chuyển được cho một bé KHÁC đang còn học trên cùng đơn này",
      };
    }
    const luyKe = (daNhan.get(p.orderItemId) ?? 0) + soTien;
    if (luyKe > Math.max(0, tron(tran.conNo))) {
      return {
        ok: false,
        loi:
          `${tran.ten} chỉ nhận thêm được tối đa ${vnd(Math.max(0, tran.conNo))}đ ` +
          `(đúng phần còn nợ của bé). Phần vượt phải để kế toán hoàn cho phụ huynh.`,
      };
    }
    daNhan.set(p.orderItemId, luyKe);
    tongChuyen += soTien;
  }

  const tong = tongChuyen + tongHoan;
  if (tong !== du) {
    const thieu = du - tong;
    return {
      ok: false,
      loi:
        thieu > 0
          ? `Còn ${vnd(thieu)}đ chưa phân. Σ các phần phải ĐÚNG BẰNG ${vnd(du)}đ dư.`
          : `Phân vượt ${vnd(-thieu)}đ. Σ các phần phải ĐÚNG BẰNG ${vnd(du)}đ dư.`,
    };
  }

  return {
    ok: true,
    phan: input.phan.map((p) =>
      p.kieu === "HOAN"
        ? { kieu: "HOAN", soTien: tron(p.soTien) }
        : { kieu: "CHUYEN", orderItemId: p.orderItemId, soTien: tron(p.soTien) },
    ),
    tongChuyen,
    tongHoan,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ĐẾM BUỔI ĐÃ DÙNG
// ─────────────────────────────────────────────────────────────────────────────

export type BuoiCuaLop = {
  id: string;
  date: Date;
  /** `ClassSession.status` — chuỗi, không ràng enum để test không cần Prisma. */
  status: string;
};

/**
 * Buổi nào tính là ĐÃ DÙNG khi bé dừng sau `ngayBuoiCuoi`.
 *
 * ⚠️ Đếm theo NGÀY, **không** theo `status` — chủ dự án chốt 21/09/2026, và lý do là một
 * phép đo: buổi quá khứ phần lớn còn `SCHEDULED` (đo prod 07/09: 209/287 buổi đã qua ngày
 * chưa ai chốt). Đếm theo `status` thì một lớp đã dạy gần hết vẫn đọc ra 0 buổi ⇒ quyết
 * toán 0đ ⇒ hoàn 100% học phí. Đó chính là con bug đã tắt hẳn tính năng hoàn tiền suốt
 * một tuần (`lib/finance/lop-chua-chot-buoi.ts`).
 *
 * ⚠️ Buổi `CANCELLED` KHÔNG tính: lớp huỷ buổi thì bé không học buổi đó, dù ngày đã qua.
 * Đây là ngoại lệ DUY NHẤT mà `status` được phép nói, và nó nói theo hướng AN TOÀN cho
 * phụ huynh (đếm ít đi ⇒ phải trả ít đi).
 *
 * ⚠️ So sánh `<=` trên mốc CUỐI NGÀY của `ngayBuoiCuoi`: `ClassSession.date` là
 * `Timestamptz` MANG GIỜ THẬT (không phải `@db.Date`), nên so thẳng với 00:00 của ngày ấy
 * sẽ **rụng mất chính buổi cuối** mà sale vừa chọn. Bẫy này có ghi trong
 * `docs/luat-doc-so-va-ket-luan.md`.
 */
export function buoiDaDung(buoi: readonly BuoiCuaLop[], ngayBuoiCuoi: Date): BuoiCuaLop[] {
  const moc = cuoiNgay(ngayBuoiCuoi).getTime();
  return buoi
    .filter(
      (b) => b.date instanceof Date && b.date.getTime() <= moc && b.status !== "CANCELLED",
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * 23:59:59.999 của ngày chứa `d`, theo **giờ địa phương của tiến trình**.
 *
 * ⚠️ Vercel chạy UTC còn máy dev +07 — bẫy đã ghi trong memory `tz-utc-vs-vn-landmine`.
 * Ở đây nó KHÔNG gây lệch ngày vì `d` đến từ chính `ClassSession.date` mà sale bấm chọn
 * trên danh sách buổi (cùng một tiến trình dựng ra cả hai), chứ không phải từ một chuỗi
 * `"2026-09-21"` do client gõ. Tầng action chịu trách nhiệm giữ đúng điều đó: nó nhận
 * `sessionId`, không nhận ngày.
 */
function cuoiNgay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(23, 59, 59, 999);
  return x;
}
