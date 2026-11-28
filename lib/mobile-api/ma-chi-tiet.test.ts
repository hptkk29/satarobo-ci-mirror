import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: vi.fn(async () => ({ success: true, resetAt: Date.now() + 1000 })) }));

import { fail } from "@/lib/api/response";

import { traLoi } from "./cong";
import { ANH_XA_LOI } from "./dich-vu/disc";
import { LoiApiMobile } from "./xac-thuc/dich-vu";

/**
 * [MCT] `error.maChiTiet` (V8.30, B chọn «CÁCH B»): giữ `code: VALIDATION`/HTTP 409, THÊM trường tuỳ chọn ổn định. TƯƠNG THÍCH NGƯỢC: không có `maChiTiet` ⇒ thân phản hồi y hệt trước.
 *   [MCT-01] có maChiTiet ⇒ thân `{ok:false,error:{code,message,maChiTiet,requestId}}`, status/Retry-After giữ nguyên
 *   [MCT-02] KHÔNG có maChiTiet ⇒ KHÔNG có khoá `maChiTiet` (client cũ + mọi mã khác y nguyên); `fail()` của web không đổi
 *   [MCT-03] DISC: 6 mã 409 dùng chung VALIDATION có maChiTiet đúng bảng đề xuất; mã riêng sẵn có KHÔNG thêm maChiTiet
 *   [MCT-04] LƯỚI NGUỒN: mọi chỗ `"VALIDATION", 409` trong lib/mobile-api đều kèm maChiTiet (thêm xung đột 409 mới mà quên mã ⇒ đỏ) và tập mã khớp bảng
 *   [MCT-05] tên mã ổn định: chỉ A–Z/số/gạch dưới, ≥ 4 ký tự, không trùng một `code` chính thức (khỏi nhầm lẫn khi client rẽ nhánh)
 */
const doc = async (r: Response) => ({ status: r.status, retry: r.headers.get("retry-after"), body: (await r.json()) as { ok: boolean; error: Record<string, unknown> } });

describe("[MCT] error.maChiTiet", () => {
  it("[MCT-01] có maChiTiet ⇒ code VALIDATION + 409 giữ nguyên, thêm maChiTiet; thứ tự khoá chuẩn; message giữ nguyên", async () => {
    const r = await doc(traLoi(new LoiApiMobile("VALIDATION", 409, "Chưa có sổ.", undefined, "SO_DA_TON_TAI")));
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(Object.keys(r.body.error)).toEqual(["code", "message", "maChiTiet", "requestId"]);
    expect(r.body.error).toMatchObject({ code: "VALIDATION", message: "Chưa có sổ.", maChiTiet: "SO_DA_TON_TAI" });
    const rl = await doc(traLoi(new LoiApiMobile("RATE_LIMITED", 429, "Chậm lại", 30, "QUA_NHANH")));
    expect([rl.status, rl.retry]).toEqual([429, "30"]); // Retry-After vẫn đi cùng
  });

  it("[MCT-02] KHÔNG có maChiTiet ⇒ không có khoá `maChiTiet` (y hệt trước); fail() của web không đổi", async () => {
    const r = await doc(traLoi(new LoiApiMobile("VALIDATION", 409, "x")));
    expect(Object.keys(r.body.error)).toEqual(["code", "message", "requestId"]);
    const w = await doc(fail("VALIDATION", "y", { status: 400, field: "ten" }));
    expect(Object.keys(w.body.error)).toEqual(["code", "message", "field", "requestId"]);
    const s = await doc(traLoi(new Error("lỗi lạ")));
    expect([s.status, s.body.error.code, "maChiTiet" in s.body.error]).toEqual([500, "SERVER", false]);
  });

  // V8.31 — mã DISC mới/được bổ sung `maChiTiet` (code giữ trong tập B đã biết): PIN sai/khoá + 9 trạng thái của cổng PIN ép ở máy chủ.
  const MA_PIN_MOI = new Set(["PIN_SAI", "PIN_BI_KHOA", "DISC_CHUA_MO_KHOA", "DISC_PHIEN_HET_HAN", "DISC_PHIEN_THU_HOI", "DISC_KHONG_DU_QUYEN", "CAN_PIN_CU_HOAC_MAT_KHAU", "DISC_PIN_XUNG_DOT", "MAT_KHAU_SAI", "MAT_KHAU_BI_KHOA", "DISC_LOI_HE_THONG", "DISC_CAN_CAP_NHAT_APP"]);
  it("[MCT-03] DISC: bảy mã 409 chung VALIDATION có maChiTiet đúng bảng; mã riêng sẵn có không thêm", () => {
    const mong: Record<string, string> = { DA_CO_SO: "SO_DA_TON_TAI", DAY_THANH_VIEN: "SO_DAY_THANH_VIEN", KHONG_XOA_DUOC_CHU_SO: "KHONG_XOA_CHU_SO", HOC_VIEN_DA_NOI: "HOC_VIEN_DA_NOI", KHONG_TICK_DUOC: "KHONG_DANH_DAU_DUOC", CHUA_DAT_PIN: "CHUA_DAT_PIN", DISC_PIN_XUNG_DOT: "DISC_PIN_XUNG_DOT" };
    for (const [k, v] of Object.entries(ANH_XA_LOI)) {
      const co = (v as { maChiTiet?: string }).maChiTiet;
      if (v.code === "VALIDATION" && v.status === 409) expect(co, k).toBe(mong[k]);
      else if (!MA_PIN_MOI.has(k)) expect(co, `${k} (mã riêng/khác) không được thêm maChiTiet`).toBeUndefined();
      else expect(co, `${k} (PIN ép ở máy chủ V8.31) phải có maChiTiet`).toMatch(/^DISC_[A-Z_]+$|^CAN_PIN_CU_HOAC_MAT_KHAU$/);
    }
    expect(Object.keys(mong).sort()).toEqual(Object.entries(ANH_XA_LOI).filter(([, v]) => v.code === "VALIDATION" && v.status === 409).map(([k]) => k).sort());
  });

  const GOC = resolve(process.cwd(), "lib/mobile-api");
  const tep = (d: string, ra: string[] = []): string[] => {
    for (const t of readdirSync(d)) { const p = join(d, t); if (statSync(p).isDirectory()) tep(p, ra); else if (/\.ts$/.test(t) && !/\.test\.ts$/.test(t)) ra.push(p); }
    return ra;
  };
  const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("[MCT-04] lưới nguồn: mọi `\"VALIDATION\", 409` (và hàm `LOI_YEU_CAU`) đều kèm maChiTiet; tập mã khớp bảng đề xuất", () => {
    const thieu: string[] = [];
    const gap = new Set<string>();
    for (const f of tep(GOC)) {
      const ma = boChuThich(readFileSync(f, "utf8"));
      for (const m of ma.matchAll(/"VALIDATION",\s*409,/g)) {
        const cau = ma.slice(m.index!).split(";")[0]!;
        const k = /"([A-Z][A-Z0-9_]{3,})"\)\s*$/.exec(cau.trim());
        if (!k) thieu.push(`${f.slice(GOC.length + 1)}: ${cau.slice(0, 90).replace(/\s+/g, " ")}`);
        else gap.add(k[1]!);
      }
      for (const m of ma.matchAll(/status: 409,\s*maChiTiet: "([A-Z0-9_]+)"/g)) gap.add(m[1]!);
      // dạng bảng ánh xạ: VALIDATION + 409 mà KHÔNG có maChiTiet
      for (const m of ma.matchAll(/code: "VALIDATION", status: 409 \}/g)) thieu.push(`${f.slice(GOC.length + 1)}: bảng ánh xạ thiếu maChiTiet`);
    }
    expect(thieu).toEqual([]);
    const BANG = ["DA_KICH_HOAT", "TAI_KHOAN_KHONG_HOP_LE", "CHUA_CO_MA_THOAT", "CHUA_CO_MAT_KHAU", "DA_CO_MA_THOAT", "LINK_DA_THU_HOI", "NGUOI_DON_TRUNG_SDT", "KHAO_SAT_DA_TRA_LOI", "QUA_NHIEU_YEU_CAU_CHO", "YEU_CAU_KHONG_HOP_LE", "YEU_CAU_KHONG_CON_CHO", "TAI_KHOAN_VUA_DOI", "SO_DA_TON_TAI", "SO_DAY_THANH_VIEN", "KHONG_XOA_CHU_SO", "HOC_VIEN_DA_NOI", "KHONG_DANH_DAU_DUOC", "CHUA_DAT_PIN", "DISC_PIN_XUNG_DOT"];
    expect([...gap].sort()).toEqual([...BANG].sort());
  });

  it("[MCT-05] tên mã ổn định và không trùng `code` chính thức", () => {
    const codes = new Set(readFileSync(resolve(process.cwd(), "lib/mobile-api/xac-thuc/dich-vu.ts"), "utf8").match(/\| "([A-Z_]+)"/g)?.map((x) => x.replace(/[| "]/g, "")) ?? []);
    const BANG = ["DA_KICH_HOAT", "TAI_KHOAN_KHONG_HOP_LE", "CHUA_CO_MA_THOAT", "CHUA_CO_MAT_KHAU", "DA_CO_MA_THOAT", "LINK_DA_THU_HOI", "NGUOI_DON_TRUNG_SDT", "KHAO_SAT_DA_TRA_LOI", "QUA_NHIEU_YEU_CAU_CHO", "YEU_CAU_KHONG_HOP_LE", "YEU_CAU_KHONG_CON_CHO", "TAI_KHOAN_VUA_DOI", "SO_DA_TON_TAI", "SO_DAY_THANH_VIEN", "KHONG_XOA_CHU_SO", "HOC_VIEN_DA_NOI", "KHONG_DANH_DAU_DUOC", "CHUA_DAT_PIN", "DISC_PIN_XUNG_DOT"];
    for (const m of BANG) {
      expect(m, m).toMatch(/^[A-Z][A-Z0-9_]{3,}$/);
      expect(codes.has(m), `${m} trùng một code chính thức`).toBe(false);
    }
    expect(codes.size).toBeGreaterThan(20); // phép đọc `code` thật sự có dữ liệu (không rỗng giả)
  });
});
