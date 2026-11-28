// @vitest-environment node
// lib/ai-lead/tu-choi.test.ts — BỘ ĐẾM yêu cầu bị từ chối: gộp theo khoá, chặn độ lớn, xả bằng upsert tăng dần, không ném lỗi, không lưu gì ngoài (ngày · endpoint · mã · agentId).
//
// Mã ca: [AIL-TC-01..]. DB giả — tầng Postgres thật ở tests/ai-lead/tu-choi.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mk = vi.hoisted(() => ({ upsert: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: { aiLeadRejectCounter: { upsert: mk.upsert, findMany: mk.findMany, deleteMany: mk.deleteMany } } }));

import { choTest, docTuChoiGanDay, donBoDemCu, ghiNhanTuChoi, KHOANG_XA_MS, TRAN_KHOA_DEM, xaBoDem } from "./tu-choi";

// 2026-10-28 03:00 UTC = 10:00 giờ VN (cùng ngày lịch VN và UTC).
const NOW = Date.UTC(2026, 9, 28, 3, 0, 0);
const NGAY_28 = new Date(Date.UTC(2026, 9, 28));

beforeEach(() => {
  choTest.datLai();
  mk.upsert.mockReset();
  mk.upsert.mockResolvedValue({});
  mk.findMany.mockReset();
  mk.deleteMany.mockReset();
  mk.deleteMany.mockResolvedValue({ count: 0 });
});

const ghi = (o: Partial<Parameters<typeof ghiNhanTuChoi>[0]> = {}) =>
  ghiNhanTuChoi({ batGhi: true, endpoint: "leadIntakes", ma: "BAD_SIGNATURE", agentId: null, nowMs: NOW, ...o });

describe("[AIL-TC-01] cờ tắt ⇒ không chạm bộ đệm, không chạm DB", () => {
  it("batGhi=false ⇒ bộ đệm rỗng, không xả", async () => {
    for (let i = 0; i < 50; i++) ghi({ batGhi: false });
    expect(choTest.kichThuoc()).toBe(0);
    await Promise.resolve();
    expect(mk.upsert).not.toHaveBeenCalled();
  });
});

describe("[AIL-TC-02] gộp theo (ngày VN · endpoint · mã · agentId); agentId trống khi chưa xác thực", () => {
  it("hàng nghìn lần cùng khoá ⇒ MỘT upsert với count = số lần (không phải hàng nghìn phép ghi)", async () => {
    for (let i = 0; i < 1000; i++) ghi({ nowMs: NOW + i });
    expect(choTest.kichThuoc()).toBe(1);
    await xaBoDem();
    const tong = mk.upsert.mock.calls.reduce((s, c) => s + (c[0].create.count as number), 0);
    expect(tong).toBe(1000);
    expect(mk.upsert.mock.calls.length, "một khoá ⇒ đúng một phép ghi").toBe(1);
    for (const c of mk.upsert.mock.calls) {
      expect(c[0].where.day_endpoint_code_agentId).toMatchObject({ day: NGAY_28, endpoint: "leadIntakes", code: "BAD_SIGNATURE", agentId: "" });
    }
  });
  it("khoá khác nhau (endpoint · mã · agent) ⇒ dòng khác nhau", async () => {
    ghi();
    ghi({ endpoint: "catalog" });
    ghi({ ma: "RATE_LIMITED" });
    ghi({ agentId: "ag1" });
    ghi({ agentId: "ag1" });
    expect(choTest.kichThuoc()).toBe(4);
  });
  it("ngày theo giờ VN: 18:00 UTC (= 01:00 VN hôm sau) thuộc NGÀY VN KẾ TIẾP", async () => {
    ghi({ nowMs: Date.UTC(2026, 9, 28, 18, 0, 0) });
    await xaBoDem();
    expect(mk.upsert.mock.calls[0]![0].create.day).toEqual(new Date(Date.UTC(2026, 9, 29)));
  });
  it("tham số `create`/`update` chỉ mang các cột cho phép — không có chỗ để IP/header/thân/chữ ký", async () => {
    ghi({ agentId: "ag1" });
    await xaBoDem();
    const c = mk.upsert.mock.calls[0]![0];
    expect(Object.keys(c.create).sort()).toEqual(["agentId", "code", "count", "day", "endpoint", "firstAt", "lastAt"]);
    expect(Object.keys(c.update).sort()).toEqual(["count", "lastAt"]);
    expect(c.update.count).toEqual({ increment: 1 });
  });
});

describe("[AIL-TC-03] độ lớn bị chặn", () => {
  it("vượt TRAN_KHOA_DEM khoá khác nhau ⇒ phần thừa bị bỏ và đếm daRoi, bộ nhớ không phình", () => {
    for (let i = 0; i < TRAN_KHOA_DEM + 40; i++) ghi({ agentId: `ag${i}` });
    expect(choTest.kichThuoc()).toBe(TRAN_KHOA_DEM);
    expect(choTest.daRoi()).toBe(40);
  });
  it("khoá ĐÃ CÓ vẫn cộng dồn dù bộ đệm đầy", async () => {
    for (let i = 0; i < TRAN_KHOA_DEM; i++) ghi({ agentId: `ag${i}` });
    ghi({ agentId: "ag0" });
    expect(choTest.daRoi()).toBe(0);
  });
});

describe("[AIL-TC-04] xả: lỗi DB không ném, không mất số đếm", () => {
  it("upsert lỗi ⇒ xaBoDem KHÔNG ném; phần chưa ghi trả về bộ đệm để lần sau ghi lại", async () => {
    ghi();
    ghi({ ma: "CLOCK_SKEW", agentId: "ag1" });
    mk.upsert.mockReset();
    mk.upsert.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED 10.0.0.9:5432 user=satarobo password=hunter2"), { code: "P1001" }));
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(xaBoDem()).resolves.toBe(0);
    expect(choTest.kichThuoc()).toBe(2);
    // chỉ log MÃ lỗi — không log nội dung thông điệp (có thể kèm chuỗi kết nối)
    const dongLog = loi.mock.calls.map((c) => String(c[0])).join("\n");
    expect(dongLog).not.toContain("hunter2");
    expect(dongLog).not.toContain("10.0.0.9");
    loi.mockRestore();
    mk.upsert.mockReset();
    mk.upsert.mockResolvedValue({});
    await expect(xaBoDem()).resolves.toBe(2);
  });
  it("hai lần xả chồng nhau ⇒ lần sau bỏ qua (không ghi đôi)", async () => {
    ghi();
    let mo!: () => void;
    mk.upsert.mockImplementationOnce(() => new Promise((r) => { mo = () => r({}); }));
    const a = xaBoDem();
    ghi({ ma: "RATE_LIMITED" });
    const b = await xaBoDem();
    expect(b).toBe(0);
    mo();
    await a;
  });
});

describe("[AIL-TC-05] dọn và đọc", () => {
  it("donBoDemCu xoá `day` < (hôm nay VN − số ngày giữ)", async () => {
    mk.deleteMany.mockResolvedValue({ count: 4 });
    expect(await donBoDemCu(NOW, 30)).toBe(4);
    expect(mk.deleteMany).toHaveBeenCalledWith({ where: { day: { lt: new Date(Date.UTC(2026, 8, 28)) } } });
  });
  it("docTuChoiGanDay: gộp theo agent; agentId '' là phần CHƯA xác thực; sắp theo số lần giảm dần", async () => {
    mk.findMany.mockResolvedValue([
      { code: "BAD_SIGNATURE", agentId: "", count: 30 },
      { code: "BAD_REQUEST", agentId: "", count: 5 },
      { code: "RATE_LIMITED", agentId: "ag1", count: 2 },
      { code: "CLOCK_SKEW", agentId: "ag1", count: 7 },
      { code: "CLOCK_SKEW", agentId: "ag2", count: 1 },
    ]);
    const r = await docTuChoiGanDay(NOW);
    expect(mk.findMany).toHaveBeenCalledWith({ where: { day: { gte: new Date(Date.UTC(2026, 9, 27)) } }, select: { code: true, agentId: true, count: true } });
    expect(r.chuaXacThuc).toEqual({ tong: 35, theoMa: [{ ma: "BAD_SIGNATURE", n: 30 }, { ma: "BAD_REQUEST", n: 5 }] });
    expect(r.theoAgent.get("ag1")).toEqual({ tong: 9, theoMa: [{ ma: "CLOCK_SKEW", n: 7 }, { ma: "RATE_LIMITED", n: 2 }] });
    expect(r.theoAgent.get("ag2")?.tong).toBe(1);
    expect(r.theoAgent.has("")).toBe(false);
  });
});


describe("[AIL-TC-06] xả bằng HẸN GIỜ — không cần có yêu cầu hỏng tiếp theo", () => {
  afterEach(() => vi.useRealTimers());

  it("một lời ghi rồi IM LẶNG ⇒ đúng một hẹn giờ; hết KHOANG_XA_MS có đúng một upsert mà không ai gọi xaBoDem", async () => {
    vi.useFakeTimers();
    ghi();
    expect(choTest.coHenGio()).toBe(true);
    await vi.advanceTimersByTimeAsync(KHOANG_XA_MS - 1);
    expect(mk.upsert).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mk.upsert).toHaveBeenCalledTimes(1);
    expect(choTest.kichThuoc()).toBe(0);
    expect(choTest.coHenGio()).toBe(false);
  });
  it("hàng trăm lời ghi trong cùng cửa sổ ⇒ vẫn MỘT hẹn giờ (không bão hẹn giờ)", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 300; i++) ghi({ nowMs: NOW + i, agentId: `ag${i % 7}` });
    expect(vi.getTimerCount()).toBe(1);
  });
  it("lỗi DB khi xả ⇒ phần chưa ghi được HẸN lại và ghi ở lượt sau (không đợi lời ghi mới)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mk.upsert.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "P1001" }));
    ghi();
    await vi.advanceTimersByTimeAsync(KHOANG_XA_MS);
    expect(choTest.kichThuoc()).toBe(1);
    expect(choTest.coHenGio()).toBe(true);
    await vi.advanceTimersByTimeAsync(KHOANG_XA_MS);
    expect(mk.upsert).toHaveBeenCalledTimes(2);
    expect(choTest.kichThuoc()).toBe(0);
  });
  it("cờ tắt ⇒ KHÔNG có hẹn giờ nào", () => {
    vi.useFakeTimers();
    ghi({ batGhi: false });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("[AIL-TC-07] hai BẢN module (mỗi điểm vào của Next một bản) dùng CHUNG một bộ đệm", () => {
  it("lời ghi ở bản A xả được từ bản B (route cron xả được lời ghi của route Gateway)", async () => {
    const banB = await (async () => {
      vi.resetModules();
      return import("./tu-choi");
    })();
    expect(banB.ghiNhanTuChoi).not.toBe(ghiNhanTuChoi); // đúng là hai bản
    ghi();
    expect(banB.choTest.kichThuoc()).toBe(1);
    expect(await banB.xaBoDem()).toBe(1);
    expect(mk.upsert).toHaveBeenCalledTimes(1);
    expect(choTest.kichThuoc()).toBe(0);
  });
});
