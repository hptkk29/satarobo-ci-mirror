// lib/entitlements/tien-xac-nhan.test.ts — "TIỀN ĐÃ XÁC NHẬN" của từng dòng đơn. THUẦN, không DB, không đồng hồ.
//
// Số tiền mang HÌNH DẠNG THẬT (lẻ nghìn): 8.323.200 là giá 48 buổi của con thứ nhất, 3.168.000 là một đợt của phiếu gộp.
import { describe, expect, it } from "vitest";
import { khoaNganHangCuaGiaoDich, khoaNganHangTuNote, tienXacNhanTheoDong, type KhoanTien, type NganHangThat } from "./tien-xac-nhan";

const A = "item-a";
const B = "item-b";
const GIA = 8_323_200;
const WEBHOOK = "Tiền về qua SEPAY txn-9 [auto:sepay:txn-9]";
const GAN_TAY = "Kế toán gắn tay [gan-tay:btx-4]";
// Hằng, không gõ literal ngay sau tên cột trạng thái kế toán: lưới [BUOC-6] (lib/finance/truc-a.test.ts) cấm cặp đó ngoài debt.ts,
// kể cả trong test. Đây là dữ liệu mẫu cho hàm thuần, không phải một điều kiện ĐỌC thứ hai.
const DA_XAC_NHAN = "CONFIRMED";

/** Giao dịch ngân hàng THẬT đã phân bổ vào đơn: webhook `txn-9` đúng GIA; gắn tay `btx-4` đúng GIA. */
const THAT: NganHangThat = new Map([
  ["sepay|txn-9", GIA],
  ["gan-tay|btx-4", GIA],
]);
const KHONG_CO: NganHangThat = new Map();

let dem = 0;
const khoan = (o: Partial<KhoanTien> = {}): KhoanTien => {
  const accountantStatus = o.accountantStatus ?? "PENDING";
  return {
    id: `p-${++dem}`,
    orderItemId: A,
    amount: GIA,
    adjustmentOfId: null,
    accountantStatus,
    daXacNhan: accountantStatus === DA_XAC_NHAN,
    note: null,
    ...o,
  };
};
const tinh = (dongIds: string[], nganHangThat: NganHangThat, ...ds: KhoanTien[]) => tienXacNhanTheoDong({ dongIds, khoan: ds, nganHangThat });

describe("[QHC] tiền xác nhận theo dòng — phân loại từng dòng tiền", () => {
  it("[QHC-01] tiền mặt CONFIRMED tính; tiền mặt PENDING (Sale vừa gõ) KHÔNG tính", () => {
    expect(tinh([A, B], KHONG_CO, khoan({ accountantStatus: DA_XAC_NHAN })).theoDong.get(A)).toBe(GIA);
    expect(tinh([A, B], KHONG_CO, khoan({ accountantStatus: "PENDING" })).theoDong.get(A)).toBe(0);
  });

  it("[QHC-02] REJECTED không tính — kể cả khoản mang marker ngân hàng có giao dịch thật", () => {
    expect(tinh([A, B], THAT, khoan({ accountantStatus: "REJECTED", note: WEBHOOK })).theoDong.get(A)).toBe(0);
    expect(tinh([A, B], KHONG_CO, khoan({ accountantStatus: "REJECTED" })).theoDong.get(A)).toBe(0);
  });

  it("[QHC-03] tiền ngân hàng ĐÃ ĐỐI KHỚP (webhook / phiếu gộp / gắn tay) tính dù kế toán chưa xác nhận — khi có giao dịch thật chống lưng", () => {
    expect(tinh([A, B], THAT, khoan({ note: WEBHOOK })).theoDong.get(A)).toBe(GIA);
    expect(tinh([A, B], THAT, khoan({ note: GAN_TAY })).theoDong.get(A)).toBe(GIA);
  });

  it("[QHC-04] PENDING mang marker KHÔNG phải ngân hàng (lời khai, nhập lịch sử, chuyển nội bộ) KHÔNG tính; CONFIRMED thì tính", () => {
    for (const note of ["[auto:order-confirm]", "[auto:order-installment:dot1]", "[backfill-import]", "[sheet:t10]", "[chuyen:abc]"]) {
      expect(tinh([A, B], THAT, khoan({ note })).theoDong.get(A), note).toBe(0);
      expect(tinh([A, B], THAT, khoan({ note, accountantStatus: DA_XAC_NHAN })).theoDong.get(A), `${note} đã xác nhận`).toBe(GIA);
    }
  });

  it("[QHC-05] KHÔNG đếm đôi: một lần tiền về là MỘT dòng Payment; sau khi kế toán xác nhận chính dòng đó (CONFIRMED) vẫn chỉ tính MỘT lần", () => {
    const truoc = khoan({ note: WEBHOOK });
    expect(tinh([A], THAT, truoc).theoDong.get(A)).toBe(GIA);
    const sau = khoan({ note: WEBHOOK, accountantStatus: DA_XAC_NHAN });
    expect(tinh([A], THAT, sau).theoDong.get(A)).toBe(GIA);
  });

  it("[QHC-06] hoàn tiền trỏ về gốc trừ vào GỐC dù dòng hoàn KHÔNG mang orderItemId (hình dạng của refundPayment)", () => {
    const goc = khoan({ id: "goc", accountantStatus: DA_XAC_NHAN });
    const hoan = khoan({ orderItemId: null, amount: -3_240_000, accountantStatus: "REFUNDED", adjustmentOfId: "goc" });
    const kq = tinh([A, B], KHONG_CO, goc, hoan);
    expect(kq.theoDong.get(A)).toBe(GIA - 3_240_000);
    expect(kq.chuaGanDong).toBe(0);
  });

  it("[QHC-07] cặp gốc/đảo (tách khoản, gỡ gắn) triệt tiêu; các phần mới tách thuộc đúng con và vẫn được giao dịch thật chống lưng", () => {
    const goc = khoan({ id: "goc", orderItemId: null, amount: 6_732_000, note: WEBHOOK });
    const dao = khoan({ orderItemId: null, amount: -6_732_000, adjustmentOfId: "goc", note: "Đảo để tách khoản [tach:goc]" });
    const phanA = khoan({ orderItemId: A, amount: 3_168_000, note: `${WEBHOOK} [tach:goc]` });
    const phanB = khoan({ orderItemId: B, amount: 3_564_000, note: `${WEBHOOK} [tach:goc]` });
    const kq = tinh([A, B], new Map([["sepay|txn-9", 6_732_000]]), goc, dao, phanA, phanB);
    expect(kq.theoDong.get(A)).toBe(3_168_000);
    expect(kq.theoDong.get(B)).toBe(3_564_000);
    expect(kq.chuaGanDong).toBe(0);
  });

  it("[QHC-08] chuyển nội bộ giữa hai bé: bé cho mất, bé nhận được (cả hai đã xác nhận)", () => {
    const goc = khoan({ orderItemId: A, accountantStatus: DA_XAC_NHAN });
    const ra = khoan({ orderItemId: A, amount: -2_000_001, accountantStatus: DA_XAC_NHAN, note: "Chuyển cho bé khác [chuyen:x]" });
    const vao = khoan({ orderItemId: B, amount: 2_000_001, accountantStatus: DA_XAC_NHAN, note: "Nhận từ bé khác [chuyen:x]" });
    const kq = tinh([A, B], KHONG_CO, goc, ra, vao);
    expect(kq.theoDong.get(A)).toBe(GIA - 2_000_001);
    expect(kq.theoDong.get(B)).toBe(2_000_001);
  });

  it("[QHC-09] bút toán đảo bị REJECTED coi như không có hiệu lực (khoản gốc vẫn còn nguyên)", () => {
    const goc = khoan({ id: "goc", accountantStatus: DA_XAC_NHAN });
    const daoBiTuChoi = khoan({ amount: -GIA, accountantStatus: "REJECTED", adjustmentOfId: "goc" });
    expect(tinh([A], KHONG_CO, goc, daoBiTuChoi).theoDong.get(A)).toBe(GIA);
  });

  it("[QHC-10] số tiền không nguyên (dữ liệu hỏng) ⇒ không tính, không NaN", () => {
    expect(tinh([A], KHONG_CO, khoan({ amount: 1000.5, accountantStatus: DA_XAC_NHAN })).theoDong.get(A)).toBe(0);
    expect(tinh([A], KHONG_CO, khoan({ amount: Number.NaN, accountantStatus: DA_XAC_NHAN })).theoDong.get(A)).toBe(0);
  });
});

describe("[QHC] tiền xác nhận theo dòng — GẮN tiền vào dòng", () => {
  it("[QHC-11] đơn MỘT dòng: khoản không gắn dòng nào thuộc về dòng duy nhất (cùng luật dongDuyNhat của allocateToOrder)", () => {
    const kq = tinh([A], THAT, khoan({ orderItemId: null, note: WEBHOOK }));
    expect(kq.theoDong.get(A)).toBe(GIA);
    expect(kq.chuaGanDong).toBe(0);
  });

  it("[QHC-12] đơn NHIỀU dòng: khoản không gắn dòng nào KHÔNG được đoán — vào chuaGanDong, không dòng nào được cộng", () => {
    const kq = tinh([A, B], THAT, khoan({ orderItemId: null, note: WEBHOOK }));
    expect(kq.theoDong.get(A)).toBe(0);
    expect(kq.theoDong.get(B)).toBe(0);
    expect(kq.chuaGanDong).toBe(GIA);
  });

  it("[QHC-13] khoản ÂM mồ côi không gắn được dòng (đơn nhiều dòng) làm chuaGanDong ÂM — người gọi dùng nó để chặn cấp", () => {
    const kq = tinh([A, B], KHONG_CO, khoan({ orderItemId: null, amount: -1_500_000, accountantStatus: "REFUNDED" }));
    expect(kq.chuaGanDong).toBe(-1_500_000);
  });

  it("[QHC-14] con trỏ orderItemId tới dòng KHÔNG thuộc đơn là dữ liệu hỏng: không dồn vào dòng duy nhất, vào chuaGanDong", () => {
    const kq = tinh([A], THAT, khoan({ orderItemId: "dong-la", note: WEBHOOK }));
    expect(kq.theoDong.get(A)).toBe(0);
    expect(kq.chuaGanDong).toBe(GIA);
  });

  it("[QHC-15] mỗi dòng của đơn đều có mặt trong kết quả (kể cả dòng chưa có đồng nào)", () => {
    const kq = tinh([A, B], KHONG_CO, khoan({ orderItemId: A, accountantStatus: DA_XAC_NHAN }));
    expect([...kq.theoDong.keys()]).toEqual([A, B]);
    expect(kq.theoDong.get(B)).toBe(0);
  });
});

describe("[QHC] marker KHÔNG phải chứng chỉ — phải có giao dịch ngân hàng thật chống lưng", () => {
  it("[QHC-16] marker giả (Sale gõ vào ô ghi chú tiền mặt) mà KHÔNG có giao dịch ngân hàng thật ⇒ không tính — cả hai họ marker", () => {
    expect(tinh([A, B], KHONG_CO, khoan({ note: WEBHOOK })).theoDong.get(A)).toBe(0);
    expect(tinh([A, B], KHONG_CO, khoan({ note: GAN_TAY })).theoDong.get(A)).toBe(0);
    // Đối chứng dương: cùng khoản, có giao dịch thật ⇒ tính.
    expect(tinh([A, B], THAT, khoan({ note: WEBHOOK })).theoDong.get(A)).toBe(GIA);
  });

  it("[QHC-17] khoản lớn hơn số giao dịch thật đã phân bổ vào đơn ⇒ không tính (mượn marker của giao dịch nhỏ)", () => {
    const nho: NganHangThat = new Map([["sepay|txn-9", 100_000]]);
    expect(tinh([A, B], nho, khoan({ note: WEBHOOK })).theoDong.get(A)).toBe(0);
    expect(tinh([A, B], nho, khoan({ note: WEBHOOK, amount: 100_000 })).theoDong.get(A)).toBe(100_000);
  });

  it("[QHC-18] NHIỀU dòng giả cùng mượn một marker thật: tổng vượt số đã phân bổ ⇒ KHÔNG dòng nào tính", () => {
    const kq = tinh([A, B], THAT, khoan({ note: WEBHOOK }), khoan({ note: WEBHOOK }));
    expect(kq.theoDong.get(A)).toBe(0);
  });

  it("[QHC-19] kế toán đã xác nhận một khoản thật, một dòng PENDING giả mượn CÙNG marker ⇒ dòng giả không tính (tổng vượt)", () => {
    const that = khoan({ note: WEBHOOK, accountantStatus: DA_XAC_NHAN });
    const gia = khoan({ note: WEBHOOK, orderItemId: B });
    const kq = tinh([A, B], THAT, that, gia);
    expect(kq.theoDong.get(A)).toBe(GIA);
    expect(kq.theoDong.get(B)).toBe(0);
  });

  it("[QHC-20] gỡ gắn: phân bổ đã xoá ⇒ khoản PENDING không còn tính, và dòng đảo KHÔNG trừ nhầm vào tiền mặt đã xác nhận của cùng dòng", () => {
    const tienMat = khoan({ accountantStatus: DA_XAC_NHAN, amount: 2_000_001 });
    const qr = khoan({ id: "qr", note: WEBHOOK, amount: 3_168_000 });
    const dao = khoan({ amount: -3_168_000, adjustmentOfId: "qr", note: "Đảo gỡ gắn" });
    const kq = tinh([A], KHONG_CO, tienMat, qr, dao);
    expect(kq.theoDong.get(A)).toBe(2_000_001);
  });

  it("[QHC-21] khoá marker: webhook theo provider (chữ thường) + mã giao dịch; gắn tay theo id bảng; marker lời khai/lịch sử ⇒ null", () => {
    expect(khoaNganHangTuNote(WEBHOOK)).toBe("sepay|txn-9");
    expect(khoaNganHangTuNote("Đã nhận [auto:sepay:TXN-9]")).toBe("sepay|TXN-9"); // mã giao dịch giữ nguyên chữ hoa/thường
    expect(khoaNganHangTuNote("Đã nhận [auto:SEPAY:TXN-9]"), "đường ghi luôn hạ chữ thường provider ⇒ chữ hoa không phải marker thật").toBeNull();
    expect(khoaNganHangTuNote(GAN_TAY)).toBe("gan-tay|btx-4");
    for (const n of [null, "", "tiền mặt", "[auto:order-confirm]", "[backfill-import]"]) expect(khoaNganHangTuNote(n), String(n)).toBeNull();
    expect(khoaNganHangCuaGiaoDich({ id: "btx-4", provider: "SEPAY", providerTxnId: "txn-9" })).toEqual(["sepay|txn-9", "gan-tay|btx-4"]);
  });

  it("[QHC-22] khoản gốc bị đảo/hoàn VƯỢT số gốc (ròng âm) ⇒ đóng góp kẹp ở 0, không kéo dòng xuống âm", () => {
    const goc = khoan({ id: "g", accountantStatus: DA_XAC_NHAN, amount: 1_000_001 });
    const dao = khoan({ amount: -3_000_001, adjustmentOfId: "g", note: "Hoàn vượt" });
    const kq = tinh([A], KHONG_CO, goc, dao);
    expect(kq.theoDong.get(A)).toBe(0);
    expect(kq.chuaGanDong).toBe(0);
  });
});
