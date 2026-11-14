import { describe, expect, it } from "vitest";

import { DIEM, bai, tv } from "./fixture";
import { chenhLechVoiLanTruoc, hoSoCaNha, hoSoDangDung, lichSuLanLam, soSanhTrucTiep } from "./ho-so-dang-dung";

describe("hồ sơ đang dùng (doc 18, 2.5)", () => {
  it("[SG-HS-01] lấy bài TỰ LÀM mới nhất, không phải bài mới nhất nói chung", () => {
    const ds = [
      bai("a1", "x", "TU_LAM", DIEM.boD, "2026-06-03"),
      bai("a2", "x", "TU_LAM", DIEM.meC, "2026-10-28"),
      bai("a3", "x", "GOC_NHIN", DIEM.conI, "2026-11-01"),
    ];
    expect(hoSoDangDung(ds)?.id).toBe("a2");
  });

  it("[SG-HS-02] chưa từng tự làm ⇒ lấy bài góc nhìn mới nhất", () => {
    const ds = [bai("g1", "x", "GOC_NHIN", DIEM.boD, "2026-10-15"), bai("g2", "x", "GOC_NHIN", DIEM.meC, "2026-10-20")];
    expect(hoSoDangDung(ds)?.id).toBe("g2");
  });

  it("[SG-HS-03] bài cũ hơn không bao giờ chen lên, kể cả khi thứ tự mảng đảo", () => {
    const moi = bai("m", "x", "TU_LAM", DIEM.boD, "2026-10-28");
    const cu = bai("c", "x", "TU_LAM", DIEM.meC, "2026-06-03");
    expect(hoSoDangDung([moi, cu])?.id).toBe("m");
    expect(hoSoDangDung([cu, moi])?.id).toBe("m");
  });

  it("[SG-HS-04] không có bài nào ⇒ null; bằng thời gian ⇒ phân xử theo id, không theo thứ tự mảng", () => {
    expect(hoSoDangDung([])).toBeNull();
    const p = bai("a", "x", "TU_LAM", DIEM.boD, "2026-10-28");
    const q = bai("b", "x", "TU_LAM", DIEM.meC, "2026-10-28");
    expect(hoSoDangDung([p, q])?.id).toBe(hoSoDangDung([q, p])?.id);
  });

  it("[SG-HS-05] hoSoCaNha tách đúng theo người, bài «chưa xếp» không thuộc ai", () => {
    const ds = [
      bai("1", "u1", "TU_LAM", DIEM.boD, "2026-10-01"),
      bai("2", "u2", "GOC_NHIN", DIEM.meC, "2026-10-02"),
      bai("3", null, "TU_LAM", DIEM.conI, "2026-10-03"),
    ];
    const m = hoSoCaNha([tv("u1", "A", "bo"), tv("u2", "B", "con", "3"), tv("u3", "C", "me")], ds);
    expect(m.get("u1")?.id).toBe("1");
    expect(m.get("u2")?.id).toBe("2");
    expect(m.get("u3")).toBeNull();
  });

  it("[SG-HS-06] chỉ so trực tiếp khi CÙNG phiên bản và CÙNG bộ đề; điểm cũ không bị tính lại", () => {
    const g = bai("g", "x", "TU_LAM", DIEM.boD, "2026-10-01", "PH", "1.1");
    const n = bai("n", "x", "TU_LAM", DIEM.meC, "2026-10-02", "PH", "nh:nh1");
    expect(soSanhTrucTiep(g, g)).toBe(true);
    expect(soSanhTrucTiep(g, n)).toBe(false);
    const ls = lichSuLanLam([g, n]);
    expect(ls.map((b) => b.id)).toEqual(["n", "g"]);
    expect(chenhLechVoiLanTruoc(ls, 0)).toBeNull();
    const g2 = bai("g2", "x", "TU_LAM", { D: 90, I: 40, S: 20, C: 45 }, "2026-10-09", "PH", "1.1");
    const ls2 = lichSuLanLam([bai("g1", "x", "TU_LAM", { D: 80, I: 40, S: 25, C: 45 }, "2026-10-01"), g2]);
    expect(chenhLechVoiLanTruoc(ls2, 0)).toEqual({ D: 10, I: 0, S: -5, C: 0 });
    expect(chenhLechVoiLanTruoc(ls2, 1)).toBeNull();
  });
});
