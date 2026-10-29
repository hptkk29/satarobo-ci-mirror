// [WCB-*] — LÕI THUẦN của PHASE C-B «chuẩn hoá giá ghi danh 16 đơn khoá học legacy» (`wave-c-sua-gia-ghi-danh.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Ánh xạ yêu cầu owner (25/10/2026, WAVE C-B) → ca:
//   16 ghi danh (14 B + 2 C), `listPrice` chỉ đọc ⇒ [WCB-01..03] [WCB-10]   |   ngoại lệ listPrice: nguồn giá DUY NHẤT, bất biến ⇒ [WCB-30..36]   |   snapshot hiện tại = audit ⇒ [WCB-21..23]
//   bằng chứng giảm giá HIGH (ORDER / ITEM) ⇒ [WCB-11..17]   |   Order tổng = giá đích ⇒ [WCB-12]   |   CONFIRMED Payment tổng = final, bank MATCHED ⇒ [WCB-18..20]
//   không học bổng / chỉnh tay ⇒ [WCB-22]   |   dòng ký ràng giá TRƯỚC/SAU + chế độ ghi listPrice ⇒ [WCB-50..52]   |   FAKE_DEBT trước/sau ⇒ [WCB-40..42]   |   fail-closed / chạy lại ⇒ [WCB-60..63]
import { describe, expect, it } from "vitest";
import {
  BANG_WAVE_C_B,
  KHUON_DONG_WAVE_C_B,
  MA_DON_WAVE_C_B,
  dongDauRaWaveCB,
  giaDichWaveCB,
  lapKeHoachWaveCB,
  type DuLieuWaveCB,
  type MucWaveCB,
} from "./wave-c-sua-gia-ghi-danh";

// Không gõ nguyên văn cặp «trạng thái bán hàng = đã ghi nhận» / «trạng thái kế toán = đã xác nhận» dạng thuộc tính: lưới [BUOC-4b] + [BUOC-6] quét CẢ cây lib/ (kể cả chú thích) để bắt điều kiện tự gõ lại (xem lib/finance/ghi-nhan.ts, debt.ts).
const DA_GHI = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";
const LIST = 10_560_000;
const FINAL = 8_976_000;
const GIAM = 1_584_000;
const NGAY_DON = new Date("2026-10-10T00:00:00Z");
const NGAY_GIA = new Date("2026-08-04T00:00:00Z");
const LEGACY = { listPrice: LIST, discountType: null, discountAmount: 0, tuition: LIST, finalPrice: LIST };
const DICH = giaDichWaveCB(LIST, 15);

const mucOrder = (o: Partial<MucWaveCB> = {}): MucWaveCB => ({ listPrice: LIST, phanTram: 15, nguon: "ORDER", tongDon: FINAL, truoc: LEGACY, ...o });
const mucItem = (o: Partial<MucWaveCB> = {}): MucWaveCB => mucOrder({ nguon: "ITEM", ...o });

type Moi = Partial<{
  don: Partial<DuLieuWaveCB["don"]>;
  dong: Partial<DuLieuWaveCB["don"]["items"][number]>;
  ge: Partial<NonNullable<DuLieuWaveCB["ghiDanh"]>> | null;
  gia: Partial<NonNullable<DuLieuWaveCB["ghiDanh"]>["gia"]>;
  khoa: DuLieuWaveCB["khoa"];
  khoan: Partial<DuLieuWaveCB["paymentSong"][number]>[];
  phanBo: number;
}>;

function du(code: string, nguon: "ORDER" | "ITEM", moi: Moi = {}): DuLieuWaveCB {
  const dong = {
    id: "it1", type: "COURSE_ENROLLMENT", studentId: "s1", enrollmentId: "e1", metadata: { courseId: "k1" }, quantity: 1, unitPrice: LIST, totalPrice: LIST,
    discountAmount: nguon === "ITEM" ? GIAM : 0, discountPercent: nguon === "ITEM" ? 15 : null,
    discounts: nguon === "ITEM" ? [{ kieu: "PHAN_TRAM", phanTram: 15, giam: GIAM, vuotTran: false, lyDo: "CS" }] : [],
    ...moi.dong,
  };
  return {
    don: {
      id: "o1", code, type: "COURSE", deletedAt: null, createdAt: NGAY_DON, studentId: "s1", centerId: "cs1", subtotal: LIST, discountAmount: GIAM,
      discountPercent: nguon === "ORDER" ? 15 : null, totalAmount: FINAL, discountApprovalStatus: nguon === "ORDER" ? "APPROVED" : null, items: [dong], ...moi.don,
    },
    ghiDanh: moi.ge === null ? null : { id: "e1", studentId: "s1", courseId: "k1", status: "ACTIVE", centerId: "cs1", deletedAt: null, gia: { ...LEGACY, ...moi.gia }, ...moi.ge },
    khoa: moi.khoa === undefined ? { id: "k1", price: LIST, updatedAt: NGAY_GIA } : moi.khoa,
    paymentSong: (moi.khoan ?? [{}]).map((p, i) => ({ id: `p${i + 1}`, amount: FINAL, paymentType: "PAYMENT", saleStatus: DA_GHI, accountantStatus: DA_XAC_NHAN, adjustmentOfId: null, enrollmentId: "e1", centerId: "cs1", ...p })),
    tongPhanBoNganHang: moi.phanBo ?? FINAL,
  };
}

const MA1 = "ORD-T-1";
const mot = (muc: MucWaveCB, d: DuLieuWaveCB) => lapKeHoachWaveCB({ bang: { [d.don.code]: muc }, du: [d] });
const maLoi = (k: ReturnType<typeof lapKeHoachWaveCB>) => k.loi.map((x) => x.ma).sort();

describe("[WCB] bảng phạm vi cứng", () => {
  it("[WCB-01] đúng 15 mã đơn duy nhất (ORD-261013-000001 đã loại — chuyển lớp sau C-A); đúng 1 ngoại lệ ghiListPrice; 9 nguồn ORDER + 6 nguồn ITEM", () => {
    expect(MA_DON_WAVE_C_B).toHaveLength(15);
    expect(new Set(MA_DON_WAVE_C_B).size).toBe(15);
    expect(MA_DON_WAVE_C_B).not.toContain("ORD-261013-000001");
    for (const m of MA_DON_WAVE_C_B) expect(m).toMatch(/^ORD-\d{6}-\d{6}$/);
    const v = Object.values(BANG_WAVE_C_B);
    expect(v.filter((m) => m.ghiListPrice === true)).toHaveLength(1);
    expect(v.filter((m) => m.nguon === "ORDER")).toHaveLength(9);
    expect(v.filter((m) => m.nguon === "ITEM")).toHaveLength(6);
  });

  it("[WCB-02] bảng tự nhất quán: giá đích tính bằng computeEnrollmentPrice = tongDon; listPrice của snapshot = giá niêm yết (trừ ngoại lệ có snapshot NULL)", () => {
    for (const [code, m] of Object.entries(BANG_WAVE_C_B)) {
      const d = giaDichWaveCB(m.listPrice, m.phanTram);
      expect(d.finalPrice, code).toBe(m.tongDon);
      expect(d.tuition, code).toBe(d.finalPrice);
      expect(d.discountType, code).toBe("PERCENT");
      if (m.ghiListPrice === true) {
        expect(m.truoc, code).toEqual({ listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null });
      } else {
        expect(m.truoc, code).toEqual({ listPrice: m.listPrice, discountType: null, discountAmount: 0, tuition: m.listPrice, finalPrice: m.listPrice });
      }
    }
  });

  it("[WCB-03] bảng KHÔNG chứa định danh: chỉ giá, %, nguồn bằng chứng, snapshot; phần trăm chỉ 15 hoặc 25; đúng 1 đơn 25% (chính sách cũ)", () => {
    for (const m of Object.values(BANG_WAVE_C_B)) {
      expect(Object.keys(m).sort()).toEqual(Object.keys(m).includes("ghiListPrice") ? ["ghiListPrice", "listPrice", "nguon", "phanTram", "tongDon", "truoc"] : ["listPrice", "nguon", "phanTram", "tongDon", "truoc"]);
      expect([15, 25]).toContain(m.phanTram);
    }
    expect(Object.values(BANG_WAVE_C_B).filter((m) => m.phanTram === 25)).toHaveLength(1);
  });

  it("[WCB-10] giá đích: 15% của 10.560.000 = 1.584.000 → 8.976.000; 25% của 11.520.000 → 8.640.000; tuition = finalPrice; listPrice KHÔNG đổi", () => {
    expect(giaDichWaveCB(10_560_000, 15)).toEqual({ listPrice: 10_560_000, discountType: "PERCENT", discountAmount: 1_584_000, tuition: 8_976_000, finalPrice: 8_976_000 });
    expect(giaDichWaveCB(11_520_000, 25)).toMatchObject({ discountAmount: 2_880_000, finalPrice: 8_640_000, tuition: 8_640_000 });
  });
});

describe("[WCB] một ghi danh — đối chứng dương + bằng chứng giảm giá", () => {
  it("[WCB-00a] ĐỐI CHỨNG DƯƠNG nguồn ORDER: ghi 4 cột về giá đích, listPrice giữ nguyên, không lỗi", () => {
    const k = mot(mucOrder(), du(MA1, "ORDER"));
    expect(k.loi).toEqual([]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]).toMatchObject({ enrollmentId: "e1", truoc: LEGACY, sau: DICH, ghiListPrice: false });
    expect(k.ghi[0]!.sau.listPrice).toBe(LIST);
  });

  it("[WCB-00b] ĐỐI CHỨNG DƯƠNG nguồn ITEM (Order.discountPercent NULL, không duyệt): hợp lệ, KHÔNG đòi discountApprovalStatus = APPROVED", () => {
    const k = mot(mucItem(), du(MA1, "ITEM"));
    expect(k.loi).toEqual([]);
    expect(k.ghi).toHaveLength(1);
  });

  it("[WCB-11] nguồn ORDER: thiếu APPROVED ⇒ GIAM_GIA_CHUA_DUYET; sai % ⇒ PHAN_TRAM_DON_LECH; bị từ chối ⇒ GIAM_GIA_BI_TU_CHOI", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { discountApprovalStatus: "PENDING_APPROVAL" } })))).toContain("GIAM_GIA_CHUA_DUYET");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { discountApprovalStatus: null } })))).toContain("GIAM_GIA_CHUA_DUYET");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { discountPercent: 14 } })))).toContain("PHAN_TRAM_DON_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { discountApprovalStatus: "REJECTED" } })))).toContain("GIAM_GIA_BI_TU_CHOI");
  });

  it("[WCB-12] Order tổng ≠ giá đích / giảm ≠ giảm đích / niêm yết ≠ bảng ⇒ dừng (đơn đã trôi)", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { totalAmount: FINAL - 1 } })))).toContain("TONG_DON_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { discountAmount: GIAM - 1 } })))).toContain("GIAM_GIA_DON_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { subtotal: LIST + 1 } })))).toContain("NIEM_YET_LECH");
  });

  it("[WCB-13] nguồn ITEM: bản ghi PHAN_TRAM sai % / sai số tiền / vượt trần / hai bản ghi / không có bản ghi ⇒ BANG_CHUNG_ITEM_LECH (không cho qua bằng suy từ tổng)", () => {
    const bg = (o: Record<string, unknown>) => [{ kieu: "PHAN_TRAM", phanTram: 15, giam: GIAM, vuotTran: false, ...o }];
    for (const [ten, discounts] of [
      ["sai %", bg({ phanTram: 14 })],
      ["sai số tiền", bg({ giam: GIAM - 1 })],
      ["vượt trần", bg({ vuotTran: true })],
      ["kiểu khác", bg({ kieu: "SO_TIEN" })],
      ["hai bản ghi", [...bg({}), ...bg({})]],
      ["không có bản ghi", []],
      ["không phải mảng", null],
    ] as const) {
      expect(maLoi(mot(mucItem(), du(MA1, "ITEM", { dong: { discounts } }))), ten).toContain("BANG_CHUNG_ITEM_LECH");
    }
    expect(maLoi(mot(mucItem(), du(MA1, "ITEM", { dong: { discountAmount: 0 } })))).toContain("BANG_CHUNG_ITEM_LECH");
    expect(maLoi(mot(mucItem(), du(MA1, "ITEM", { dong: { discountPercent: 10 } })))).toContain("BANG_CHUNG_ITEM_LECH");
  });

  it("[WCB-14] nguồn ITEM: Order.discountPercent khác % ⇒ PHAN_TRAM_DON_LECH; trạng thái duyệt PENDING/REJECTED ⇒ dừng (NULL hoặc APPROVED thì qua)", () => {
    expect(maLoi(mot(mucItem(), du(MA1, "ITEM", { don: { discountPercent: 10 } })))).toContain("PHAN_TRAM_DON_LECH");
    expect(maLoi(mot(mucItem(), du(MA1, "ITEM", { don: { discountApprovalStatus: "PENDING_APPROVAL" } })))).toContain("GIAM_GIA_CHUA_DUYET");
    expect(mot(mucItem(), du(MA1, "ITEM", { don: { discountApprovalStatus: "APPROVED" } })).loi).toEqual([]);
  });

  it("[WCB-15] bảng khai nguồn ITEM nhưng đơn chỉ có bằng chứng ORDER (không có bản ghi cấu trúc) ⇒ dừng — nguồn khai trong bảng là nguồn DUY NHẤT được chấp nhận", () => {
    expect(maLoi(mot(mucItem(), du(MA1, "ORDER")))).toContain("BANG_CHUNG_ITEM_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ITEM")))).toEqual(expect.arrayContaining(["PHAN_TRAM_DON_LECH", "GIAM_GIA_CHUA_DUYET"]));
  });

  it("[WCB-16] bảng không nhất quán (tongDon ≠ giá đích tính được) ⇒ BANG_KHONG_NHAT_QUAN — lỗi cấu hình bị bắt ở lõi, không chỉ ở test", () => {
    expect(maLoi(mot(mucOrder({ tongDon: FINAL + 1 }), du(MA1, "ORDER")))).toContain("BANG_KHONG_NHAT_QUAN");
    expect(maLoi(mot(mucOrder({ truoc: { ...LEGACY, listPrice: LIST + 1 } }), du(MA1, "ORDER")))).toContain("BANG_KHONG_NHAT_QUAN");
  });

  it("[WCB-17] 25% chính sách cũ (nhóm C): giá đích 8.640.000 trên niêm yết 11.520.000", () => {
    const L = 11_520_000;
    const F = 8_640_000;
    const muc = mucOrder({ listPrice: L, phanTram: 25, tongDon: F, truoc: { ...LEGACY, listPrice: L, tuition: L, finalPrice: L } });
    const d = du(MA1, "ORDER", {
      don: { subtotal: L, discountAmount: 2_880_000, discountPercent: 25, totalAmount: F },
      dong: { unitPrice: L, totalPrice: L },
      gia: { listPrice: L, tuition: L, finalPrice: L },
      khoan: [{ amount: F, enrollmentId: null }],
      phanBo: F,
    });
    const k = mot(muc, d);
    expect(k.loi).toEqual([]);
    expect(k.ghi[0]!.sau).toMatchObject({ discountAmount: 2_880_000, finalPrice: F, tuition: F, listPrice: L });
  });
});

describe("[WCB] tiền và định danh", () => {
  it("[WCB-18] Payment sống: tổng ≠ giá đích (thiếu hoặc thừa) ⇒ TIEN_PAYMENT_LECH — đơn phải đóng ĐỦ", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ amount: FINAL - 1 }] })))).toContain("TIEN_PAYMENT_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ amount: FINAL }, { amount: 1 }] })))).toContain("TIEN_PAYMENT_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [] })))).toEqual(expect.arrayContaining(["KHONG_CO_PAYMENT", "TIEN_PAYMENT_LECH"]));
  });

  it("[WCB-19] khoản không phải PAYMENT/RECORDED/CONFIRMED hoặc là bút toán điều chỉnh ⇒ PAYMENT_KHONG_HOP_LE; phân bổ ngân hàng ≠ giá đích ⇒ TIEN_PHAN_BO_LECH", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ accountantStatus: "PENDING" }] })))).toContain("PAYMENT_KHONG_HOP_LE");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ accountantStatus: "REJECTED" }] })))).toContain("PAYMENT_KHONG_HOP_LE");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ saleStatus: "DRAFT" }] })))).toContain("PAYMENT_KHONG_HOP_LE");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ paymentType: "REFUND" }] })))).toContain("PAYMENT_KHONG_HOP_LE");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ adjustmentOfId: "px" }] })))).toContain("PAYMENT_KHONG_HOP_LE");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { phanBo: FINAL - 1 })))).toContain("TIEN_PHAN_BO_LECH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { phanBo: 0 })))).toContain("TIEN_PHAN_BO_LECH");
  });

  it("[WCB-20] khoản đã gắn MỘT GHI DANH KHÁC ⇒ PAYMENT_GAN_SAI_GHI_DANH; khoản chưa gắn (nhóm C) hoặc gắn đúng thì qua", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ enrollmentId: "e-khac" }] })))).toContain("PAYMENT_GAN_SAI_GHI_DANH");
    expect(mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ enrollmentId: null }] })).loi).toEqual([]);
  });

  it("[WCB-21] C-A chưa xong (dòng đơn / đơn thiếu học viên hoặc ghi danh) ⇒ DON_CHUA_GAN_DANH_TINH", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { dong: { enrollmentId: null }, ge: null })))).toContain("DON_CHUA_GAN_DANH_TINH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { dong: { studentId: null } })))).toContain("DON_CHUA_GAN_DANH_TINH");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { studentId: null } })))).toContain("DON_CHUA_GAN_DANH_TINH");
  });

  it("[WCB-22] HỌC BỔNG / chỉnh tay (discountType khác NULL ở snapshot hiện tại) hoặc giá đã bị đổi tay ⇒ GIA_TROI, không đè", () => {
    for (const gia of [{ discountType: "SCHOLARSHIP", discountAmount: LIST, tuition: 0, finalPrice: 0 }, { finalPrice: LIST - 1 }, { discountAmount: 1 }, { tuition: LIST - 1 }, { listPrice: LIST + 1 }]) {
      const k = mot(mucOrder(), du(MA1, "ORDER", { gia }));
      expect(maLoi(k), JSON.stringify(gia)).toContain("GIA_TROI");
      expect(k.ghi).toEqual([]);
    }
  });

  it("[WCB-23] ghi danh khác học viên / khác khoá / khác cơ sở / đã xoá / đã huỷ ⇒ dừng", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { ge: { studentId: "s-khac" } })))).toContain("GHI_DANH_LECH_HOC_VIEN");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { ge: { courseId: "k-khac" } })))).toContain("GHI_DANH_LECH_KHOA");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { ge: { centerId: "cs2" } })))).toContain("GHI_DANH_LECH_CO_SO");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { ge: { deletedAt: new Date() } })))).toContain("GHI_DANH_DA_XOA");
    for (const st of ["CANCELLED", "WITHDREW", "TRANSFERRED"]) expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { ge: { status: st } }))), st).toContain("GHI_DANH_KHONG_HIEU_LUC");
    // trạng thái STUDYING (đơn thật 261017) là hiệu lực
    expect(mot(mucOrder(), du(MA1, "ORDER", { ge: { status: "STUDYING" } })).loi).toEqual([]);
  });

  it("[WCB-24] đơn xoá mềm / không COURSE / nhiều dòng ⇒ dừng", () => {
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { deletedAt: new Date() } })))).toContain("DON_DA_XOA");
    expect(maLoi(mot(mucOrder(), du(MA1, "ORDER", { don: { type: "PRODUCT" } })))).toContain("DON_KHONG_PHAI_KHOA_HOC");
    const d = du(MA1, "ORDER");
    const hai = { ...d, don: { ...d.don, items: [...d.don.items, { ...d.don.items[0]!, id: "it2" }] } };
    expect(maLoi(mot(mucOrder(), hai))).toContain("SO_DONG_KHONG_DUNG");
  });
});

describe("[WCB] ngoại lệ listPrice — nguồn giá duy nhất, bất biến", () => {
  const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
  const muc = () => mucItem({ truoc: TRONG, ghiListPrice: true });
  const dac = (moi: Moi = {}) => du(MA1, "ITEM", { gia: TRONG, khoan: [{ enrollmentId: "e1" }], ...moi, ge: { status: "STUDYING", ...(moi.ge ?? {}) } });

  it("[WCB-30] ĐỐI CHỨNG DƯƠNG: năm cột NULL + nguồn giá đủ ⇒ ghi cả listPrice; dòng ký mang cờ GHI_LIST", () => {
    const k = mot(muc(), dac());
    expect(k.loi).toEqual([]);
    expect(k.ghi[0]).toMatchObject({ ghiListPrice: true, truoc: TRONG, sau: DICH });
    expect(k.dongDauRa[0]).toContain("|GHI_LIST");
  });

  it("[WCB-31] giá khoá HIỆN TẠI khác giá niêm yết ⇒ NGUON_NIEM_YET_KHONG_DU (khoá có thể đã đổi giá)", () => {
    expect(maLoi(mot(muc(), dac({ khoa: { id: "k1", price: LIST + 1, updatedAt: NGAY_GIA } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
  });

  it("[WCB-32] giá khoá được sửa SAU khi tạo đơn (updatedAt ≥ createdAt) ⇒ KHÔNG chứng minh được bất biến ⇒ dừng", () => {
    expect(maLoi(mot(muc(), dac({ khoa: { id: "k1", price: LIST, updatedAt: NGAY_DON } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
    expect(maLoi(mot(muc(), dac({ khoa: { id: "k1", price: LIST, updatedAt: new Date(NGAY_DON.getTime() + 1000) } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
  });

  it("[WCB-33] không đọc được khoá / OrderItem.unitPrice ≠ giá / số lượng ≠ 1 / thành tiền ≠ giá / Order.subtotal ≠ giá ⇒ dừng", () => {
    expect(maLoi(mot(muc(), dac({ khoa: null })))).toContain("NGUON_NIEM_YET_KHONG_DU");
    expect(maLoi(mot(muc(), dac({ dong: { unitPrice: LIST - 1 } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
    expect(maLoi(mot(muc(), dac({ dong: { quantity: 2 } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
    expect(maLoi(mot(muc(), dac({ dong: { totalPrice: LIST - 1 } })))).toContain("NGUON_NIEM_YET_KHONG_DU");
    expect(maLoi(mot(muc(), dac({ don: { subtotal: LIST - 1 } })))).toEqual(expect.arrayContaining(["NGUON_NIEM_YET_KHONG_DU", "NIEM_YET_LECH"]));
  });

  it("[WCB-34] đơn KHÔNG khai ghiListPrice mà ghi danh có listPrice NULL ⇒ KHÔNG được ghi listPrice (GIA_TROI): ngoại lệ không lan sang đơn khác", () => {
    const k = mot(mucItem(), du(MA1, "ITEM", { gia: TRONG, ge: { status: "STUDYING" } }));
    expect(maLoi(k)).toContain("GIA_TROI");
    expect(k.ghi).toEqual([]);
  });

  it("[WCB-35] đơn khai ghiListPrice nhưng ghi danh đã có giá ĐÚNG snapshot legacy (không còn NULL) ⇒ GIA_TROI — không đoán, dừng", () => {
    expect(maLoi(mot(muc(), dac({ gia: LEGACY })))).toContain("GIA_TROI");
  });

  it("[WCB-36] sau khi ghi (giá đích đầy đủ kể cả listPrice) chạy lại ⇒ «DA_SUA», 0 dòng ghi", () => {
    const k = mot(muc(), dac({ gia: DICH }));
    expect(k.loi).toEqual([]);
    expect(k.muc[0]!.trangThai).toBe("DA_SUA");
    expect(k.ghi).toEqual([]);
  });
});

describe("[WCB] công nợ giả (báo cáo FAKE_DEBT)", () => {
  it("[WCB-40] đơn đã gắn khoản (nhóm B): nợ hiện tại = giảm 15% (nợ giả), nợ sau C-B = 0", () => {
    const k = mot(mucOrder(), du(MA1, "ORDER"));
    expect(k.muc[0]).toMatchObject({ noHienTai: GIAM, noSauSua: 0, noDuKien: 0 });
    expect(k.noGiaTruoc).toBe(GIAM);
    expect(k.noGiaSau).toBe(0);
  });

  it("[WCB-41] đơn nhóm C chưa gắn khoản: nợ hiện tại = cả học phí legacy, nợ sau C-B = cả học phí đích (đến khi C-C gắn), nợ dự kiến nếu gắn = 0", () => {
    const k = mot(mucOrder(), du(MA1, "ORDER", { khoan: [{ enrollmentId: null }] }));
    expect(k.muc[0]).toMatchObject({ noHienTai: LIST, noSauSua: FINAL, noDuKien: 0 });
  });

  it("[WCB-42] ghi danh NULL giá (261017): nợ hiện tại coi là 0 như hệ thống đang làm; nợ sau C-B = 0 khi khoản đã gắn", () => {
    const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
    const k = mot(mucItem({ truoc: TRONG, ghiListPrice: true }), du(MA1, "ITEM", { gia: TRONG, ge: { status: "STUDYING" } }));
    expect(k.muc[0]).toMatchObject({ noHienTai: 0, noSauSua: 0 });
  });
});

describe("[WCB] dòng ký + cả lô", () => {
  it("[WCB-50] dòng ký có khuôn + id đơn/ghi danh + giá TRƯỚC và SAU + chế độ listPrice; không chứa tên/SĐT/email", () => {
    const k = mot(mucOrder(), du(MA1, "ORDER"));
    expect(k.dongDauRa).toEqual([`${KHUON_DONG_WAVE_C_B}|o1|${MA1}|e1|10560000/NULL/0/10560000/10560000|10560000/PERCENT/1584000/8976000/8976000|CHI_DOC_LIST`]);
    expect(dongDauRaWaveCB(k.ghi)).toEqual(k.dongDauRa);
  });

  it("[WCB-51] đổi giá SAU hay chế độ listPrice đổi dòng ký ⇒ chữ ký cho «chỉ đọc listPrice» không dùng được cho «ghi listPrice»", () => {
    const a = dongDauRaWaveCB([{ orderId: "o", code: "c", enrollmentId: "e", truoc: LEGACY, sau: DICH, ghiListPrice: false }]);
    const b = dongDauRaWaveCB([{ orderId: "o", code: "c", enrollmentId: "e", truoc: LEGACY, sau: DICH, ghiListPrice: true }]);
    const c = dongDauRaWaveCB([{ orderId: "o", code: "c", enrollmentId: "e", truoc: LEGACY, sau: { ...DICH, finalPrice: DICH.finalPrice! + 1 }, ghiListPrice: false }]);
    expect(new Set([a[0], b[0], c[0]]).size).toBe(3);
  });

  it("[WCB-60] FAIL-CLOSED: MỘT đơn lệch ⇒ KHÔNG ghi danh nào được ghi; đối chứng dương cùng cặp sạch ⇒ ghi cả hai", () => {
    const a = du("ORD-T-1", "ORDER");
    const b = du("ORD-T-2", "ORDER", { don: { id: "o2" }, dong: { id: "it2", enrollmentId: "e2", studentId: "s2" }, ge: { id: "e2", studentId: "s2" }, khoan: [{ id: "q1", enrollmentId: "e2" }] });
    const bb = { ...b, don: { ...b.don, studentId: "s2" } };
    const bang = { "ORD-T-1": mucOrder(), "ORD-T-2": mucOrder() };
    expect(lapKeHoachWaveCB({ bang, du: [a, bb] }).ghi).toHaveLength(2);
    const xau = { ...bb, don: { ...bb.don, totalAmount: FINAL + 5 } };
    const k = lapKeHoachWaveCB({ bang, du: [a, xau] });
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
  });

  it("[WCB-61] LÔ LAI (một ghi danh đã ở giá đích, một chưa) ⇒ LO_HON_HOP", () => {
    const a = du("ORD-T-1", "ORDER", { gia: DICH });
    const b = du("ORD-T-2", "ORDER", { don: { id: "o2", studentId: "s2" }, dong: { id: "it2", enrollmentId: "e2", studentId: "s2" }, ge: { id: "e2", studentId: "s2" }, khoan: [{ id: "q1", enrollmentId: "e2" }] });
    const k = lapKeHoachWaveCB({ bang: { "ORD-T-1": mucOrder(), "ORD-T-2": mucOrder() }, du: [a, b] });
    expect(maLoi(k)).toEqual(["LO_HON_HOP"]);
    expect(k.ghi).toEqual([]);
  });

  it("[WCB-62] CHẠY LẠI: cả lô đã ở giá đích ⇒ daSuaHet, 0 dòng ghi", () => {
    const k = mot(mucOrder(), du(MA1, "ORDER", { gia: DICH }));
    expect(k.loi).toEqual([]);
    expect(k.daSuaHet).toBe(true);
    expect(k.ghi).toEqual([]);
  });

  it("[WCB-63] thiếu đơn / thừa đơn ngoài phạm vi / hai đơn cùng ghi danh ⇒ dừng", () => {
    const a = du("ORD-T-1", "ORDER");
    expect(maLoi(lapKeHoachWaveCB({ bang: { "ORD-T-1": mucOrder(), "ORD-T-2": mucOrder() }, du: [a] }))).toContain("THIEU_DON");
    expect(maLoi(lapKeHoachWaveCB({ bang: { "ORD-T-1": mucOrder() }, du: [a, du("ORD-NGOAI", "ORDER")] }))).toContain("KHONG_CO_MUC_TIEU");
    const b = du("ORD-T-2", "ORDER", { don: { id: "o2" }, dong: { id: "it2" } });
    expect(maLoi(lapKeHoachWaveCB({ bang: { "ORD-T-1": mucOrder(), "ORD-T-2": mucOrder() }, du: [a, b] }))).toContain("TRUNG_GHI_DANH");
  });
});
