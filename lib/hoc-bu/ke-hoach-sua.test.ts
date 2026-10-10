// [KHS-*] — KẾ HOẠCH SỬA DỮ LIỆU HỌC BÙ, phần THUẦN (T15). Đường chạm Postgres: tests/hoc-bu/sua-du-lieu.test.ts (SDL-*).
import { describe, expect, it } from "vitest";
import { LUAT, type Finding, type MaLuat, type PhanLoai } from "./toan-ven";
import { dongTuDongCuaLuat, dungBaoCaoKeHoach, KHO_SUA, kiemExpect, lapKeHoachSua, LoiExpect, tuDongDuoc } from "./ke-hoach-sua";

const f = (luat: MaLuat, phanLoai: PhanLoai, lienQuan?: Record<string, string>, id = "x1"): Finding => ({
  luat,
  nghiemTrong: "HIGH",
  phanLoai,
  thucThe: "MakeupNeed",
  id,
  lyDo: "lý do",
  deXuat: "đề xuất",
  ...(lienQuan ? { lienQuan } : {}),
});

const DU_LIEU: Partial<Record<MaLuat, Record<string, string>>> = {
  "TV-03": { baiBuoiGoc: "bai-1" },
  "TV-20": { buoiGoc: "b1", hocVien: "hv1", trangThaiGoc: "ABSENT" },
  "TV-31": { diemDanh: "dd1" },
  "TV-50": { donPhi: "od1" },
};
const TU_DONG = (Object.keys(KHO_SUA) as MaLuat[]).filter((l) => KHO_SUA[l].cachSua === "TU_DONG");

describe("[KHS] kế hoạch sửa dữ liệu học bù", () => {
  it("[KHS-01] bảng sửa ĐỦ cho MỌI luật đang chạy và không thừa luật lạ — thêm luật mới mà quên khai cách sửa là đỏ", () => {
    expect(Object.keys(KHO_SUA).sort()).toEqual(Object.keys(LUAT).sort());
  });

  it("[KHS-02] mỗi cách sửa có đủ thứ nó cần: SCRIPT_RIENG có script, CHI_NEU có lý do thủ công, TU_DONG khai dữ liệu máy đọc; danh sách TU_DONG được ghim", () => {
    for (const [luat, m] of Object.entries(KHO_SUA) as [MaLuat, (typeof KHO_SUA)[MaLuat]][]) {
      expect(m.ten.length, luat).toBeGreaterThan(5);
      if (m.cachSua === "SCRIPT_RIENG") expect(m.script, luat).toContain("scripts/");
      if (m.cachSua === "CHI_NEU") expect(m.lyDoThuCong, luat).toBeTruthy();
      if (m.cachSua === "TU_DONG") expect(m.canLienQuan, luat).toBeDefined();
    }
    expect(TU_DONG.sort()).toEqual(["TV-03", "TV-10", "TV-11", "TV-20", "TV-31", "TV-50"]);
  });

  it("[KHS-03] tự động CHỈ KHI cả ba điều kiện: luật có hàm sửa · checker nói AUTO_FIXABLE · đủ dữ liệu máy đọc", () => {
    for (const l of TU_DONG) {
      const ok = f(l, "AUTO_FIXABLE", DU_LIEU[l]);
      expect(tuDongDuoc(ok), l).toEqual({ duoc: true, lyDo: "" });
      for (const khac of ["NEEDS_MANUAL_REVIEW", "INVALID", "SAFE"] as const) {
        const r = tuDongDuoc(f(l, khac, DU_LIEU[l]));
        expect(r.duoc, `${l}/${khac}`).toBe(false);
        expect(r.lyDo, `${l}/${khac}`).toContain(khac);
      }
    }
    // Thiếu dữ liệu máy đọc ⇒ không tự sửa dù AUTO_FIXABLE (TV-10/11 không cần dữ liệu thêm).
    for (const l of TU_DONG.filter((x) => (KHO_SUA[x].canLienQuan ?? []).length > 0)) {
      const r = tuDongDuoc(f(l, "AUTO_FIXABLE", {}));
      expect(r.duoc, l).toBe(false);
      expect(r.lyDo, l).toContain("Thiếu dữ liệu máy đọc");
    }
    expect(tuDongDuoc(f("TV-10", "AUTO_FIXABLE")).duoc).toBe(true);
  });

  it("[KHS-04] KHÔNG BỊA TRẠNG THÁI VẮNG: TV-20 không có `trangThaiGoc` (không bằng chứng) hoặc bị phân NEEDS_MANUAL_REVIEW ⇒ không bao giờ tự động, dù mọi trường khác đủ", () => {
    expect(tuDongDuoc(f("TV-20", "NEEDS_MANUAL_REVIEW", { buoiGoc: "b1", hocVien: "hv1" })).duoc).toBe(false);
    expect(tuDongDuoc(f("TV-20", "NEEDS_MANUAL_REVIEW", DU_LIEU["TV-20"])).duoc).toBe(false); // có trường nhưng checker KHÔNG chứng minh
    expect(tuDongDuoc(f("TV-20", "AUTO_FIXABLE", { buoiGoc: "b1", hocVien: "hv1" })).duoc).toBe(false);
  });

  it("[KHS-05] luật SCRIPT_RIENG / CHI_NEU không bao giờ tự động, kể cả khi checker gọi AUTO_FIXABLE (TV-08, TV-35, TV-40…)", () => {
    for (const l of ["TV-08", "TV-35", "TV-40", "TV-23"] as const) {
      const r = tuDongDuoc(f(l, "AUTO_FIXABLE", { x: "y" }));
      expect(r.duoc, l).toBe(false);
      expect(r.lyDo, l).toContain("scripts/");
    }
    expect(tuDongDuoc(f("TV-07", "AUTO_FIXABLE")).duoc).toBe(false);
  });

  it("[KHS-06] lập kế hoạch: đếm theo luật × cách sửa KỂ CẢ luật ra 0; cách sửa của dòng không đủ điều kiện hạ xuống CHI_NEU (không giữ nhãn TU_DONG suông)", () => {
    const kh = lapKeHoachSua([
      f("TV-03", "AUTO_FIXABLE", DU_LIEU["TV-03"], "a"),
      f("TV-03", "NEEDS_MANUAL_REVIEW", undefined, "b"),
      f("TV-08", "AUTO_FIXABLE", undefined, "c"),
      f("TV-07", "NEEDS_MANUAL_REVIEW", undefined, "d"),
    ]);
    expect(Object.keys(kh.demTheoLuat).sort()).toEqual(Object.keys(LUAT).sort());
    expect(kh.demTheoLuat["TV-03"]).toEqual({ tong: 2, tuDong: 1, scriptRieng: 0, chiNeu: 1 });
    expect(kh.demTheoLuat["TV-08"]).toEqual({ tong: 1, tuDong: 0, scriptRieng: 1, chiNeu: 0 });
    expect(kh.demTheoLuat["TV-07"]).toEqual({ tong: 1, tuDong: 0, scriptRieng: 0, chiNeu: 1 });
    expect(kh.demTheoLuat["TV-01"]).toEqual({ tong: 0, tuDong: 0, scriptRieng: 0, chiNeu: 0 });
    expect(kh.dong.find((d) => d.id === "b")).toMatchObject({ cachSua: "CHI_NEU", tuDongDuoc: false });
  });

  it("[KHS-07] --expect: khớp ⇒ trả đúng tập dòng; lệch ⇒ LoiExpect nói số thật; sai kiểu / âm ⇒ từ chối; luật không có đường tự động ⇒ từ chối", () => {
    const kh = lapKeHoachSua([f("TV-31", "AUTO_FIXABLE", DU_LIEU["TV-31"], "a"), f("TV-31", "AUTO_FIXABLE", DU_LIEU["TV-31"], "b")]);
    expect(kiemExpect(kh, "TV-31", 2).map((d) => d.id)).toEqual(["a", "b"]);
    expect(() => kiemExpect(kh, "TV-31", 1)).toThrow(LoiExpect);
    expect(() => kiemExpect(kh, "TV-31", 3)).toThrow(/hiện có 2 phát hiện/);
    expect(() => kiemExpect(kh, "TV-31", -1)).toThrow(/số nguyên không âm/);
    expect(() => kiemExpect(kh, "TV-31", 1.5)).toThrow(LoiExpect);
    expect(() => kiemExpect(kh, "TV-07", 0)).toThrow(/không có đường sửa tự động/);
    expect(() => kiemExpect(kh, "TV-08", 0)).toThrow(/SCRIPT_RIENG/);
    expect(dongTuDongCuaLuat(kh, "TV-03")).toEqual([]);
    expect(kiemExpect(kh, "TV-03", 0)).toEqual([]);
  });

  it("[KHS-08] báo cáo: chỉ in lệnh chạy cho luật CÓ dòng tự động, kèm đúng số --expect; luật ra 0 không in; luôn nói 'CHỈ ĐỌC'", () => {
    const kh = lapKeHoachSua([f("TV-50", "AUTO_FIXABLE", DU_LIEU["TV-50"], "a"), f("TV-50", "AUTO_FIXABLE", DU_LIEU["TV-50"], "b"), f("TV-07", "NEEDS_MANUAL_REVIEW", undefined, "c")]);
    const md = dungBaoCaoKeHoach(kh, { db: "x", luc: "2026-10-08T00:00:00.000Z" });
    expect(md).toContain("CHỈ ĐỌC");
    expect(md).toContain("--ap-dung --luat=TV-50 --expect=2");
    expect(md).not.toContain("--luat=TV-07");
    expect(md).not.toContain("--luat=TV-03");
    expect(md).toContain("**2** sửa tự động được");
  });
});
