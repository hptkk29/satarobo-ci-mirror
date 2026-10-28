// lib/finance/hoa-don/lan-thu.ts — gom các khoản thu của MỘT đơn thành "LẦN THU", và đo mỗi lần
// thu đã ĐỦ tiền so với đợt nó trả chưa. THUẦN: không Prisma, không DB, không đọc đồng hồ.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §3. Chủ dự án chốt (Q4, 25/09): hoá đơn theo LẦN THU;
// số lệch với đợt thì gắn thêm giao dịch cho đủ rồi mới tính là một lần thu.
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT GOM — MỘT BƯỚC, KHÔNG BẮC CẦU
//
//   1. Mỗi giao dịch ngân hàng có một "ĐỢT ĐÍCH" = đợt nhận phần phân bổ LỚN NHẤT từ nó.
//   2. Mọi giao dịch cùng đợt đích ⇒ MỘT lần thu (khoá `dot:<id>`). Mỗi giao dịch có ĐÚNG MỘT
//      đích, nên gom theo đích là một PHÂN HOẠCH — không thể bắc cầu. Phần tràn sang đợt sau đi
//      theo giao dịch của nó và chỉ hiện là "trả trước".
//      ⚠️ Vì sao không gom theo "đợt còn PARTIAL": PH chuyển số tròn (4.500.000 cho đợt
//      4.488.000) thì 12.000 tràn sang đợt 2 làm đợt 2 PARTIAL, lần sau tràn sang đợt 3… — cả
//      đơn dính thành MỘT lần thu, "theo lần thu" thoái hoá thành "theo cả đơn" (ca [LT-02]).
//   3. Khoản không có giao dịch (tiền mặt, ghi tay) ⇒ mỗi khoản một lần thu (`k:<id>`).
//   4. Đợt đích là phiếu "thu toàn đơn" (installmentNo 0) ⇒ mỗi giao dịch một lần thu (`gd:<id>`):
//      không có kế hoạch đợt thì không có "đủ" nào để đo.
//   5. Kế toán GỘP tay nhiều lần thu (`gop`) — ví dụ gắn tiền mặt vào lần thu CK của cùng đợt.
//   6. TÁCH THEO CON (chủ dự án chốt 18/10/2026): nhóm ở bước 2/4 mà các khoản đều đã gắn con
//      (`orderItemId`) và thuộc ≥ 2 con thì tách thành MỘT lần thu cho MỖI con — khoá `<khoá nhóm>#<orderItemId>`.
//      Một lần chuyển khoản trả cho 2 bé (hai khoản "tách 1/2", "tách 2/2") vẫn là hai hoá đơn. Chỉ tách khi
//      MỌI khoản của nhóm đã gắn con: có khoản chưa gắn thì giữ nguyên một nhóm (không đoán con nào).
//      ⚠️ Đo ĐỦ / THIẾU ở mức ĐỢT chỉ còn đúng cho phiếu KHÔNG gắn con (đơn trước 16/09): xem luật 7.
//   7. ĐÍCH THEO CẶP (GIAO DỊCH, CON) [PR-1 "sửa đo đủ/thiếu theo con", 23/10/2026]. Khi mọi phân bổ của một giao dịch
//      đều vào phiếu THEO CON (`DotVao.orderItemId ≠ null`, đợt ≥ 1) và mọi khoản của giao dịch đã gắn con có phiếu nhận tiền,
//      thì đích của khoản con C = phiếu của CHÍNH C nhận phân bổ LỚN NHẤT từ giao dịch đó (hoà ⇒ đợt số nhỏ hơn) — cùng luật
//      `dichCua`, chỉ giới hạn vào phiếu của C. Phiếu khác của C cùng nhận tiền từ giao dịch ấy là `traTruoc` của C; phân bổ
//      vào phiếu của CON KHÁC không tính cho C ở cột nào. Nhóm theo (đích của con) nên một nhóm theo-con luôn MỘT con.
//      Trước đây đích là MỘT đợt cho cả giao dịch, chép cho mọi con: con nợ 4tr nhận 2tr bị báo ĐỦ, con nợ 2tr nhận 2tr bị báo
//      THIẾU (đo 23/10, docs/thu-hoc-phi-pham-vi/HOA-DON-MOI-CON.md §3).
//      ⛔ KHÔNG viết "mọi phiếu của con đã nhận tiền là đích": đó là lỗi bắc cầu của [LT-02] quay lại — 12.000đ tràn sang đợt 2
//      của CÙNG con sẽ kéo đợt 2 vào `phaiThu` và lần thu báo THIẾU (ca [LT-CON-13]).
//      `tachTheoCon: false` (dựng lại hoá đơn gộp) vẫn GOM theo đích chung của giao dịch (một nhóm) nhưng ĐO theo con.
//      Giao dịch/khoản không đủ điều kiện (phiếu đời cũ, khoản chưa gắn con) giữ NGUYÊN luật đo theo đợt.
//
// LUẬT ĐỦ — ĐO BẰNG TIỀN, KHÔNG BẰNG TRẠNG THÁI ĐỢT
//
//   phaiThu(X) = amountDue(X) − Σ roundingWaived vào X − Σ phân bổ vào X từ giao dịch NGOÀI nhóm
//   daVaoDot   = Σ phân bổ vào các đợt đích từ giao dịch TRONG nhóm + Σ ròng khoản không-giao-dịch
//   DU ⇔ daVaoDot ≥ Σ phaiThu
//
//   ⚠️ Không dùng `PaymentRequest.status`: tiền mặt KHÔNG BAO GIỜ sinh `PaymentAllocation` (mọi
//   đường ghi phân bổ đều bắt buộc có giao dịch), nên đợt "2tr tiền mặt + 3tr CK" nằm PARTIAL
//   vĩnh viễn trong sổ trong khi tiền đã đủ (ca [LT-05]).
//   ⚠️ "Phân bổ từ giao dịch NGOÀI nhóm" gồm cả giao dịch đã nằm trong hoá đơn KHÁC (người gọi
//   không truyền khoản đã khoá vào `khoan`) — phần đó đã xuất rồi, không được đòi lại ([LT-17]).
// ─────────────────────────────────────────────────────────────────────────────

import type { NguonGiaoDich } from "./nguon-khoan";

export type DotVao = {
  id: string;
  /** 0 = phiếu "thu toàn đơn"; 1, 2, … = số thứ tự đợt. */
  installmentNo: number;
  amountDue: number;
  status: "PENDING" | "PARTIAL" | "PAID" | "VOID";
  /**
   * Phiếu này thu cho DÒNG ĐƠN (con) nào — `PaymentRequest.orderItemId`. NULL = phiếu đời cũ / thu toàn đơn.
   * BẮT BUỘC (luật 7 — `tsc` liệt kê chỗ gọi): quên nó là mọi con bị đo theo đợt của con khác (lỗi PR-1). Dựng bằng
   * `dotVaoTuPhieu` để hai nơi nạp (màn và bước chốt) không thể lệch nhau.
   */
  orderItemId: string | null;
};

/** MỘT phép ánh xạ phiếu → `DotVao` cho cả màn hàng chờ và bước chốt (luật 12: hai bản dựng là có ngày lệch). */
export function dotVaoTuPhieu(p: { id: string; installmentNo: number; amountDue: number; status: DotVao["status"]; orderItemId: string | null }): DotVao {
  return { id: p.id, installmentNo: p.installmentNo, amountDue: p.amountDue, status: p.status, orderItemId: p.orderItemId };
}

export type GiaoDichVao = {
  id: string;
  /** Cột `BankTransaction.provider` — lưu CHỮ HOA ("SEPAY"); marker ghi chữ thường. */
  provider: string;
  providerTxnId: string;
  /** Giờ VIỆT NAM mang nhãn UTC (SePay) — đọc các trường UTC là đọc đúng lịch VN. */
  transferredAt: Date;
  amount: number;
};

export type PhanBoVao = {
  bankTransactionId: string;
  paymentRequestId: string;
  amount: number;
  roundingWaived: number;
};

/** Một khoản ĐÃ qua `phanLoaiKhoan` (HANG_CHO) và CHƯA nằm trong hoá đơn còn hiệu lực. */
export type KhoanVaoLanThu = {
  id: string;
  /** Số ròng — `soTienRong` (nguon-khoan.ts). */
  rong: number;
  nguon: NguonGiaoDich;
  /** Thời điểm máy ghi (UTC thật) — chỉ dùng làm ngày thu khi KHÔNG có giao dịch. */
  paidDate: Date;
  /** Dòng đơn (con) của khoản — `Payment.orderItemId`. BẮT BUỘC (luật 7): quên là hoá đơn gộp con. */
  orderItemId: string | null;
};

export type TrangThaiLanThu =
  | "DU"
  | "THIEU"
  | "DOT_HUY"
  | "KHONG_DOI_CHIEU"
  | "LOI_KHAI"
  | "NGHI_TRUNG";

export type LanThu = {
  /** Khoá bền: không đổi khi lần thu từ THIEU thành DU (màn giữ được dòng đang chọn). */
  key: string;
  khoanIds: string[];
  giaoDichIds: string[];
  /** Σ ròng các khoản — số tiền thật của lần thu, đi lên hoá đơn. */
  soTien: number;
  /** YYYY-MM-DD theo lịch Việt Nam — ngày của giao dịch/khoản MUỘN NHẤT (lúc lần thu ĐỦ). */
  ngayThu: string;
  nguon: "CK" | "KHONG_GIAO_DICH" | "LOI_KHAI";
  dotDich: { id: string; installmentNo: number }[];
  /** `null` khi không đo được (không có đợt đích có kế hoạch). */
  phaiThu: number | null;
  daVaoDot: number | null;
  /** > 0 CHỈ khi THIEU. */
  thieu: number;
  /** Σ phân bổ của giao dịch trong nhóm vào đợt KHÔNG phải đích (tràn sang đợt sau). */
  traTruoc: number;
  /** Σ ròng khoản có giao dịch − Σ phân bổ của chúng (tiền vào ví / số dư). */
  ngoaiDot: number;
  /** Σ roundingWaived vào các đợt đích. */
  tienTha: number;
  trangThai: TrangThaiLanThu;
  /**
   * GĐ 8 — VÌ SAO nghi trùng (rỗng ⇔ không nghi): cùng ĐƠN có khoản chuyển khoản còn là tiền thật,
   * và/hoặc có giao dịch CHƯA KHỚP mang đúng số tiền của khoản khai tay.
   */
  nghiTrungVi: ("DON_CO_CHUYEN_KHOAN" | "CHUA_KHOP_CUNG_SO")[];
  canhBao: string[];
};

type Nhom = {
  key: string;
  khoan: KhoanVaoLanThu[];
  giaoDich: Set<string>;
  /** Đích có kế hoạch (installmentNo ≥ 1). */
  dich: Set<string>;
  /**
   * Giao dịch → các con mà nhóm chỉ được tính phân bổ vào phiếu của họ (luật 7). Vắng = KHÔNG giới hạn (luật đo theo đợt cũ).
   */
  gioiHan: Map<string, Set<string>>;
  canhBao: string[];
};

const TIEN_TO_GOP = "gop:";

/**
 * Khoá của nhóm GỘP — `gop:` + khoá thành phần đã sắp xếp, nối bằng `+`. Khoá thành phần (`dot:<id>` ·
 * `gd:<id>` · `k:<id>`) không bao giờ chứa `+` hay `~`, nên khoá gộp CHỞ ĐỦ tập thành phần: màn chọn
 * dòng gộp bằng `?chon=<khoá gộp>`, và server dựng lại đúng tập ấy từ chính khoá (`gopTuKhoa`) — không
 * nhận danh sách khoản từ client (Q2, 29/09).
 */
export function khoaGop(khoa: readonly string[]): string {
  return `${TIEN_TO_GOP}${[...new Set(khoa)].sort().join("+")}`;
}

/**
 * Ngược của `khoaGop`: tập khoá thành phần. Khoá không phải khoá gộp, hoặc gộp dưới hai thành phần ⇒ `[]`
 * (không gộp gì). Bỏ đuôi `~…` mà `khoaDuyNhat` (dong-hang-cho.ts) gắn khi hai dòng trùng khoá.
 */
export function gopTuKhoa(khoa: string): string[] {
  if (!khoa.startsWith(TIEN_TO_GOP)) return [];
  const than = khoa.slice(TIEN_TO_GOP.length).split("~")[0]!;
  const ds = [...new Set(than.split("+").filter((k) => k.length > 0))];
  return ds.length >= 2 ? ds : [];
}

/** Ngày lịch VN. `laGioVnNhanUtc` = giá trị đã là giờ VN (SePay) ⇒ không cộng 7 giờ. */
function ngayVn(d: Date, laGioVnNhanUtc: boolean): string {
  const ms = laGioVnNhanUtc ? d.getTime() : d.getTime() + 7 * 3600_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function gomLanThu(input: {
  /** Khoản ĐỦ ĐIỀU KIỆN, CHƯA khoá, của MỘT đơn. */
  khoan: readonly KhoanVaoLanThu[];
  /** Giao dịch ngân hàng liên quan (ít nhất các giao dịch mà khoản trỏ tới). */
  giaoDich: readonly GiaoDichVao[];
  /** MỌI dòng phân bổ vào các đợt của đơn này (từ MỌI giao dịch, kể cả đã khoá). */
  phanBo: readonly PhanBoVao[];
  /** MỌI đợt của đơn này. */
  dot: readonly DotVao[];
  /** Kế toán gộp tay: mỗi mảng là tập khoá lần thu gộp thành một. */
  gop: readonly (readonly string[])[];
  /** Giao dịch CHƯA KHỚP nghi là của đơn này (người gọi tra theo SĐT) — để phát hiện trùng. */
  giaoDichChuaKhop: readonly { amount: number }[];
  /**
   * GĐ 8 — `donCoKhoanNganHang` trên MỌI dòng của đơn (kể cả khoản đã khoá). BẮT BUỘC: nhìn riêng tập
   * `khoan` là để lọt lời khai tay khi khoản chuyển khoản đã nằm trong hoá đơn khác.
   */
  donCoKhoanNganHang: boolean;
  /**
   * Tách nhóm nhiều con thành một lần thu mỗi con (mục 6 đầu tệp). BẮT BUỘC (luật 7): hai chỗ cần `true`
   * (hàng chờ) và hai chỗ cần `false` (dựng lại lần thu của một hoá đơn ĐÃ có, kể cả hoá đơn gộp cũ).
   */
  tachTheoCon: boolean;
}): LanThu[] {
  const dotTheoId = new Map(input.dot.map((d) => [d.id, d]));
  const phanBo = input.phanBo.filter((p) => dotTheoId.has(p.paymentRequestId));
  const gdTheoId = new Map(input.giaoDich.map((g) => [g.id, g]));
  const gdTheoKhoa = new Map(
    input.giaoDich.map((g) => [`${g.provider.toLowerCase()}|${g.providerTxnId}`, g]),
  );

  /** Giao dịch mà khoản trỏ tới, nếu tìm được. */
  const gdCua = (k: KhoanVaoLanThu): GiaoDichVao | null => {
    if (k.nguon.loai === "WEBHOOK")
      return gdTheoKhoa.get(`${k.nguon.provider.toLowerCase()}|${k.nguon.providerTxnId}`) ?? null;
    if (k.nguon.loai === "GAN_TAY") return gdTheoId.get(k.nguon.bankTransactionId) ?? null;
    return null;
  };

  const phanBoTheoGd = new Map<string, PhanBoVao[]>();
  for (const p of phanBo) phanBoTheoGd.set(p.bankTransactionId, [...(phanBoTheoGd.get(p.bankTransactionId) ?? []), p]);

  /**
   * Đợt đích của một giao dịch: nhận phần phân bổ lớn nhất; hoà ⇒ đợt số nhỏ hơn. `chiCon` ≠ null ⇒ chỉ xét phiếu của con đó
   * (luật 7). Giữ NGUYÊN thứ tự duyệt và cách phân xử hoà của bản cũ.
   */
  const dichCua = (btId: string, chiCon: string | null = null): DotVao | null => {
    let tot: { dot: DotVao; amount: number } | null = null;
    for (const p of phanBoTheoGd.get(btId) ?? []) {
      const d = dotTheoId.get(p.paymentRequestId)!;
      if (chiCon != null && d.orderItemId !== chiCon) continue;
      if (
        !tot ||
        p.amount > tot.amount ||
        (p.amount === tot.amount && d.installmentNo < tot.dot.installmentNo)
      ) {
        tot = { dot: d, amount: p.amount };
      }
    }
    return tot?.dot ?? null;
  };

  /** Khoản (đã qua `gdCua`) theo giao dịch — để quyết định chế độ "theo con" của CẢ giao dịch. */
  const khoanTheoGd = new Map<string, KhoanVaoLanThu[]>();
  for (const k of input.khoan) {
    const g = gdCua(k);
    if (g) khoanTheoGd.set(g.id, [...(khoanTheoGd.get(g.id) ?? []), k]);
  }
  const cheDoCon = new Map<string, boolean>();
  /**
   * Giao dịch đi theo chế độ "theo con" ⇔ có phân bổ, MỌI phân bổ vào phiếu theo con (đợt ≥ 1), và MỌI khoản của nó đã gắn con
   * mà con đó có phiếu nhận tiền từ nó. Thiếu một vế ⇒ luật đo theo đợt như cũ (không đoán con nào).
   */
  const theoConCuaGd = (gId: string): boolean => {
    let v = cheDoCon.get(gId);
    if (v === undefined) {
      const ps = phanBoTheoGd.get(gId) ?? [];
      const ks = khoanTheoGd.get(gId) ?? [];
      v =
        ps.length > 0 &&
        ps.every((p) => {
          const d = dotTheoId.get(p.paymentRequestId)!;
          return d.orderItemId != null && d.installmentNo >= 1;
        }) &&
        ks.length > 0 &&
        ks.every((k) => k.orderItemId != null && dichCua(gId, k.orderItemId) != null);
      cheDoCon.set(gId, v);
    }
    return v;
  };

  // ── 1. Nhóm mặc định ──────────────────────────────────────────────────────
  const nhom = new Map<string, Nhom>();
  const layNhom = (key: string): Nhom => {
    let n = nhom.get(key);
    if (!n) {
      n = { key, khoan: [], giaoDich: new Set(), dich: new Set(), gioiHan: new Map(), canhBao: [] };
      nhom.set(key, n);
    }
    return n;
  };
  for (const k of input.khoan) {
    const g = gdCua(k);
    if ((k.nguon.loai === "WEBHOOK" || k.nguon.loai === "GAN_TAY") && !g) {
      const n = layNhom(`k:${k.id}`);
      n.khoan.push(k);
      n.canhBao.push("Không tìm thấy giao dịch ngân hàng mà khoản này trỏ tới");
      continue;
    }
    if (!g) {
      layNhom(`k:${k.id}`).khoan.push(k);
      continue;
    }
    const d = dichCua(g.id);
    if (theoConCuaGd(g.id)) {
      // Luật 7: đích của CON; tách theo con thì nhóm theo đích của con, dựng lại gộp thì nhóm theo đích chung (đo vẫn theo con).
      const dCon = dichCua(g.id, k.orderItemId)!;
      const n = layNhom(`dot:${input.tachTheoCon ? dCon.id : d!.id}`);
      n.khoan.push(k);
      n.giaoDich.add(g.id);
      n.dich.add(dCon.id);
      const cons = n.gioiHan.get(g.id) ?? new Set<string>();
      cons.add(k.orderItemId!);
      n.gioiHan.set(g.id, cons);
      continue;
    }
    const key = d && d.installmentNo >= 1 ? `dot:${d.id}` : `gd:${g.id}`;
    const n = layNhom(key);
    n.khoan.push(k);
    n.giaoDich.add(g.id);
    if (d && d.installmentNo >= 1) n.dich.add(d.id);
  }

  // ── 1b. Tách theo con ──────────────────────────────────────────────────────
  if (input.tachTheoCon) {
    for (const n of [...nhom.values()]) {
      if (n.khoan.length < 2 || n.khoan.some((k) => k.orderItemId == null)) continue;
      const theoCon = new Map<string, KhoanVaoLanThu[]>();
      for (const k of n.khoan) theoCon.set(k.orderItemId!, [...(theoCon.get(k.orderItemId!) ?? []), k]);
      if (theoCon.size < 2) continue;
      nhom.delete(n.key);
      for (const [con, khoan] of theoCon) {
        const giaoDich = new Set<string>();
        for (const k of khoan) {
          const g = gdCua(k);
          if (g) giaoDich.add(g.id);
        }
        // Giới hạn đã có của nhóm gốc thu hẹp về đúng con này; giao dịch không có giới hạn giữ không giới hạn.
        const gioiHan = new Map<string, Set<string>>();
        for (const [gdId, cons] of n.gioiHan) if (giaoDich.has(gdId) && cons.has(con)) gioiHan.set(gdId, new Set([con]));
        const key = `${n.key}#${con}`;
        nhom.set(key, { key, khoan, giaoDich, dich: new Set(n.dich), gioiHan, canhBao: [...n.canhBao] });
      }
    }
  }

  // ── 2. Gộp tay ────────────────────────────────────────────────────────────
  // Khoá lạ bị bỏ qua (không ném): khoá đến từ một lần render trước, dữ liệu có thể đã đổi.
  for (const tap of input.gop) {
    const coThat = [...new Set(tap)].filter((k) => nhom.has(k)).sort();
    if (coThat.length < 2) continue;
    const moi: Nhom = {
      key: khoaGop(coThat),
      khoan: [],
      giaoDich: new Set(),
      dich: new Set(),
      gioiHan: new Map(),
      canhBao: [],
    };
    for (const k of coThat) {
      const n = nhom.get(k)!;
      moi.khoan.push(...n.khoan);
      n.giaoDich.forEach((x) => moi.giaoDich.add(x));
      // Một giao dịch đi MỘT chế độ (theo con hoặc theo đợt) nên chỉ có giới hạn ở mọi nhóm giữ nó, hoặc ở không nhóm nào: hợp các tập con.
      for (const [gdId, cons] of n.gioiHan) {
        const cu = moi.gioiHan.get(gdId);
        if (cu) cons.forEach((c) => cu.add(c));
        else moi.gioiHan.set(gdId, new Set(cons));
      }
      n.dich.forEach((x) => moi.dich.add(x));
      moi.canhBao.push(...n.canhBao);
      nhom.delete(k);
    }
    nhom.set(moi.key, moi);
  }

  // ── 3. Đo từng nhóm ───────────────────────────────────────────────────────
  const coKhoanNganHang = input.donCoKhoanNganHang || input.khoan.some((k) => gdCua(k) != null);
  const ra: LanThu[] = [];
  for (const n of nhom.values()) {
    const khoanCoGd = n.khoan.filter((k) => gdCua(k) != null);
    const khoanKhongGd = n.khoan.filter((k) => gdCua(k) == null);
    const soTien = n.khoan.reduce((s, k) => s + k.rong, 0);
    // Luật 7: giao dịch có giới hạn chỉ tính phân bổ vào phiếu của các con được giới hạn; không giới hạn ⇒ tính hết (luật cũ).
    const phanBoNhom = phanBo.filter((p) => {
      if (!n.giaoDich.has(p.bankTransactionId)) return false;
      const cons = n.gioiHan.get(p.bankTransactionId);
      if (!cons) return true;
      const con = dotTheoId.get(p.paymentRequestId)!.orderItemId;
      return con != null && cons.has(con);
    });

    let traTruoc = 0;
    let tienTha = 0;
    let vaoDich = 0;
    let dotHuy = false;
    for (const p of phanBoNhom) {
      const d = dotTheoId.get(p.paymentRequestId)!;
      if (d.status === "VOID") dotHuy = true;
      if (n.dich.has(d.id)) vaoDich += p.amount;
      else traTruoc += p.amount;
    }
    for (const p of phanBo) if (n.dich.has(p.paymentRequestId)) tienTha += p.roundingWaived;
    const ngoaiDot = Math.max(
      0,
      khoanCoGd.reduce((s, k) => s + k.rong, 0) - phanBoNhom.reduce((s, p) => s + p.amount, 0),
    );

    let phaiThu: number | null = null;
    let daVaoDot: number | null = null;
    if (n.dich.size > 0) {
      phaiThu = 0;
      for (const id of n.dich) {
        const d = dotTheoId.get(id)!;
        const ngoaiNhom = phanBo
          .filter((p) => p.paymentRequestId === id && !n.giaoDich.has(p.bankTransactionId))
          .reduce((s, p) => s + p.amount, 0);
        const tha = phanBo
          .filter((p) => p.paymentRequestId === id)
          .reduce((s, p) => s + p.roundingWaived, 0);
        phaiThu += Math.max(0, d.amountDue - tha - ngoaiNhom);
      }
      daVaoDot = vaoDich + khoanKhongGd.reduce((s, k) => s + k.rong, 0);
    }

    const loiKhai = n.khoan.filter((k) => k.nguon.loai === "LOI_KHAI");
    const nghiTrungVi: LanThu["nghiTrungVi"] = [];
    if (loiKhai.length > 0 && coKhoanNganHang) nghiTrungVi.push("DON_CO_CHUYEN_KHOAN");
    if (loiKhai.some((k) => input.giaoDichChuaKhop.some((g) => g.amount === k.rong))) nghiTrungVi.push("CHUA_KHOP_CUNG_SO");
    const nghiTrung = nghiTrungVi.length > 0;

    let trangThai: TrangThaiLanThu;
    let thieu = 0;
    if (dotHuy) trangThai = "DOT_HUY";
    else if (nghiTrung) trangThai = "NGHI_TRUNG";
    else if (phaiThu != null && daVaoDot != null && daVaoDot < phaiThu) {
      trangThai = "THIEU";
      thieu = phaiThu - daVaoDot;
    } else if (phaiThu != null) trangThai = "DU";
    else if (loiKhai.length > 0) trangThai = "LOI_KHAI";
    else trangThai = "KHONG_DOI_CHIEU";

    const ngay = [
      ...[...n.giaoDich].map((id) => ngayVn(gdTheoId.get(id)!.transferredAt, true)),
      ...khoanKhongGd.map((k) => ngayVn(k.paidDate, false)),
    ].sort();

    ra.push({
      key: n.key,
      khoanIds: n.khoan.map((k) => k.id).sort(),
      giaoDichIds: [...n.giaoDich].sort(),
      soTien,
      ngayThu: ngay.at(-1) ?? "",
      nguon: n.giaoDich.size > 0 ? "CK" : loiKhai.length > 0 ? "LOI_KHAI" : "KHONG_GIAO_DICH",
      dotDich: [...n.dich]
        .map((id) => dotTheoId.get(id)!)
        .sort((a, b) => a.installmentNo - b.installmentNo)
        .map((d) => ({ id: d.id, installmentNo: d.installmentNo })),
      phaiThu,
      daVaoDot,
      thieu,
      traTruoc,
      ngoaiDot,
      tienTha,
      trangThai,
      nghiTrungVi,
      canhBao: n.canhBao,
    });
  }

  return ra.sort((a, b) => (a.ngayThu === b.ngayThu ? a.key.localeCompare(b.key) : a.ngayThu.localeCompare(b.ngayThu)));
}

/**
 * Lần thu của MỘT hoá đơn: gom các khoản của nó bằng CHÍNH `gomLanThu`, ra nhiều nhóm thì gộp về
 * một (khoá dòng trùng khoá lúc còn ở hàng chờ). `null` ⇔ không còn khoản nào.
 *
 * Hai nơi gọi và PHẢI cùng một hàm: màn kế toán (`dong-hang-cho.ts` — nút Xác nhận sáng hay tắt) và
 * bước chốt (`chot-hoa-don.ts` — dựng lại trong transaction, PLAN §4 ⑤ "nhóm vẫn DU"). Hai bản dựng
 * là có ngày màn nói "đủ" mà bước chốt nói "thiếu" — nút sáng mà bấm là bị từ chối (luật 12).
 */
export function lanThuCuaHoaDon(input: Omit<Parameters<typeof gomLanThu>[0], "gop" | "tachTheoCon">): LanThu | null {
  // Hoá đơn của MỘT con ⇒ khoá mang đuôi `#<con>` như dòng hàng chờ đã chọn. Hoá đơn gộp NHIỀU con (xuất trước
  // khi có luật tách, hoặc kế toán gộp tay) ⇒ dựng như cũ, MỘT lần thu — không đổi số tiền / khoá của hoá đơn đã có.
  const theoCon = gomLanThu({ ...input, gop: [], tachTheoCon: true });
  if (theoCon.length === 1) return theoCon[0]!;
  const nhom = gomLanThu({ ...input, gop: [], tachTheoCon: false });
  if (nhom.length <= 1) return nhom[0] ?? null;
  return gomLanThu({ ...input, gop: [nhom.map((n) => n.key)], tachTheoCon: false })[0] ?? null;
}
