import { describe, expect, it } from "vitest";

import { gopTrangThaiHoanDon, LY_DO_RUT_YEU_CAU, trangThaiHoanCuaDong, type YeuCauThoDong } from "./hoan-tien-doc";

/**
 * [HTD] Trạng thái hoàn tiền Online hiển thị cho phụ huynh — luật THUẦN (đồng hồ là tham số: ngày cố định).
 *   [HTD-01] ưu tiên cấp dòng · [HTD-02] «phụ huynh rút» không phải TU_CHOI · [HTD-03] số tiền đã hoàn chỉ tính PAID · [HTD-04] quyền đã thu hồi chỉ khi PAID có dấu
 *   [HTD-05] gộp cấp đơn theo thứ tự chốt (DANG_XET > DA_DUYET > DA_HOAN > MOT_PHAN > TU_CHOI > KHONG) · [HTD-06] đơn nhiều dòng một dòng hoàn hết còn dòng kia chưa ⇒ MOT_PHAN, không DA_HOAN
 */
const NGAY = (n: number) => new Date(Date.UTC(2026, 10, n));
const yc = (status: string, o: Partial<YeuCauThoDong> = {}): YeuCauThoDong => ({ status, lyDoTuChoi: null, createdAt: NGAY(1), approvedAmount: null, quyenDaThuHoiLuc: null, ...o });

describe("[HTD] trạng thái hoàn tiền Online", () => {
  it("[HTD-01] ưu tiên cấp dòng: mở > đã hoàn > từ chối > không", () => {
    const t = (ds: YeuCauThoDong[]) => trangThaiHoanCuaDong({ yeuCau: ds, thucTra: 500_000 }).trangThai;
    expect(t([])).toBe("KHONG");
    expect(t([yc("PENDING")])).toBe("DANG_XET");
    expect(t([yc("APPROVED", { approvedAmount: 100_000 })])).toBe("DA_DUYET");
    expect(t([yc("PAID", { approvedAmount: 100_000 })])).toBe("DA_HOAN");
    expect(t([yc("REJECTED", { lyDoTuChoi: "Không đủ điều kiện hoàn" })])).toBe("TU_CHOI");
    // một yêu cầu MỞ che trạng thái đã hoàn trước đó
    expect(t([yc("PAID", { approvedAmount: 100_000 }), yc("PENDING", { createdAt: NGAY(5) })])).toBe("DANG_XET");
    // đã hoàn che «từ chối» cũ
    expect(t([yc("REJECTED", { lyDoTuChoi: "x" }), yc("PAID", { approvedAmount: 200_000, createdAt: NGAY(5) })])).toBe("DA_HOAN");
  });

  it("[HTD-02] «phụ huynh rút» KHÔNG hiện như bị từ chối", () => {
    expect(trangThaiHoanCuaDong({ yeuCau: [yc("REJECTED", { lyDoTuChoi: LY_DO_RUT_YEU_CAU })], thucTra: 1 }).trangThai).toBe("KHONG");
  });

  it("[HTD-03] số tiền đã hoàn chỉ cộng yêu cầu PAID; hoanHet khi ≥ thực trả", () => {
    const r = trangThaiHoanCuaDong({ yeuCau: [yc("PAID", { approvedAmount: 300_000 }), yc("APPROVED", { approvedAmount: 200_000, createdAt: NGAY(3) })], thucTra: 500_000 });
    expect(r).toMatchObject({ soTienDaHoan: 300_000, hoanHet: false });
    expect(trangThaiHoanCuaDong({ yeuCau: [yc("PAID", { approvedAmount: 500_000 })], thucTra: 500_000 })).toMatchObject({ soTienDaHoan: 500_000, hoanHet: true });
    expect(trangThaiHoanCuaDong({ yeuCau: [], thucTra: 0 }).hoanHet).toBe(false); // không có thực trả ⇒ không «hoàn hết»
  });

  it("[HTD-04] quyenDaThuHoi chỉ khi có yêu cầu PAID mang dấu thu hồi", () => {
    expect(trangThaiHoanCuaDong({ yeuCau: [yc("PAID", { approvedAmount: 1, quyenDaThuHoiLuc: NGAY(2) })], thucTra: 1 }).quyenDaThuHoi).toBe(true);
    expect(trangThaiHoanCuaDong({ yeuCau: [yc("PAID", { approvedAmount: 1 })], thucTra: 1 }).quyenDaThuHoi).toBe(false);
    expect(trangThaiHoanCuaDong({ yeuCau: [yc("APPROVED", { approvedAmount: 1, quyenDaThuHoiLuc: NGAY(2) })], thucTra: 1 }).quyenDaThuHoi).toBe(false);
  });

  it("[HTD-05] gộp cấp đơn theo thứ tự chốt", () => {
    const d = (trangThai: "KHONG" | "DANG_XET" | "DA_DUYET" | "DA_HOAN" | "TU_CHOI", o: { soTienDaHoan?: number; hoanHet?: boolean; coTien?: boolean } = {}) => ({ trangThai, soTienDaHoan: o.soTienDaHoan ?? 0, hoanHet: o.hoanHet ?? false, coTien: o.coTien ?? true });
    expect(gopTrangThaiHoanDon([d("KHONG"), d("KHONG")])).toBe("KHONG");
    expect(gopTrangThaiHoanDon([d("TU_CHOI"), d("KHONG")])).toBe("TU_CHOI");
    expect(gopTrangThaiHoanDon([d("DA_HOAN", { soTienDaHoan: 1, hoanHet: true }), d("TU_CHOI")])).toBe("MOT_PHAN");
    expect(gopTrangThaiHoanDon([d("DA_HOAN", { soTienDaHoan: 1, hoanHet: true }), d("DA_HOAN", { soTienDaHoan: 1, hoanHet: true })])).toBe("DA_HOAN");
    expect(gopTrangThaiHoanDon([d("DA_DUYET"), d("DA_HOAN", { soTienDaHoan: 1, hoanHet: true })])).toBe("DA_DUYET");
    expect(gopTrangThaiHoanDon([d("DANG_XET"), d("DA_DUYET"), d("DA_HOAN", { soTienDaHoan: 1, hoanHet: true })])).toBe("DANG_XET");
  });

  it("[HTD-06] đơn nhiều dòng: một dòng hoàn hết, dòng kia chưa ⇒ MOT_PHAN; hoàn một phần số tiền của dòng duy nhất ⇒ MOT_PHAN; dòng không có tiền không cản DA_HOAN", () => {
    const d = (trangThai: "KHONG" | "DA_HOAN", soTienDaHoan: number, hoanHet: boolean, coTien = true) => ({ trangThai, soTienDaHoan, hoanHet, coTien });
    expect(gopTrangThaiHoanDon([d("DA_HOAN", 500_000, true), d("KHONG", 0, false)])).toBe("MOT_PHAN");
    expect(gopTrangThaiHoanDon([d("DA_HOAN", 100_000, false)])).toBe("MOT_PHAN");
    expect(gopTrangThaiHoanDon([d("DA_HOAN", 500_000, true), d("KHONG", 0, false, false)])).toBe("DA_HOAN"); // dòng chưa có tiền không tính
  });
});
