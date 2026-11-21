/**
 * Bộ điều phối của service worker — chạy TÍCH HỢP trên "máy agent" giả:
 * content script THẬT (node:vm) ⇄ portal giả ⇄ bộ điều phối THẬT ⇄ satarobo giả (kiểm HMAC
 * độc lập bằng node:crypto). Đồng hồ do test đặt (luật 19).
 *
 * Các cổng đặc tả GĐ5 được kiểm ở đây: phân trang + gửi lô đúng hợp đồng; payload sạch;
 * 3 tín hiệu hết phiên ⇒ SESSION_EXPIRED đúng một lần + ngừng gọi; READY ⇒ quét bù đúng cửa
 * sổ; options không trả bí mật; dừng hẳn khi bí mật sai; giữ đúng một tab portal ghim.
 */
import { describe, expect, it } from "vitest";
import { dinhDangGioVN, isoVN } from "../src/lib/gio-vn";
import { KHOA_GIAO_DICH, timKhoaCam } from "../src/lib/payload";
import {
  AGENT_ID,
  BI_MAT,
  GIO,
  MERCHANT,
  MERCHANT_KHAC,
  PHUT,
  PORTAL,
  T0,
  URL_PHIEN,
  URL_TIM_KIEM,
  dongPortal,
  nhieuDong,
  timChuoiCam,
} from "./ho-tro/du-lieu";
import { taoMayAgent, type MayAgent } from "./ho-tro/may-agent";
import type { YeuCauNhan } from "./ho-tro/satarobo-gia";

const ms = (iso: string) => Date.parse(iso);
const JOB_ID = "cm9posjob0000000000000001";

function status(m: MayAgent): Array<{ state: string; reason: string }> {
  return m.satarobo
    .daNhan("/api/pos-agent/status")
    .map((y) => y.json as { state: string; reason: string })
    .map((j) => ({ state: j.state, reason: j.reason }));
}

function lo(m: MayAgent): Array<{
  syncId: string;
  batchIndex: number;
  final: boolean;
  windowFrom: string;
  windowTo: string;
  jobIds: string[];
  transactions: Array<Record<string, unknown>>;
}> {
  return m.satarobo.daNhan("/api/pos-agent/transactions").map((y) => y.json as never);
}

/** Lời gọi search do EXTENSION làm (page_size 50) — lời gọi của chính app (page_size 10) không tính. */
function timKiemCuaExt(m: MayAgent) {
  const ra: Array<{ page_index: number; transaction_time_from: string; transaction_time_to: string }> = [];
  for (const g of m.portal.goiTimKiem()) {
    let b: { page_size?: number; page_index: number; transaction_time_from: string; transaction_time_to: string };
    try {
      b = JSON.parse(g.body ?? "{}");
    } catch {
      continue; // thân của CHÍNH app (vd bị mã hoá) — không phải lời gọi của extension
    }
    if (b.page_size === 50) ra.push(b);
  }
  return ra;
}

async function khoiDongSan(m: MayAgent) {
  await m.bdp.khoiDong("STARTUP");
  await m.xong();
}

describe("Khởi động + đồng bộ lần đầu", () => {
  it("[EXT-BDP-01] khởi động: heartbeat → SESSION_READY (EXTENSION_START) một lần → quét 3 ngày theo mảnh ≤24h → lô cuối final; lưu lastSyncedAt", async () => {
    const m = await taoMayAgent();
    m.portal.giaoDich = [
      dongPortal({ transaction_id: "TXN20261005000001", transaction_time: "2026/10/05 09:00:00" }),
      dongPortal({ transaction_id: "TXN20261007000002", transaction_time: "2026/10/07 10:18:42" }),
    ];
    await khoiDongSan(m);

    const duong = m.satarobo.daNhan().map((y) => y.duongDan);
    expect(duong[0]).toBe("/api/pos-agent/heartbeat");
    expect(status(m)).toEqual([{ state: "SESSION_READY", reason: "EXTENSION_START" }]);
    const ext = timKiemCuaExt(m);
    expect(ext.map((b) => [b.transaction_time_from, b.transaction_time_to, b.page_index])).toEqual([
      ["2026-10-04 00:00:00", "2026-10-05 00:00:00", 0],
      ["2026-10-05 00:00:00", "2026-10-06 00:00:00", 0],
      ["2026-10-06 00:00:00", "2026-10-07 00:00:00", 0],
      // RV5: mốc cuối = giờ (đã hiệu chỉnh) + biên 2′ — phủ lần quẹt ngay trước lúc đọc; lastSyncedAt KHÔNG cộng biên
      ["2026-10-07 00:00:00", "2026-10-07 10:22:00", 0],
    ]);
    const l = lo(m);
    expect(l.map((x) => [x.batchIndex, x.final, x.windowFrom, x.transactions.length])).toEqual([
      [0, false, "2026-10-05 00:00:00", 1],
      [1, true, "2026-10-07 00:00:00", 1],
    ]);
    expect(new Set(l.map((x) => x.syncId)).size).toBe(1);
    expect(l[0].syncId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0);
  });

  it("[EXT-BDP-02] payload tới satarobo SẠCH: chỉ khoá whitelist, không tên chủ thẻ / device_id / token / header / cookie ở BẤT KỲ request nào", async () => {
    const m = await taoMayAgent();
    m.portal.giaoDich = nhieuDong(7);
    await khoiDongSan(m);
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.bdp.nhipKeepalive();
    await m.xong();
    const tatCa = m.satarobo.yeuCau;
    expect(tatCa.length).toBeGreaterThan(4);
    for (const y of tatCa) {
      expect(timChuoiCam(y.than)).toBeNull();
      expect(timChuoiCam(y.headers)).toBeNull();
      expect(timKhoaCam(y.json)).toBeNull();
    }
    for (const x of lo(m)) {
      for (const r of x.transactions) for (const k of Object.keys(r)) expect(KHOA_GIAO_DICH).toContain(k);
    }
    expect(lo(m).flatMap((x) => x.transactions)).toHaveLength(7 + 7); // hai lượt, cửa sổ chồng lấn
  });

  it("[EXT-BDP-03] mọi request tới satarobo được máy chủ NHẬN (chữ ký kiểm bằng node:crypto), nonce không lặp, không gửi cookie", async () => {
    const m = await taoMayAgent();
    m.portal.giaoDich = nhieuDong(3);
    await khoiDongSan(m);
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    await m.xong();
    const ds = m.satarobo.yeuCau;
    expect(ds.every((y) => y.ma === null)).toBe(true);
    const nonce = ds.map((y) => y.headers["x-agent-nonce"]);
    expect(new Set(nonce).size).toBe(nonce.length);
    expect(ds.every((y) => y.headers["x-agent-contract"] === "1" && y.headers["x-agent-id"] === AGENT_ID)).toBe(true);
    expect(ds.every((y) => y.headers.cookie === undefined)).toBe(true);
  });

  it("[EXT-BDP-04] heartbeat mang MỐC exp + phiên bản + hồ sơ — không token; merchantCode server khớp", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.dongHo.now += 10 * PHUT;
    await m.bdp.nhipKeepalive();
    await m.xong();
    const hb = m.satarobo.daNhan("/api/pos-agent/heartbeat").at(-1)?.json;
    expect(hb).toEqual({
      extensionVersion: "0.1.0",
      sessionState: "READY",
      sessionExpiresAt: "2026-10-08T08:15:00+07:00",
      sessionExpiresSource: "ACCESS_TOKEN",
      lastSyncedAt: isoVN(T0),
      profileName: "CS1",
    });
  });
});

describe("Job + nhịp nhanh", () => {
  it("[EXT-BDP-05] job từ satarobo ⇒ đồng bộ NGAY với cửa sổ từ min(lastSyncedAt − 2h, scanFrom); lô cuối mang jobIds; job DONE", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.dongHo.now = T0 + PHUT;
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(T0 - 6 * GIO) }];
    await m.bdp.nhipPhut();
    await m.xong();
    const cuoi = timKiemCuaExt(m).at(-1);
    expect(cuoi?.transaction_time_from).toBe(dinhDangGioVN(T0 - 6 * GIO));
    const l = lo(m).at(-1);
    expect(l).toMatchObject({ final: true, jobIds: [JOB_ID] });
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
  });

  it("[EXT-BDP-06] nextPollMs 2000 ⇒ hẹn hỏi nhanh 2 giây; job tới trong chế độ nhanh ⇒ đồng bộ ngay; máy chủ về 60000 ⇒ thôi hẹn", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.henGio.cho.splice(0);
    m.dongHo.now = T0 + PHUT;
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now) }];
    // Có job ⇒ /jobs trả 2000; job xong ngay trong lượt ⇒ /transactions trả 60000.
    m.satarobo.nextPollRanh = 2000; // phiếu thu thẻ đang mở ⇒ máy chủ vẫn giữ nhịp nhanh
    await m.bdp.nhipPhut();
    await m.xong();
    expect(m.henGio.cho.map((h) => h.ms)).toEqual([2000]);
    // tick nhanh: job mới tới
    m.dongHo.now += 2000;
    m.satarobo.jobs = [{ id: "cm9posjob0000000000000002", createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now) }];
    m.henGio.chayMotLuot();
    await m.xong();
    expect(m.satarobo.daXongJob).toEqual([JOB_ID, "cm9posjob0000000000000002"]);
    expect(m.henGio.cho.map((h) => h.ms)).toEqual([2000]);
    // máy chủ về rảnh ⇒ lượt nhanh kế tiếp không hẹn thêm
    m.satarobo.nextPollRanh = 60_000;
    m.dongHo.now += 2000;
    m.henGio.chayMotLuot();
    await m.xong();
    expect(m.henGio.cho).toHaveLength(0);
  });

  it("[EXT-BDP-07] mất kết nối satarobo trong chế độ nhanh ⇒ vẫn hỏi mỗi 2s tới hết 120s kể từ lần 2000 cuối, rồi thôi", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.henGio.cho.splice(0);
    m.satarobo.nextPollRanh = 2000;
    m.dongHo.now = T0 + PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    const batDauNhanh = m.dongHo.now;
    m.satarobo.epTruoc = () => ({ status: 500, body: { ok: false, error: { code: "INTERNAL" } } });
    let luot = 0;
    while (m.henGio.cho.length > 0 && luot < 100) {
      m.dongHo.now += 2000;
      m.henGio.chayMotLuot();
      await m.bdp.choXong(); // chỉ hỏi satarobo (không chạm trang) ⇒ chờ hàng đợi là đủ
      luot++;
    }
    expect(m.dongHo.now - batDauNhanh).toBeLessThanOrEqual(122_000);
    expect(luot).toBeGreaterThanOrEqual(59);
  });
});

describe("Hết phiên — 3 tín hiệu ⇒ SESSION_EXPIRED đúng một lần + ngừng gọi API portal", () => {
  async function sauHetPhien(m: MayAgent) {
    const truocTim = timKiemCuaExt(m).length;
    const truocJobs = m.satarobo.daNhan("/api/pos-agent/jobs").length;
    const truocDieuHuong = m.trinhDuyet.dieuHuong.length;
    for (let i = 0; i < 4; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    m.dongHo.now += 10 * PHUT;
    await m.bdp.nhipKeepalive();
    await m.xong();
    return {
      timThem: timKiemCuaExt(m).length - truocTim,
      jobsThem: m.satarobo.daNhan("/api/pos-agent/jobs").length - truocJobs,
      hetPhien: status(m).filter((s) => s.state === "SESSION_EXPIRED"),
      // Đang chờ người đăng nhập lại: KHÔNG được tải lại / điều hướng tab (kéo người khỏi trang /login).
      dieuHuongThem: m.trinhDuyet.dieuHuong.length - truocDieuHuong,
    };
  }

  it("[EXT-BDP-08] tín hiệu 1 — session không có user ⇒ EXPIRED (NO_USER) một lần; không search; /jobs vẫn đều (máy còn sống)", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.portal.dangNhap = false;
    m.dongHo.now += 10 * PHUT;
    await m.bdp.nhipKeepalive();
    await m.xong();
    const r = await sauHetPhien(m);
    expect(r.hetPhien).toEqual([{ state: "SESSION_EXPIRED", reason: "NO_USER" }]);
    expect(r.timThem).toBe(0);
    expect(r.dieuHuongThem).toBe(0);
    expect(r.jobsThem).toBe(4);
  });

  it("[EXT-BDP-09] tín hiệu 2 — API search 401 ⇒ EXPIRED (HTTP_401) một lần; user còn mà không có phiên mới ⇒ KHÔNG nháy READY", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.portal.epTimKiem = "401";
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    const r = await sauHetPhien(m);
    expect(r.hetPhien).toEqual([{ state: "SESSION_EXPIRED", reason: "HTTP_401" }]);
    expect(r.timThem).toBe(0);
    expect(r.dieuHuongThem).toBe(0);
    expect(status(m).filter((s) => s.state === "SESSION_READY")).toHaveLength(1);
    const exp = m.satarobo.daNhan("/api/pos-agent/status").find((y) => (y.json as { state: string }).state === "SESSION_EXPIRED");
    expect(exp?.json).toMatchObject({ httpStatus: 401 });
  });

  it("[EXT-BDP-10] tín hiệu 3 — tab bị chuyển về /login ⇒ EXPIRED (REDIRECT_LOGIN) một lần; không search", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    const tabId = (await m.khoPhien.doc<number>("tabId")) ?? -1;
    m.portal.dangNhap = false;
    await m.trinhDuyet.moTrang(tabId, `${PORTAL}/login`);
    await m.xong();
    const r = await sauHetPhien(m);
    expect(r.hetPhien).toEqual([{ state: "SESSION_EXPIRED", reason: "REDIRECT_LOGIN" }]);
    expect(r.timThem).toBe(0);
    expect(r.dieuHuongThem).toBe(0);
  });

  it("[EXT-BDP-11] admin đăng nhập lại ⇒ SESSION_READY (USER_PRESENT) một lần + QUÉT BÙ từ min(lastSyncedAt − 2h, 00:00 hôm nay)", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0);
    m.portal.dangNhap = false;
    const tabId = (await m.khoPhien.doc<number>("tabId")) ?? -1;
    await m.trinhDuyet.moTrang(tabId, `${PORTAL}/login`);
    await m.xong();
    // sáng hôm sau 08:00, admin remote vào và đăng nhập
    m.dongHo.now = ms("2026-10-08T08:00:00+07:00");
    m.portal.dangNhap = true;
    m.portal.accessToken = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJib3QiLCJleHAiOjE3OTE1MTUyMDB9.chu-ky-moi";
    m.portal.giaoDich = [dongPortal({ transaction_id: "TXN20261007000555", transaction_time: "2026/10/07 19:30:00" })];
    await m.trinhDuyet.moTrang(tabId, `${PORTAL}/soft-pos-transaction`);
    await m.xong();
    expect(status(m)).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "REDIRECT_LOGIN" },
      { state: "SESSION_READY", reason: "USER_PRESENT" },
    ]);
    const cuoi = timKiemCuaExt(m).at(-1);
    expect(cuoi?.transaction_time_from).toBe("2026-10-07 08:20:00"); // T0 − 2h < 00:00 ngày 08
    expect(cuoi?.transaction_time_to).toBe("2026-10-08 08:02:00"); // + biên 2′ (RV5)
    const l = lo(m).at(-1);
    expect(l?.final).toBe(true);
    expect(l?.transactions.map((r) => r.transaction_id)).toEqual(["TXN20261007000555"]);
  });
});

describe("Header chưa bắt được / thân mã hoá / lỗi giữa lượt", () => {
  it("[EXT-BDP-12] HEADER_NOT_CAPTURED ⇒ tải lại tab MỘT lần ⇒ vẫn thiếu ⇒ ERROR một lần, không tải lại nữa; app gọi lại ⇒ tự khỏi", async () => {
    const m = await taoMayAgent();
    m.trinhDuyet.appGoiTimKiem = false;
    await khoiDongSan(m);
    for (let i = 0; i < 2; i++) m.henGio.chayMotLuot();
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    await m.xong();
    const taiLai = m.trinhDuyet.dieuHuong.filter((d) => d.kieu !== "create");
    expect(taiLai).toHaveLength(1);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "HEADER_NOT_CAPTURED" }]);
    // nhân viên bấm làm mới trên portal ⇒ app gọi search ⇒ header được bắt
    const tabId = (await m.khoPhien.doc<number>("tabId")) ?? -1;
    m.trinhDuyet.appGoiTimKiem = true;
    await m.trinhDuyet.moTrang(tabId, `${PORTAL}/soft-pos-transaction`);
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    expect(lo(m).some((x) => x.final)).toBe(true);
    const tt = await m.bdp.layTrangThai();
    expect(tt.loiMo).toEqual([]);
  });

  it("[EXT-BDP-13] thân search của app bị mã hoá ⇒ ERROR BODY_ENCRYPTED một lần, KHÔNG đoán thuật toán, không gửi giao dịch", async () => {
    const m = await taoMayAgent();
    m.trinhDuyet.thanApp = "U2FsdGVkX19tYS1ob2E=";
    m.portal.giaoDich = nhieuDong(2);
    await khoiDongSan(m);
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    await m.xong();
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "BODY_ENCRYPTED" }]);
    expect(lo(m)).toHaveLength(0);
    expect(timKiemCuaExt(m)).toHaveLength(0);
  });

  it("[EXT-BDP-14] hỏng GIỮA lượt (trang 3/3 lỗi 500) ⇒ lô đã đọc vẫn gửi (final:false), KHÔNG lô final, lastSyncedAt giữ nguyên, ERROR một lần", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.portal.giaoDich = nhieuDong(120, "10:15:00");
    m.portal.loi500TuTrang = 2;
    await khoiDongSan(m);
    const l = lo(m);
    expect(l.map((x) => [x.batchIndex, x.final, x.transactions.length])).toEqual([
      [0, false, 50],
      [1, false, 50],
    ]);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 - 30 * PHUT);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "PORTAL_HTTP_ERROR" }]);
    // hết lỗi ⇒ lượt sau đủ và final
    m.portal.loi500TuTrang = null;
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    const cuoi = lo(m).filter((x) => x.final);
    expect(cuoi).toHaveLength(1);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 + PHUT);
  });
});

describe("Dừng an toàn theo phản hồi của satarobo", () => {
  it("[EXT-BDP-15] 401 BAD_SIGNATURE ⇒ dừng MỌI lời gọi (portal + satarobo) tới khi dán lại cấu hình", async () => {
    const m = await taoMayAgent();
    m.satarobo.epTruoc = () => ({ status: 401, body: { ok: false, error: { code: "BAD_SIGNATURE" } } });
    await khoiDongSan(m);
    const truocPortal = m.portal.goi.length;
    const truocSata = m.satarobo.yeuCau.length;
    expect(truocSata).toBe(1);
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
      await m.bdp.nhipKeepalive();
    }
    await m.xong();
    expect(m.portal.goi.length).toBe(truocPortal);
    expect(m.satarobo.yeuCau.length).toBe(truocSata);
    const tt = await m.bdp.layTrangThai();
    expect(tt.dung).toBe("BAD_SIGNATURE");
    // dán lại bí mật ⇒ chạy lại
    m.satarobo.epTruoc = null;
    const kq = await m.bdp.luuCauHinh({
      cauHinh: { agentId: AGENT_ID, centerCode: "CS1", merchantCode: MERCHANT, satAroboBaseUrl: "https://admin.satarobo.vn" },
      biMatMoi: BI_MAT,
    });
    expect(kq.ok).toBe(true);
    await m.xong();
    expect((await m.bdp.layTrangThai()).dung).toBeNull();
    expect(m.satarobo.daNhan().length).toBeGreaterThan(0);
  });

  it("[EXT-BDP-16] merchantCode máy chủ ≠ cấu hình ⇒ ERROR MERCHANT_CONFIG_MISMATCH, KHÔNG gọi portal; /jobs vẫn giữ nhịp sống", async () => {
    const m = await taoMayAgent();
    m.satarobo.merchantCode = MERCHANT_KHAC;
    await khoiDongSan(m);
    for (let i = 0; i < 2; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    await m.xong();
    expect(m.portal.goi.filter((g) => g.url === URL_PHIEN)).toHaveLength(0);
    expect(timKiemCuaExt(m)).toHaveLength(0);
    expect(status(m)).toEqual([{ state: "ERROR", reason: "MERCHANT_CONFIG_MISMATCH" }]);
    expect(m.satarobo.daNhan("/api/pos-agent/jobs")).toHaveLength(2);
  });

  it("[EXT-BDP-17] lệch giờ > 5′ ⇒ 401 CLOCK_SKEW ⇒ ký lại với nonce MỚI + giờ máy chủ, gửi lại MỘT lần; sau đó không lệch nữa", async () => {
    const m = await taoMayAgent();
    m.satarobo.lechGioMayChu = 9 * PHUT;
    await khoiDongSan(m);
    const ds: YeuCauNhan[] = m.satarobo.yeuCau;
    expect(ds[0].ma).toBe("CLOCK_SKEW");
    expect(ds[1].ma).toBeNull();
    expect(ds[1].headers["x-agent-nonce"]).not.toBe(ds[0].headers["x-agent-nonce"]);
    expect(Number(ds[1].headers["x-agent-ts"])).toBe(T0 + 9 * PHUT);
    expect(ds.filter((y) => y.ma === "CLOCK_SKEW")).toHaveLength(1);
  });

  it("[EXT-BDP-18] KHÔNG chạy hai lượt đồng bộ song song: lô của mỗi syncId nằm liền nhau", async () => {
    const m = await taoMayAgent();
    m.portal.giaoDich = nhieuDong(80, "10:15:00");
    await khoiDongSan(m);
    m.dongHo.now += PHUT;
    const a = m.bdp.nhipPhut();
    const b = m.bdp.nhipPhut();
    const c = m.bdp.dongBoNgay();
    await Promise.all([a, b, c]);
    await m.xong();
    const thuTu = lo(m).map((x) => x.syncId);
    const doan: string[] = [];
    for (const s of thuTu) if (doan.at(-1) !== s) doan.push(s);
    expect(new Set(doan).size).toBe(doan.length);
  });
});

describe("Tab portal + trang Options", () => {
  it("[EXT-BDP-19] giữ ĐÚNG một tab portal ghim ở /soft-pos-transaction; đóng thì mở lại; không mở tab thứ hai", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
    }
    await m.xong();
    expect(m.trinhDuyet.soTab()).toBe(1);
    const id = (await m.khoPhien.doc<number>("tabId")) ?? -1;
    const t = m.trinhDuyet.tab(id);
    expect(t?.info.pinned).toBe(true);
    expect(t?.autoDiscardable).toBe(false);
    expect(t?.info.url).toBe(`${PORTAL}/soft-pos-transaction`);
    m.trinhDuyet.dong(id);
    await m.bdp.tabDong(id);
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    expect(m.trinhDuyet.soTab()).toBe(1);
  });

  it("[EXT-BDP-20] cài mới khi đã có tab portal ghim (chưa có content script) ⇒ NHẬN tab đó + tải lại một lần, không mở tab mới", async () => {
    const m = await taoMayAgent();
    const cu = m.trinhDuyet.themTabCu(`${PORTAL}/soft-pos-transaction`, true);
    await m.bdp.khoiDong("INSTALL");
    await m.xong();
    expect(m.trinhDuyet.soTab()).toBe(1);
    expect(await m.khoPhien.doc("tabId")).toBe(cu);
    expect(m.trinhDuyet.dieuHuong.filter((d) => d.kieu === "reload")).toHaveLength(1);
    expect(status(m)).toEqual([{ state: "SESSION_READY", reason: "EXTENSION_START" }]);
  });

  it("[EXT-BDP-21] options: layCauHinh / luuCauHinh / layTrangThai KHÔNG BAO GIỜ trả bí mật; lưu không kèm bí mật mới ⇒ giữ bí mật cũ", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    const xem = await m.bdp.layCauHinh();
    expect(JSON.stringify(xem)).not.toContain(BI_MAT);
    expect(xem).toMatchObject({ coBiMat: true, cauHinh: { agentId: AGENT_ID, merchantCode: MERCHANT } });
    const luu = await m.bdp.luuCauHinh({
      cauHinh: { agentId: AGENT_ID, centerCode: "CS1-moi", merchantCode: MERCHANT, satAroboBaseUrl: "https://admin.satarobo.vn" },
    });
    expect(JSON.stringify(luu)).not.toContain(BI_MAT);
    expect(luu.ok).toBe(true);
    expect(await m.kho.doc("biMat")).toBe(BI_MAT);
    expect(JSON.stringify(await m.bdp.layTrangThai())).not.toContain(BI_MAT);
  });

  it("[EXT-BDP-22] options: bí mật sai dạng ⇒ từ chối, KHÔNG ghi gì; đổi merchant/agent ⇒ quét lại từ đầu (xoá lastSyncedAt)", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    const sai = await m.bdp.luuCauHinh({
      cauHinh: { agentId: AGENT_ID, centerCode: "CS1", merchantCode: MERCHANT, satAroboBaseUrl: "https://admin.satarobo.vn" },
      biMatMoi: BI_MAT.toUpperCase(),
    });
    expect(sai.ok).toBe(false);
    expect(JSON.stringify(sai)).not.toContain(BI_MAT.toUpperCase());
    expect(await m.kho.doc("biMat")).toBe(BI_MAT);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0);
    const doi = await m.bdp.luuCauHinh({
      cauHinh: { agentId: AGENT_ID, centerCode: "CS2", merchantCode: MERCHANT_KHAC, satAroboBaseUrl: "https://admin.satarobo.vn" },
    });
    expect(doi.ok).toBe(true);
    expect(await m.kho.doc("lastSyncedAt")).toBeUndefined();
  });

  it("[EXT-BDP-23] chưa cấu hình ⇒ không gọi portal, không gọi satarobo; huy hiệu báo CHƯA cấu hình", async () => {
    const m = await taoMayAgent({ cauHinh: false });
    await khoiDongSan(m);
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    expect(m.portal.goi).toHaveLength(0);
    expect(m.satarobo.yeuCau).toHaveLength(0);
    expect(m.hienThi.at(-1)?.nhan).toBe("CHƯA");
  });

  it("[EXT-BDP-24] mọi lời gọi portal suốt các kịch bản trên đều thuộc allowlist (app + extension)", async () => {
    const m = await taoMayAgent();
    m.portal.giaoDich = nhieuDong(3);
    await khoiDongSan(m);
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(T0), scanFrom: isoVN(T0 - GIO) }];
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.bdp.nhipKeepalive();
    await m.xong();
    for (const g of m.portal.goi) {
      expect([`GET ${URL_PHIEN}`, `POST ${URL_TIM_KIEM}`]).toContain(`${g.method} ${g.url}`);
    }
  });
});

describe("RÀ ĐỐI KHÁNG GĐ5 (RV5) — đồng hồ, trần schema, chuyển hướng, mốc trượt, trang lặp, 429", () => {
  it("[EXT-BDP-25] đồng hồ agent CHẬM 3′: job + quẹt SAU giờ máy (trước giờ thật) ⇒ cửa sổ phủ tới giờ máy chủ; quẹt vào lô final cùng jobIds; job DONE", async () => {
    const m = await taoMayAgent();
    m.satarobo.lechGioMayChu = 3 * PHUT;
    await khoiDongSan(m);
    expect(await m.khoPhien.doc("lechGio")).toBe(3 * PHUT);
    m.dongHo.now = T0 + PHUT; // máy 10:21:00 — giờ thật (máy chủ, portal) 10:24:00
    const gioMayChu = m.dongHo.now + 3 * PHUT;
    m.portal.giaoDich = [dongPortal({ transaction_id: "TXN20261007000777", transaction_time: "2026/10/07 10:23:30" })];
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(gioMayChu), scanFrom: isoVN(gioMayChu - 10 * PHUT) }];
    await m.bdp.nhipPhut();
    await m.xong();
    const cuoi = lo(m).at(-1);
    expect(cuoi).toMatchObject({ final: true, jobIds: [JOB_ID] });
    expect((cuoi?.windowTo ?? "") >= dinhDangGioVN(gioMayChu)).toBe(true);
    expect(cuoi?.transactions.map((r) => r.transaction_id)).toContain("TXN20261007000777");
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
    // máy chậm ⇒ lastSyncedAt giữ giờ MÁY (sớm hơn giờ thật = an toàn: lượt sau quét rộng hơn)
    expect(await m.kho.doc("lastSyncedAt")).toBe(m.dongHo.now);
  });

  it("[EXT-BDP-26] đồng hồ agent NHANH 3′ ⇒ lastSyncedAt (lưu + heartbeat) = giờ máy chủ — không khai 'đã đọc tới' một mốc chưa tới", async () => {
    const m = await taoMayAgent();
    m.satarobo.lechGioMayChu = -3 * PHUT;
    await khoiDongSan(m);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 - 3 * PHUT);
    await m.bdp.guiHeartbeatNgay();
    await m.xong();
    const hb = m.satarobo.daNhan("/api/pos-agent/heartbeat").at(-1)?.json as { lastSyncedAt: string };
    expect(hb.lastSyncedAt).toBe(isoVN(T0 - 3 * PHUT));
  });

  it("[EXT-BDP-27] dòng portal dài hơn trần hợp đồng 1.1 §6.1 (tiền tệ 17 · giờ 41 · tiền '6732000.000…' 33 · cửa hàng 140 · trạng thái 130) ⇒ extension làm vừa ĐÚNG cột trước khi gửi ⇒ máy chủ (đọc trần từ hợp đồng) KHÔNG từ chối dòng nào; mã quầy 100 (≤ 128) đi nguyên; lượt final; job DONE; giao dịch MỚI phía sau vẫn tới", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.portal.giaoDich = [
      dongPortal({ transaction_id: "TXN20261007000201", transaction_time: "2026/10/07 10:01:00", currency: "VND-INTERNATIONAL" }),
      dongPortal({ transaction_id: "TXN20261007000202", transaction_time: "2026/10/07 10:02:00", order_amount: `6732000.${"0".repeat(25)}` }),
      dongPortal({ transaction_id: "TXN20261007000203", transaction_time: `2026/10/07 10:03:00 ${"Z".repeat(21)}` }),
      dongPortal({
        transaction_id: "TXN20261007000205",
        transaction_time: "2026/10/07 10:04:00",
        store_code: "S".repeat(140),
        terminal_code: "Q".repeat(100),
        transaction_master_status: `SUCCESS${"X".repeat(123)}`,
      }),
    ];
    await khoiDongSan(m);
    m.dongHo.now += PHUT;
    m.portal.giaoDich.push(dongPortal({ transaction_id: "TXN20261007000204", transaction_time: "2026/10/07 10:20:30" }));
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now - 10 * PHUT) }];
    for (let i = 0; i < 2; i++) {
      await m.bdp.nhipPhut();
      await m.xong();
      m.dongHo.now += PHUT;
    }
    expect(m.satarobo.yeuCau.filter((y) => y.duongDan === "/api/pos-agent/transactions" && y.ma !== null)).toHaveLength(0);
    // Máy chủ 1.1 từ chối DÒNG vượt trần (FIELD_TOO_LONG) — extension đúng hợp đồng không bao giờ gặp.
    expect(m.satarobo.tuChoi).toEqual([]);
    const nhan = new Map(m.satarobo.dongNhan.map((r) => [r.transaction_id, r]));
    expect([...nhan.keys()].sort()).toEqual([
      "TXN20261007000201",
      "TXN20261007000202",
      "TXN20261007000203",
      "TXN20261007000204",
      "TXN20261007000205",
    ]);
    expect(["VND", "704", null]).not.toContain(nhan.get("TXN20261007000201")?.currency);
    expect(nhan.get("TXN20261007000202")?.order_amount).toBe("6732000");
    expect(nhan.get("TXN20261007000203")?.transaction_time).toBeNull();
    const r205 = nhan.get("TXN20261007000205");
    expect(r205?.store_code).toBe("S".repeat(128)); // CẮT, không null (null = máy chủ bỏ đối chiếu mã cửa hàng)
    expect(r205?.transaction_master_status).toBe(`SUCCESS${"X".repeat(121)}`); // CẮT về 128 — ≠ SUCCESS (fail-closed)
    expect(r205?.terminal_code).toBe("Q".repeat(100)); // ≤ 128 ⇒ nguyên (bản chép tay 1.0: 64 ⇒ null)
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 + 2 * PHUT);
  });

  it("[EXT-BDP-28] máy chủ 400 PAYLOAD_INVALID trỏ ĐÚNG một dòng ⇒ bỏ đúng dòng đó + gửi lại (không lặp y hệt mỗi phút); dòng khác tới; ERROR SYNC_FAILED MỘT lần; lô final KHÔNG đóng job (lượt chưa trọn)", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.portal.giaoDich = [
      dongPortal({ transaction_id: "TXN20261007000301", transaction_time: "2026/10/07 10:05:00" }),
      dongPortal({ transaction_id: "TXN20261007000302", transaction_time: "2026/10/07 10:06:00", store_code: "STORE-LA" }),
      dongPortal({ transaction_id: "TXN20261007000303", transaction_time: "2026/10/07 10:07:00" }),
    ];
    // Máy chủ CHẶT hơn extension ở một trường (mô phỏng lệch hợp đồng chưa biết trước).
    m.satarobo.epTruoc = (yc) => {
      if (yc.duongDan !== "/api/pos-agent/transactions") return null;
      const ds = (yc.json as { transactions: Array<Record<string, unknown>> }).transactions;
      const i = ds.findIndex((r) => r.store_code === "STORE-LA");
      return i < 0 ? null : { status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: `transactions[${i}].store_code` } } };
    };
    await khoiDongSan(m);
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(T0), scanFrom: isoVN(T0 - GIO) }];
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
      await m.xong();
    }
    const tx = m.satarobo.yeuCau.filter((y) => y.duongDan === "/api/pos-agent/transactions");
    // sau MỖI lần bị từ chối, lần gửi kế tiếp không còn dòng hỏng (không gửi lại y hệt)
    tx.forEach((y, i) => {
      if (y.ma === "PAYLOAD_INVALID") expect(timChuoiCam(tx[i + 1]?.json, ["STORE-LA"])).toBeNull();
    });
    expect(tx.filter((y) => y.ma === "PAYLOAD_INVALID").length).toBeLessThanOrEqual(4); // ≤ 1 / lượt
    const ids = new Set(lo(m).flatMap((x) => x.transactions.map((r) => r.transaction_id)));
    expect(ids.has("TXN20261007000301") && ids.has("TXN20261007000303")).toBe(true);
    expect(ids.has("TXN20261007000302")).toBe(false);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 + 3 * PHUT);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "SYNC_FAILED" }]);
    // dòng hỏng có thể CHÍNH là lần quẹt sale đang chờ ⇒ KHÔNG đóng job (tránh NOT_FOUND giả ⇒ quẹt lại)
    expect(lo(m).filter((x) => x.final).every((x) => x.jobIds.length === 0)).toBe(true);
    expect(m.satarobo.daXongJob).toEqual([]);
  });

  it("[EXT-BDP-28b] dòng bị bỏ nằm ở lô ĐẦU (không phải lô cuối) ⇒ lô final SAU đó vẫn KHÔNG mang jobIds", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    const ds = nhieuDong(60, "10:15:00");
    ds[5] = { ...ds[5], store_code: "STORE-LA" };
    m.portal.giaoDich = ds;
    m.satarobo.epTruoc = (yc) => {
      if (yc.duongDan !== "/api/pos-agent/transactions") return null;
      const t = (yc.json as { transactions: Array<Record<string, unknown>> }).transactions;
      const i = t.findIndex((r) => r.store_code === "STORE-LA");
      return i < 0 ? null : { status: 400, body: { ok: false, error: { code: "PAYLOAD_INVALID", field: `transactions[${i}].store_code` } } };
    };
    await khoiDongSan(m);
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(T0), scanFrom: isoVN(T0 - GIO) }];
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    const cuaLuot = lo(m).filter((x) => x.syncId === lo(m).at(-1)?.syncId);
    expect(cuaLuot.map((x) => [x.final, x.transactions.length])).toEqual([
      [false, 49],
      [true, 10],
    ]);
    expect(cuaLuot.at(-1)?.jobIds).toEqual([]);
    expect(m.satarobo.daXongJob).toEqual([]);
  });

  it("[EXT-BDP-29] search bị CHUYỂN HƯỚNG mà session vẫn có user ⇒ SESSION_EXPIRED đúng MỘT lần qua 3 vòng keepalive — không nháy READY↔EXPIRED; mở lại trang (header mới) ⇒ READY", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    m.portal.epTimKiem = "CHUYEN_HUONG";
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
      m.dongHo.now += 10 * PHUT;
      await m.bdp.nhipKeepalive();
      await m.xong();
    }
    expect(status(m)).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "REDIRECT_LOGIN" },
    ]);
    m.portal.epTimKiem = null;
    const tabId = (await m.khoPhien.doc<number>("tabId")) ?? -1;
    await m.trinhDuyet.moTrang(tabId, `${PORTAL}/soft-pos-transaction`);
    await m.xong();
    expect(status(m).at(-1)).toEqual({ state: "SESSION_READY", reason: "USER_PRESENT" });
  });

  it("[EXT-BDP-30] access token KHÔNG phải JWT + `expires` TRƯỢT ⇒ sau 401 không nháy READY; heartbeat sessionExpiresAt = null (không báo +30 ngày)", async () => {
    const m = await taoMayAgent();
    m.portal.accessToken = "khong-phai-jwt-opaque-token";
    m.portal.expiresTruot = () => new Date(m.dongHo.now + 30 * 24 * GIO).toISOString();
    await khoiDongSan(m);
    m.portal.epTimKiem = "401";
    for (let i = 0; i < 3; i++) {
      m.dongHo.now += PHUT;
      await m.bdp.nhipPhut();
      m.dongHo.now += 10 * PHUT;
      await m.bdp.nhipKeepalive();
      await m.xong();
    }
    expect(status(m).filter((s) => s.state !== "ERROR")).toEqual([
      { state: "SESSION_READY", reason: "EXTENSION_START" },
      { state: "SESSION_EXPIRED", reason: "HTTP_401" },
    ]);
    const hb = m.satarobo.daNhan("/api/pos-agent/heartbeat");
    expect(hb.length).toBeGreaterThan(1);
    for (const y of hb) expect((y.json as { sessionExpiresAt: unknown }).sessionExpiresAt).toBeNull();
  });

  it("[EXT-BDP-31] portal BỎ QUA page_index (trang nào cũng trả trang đầu) ⇒ lượt KHÔNG xong: không lô final, lastSyncedAt giữ, ERROR một lần; không gửi trùng 50 dòng", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.portal.giaoDich = nhieuDong(100, "10:15:00");
    m.portal.boQuaPageIndex = true;
    await khoiDongSan(m);
    expect(lo(m).filter((x) => x.final)).toHaveLength(0);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 - 30 * PHUT);
    const ids = lo(m).flatMap((x) => x.transactions.map((r) => r.transaction_id));
    expect(ids).toHaveLength(50);
    expect(new Set(ids).size).toBe(50);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "SYNC_FAILED" }]);
  });

  it("[EXT-BDP-32] 429 KHÔNG kèm Retry-After ⇒ lùi đúng 60 giây (mặc định), không gọi lại ở nhịp kế", async () => {
    const m = await taoMayAgent();
    await khoiDongSan(m);
    let lan = 0;
    m.satarobo.epTruoc = (yc) =>
      yc.duongDan === "/api/pos-agent/jobs" && lan++ === 0 ? { status: 429, body: { ok: false, error: { code: "RATE_LIMITED" } } } : null;
    m.dongHo.now += PHUT;
    await m.bdp.nhipPhut();
    await m.xong();
    const truoc = m.satarobo.yeuCau.length;
    m.dongHo.now += 30_000;
    await m.bdp.nhipPhut();
    await m.xong();
    expect(m.satarobo.yeuCau.length).toBe(truoc);
    m.dongHo.now += 31_000;
    await m.bdp.nhipPhut();
    await m.xong();
    expect(m.satarobo.yeuCau.length).toBeGreaterThan(truoc);
  });
});

describe("HỢP ĐỒNG 1.1 (chốt GĐ4 ↔ GĐ5) — windowTo cả lượt, từ chối dòng, mốc phiên", () => {
  it("[EXT-BDP-33] lượt HAI mảnh 24h, mảnh cuối RỖNG + job của sale ⇒ lô final mang windowTo CẢ LƯỢT ⇒ máy chủ (luật RV-06: job tạo ≤ windowTo) đóng job — không kẹt PENDING", async () => {
    // Agent nghỉ 28 giờ (service worker vừa thức dậy theo alarm): cửa sổ [T0+1′ − 30h, T0+1′ + biên 2′] = hai mảnh.
    const m = await taoMayAgent({ lastSyncedAt: T0 - 28 * GIO });
    m.portal.giaoDich = [dongPortal({ transaction_id: "TXN20261006000901", transaction_time: "2026/10/06 09:00:00" })];
    m.dongHo.now = T0 + PHUT; // 10:21 — sale vừa bấm "Kiểm tra"
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now - 10 * PHUT) }];
    await m.bdp.nhipPhut();
    await m.xong();
    expect(timKiemCuaExt(m).map((b) => [b.transaction_time_from, b.transaction_time_to])).toEqual([
      ["2026-10-06 04:20:00", "2026-10-07 04:20:00"],
      ["2026-10-07 04:20:00", "2026-10-07 10:23:00"],
    ]);
    const cuoi = lo(m).at(-1);
    expect(cuoi).toMatchObject({ final: true, windowFrom: "2026-10-06 04:20:00", windowTo: "2026-10-07 10:23:00", jobIds: [JOB_ID] });
    expect(cuoi?.transactions.map((r) => r.transaction_id)).toEqual(["TXN20261006000901"]);
    expect(m.satarobo.jobGiuVi).toEqual([]);
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
  });

  /** Lần gửi TRÙNG một lô (cùng syncId + batchIndex) — đường "bỏ dòng rồi gửi lại" của máy chủ 1.0. */
  function loGuiLai(m: MayAgent): string[] {
    const thay = new Set<string>();
    const lai: string[] = [];
    for (const y of m.satarobo.yeuCau.filter((x) => x.duongDan === "/api/pos-agent/transactions")) {
      const j = y.json as { syncId: string; batchIndex: number };
      const k = `${j.syncId}#${j.batchIndex}`;
      if (thay.has(k)) lai.push(k);
      thay.add(k);
    }
    return lai;
  }

  it("[EXT-BDP-34] máy chủ 1.1 từ chối DÒNG FIELD_TOO_LONG (+field) — extension lệch hợp đồng ⇒ /status ERROR FIELD_TOO_LONG ĐÚNG MỘT lần qua nhiều lượt (lượt sạch xen giữa, dòng MỚI bị từ chối ở lượt sau); KHÔNG giữ jobIds (job DONE); không bỏ dòng / gửi lại lô; lastSyncedAt tiến; trạng thái chỉ đúng trường lệch", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.satarobo.tranEp = { store_code: 10 }; // máy chủ chặt hơn extension ở MỘT khoá (= extension lệch hợp đồng)
    m.portal.giaoDich = [
      dongPortal({ transaction_id: "TXN20261007000301", transaction_time: "2026/10/07 10:05:00" }),
      dongPortal({ transaction_id: "TXN20261007000302", transaction_time: "2026/10/07 10:06:00", store_code: "STORE-LA-0000302" }),
      dongPortal({ transaction_id: "TXN20261007000303", transaction_time: "2026/10/07 10:07:00" }),
    ];
    await khoiDongSan(m); // lượt 1: 302 bị từ chối
    m.dongHo.now = T0 + PHUT;
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now - 10 * PHUT) }];
    await m.bdp.nhipPhut(); // lượt 2: 302 gửi lại y hệt ⇒ máy chủ xếp `unchanged` — lượt SẠCH
    await m.xong();
    m.dongHo.now += PHUT;
    m.portal.giaoDich.push(dongPortal({ transaction_id: "TXN20261007000304", transaction_time: "2026/10/07 10:21:30", store_code: "STORE-LA-0000304" }));
    await m.bdp.nhipPhut(); // lượt 3: dòng MỚI bị từ chối
    await m.xong();

    // đối chứng: kịch bản THẬT có dòng bị từ chối ở lượt 1 và lượt 3 (lưới không đo trên tập rỗng)
    expect(m.satarobo.tuChoi.map((t) => [t.transaction_id, t.code, t.field])).toEqual([
      ["TXN20261007000302", "FIELD_TOO_LONG", "store_code"],
      ["TXN20261007000304", "FIELD_TOO_LONG", "store_code"],
    ]);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "FIELD_TOO_LONG" }]);
    const loi = m.satarobo.daNhan("/api/pos-agent/status").find((y) => (y.json as { state: string }).state === "ERROR");
    expect(Object.keys(loi?.json as object).sort()).toEqual(["occurredAt", "profileName", "reason", "state"]); // /status strict: không mang field
    // KHÔNG đi đường "bỏ dòng" của máy chủ 1.0: không 400, không gửi lại lô, dòng bị từ chối vẫn nằm trong lô đã gửi
    expect(m.satarobo.yeuCau.filter((y) => y.duongDan === "/api/pos-agent/transactions" && y.ma !== null)).toEqual([]);
    expect(loGuiLai(m)).toEqual([]);
    expect(lo(m).flatMap((x) => x.transactions.map((r) => r.transaction_id))).toContain("TXN20261007000304");
    // KHÔNG giữ jobIds: dòng bị từ chối đã có dấu ở máy chủ (hợp đồng §4.4 — không chặn đóng job)
    expect(lo(m).filter((x) => x.final && x.jobIds.length > 0).map((x) => x.jobIds)).toEqual([[JOB_ID]]);
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 + 2 * PHUT);
    expect(m.satarobo.dongNhan.map((r) => r.transaction_id)).toEqual(expect.arrayContaining(["TXN20261007000301", "TXN20261007000303"]));
    const tt = await m.bdp.layTrangThai();
    expect(tt.loiMo).toEqual(["FIELD_TOO_LONG"]);
    expect(tt.truongQuaDai).toEqual(["store_code"]);
    expect(m.hienThi.at(-1)).toMatchObject({ nhan: "LỖI", mau: "CAM" });
    expect(m.hienThi.at(-1)?.tieuDe).toContain("store_code");
  });

  it("[EXT-BDP-34b] FIELD_TOO_LONG ở lô ĐẦU (final:false) của lượt có job ⇒ lô final SAU đó VẪN mang jobIds, job DONE (khác đường bỏ dòng 400 của [EXT-BDP-28b]); 59 dòng khác vào sổ; ERROR một lần", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.satarobo.tranEp = { store_code: 10 };
    const ds = nhieuDong(60, "10:15:00");
    ds[5] = { ...ds[5], store_code: "STORE-LA-XXXXXXX" };
    m.portal.giaoDich = ds;
    m.dongHo.now = T0 + PHUT;
    m.satarobo.jobs = [{ id: JOB_ID, createdAt: isoVN(m.dongHo.now), scanFrom: isoVN(m.dongHo.now - 10 * PHUT) }];
    await m.bdp.nhipPhut();
    await m.xong();
    const cuaLuot = lo(m).filter((x) => x.syncId === lo(m).at(-1)?.syncId);
    expect(cuaLuot.map((x) => [x.batchIndex, x.final, x.transactions.length])).toEqual([
      [0, false, 50],
      [1, true, 10],
    ]);
    expect(m.satarobo.tuChoi.map((t) => [t.batchIndex, t.index, t.code, t.field])).toEqual([[0, 5, "FIELD_TOO_LONG", "store_code"]]);
    expect(cuaLuot.at(-1)?.jobIds).toEqual([JOB_ID]);
    expect(m.satarobo.daXongJob).toEqual([JOB_ID]);
    expect(m.satarobo.dongNhan).toHaveLength(59);
    expect(loGuiLai(m)).toEqual([]);
    expect(status(m).filter((s) => s.state === "ERROR")).toEqual([{ state: "ERROR", reason: "FIELD_TOO_LONG" }]);
    expect(await m.kho.doc("lastSyncedAt")).toBe(T0 + PHUT);
  });

  it("[EXT-BDP-35] dòng HỦY/HOÀN bị máy chủ TỪ CHỐI: máy chủ (RVG-02 của GĐ4) chỉ GIỮ LẠI được thanh toán cùng RRN khi THẤY dòng hủy trong CÙNG lô ⇒ extension KHÔNG tự lọc — mọi loại (PAYMENT · VOID · REFUND · loại lạ · thiếu loại) được gửi ở MỌI lượt còn trong cửa sổ, kể cả dòng đã bị từ chối ở lượt trước; VOID CÙNG lô với PAYMENT cùng card_transaction_id, giữ nguyên loại + RRN + quầy", async () => {
    const m = await taoMayAgent({ lastSyncedAt: T0 - 30 * PHUT });
    m.satarobo.tranEp = { store_code: 10 }; // máy chủ chặt hơn ở store_code ⇒ CHỈ dòng hủy (store_code dài) bị từ chối
    const RRN = "628099990501";
    const ID = {
      thanhToan: "TXN20261007000501",
      huy: "TXN20261007000502",
      hoan: "TXN20261007000503",
      loaiLa: "TXN20261007000504",
      thieuLoai: "TXN20261007000505",
    };
    m.portal.giaoDich = [
      dongPortal({ transaction_id: ID.thanhToan, transaction_time: "2026/10/07 10:05:00", card_transaction_id: RRN }),
      dongPortal({
        transaction_id: ID.huy,
        transaction_type: "VOID",
        transaction_time: "2026/10/07 10:06:00",
        card_transaction_id: RRN,
        store_code: "STORE-LA-0000502",
      }),
      dongPortal({ transaction_id: ID.hoan, transaction_type: "REFUND", transaction_time: "2026/10/07 10:07:00", card_transaction_id: "628099990503" }),
      dongPortal({ transaction_id: ID.loaiLa, transaction_type: "ADJUSTMENT", transaction_time: "2026/10/07 10:08:00", card_transaction_id: "628099990504" }),
      dongPortal({ transaction_id: ID.thieuLoai, transaction_type: null, transaction_time: "2026/10/07 10:09:00", card_transaction_id: "628099990505" }),
    ];
    await khoiDongSan(m); // lượt 1: dòng hủy bị từ chối
    for (let i = 1; i <= 2; i++) {
      m.dongHo.now = T0 + i * PHUT;
      await m.bdp.nhipPhut(); // lượt 2, 3: máy chủ đã có dấu dòng hủy (`unchanged`) — extension VẪN gửi lại cùng thanh toán
      await m.xong();
    }

    // đối chứng: kịch bản THẬT có dòng hủy bị từ chối — đúng một lần (gửi lại y hệt ⇒ máy chủ không báo lần hai)
    expect(m.satarobo.tuChoi.map((t) => [t.transaction_id, t.code, t.field])).toEqual([[ID.huy, "FIELD_TOO_LONG", "store_code"]]);
    const luot = [...new Set(lo(m).map((x) => x.syncId))];
    expect(luot).toHaveLength(3);
    for (const s of luot) {
      const cuaLuot = lo(m).filter((x) => x.syncId === s);
      const dong = cuaLuot.flatMap((x) => x.transactions);
      expect(dong.map((r) => r.transaction_id).sort(), `${s}: mọi loại giao dịch, không lọc`).toEqual(Object.values(ID).sort());
      const loCua = (id: string) => cuaLuot.find((x) => x.transactions.some((r) => r.transaction_id === id))?.batchIndex;
      expect(loCua(ID.huy), `${s}: dòng hủy phải CÙNG lô với thanh toán cùng RRN`).toBe(loCua(ID.thanhToan));
      expect(dong.find((r) => r.transaction_id === ID.huy)).toMatchObject({ transaction_type: "VOID", card_transaction_id: RRN, terminal_code: "QTT45XWQT" });
      expect(dong.find((r) => r.transaction_id === ID.thieuLoai)?.transaction_type).toBeNull();
    }
    // không đi đường "bỏ dòng / gửi lại lô" (đường đó gửi lô KHÔNG có dòng hủy ⇒ máy chủ thu tiền lần quẹt đã hủy)
    expect(loGuiLai(m)).toEqual([]);
    expect(m.satarobo.yeuCau.filter((y) => y.duongDan === "/api/pos-agent/transactions" && y.ma !== null)).toEqual([]);
  });
});
