// @vitest-environment node
/**
 * `xemTruocGiaPhamViAction` — action CHỈ ĐỌC cho form tạo đơn (unit, mock-based: chạy trong job `Unit tests` không có Postgres).
 * Phần chạm Postgres thật: `tests/finance/don-pham-vi-db.test.ts` ([P6-DB-*]).
 *
 * Canh bốn điều: (1) gác như action tạo đơn (đăng nhập, `orders:create`, cơ sở trong tầm nhìn) VÀ gác TRƯỚC mọi truy vấn;
 * (2) cờ TẮT ⇒ LEGACY sau đúng một lần hỏi cờ; (3) cờ BẬT ⇒ số máy chủ tính, không phụ thuộc đơn giá client gõ;
 * (4) không ghi gì — không đụng `@/lib/db` trần, `scopedDb` chỉ lộ MỘT câu đọc `course.findMany`.
 *
 * Ngày TUYỆT ĐỐI (luật 19): cửa sổ PL02 kết thúc 31/12/2026.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  courseFindMany: vi.fn(),
  orgUnitIdForCenter: vi.fn(),
  co: { v: false as unknown },
  khoaCo: { v: "" },
  getSettingCalls: [] as string[],
  /** [khoá, tuỳ chọn] — để ca [P6-24] chứng minh `orgUnitId` ĐƯỢC TRUYỀN (bỏ trống ⇒ chỉ đọc mức toàn cục, QLCS chỉnh mà form vẫn báo số chung). */
  getSettingOpts: [] as Array<[string, unknown]>,
  tranPhamVi: { v: 25 as number },
  moModelKhac: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
// `scopedDb` chỉ lộ MỘT câu đọc. Chạm model nào khác (ghi hay đọc) ⇒ ghi lại tên để ca "không ghi gì" đếm.
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(
    () =>
      new Proxy({ course: { findMany: h.courseFindMany } } as Record<string, unknown>, {
        get(t, k: string) {
          if (k in t) return t[k];
          h.moModelKhac.push(k);
          return new Proxy({}, { get: () => () => Promise.reject(new Error(`chạm ${k} trong action chỉ đọc`)) });
        },
      }),
  ),
}));
// `@/lib/db` trần: dùng là lỗi (action chỉ được đi qua scopedDb).
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_t, k) => {
        throw new Error(`db trần bị dùng: ${String(k)}`);
      },
    },
  ),
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgUnitIdForCenter }));
vi.mock("@/lib/settings/service", () => ({
  getSetting: vi.fn(async (key: string, opts?: unknown) => {
    h.getSettingCalls.push(key);
    h.getSettingOpts.push([key, opts]);
    if (key === h.khoaCo.v) return h.co.v;
    if (key === "billing.scopeMaxDiscountPercent") return h.tranPhamVi.v;
    if (key === "orders.maxInstallments") return 4;
    if (key === "orders.maxDiscountItems") return 1;
    if (key === "pricing.policyDateBasis") return "ORDER_CREATED";
    if (key === "pricing.sameTimeChildOrder") return "LOWER_VALUE_FIRST";
    return 50;
  }),
}));

import { xemTruocGiaPhamViAction } from "./_pham-vi-actions";
import { KHOA_CONG_TAC_PHAM_VI } from "@/lib/entitlements/feature";
import { thongBaoDonTron } from "@/lib/orders/pham-vi/phan-loai";

const SATA3 = { id: "c-sata3", price: 10_560_000, totalSessions: 48 };
const SATA1 = { id: "c-sata1", price: 5_200_003, totalSessions: 11 };

type Dong = Record<string, unknown>;
const dong = (o: Dong = {}): Dong => ({
  type: "COURSE_ENROLLMENT",
  itemName: "Sata 3",
  quantity: 1,
  unitPrice: 0,
  leadChildId: "lc-a",
  metadata: { courseId: SATA3.id, soBuoi: 48 },
  ...o,
});
const vao = (items: Dong[], o: Dong = {}) => ({ centerId: "cs1", items, ...o });
const daHoiCo = () => h.getSettingCalls.filter((k) => k === h.khoaCo.v);

beforeAll(() => {
  h.khoaCo.v = KHOA_CONG_TAC_PHAM_VI;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  h.getSettingCalls.length = 0;
  h.getSettingOpts.length = 0;
  h.tranPhamVi.v = 25;
  h.moModelKhac.length = 0;
  h.co.v = true;
  h.auth.mockResolvedValue({ user: { id: "u-sale" } });
  h.checkPermission.mockResolvedValue(true);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.courseFindMany.mockResolvedValue([SATA3, SATA1]);
  h.orgUnitIdForCenter.mockResolvedValue("org-cs1");
});

describe("[P6-20] gác TRƯỚC mọi truy vấn", () => {
  it("chưa đăng nhập ⇒ { ok:false }, không tra khoá, không hỏi cờ", async () => {
    h.auth.mockResolvedValue(null);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toEqual({ ok: false, error: "Chưa đăng nhập" });
    expect(h.courseFindMany).not.toHaveBeenCalled();
    expect(daHoiCo()).toHaveLength(0);
  });
  it("thiếu quyền `orders:create` ⇒ { ok:false }, không tra khoá, không hỏi cờ; [đối chứng] có quyền thì chạy", async () => {
    h.checkPermission.mockResolvedValue(false);
    const kq = await xemTruocGiaPhamViAction(vao([dong()]));
    expect(kq).toMatchObject({ ok: false });
    expect(h.checkPermission).toHaveBeenCalledWith("orders:create");
    expect(h.courseFindMany).not.toHaveBeenCalled();
    expect(daHoiCo()).toHaveLength(0);

    h.checkPermission.mockResolvedValue(true);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toMatchObject({ ok: true, kieu: "SCOPE" });
  });
  it("cơ sở ngoài tầm nhìn ⇒ { ok:false }, không tra khoá, không hỏi cờ; [đối chứng] trong tầm nhìn thì chạy", async () => {
    h.passesScope.mockReturnValue(false);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toMatchObject({ ok: false });
    expect(h.passesScope).toHaveBeenCalledWith("Order", { centerId: "cs1" }, { userId: "u-sale" });
    expect(h.courseFindMany).not.toHaveBeenCalled();
    expect(daHoiCo()).toHaveLength(0);

    h.passesScope.mockReturnValue(true);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toMatchObject({ ok: true, kieu: "SCOPE" });
  });
  it("payload hỏng ⇒ { ok:false, 'Dữ liệu không hợp lệ' }, không tra khoá", async () => {
    for (const x of [null, {}, { centerId: "cs1", items: [] }, { centerId: "cs1", items: [{ type: "X" }] }]) {
      expect(await xemTruocGiaPhamViAction(x)).toEqual({ ok: false, error: "Dữ liệu không hợp lệ" });
    }
    expect(h.courseFindMany).not.toHaveBeenCalled();
  });
  it("[P7-18] số buổi vượt trần 500 (ô đang mang 48, gõ thêm ⇒ 4824) ⇒ action trả CÂU CỦA SCHEMA kèm dòng, không tra khoá; [đối chứng] 24 buổi thì chạy", async () => {
    const kq = await xemTruocGiaPhamViAction(vao([dong({ metadata: { courseId: SATA3.id, soBuoi: 4824 } })]));
    expect(kq).toEqual({ ok: false, error: "Dòng 1: Số buổi phải là số nguyên từ 1 đến 500" });
    expect(h.courseFindMany).not.toHaveBeenCalled();
    expect(daHoiCo()).toHaveLength(0);
    expect(await xemTruocGiaPhamViAction(vao([dong({ metadata: { courseId: SATA3.id, soBuoi: 24 } })]))).toMatchObject({ ok: true });
  });
});

describe("[P6-21] cờ TẮT ⇒ LEGACY sau đúng một lần hỏi cờ", () => {
  it.each([false, 50, null, "true"] as const)("cờ = %s", async (v) => {
    h.co.v = v;
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toEqual({ ok: true, kieu: "LEGACY" });
    expect(daHoiCo()).toHaveLength(1);
    expect(h.getSettingCalls).toEqual([KHOA_CONG_TAC_PHAM_VI]); // không đọc mốc ngày / thứ tự con
  });
  it("cơ sở chưa ánh xạ OrgUnit hoặc đơn không gắn cơ sở ⇒ LEGACY và KHÔNG đọc cờ", async () => {
    h.orgUnitIdForCenter.mockResolvedValue(null);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toEqual({ ok: true, kieu: "LEGACY" });
    expect(await xemTruocGiaPhamViAction(vao([dong()], { centerId: null }))).toEqual({ ok: true, kieu: "LEGACY" });
    expect(daHoiCo()).toHaveLength(0);
  });
});

describe("[P6-24] NGƯỠNG của cơ sở đơn đi kèm kết quả SCOPE — đọc bằng orgUnitId", () => {
  it("SCOPE ⇒ nguong đủ bốn số; ba khoá cài-riêng-theo-cơ-sở được đọc VỚI { orgUnitId }, trần từng khoản (không cài riêng) thì không", async () => {
    h.tranPhamVi.v = 20;
    const kq = await xemTruocGiaPhamViAction(vao([dong()]));
    expect(kq).toMatchObject({ ok: true, kieu: "SCOPE", nguong: { tranGiamPhamVi: 20, tranSoDot: 4, tranUuDaiMoiDong: 1, tranTungKhoan: 50 } });
    const doc = (k: string) => h.getSettingOpts.filter(([key]) => key === k);
    for (const k of ["billing.scopeMaxDiscountPercent", "orders.maxInstallments", "orders.maxDiscountItems"]) {
      expect(doc(k), k).toEqual([[k, { orgUnitId: "org-cs1" }]]);
    }
    expect(doc("orders.maxDiscountPercent")).toHaveLength(1);
  });
  it("LEGACY / REJECT ⇒ KHÔNG đọc thêm bất kỳ ngưỡng nào (đơn thường không tốn thêm câu tra)", async () => {
    await xemTruocGiaPhamViAction(vao([dong({ itemName: "Sata 1", metadata: { courseId: SATA1.id, soBuoi: 11 } })]));
    await xemTruocGiaPhamViAction(
      vao([dong(), dong({ itemName: "Sata 1", leadChildId: "lc-b", metadata: { courseId: SATA1.id, soBuoi: 11 } })]),
    );
    for (const k of ["billing.scopeMaxDiscountPercent", "orders.maxInstallments", "orders.maxDiscountItems", "orders.maxDiscountPercent"]) {
      expect(h.getSettingCalls, k).not.toContain(k);
    }
  });
});

describe("[P6-22] cờ BẬT ⇒ số do MÁY CHỦ tính, đơn giá client gõ không ảnh hưởng", () => {
  it("Sata 3 đủ 48 buổi ⇒ SCOPE 8.976.000đ — dù client gửi 0, niêm yết hay số bất kỳ", async () => {
    const ra = await Promise.all([0, 10_560_000, 1].map((g) => xemTruocGiaPhamViAction(vao([dong({ unitPrice: g })]))));
    for (const kq of ra) {
      expect(kq).toMatchObject({
        ok: true,
        kieu: "SCOPE",
        dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, thanhTien: 8_976_000 }],
      });
    }
  });
  it("đơn trộn ⇒ REJECT bằng đúng câu của planner; [20/10/2026] khoản giảm tay KHÔNG còn bị REJECT — xem trước vẫn ra SCOPE đúng giá chính sách", async () => {
    const tron = await xemTruocGiaPhamViAction(
      vao([dong(), dong({ itemName: "Sata 1", leadChildId: "lc-b", metadata: { courseId: SATA1.id, soBuoi: 11 } })]),
    );
    expect(tron).toEqual({ ok: true, kieu: "REJECT", thongBao: thongBaoDonTron(["Dòng 2 (Sata 1)"]) });
    const giam = await xemTruocGiaPhamViAction(
      vao([dong({ discounts: [{ kieu: "PHAN_TRAM", giaTri: 5, lyDo: "Bạn của giáo viên" }] })]),
    );
    expect(giam).toMatchObject({ ok: true, kieu: "SCOPE", dong: [{ thanhTien: 8_976_000 }] });
  });
  it("[đối chứng] cờ bật nhưng đơn không có dòng 48 buổi ⇒ LEGACY", async () => {
    const kq = await xemTruocGiaPhamViAction(vao([dong({ itemName: "Sata 1", metadata: { courseId: SATA1.id, soBuoi: 11 } })]));
    expect(kq).toEqual({ ok: true, kieu: "LEGACY" });
  });
});

describe("[P6-23] chỉ ĐỌC", () => {
  it("chạy trọn đường SCOPE mà không chạm model nào ngoài `course`, không dùng `db` trần (Proxy ném nếu dùng)", async () => {
    await xemTruocGiaPhamViAction(vao([dong()]));
    await xemTruocGiaPhamViAction(vao([dong({ quantity: 2 })]));
    expect(h.moModelKhac).toEqual([]);
    expect(h.courseFindMany).toHaveBeenCalledTimes(2);
    // Câu tra duy nhất là `select` đọc — không có `data`/`create`/`update` nào trong lời gọi.
    for (const [a] of h.courseFindMany.mock.calls) expect(Object.keys(a as object).sort()).toEqual(["select", "where"]);
  });
});

describe("[PB-E] centerId null / OrgUnit trống — hai nhánh LEGACY khác nhau", () => {
  it("[PB-E1] centerId null ⇒ LEGACY, KHÔNG hỏi OrgUnit, KHÔNG đọc cờ (dù orgUnitIdForCenter có trả về giá trị)", async () => {
    h.orgUnitIdForCenter.mockResolvedValue("org-cs1");
    expect(await xemTruocGiaPhamViAction(vao([dong()], { centerId: null }))).toEqual({ ok: true, kieu: "LEGACY" });
    expect(h.orgUnitIdForCenter).not.toHaveBeenCalled();
    expect(daHoiCo()).toHaveLength(0);
  });
  it("[PB-E2] centerId có nhưng OrgUnit trống ⇒ LEGACY, KHÔNG đọc cờ", async () => {
    h.orgUnitIdForCenter.mockResolvedValue(null);
    expect(await xemTruocGiaPhamViAction(vao([dong()]))).toEqual({ ok: true, kieu: "LEGACY" });
    expect(h.orgUnitIdForCenter).toHaveBeenCalledTimes(1);
    expect(daHoiCo()).toHaveLength(0);
  });
});
