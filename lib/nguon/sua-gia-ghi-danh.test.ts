// [SGG-*] — LÕI THUẦN «chuẩn hoá giá ghi danh cho 6 đơn sống» (PHASE B.1). Không DB. Mỗi ca đỏ vì ĐÚNG MỘT lý do (đối chứng dương ở [SGG-01]).
// Fixture mang HÌNH DẠNG DỮ LIỆU THẬT của prod 24/10/2026: ghi danh còn giá legacy (10.560.000, không giảm) trong khi đơn đã duyệt giảm 15% còn 8.976.000; riêng 000006 mang SCHOLARSHIP / 0đ.
import { describe, expect, it } from "vitest";
import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import { MA_DON_GAN_DANH_TINH } from "./gan-danh-tinh-don";
import {
  BANG_SUA_GIA,
  LY_DO_SUA_GIA,
  MA_DON_SUA_GIA,
  PHAN_TRAM_GIAM,
  dongDauRaSuaGia,
  dungBanGhiLuotSuaGia,
  giaDichTuNiemYet,
  lapKeHoachSuaGia,
  phanTichSoDuyetSuaGia,
  quyetDinhGhiSuaGia,
  type DuLieuSuaGia,
  type GiaGhiDanh,
} from "./sua-gia-ghi-danh";

const KHOA = "khoa-x";

function dungDon(i: number, sua: (d: DuLieuSuaGia) => void = () => undefined): DuLieuSuaGia {
  const code = MA_DON_SUA_GIA[i]!;
  const muc = BANG_SUA_GIA[code]!;
  const dich = giaDichTuNiemYet(muc.listPrice);
  const d: DuLieuSuaGia = {
    don: {
      id: `o${i}`, code, type: "COURSE", deletedAt: null, studentId: `s${i}`, leadChildId: `be${i}`, centerId: "cs1", subtotal: muc.listPrice,
      discountAmount: dich.discountAmount!, discountPercent: 15, totalAmount: dich.finalPrice!, discountApprovalStatus: "APPROVED",
      items: [{ id: `it${i}`, type: "COURSE_ENROLLMENT", studentId: `s${i}`, enrollmentId: `e${i}`, metadata: { courseId: KHOA } }],
    },
    ghiDanh: { id: `e${i}`, studentId: `s${i}`, courseId: KHOA, status: "ACTIVE", leadChildId: `be${i}`, centerId: "cs1", deletedAt: null, gia: { ...muc.truoc } },
    soPaymentSong: 2,
    tongPaymentSong: dich.finalPrice!,
    tongPhanBoNganHang: dich.finalPrice!,
    soPaymentDaGanGhiDanh: 0,
    soHoaHongLienQuan: 0,
  };
  sua(d);
  return d;
}
const lo = (sua: (d: DuLieuSuaGia, i: number) => void = () => undefined) => MA_DON_SUA_GIA.map((_, i) => dungDon(i, (d) => sua(d, i)));
const lap = (du: DuLieuSuaGia[]) => lapKeHoachSuaGia({ bang: BANG_SUA_GIA, du });
const mot = (sua: (d: DuLieuSuaGia) => void) => lo((d, i) => (i === 2 ? sua(d) : undefined));
const CODE2 = MA_DON_SUA_GIA[2]!;
const daDich = (d: DuLieuSuaGia) => {
  d.ghiDanh = { ...d.ghiDanh!, gia: giaDichTuNiemYet(BANG_SUA_GIA[d.don.code]!.listPrice) };
};

describe("[SGG] pricing — hàm chuẩn của hệ thống", () => {
  it("[SGG-00] phạm vi CỨNG: đúng 6 mã (khớp PHASE A), không trùng; giá niêm yết đúng Sata3 10.560.000 / Sata4 11.520.000", () => {
    expect([...MA_DON_SUA_GIA].sort()).toEqual([...MA_DON_GAN_DANH_TINH].sort());
    expect(new Set(MA_DON_SUA_GIA).size).toBe(6);
    expect(BANG_SUA_GIA["ORD-260910-000006"]!.listPrice).toBe(11_520_000);
    for (const c of MA_DON_SUA_GIA.filter((x) => x !== "ORD-260910-000006")) expect(BANG_SUA_GIA[c]!.listPrice, c).toBe(10_560_000);
  });

  it("[SGG-P1] giá đích theo owner: Sata3 10.560.000 → giảm 1.584.000 → 8.976.000; Sata4 11.520.000 → giảm 1.728.000 → 9.792.000; PERCENT; tuition = finalPrice", () => {
    expect(giaDichTuNiemYet(10_560_000)).toEqual({ listPrice: 10_560_000, discountType: "PERCENT", discountAmount: 1_584_000, tuition: 8_976_000, finalPrice: 8_976_000 });
    expect(giaDichTuNiemYet(11_520_000)).toEqual({ listPrice: 11_520_000, discountType: "PERCENT", discountAmount: 1_728_000, tuition: 9_792_000, finalPrice: 9_792_000 });
  });

  it("[SGG-P2] INVARIANT với MỌI giá niêm yết: finalPrice = listPrice − discountAmount, tuition = finalPrice, và trùng đúng `computeEnrollmentPrice` (không logic riêng)", () => {
    for (const lp of [1, 99, 100, 7_777_777, 10_560_000, 11_520_000, 23_040_000]) {
      const g = giaDichTuNiemYet(lp);
      const chuan = computeEnrollmentPrice({ listPrice: lp, discount: { type: "PERCENT", value: PHAN_TRAM_GIAM } });
      expect(g.finalPrice).toBe(lp - g.discountAmount!);
      expect(g.tuition).toBe(g.finalPrice);
      expect(g.discountAmount).toBe(chuan.discountAmount);
      expect(g.finalPrice).toBe(chuan.finalPrice);
      expect(g.discountType).toBe("PERCENT");
    }
  });

  it("[SGG-P3] đích KHÔNG còn mang nghĩa học bổng: discountType ≠ SCHOLARSHIP và finalPrice > 0 ở cả 6 đơn", () => {
    for (const c of MA_DON_SUA_GIA) {
      const g = giaDichTuNiemYet(BANG_SUA_GIA[c]!.listPrice);
      expect(g.discountType, c).toBe("PERCENT");
      expect(g.finalPrice!, c).toBeGreaterThan(0);
    }
  });
});

describe("[SGG] lập kế hoạch", () => {
  it("[SGG-01] ĐỐI CHỨNG DƯƠNG: lô sạch (còn giá legacy) ⇒ SẴN SÀNG GHI 6, không lỗi, nợ dự kiến 0 ở cả 6", () => {
    const kh = lap(lo());
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.daSuaHet).toBe(false);
    expect(kh.ghi).toHaveLength(6);
    expect(kh.muc.every((m) => m.trangThai === "CHUA_SUA" && m.noDuKienSauGan === 0)).toBe(true);
    expect(kh.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[SGG-02] dòng ký ràng cả giá TRƯỚC lẫn SAU, tất định; đổi một giá đích ⇒ sha khác", () => {
    const kh = lap(lo());
    expect(kh.dongDauRa).toEqual(dongDauRaSuaGia(kh.ghi));
    expect(kh.dongDauRa[0]).toBe("sua-gia-ghi-danh/v1|o0|ORD-260831-000001|e0|10560000/NULL/0/10560000/10560000|10560000/PERCENT/1584000/8976000/8976000");
    expect(lap(lo()).sha).toBe(kh.sha);
    const khac = lap(lo((d, i) => { if (i === 0) d.ghiDanh = { ...d.ghiDanh!, id: "e-khac" }; }));
    expect(khac.sha).not.toBe(kh.sha);
  });

  it("[SGG-03] ca SCHOLARSHIP (ORD-260910-000006): SCHOLARSHIP/11.520.000/tuition 0/final 0 ⇒ PERCENT/1.728.000/9.792.000/9.792.000, không còn học bổng", () => {
    const kh = lap(lo());
    const m = kh.muc.find((x) => x.code === "ORD-260910-000006")!;
    expect(m.trangThai).toBe("CHUA_SUA");
    expect(m.dong!.truoc).toEqual({ listPrice: 11_520_000, discountType: "SCHOLARSHIP", discountAmount: 11_520_000, tuition: 0, finalPrice: 0 });
    expect(m.dong!.sau).toEqual({ listPrice: 11_520_000, discountType: "PERCENT", discountAmount: 1_728_000, tuition: 9_792_000, finalPrice: 9_792_000 });
    expect(kh.dongDauRa.find((x) => x.includes("ORD-260910-000006"))).toBe(
      "sua-gia-ghi-danh/v1|o4|ORD-260910-000006|e4|11520000/SCHOLARSHIP/11520000/0/0|11520000/PERCENT/1728000/9792000/9792000",
    );
  });

  it("[SGG-04] IDEMPOTENT: cả 6 đã ở giá đích ⇒ 0 dòng ghi, daSuaHet, không dừng", () => {
    const kh = lap(lo((d) => daDich(d)));
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.daSuaHet).toBe(true);
    expect(kh.ghi).toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
  });

  it("[SGG-05] lô LAI (5 chưa sửa + 1 đã ở giá đích) ⇒ DỪNG cả lô, không dòng ghi nào", () => {
    const kh = lap(lo((d, i) => { if (i === 3) daDich(d); }));
    expect(kh.dung).toBe(true);
    expect(kh.ghi).toEqual([]);
    expect(kh.loi.map((l) => l.ma)).toContain("LO_HON_HOP");
  });

  it("[SGG-06] PRICING DRIFT: MỖI trong 5 cột giá bị đổi khỏi snapshot đã audit (và không phải giá đích) ⇒ GIA_TROI, dừng", () => {
    const doi: Array<[string, (g: GiaGhiDanh) => GiaGhiDanh]> = [
      ["listPrice", (g) => ({ ...g, listPrice: (g.listPrice ?? 0) + 1 })],
      ["discountType", (g) => ({ ...g, discountType: "AMOUNT" })],
      ["discountAmount", (g) => ({ ...g, discountAmount: (g.discountAmount ?? 0) + 1 })],
      ["tuition", (g) => ({ ...g, tuition: (g.tuition ?? 0) + 1 })],
      ["finalPrice", (g) => ({ ...g, finalPrice: (g.finalPrice ?? 0) + 1 })],
    ];
    for (const [cot, f] of doi) {
      const kh = lap(mot((d) => { d.ghiDanh = { ...d.ghiDanh!, gia: f(d.ghiDanh!.gia) }; }));
      expect(kh.dung, cot).toBe(true);
      expect(kh.ghi, cot).toEqual([]);
      expect(kh.loi.map((l) => `${l.code}:${l.ma}`), cot).toContain(`${CODE2}:GIA_TROI`);
    }
  });

  it("[SGG-07] giá hiện tại NULL ở cột nào đó (chưa chốt giá) cũng là trôi, không bị coi là «chưa sửa»", () => {
    const kh = lap(mot((d) => { d.ghiDanh = { ...d.ghiDanh!, gia: { ...d.ghiDanh!.gia, finalPrice: null } }; }));
    expect(kh.loi.map((l) => l.ma)).toContain("GIA_TROI");
  });
});

describe("[SGG] mỗi điều kiện fail-closed — một ghi danh lệch ⇒ DỪNG CẢ LÔ (ghi = [])", () => {
  const CA: Array<[string, string, (d: DuLieuSuaGia) => void]> = [
    ["SGG-10", "DON_DA_XOA", (d) => { d.don.deletedAt = new Date("2026-10-05T12:00:00Z"); }],
    ["SGG-11", "DON_KHONG_PHAI_KHOA_HOC", (d) => { d.don.type = "PRODUCT"; }],
    ["SGG-12", "SO_DONG_KHONG_DUNG", (d) => { d.don.items = []; }],
    ["SGG-13", "SO_DONG_KHONG_DUNG", (d) => { d.don.items = [...d.don.items, { id: "it-them", type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, metadata: { courseId: KHOA } }]; }],
    ["SGG-14", "DON_CHUA_GAN_DANH_TINH", (d) => { d.don.studentId = null; }],
    ["SGG-15", "DON_CHUA_GAN_DANH_TINH", (d) => { d.don.items = [{ ...d.don.items[0]!, enrollmentId: null }]; }],
    ["SGG-16", "DON_CHUA_GAN_DANH_TINH", (d) => { d.ghiDanh = null; }],
    ["SGG-17", "GHI_DANH_DA_XOA", (d) => { d.ghiDanh = { ...d.ghiDanh!, deletedAt: new Date("2026-10-01T00:00:00Z") }; }],
    ["SGG-18", "GHI_DANH_KHONG_ACTIVE", (d) => { d.ghiDanh = { ...d.ghiDanh!, status: "COMPLETED" }; }],
    ["SGG-19", "GHI_DANH_LECH_HOC_VIEN", (d) => { d.ghiDanh = { ...d.ghiDanh!, studentId: "nguoi-khac" }; }],
    ["SGG-20", "GHI_DANH_LECH_KHOA", (d) => { d.ghiDanh = { ...d.ghiDanh!, courseId: "khoa-khac" }; }],
    ["SGG-21", "GHI_DANH_LECH_KHOA", (d) => { d.don.items = [{ ...d.don.items[0]!, metadata: {} }]; }],
    ["SGG-22", "GHI_DANH_LECH_BE", (d) => { d.ghiDanh = { ...d.ghiDanh!, leadChildId: "be-khac" }; }],
    ["SGG-23", "GHI_DANH_LECH_CO_SO", (d) => { d.ghiDanh = { ...d.ghiDanh!, centerId: "cs2" }; }],
    ["SGG-24", "NIEM_YET_LECH", (d) => { d.don.subtotal += 1; }],
    ["SGG-25", "TONG_DON_LECH", (d) => { d.don.totalAmount += 1; d.tongPaymentSong += 1; d.tongPhanBoNganHang += 1; }],
    ["SGG-26", "GIAM_GIA_DON_LECH", (d) => { d.don.discountAmount += 1; }],
    ["SGG-27", "PHAN_TRAM_DON_LECH", (d) => { d.don.discountPercent = 14; }],
    ["SGG-28", "PHAN_TRAM_DON_LECH", (d) => { d.don.discountPercent = null; }],
    ["SGG-29", "GIAM_GIA_CHUA_DUYET", (d) => { d.don.discountApprovalStatus = "PENDING"; }],
    ["SGG-30", "GIAM_GIA_CHUA_DUYET", (d) => { d.don.discountApprovalStatus = null; }],
    ["SGG-31", "KHONG_CO_PAYMENT", (d) => { d.soPaymentSong = 0; d.tongPaymentSong = 0; }],
    ["SGG-32", "TIEN_PAYMENT_LECH", (d) => { d.tongPaymentSong -= 1; }],
    ["SGG-33", "TIEN_PHAN_BO_LECH", (d) => { d.tongPhanBoNganHang += 1; }],
    ["SGG-34", "TIEN_PHAN_BO_LECH", (d) => { d.tongPhanBoNganHang = 0; }],
    ["SGG-35", "PAYMENT_DA_GAN_GHI_DANH", (d) => { d.soPaymentDaGanGhiDanh = 1; }],
    ["SGG-36", "CO_HOA_HONG_LIEN_QUAN", (d) => { d.soHoaHongLienQuan = 1; }],
  ];
  it.each(CA)("[%s] %s", (_id, ma, sua) => {
    const kh = lap(mot(sua));
    expect(kh.dung).toBe(true);
    expect(kh.ghi, "lô dừng ⇒ KHÔNG có dòng ghi nào, kể cả của 5 ghi danh sạch").toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.loi.map((l) => l.ma)).toContain(ma);
    expect(new Set(kh.loi.filter((l) => l.ma === ma).map((l) => l.code))).toEqual(new Set([CODE2]));
    expect(kh.muc.filter((m) => m.loi.length === 0)).toHaveLength(5);
  });

  it("[SGG-37] thiếu hẳn một đơn ⇒ THIEU_DON, dừng", () => {
    const kh = lap(lo().filter((d) => d.don.code !== MA_DON_SUA_GIA[4]));
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => `${l.code}:${l.ma}`)).toContain(`${MA_DON_SUA_GIA[4]}:THIEU_DON`);
  });

  it("[SGG-38] đơn NGOÀI phạm vi lọt vào dữ liệu ⇒ dừng (lõi không tin người nạp)", () => {
    const them = dungDon(0, (d) => { d.don.id = "ngoai"; d.don.code = "ORD-999999-000001"; });
    const kh = lap([...lo(), them]);
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => `${l.code}:${l.ma}`)).toContain("ORD-999999-000001:KHONG_CO_MUC_TIEU");
  });

  it("[SGG-39] hai đơn trỏ cùng một ghi danh ⇒ TRUNG_GHI_DANH, dừng", () => {
    const kh = lap(lo((d, i) => { if (i === 1) { d.ghiDanh = { ...d.ghiDanh!, id: "e0" }; d.don.items = [{ ...d.don.items[0]!, enrollmentId: "e0" }]; } }));
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => l.ma)).toContain("TRUNG_GHI_DANH");
  });

  it("[SGG-40] ĐÃ ở giá đích nhưng đơn lệch (tổng đơn sai) vẫn DỪNG — đã-sửa không phải giấy phép bỏ qua kiểm tra", () => {
    const kh = lap(lo((d, i) => { daDich(d); if (i === 2) d.don.discountApprovalStatus = "PENDING"; }));
    expect(kh.dung).toBe(true);
    expect(kh.daSuaHet).toBe(false);
  });
});

describe("[SGG] cổng số duyệt + bộ phân tích tham số + audit", () => {
  const khOk = lap(lo());
  it("[SGG-50] qua khi đúng N + có quyền; sai N / thiếu quyền / thiếu N / NaN / kế hoạch DỪNG ⇒ từ chối", () => {
    expect(quyetDinhGhiSuaGia({ soDuyet: 6, keHoach: khOk, ghiDuoc: true })).toBeNull();
    expect(quyetDinhGhiSuaGia({ soDuyet: 5, keHoach: khOk, ghiDuoc: true })).toMatch(/≠ kế hoạch/);
    expect(quyetDinhGhiSuaGia({ soDuyet: 6, keHoach: khOk, ghiDuoc: false })).toMatch(/không có quyền UPDATE/);
    expect(quyetDinhGhiSuaGia({ soDuyet: 6, keHoach: khOk, ghiDuoc: null })).toMatch(/Không kiểm được/);
    expect(quyetDinhGhiSuaGia({ soDuyet: null, keHoach: khOk, ghiDuoc: true })).toMatch(/đòi --expect/);
    expect(quyetDinhGhiSuaGia({ soDuyet: Number.NaN, keHoach: khOk, ghiDuoc: true })).toMatch(/số nguyên/);
    expect(quyetDinhGhiSuaGia({ soDuyet: 0, keHoach: lap(mot((d) => { d.don.deletedAt = new Date("2026-10-05T12:00:00Z"); })), ghiDuoc: true })).toMatch(/DỪNG/);
  });
  it("[SGG-51] cả lô đã ở giá đích + N=0 ⇒ qua (0 dòng); N=6 ⇒ từ chối", () => {
    expect(quyetDinhGhiSuaGia({ soDuyet: 0, keHoach: lap(lo((d) => daDich(d))), ghiDuoc: true })).toBeNull();
    expect(quyetDinhGhiSuaGia({ soDuyet: 6, keHoach: lap(lo((d) => daDich(d))), ghiDuoc: true })).toMatch(/≠ kế hoạch/);
  });
  it("[SGG-52] --expect chỉ nhận chữ số thập phân thuần", () => {
    expect(phanTichSoDuyetSuaGia(["--ghi"])).toBeNull();
    expect(phanTichSoDuyetSuaGia(["--expect=6"])).toBe(6);
    for (const xau of ["--expect=", "--expect=0x6", "--expect=6.0", "--expect=1e1", "--expect=-6", "--expect= 6", "--expect=٦", "--expect=99999999999999999999"]) {
      expect(Number.isNaN(phanTichSoDuyetSuaGia([xau]) as number), xau).toBe(true);
    }
  });
  it("[SGG-53] bản ghi audit mức lượt: mốc giờ phải hợp lệ; đủ số duyệt/thực ghi/sha/phần trăm; 4 khoá nguonChay; lý do của owner nguyên văn", () => {
    const luot = { batDauLuc: new Date("2026-10-24T03:00:00Z"), nguonChay: { actor: "a", triggeringActor: "b", runId: "1", runAttempt: "1" } };
    const b = dungBanGhiLuotSuaGia({ luot, soDuyet: 6, keHoach: khOk, daGhi: 6 });
    expect(b).toMatchObject({ cheDo: "APPLY", dryRun: false, expectedCount: 6, actualCount: 6, khop: true, keHoachSha: khOk.sha, phanTramGiam: 15 });
    expect(Object.keys(b.nguonChay as object).sort()).toEqual(["actor", "runAttempt", "runId", "triggeringActor"]);
    expect(() => dungBanGhiLuotSuaGia({ luot: { ...luot, batDauLuc: new Date("x") }, soDuyet: 6, keHoach: khOk, daGhi: 6 })).toThrow(/batDauLuc/);
    expect(LY_DO_SUA_GIA).toBe("Chuẩn hóa giá legacy theo đơn đã duyệt — đóng full khóa học giảm 15%");
  });
});
