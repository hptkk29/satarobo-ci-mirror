// [PV-*] — `giaiPhamVi`: bốn phạm vi áp lịch quy về (mốc, tập buổi bị loại). THUẦN, giờ truyền vào (luật 19).
import { describe, expect, it } from "vitest";
import { giaiPhamVi, type BuoiChoPhamVi } from "@/lib/classes/phamvi-ap-lich";
import { vnDateAt, vnYmd } from "@/lib/time/vn";

const at = (d: number, h = 18, m = 0) => vnDateAt(2026, 10, d, h, m); // tháng 11/2026 (0-based = 10), giờ VN
const B = (id: string, d: number, status = "SCHEDULED", h = 18): BuoiChoPhamVi => ({ id, date: at(d, h), status });
const BUOI = [B("a", 3), B("b", 5), B("c", 10), B("d", 12), B("x", 14, "CANCELLED"), B("e", 17)];
const NOW = at(10, 9); // sáng 10/11: buổi a, b đã qua; c (18:00 cùng ngày) chưa tới giờ

describe("[PV] giaiPhamVi", () => {
  it("[PV-01] TU_NGAY: giữ nguyên mốc người dùng chọn, không loại buổi nào", () => {
    const r = giaiPhamVi({ loai: "TU_NGAY", ngay: at(7, 0) }, { now: NOW, buoi: BUOI });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.applyFrom.getTime()).toBe(at(7, 0).getTime());
    expect(r.ngoaiPhamVi.size).toBe(0);
  });

  it("[PV-02] TU_BUOI_NAY: mốc = 00:00 giờ VN của ngày buổi đã chọn; không loại buổi nào", () => {
    const r = giaiPhamVi({ loai: "TU_BUOI_NAY", sessionId: "c" }, { now: NOW, buoi: BUOI });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(vnYmd(r.applyFrom)).toBe("2026-11-10");
    expect(r.applyFrom.getTime()).toBe(at(10, 0).getTime());
    expect(r.ngoaiPhamVi.size).toBe(0);
  });

  it("[PV-03] CHỈ_BUOI_NAY: mọi buổi SỐNG từ ngày đó trở đi, TRỪ buổi đã chọn, bị loại; buổi trước mốc và buổi huỷ không có trong danh sách", () => {
    const r = giaiPhamVi({ loai: "CHI_BUOI_NAY", sessionId: "c" }, { now: NOW, buoi: BUOI });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.ngoaiPhamVi.keys()].sort()).toEqual(["d", "e"]);
    expect(r.ngoaiPhamVi.get("d")).toContain("ngoài phạm vi");
  });

  it("[PV-04] TU_BUOI_NAY / CHI_BUOI_NAY: buổi lạ hoặc đã huỷ ⇒ từ chối bằng câu nói được", () => {
    for (const loai of ["TU_BUOI_NAY", "CHI_BUOI_NAY"] as const) {
      const la = giaiPhamVi({ loai, sessionId: "khong-co" }, { now: NOW, buoi: BUOI });
      expect(la).toEqual({ ok: false, error: "Buổi học không thuộc lớp này." });
      const huy = giaiPhamVi({ loai, sessionId: "x" }, { now: NOW, buoi: BUOI });
      expect(huy.ok).toBe(false);
      expect(!huy.ok && huy.error).toContain("đã huỷ");
    }
  });

  it("[PV-05] TOAN_BO_CHUA_DIEN_RA: mốc = ngày của buổi chưa diễn ra đầu tiên; buổi CÙNG NGÀY đã qua giờ bị loại là 'đã diễn ra'", () => {
    const buoi = [B("a", 3), B("m", 10, "SCHEDULED", 8), B("c", 10), B("d", 12)];
    const r = giaiPhamVi({ loai: "TOAN_BO_CHUA_DIEN_RA" }, { now: NOW, buoi });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(vnYmd(r.applyFrom)).toBe("2026-11-10");
    // Buổi 'm' (08:00 ngày 10, đã qua so với 09:00? — NOW = 09:00): qua giờ ⇒ loại. 'a' trước mốc nên không có trong danh sách.
    expect([...r.ngoaiPhamVi.entries()]).toEqual([["m", "đã diễn ra"]]);
  });

  it("[PV-06] TOAN_BO_CHUA_DIEN_RA: không còn buổi nào sau `now` ⇒ từ chối; buổi huỷ không được tính là 'chưa diễn ra'", () => {
    const het = giaiPhamVi({ loai: "TOAN_BO_CHUA_DIEN_RA" }, { now: at(30), buoi: BUOI });
    expect(het).toEqual({ ok: false, error: "Lớp không còn buổi nào chưa diễn ra." });
    // Chỉ còn buổi HUỶ ở tương lai ⇒ vẫn là "không còn".
    const chiHuy = giaiPhamVi({ loai: "TOAN_BO_CHUA_DIEN_RA" }, { now: at(13), buoi: [B("a", 3), B("x", 14, "CANCELLED")] });
    expect(chiHuy.ok).toBe(false);
  });

  it("[PV-07] đổi `now` đổi kết quả: cùng lớp, sớm hơn thì mốc lùi về buổi đầu chưa diễn ra", () => {
    const sang = giaiPhamVi({ loai: "TOAN_BO_CHUA_DIEN_RA" }, { now: at(2), buoi: BUOI });
    const muon = giaiPhamVi({ loai: "TOAN_BO_CHUA_DIEN_RA" }, { now: at(11), buoi: BUOI });
    expect(sang.ok && vnYmd(sang.applyFrom)).toBe("2026-11-03");
    expect(muon.ok && vnYmd(muon.applyFrom)).toBe("2026-11-12");
  });
});
