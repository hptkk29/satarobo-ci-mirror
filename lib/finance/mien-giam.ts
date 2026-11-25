// lib/finance/mien-giam.ts — MIỄN GIẢM NỢ CỦA MỘT CON. THUẦN, không DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN G1 · US-22 "Miễn giảm và vượt giới hạn"
//
//   AC1 — *"`billing:waive`: thêm QUYẾT TOÁN âm có lý do, KHÔNG LỚN HƠN còn nợ của ghi danh."*
//   AC3 — *"Sale gọi trực tiếp action miễn giảm → TỪ CHỐI (test deny ở action, không chỉ ẩn
//          nút)."*
//
// ─────────────────────────────────────────────────────────────────────────────
// QUYỀN: `orders:manage`, KHÔNG PHẢI `billing:waive`
//
// BA khai một quyền tên `billing:waive`. Quyền ấy **KHÔNG TỒN TẠI** trong repo — đo
// `prisma/seed-roles.ts` 22/09/2026, cả bộ chỉ có `payments:{view,record,confirm,manage,
// adjust,view-pii}` và `orders:{view,create,manage,view-pii}`.
//
// Và đây là chỗ KHÔNG được tự chế một key mới: bài học `audit-logs:view` (CLAUDE.md) — một
// quyền không vai nào được cấp biến cả màn hình thành cửa khoá, và người ta mất hàng giờ đi
// tìm "lỗi phân quyền" cho một thứ chưa bao giờ được khai.
//
// Nên cổng là `orders:manage`, và phép đo cho thấy nó khớp KHÍT với AC:
//
//   | vai                | orders:manage | US-22 muốn |
//   |--------------------|---------------|------------|
//   | CENTER_MANAGER     | ✓             | ✓ (QLCS)   |
//   | HO_ACCOUNTANT      | ✓             | ✓          |
//   | CENTER_SALES_CSM   | ✗             | ✗ (AC3)    |
//   | CENTER_ACCOUNTANT  | ✗             | —          |
//
// ⚠️ Muốn tách riêng `billing:waive` thì phải SỬA SEED + bấm chạy `seed-prod-roles.yml`
// (RBAC v2 đọc quyền từ DỮ LIỆU — merge file seed KHÔNG đổi gì trên prod). Đó là một ticket
// có chủ đích, không phải hệ quả phụ của PR này.
//
// ─────────────────────────────────────────────────────────────────────────────
// MIỄN GIẢM GHI VÀO ĐÂU — HAI CỘT, TUỲ BÉ ĐÃ DỪNG HỌC CHƯA
//
// "Phải thu của một con" được `docSoTheoCon` tính theo HAI công thức khác nhau:
//
//   · bé còn học  → `totalPrice − discountAmount`
//   · bé đã dừng  → `usedValue` (giá trị quyết toán, PHIÊN D)
//
// Nên một khoản miễn giảm phải hạ ĐÚNG cột đang được đọc. Ghi nhầm cột là con số trên màn
// KHÔNG NHÚC NHÍCH trong khi nhật ký nói đã miễn — đúng loại lỗi câm tệ nhất về tiền: người
// vận hành bấm lại lần nữa, rồi lần nữa.

import {
  keHoachHapThu,
  type CachHapThu,
  type DotDeHapThu,
  type KeHoachHapThu,
} from "@/lib/orders/chinh-sach-uu-dai";

/** Bé đã dừng học chưa — quyết định miễn giảm ghi vào cột nào. */
export const CHO_GHI = {
  /** Bé còn học ⇒ cộng vào `OrderItem.discountAmount` (một khoản giảm muộn). */
  GIAM_GIA: "GIAM_GIA",
  /** Bé đã dừng ⇒ hạ `OrderItem.usedValue` (quyết toán âm, đúng chữ của AC1). */
  QUYET_TOAN: "QUYET_TOAN",
} as const;
export type ChoGhi = (typeof CHO_GHI)[keyof typeof CHO_GHI];

export type KiemMienGiam =
  | { ok: true; soTien: number; choGhi: ChoGhi; phaiThuMoi: number }
  | { ok: false; loi: string };

const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);
const vnd = (n: number) => tron(n).toLocaleString("vi-VN");

/**
 * Miễn `soTien` nợ của một con được không, và ghi vào cột nào.
 *
 * Thứ tự cổng có chủ đích: HÌNH DẠNG → LÝ DO → TRẦN. Báo "vượt trần" cho một người quên gõ
 * lý do sẽ khiến họ đi sửa nhầm chỗ.
 */
export function kiemMienGiam(input: {
  soTien: number;
  /** `phaiThu − daThu` của bé. Có thể ÂM (bé đang đóng thừa). */
  conNo: number;
  /** `phaiThu` hiện tại của bé — để tính `phaiThuMoi`. */
  phaiThu: number;
  daDungHoc: boolean;
  lyDo: string;
  tenCon: string;
}): KiemMienGiam {
  const soTien = tron(input.soTien);
  if (!Number.isFinite(input.soTien) || soTien <= 0) {
    return { ok: false, loi: "Số tiền miễn giảm phải lớn hơn 0" };
  }
  if (!input.lyDo.trim()) {
    // Miễn giảm là tiền KHÔNG BAO GIỜ về. Câu giải trình là thứ duy nhất trả lời được
    // "vì sao nhà này bớt mà nhà kia không" khi báo cáo tháng hỏi tới.
    return { ok: false, loi: "Phải ghi lý do miễn giảm" };
  }

  const conNo = tron(input.conNo);
  if (conNo <= 0) {
    return {
      ok: false,
      loi:
        conNo === 0
          ? `${input.tenCon} không còn nợ đồng nào — không có gì để miễn.`
          : `${input.tenCon} đang ĐÓNG THỪA ${vnd(-conNo)} — miễn giảm ở đây là làm khoản ` +
            `thừa to thêm, không phải xoá nợ. Xử lý khoản thừa bằng đường chuyển sang bé khác ` +
            `hoặc hoàn tiền.`,
    };
  }
  if (soTien > conNo) {
    return {
      ok: false,
      loi: `Miễn tối đa ${vnd(conNo)}đ — đúng phần ${input.tenCon} còn nợ (AC1: không lớn hơn còn nợ).`,
    };
  }

  return {
    ok: true,
    soTien,
    choGhi: input.daDungHoc ? CHO_GHI.QUYET_TOAN : CHO_GHI.GIAM_GIA,
    phaiThuMoi: Math.max(0, tron(input.phaiThu) - soTien),
  };
}

/**
 * Phần miễn giảm KHÔNG trừ được vào đợt nào của bé — câu NÓI RA (trước khi bấm và sau khi ghi).
 *
 * Rà vòng 5 (30/09/2026, ca `[MG-CH-01..02]`, luật 12): phần miễn không trừ được vào đợt nào ⇒ phiếu
 * thu / mã QR vẫn đòi SỐ CŨ — khách trả theo QR là trả thừa đúng phần vừa miễn.
 *
 * ⚠️ Từ Q-L (chủ dự án chốt 30/09/2026) câu này CHỈ còn cho bé CÓ đợt theo con mà đợt đã nhận tiền
 * (luật cũ, `chuaHapThuKhiMienGiam`). Bé KHÔNG có đợt theo con thì đợt cấp đơn được huỷ & dựng lại
 * theo số mới, hoặc bị CHẶN — xem `keHoachMienGiam`.
 */
export function canhBaoMienGiamChuaHapThu(chuaHapThu: number): string | null {
  const n = Math.round(chuaHapThu);
  if (!(n > 0)) return null;
  return (
    `${n.toLocaleString("vi-VN")}đ không trừ được vào đợt nào của bé — phiếu thu / mã QR của đơn VẪN ĐÒI SỐ CŨ. ` +
    "Khách trả theo QR là trả thừa đúng phần này: báo phụ huynh chuyển đúng số mới, hoặc nhờ kế toán điều chỉnh phiếu."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Q-L — MIỄN GIẢM CHO BÉ KHÔNG CÓ ĐỢT THEO CON (chủ dự án chốt 30/09/2026: "Huỷ mã cũ, phát lại")
//
// Rà vòng 5 để ngỏ ca này: bé không có đợt theo con ⇒ `keHoachHapThu` không có chỗ trừ, `totalAmount`
// hạ nhưng phiếu thu CẤP ĐƠN (phiếu thu toàn đơn R0 / đợt của kế hoạch đơn) và mã QR vẫn đòi SỐ CŨ —
// khách trả theo QR là trả thừa đúng phần vừa miễn. Chủ dự án chọn: trong CÙNG transaction, phiếu cấp
// đơn CHƯA nhận đồng nào mà phần miễn chạm tới ⇒ VOID, soát phiếu gộp (mã của cả nhà HUỶ/ĐÓNG theo
// luật `quyetPhieuMo`), rồi dựng lại theo số mới bằng CHÍNH hàm dựng sẵn có (`ensureFullOrderRequest`
// cho R0, `materializeInstallmentRequests` cho đợt đơn — kế hoạch `OrderInstallment` là đầu vào của nó).
//
// Phiếu ĐÃ nhận tiền thì KHÔNG VOID (luật "không sửa `amountDue` của phiếu đã có allocation"), và
// không có đường nào khác hạ số của nó ⇒ miễn giảm bị CHẶN với lý do — không quay về "chỉ cảnh báo"
// (chủ dự án đã loại phương án đó).
//
// ⚠️ MỘT hàm cho cả đường ghi (`mienGiamNoChoCon`) lẫn màn nói-trước (`FormMienGiam`) — hai bản của
// một luật tiền lệch nhau ở lần sửa đầu tiên mà không ca nào đỏ.
// ─────────────────────────────────────────────────────────────────────────────

/** Một phiếu thu của đơn, đúng phần luật miễn giảm cần. */
export type PhieuThuDeMien = {
  id: string;
  /** `null` = phiếu CẤP ĐƠN (số 0 = thu toàn đơn R0; > 0 = đợt của kế hoạch đơn); khác `null` = đợt THEO CON. */
  orderItemId: string | null;
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
  status: string;
  /** Σ tiền THẬT đã rót (`PaymentAllocation.amount`) — KHÔNG cộng phần tha làm tròn. */
  daRot: number;
};

/** Một dòng kế hoạch đợt của đơn (`OrderInstallment`) — đầu vào mà `materializeInstallmentRequests` dựng đợt đơn. */
export type DongKeHoachDon = { soDot: number; amount: number; status: string };

export type KeHoachMienGiam =
  /** Bé CÓ đợt theo con đang mở — luật cũ: trừ vào đợt của bé (`keHoachHapThu`), VOID rồi TẠO LẠI đợt theo con. */
  | { cach: "THEO_CON"; ke: KeHoachHapThu }
  /** Q-L — bé không có đợt theo con, đơn thu mức ĐƠN: VOID `ke.doi` rồi dựng lại bằng hàm sẵn có. */
  | { cach: "CAP_DON"; toanDon: boolean; ke: KeHoachHapThu }
  /** Không phiếu thu nào đang đòi phần nợ này (đơn thu theo con mà bé chưa có đợt) — chỉ hạ phải thu. */
  | { cach: "KHONG_PHIEU" }
  /** Không có đường an toàn — CHẶN. `loi` là CHÍNH câu máy chủ trả. */
  | { cach: "CHAN"; loi: string };

const DANG_MO = new Set(["PENDING", "PARTIAL"]);

export const LY_DO_MIEN_BE_DA_DUNG_CAP_DON =
  "Bé đã dừng học mà đơn đang thu mức ĐƠN (phiếu thu toàn đơn / đợt của đơn) — số trên phiếu của đơn không đi " +
  "theo quyết toán của bé, nên miễn giảm lúc này không hạ được mã QR của đơn (khách trả theo QR là trả thừa). " +
  "Chưa miễn được: báo kế toán điều chỉnh phiếu thu của đơn.";

export const LY_DO_MIEN_LAN_HAI_LOAI_DOT =
  "Đơn đang vừa có đợt THEO TỪNG BÉ vừa có phiếu thu mức ĐƠN còn mở — hai loại đợt lẫn nhau, không dựng lại " +
  "phiếu tự động được. Chưa miễn được: báo kế toán xử lý phiếu thu của đơn trước.";

export const LY_DO_MIEN_R0_LAN_DOT =
  "Đơn đang vừa có phiếu thu toàn đơn vừa có đợt của kế hoạch — lệch, không dựng lại phiếu tự động được. " +
  "Chưa miễn được: báo kế toán xử lý phiếu thu của đơn trước.";

/** Phiếu thu toàn đơn đã có tiền — không VOID được, không có đường hạ số ⇒ CHẶN. */
export function loiMienR0CoTien(daRot: number): string {
  return (
    `Phiếu thu toàn đơn đã nhận ${vnd(daRot)}đ — không đổi được số của phiếu đã có tiền, nên miễn giảm lúc này ` +
    "thì mã QR của đơn vẫn đòi số cũ (khách trả theo QR là trả thừa đúng phần miễn). " +
    "Chưa miễn được: báo kế toán điều chỉnh phiếu thu của đơn."
  );
}

/** Kế hoạch đợt (`OrderInstallment`) lệch phiếu thu ⇒ `materialize` sẽ làm việc KHÁC ngoài phần miễn ⇒ CHẶN. */
export function loiMienKeHoachLech(chiTiet: string): string {
  return (
    `Kế hoạch đợt của đơn đang lệch với phiếu thu (${chiTiet}) — không dựng lại đợt theo số mới được. ` +
    "Mở “Sửa kế hoạch”, lưu lại cho khớp rồi miễn giảm."
  );
}

/** Phần miễn không trừ hết vào phiếu cấp đơn CHƯA có tiền ⇒ CHẶN, nói trần miễn được lúc này. */
export function loiMienKhongHapThuDu(ke: KeHoachHapThu): string {
  const coTien = ke.boQuaVeDaCoTien.map((d) =>
    d.installmentNo === 0 ? `phiếu toàn đơn đã nhận ${vnd(d.daRot)}đ` : `Đợt ${d.installmentNo} đã nhận ${vnd(d.daRot)}đ`,
  );
  // Rà vòng 6 (luật 12): không phiếu nào nhận đồng nào thì phần thiếu là do phiếu đòi ÍT hơn phần miễn —
  // nói "phiếu ĐÃ nhận tiền" ở đây là lý do bịa.
  if (coTien.length === 0) {
    return (
      `Chỉ miễn được tối đa ${vnd(ke.daHapThu)}đ lúc này — đó là toàn bộ số các phiếu thu còn mở của đơn đang đòi, ` +
      "phần vượt không có phiếu nào để trừ. Miễn ≤ số đó, hoặc báo kế toán điều chỉnh."
    );
  }
  const vi = ` (${coTien.join(", ")})`;
  return ke.daHapThu > 0
    ? `Chỉ miễn được tối đa ${vnd(ke.daHapThu)}đ lúc này — phần còn lại rơi vào phiếu thu của đơn ĐÃ nhận tiền${vi}, ` +
        `mà số của phiếu đã có tiền không đổi được. Miễn ≤ ${vnd(ke.daHapThu)}đ, hoặc báo kế toán điều chỉnh.`
    : `Các phiếu thu còn mở của đơn đều đã nhận tiền${vi} — không đổi được số của phiếu đã có tiền, nên miễn giảm ` +
        "lúc này thì mã QR vẫn đòi số cũ. Chưa miễn được: báo kế toán điều chỉnh.";
}

/**
 * Rà vòng 6 — VẾ ĐƠN: phần miễn vượt còn nợ CẢ ĐƠN (`conNoDon` = phải thu − MỌI tiền đã về, kể cả khoản
 * chưa gắn bé nào / kế toán chưa xác nhận). Phần vượt là tiền ĐÃ VỀ — miễn giảm nó là sinh tiền thừa.
 */
export function loiMienVuotNoDon(conNoDon: number): string {
  const n = tron(conNoDon);
  const duoi =
    "Phần vượt là tiền ĐÃ VỀ (kể cả khoản chưa gắn cho bé nào / kế toán chưa xác nhận) — miễn giảm nó là sinh " +
    "tiền thừa. Tiền đã thu thì đi đường hoàn tiền / chuyển sang bé khác, không miễn giảm.";
  if (n > 0) return `Cả đơn chỉ còn nợ ${vnd(n)}đ — miễn tối đa ${vnd(n)}đ. ${duoi}`;
  return (
    `Cả đơn không còn nợ (${n < 0 ? `đang thừa ${vnd(-n)}đ` : "đã về đủ"}) — số "còn nợ" của bé chỉ trừ khoản đã gắn ` +
    `cho bé và kế toán đã xác nhận. Chưa miễn được. ${duoi}`
  );
}

/**
 * Đợt đơn còn sống và kế hoạch có khớp nhau không — `null` = khớp. `materializeInstallmentRequests` dựng đợt
 * đơn TỪ kế hoạch: đợt sống không có trong kế hoạch bị nó VOID, dòng kế hoạch không có đợt sống bị nó tạo /
 * làm sống lại, số lệch bị nó sửa. Gọi nó trên dữ liệu lệch là đổi thứ khác ngoài phần miễn ⇒ không gọi.
 */
function keHoachLechPhieu(dotSong: readonly PhieuThuDeMien[], keHoach: readonly DongKeHoachDon[]): string | null {
  const theoSo = new Map(keHoach.map((k) => [k.soDot, k]));
  for (const p of [...dotSong].sort((a, b) => a.installmentNo - b.installmentNo)) {
    const k = theoSo.get(p.installmentNo);
    if (!k) return `Đợt ${p.installmentNo} có phiếu thu mà không có trong kế hoạch`;
    if (DANG_MO.has(p.status) && Math.round(k.amount) !== p.amountDue) {
      return `Đợt ${p.installmentNo}: kế hoạch ${vnd(k.amount)}đ, phiếu thu ${vnd(p.amountDue)}đ`;
    }
  }
  for (const k of [...keHoach].sort((a, b) => a.soDot - b.soDot)) {
    if (!dotSong.some((p) => p.installmentNo === k.soDot)) return `Đợt ${k.soDot} có trong kế hoạch mà không có phiếu thu`;
  }
  return null;
}

/**
 * Miễn `canGiam` cho bé `orderItemId` thì phiếu thu nào bị VOID & dựng lại, hay bị CHẶN — xem khối đầu mục.
 *
 * Thứ tự vế là luật:
 *   1. bé có đợt THEO CON đang mở ⇒ luật cũ (THEO_CON) — Q-L không đụng (đối chứng dương);
 *   1b. (rà vòng 6) VẾ ĐƠN — phần miễn vượt còn nợ CẢ ĐƠN ⇒ CHẶN. `kiemMienGiam` chỉ so với còn nợ của BÉ,
 *      mà số đó chỉ trừ khoản đã gắn bé + kế toán đã xác nhận ⇒ đơn đã thu ĐỦ (R0 / đợt đơn PAID qua webhook,
 *      tiền chưa gắn con, chưa xác nhận) vẫn cho bé "còn nợ". Thiếu vế này, R0 PAID rơi vào KHONG_PHIEU và
 *      lượt miễn sinh tiền thừa mà màn im. Đứng SAU vế 1: áp cho luật cũ THEO_CON là quyết định còn để ngỏ;
 *   2. không phiếu cấp đơn nào đang mở ⇒ KHONG_PHIEU — không mã nào đòi phần nợ này;
 *   3. bé đã dừng học ⇒ CHẶN: miễn giảm hạ `usedValue`, `totalAmount` không đổi, phiếu cấp đơn dựng lại vẫn số cũ;
 *   4. đơn còn đợt theo con sống ⇒ CHẶN (hai loại đợt lẫn nhau);
 *   5. R0 đang mở: lẫn đợt đơn ⇒ CHẶN; đã có tiền ⇒ CHẶN; còn lại ⇒ CAP_DON toàn đơn — số mới là
 *      `tongDon − canGiam`, ĐÚNG số `ensureFullOrderRequest` sẽ ghi (R0 = `Order.totalAmount`), KHÔNG phải
 *      `r0.amountDue − canGiam`: sau "Thêm con" R0 lệch tổng đơn (rà vòng 6), và tính trên R0 là nói trước
 *      một số, ghi một số khác, chặn bằng lý do bịa;
 *   6. đợt đơn: kế hoạch lệch phiếu ⇒ CHẶN; không trừ hết vào đợt CHƯA có tiền ⇒ CHẶN; còn lại ⇒ CAP_DON.
 *
 * Đợt đơn mà kế hoạch (`OrderInstallment`, sổ cũ) ghi ĐÃ THU coi như đã có tiền: sổ A đã có khoản của nó.
 */
export function keHoachMienGiam(input: {
  orderItemId: string;
  /** MỌI phiếu thu của đơn (mọi trạng thái, mọi bé, kể cả cấp đơn). */
  phieuThu: readonly PhieuThuDeMien[];
  keHoachDon: readonly DongKeHoachDon[];
  canGiam: number;
  cach: CachHapThu;
  daDungHoc: boolean;
  /**
   * Còn nợ CẢ ĐƠN — `NoTheoConKetQua.conNoDon` (trừ MỌI tiền đã về). BẮT BUỘC (luật 7): mặc định là vế
   * đơn không bao giờ cắn — đúng lỗ rà vòng 6 (R0 đã thu đủ ⇒ miễn giảm sinh tiền thừa im lặng).
   */
  conNoDon: number;
  /**
   * `Order.totalAmount` HIỆN TẠI — nhánh R0 dựng lại phiếu toàn đơn = tổng đơn mới. BẮT BUỘC (luật 7):
   * tính trên `r0.amountDue` là lệch số máy ghi khi R0 lệch tổng đơn (sau "Thêm con").
   */
  tongDon: number;
}): KeHoachMienGiam {
  const hapThu = (dot: readonly DotDeHapThu[]) => keHoachHapThu({ dot, canGiam: input.canGiam, cach: input.cach });
  const chan = (loi: string): KeHoachMienGiam => ({ cach: "CHAN", loi });

  const dotCuaBe = input.phieuThu.filter((p) => p.orderItemId === input.orderItemId && DANG_MO.has(p.status));
  if (dotCuaBe.length > 0) return { cach: "THEO_CON", ke: hapThu(dotCuaBe) };

  if (tron(input.canGiam) > Math.max(0, tron(input.conNoDon))) return chan(loiMienVuotNoDon(input.conNoDon));

  const capDon = input.phieuThu.filter((p) => p.orderItemId === null);
  const capDonMo = capDon.filter((p) => DANG_MO.has(p.status));
  if (capDonMo.length === 0) return { cach: "KHONG_PHIEU" };

  if (input.daDungHoc) return chan(LY_DO_MIEN_BE_DA_DUNG_CAP_DON);
  if (input.phieuThu.some((p) => p.orderItemId !== null && p.status !== "VOID")) return chan(LY_DO_MIEN_LAN_HAI_LOAI_DOT);

  const r0Mo = capDonMo.filter((p) => p.installmentNo === 0);
  const dotSong = capDon.filter((p) => p.installmentNo > 0 && p.status !== "VOID");
  if (r0Mo.length > 0) {
    if (dotSong.length > 0 || r0Mo.length > 1) return chan(LY_DO_MIEN_R0_LAN_DOT);
    const r0 = r0Mo[0]!;
    if (r0.daRot > 0) return chan(loiMienR0CoTien(r0.daRot));
    // R0 dựng lại = tổng đơn MỚI (định nghĩa của `ensureFullOrderRequest`) — tính trên tổng đơn, không trên R0.
    const ke = hapThu([{ ...r0, amountDue: tron(input.tongDon) }]);
    if (ke.chuaHapThuDuoc > 0) return chan(loiMienKhongHapThuDu(ke));
    // `soCu` là số R0 ĐANG đòi (thứ người đọc thấy trên phiếu), `soMoi` là số máy sẽ ghi.
    return { cach: "CAP_DON", toanDon: true, ke: { ...ke, doi: ke.doi.map((d) => ({ ...d, soCu: r0.amountDue })) } };
  }
  // R0 còn sống (PAID) cạnh đợt đơn đang mở: `materialize` VOID R0 vô điều kiện — kể cả khi nó giữ tiền.
  if (capDon.some((p) => p.installmentNo === 0 && p.status !== "VOID")) return chan(LY_DO_MIEN_R0_LAN_DOT);

  const lech = keHoachLechPhieu(dotSong, input.keHoachDon);
  if (lech) return chan(loiMienKeHoachLech(lech));

  const daThuTheoKeHoach = new Set(input.keHoachDon.filter((k) => k.status === "PAID").map((k) => k.soDot));
  const ke = hapThu(
    capDonMo.map((p) => ({
      ...p,
      daRot: p.daRot > 0 ? p.daRot : daThuTheoKeHoach.has(p.installmentNo) ? Math.max(1, p.amountDue) : 0,
    })),
  );
  if (ke.chuaHapThuDuoc > 0) return chan(loiMienKhongHapThuDu(ke));
  return { cach: "CAP_DON", toanDon: false, ke };
}

/** Phiếu thu nào sẽ bị VOID — đưa vào `canhBaoTruocVoidDot` để NÓI TRƯỚC mã của cả nhà (luật 12). */
export function dotSeHuyKhiMienGiam(kh: KeHoachMienGiam): string[] {
  return kh.cach === "THEO_CON" || kh.cach === "CAP_DON" ? kh.ke.doi.map((d) => d.id) : [];
}

/** Phần miễn QR vẫn đòi số cũ — chỉ còn ở luật cũ (bé có đợt theo con đã nhận tiền). */
export function chuaHapThuKhiMienGiam(kh: KeHoachMienGiam): number {
  return kh.cach === "THEO_CON" ? kh.ke.chuaHapThuDuoc : 0;
}

/** Câu NÓI TRƯỚC khi phần miễn trừ vào phiếu CẤP ĐƠN — `null` ở mọi cách khác. */
export function moTaTruocMienGiamCapDon(kh: KeHoachMienGiam): string | null {
  if (kh.cach !== "CAP_DON") return null;
  if (kh.toanDon) {
    const d = kh.ke.doi[0];
    const so = d ? ` ${vnd(d.soCu)}đ → ${vnd(d.soMoi)}đ` : "";
    // Rà vòng 6 (luật 12): R0 lệch tổng đơn (sau "Thêm con") ⇒ phiếu dựng lại = tổng đơn mới, có thể TĂNG.
    // Người bấm "miễn giảm" mặc định hiểu là giảm — số tăng phải được nói ra, kèm lý do.
    const tang =
      d && d.soMoi > d.soCu
        ? ` Phiếu TĂNG vì đang lệch tổng đơn (thiếu phần của bé thêm sau) — phiếu dựng lại luôn bằng tổng đơn sau miễn.`
        : "";
    return (
      `Bé không có đợt riêng — phần miễn trừ vào phiếu thu TOÀN ĐƠN${so}: phiếu được huỷ và dựng lại theo số mới, ` +
      `mã QR cũ hết hiệu lực.${tang}`
    );
  }
  const dot = kh.ke.doi.map((d) => `Đợt ${d.installmentNo} ${vnd(d.soCu)}đ → ${d.soMoi > 0 ? `${vnd(d.soMoi)}đ` : "huỷ"}`);
  return `Bé không có đợt riêng — phần miễn trừ vào đợt của đơn: ${dot.join(", ")}. Đợt được huỷ và dựng lại theo số mới, mã QR cũ hết hiệu lực.`;
}

/** Câu NÓI SAU (toast) — phiếu cấp đơn đã dựng lại theo số nào. `null` khi không dựng lại gì. */
export function thongDiepDungLaiCapDon(
  x: { toanDon: boolean; dot: readonly { installmentNo: number; soMoi: number }[] } | null,
  /**
   * Số đọc SAU phép ghi, cùng transaction (rà vòng 6). BẮT BUỘC (luật 7): `phieuConDoi` = Σ còn phải thu
   * của phiếu CẤP ĐƠN đang mở (amountDue − đã rót); `conNoDon` = còn nợ cả đơn. Phiếu đòi nhiều hơn đơn
   * còn nợ (có tiền đã về chưa rót vào phiếu) thì con số ấy KHÔNG phải "số còn nợ" — mời phát mã theo nó là
   * mời thu thừa.
   */
  soSau: { phieuConDoi: number; conNoDon: number },
): string | null {
  if (!x || x.dot.length === 0) return null;
  const duoi =
    tron(soSau.phieuConDoi) > Math.max(0, tron(soSau.conNoDon))
      ? ` — mã QR cũ hết hiệu lực. ⚠️ Phiếu của đơn đang đòi ${vnd(soSau.phieuConDoi)}đ trong khi đơn chỉ còn nợ ` +
        `${vnd(Math.max(0, soSau.conNoDon))}đ (có tiền đã về chưa rót vào phiếu) — đối chiếu với kế toán trước khi phát mã.`
      : " — mã QR cũ hết hiệu lực, phát mã mới cho số còn nợ.";
  if (x.toanDon) {
    const so = x.dot[0]!.soMoi;
    // Đơn về 0đ: không còn số nợ nào để phát mã — mời "phát mã mới" là lời hứa suông (luật 12).
    return so > 0 ? `Phiếu thu toàn đơn dựng lại: ${vnd(so)}đ${duoi}` : "Phiếu thu toàn đơn huỷ (miễn hết) — mã QR cũ hết hiệu lực.";
  }
  const dot = x.dot.map((d) => (d.soMoi > 0 ? `Đợt ${d.installmentNo} → ${vnd(d.soMoi)}đ` : `Đợt ${d.installmentNo} huỷ (miễn hết)`));
  return `Đợt của đơn dựng lại: ${dot.join(" · ")}${duoi}`;
}
