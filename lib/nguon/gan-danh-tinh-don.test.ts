// [GDD-*] — LÕI THUẦN «gắn danh tính cho 6 đơn sống». Không DB. Mỗi ca đỏ vì ĐÚNG MỘT lý do (đối chứng dương ở [GDD-01]).
// Fixture mang HÌNH DẠNG DỮ LIỆU THẬT của prod 24/10/2026: tổng đơn 8.976.000 = 10.560.000 − 15%; Payment tách đợt; ghi danh Sata3 ACTIVE chưa ai trỏ vào.
import { describe, expect, it } from "vitest";
import {
  MA_DON_GAN_DANH_TINH,
  docKhoaTrenDong,
  dongDauRaGanDanhTinh,
  dungBanGhiLuotGanDanhTinh,
  lapKeHoachGanDanhTinh,
  phanTichSoDuyetGanDanhTinh,
  quyetDinhGhiGanDanhTinh,
  type DuLieuMotDon,
} from "./gan-danh-tinh-don";

const KHOA = "khoa-sata3";

/** Một bộ dữ liệu HỢP LỆ cho đơn thứ `i` (0..5): chưa gắn, một học viên, một ghi danh ACTIVE, tiền khớp ba đường. */
function dungDon(i: number, sua: (d: DuLieuMotDon) => void = () => undefined): DuLieuMotDon {
  const code = MA_DON_GAN_DANH_TINH[i]!;
  const d: DuLieuMotDon = {
    don: {
      id: `o${i}`, code, type: "COURSE", deletedAt: null, studentId: null, leadId: `l${i}`, leadChildId: `be${i}`, centerId: "cs1", totalAmount: 8_976_000,
      items: [{ id: `it${i}`, type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, metadata: { courseId: KHOA, leadChildId: `be${i}` } }],
    },
    lead: { id: `l${i}`, centerId: "cs1", deletedAt: null },
    be: { id: `be${i}`, leadId: `l${i}`, fullName: `Bé Số ${i}` },
    hocVienUngVien: [{ id: `s${i}`, name: `Bé Số ${i}`, leadId: `l${i}`, leadChildId: `be${i}`, centerId: "cs1" }],
    ghiDanhUngVien: [{ id: `e${i}`, studentId: `s${i}`, courseId: KHOA, status: "ACTIVE", leadChildId: `be${i}`, centerId: "cs1" }],
    dongTroVaoGhiDanh: [],
    soPaymentSong: 2,
    tongPaymentSong: 8_976_000,
    tongPhanBoNganHang: 8_976_000,
  };
  sua(d);
  return d;
}
const lo = (sua: (d: DuLieuMotDon, i: number) => void = () => undefined) => MA_DON_GAN_DANH_TINH.map((_, i) => dungDon(i, (d) => sua(d, i)));
const lap = (du: DuLieuMotDon[]) => lapKeHoachGanDanhTinh({ maDon: MA_DON_GAN_DANH_TINH, du });
const maLoi = (du: DuLieuMotDon[]) => lap(du).loi.map((l) => `${l.code}:${l.ma}`);
/** Chỉ MỘT đơn (đơn 2) bị sửa — mọi đơn khác sạch. */
const mot = (sua: (d: DuLieuMotDon) => void) => lo((d, i) => (i === 2 ? sua(d) : undefined));
const CODE2 = MA_DON_GAN_DANH_TINH[2];
/** Biến lô thành «đã gắn ĐÚNG». */
const daGan = (d: DuLieuMotDon, i: number) => {
  d.don.studentId = `s${i}`;
  d.don.items = d.don.items.map((x) => ({ ...x, studentId: `s${i}`, enrollmentId: `e${i}` }));
  d.dongTroVaoGhiDanh = [{ orderItemId: `it${i}`, orderId: `o${i}`, enrollmentId: `e${i}` }];
};

describe("[GDD] phạm vi cứng", () => {
  it("[GDD-00] đúng 6 mã đơn chủ dự án chốt (24/10/2026), không trùng, không hơn", () => {
    expect([...MA_DON_GAN_DANH_TINH].sort()).toEqual(
      ["ORD-260831-000001", "ORD-260908-000003", "ORD-260910-000002", "ORD-260910-000005", "ORD-260910-000006", "ORD-260910-000008"],
    );
    expect(new Set(MA_DON_GAN_DANH_TINH).size).toBe(6);
  });
});

describe("[GDD] lập kế hoạch", () => {
  it("[GDD-01] ĐỐI CHỨNG DƯƠNG: lô sạch ⇒ SẴN SÀNG GHI 6 đơn, 6 dòng ký, không lỗi", () => {
    const kh = lap(lo());
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.daGanHet).toBe(false);
    expect(kh.ghi).toHaveLength(6);
    expect(kh.muc.every((m) => m.trangThai === "CHUA_GAN")).toBe(true);
    expect(kh.ghi[2]).toEqual({ orderId: "o2", code: CODE2, orderItemId: "it2", studentId: "s2", enrollmentId: "e2" });
    expect(kh.dongDauRa).toEqual(dongDauRaGanDanhTinh(kh.ghi));
    expect(kh.dongDauRa[0]).toBe(`gan-danh-tinh-don/v1|o0|${MA_DON_GAN_DANH_TINH[0]}|it0|s0|e0`);
    expect(kh.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[GDD-02] tất định: cùng đầu vào ⇒ cùng dòng + cùng sha; đổi MỘT đích ⇒ sha khác", () => {
    expect(lap(lo()).sha).toBe(lap(lo()).sha);
    const khac = lo((d, i) => {
      if (i === 0) d.ghiDanhUngVien = [{ ...d.ghiDanhUngVien[0]!, id: "e-khac" }];
    });
    expect(lap(khac).sha).not.toBe(lap(lo()).sha);
  });

  it("[GDD-03] chạy lại sau khi ghi: cả 6 đã gắn ĐÚNG ⇒ 0 dòng ghi, daGanHet, không dừng", () => {
    const kh = lap(lo(daGan));
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.daGanHet).toBe(true);
    expect(kh.ghi).toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.muc.every((m) => m.trangThai === "DA_GAN")).toBe(true);
  });

  it("[GDD-04] lô LAI (5 chưa gắn + 1 đã gắn) ⇒ DỪNG cả lô, không dòng ghi nào", () => {
    const kh = lap(lo((d, i) => (i === 3 ? daGan(d, i) : undefined)));
    expect(kh.dung).toBe(true);
    expect(kh.ghi).toEqual([]);
    expect(kh.loi.map((l) => l.ma)).toContain("LO_HON_HOP");
  });

  it("[GDD-05] đã gắn SAI học viên (Order.studentId khác học viên suy ra) ⇒ TRANG_THAI_GAN_LECH, dừng", () => {
    const kh = lap(mot((d) => { d.don.studentId = "nguoi-la"; }));
    expect(kh.dung).toBe(true);
    expect(maLoi(mot((d) => { d.don.studentId = "nguoi-la"; }))).toEqual([`${CODE2}:TRANG_THAI_GAN_LECH`]);
  });

  it("[GDD-06] gắn DỞ (Order.studentId có nhưng dòng đơn NULL) ⇒ TRANG_THAI_GAN_LECH — không tự 'hoàn thiện'", () => {
    expect(maLoi(mot((d) => { d.don.studentId = "s2"; }))).toEqual([`${CODE2}:TRANG_THAI_GAN_LECH`]);
  });
});

describe("[GDD] mỗi điều kiện fail-closed — một đơn lệch ⇒ DỪNG CẢ LÔ (ghi = [])", () => {
  const CA: Array<[string, string, (d: DuLieuMotDon) => void]> = [
    ["GDD-10", "DON_DA_XOA", (d) => { d.don.deletedAt = new Date("2026-10-05T12:00:00Z"); }],
    ["GDD-11", "DON_KHONG_PHAI_KHOA_HOC", (d) => { d.don.type = "PRODUCT"; }],
    ["GDD-12", "SO_DONG_KHONG_DUNG", (d) => { d.don.items = []; }],
    ["GDD-13", "SO_DONG_KHONG_DUNG", (d) => { d.don.items = [...d.don.items, { id: "it-them", type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, metadata: { courseId: KHOA } }]; }],
    ["GDD-14", "SO_DONG_KHONG_DUNG", (d) => { d.don.items = [{ ...d.don.items[0]!, type: "PRODUCT" }]; }],
    ["GDD-15", "THIEU_LEAD", (d) => { d.don.leadId = null; d.lead = null; }],
    ["GDD-16", "LEAD_KHONG_HOP_LE", (d) => { d.lead = { ...d.lead!, deletedAt: new Date("2026-10-01T00:00:00Z") }; }],
    ["GDD-17", "LEAD_KHONG_HOP_LE", (d) => { d.lead = { ...d.lead!, centerId: "cs2" }; }],
    ["GDD-18", "THIEU_BE", (d) => { d.don.leadChildId = null; d.be = null; }],
    ["GDD-19", "BE_KHONG_THUOC_LEAD", (d) => { d.be = { ...d.be!, leadId: "lead-khac" }; }],
    ["GDD-20", "KHONG_CO_HOC_VIEN", (d) => { d.hocVienUngVien = []; d.ghiDanhUngVien = []; }],
    ["GDD-21", "NHIEU_HOC_VIEN", (d) => { d.hocVienUngVien = [...d.hocVienUngVien, { id: "anh-chi-em", name: "Anh Chị Em", leadId: "l2", leadChildId: "be-khac", centerId: "cs1" }]; }],
    ["GDD-22", "HOC_VIEN_LECH_LEAD", (d) => { d.hocVienUngVien = [{ ...d.hocVienUngVien[0]!, leadId: "lead-khac" }]; }],
    ["GDD-23", "HOC_VIEN_LECH_BE", (d) => { d.hocVienUngVien = [{ ...d.hocVienUngVien[0]!, leadChildId: "be-khac" }]; }],
    ["GDD-24", "HOC_VIEN_LECH_TEN", (d) => { d.hocVienUngVien = [{ ...d.hocVienUngVien[0]!, name: "Tên Hoàn Toàn Khác" }]; }],
    ["GDD-25", "HOC_VIEN_LECH_CO_SO", (d) => { d.hocVienUngVien = [{ ...d.hocVienUngVien[0]!, centerId: "cs2" }]; }],
    ["GDD-26", "KHONG_CO_GHI_DANH", (d) => { d.ghiDanhUngVien = []; }],
    ["GDD-27", "NHIEU_GHI_DANH", (d) => { d.ghiDanhUngVien = [...d.ghiDanhUngVien, { ...d.ghiDanhUngVien[0]!, id: "e-hai" }]; }],
    ["GDD-28", "GHI_DANH_KHONG_ACTIVE", (d) => { d.ghiDanhUngVien = [{ ...d.ghiDanhUngVien[0]!, status: "COMPLETED" }]; }],
    ["GDD-29", "GHI_DANH_LECH_KHOA", (d) => { d.ghiDanhUngVien = [{ ...d.ghiDanhUngVien[0]!, courseId: "khoa-sata4" }]; }],
    ["GDD-30", "THIEU_KHOA_TREN_DONG", (d) => { d.don.items = [{ ...d.don.items[0]!, metadata: {} }]; }],
    ["GDD-31", "GHI_DANH_LECH_BE", (d) => { d.ghiDanhUngVien = [{ ...d.ghiDanhUngVien[0]!, leadChildId: "be-khac" }]; }],
    ["GDD-32", "GHI_DANH_LECH_CO_SO", (d) => { d.ghiDanhUngVien = [{ ...d.ghiDanhUngVien[0]!, centerId: "cs2" }]; }],
    ["GDD-33", "GHI_DANH_DA_BI_DUNG", (d) => { d.dongTroVaoGhiDanh = [{ orderItemId: "dong-don-khac", orderId: "don-khac", enrollmentId: "e2" }]; }],
    ["GDD-34", "KHONG_CO_PAYMENT", (d) => { d.soPaymentSong = 0; d.tongPaymentSong = 0; }],
    ["GDD-35", "TIEN_PAYMENT_LECH", (d) => { d.tongPaymentSong = 8_976_000 - 1; }],
    ["GDD-36", "TIEN_PHAN_BO_LECH", (d) => { d.tongPhanBoNganHang = 8_976_000 + 1; }],
    ["GDD-37", "TIEN_PHAN_BO_LECH", (d) => { d.tongPhanBoNganHang = 0; }],
  ];
  it.each(CA)("[%s] %s", (_id, ma, sua) => {
    const du = mot(sua);
    const kh = lap(du);
    expect(kh.dung).toBe(true);
    expect(kh.ghi, "lô dừng ⇒ KHÔNG có dòng ghi nào, kể cả của 5 đơn sạch").toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.loi.map((l) => l.ma)).toContain(ma);
    // Đúng đơn bị sửa mới có lỗi; 5 đơn còn lại không bị vạ lây (đối chứng dương).
    expect(new Set(kh.loi.filter((l) => l.ma === ma).map((l) => l.code))).toEqual(new Set([CODE2]));
    expect(kh.muc.filter((m) => m.loi.length === 0)).toHaveLength(5);
  });

  it("[GDD-38] thiếu hẳn một đơn trong dữ liệu ⇒ THIEU_DON, dừng", () => {
    const du = lo().filter((d) => d.don.code !== MA_DON_GAN_DANH_TINH[4]);
    const kh = lap(du);
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => `${l.code}:${l.ma}`)).toContain(`${MA_DON_GAN_DANH_TINH[4]}:THIEU_DON`);
  });

  it("[GDD-39] đơn NGOÀI phạm vi lọt vào dữ liệu ⇒ dừng (lõi không tin người nạp)", () => {
    const them = dungDon(0, (d) => { d.don.id = "ngoai"; d.don.code = "ORD-999999-000001"; });
    const kh = lap([...lo(), them]);
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => `${l.code}:${l.ma}`)).toContain("ORD-999999-000001:THIEU_DON");
  });

  it("[GDD-40] hai đơn cùng đích (cùng ghi danh hoặc cùng học viên) ⇒ TRUNG_DICH, dừng — dù từng đơn tự nó sạch", () => {
    const kh = lap(lo((d, i) => {
      if (i === 1) {
        d.hocVienUngVien = [{ ...dungDon(0).hocVienUngVien[0]!, leadId: "l1", leadChildId: "be1", name: "Bé Số 1" }].map((h) => ({ ...h, id: "s0" }));
        d.ghiDanhUngVien = [{ ...dungDon(0).ghiDanhUngVien[0]!, leadChildId: "be1", studentId: "s0" }];
      }
    }));
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => l.ma)).toContain("TRUNG_DICH");
  });

  it("[GDD-41] tên so sánh theo NFC + khoảng trắng + hoa/thường (dữ liệu thật có «Nguyễn hoàng bách»); khác tên thật ⇒ vẫn đỏ [GDD-24]", () => {
    const kh = lap(lo((d, i) => {
      if (i === 0) {
        d.be = { ...d.be!, fullName: "  BÉ   số 0 " };
        d.hocVienUngVien = [{ ...d.hocVienUngVien[0]!, name: "Bé Số 0".normalize("NFD") }];
      }
    }));
    expect(kh.loi).toEqual([]);
  });
});

describe("[GDD] cổng số duyệt + bộ phân tích tham số", () => {
  const khOk = lap(lo());
  it("[GDD-50] qua khi đúng N + có quyền ghi; sai N / thiếu quyền / thiếu N / NaN ⇒ từ chối với câu nói rõ", () => {
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 6, keHoach: khOk, ghiDuoc: true })).toBeNull();
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 5, keHoach: khOk, ghiDuoc: true })).toMatch(/≠ kế hoạch/);
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 6, keHoach: khOk, ghiDuoc: false })).toMatch(/không có quyền UPDATE/);
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 6, keHoach: khOk, ghiDuoc: null })).toMatch(/Không kiểm được/);
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: null, keHoach: khOk, ghiDuoc: true })).toMatch(/đòi --expect/);
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: Number.NaN, keHoach: khOk, ghiDuoc: true })).toMatch(/số nguyên/);
  });
  it("[GDD-51] kế hoạch DỪNG ⇒ từ chối dù N khớp; đã gắn đúng cả lô + N=0 ⇒ qua (0 dòng)", () => {
    const dung = lap(mot((d) => { d.don.deletedAt = new Date("2026-10-05T12:00:00Z"); }));
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 0, keHoach: dung, ghiDuoc: true })).toMatch(/DỪNG/);
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 0, keHoach: lap(lo(daGan)), ghiDuoc: true })).toBeNull();
    expect(quyetDinhGhiGanDanhTinh({ soDuyet: 6, keHoach: lap(lo(daGan)), ghiDuoc: true })).toMatch(/≠ kế hoạch/);
  });
  it("[GDD-52] --expect chỉ nhận chữ số thập phân thuần", () => {
    expect(phanTichSoDuyetGanDanhTinh(["--ghi"])).toBeNull();
    expect(phanTichSoDuyetGanDanhTinh(["--expect=6"])).toBe(6);
    for (const xau of ["--expect=", "--expect=0x6", "--expect=6.0", "--expect=1e1", "--expect=-6", "--expect= 6", "--expect=٦", "--expect=99999999999999999999"]) {
      expect(Number.isNaN(phanTichSoDuyetGanDanhTinh([xau]) as number), xau).toBe(true);
    }
  });
});

describe("[GDD] helper nhỏ", () => {
  it("[GDD-60] docKhoaTrenDong: chỉ nhận chuỗi courseId không rỗng từ object", () => {
    expect(docKhoaTrenDong({ courseId: " k1 " })).toBe("k1");
    for (const x of [null, undefined, "k1", 5, [], [{ courseId: "k1" }], {}, { courseId: "" }, { courseId: 7 }]) expect(docKhoaTrenDong(x)).toBeNull();
  });
  it("[GDD-61] bản ghi audit mức lượt: mốc giờ phải hợp lệ; ghi đủ số duyệt/thực ghi/sha, 4 khoá nguonChay", () => {
    const kh = lap(lo());
    const luot = { batDauLuc: new Date("2026-10-24T03:00:00Z"), nguonChay: { actor: "a", triggeringActor: "b", runId: "1", runAttempt: "1" } };
    const b = dungBanGhiLuotGanDanhTinh({ luot, soDuyet: 6, keHoach: kh, daGhi: 6 });
    expect(b).toMatchObject({ cheDo: "APPLY", dryRun: false, expectedCount: 6, actualCount: 6, khop: true, keHoachSha: kh.sha });
    expect(Object.keys(b.nguonChay as object).sort()).toEqual(["actor", "runAttempt", "runId", "triggeringActor"]);
    expect(() => dungBanGhiLuotGanDanhTinh({ luot: { ...luot, batDauLuc: new Date("x") }, soDuyet: 6, keHoach: kh, daGhi: 6 })).toThrow(/batDauLuc/);
  });
});
