// [DN-*] — `lapThuTuDich`: thứ tự dời ngày buổi học không bao giờ để hai buổi cùng lớp chiếm một thời điểm.
// Oracle = một "DB giả" có đúng ràng buộc duy nhất: mỗi bước phải lấy chỗ đang CÓ NGƯỜI giữ (tu) và đặt vào chỗ TRỐNG (den).
import { describe, expect, it } from "vitest";
import { lapThuTuDich, ngayDo, type BuocDich, type DoiNgay } from "@/lib/classes/dich-ngay";

const d = (day: number) => new Date(Date.UTC(2026, 4, day, 11, 0)); // 5/2026, 18:00 VN
const doi = (id: string, tu: number, den: number): DoiNgay => ({ id, oldDate: d(tu), newDate: d(den) });

/** Chạy các bước trên DB giả có ràng buộc duy nhất; ném khi vi phạm; trả tập chỗ cuối cùng theo id. */
function chay(buoc: BuocDich[], khoiDau: Map<string, Date>, codinh: Date[]) {
  const vitri = new Map(khoiDau);
  const occ = new Map<number, string>(); // ms → id ("#" = cố định)
  for (const [id, dt] of vitri) occ.set(dt.getTime(), id);
  for (const c of codinh) occ.set(c.getTime(), "#");
  for (const b of buoc) {
    if (occ.get(b.tu.getTime()) !== b.id) throw new Error(`bước sai: ${b.id} không đang ở ${b.tu.toISOString()}`);
    if (occ.has(b.den.getTime())) throw new Error(`VI PHẠM duy nhất: ${b.id} → ${b.den.toISOString()} đang có ${occ.get(b.den.getTime())}`);
    occ.delete(b.tu.getTime());
    occ.set(b.den.getTime(), b.id);
    vitri.set(b.id, b.den);
  }
  return vitri;
}
const khoi = (xs: DoiNgay[]) => new Map(xs.map((x) => [x.id, x.oldDate]));

describe("[DN] lapThuTuDich", () => {
  it("[DN-01] cuốn chiếu tiến: 5,7,12,14,19 → 5,12,14,19,21 — đi từ buổi CUỐI về trước, không vi phạm", () => {
    const xs = [doi("b1", 5, 5), doi("b2", 7, 12), doi("b3", 12, 14), doi("b4", 14, 19), doi("b5", 19, 21)];
    const r = lapThuTuDich(xs, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buoc.map((b) => b.id)).toEqual(["b5", "b4", "b3", "b2"]); // b1 không đổi ⇒ không có bước
    expect(r.buoc.every((b) => !b.tam)).toBe(true);
    const cuoi = chay(r.buoc, khoi(xs), []);
    expect([...cuoi].map(([id, dt]) => [id, dt.getTime()])).toEqual(
      expect.arrayContaining(xs.filter((x) => x.id !== "b1").map((x) => [x.id, x.newDate.getTime()])),
    );
  });

  it("[DN-02] cuốn chiếu lùi: đi từ buổi ĐẦU về sau", () => {
    const xs = [doi("b1", 14, 12), doi("b2", 19, 14), doi("b3", 21, 19)];
    const r = lapThuTuDich(xs, []);
    expect(r.ok && r.buoc.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
    if (r.ok) chay(r.buoc, khoi(xs), []);
  });

  it("[DN-03] hai buổi đổi chỗ cho nhau (VÒNG): đúng một bước đỗ, tổng ba bước, không vi phạm", () => {
    const xs = [doi("a", 5, 7), doi("b", 7, 5)];
    const r = lapThuTuDich(xs, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buoc.filter((b) => b.tam)).toHaveLength(1);
    expect(r.buoc).toHaveLength(3);
    const cuoi = chay(r.buoc, khoi(xs), []);
    expect(cuoi.get("a")!.getTime()).toBe(d(7).getTime());
    expect(cuoi.get("b")!.getTime()).toBe(d(5).getTime());
  });

  it("[DN-04] vòng ba buổi cũng chỉ cần MỘT bước đỗ", () => {
    const xs = [doi("a", 5, 7), doi("b", 7, 12), doi("c", 12, 5)];
    const r = lapThuTuDich(xs, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buoc.filter((b) => b.tam)).toHaveLength(1);
    chay(r.buoc, khoi(xs), []);
  });

  it("[DN-05] đích trùng buổi CỐ ĐỊNH của lớp ⇒ từ chối, nói rõ ngày", () => {
    const r = lapThuTuDich([doi("a", 5, 7)], [d(7)]);
    expect(r).toEqual({ ok: false, loi: { ma: "DE_LEN_BUOI_KHAC", ngay: d(7) } });
  });

  it("[DN-06] hai buổi cùng muốn một đích ⇒ từ chối", () => {
    const r = lapThuTuDich([doi("a", 5, 9), doi("b", 7, 9)], []);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi.ma).toBe("TRUNG_DICH");
  });

  it("[DN-07] cùng một buổi xuất hiện hai lần trong lô ⇒ từ chối", () => {
    const r = lapThuTuDich([doi("a", 5, 9), doi("a", 5, 10)], []);
    expect(!r.ok && r.loi).toEqual({ ma: "LAP_ID", id: "a" });
  });

  it("[DN-08] bước nào cũng có đích khác chỗ cũ; lô toàn không đổi ⇒ không bước nào", () => {
    const r = lapThuTuDich([doi("a", 5, 5), doi("b", 7, 7)], []);
    expect(r).toEqual({ ok: true, buoc: [] });
    expect(lapThuTuDich([], [])).toEqual({ ok: true, buoc: [] });
  });

  it("[DN-09] ngẫu nhiên có hạt giống: 300 lô (hoán vị + dịch + buổi cố định) — không lần nào vi phạm, đích đúng, đỗ ≤ số vòng", () => {
    let seed = 20261007;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let lan = 0; lan < 300; lan++) {
      const n = 2 + Math.floor(rnd() * 8);
      // n chỗ ngày 1..(n+3); chọn n chỗ khác nhau làm chỗ cũ, rồi một hoán vị/dịch làm chỗ mới trên tập (cũ ∪ chỗ trống)
      const kho = Array.from({ length: n + 4 }, (_, i) => i + 1);
      const xao = [...kho].sort(() => rnd() - 0.5);
      const cu = xao.slice(0, n);
      const nhom = [...cu, ...xao.slice(n, n + 2)];
      const moi = [...nhom].sort(() => rnd() - 0.5).slice(0, n);
      const xs = cu.map((c, i) => doi(`s${i}`, c, moi[i]!));
      const codinh = xao.slice(n + 2).map((c) => d(c)).filter((x) => !moi.includes(x.getUTCDate()));
      const r = lapThuTuDich(xs, codinh);
      expect(r.ok, `lan ${lan}`).toBe(true);
      if (!r.ok) continue;
      const cuoi = chay(r.buoc, khoi(xs), codinh);
      for (const x of xs) expect(cuoi.get(x.id)!.getTime(), `lan ${lan} ${x.id}`).toBe(x.newDate.getTime());
      // không bước đỗ nào khi lô không có vòng — kiểm gián tiếp: số bước đỗ ≤ n/2 (vòng ≥ 2 buổi)
      expect(r.buoc.filter((b) => b.tam).length).toBeLessThanOrEqual(Math.floor(n / 2));
    }
  });

  it("[DN-10] ngày đỗ: rơi vào năm 1900, mỗi k một giá trị riêng", () => {
    expect(ngayDo(1).getUTCFullYear()).toBe(1900);
    expect(new Set([1, 2, 3, 4].map((k) => ngayDo(k).getTime())).size).toBe(4);
  });
});
