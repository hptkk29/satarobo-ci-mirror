// Ca [CTR-*] — TỰ RÓT NGUYÊN KHOẢN khi phiếu gộp một QR chuyển lệch số [chủ dự án chốt 22/10/2026].
//
// Luật: rót theo thứ tự khoản của từng con; một khoản chỉ được rót khi nhận ĐỦ; gặp khoản không vừa
// thì DỪNG (không nhảy cóc); tiền dư thành «tiền chờ gắn». Luật cũ `chiaTheoPhieuGop` còn nguyên và
// có bộ ca riêng (`chia-phieu-gop.test.ts`) — các ca [CTR-08] dưới đây ghim nó không bị đụng.
import { describe, it, expect } from "vitest";
import { chiaTuRotNguyenKhoan, chiaTheoPhieuGop, type DongPhieuGop, type PhieuGopDeChia } from "./chia-phieu-gop";
import { thuTuRot } from "./thu-tu-rot";

const dong = (id: string, thuTu: number, soTien: number, extra: Partial<DongPhieuGop> = {}): DongPhieuGop => ({
  paymentRequestId: id,
  sortOrder: thuTuRot({ thuTuDong: thuTu, installmentNo: 1 }),
  amount: soTien,
  amountDue: soTien,
  daRot: 0,
  daTha: 0,
  ...extra,
});

/** Ba con: 5tr · 2tr · 3tr (tổng 10tr). Khoản 2 NHỎ hơn khoản 1 — để bắt lỗi «nhảy cóc». */
const baCon = (): DongPhieuGop[] => [dong("a", 0, 5_000_000), dong("b", 1, 2_000_000), dong("c", 2, 3_000_000)];
const phieu = (d = baCon(), trangThai: PhieuGopDeChia["trangThai"] = "OPEN"): PhieuGopDeChia => ({ billId: "KT-01", trangThai, dong: d });

describe("[CTR-01] ĐÚNG TỔNG ⇒ y hệt luật cũ", () => {
  it("rót đủ mọi khoản, không còn dư, phiếu hết", () => {
    const r = chiaTuRotNguyenKhoan(10_000_000, phieu());
    expect(r.chia).toBe(true);
    if (!r.chia) return;
    expect(r.lines).toEqual([
      { paymentRequestId: "a", amount: 5_000_000 },
      { paymentRequestId: "b", amount: 2_000_000 },
      { paymentRequestId: "c", amount: 3_000_000 },
    ]);
    expect(r.tongRot).toBe(10_000_000);
    expect(r.conLai).toBe(0);
    expect(r.hetPhieu).toBe(true);
  });
  it("kết quả trùng từng dòng với `chiaTheoPhieuGop`", () => {
    const cu = chiaTheoPhieuGop(10_000_000, phieu());
    const moi = chiaTuRotNguyenKhoan(10_000_000, phieu());
    expect(cu.chia && moi.chia && moi.lines).toEqual(cu.chia && cu.lines);
  });
});

describe("[CTR-02] THIẾU nhưng đủ con đầu ⇒ rót con đầu, dừng", () => {
  it("5tr vào [5tr, 2tr, 3tr] ⇒ chỉ con a; phiếu CHƯA hết", () => {
    const r = chiaTuRotNguyenKhoan(5_000_000, phieu());
    expect(r.chia).toBe(true);
    if (!r.chia) return;
    expect(r.lines).toEqual([{ paymentRequestId: "a", amount: 5_000_000 }]);
    expect(r.tongRot).toBe(5_000_000);
    expect(r.conLai).toBe(0);
    expect(r.hetPhieu).toBe(false);
  });
});

describe("[CTR-03] THIẾU đủ một số con đầu rồi dừng — KHÔNG rót một phần", () => {
  it("8tr vào [5tr, 2tr, 3tr] ⇒ a + b; con c (3tr) không vừa 1tr dư ⇒ dừng, 1tr chờ gắn", () => {
    const r = chiaTuRotNguyenKhoan(8_000_000, phieu());
    expect(r.chia).toBe(true);
    if (!r.chia) return;
    expect(r.lines.map((l) => l.paymentRequestId)).toEqual(["a", "b"]);
    expect(r.lines.every((l) => l.amount === 5_000_000 || l.amount === 2_000_000)).toBe(true);
    expect(r.tongRot).toBe(7_000_000);
    expect(r.conLai).toBe(1_000_000);
    expect(r.hetPhieu).toBe(false);
  });
  it("KHÔNG có dòng rót nào nhỏ hơn số phải thu của khoản đó", () => {
    for (const ve of [1, 4_999_999, 5_000_001, 6_999_999, 9_999_999]) {
      const r = chiaTuRotNguyenKhoan(ve, phieu());
      if (!r.chia) continue;
      const can = new Map(baCon().map((d) => [d.paymentRequestId, d.amount]));
      for (const l of r.lines) expect(l.amount).toBe(can.get(l.paymentRequestId));
    }
  });
});

describe("[CTR-04] KHÔNG NHẢY CÓC: gặp khoản không vừa thì dừng, dù khoản sau nhỏ hơn", () => {
  it("3tr vào [5tr, 2tr, 3tr] ⇒ KHÔNG rót gì (khoản b 2tr vừa nhưng đứng sau a)", () => {
    const r = chiaTuRotNguyenKhoan(3_000_000, phieu());
    expect(r.chia).toBe(false);
  });
  it("6tr vào [5tr, 2tr, 3tr] ⇒ chỉ a; b (2tr) không vừa 1tr dư; c (3tr) cũng không", () => {
    const r = chiaTuRotNguyenKhoan(6_000_000, phieu());
    expect(r.chia && r.lines.map((l) => l.paymentRequestId)).toEqual(["a"]);
    expect(r.chia && r.conLai).toBe(1_000_000);
  });
  it("4tr vào [5tr, 2tr, 3tr] ⇒ KHÔNG rót gì dù đủ b+... nhỏ hơn", () => {
    expect(chiaTuRotNguyenKhoan(4_000_000, phieu()).chia).toBe(false);
  });
});

describe("[CTR-05] THIẾU NGAY KHOẢN ĐẦU ⇒ không rót, lý do LECH_SO như luật cũ", () => {
  it("1đ cũng vậy", () => {
    const r = chiaTuRotNguyenKhoan(1, phieu());
    expect(r.chia).toBe(false);
    expect(!r.chia && r.ma).toBe("LECH_SO");
    expect(!r.chia && r.conPhaiThu).toBe(10_000_000);
  });
  it("thiếu 1đ so với khoản đầu ⇒ không rót", () => {
    expect(chiaTuRotNguyenKhoan(4_999_999, phieu()).chia).toBe(false);
  });
});

describe("[CTR-06] DƯ ⇒ rót đủ mọi khoản, phần dư là tiền chờ gắn", () => {
  it("10,5tr vào phiếu 10tr ⇒ rót 10tr, dư 500.000đ, phiếu hết", () => {
    const r = chiaTuRotNguyenKhoan(10_500_000, phieu());
    expect(r.chia).toBe(true);
    if (!r.chia) return;
    expect(r.tongRot).toBe(10_000_000);
    expect(r.conLai).toBe(500_000);
    expect(r.hetPhieu).toBe(true);
    expect(r.lines.length).toBe(3);
  });
  it("Σ lines + conLai = số tiền về, mọi trường hợp", () => {
    for (const ve of [1, 2_000_000, 5_000_000, 7_000_000, 8_000_000, 10_000_000, 12_345_678]) {
      const r = chiaTuRotNguyenKhoan(ve, phieu());
      if (!r.chia) continue;
      expect(r.lines.reduce((s, l) => s + l.amount, 0) + r.conLai).toBe(ve);
    }
  });
});

describe("[CTR-07] thứ tự là của PHIẾU và TẤT ĐỊNH; khoản đã đủ từ đường khác không làm dừng", () => {
  it("dòng truyền lộn xộn vẫn rót theo sortOrder", () => {
    const lon = [dong("c", 2, 3_000_000), dong("a", 0, 5_000_000), dong("b", 1, 2_000_000)];
    const r = chiaTuRotNguyenKhoan(7_000_000, phieu(lon));
    expect(r.chia && r.lines.map((l) => l.paymentRequestId)).toEqual(["a", "b"]);
  });
  it("hai dòng trùng sortOrder ⇒ phân xử theo paymentRequestId, mọi lượt giống nhau", () => {
    const x = [dong("m", 0, 1_000_000, { sortOrder: 7 }), dong("k", 0, 1_000_000, { sortOrder: 7 })];
    const r1 = chiaTuRotNguyenKhoan(1_000_000, phieu(x));
    const r2 = chiaTuRotNguyenKhoan(1_000_000, phieu([...x].reverse()));
    expect(r1.chia && r1.lines).toEqual(r2.chia && r2.lines);
    expect(r1.chia && r1.lines[0]?.paymentRequestId).toBe("k");
  });
  it("khoản a ĐÃ ĐỦ từ đường khác ⇒ bỏ qua nó, KHÔNG coi là «không vừa»", () => {
    const x = [dong("a", 0, 5_000_000, { daRot: 5_000_000 }), dong("b", 1, 2_000_000), dong("c", 2, 3_000_000)];
    const r = chiaTuRotNguyenKhoan(2_000_000, phieu(x));
    expect(r.chia && r.lines).toEqual([{ paymentRequestId: "b", amount: 2_000_000 }]);
  });
  it("khoản còn thiếu sau khi đã rót một phần (đường khác) ⇒ cần đúng phần CÒN thiếu", () => {
    const x = [dong("a", 0, 5_000_000, { daRot: 3_000_000 }), dong("b", 1, 2_000_000)];
    const r = chiaTuRotNguyenKhoan(2_000_000, phieu(x));
    expect(r.chia && r.lines).toEqual([{ paymentRequestId: "a", amount: 2_000_000 }]);
    expect(r.chia && r.hetPhieu).toBe(false);
  });
  it("không sửa mảng người gọi truyền vào", () => {
    const x = baCon();
    const truoc = JSON.stringify(x);
    chiaTuRotNguyenKhoan(8_000_000, phieu(x));
    expect(JSON.stringify(x)).toBe(truoc);
  });
});

describe("[CTR-08] phiếu không mở / không có phiếu / đầu vào rác: giữ nguyên lý do của luật cũ, KHÔNG ném", () => {
  it("phiếu PAID ⇒ PHIEU_KHONG_MO, không phải LECH_SO", () => {
    const r = chiaTuRotNguyenKhoan(3_000_000, phieu(baCon(), "PAID"));
    expect(!r.chia && r.ma).toBe("PHIEU_KHONG_MO");
  });
  it("phiếu VOID ⇒ PHIEU_KHONG_MO", () => {
    expect(chiaTuRotNguyenKhoan(10_000_000, phieu(baCon(), "VOID")).chia).toBe(false);
  });
  it("không tra ra phiếu ⇒ KHONG_KHOP_PHIEU", () => {
    const r = chiaTuRotNguyenKhoan(1_000_000, null);
    expect(!r.chia && r.ma).toBe("KHONG_KHOP_PHIEU");
  });
  it("0đ, âm, NaN, Infinity ⇒ không chia, không ném", () => {
    for (const ve of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => chiaTuRotNguyenKhoan(ve, phieu())).not.toThrow();
      expect(chiaTuRotNguyenKhoan(ve, phieu()).chia).toBe(false);
    }
  });
  it("phiếu MỌI khoản đã đủ (còn phải thu 0) ⇒ không chia", () => {
    const x = baCon().map((d) => ({ ...d, daRot: d.amountDue }));
    expect(chiaTuRotNguyenKhoan(1_000, phieu(x)).chia).toBe(false);
  });
});

describe("[CTR-09] dung sai làm tròn đã tha được tính vào «còn thiếu»", () => {
  it("khoản a thiếu 2.000đ đã được tha ⇒ cần 4.998.000đ, không phải 5tr", () => {
    const x = [dong("a", 0, 5_000_000, { daRot: 4_998_000, daTha: 2_000 }), dong("b", 1, 2_000_000)];
    // còn phải thu: a = 0 (đã đủ nhờ dung sai), b = 2tr
    const r = chiaTuRotNguyenKhoan(2_000_000, phieu(x));
    expect(r.chia && r.lines).toEqual([{ paymentRequestId: "b", amount: 2_000_000 }]);
  });
});

// ─── LƯỚI GHIM DÂY NỐI: những điều test hành vi của hàm thuần KHÔNG chứng minh được ──────────────────────────
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const doc = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8").replace(/\/\/.*$/gm, "");

describe("[CTR-W] dây nối", () => {
  it("[CTR-W1] `xuLyPhieuGopDaChia` KHÔNG đòi giao dịch MATCHED — tự rót để lại phần dư thì giao dịch vẫn UNMATCHED mà tiền đã rót thật", () => {
    // Đòi MATCHED ⇒ đúng ca «rót một phần + còn dư» mất lead→«Đã đăng ký», báo sale và chốt đơn, không lỗi nào báo.
    const ma = doc("lib/payments/sau-da-chia.ts");
    expect(ma).not.toMatch(/status\s*!==\s*"MATCHED"/);
    expect(ma).toMatch(/status\s*===\s*"IGNORED"/);
  });
  it("[CTR-W2] `thuTheoPhieuGop` chỉ chọn luật tự rót khi nguồn KHÔNG phải thẻ POS và mọi dòng thuộc một con", () => {
    const ma = doc("lib/finance/phieu-gop.ts");
    expect(ma).toMatch(/input\.provider\s*!==\s*PROVIDER_THE_POS/);
    expect(ma).toMatch(/phieu\.lines\.every\(\(l\)\s*=>\s*l\.paymentRequest\.orderItemId\s*!=\s*null\)/);
  });
});
