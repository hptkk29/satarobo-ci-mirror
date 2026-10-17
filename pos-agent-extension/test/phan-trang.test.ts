/**
 * Phân trang search portal: `page_size` 50, lặp tới khi nhận ĐỦ `total_items` (roadmap §6 GĐ5).
 * Bộ duyệt không tin `page_size` của portal (portal có thể dùng cỡ riêng) — nó đếm DÒNG đã nhận.
 */
import { describe, expect, it } from "vitest";
import { duyetTrang, type KetQuaTrang } from "../src/lib/phan-trang";

type LoiGia = { ma: "LOI_GIA" };

function portalCoDinh(tong: number, coTrang: number) {
  const goi: number[] = [];
  const fn = async (pageIndex: number): Promise<KetQuaTrang<LoiGia>> => {
    goi.push(pageIndex);
    const batDau = pageIndex * coTrang;
    const n = Math.max(0, Math.min(coTrang, tong - batDau));
    return { ok: true, rows: Array.from({ length: n }, (_, i) => ({ i: batDau + i })), totalItems: tong };
  };
  return { goi, fn };
}

async function gom(goiTrang: (pi: number) => Promise<KetQuaTrang<LoiGia>>, toiDa = 400) {
  const nhan: unknown[] = [];
  const kq = await duyetTrang(goiTrang, async (rows) => {
    nhan.push(...rows);
  }, toiDa);
  return { kq, nhan };
}

describe("Duyệt trang search portal", () => {
  it("[EXT-PT-01] 123 dòng, trang 50 ⇒ 3 lượt (0,1,2), nhận đủ 123 dòng, không trùng", async () => {
    const p = portalCoDinh(123, 50);
    const { kq, nhan } = await gom(p.fn);
    expect(kq).toEqual({ ok: true, soDong: 123, soTrang: 3 });
    expect(p.goi).toEqual([0, 1, 2]);
    expect(nhan).toHaveLength(123);
    expect(new Set(nhan.map((r) => (r as { i: number }).i)).size).toBe(123);
  });

  it("[EXT-PT-02] portal tự dùng cỡ trang 10 (bỏ qua page_size 50) ⇒ vẫn lặp tới đủ total_items", async () => {
    const p = portalCoDinh(37, 10);
    const { kq, nhan } = await gom(p.fn);
    expect(kq).toEqual({ ok: true, soDong: 37, soTrang: 4 });
    expect(nhan).toHaveLength(37);
  });

  it("[EXT-PT-03] total_items TĂNG giữa chừng (giao dịch mới tới) ⇒ đi tiếp tới tổng mới", async () => {
    let tong = 60;
    const goi: number[] = [];
    const fn = async (pi: number): Promise<KetQuaTrang<LoiGia>> => {
      goi.push(pi);
      const kq = { ok: true as const, rows: Array.from({ length: Math.max(0, Math.min(50, tong - pi * 50)) }, () => ({})), totalItems: tong };
      tong = 120; // sau trang đầu, portal báo tổng mới
      return kq;
    };
    const { kq, nhan } = await gom(fn);
    expect(kq.ok).toBe(true);
    expect(nhan).toHaveLength(120);
    expect(goi).toEqual([0, 1, 2]);
  });

  it("[EXT-PT-04] tổng 0 ⇒ đúng một lượt gọi, xong", async () => {
    const p = portalCoDinh(0, 50);
    const { kq } = await gom(p.fn);
    expect(kq).toEqual({ ok: true, soDong: 0, soTrang: 1 });
    expect(p.goi).toEqual([0]);
  });

  it("[EXT-PT-05] portal báo còn dòng nhưng trả trang RỖNG ⇒ THIEU_DONG (không lặp vô hạn, không coi là đủ)", async () => {
    const fn = async (pi: number): Promise<KetQuaTrang<LoiGia>> =>
      pi === 0 ? { ok: true, rows: [{}, {}], totalItems: 5 } : { ok: true, rows: [], totalItems: 5 };
    const { kq, nhan } = await gom(fn);
    expect(kq).toEqual({ ok: false, loi: { ma: "THIEU_DONG" }, soDong: 2, soTrang: 2 });
    expect(nhan).toHaveLength(2);
  });

  it("[EXT-PT-06] lỗi ở trang giữa ⇒ trả đúng lỗi đó, các trang trước đã giao", async () => {
    const fn = async (pi: number): Promise<KetQuaTrang<LoiGia>> =>
      pi < 2 ? { ok: true, rows: Array.from({ length: 50 }, () => ({})), totalItems: 500 } : { ok: false, loi: { ma: "LOI_GIA" } };
    const { kq, nhan } = await gom(fn);
    expect(kq).toEqual({ ok: false, loi: { ma: "LOI_GIA" }, soDong: 100, soTrang: 2 });
    expect(nhan).toHaveLength(100);
  });

  it("[EXT-PT-07] trần số trang ⇒ QUA_NHIEU_TRANG (chặn vòng lặp khi portal báo tổng vô lý)", async () => {
    const p = portalCoDinh(1_000_000, 50);
    const { kq } = await gom(p.fn, 5);
    expect(kq).toEqual({ ok: false, loi: { ma: "QUA_NHIEU_TRANG" }, soDong: 250, soTrang: 5 });
    expect(p.goi).toEqual([0, 1, 2, 3, 4]);
  });

  it("[EXT-PT-08] total_items sai kiểu ⇒ PORTAL_BAD_SHAPE ngay trang đầu", async () => {
    for (const totalItems of ["10", -1, 1.5, null, undefined]) {
      const fn = async (): Promise<KetQuaTrang<LoiGia>> => ({ ok: true, rows: [], totalItems });
      const { kq } = await gom(fn);
      expect(kq).toEqual({ ok: false, loi: { ma: "PORTAL_BAD_SHAPE" }, soDong: 0, soTrang: 0 });
    }
  });

  it("[EXT-PT-09] RV5 — portal trả LẠI trang cũ (bỏ qua page_index / đánh số khác) ⇒ THIEU_DONG, KHÔNG báo đủ dù đếm thô chạm total_items", async () => {
    const trang0 = Array.from({ length: 50 }, (_, i) => ({ transaction_id: `TXN${String(i).padStart(8, "0")}` }));
    const fn = async (): Promise<KetQuaTrang<LoiGia>> => ({ ok: true, rows: trang0.map((r) => ({ ...r })), totalItems: 100 });
    const { kq, nhan } = await gom(fn);
    expect(kq.ok).toBe(false);
    expect(kq).toMatchObject({ loi: { ma: "THIEU_DONG" } });
    expect(nhan).toHaveLength(50); // trang lặp KHÔNG được giao lại
  });

  it("[EXT-PT-10] RV5 — đối chứng: dòng MỚI chèn đầu danh sách giữa hai trang (một dòng trùng ở biên trang) vẫn đi tiếp, không coi là trang lặp", async () => {
    const tat = Array.from({ length: 101 }, (_, i) => ({ transaction_id: `TXN${String(i).padStart(8, "0")}` }));
    const fn = async (pi: number): Promise<KetQuaTrang<LoiGia>> => {
      // trang 0 đọc lúc 100 dòng (bỏ dòng 0 — chưa tới); từ trang 1 có thêm dòng mới ở đầu ⇒ trôi một dòng
      const ds = pi === 0 ? tat.slice(1) : tat;
      return { ok: true, rows: ds.slice(pi * 50, pi * 50 + 50), totalItems: pi === 0 ? 100 : 101 };
    };
    const { kq, nhan } = await gom(fn);
    expect(kq.ok).toBe(true);
    expect(nhan.length).toBe(101);
  });
});

