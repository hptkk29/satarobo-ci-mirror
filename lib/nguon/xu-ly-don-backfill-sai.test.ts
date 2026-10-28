// lib/nguon/xu-ly-don-backfill-sai.test.ts — [XDS-*] LÕI THUẦN của «PHASE X · xử lý đơn backfill SAI ORD-260913-000041» (27/10/2026). Không DB, không đồng hồ.
//
// Ánh xạ yêu cầu owner (27/10/2026) → ca:
//   hard scope đúng một mã đơn, không wildcard ⇒ [XDS-02]   |   dry-run in toàn bộ phụ thuộc, MỌI phụ thuộc phải = 0 ⇒ [XDS-04]   |   fail nếu dữ liệu lệch audit ⇒ [XDS-03]
//   hai khoản phải là PENDING/backfill, không allocation/Receipt/hoá đơn/commission ⇒ [XDS-03] [XDS-04]   |   idempotent ⇒ [XDS-01] [XDS-05]   |   không id thật trong mã nguồn ⇒ [XDS-06]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KHUON_DONG_XU_LY_DON_SAI,
  MA_DON_DUNG,
  MA_DON_SAI,
  SO_TIEN_KHOAN_SAI,
  TEN_PHU_THUOC,
  TONG_DON_SAI,
  dongDauRaXuLyDonSai,
  lapKeHoachXuLy,
  type DuLieuXuLy,
  type MaLoiXuLy,
} from "./xu-ly-don-backfill-sai";
import { shaDongWaveC } from "./wave-c-chung";

const SHA_RONG = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ENR = "enr-dung";
/** Trạng thái bán/kế toán của hàng backfill đã audit — khai là HẰNG (lưới trục A/B cấm gõ lại điều kiện «đã ghi nhận/đã xác nhận» ngoài nguồn chung). */
const DA_GHI_NHAN = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";

const khong = () => Object.fromEntries(TEN_PHU_THUOC.map((t) => [t, 0]));
const khoan = (id: string, amount: number, o: Partial<DuLieuXuLy["khoanSai"][number]> = {}) => ({
  id, amount, paymentType: "PAYMENT", saleStatus: DA_GHI_NHAN, accountantStatus: "PENDING", method: "backfill", enrollmentId: ENR, orderItemId: "it-sai", adjustmentOfId: null, refundRequestId: null, deletedAt: null, ...o,
});

/** Đơn sai CÒN NGUYÊN — đúng hình dạng đã audit trên PROD (chỉ đổi id thành giá trị giả). */
function chuaXuLy(): DuLieuXuLy {
  return {
    donSai: { id: "o-sai", code: MA_DON_SAI, type: "COURSE", status: "CONFIRMED", deletedAt: null, studentId: "hv", leadId: "ld", totalAmount: TONG_DON_SAI },
    dongDonSai: [{ id: "it-sai", type: "COURSE_ENROLLMENT", quantity: 1, totalPrice: TONG_DON_SAI, studentId: null, enrollmentId: null }],
    khoanSai: [khoan("k-b", 9_424_000), khoan("k-a", 1_000_000)],
    donDung: { id: "o-dung", code: MA_DON_DUNG, studentId: "hv", leadId: "ld", enrollmentId: ENR },
    phuThuoc: khong(),
    lichSu: [],
  };
}
/** Đơn sai ĐÃ xử lý: CANCELLED + 1 dòng lịch sử + 2 khoản xoá mềm đã gỡ liên kết. */
function daXuLy(): DuLieuXuLy {
  const d = chuaXuLy();
  return {
    ...d,
    donSai: { ...d.donSai!, status: "CANCELLED" },
    khoanSai: d.khoanSai.map((k) => ({ ...k, deletedAt: new Date("2026-10-27T10:00:00Z"), enrollmentId: null })),
    lichSu: [{ fromStatus: "CONFIRMED", toStatus: "CANCELLED" }],
  };
}
const ma = (d: DuLieuXuLy) => lapKeHoachXuLy(d).loi.map((l) => l.ma);

describe("[XDS-00] đơn sai còn nguyên ⇒ kế hoạch SẴN SÀNG GHI đúng 3 dòng (đối chứng dương)", () => {
  const kh = lapKeHoachXuLy(chuaXuLy());
  it("không lỗi, trạng thái CHUA_XU_LY, 2 khoản (sắp theo id) rồi 1 đơn; ghi danh đích = ghi danh của đơn ĐÚNG", () => {
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.daXuLy).toBe(false);
    expect(kh.trangThai).toBe("CHUA_XU_LY");
    expect(kh.ghi.map((g) => g.loai)).toEqual(["KHOAN", "KHOAN", "DON"]);
    expect(kh.ghi.flatMap((g) => (g.loai === "KHOAN" ? [g.paymentId] : []))).toEqual(["k-a", "k-b"]);
    expect(kh.enrollmentDich).toBe(ENR);
  });
  it("dòng ký đúng khuôn, KHÔNG chứa tên/SĐT/email; PLAN_SHA = sha256 các dòng nối «\\n» (cùng công thức cổng verify)", () => {
    expect(kh.dongDauRa).toEqual([
      `${KHUON_DONG_XU_LY_DON_SAI}|KHOAN|${MA_DON_SAI}|k-a|1000000|${ENR}|XOA_MEM+GO_GHI_DANH`,
      `${KHUON_DONG_XU_LY_DON_SAI}|KHOAN|${MA_DON_SAI}|k-b|9424000|${ENR}|XOA_MEM+GO_GHI_DANH`,
      `${KHUON_DONG_XU_LY_DON_SAI}|DON|${MA_DON_SAI}|o-sai|10424000|CONFIRMED>CANCELLED|HUY_DON`,
    ]);
    expect(kh.sha).toBe(shaDongWaveC(kh.dongDauRa));
    expect(dongDauRaXuLyDonSai(kh.ghi)).toEqual(kh.dongDauRa);
  });
  it("mọi dòng ghi mang điều kiện để lõi DB đặt vào `where` (id đơn, id dòng đơn, số tiền, ghi danh đích)", () => {
    const k = kh.ghi.filter((g) => g.loai === "KHOAN");
    expect(k.every((g) => g.loai === "KHOAN" && g.orderId === "o-sai" && g.orderItemId === "it-sai" && g.enrollmentId === ENR)).toBe(true);
    expect(kh.ghi.find((g) => g.loai === "DON")).toMatchObject({ orderId: "o-sai", code: MA_DON_SAI, tongDon: TONG_DON_SAI, tuTrangThai: "CONFIRMED", denTrangThai: "CANCELLED" });
  });
});

describe("[XDS-01] ĐÃ xử lý ⇒ 0 dòng ghi, daXuLy, PLAN_SHA = hash chuỗi rỗng (idempotent)", () => {
  it("đơn CANCELLED + 1 dòng lịch sử + 2 khoản xoá mềm đã gỡ liên kết", () => {
    const kh = lapKeHoachXuLy(daXuLy());
    expect(kh.loi).toEqual([]);
    expect(kh.trangThai).toBe("DA_XU_LY");
    expect(kh.daXuLy).toBe(true);
    expect(kh.dung).toBe(false);
    expect(kh.ghi).toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.sha).toBe(SHA_RONG);
  });
});

describe("[XDS-02] PHẠM VI CỨNG: đúng một mã đơn sai, số tiền đã audit — không tham số, không wildcard", () => {
  it("hằng đúng như owner chốt", () => {
    expect(MA_DON_SAI).toBe("ORD-260913-000041");
    expect(MA_DON_DUNG).toBe("ORD-260910-000007");
    expect(TONG_DON_SAI).toBe(10_424_000);
    expect([...SO_TIEN_KHOAN_SAI]).toEqual([1_000_000, 9_424_000]);
    expect(MA_DON_SAI).toMatch(/^ORD-\d{6}-\d{6}$/);
    expect(MA_DON_SAI).not.toMatch(/[*%?]/);
  });
  it("đọc ra mã đơn KHÁC với hằng ⇒ DỪNG (lõi không tin mã đơn do tầng đọc trả về)", () => {
    const d = chuaXuLy();
    d.donSai = { ...d.donSai!, code: "ORD-260913-000042" };
    expect(ma(d)).toContain("DON_SAI_KHONG_THAY");
    expect(lapKeHoachXuLy(d).ghi).toEqual([]);
  });
});

type Ca = [ten: string, lamHong: (d: DuLieuXuLy) => void, maLoi: MaLoiXuLy];
const CA_LOI: Ca[] = [
  ["không thấy đơn sai", (d) => (d.donSai = null), "DON_SAI_KHONG_THAY"],
  ["không thấy đơn đúng", (d) => (d.donDung = null), "DON_DUNG_KHONG_THAY"],
  ["đơn đúng chưa có ghi danh (C-A chưa xong)", (d) => (d.donDung = { ...d.donDung!, enrollmentId: null }), "DON_DUNG_KHONG_CO_GHI_DANH"],
  ["đơn sai không còn CONFIRMED (đang chờ thanh toán)", (d) => (d.donSai = { ...d.donSai!, status: "PENDING_PAYMENT" }), "DON_SAI_TRANG_THAI"],
  ["đơn sai đã bị xoá mềm", (d) => (d.donSai = { ...d.donSai!, deletedAt: new Date("2026-10-01T00:00:00Z") }), "DON_SAI_DA_XOA_MEM"],
  ["đơn sai không phải COURSE", (d) => (d.donSai = { ...d.donSai!, type: "PRODUCT" }), "DON_SAI_LOAI"],
  ["tổng đơn trôi", (d) => (d.donSai = { ...d.donSai!, totalAmount: TONG_DON_SAI + 1 }), "DON_SAI_TONG_LECH"],
  ["đơn sai KHÁC học viên với đơn đúng", (d) => (d.donSai = { ...d.donSai!, studentId: "hv-khac" }), "DON_SAI_KHAC_HOC_VIEN"],
  ["đơn sai không có học viên", (d) => (d.donSai = { ...d.donSai!, studentId: null }), "DON_SAI_KHAC_HOC_VIEN"],
  ["đơn sai KHÁC lead với đơn đúng", (d) => (d.donSai = { ...d.donSai!, leadId: "ld-khac" }), "DON_SAI_KHAC_LEAD"],
  ["thêm một dòng đơn thứ hai", (d) => d.dongDonSai = [...d.dongDonSai, { ...d.dongDonSai[0]!, id: "it-2" }], "DONG_DON_LECH"],
  ["dòng đơn đã gắn ghi danh", (d) => (d.dongDonSai = [{ ...d.dongDonSai[0]!, enrollmentId: "enr-x" }]), "DONG_DON_LECH"],
  ["dòng đơn đã gắn học viên", (d) => (d.dongDonSai = [{ ...d.dongDonSai[0]!, studentId: "hv" }]), "DONG_DON_LECH"],
  ["dòng đơn không phải COURSE_ENROLLMENT", (d) => (d.dongDonSai = [{ ...d.dongDonSai[0]!, type: "PRODUCT" }]), "DONG_DON_LECH"],
  ["dòng đơn đổi giá", (d) => (d.dongDonSai = [{ ...d.dongDonSai[0]!, totalPrice: 1 }]), "DONG_DON_LECH"],
  ["thêm một khoản thứ ba", (d) => d.khoanSai = [...d.khoanSai, khoan("k-c", 5)], "TAP_KHOAN_LECH"],
  ["bớt một khoản", (d) => (d.khoanSai = d.khoanSai.slice(1)), "TAP_KHOAN_LECH"],
  ["một khoản đổi số tiền", (d) => (d.khoanSai = [khoan("k-a", 1_000_001), d.khoanSai[0]!]), "TAP_KHOAN_LECH"],
  ["khoản đã được kế toán XÁC NHẬN", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { accountantStatus: DA_XAC_NHAN }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản không phải method backfill (tiền thật qua cổng)", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { method: "sepay" }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản là bút toán điều chỉnh", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { adjustmentOfId: "k-x" }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản gắn hoàn tiền", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { refundRequestId: "rf" }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản là PHIẾU CHI (không phải PAYMENT)", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { paymentType: "REFUND" }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản trỏ vào dòng đơn khác", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { orderItemId: "it-khac" }), d.khoanSai[0]!]), "KHOAN_KHONG_PHAI_BACKFILL"],
  ["khoản gắn ghi danh KHÁC ghi danh của đơn đúng", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { enrollmentId: "enr-khac" }), d.khoanSai[0]!]), "KHOAN_GAN_SAI"],
  ["khoản không gắn ghi danh nào (chưa-xử-lý nhưng đã bị gỡ một phần)", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { enrollmentId: null }), d.khoanSai[0]!]), "KHOAN_GAN_SAI"],
  ["xử lý DỞ: một khoản đã xoá mềm, đơn còn CONFIRMED", (d) => (d.khoanSai = [khoan("k-a", 1_000_000, { deletedAt: new Date("2026-10-27T10:00:00Z"), enrollmentId: null }), d.khoanSai[0]!]), "TRANG_THAI_LAI"],
  ["xử lý DỞ: đơn đã CANCELLED nhưng khoản còn sống", (d) => {
    d.donSai = { ...d.donSai!, status: "CANCELLED" };
    d.lichSu = [{ fromStatus: "CONFIRMED", toStatus: "CANCELLED" }];
  }, "TRANG_THAI_LAI"],
  ["đơn CONFIRMED mà đã có dòng lịch sử trạng thái", (d) => (d.lichSu = [{ fromStatus: "PENDING_PAYMENT", toStatus: "CONFIRMED" }]), "LICH_SU_TRANG_THAI_LECH"],
  ["thiếu một phép đếm phụ thuộc (coi là KHÔNG an toàn)", (d) => {
    d.phuThuoc = Object.fromEntries(Object.entries(d.phuThuoc).filter(([k]) => k !== "Receipt"));
  }, "CO_PHU_THUOC"],
];

describe("[XDS-03] FAIL-CLOSED: lệch audit ⇒ DỪNG CẢ LÔ, 0 dòng ghi, INVALID ≥ 1", () => {
  it.each(CA_LOI)("%s ⇒ %s", (_ten, lamHong, maLoi) => {
    const d = chuaXuLy();
    lamHong(d);
    const kh = lapKeHoachXuLy(d);
    expect(kh.loi.map((l) => l.ma), "mã lỗi").toContain(maLoi);
    expect(kh.dung).toBe(true);
    expect(kh.trangThai).toBe("LECH");
    expect(kh.ghi).toEqual([]);
    expect(kh.dongDauRa).toEqual([]);
    expect(kh.daXuLy).toBe(false);
  });

  it("đã-xử-lý mà khoản xoá mềm VẪN còn gắn ghi danh ⇒ KHÔNG coi là xong (DỪNG, không âm thầm bỏ qua)", () => {
    const d = daXuLy();
    d.khoanSai = [{ ...d.khoanSai[0]!, enrollmentId: ENR }, d.khoanSai[1]!];
    const kh = lapKeHoachXuLy(d);
    expect(kh.daXuLy).toBe(false);
    expect(kh.dung).toBe(true);
    expect(kh.loi.map((l) => l.ma)).toContain("TRANG_THAI_LAI");
  });
  it("đã-xử-lý mà thiếu dòng lịch sử huỷ ⇒ DỪNG", () => {
    const d = daXuLy();
    d.lichSu = [];
    expect(lapKeHoachXuLy(d).daXuLy).toBe(false);
    expect(ma(d)).toContain("TRANG_THAI_LAI");
  });
});

describe("[XDS-04] MỌI phụ thuộc phải = 0 — từng phép đếm một (22 bảng/cột trỏ vào đơn, dòng đơn, khoản)", () => {
  it("danh sách phép đếm không rỗng và không trùng", () => {
    expect(TEN_PHU_THUOC.length).toBeGreaterThanOrEqual(20);
    expect(new Set(TEN_PHU_THUOC).size).toBe(TEN_PHU_THUOC.length);
  });
  it.each(TEN_PHU_THUOC.map((t) => [t] as const))("%s = 1 ⇒ CO_PHU_THUOC, 0 dòng ghi, tên bảng có trong câu lỗi", (ten) => {
    const d = chuaXuLy();
    d.phuThuoc = { ...d.phuThuoc, [ten]: 1 };
    const kh = lapKeHoachXuLy(d);
    expect(kh.dung).toBe(true);
    expect(kh.ghi).toEqual([]);
    const l = kh.loi.find((x) => x.ma === "CO_PHU_THUOC");
    expect(l, ten).toBeDefined();
    expect(l!.chiTiet).toContain(ten);
    expect(kh.soPhuThuocKhac0).toBe(1);
  });
  it("phụ thuộc xuất hiện SAU khi đã xử lý (vd Receipt phát muộn) cũng DỪNG — không nói «xong»", () => {
    const d = daXuLy();
    d.phuThuoc = { ...d.phuThuoc, Receipt: 1 };
    const kh = lapKeHoachXuLy(d);
    expect(kh.dung).toBe(true);
    expect(kh.daXuLy).toBe(false);
  });
});

describe("[XDS-05] chạy lại trạng thái hỗn hợp không bao giờ sinh dòng ghi thứ hai", () => {
  it("DA_XU_LY rồi chạy lại ⇒ cùng kết quả, vẫn 0 dòng", () => {
    const a = lapKeHoachXuLy(daXuLy());
    const b = lapKeHoachXuLy(daXuLy());
    expect(a).toEqual(b);
    expect(a.ghi).toHaveLength(0);
  });
});

describe("[XDS-06] KHÔNG có định danh tài chính thật trong mã nguồn (gương CI công khai) — chỉ mã đơn kinh doanh + số tiền", () => {
  const CUID = /\bc[a-z0-9]{24}\b/;
  it.each([
    ["lib/nguon/xu-ly-don-backfill-sai.ts"],
    ["lib/nguon/xu-ly-don-backfill-sai-db.ts"],
  ])("%s: không chuỗi giống id cuid, không id khoản/ghi danh gõ cứng", (p) => {
    const s = readFileSync(resolve(process.cwd(), p), "utf8");
    expect(s).not.toMatch(CUID);
  });
  it("chỉ có đúng HAI mã đơn trong lõi (một sai, một đúng) — không mã đơn thứ ba", () => {
    const s = readFileSync(resolve(process.cwd(), "lib/nguon/xu-ly-don-backfill-sai.ts"), "utf8");
    const code = new Set(s.match(/ORD-\d{6}-\d{6}/g) ?? []);
    expect([...code].sort()).toEqual([MA_DON_DUNG, MA_DON_SAI].sort());
  });
});
