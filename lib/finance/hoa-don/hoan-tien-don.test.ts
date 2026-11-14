// Ca [HTD-*] — yêu cầu hoàn học phí nhìn từ màn hoá đơn (chủ dự án chốt 29/09 — Q1). THUẦN.
// Câu tra thật (nối yêu cầu với đơn trên Postgres) ở `tests/finance/hoa-don-hoan.test.ts` [HDHDB-*].
import { describe, it, expect } from "vitest";
import {
  CAU_HOAN_CHAN_XAC_NHAN,
  dieuKienHoanCuaDon,
  hoanTheoDon,
  lyDoHoanChanXacNhan,
  lyDoHoanSauMoc,
  hoanAnhHuongKhoan,
  TRANG_THAI_HOAN_CAN_NAP,
  yeuCauHoanCuaKhoan,
  type HangHoan,
  type PhamViKhoan,
  type YeuCauHoanVao,
} from "./hoan-tien-don";

const MOC = new Date("2026-09-20T03:00:00Z").getTime();

const hang = (o: Partial<HangHoan> = {}): HangHoan => ({
  id: "rr1",
  status: "APPROVED",
  proposedAmount: 1_200_000,
  approvedAmount: 1_000_000,
  approvedAt: new Date("2026-09-22T03:00:00Z"),
  createdAt: new Date("2026-09-21T03:00:00Z"),
  orderItemId: null,
  enrollmentId: "gd-an",
  orderItem: null,
  enrollment: { student: { name: "Bé An" }, orderItems: [], payments: [{ orderId: "don1" }] },
  ...o,
});

const yc = (o: Partial<YeuCauHoanVao> = {}): YeuCauHoanVao => ({
  id: "rr1",
  status: "APPROVED",
  soTien: 1_000_000,
  lucDuyet: new Date("2026-09-22T03:00:00Z"),
  createdAt: new Date("2026-09-21T03:00:00Z"),
  ten: "Bé An",
  phamVi: { orderItemIds: [], enrollmentIds: ["gd-an"] },
  ...o,
});

describe("[HTD-01] gom yêu cầu hoàn theo ĐƠN", () => {
  it("có dòng đơn ⇒ CHỈ đơn của dòng đơn (kể cả khi ghi danh còn trỏ đơn khác)", () => {
    const m = hoanTheoDon([
      hang({
        orderItemId: "oi-an",
        orderItem: { orderId: "don1", itemName: "Sata 5 — Bé An", enrollmentId: null },
        enrollment: { student: { name: "Bé An" }, orderItems: [{ orderId: "don2", id: "oi-x" }], payments: [{ orderId: "don2" }] },
      }),
    ]);
    expect([...m.keys()]).toEqual(["don1"]);
  });

  it("không dòng đơn ⇒ mọi đơn nối qua ghi danh (dòng đơn HOẶC khoản thu), không lặp", () => {
    const m = hoanTheoDon([
      hang({ enrollment: { student: { name: "Bé An" }, orderItems: [{ orderId: "don1", id: "oi-an" }], payments: [{ orderId: "don1" }, { orderId: "don2" }] } }),
    ]);
    expect([...m.keys()].sort()).toEqual(["don1", "don2"]);
    expect(m.get("don1")).toHaveLength(1);
  });

  it("số tiền = số ĐÃ DUYỆT, chưa duyệt thì số đề xuất; tên = tên bé, không có thì tên dòng đơn", () => {
    expect(hoanTheoDon([hang()]).get("don1")![0]).toMatchObject({ soTien: 1_000_000, ten: "Bé An" });
    const chuaDuyet = hoanTheoDon([hang({ status: "PENDING", approvedAmount: null, approvedAt: null })]).get("don1")![0]!;
    expect(chuaDuyet).toMatchObject({ soTien: 1_200_000, lucDuyet: null });
    const khongGhiDanh = hoanTheoDon([
      hang({ enrollment: null, enrollmentId: null, orderItemId: "oi-an", orderItem: { orderId: "don1", itemName: "Sata 5 — Bé An", enrollmentId: null } }),
    ]);
    expect(khongGhiDanh.get("don1")![0]!.ten).toBe("Sata 5 — Bé An");
  });
});

describe("[HTD-02] (Q1b) chặn Xác nhận — CHỜ / ĐÃ DUYỆT / ĐÃ CHI chặn; TỪ CHỐI / không có thì không", () => {
  // Yêu cầu MƠ HỒ (không móc được con nào) ⇒ theo cả đơn — dùng nó để ca này chỉ đo phần TRẠNG THÁI.
  const MO_HO = { orderItemIds: [], enrollmentIds: [] };
  const K = [{ orderItemId: "oi-an", enrollmentId: "gd-an" }];
  it("PENDING, APPROVED và PAID ⇒ đúng câu chung", () => {
    expect(lyDoHoanChanXacNhan([{ status: "PENDING", phamVi: MO_HO }], K)).toBe(CAU_HOAN_CHAN_XAC_NHAN);
    expect(lyDoHoanChanXacNhan([{ status: "APPROVED", phamVi: MO_HO }], K)).toBe(CAU_HOAN_CHAN_XAC_NHAN);
    // 29/09 (chủ dự án chốt, 0b): ĐÃ CHI cũng chặn — tiền đã ra khỏi quỹ mà tờ nháp vẫn in số trước hoàn.
    expect(lyDoHoanChanXacNhan([{ status: "PAID", phamVi: MO_HO }], K)).toBe(CAU_HOAN_CHAN_XAC_NHAN);
  });

  it("đối chứng âm: REJECTED, rỗng ⇒ null", () => {
    expect(lyDoHoanChanXacNhan([{ status: "REJECTED", phamVi: MO_HO }], K)).toBeNull();
    expect(lyDoHoanChanXacNhan([], K)).toBeNull();
  });
});

describe("[HTD-03] (Q1a) hoàn ĐÃ DUYỆT sau mốc ⇒ một câu mỗi yêu cầu", () => {
  it("APPROVED / PAID duyệt SAU mốc ⇒ câu nói số tiền, tên, ngày (giờ VN) và việc tiếp", () => {
    // 21/09 17:30Z = 22/09 00:30 giờ VN — ngày theo +07, không theo giờ máy.
    const r = lyDoHoanSauMoc([yc({ lucDuyet: new Date("2026-09-21T17:30:00Z") })], MOC, "việc X");
    expect(r).toEqual(["Đã duyệt hoàn 1.000.000đ cho Bé An ngày 22/09 — việc X"]);
    expect(lyDoHoanSauMoc([yc({ status: "PAID" })], MOC, "x")).toHaveLength(1);
  });

  it("đối chứng âm: duyệt TRƯỚC / ĐÚNG mốc, hoặc còn CHỜ / bị TỪ CHỐI ⇒ không câu nào", () => {
    expect(lyDoHoanSauMoc([yc({ lucDuyet: new Date("2026-09-19T03:00:00Z") })], MOC, "x")).toEqual([]);
    expect(lyDoHoanSauMoc([yc({ lucDuyet: new Date(MOC) })], MOC, "x")).toEqual([]);
    expect(lyDoHoanSauMoc([yc({ status: "PENDING" })], MOC, "x")).toEqual([]);
    expect(lyDoHoanSauMoc([yc({ status: "REJECTED" })], MOC, "x")).toEqual([]);
  });

  it("không có mốc duyệt ⇒ dùng mốc tạo; không có tên ⇒ 'khoản trên đơn'", () => {
    const r = lyDoHoanSauMoc([yc({ lucDuyet: null, createdAt: new Date("2026-09-25T03:00:00Z"), ten: null })], MOC, "x");
    expect(r).toEqual(["Đã duyệt hoàn 1.000.000đ cho khoản trên đơn ngày 25/09 — x"]);
    expect(lyDoHoanSauMoc([yc({ lucDuyet: null, createdAt: new Date("2026-09-01T03:00:00Z") })], MOC, "x")).toEqual([]);
  });
});

describe("[HTD-04] điều kiện câu tra — hai đầu mối, nhánh ghi danh CHỈ khi không có dòng đơn", () => {
  it("hình dạng `where`", () => {
    expect(dieuKienHoanCuaDon(["don1"], TRANG_THAI_HOAN_CAN_NAP)).toEqual({
      status: { in: ["PENDING", "APPROVED", "PAID"] },
      OR: [
        { orderItem: { orderId: { in: ["don1"] } } },
        {
          orderItemId: null,
          enrollment: {
            OR: [
              { orderItems: { some: { orderId: { in: ["don1"] } } } },
              { payments: { some: { orderId: { in: ["don1"] }, deletedAt: null } } },
            ],
          },
        },
      ],
    });
  });
});

// ── 29/09 — CỜ HOÀN THEO KHOẢN, KHÔNG THEO CẢ ĐƠN ──────────────────────────────────────────────────────
// Đơn 2 bé: bé A (dòng oi-a, ghi danh gd-a), bé B (oi-b, gd-b).
const KA: PhamViKhoan = { orderItemId: "oi-a", enrollmentId: "gd-a" };
const KB: PhamViKhoan = { orderItemId: "oi-b", enrollmentId: "gd-b" };
const hoanA = (phamVi: YeuCauHoanVao["phamVi"]) => ({ phamVi });

describe("[HTD-05] yêu cầu hoàn chỉ chạm khoản CÙNG con", () => {
  it("hoàn bé A (theo dòng đơn / theo ghi danh) ⇒ chạm khoản bé A, KHÔNG chạm khoản bé B; hoá đơn gộp cả hai ⇒ chạm", () => {
    for (const pv of [
      { orderItemIds: ["oi-a"], enrollmentIds: [] },
      { orderItemIds: [], enrollmentIds: ["gd-a"] },
      { orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] },
    ]) {
      expect(hoanAnhHuongKhoan(hoanA(pv), [KA]), JSON.stringify(pv)).toBe(true);
      expect(hoanAnhHuongKhoan(hoanA(pv), [KB]), JSON.stringify(pv)).toBe(false);
      expect(hoanAnhHuongKhoan(hoanA(pv), [KA, KB]), JSON.stringify(pv)).toBe(true);
    }
  });

  it("chỉ cần MỘT chiều trùng: khoản chỉ có ghi danh, yêu cầu có cả hai ⇒ so theo ghi danh", () => {
    const pv = { orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] };
    expect(hoanAnhHuongKhoan(hoanA(pv), [{ orderItemId: null, enrollmentId: "gd-a" }])).toBe(true);
    expect(hoanAnhHuongKhoan(hoanA(pv), [{ orderItemId: null, enrollmentId: "gd-b" }])).toBe(false);
    expect(hoanAnhHuongKhoan(hoanA(pv), [{ orderItemId: "oi-b", enrollmentId: null }])).toBe(false);
  });

  it("MƠ HỒ ⇒ theo cả đơn (thà báo thừa): yêu cầu không móc con nào; khoản chưa gắn con; không có chiều chung; tập khoản rỗng", () => {
    expect(hoanAnhHuongKhoan(hoanA({ orderItemIds: [], enrollmentIds: [] }), [KB])).toBe(true);
    expect(hoanAnhHuongKhoan(hoanA({ orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] }), [{ orderItemId: null, enrollmentId: null }])).toBe(true);
    // Yêu cầu chỉ móc DÒNG ĐƠN, khoản chỉ móc GHI DANH ⇒ không so được ⇒ chạm.
    expect(hoanAnhHuongKhoan(hoanA({ orderItemIds: ["oi-a"], enrollmentIds: [] }), [{ orderItemId: null, enrollmentId: "gd-b" }])).toBe(true);
    expect(hoanAnhHuongKhoan(hoanA({ orderItemIds: ["oi-a"], enrollmentIds: [] }), [])).toBe(true);
  });

  it("lyDoHoanChanXacNhan + yeuCauHoanCuaKhoan dùng CÙNG phép lọc", () => {
    const ds = [yc({ status: "PENDING", phamVi: { orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] } })];
    expect(lyDoHoanChanXacNhan(ds, [KB])).toBeNull();
    expect(lyDoHoanChanXacNhan(ds, [KA])).toBe(CAU_HOAN_CHAN_XAC_NHAN);
    expect(yeuCauHoanCuaKhoan(ds, [KB])).toEqual([]);
    expect(yeuCauHoanCuaKhoan(ds, [KA, KB])).toHaveLength(1);
  });
});

describe("[HTD-06] phạm vi của một yêu cầu — móc trực tiếp + nới qua quan hệ", () => {
  it("móc dòng đơn có ghi danh ⇒ cả hai chiều; KHÔNG nới sang dòng đơn khác của ghi danh", () => {
    const r = hoanTheoDon([
      hang({
        orderItemId: "oi-a",
        enrollmentId: null,
        orderItem: { orderId: "don1", itemName: "Sata 5 — A", enrollmentId: "gd-a" },
        enrollment: { student: { name: "A" }, orderItems: [{ orderId: "don1", id: "oi-khac" }], payments: [] },
      }),
    ]).get("don1")![0]!;
    expect(r.phamVi).toEqual({ orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] });
  });

  it("chỉ móc ghi danh ⇒ nới sang dòng đơn của ghi danh trên đơn", () => {
    const r = hoanTheoDon([
      hang({ enrollment: { student: { name: "Bé An" }, orderItems: [{ orderId: "don1", id: "oi-an" }], payments: [] } }),
    ]).get("don1")![0]!;
    expect(r.phamVi).toEqual({ orderItemIds: ["oi-an"], enrollmentIds: ["gd-an"] });
  });
});
