/**
 * [MLB] "Mở lại buổi" — phần THUẦN + lưới ghim dây nối (11/10/2026).
 *
 * Ngày TUYỆT ĐỐI + `now` truyền vào (luật 19: không đọc đồng hồ). Các ca đầu-cuối trên Postgres thật nằm ở
 * `tests/nen/mo-lai-buoi.spec.ts` (`pnpm test:nen-db`); ở đây chỉ phần không cần DB.
 *
 * Lưới `[MLB-W*]` đọc mã nguồn: lời gọi Prisma/hàm nội bộ không chứng minh được bằng test thuần (mẫu "lưới ghim mã
 * nguồn" trong CLAUDE.md). Neo vào LỜI GỌI và SỐ LẦN khớp, không vào chỗ đặt chữ.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { vnDateAt } from "@/lib/time/vn";
import {
  buoiCoTheMoLai,
  laBuoiLopNghi,
  quyetDinhMoLaiBuoi,
  type DauVaoQuyetDinhMoLai,
} from "./mo-lai-buoi-quyet-dinh";

const NOW = vnDateAt(2099, 4, 3, 11, 29); // 03/05/2099 11:29 VN
const HOM_NAY_15H45 = vnDateAt(2099, 4, 3, 15, 45);
const HOM_QUA = vnDateAt(2099, 4, 2, 15, 45);
const CUOI_LICH = vnDateAt(2100, 0, 8, 15, 45);

const base = (o: Partial<DauVaoQuyetDinhMoLai> = {}): DauVaoQuyetDinhMoLai => ({
  status: "CANCELLED",
  date: HOM_NAY_15H45,
  lopNghi: false,
  buoiBu: { id: "bu", status: "SCHEDULED", date: CUOI_LICH, duLieu: [] },
  now: NOW,
  ...o,
});

describe("[MLB] quyetDinhMoLaiBuoi (thuần)", () => {
  it("[MLB-01] buổi huỷ hôm nay, buổi bù sạch ⇒ mở lại và gỡ buổi bù", () => {
    expect(quyetDinhMoLaiBuoi(base())).toEqual({ ok: true, goBuoiBu: true });
  });

  it("[MLB-02] buổi KHÔNG phải CANCELLED ⇒ từ chối", () => {
    for (const status of ["SCHEDULED", "IN_PROGRESS", "COMPLETED"]) {
      const r = quyetDinhMoLaiBuoi(base({ status }));
      expect(r.ok, status).toBe(false);
    }
  });

  it("[MLB-03] buổi đã qua ngày (giờ VN) ⇒ từ chối; buổi sáng nay lúc 00:30 VN vẫn là HÔM NAY ⇒ qua", () => {
    expect(quyetDinhMoLaiBuoi(base({ date: HOM_QUA })).ok).toBe(false);
    // 00:30 VN = 17:30 UTC hôm trước: so theo ngày UTC sẽ sai, phải so theo ngày VN.
    expect(quyetDinhMoLaiBuoi(base({ date: vnDateAt(2099, 4, 3, 0, 30) })).ok).toBe(true);
  });

  it("[MLB-04] buổi bị 'Nghỉ & lùi lịch' huỷ ⇒ từ chối, câu nhắc đúng đường xử lý", () => {
    const r = quyetDinhMoLaiBuoi(base({ lopNghi: true }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Nghỉ & lùi lịch/);
  });

  it("[MLB-05] buổi bù đã có dữ liệu ⇒ từ chối, liệt kê đúng thứ bám vào", () => {
    const r = quyetDinhMoLaiBuoi(base({ buoiBu: { id: "bu", status: "SCHEDULED", date: CUOI_LICH, duLieu: ["điểm danh", "nhận xét"] } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("điểm danh, nhận xét");
  });

  it("[MLB-06] buổi bù đã diễn ra / đã bắt đầu / hoàn tất ⇒ từ chối", () => {
    expect(quyetDinhMoLaiBuoi(base({ buoiBu: { id: "bu", status: "SCHEDULED", date: vnDateAt(2099, 4, 3, 9, 0), duLieu: [] } })).ok).toBe(false);
    for (const status of ["IN_PROGRESS", "COMPLETED"]) {
      expect(quyetDinhMoLaiBuoi(base({ buoiBu: { id: "bu", status, date: CUOI_LICH, duLieu: [] } })).ok, status).toBe(false);
    }
  });

  it("[MLB-07] không tìm thấy buổi bù, hoặc buổi bù đã CANCELLED ⇒ vẫn mở lại, KHÔNG gỡ gì", () => {
    expect(quyetDinhMoLaiBuoi(base({ buoiBu: null }))).toEqual({ ok: true, goBuoiBu: false });
    expect(quyetDinhMoLaiBuoi(base({ buoiBu: { id: "bu", status: "CANCELLED", date: CUOI_LICH, duLieu: ["điểm danh"] } }))).toEqual({
      ok: true,
      goBuoiBu: false,
    });
  });
});

describe("[MLB] laBuoiLopNghi / buoiCoTheMoLai (thuần)", () => {
  it("[MLB-08] nhận ra topic 'Lớp nghỉ — …' của nghiBuoiLop; topic thường / null thì không", () => {
    expect(laBuoiLopNghi("Lớp nghỉ — sự kiện")).toBe(true);
    expect(laBuoiLopNghi("Bài 6: Đèn giao thông")).toBe(false);
    expect(laBuoiLopNghi(null)).toBe(false);
    expect(laBuoiLopNghi(undefined)).toBe(false);
  });

  it("[MLB-09] nút hiện ⇔ CANCELLED + chưa qua ngày + không phải lớp nghỉ", () => {
    const ok = { status: "CANCELLED", date: HOM_NAY_15H45, topic: null, now: NOW };
    expect(buoiCoTheMoLai(ok)).toBe(true);
    expect(buoiCoTheMoLai({ ...ok, status: "SCHEDULED" })).toBe(false);
    expect(buoiCoTheMoLai({ ...ok, date: HOM_QUA })).toBe(false);
    expect(buoiCoTheMoLai({ ...ok, topic: "Lớp nghỉ — mưa bão" })).toBe(false);
  });

  it("[MLB-10] nút và server cùng nguồn: mọi ca nút hiện đều KHÔNG bị chặn bởi các vế màn hình biết", () => {
    const cases = [
      { status: "CANCELLED", date: HOM_NAY_15H45, topic: null },
      { status: "CANCELLED", date: HOM_QUA, topic: null },
      { status: "CANCELLED", date: HOM_NAY_15H45, topic: "Lớp nghỉ — x" },
      { status: "COMPLETED", date: HOM_NAY_15H45, topic: null },
    ];
    for (const c of cases) {
      const hien = buoiCoTheMoLai({ ...c, now: NOW });
      const sv = quyetDinhMoLaiBuoi({ status: c.status, date: c.date, lopNghi: laBuoiLopNghi(c.topic), buoiBu: null, now: NOW });
      // Nút hiện thì server (khi không có buổi bù cản) phải nhận — nếu không là lời hứa suông.
      if (hien) expect(sv.ok, JSON.stringify(c)).toBe(true);
    }
  });
});

// ── Lưới ghim dây nối ────────────────────────────────────────────────────────────────────────
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Bỏ chú thích để chuỗi trong lời giải thích không làm lưới xanh/đỏ oan. */
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe("[MLB-W] dây nối mã nguồn", () => {
  const lib = boChuThich(doc("lib/classes/mo-lai-buoi.ts"));

  it("[MLB-W1] ghi dưới KHOÁ LỚP, và khoá đứng TRƯỚC phép ghi đầu tiên", () => {
    expect(dem(lib, /khoaLopBuoi\(tx,/g)).toBe(1);
    const khoa = lib.indexOf("khoaLopBuoi(tx,");
    const ghiDauTien = lib.search(/tx\.classSession\.updateMany\(/);
    expect(khoa).toBeGreaterThan(-1);
    expect(ghiDauTien).toBeGreaterThan(khoa);
  });

  it("[MLB-W2] cổng quyết định (`throw` từ chối) đứng TRƯỚC mọi updateMany — luật rollback", () => {
    const quyet = lib.indexOf("if (!qd.ok) throw");
    const trung = lib.indexOf('code: "TRUNG_BUOI"') > -1 ? lib.indexOf('code: "TRUNG_BUOI"') : lib.indexOf('"TRUNG_BUOI"');
    const ghi = lib.search(/tx\.classSession\.updateMany\(/);
    expect(quyet).toBeGreaterThan(-1);
    expect(trung).toBeGreaterThan(-1);
    expect(ghi).toBeGreaterThan(quyet);
    expect(ghi).toBeGreaterThan(trung);
  });

  it("[MLB-W3] cả hai phép ghi buổi là updateMany CÓ ĐIỀU KIỆN (status + updatedAt), đúng 2 lần", () => {
    expect(dem(lib, /tx\.classSession\.updateMany\(/g)).toBe(2);
    expect(dem(lib, /updatedAt:\s*(bu|s)\.updatedAt/g)).toBe(2);
    expect(lib).toMatch(/where:\s*\{\s*id:\s*s\.id,\s*status:\s*"CANCELLED",\s*updatedAt:\s*s\.updatedAt\s*\}/);
  });

  it("[MLB-W4] buổi bù được gỡ bằng CANCELLED (không xoá cứng)", () => {
    expect(lib).not.toMatch(/classSession\.delete/);
    expect(lib).toMatch(/data:\s*\{\s*status:\s*"CANCELLED"\s*\}/);
  });

  it("[MLB-W5] gán GV thay đi qua adjustSession TRONG CÙNG tx; ok:false ⇒ throw (rollback)", () => {
    expect(lib).toMatch(/adjustSession\(\{[^}]*\btx\b[^}]*\}\)/);
    expect(lib).toMatch(/if \(!r\.ok\) throw new LoiMoLaiBuoi/);
  });

  it("[MLB-W6] có audit RESTORE_SESSION + sự kiện RESTORED trong tx", () => {
    expect(lib).toMatch(/action:\s*"RESTORE_SESSION"/);
    expect(lib).toMatch(/change:\s*"RESTORED"/);
    // writeAudit({... tx, }) và publishEvent(..., { tx }) — cả hai ghi CÙNG giao dịch, không tự mở client mới.
    expect(lib).toMatch(/writeAudit\(\{[\s\S]*?\btx,\s*\}\)/);
    expect(lib).toMatch(/publishEvent\([\s\S]*?\{\s*tx\s*\},?\s*\)/);
  });

  it("[MLB-W7] server action: đi qua gate() + resolveSessionInScope trước khi gọi moLaiBuoi", () => {
    const act = boChuThich(doc("app/(admin)/admin/classes/[id]/_curriculum-actions.ts"));
    const i = act.indexOf("export async function moLaiBuoiAction");
    expect(i).toBeGreaterThan(-1);
    const than = act.slice(i, act.indexOf("export async function", i + 10));
    const gate = than.indexOf("await gate()");
    const scope = than.indexOf("resolveSessionInScope(");
    const goi = than.indexOf("moLaiBuoi(");
    expect(gate).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(gate);
    expect(goi).toBeGreaterThan(scope);
  });

  it("[MLB-W8] màn hình: nút Mở lại gọi moLaiBuoiAction và dùng buoiCoTheMoLai (cùng nguồn với server)", () => {
    const ui = boChuThich(doc("app/(admin)/admin/classes/[id]/_components/class-sessions-manage.tsx"));
    expect(ui).toMatch(/moLaiBuoiAction\(session\.id,/);
    expect(ui).toMatch(/buoiCoTheMoLai\(\{/);
    expect(ui).not.toMatch(/>\s*GV chính\s*</); // nhãn ô này ghi substituteTeacherId — không còn mang tên "GV chính"
  });
});
