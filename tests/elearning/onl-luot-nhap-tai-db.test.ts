// @vitest-environment node
/**
 * [ONL-TAI-*] P0 Mobile — KIỂM TẢI + ĐỒNG THỜI của autosave (Postgres thật, MỨC DỊCH VỤ — không có HTTP/mạng di động).
 * Chứng minh các bất biến dưới tải: không mất dữ liệu đã ACK · không ghi đè revision mới bằng revision cũ · 429 có Retry-After · hai thiết bị tranh chấp không mất/nhân đôi.
 * Số đo ghi ra E:/tmp/p0-tai.json (độ trễ p50/p95/p99, thông lượng). KHÔNG phải benchmark trên máy thật: thông số 90 yêu cầu/phút/lượt vẫn là mặc định kỹ thuật cấu hình được.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../lib/db";
import { batDauLamBai } from "../../lib/elearning-online/danh-gia-db";
import { TAN_SUAT_NHAP, luuNhap, type CauHinhTanSuat } from "../../lib/elearning-online/luot-nhap-db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { T0, donP0, dungKhoaP0, khoaYeuCau, sau } from "./_onl-p0-fixture";

const RONG: CauHinhTanSuat = { toiDaYeuCauMoiPhut: 100_000, cuaSoGiay: 60, toiDaCauMoiYeuCau: 50 }; // tắt giới hạn để đo năng lực dịch vụ
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!;
const BAO_CAO: Record<string, unknown> = {};

/** Mô phỏng chính sách phía máy khách ĐỀ NGHỊ: gom thay đổi theo debounce `debounceMs`, ép gửi sau tối đa `toiDaChoMs`, một yêu cầu chứa nhiều câu (≤ 50). Trả số yêu cầu/phút lớn nhất. */
function moPhongKhach(o: { sukienMs: number[]; debounceMs: number; toiDaChoMs: number }): number {
  const guiLuc: number[] = [];
  let dauHang: number | null = null;
  let cuoi = 0;
  for (const t of o.sukienMs) {
    if (dauHang !== null && (t - cuoi >= o.debounceMs || t - dauHang >= o.toiDaChoMs)) {
      guiLuc.push(Math.min(cuoi + o.debounceMs, dauHang + o.toiDaChoMs));
      dauHang = null;
    }
    if (dauHang === null) dauHang = t;
    cuoi = t;
  }
  if (dauHang !== null) guiLuc.push(cuoi + o.debounceMs);
  let max = 0;
  for (let i = 0; i < guiLuc.length; i++) max = Math.max(max, guiLuc.filter((x) => x >= guiLuc[i]! && x < guiLuc[i]! + 60_000).length);
  return max;
}

describe.skipIf(!RUN_DB_TESTS)("[ONL-TAI] autosave dưới tải (Postgres thật)", () => {
  beforeAll(donP0, 120_000);
  beforeEach(donP0, 120_000);
  afterAll(async () => {
    mkdirSync("E:/tmp", { recursive: true });
    writeFileSync("E:/tmp/p0-tai.json", JSON.stringify({ taoLuc: new Date().toISOString(), macDinh: TAN_SUAT_NHAP, ...BAO_CAO }, null, 2));
    await donP0();
  }, 120_000);

  it("[ONL-TAI-01] 🔴 20 lượt song song × 25 lần lưu: KHÔNG mất ACK nào; đáp án cuối = lần ACK cuối; revision = số lần lưu; đo p50/p95/p99", async () => {
    const k = await dungKhoaP0({ timeLimitMin: 60 });
    const SO_LUOT = 20, SO_LAN = 25;
    const luot = [] as { args: ReturnType<typeof k.args>; att: string }[];
    for (let i = 0; i < SO_LUOT; i++) {
      const hv = i === 0 ? k : await k.themHocVien("tai" + i);
      const r = await batDauLamBai(db, hv.args(T0));
      if (!r.ok) throw new Error(r.thongBao);
      luot.push({ args: hv.args(T0), att: r.luot.attemptId });
    }
    const doTre: number[] = [];
    const t0 = performance.now();
    const ack = await Promise.all(
      luot.map(async (l, i) => {
        const nhan: string[] = [];
        for (let n = 0; n < SO_LAN; n++) {
          const tu = performance.now();
          const r = await luuNhap(db, { ...l.args, now: sau(5 + n), attemptId: l.att, yeuCau: { requestId: khoaYeuCau("tai"), items: [{ questionId: k.q.ngan!, answer: `L${i}-lan${n}`, baseRevision: n }] } }, RONG);
          doTre.push(performance.now() - tu);
          if (!r.ok) throw new Error("mất yêu cầu: " + r.thongBao);
          expect(r.items[0]).toMatchObject({ ketQua: "SAVED", revision: n + 1 });
          nhan.push(`L${i}-lan${n}`);
        }
        return nhan;
      }),
    );
    const tong = performance.now() - t0;
    for (let i = 0; i < SO_LUOT; i++) {
      const d = await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: luot[i]!.att, questionId: k.q.ngan! } });
      expect(d.revision).toBe(SO_LAN);
      expect(d.answerJson).toBe(ack[i]![SO_LAN - 1]);
      expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: luot[i]!.att } })).draftRevision).toBe(SO_LAN);
    }
    BAO_CAO.thongLuong = { luot: SO_LUOT, yeuCau: SO_LUOT * SO_LAN, tongMs: Math.round(tong), yeuCauMoiGiay: Math.round(((SO_LUOT * SO_LAN) / tong) * 1000), msP50: Math.round(pct(doTre, 50)), msP95: Math.round(pct(doTre, 95)), msP99: Math.round(pct(doTre, 99)), ghiChu: "DB Postgres cục bộ, không mạng; chỉ phản ánh chi phí dịch vụ" };
    expect(pct(doTre, 95)).toBeLessThan(3000); // trần rộng để không đỏ giả trên máy chậm; số thật nằm trong báo cáo
  }, 180_000);

  it("[ONL-TAI-02] 🔴 BÃO yêu cầu cũ (revision cũ, requestId mới) sau khi đã có revision mới ⇒ toàn bộ CONFLICT, không câu nào bị ghi đè; số revision không đổi", async () => {
    const k = await dungKhoaP0({ timeLimitMin: 60 });
    const r0 = await batDauLamBai(db, k.args(T0));
    if (!r0.ok) throw new Error(r0.thongBao);
    const att = r0.luot.attemptId;
    for (let n = 0; n < 8; n++) await luuNhap(db, { ...k.args(sau(5 + n)), attemptId: att, yeuCau: { requestId: khoaYeuCau("m"), items: [{ questionId: k.q.ngan!, answer: "moi-" + n, baseRevision: n }] } }, RONG);
    const bao = await Promise.all(Array.from({ length: 40 }, (_, i) => luuNhap(db, { ...k.args(sau(20)), attemptId: att, yeuCau: { requestId: khoaYeuCau("cu"), items: [{ questionId: k.q.ngan!, answer: "CU-" + i, baseRevision: i % 8 }] } }, RONG)));
    expect(bao.every((r) => r.ok && r.items[0]!.ketQua === "CONFLICT")).toBe(true);
    const d = await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: att, questionId: k.q.ngan! } });
    expect(d).toMatchObject({ revision: 8, answerJson: "moi-7" });
    expect((await db.onlAttempt.findUniqueOrThrow({ where: { id: att } })).draftRevision).toBe(8);
  }, 120_000);

  it("[ONL-TAI-03] 🔴 HAI THIẾT BỊ tranh chấp cùng một câu (mỗi bên 20 vòng đọc-rồi-ghi): tổng SAVED = revision cuối (không mất, không nhân đôi); mỗi SAVED có đúng một dòng tương ứng bản cuối", async () => {
    const k = await dungKhoaP0({ timeLimitMin: 60 });
    const r0 = await batDauLamBai(db, k.args(T0));
    if (!r0.ok) throw new Error(r0.thongBao);
    const att = r0.luot.attemptId;
    const q = k.q.ngan!;
    const thietBi = async (ten: string) => {
      let base = 0, saved = 0, xungDot = 0;
      for (let v = 0; v < 20; v++) {
        const r = await luuNhap(db, { ...k.args(sau(5 + v)), attemptId: att, yeuCau: { requestId: khoaYeuCau(ten), deviceId: ten, items: [{ questionId: q, answer: `${ten}-${v}`, baseRevision: base }] } }, RONG);
        if (!r.ok) throw new Error(r.thongBao);
        const it = r.items[0]!;
        if (it.ketQua === "SAVED") { saved++; base = it.revision; } else { xungDot++; base = it.serverRevision; } // thiết bị lấy lại bản máy chủ rồi thử tiếp
      }
      return { saved, xungDot };
    };
    const [a, b] = await Promise.all([thietBi("may-A"), thietBi("may-B")]);
    const d = await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: att, questionId: q } });
    expect(a.saved + b.saved).toBe(d.revision); // mỗi lần ACK SAVED tăng đúng 1 revision
    expect(d.revision).toBeGreaterThan(0);
    expect(String(d.answerJson)).toMatch(/^may-[AB]-\d+$/);
    expect(await db.onlAttemptDraft.count({ where: { attemptId: att } })).toBe(1);
    BAO_CAO.haiThietBi = { saved: a.saved + b.saved, xungDot: a.xungDot + b.xungDot, revisionCuoi: d.revision };
  }, 120_000);

  it("[ONL-TAI-04] 🔴 429: vượt hạn mức CẤU HÌNH ⇒ VUOT_TAN_SUAT + retryAfterSec ≤ cửa sổ; yêu cầu đã ACK còn nguyên; hết cửa sổ nhận lại; cấu hình khác ⇒ ngưỡng khác (không phải hằng cứng)", async () => {
    const k = await dungKhoaP0({ timeLimitMin: 60, tuLuan: true, sanPham: true });
    const r0 = await batDauLamBai(db, k.args(T0));
    if (!r0.ok) throw new Error(r0.thongBao);
    const att = r0.luot.attemptId;
    const cauHinh: CauHinhTanSuat = { toiDaYeuCauMoiPhut: 10, cuaSoGiay: 60, toiDaCauMoiYeuCau: 5 };
    const kq = [];
    for (let n = 0; n < 12; n++) kq.push(await luuNhap(db, { ...k.args(sau(10)), attemptId: att, yeuCau: { requestId: khoaYeuCau("r"), items: [{ questionId: k.q.ngan!, answer: "a" + n, baseRevision: n }] } }, cauHinh));
    expect(kq.slice(0, 10).every((r) => r.ok)).toBe(true);
    for (const r of kq.slice(10)) {
      expect(r).toMatchObject({ ok: false, ma: "VUOT_TAN_SUAT" });
      expect(r.ok === false && r.retryAfterSec).toBeGreaterThan(0);
      expect(r.ok === false && r.retryAfterSec).toBeLessThanOrEqual(60);
    }
    expect((await db.onlAttemptDraft.findFirstOrThrow({ where: { attemptId: att, questionId: k.q.ngan! } })).revision).toBe(10); // 10 ACK còn nguyên
    expect(await luuNhap(db, { ...k.args(sau(71)), attemptId: att, yeuCau: { requestId: khoaYeuCau("r"), items: [{ questionId: k.q.ngan!, answer: "sau-cua-so", baseRevision: 10 }] } }, cauHinh)).toMatchObject({ ok: true });
    // số câu/yêu cầu cũng cấu hình được
    const sauCau = Object.values(k.q).slice(0, 6).map((questionId) => ({ questionId, answer: "x", baseRevision: 0 })); // 6 câu KHÁC NHAU (trùng mã câu sẽ bị từ chối vì lý do khác)
    expect(new Set(sauCau.map((c) => c.questionId)).size).toBe(6);
    expect(await luuNhap(db, { ...k.args(sau(200)), attemptId: att, yeuCau: { requestId: khoaYeuCau("r"), items: sauCau } }, cauHinh)).toMatchObject({ ok: false, ma: "YEU_CAU_KHONG_HOP_LE", thongBao: expect.stringContaining("Tối đa 5") });
  }, 120_000);

  it("[ONL-TAI-05] 🔴 chính sách máy khách đề nghị (debounce 1,5 s + ép gửi sau 5 s + gom nhiều câu): mọi kiểu gõ thực tế ≤ 40 yêu cầu/phút (< nửa hạn mức mặc định); xả hàng chờ sau mất mạng gom thành ⌈n/50⌉ yêu cầu", () => {
    const dp = (ms: number) => ({ debounceMs: 1500, toiDaChoMs: 5000, sukienMs: Array.from({ length: Math.floor(120_000 / ms) }, (_, i) => i * ms) });
    const kieuGo = { "gõ nhanh (80 ms/phím, liên tục 2 phút)": 80, "gõ vừa (250 ms)": 250, "chọn đáp án rời rạc (2 s)": 2000, "chọn dồn (700 ms)": 700 };
    const ketQua: Record<string, number> = {};
    for (const [ten, ms] of Object.entries(kieuGo)) {
      const max = moPhongKhach(dp(ms));
      ketQua[ten] = max;
      expect(max, ten).toBeLessThanOrEqual(40);
    }
    // KHÔNG debounce (gửi mỗi thao tác) vượt hạn mức ⇒ chính sách phía máy khách là BẮT BUỘC (đối chứng)
    expect(moPhongKhach({ debounceMs: 0, toiDaChoMs: 0, sukienMs: dp(250).sukienMs })).toBeGreaterThan(TAN_SUAT_NHAP.toiDaYeuCauMoiPhut);
    const xaHang = (n: number) => Math.ceil(n / TAN_SUAT_NHAP.toiDaCauMoiYeuCau);
    expect([xaHang(1), xaHang(50), xaHang(51), xaHang(120)]).toEqual([1, 1, 2, 3]);
    BAO_CAO.moPhongMayKhach = { yeuCauToiDaMoiPhut: ketQua, debounceMs: 1500, toiDaChoMs: 5000, ghiChu: "mô phỏng chính sách đề nghị cho A/B; cần đo telemetry thật để chốt" };
  });
});
