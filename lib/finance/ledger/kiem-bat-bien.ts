// lib/finance/ledger/kiem-bat-bien.ts — CHÍN BẤT BIẾN TIỀN (B1–B9). Thuần, không chạm DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// US-02 · Đợt 0. Bộ này phải tồn tại TRƯỚC mọi Server Action ghi tiền của module thu học phí
// linh hoạt (README bàn giao §2 luật 2). Nguồn luật: `docs/thanh-toan-linh-hoat/01-BA…` mục 4.2.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ ĐỌC TRƯỚC: BỘ NÀY DÙNG TÊN THẬT, KHÔNG DÙNG TÊN THIẾT KẾ
//
// BA viết theo một mô hình chưa tồn tại (`Enrollment` làm hạt tiền, có thực thể "gia đình"
// `guardianId`, ví là `GuardianWalletEntry`). Đo ở `docs/thanh-toan-linh-hoat/gate-0.md`:
//
//   · X1 — `/orders/new` KHÔNG tạo `Enrollment`; ghi danh sinh SAU khi chốt đơn. Hạt tiền
//          thật là **`OrderItem`** (`PaymentRequest.orderItemId`), không phải ghi danh.
//   · X2 — KHÔNG có bảng "gia đình". Khoá gom hôm nay là **`Order.id`**.
//   · X4 — CS1 và CS2 **CÙNG** pháp nhân. B8 vẫn cài (nhượng quyền sẽ cần) nhưng hôm nay
//          không chặn ca nào trên dữ liệu thật.
//
// Nên ảnh chụp dưới đây mang tên thật. Dịch tên ở ĐÂY, một lần, thay vì để mỗi story tự dịch —
// hai bản dịch khác nhau của cùng một luật là cách chắc chắn nhất để hai sổ lệch nhau.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO NHẬN "ẢNH CHỤP" CHỨ KHÔNG TỰ TRA DB
//
// Ba lý do, lý do thứ ba mới là lý do thật:
//   1. Thuần thì test được mà không cần Postgres.
//   2. Cùng một hàm dùng được cho cả đường GHI (kiểm trước khi commit, trong transaction) lẫn
//      cron kiểm cân đêm (kiểm trên dữ liệu đã có).
//   3. **Người gọi buộc phải nói rõ họ đã đọc những gì.** Một hàm tự tra DB sẽ âm thầm đọc
//      thiếu một bảng và báo "sạch" — đúng kiểu lỗi mà bộ này sinh ra để chặn.

/** Mã bất biến — khớp BA mục 4.2. Trả về trong `ViPham.ma`. */
export type MaBatBien = "B1" | "B2" | "B3" | "B4" | "B5" | "B6" | "B7" | "B8" | "B9";

export type ViPham = {
  ma: MaBatBien;
  /** Câu tiếng Việt nêu VẤN ĐỀ, kèm số — để dán thẳng vào thông báo cho kế toán. */
  moTa: string;
  /** Số lệch (đồng). 0 khi bất biến không phải dạng "lệch" (vd B7). */
  lech: number;
  /** Định danh chỗ sai: orderItemId / bankTransactionId / billId / nghiepVuId. */
  tai?: string;
};

/** Một dòng hàng của đơn — hạt tiền thật (xem X1). */
export type DongTien = {
  orderItemId: string;
  /** Tên để in vào câu vi phạm; người đọc là kế toán, không phải máy. */
  ten: string;
  phapNhanId: string;
  /** Σ `PaymentRequest.amountDue` của dòng, `cancelledAt IS NULL`. */
  phaiThu: number;
  /** Σ tiền đã vào dòng — TRỤC A (`Payment` CONFIRMED / `PaymentAllocation` đã đối soát). */
  daThu: number;
  /** Thành tiền của dòng (`totalPrice - discountAmount`). Dùng cho B6. */
  thanhTien: number;
  trangThai: "ACTIVE" | "PAUSED" | "STOPPED";
  /** Giá trị quyết toán khi STOPPED. `null` với ACTIVE/PAUSED. */
  giaTriQuyetToan?: number | null;
};

/** Một giao dịch ngân hàng và cách nó được chia (B2). */
export type GiaoDichVao = {
  bankTransactionId: string;
  soTien: number;
  /** Σ `PaymentAllocation.amount` sinh từ giao dịch này. */
  daRot: number;
};

/** Một nghiệp vụ chuyển nội bộ: các dòng ± phải triệt tiêu (B3) và không đi chéo (B8). */
export type NghiepVuChuyen = {
  nghiepVuId: string;
  dong: {
    /** `OrderItem.id` hoặc `"VI"` khi vế đó là ví. */
    tai: string;
    giaDinhId: string;
    phapNhanId: string;
    /** Dương = vào, âm = ra. */
    amount: number;
    /**
     * Phần đã XÁC NHẬN ở vế NGUỒN tại thời điểm chuyển (B9). Chỉ cần với dòng âm.
     * Bỏ trống ở dòng âm = chưa đo được ⇒ B9 coi là vi phạm, KHÔNG coi là hợp lệ.
     */
    nguonDaXacNhan?: number;
  }[];
};

export type PhieuGop = {
  billId: string;
  /** `CLOSED` không dùng ở luồng mới — xem chú thích enum `PaymentBillStatus` ở `schema.prisma`. */
  trangThai: "OPEN" | "PAID" | "VOID" | "CLOSED";
  /** `PaymentRequest.id` của các dòng phiếu. */
  dongPhieu: string[];
};

export type AnhChupGiaDinh = {
  /** Khoá gom. Hôm nay là `Order.id` — xem X2 ở gate-0. */
  giaDinhId: string;
  dong: DongTien[];
  giaoDich: GiaoDichVao[];
  /** Ví: các dòng `CreditBalance` theo pháp nhân. Dương = vào, âm = ra. */
  vi: { phapNhanId: string; amount: number }[];
  /** Σ đã hoàn ra ngoài gia đình này. */
  hoan: number;
  nghiepVuChuyen: NghiepVuChuyen[];
  phieuGop: PhieuGop[];
};

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const tron = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * Kiểm cả chín bất biến trên một ảnh chụp.
 *
 * Trả về **mọi** vi phạm, không dừng ở cái đầu tiên: một lỗi tiền thường kéo theo vài bất biến
 * cùng đỏ (vd xoá một dòng phân bổ làm đỏ cả B2 lẫn B5), và người sửa cần thấy đủ bộ để biết
 * lỗi nằm ở đâu chứ không phải sửa từng cái một.
 *
 * Mảng RỖNG nghĩa là sạch.
 */
export function kiemBatBien(anh: AnhChupGiaDinh): ViPham[] {
  const v: ViPham[] = [];

  // ── B1 · Mỗi dòng: 0 ≤ Đã thu ≤ Phải thu ───────────────────────────────────
  // Tiền vượt phải thu BẮT BUỘC đi sang ví hoặc dòng khác trong cùng nghiệp vụ. Để nó nằm lại
  // trên dòng là số "còn nợ" âm — và số âm đó sẽ đi vào mọi màn, mọi báo cáo, mà không ai gọi
  // nó là lỗi.
  for (const d of anh.dong) {
    const daThu = tron(d.daThu);
    const phaiThu = tron(d.phaiThu);
    if (daThu < 0) {
      v.push({
        ma: "B1",
        tai: d.orderItemId,
        lech: daThu,
        moTa: `${d.ten}: đã thu ÂM (${vnd(daThu)}đ)`,
      });
    } else if (daThu > phaiThu) {
      v.push({
        ma: "B1",
        tai: d.orderItemId,
        lech: daThu - phaiThu,
        moTa: `${d.ten}: đã thu ${vnd(daThu)}đ > phải thu ${vnd(phaiThu)}đ (vượt ${vnd(daThu - phaiThu)}đ)`,
      });
    }
  }

  // ── B2 · Σ phân bổ của một giao dịch ∈ {0, số tiền giao dịch} ──────────────
  //
  // ⚠️ BẤT BIẾN NÀY ĐÃ ĐỔI 16/09/2026 (chiều), và bản mới MẠNH HƠN bản BA mô tả.
  //
  // BA viết: `Σ dòng PAYMENT + Σ dòng vào ví = số tiền giao dịch` — tức cho phép chia một phần
  // vào các con và phần dư vào ví. Chủ dự án chốt lại: *"Σ PaymentAllocation của một
  // BankTransaction ∈ {0, số tiền giao dịch} — hoặc chia hết theo phiếu, hoặc không chia gì."*
  //
  // Bản mới mạnh hơn ở chỗ nó loại bỏ TRẠNG THÁI TRUNG GIAN. Với luật cũ, một giao dịch có thể
  // sống mãi ở tình trạng "đã chia 8 triệu, còn 2 triệu ở ví" — và mỗi tình trạng trung gian là
  // một thứ phải có màn để xử lý, có quyền để gác, có báo cáo để theo dõi. Với luật mới chỉ có
  // hai tình trạng: đã chia đúng, hoặc chưa chia gì và đang chờ kế toán hoàn.
  //
  // Hệ quả cho người đọc mã: **không có `vaoVi` trong ảnh chụp giao dịch nữa.** Tiền của một
  // giao dịch không bao giờ vào ví. Ví chỉ nhận tiền từ nghiệp vụ NỘI BỘ (em nghỉ học, dư
  // chuyển sang) — và tiền đó đã được đếm ở `daThu` của dòng nguồn trước khi chuyển.
  for (const g of anh.giaoDich) {
    const soTien = tron(g.soTien);
    const daRot = tron(g.daRot);
    if (daRot !== 0 && daRot !== soTien) {
      v.push({
        ma: "B2",
        tai: g.bankTransactionId,
        lech: daRot - soTien,
        moTa:
          `Giao dịch ${g.bankTransactionId}: về ${vnd(soTien)}đ nhưng đã phân bổ ` +
          `${vnd(daRot)}đ — phải là 0đ (chưa xử lý) hoặc đủ ${vnd(soTien)}đ`,
      });
    }
  }

  // ── B3 · Mỗi nghiệp vụ chuyển nội bộ: Σ các vế = 0 ─────────────────────────
  // Chuyển nội bộ không tạo và không tiêu tiền. Lệch ≠ 0 nghĩa là một nửa bút toán đã ghi còn
  // nửa kia thì không — và vì cả hai nửa nằm trong CÙNG một transaction, lệch ở đây là dấu hiệu
  // bộ dựng dòng sai, không phải dấu hiệu mất dữ liệu.
  for (const n of anh.nghiepVuChuyen) {
    const tong = n.dong.reduce((s, x) => s + tron(x.amount), 0);
    if (tong !== 0) {
      v.push({
        ma: "B3",
        tai: n.nghiepVuId,
        lech: tong,
        moTa: `Nghiệp vụ ${n.nghiepVuId}: các vế cộng ra ${vnd(tong)}đ, phải bằng 0`,
      });
    }
  }

  // ── B4 · Số dư ví theo từng pháp nhân ≥ 0 ──────────────────────────────────
  const viTheoPhapNhan = new Map<string, number>();
  for (const x of anh.vi) {
    viTheoPhapNhan.set(x.phapNhanId, (viTheoPhapNhan.get(x.phapNhanId) ?? 0) + tron(x.amount));
  }
  for (const [pn, soDu] of viTheoPhapNhan) {
    if (soDu < 0) {
      v.push({
        ma: "B4",
        tai: pn,
        lech: soDu,
        moTa: `Ví (pháp nhân ${pn}) âm ${vnd(-soDu)}đ — đã chia ra nhiều hơn số đã nhận`,
      });
    }
  }

  // ── B5 · Cân gia đình: tiền vào đã gán = Σ đã thu + số dư ví + đã hoàn ──────
  // Bất biến TỔNG. Bốn bất biến trên bắt lỗi ở từng chỗ; B5 bắt lỗi ở chỗ không ai nhìn — tiền
  // nằm đúng chỗ của nó nhưng TỔNG không khớp, tức có dòng thừa hoặc thiếu ở đâu đó.
  //
  // ⚠️ Vế trái là tiền ĐÃ PHÂN BỔ, KHÔNG phải tổng tiền về. Giao dịch lệch số vẫn nằm nguyên ở
  // `BankTransaction` chờ kế toán hoàn; tính nó vào đây là bắt B5 đỏ suốt mỗi khi có một khoản
  // chờ, và một cảnh báo đỏ thường trực là một cảnh báo bị bỏ qua.
  //
  // ⚠️ Và đó cũng là một TÍNH CHẤT ĐẸP của luật mới, đáng nói ra: **tiền chưa phân bổ không bao
  // giờ vào sổ của gia đình**, nên nó không thể làm lệch sổ. Hoàn một khoản chưa phân bổ chỉ là
  // đánh dấu `BankTransaction` đã xử lý + lưu chứng từ — không sinh bút toán nào, không đụng
  // `hoan` dưới đây. `hoan` chỉ đếm tiền ĐÃ từng vào một dòng rồi mới hoàn ra.
  const daGan = anh.giaoDich.reduce((s, g) => s + tron(g.daRot), 0);
  const tongDaThu = anh.dong.reduce((s, d) => s + tron(d.daThu), 0);
  const tongVi = [...viTheoPhapNhan.values()].reduce((s, x) => s + x, 0);
  const vePhai = tongDaThu + tongVi + tron(anh.hoan);
  if (daGan !== vePhai) {
    v.push({
      ma: "B5",
      tai: anh.giaDinhId,
      lech: daGan - vePhai,
      moTa:
        `Gia đình ${anh.giaDinhId}: tiền đã gán ${vnd(daGan)}đ ≠ ` +
        `đã thu ${vnd(tongDaThu)}đ + ví ${vnd(tongVi)}đ + đã hoàn ${vnd(anh.hoan)}đ ` +
        `(lệch ${vnd(daGan - vePhai)}đ)`,
    });
  }

  // ── B6 · Σ đợt không huỷ = thành tiền dòng (STOPPED: = giá trị quyết toán) ──
  // Đây là bất biến GỐC của công nợ theo con. Σ sai thì mọi con số "bé X còn thiếu" đều sai, và
  // cái sai đó KHÔNG ném ở đâu — nó chỉ làm phụ huynh bị đòi nhầm số.
  for (const d of anh.dong) {
    const chuan =
      d.trangThai === "STOPPED"
        ? d.giaTriQuyetToan == null
          ? null
          : tron(d.giaTriQuyetToan)
        : tron(d.thanhTien);
    if (chuan == null) {
      v.push({
        ma: "B6",
        tai: d.orderItemId,
        lech: 0,
        moTa: `${d.ten}: đã dừng học nhưng chưa có giá trị quyết toán`,
      });
      continue;
    }
    const phaiThu = tron(d.phaiThu);
    if (phaiThu !== chuan) {
      v.push({
        ma: "B6",
        tai: d.orderItemId,
        lech: phaiThu - chuan,
        moTa:
          `${d.ten}: Σ các đợt ${vnd(phaiThu)}đ ≠ ` +
          `${d.trangThai === "STOPPED" ? "giá trị quyết toán" : "học phí"} ${vnd(chuan)}đ`,
      });
    }
  }

  // ── B7 · Mỗi đợt nằm trong tối đa MỘT phiếu gộp đang mở ────────────────────
  // Hai phiếu mở cùng chứa một đợt = hai mã QR cùng đòi một khoản. Khách quét mã nào cũng
  // "đúng", và khoản đó được thu hai lần mà không bất biến nào khác kêu.
  const demTrongPhieuMo = new Map<string, number>();
  for (const p of anh.phieuGop) {
    if (p.trangThai !== "OPEN") continue;
    for (const pr of p.dongPhieu) {
      demTrongPhieuMo.set(pr, (demTrongPhieuMo.get(pr) ?? 0) + 1);
    }
  }
  for (const [pr, n] of demTrongPhieuMo) {
    if (n > 1) {
      v.push({
        ma: "B7",
        tai: pr,
        lech: 0,
        moTa: `Đợt ${pr} đang nằm trong ${n} phiếu gộp OPEN — phải tối đa 1`,
      });
    }
  }

  // ── B8 · Chuyển nội bộ chỉ trong cùng gia đình VÀ cùng pháp nhân ───────────
  // Hôm nay CS1 và CS2 cùng pháp nhân (gate-0 X4), nên bất biến này chưa chặn ca nào trên dữ
  // liệu thật. Vẫn cài, vì mở cơ sở thuộc pháp nhân khác là thêm DỮ LIỆU — không ai sửa mã, và
  // không ai nhớ ra rằng lúc đó luật này mới bắt đầu có việc.
  for (const n of anh.nghiepVuChuyen) {
    const pn = new Set(n.dong.map((x) => x.phapNhanId));
    const gd = new Set(n.dong.map((x) => x.giaDinhId));
    if (pn.size > 1) {
      v.push({
        ma: "B8",
        tai: n.nghiepVuId,
        lech: 0,
        moTa: `Nghiệp vụ ${n.nghiepVuId}: chuyển tiền giữa ${pn.size} pháp nhân khác nhau`,
      });
    }
    if (gd.size > 1) {
      v.push({
        ma: "B8",
        tai: n.nghiepVuId,
        lech: 0,
        moTa: `Nghiệp vụ ${n.nghiepVuId}: chuyển tiền giữa ${gd.size} gia đình khác nhau`,
      });
    }
  }

  // ── B9 · Chỉ phần ĐÃ XÁC NHẬN (trục A) mới được chuyển đi ──────────────────
  // Chuyển tiền chưa xác nhận là chuyển một lời hứa. Kế toán từ chối khoản đó sau, và phần đã
  // chuyển sang con khác thì không tự quay lại — đúng ca T13 của pre-mortem.
  //
  // ⚠️ Thiếu `nguonDaXacNhan` là VI PHẠM, không phải "bỏ qua". Một bất biến im lặng khi không
  // đo được là một bất biến không tồn tại.
  for (const n of anh.nghiepVuChuyen) {
    for (const x of n.dong) {
      if (tron(x.amount) >= 0) continue; // chỉ vế RA mới phải chứng minh nguồn
      const raKhoi = -tron(x.amount);
      if (x.nguonDaXacNhan == null) {
        v.push({
          ma: "B9",
          tai: n.nghiepVuId,
          lech: raKhoi,
          moTa:
            `Nghiệp vụ ${n.nghiepVuId}: chuyển ${vnd(raKhoi)}đ khỏi ${x.tai} ` +
            `mà không biết nguồn đã xác nhận bao nhiêu`,
        });
        continue;
      }
      const daXacNhan = tron(x.nguonDaXacNhan);
      if (raKhoi > daXacNhan) {
        v.push({
          ma: "B9",
          tai: n.nghiepVuId,
          lech: raKhoi - daXacNhan,
          moTa:
            `Nghiệp vụ ${n.nghiepVuId}: chuyển ${vnd(raKhoi)}đ khỏi ${x.tai} ` +
            `nhưng chỉ ${vnd(daXacNhan)}đ đã được kế toán xác nhận`,
        });
      }
    }
  }

  return v;
}

/** Tiện cho người gọi: có sạch không. KHÔNG dùng thay `kiemBatBien` khi cần in lý do. */
export function sachBatBien(anh: AnhChupGiaDinh): boolean {
  return kiemBatBien(anh).length === 0;
}
