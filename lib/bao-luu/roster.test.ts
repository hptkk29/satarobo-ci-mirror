// @vitest-environment node
// [BLDD] lyDoDangBaoLuu — lý do KHÔNG điểm danh được vì bảo lưu. THUẦN, đồng hồ đóng băng (luật 19).
import { describe, it, expect } from "vitest";
import { lyDoDangBaoLuu, laDangBaoLuuTheoQuyChe } from "@/lib/bao-luu/roster";

const d = (s: string) => new Date(s);
const dongMo = { startedAt: d("2026-10-01T00:00:00+07:00"), endedAt: null, isActive: true, expectedEndAt: d("2026-11-30T00:00:00+07:00") };
const dongDaDong = { startedAt: d("2026-08-01T00:00:00+07:00"), endedAt: d("2026-09-01T00:00:00+07:00"), isActive: false, expectedEndAt: null };

describe("[BLDD] lyDoDangBaoLuu", () => {
  it("[BLDD-01] không hồ sơ nào ⇒ null (chấm được)", () => {
    expect(lyDoDangBaoLuu({ reserves: [] }, d("2026-10-10T00:00:00+07:00"))).toBeNull();
  });

  it("[BLDD-02] hồ sơ đang mở có ngày dự kiến ⇒ nêu ngày bắt đầu và ngày dự kiến quay lại", () => {
    expect(lyDoDangBaoLuu({ reserves: [dongMo] }, d("2026-10-10T00:00:00+07:00"))).toBe(
      "Đang bảo lưu từ 01/10/2026, dự kiến quay lại 30/11/2026",
    );
  });

  it("[BLDD-03] hồ sơ đang mở KHÔNG có ngày dự kiến ⇒ chỉ nêu ngày bắt đầu", () => {
    expect(lyDoDangBaoLuu({ reserves: [{ ...dongMo, expectedEndAt: null }] }, d("2026-10-10T00:00:00+07:00"))).toBe(
      "Đang bảo lưu từ 01/10/2026",
    );
  });

  it("[BLDD-04] buổi nằm trong khoảng của hồ sơ ĐÃ ĐÓNG ⇒ nêu cả ngày kết thúc; buổi trước khoảng và buổi từ ngày kết thúc ⇒ null", () => {
    const e = { reserves: [dongDaDong] };
    expect(lyDoDangBaoLuu(e, d("2026-08-15T00:00:00+07:00"))).toBe("Đang bảo lưu từ 01/08/2026 đến 01/09/2026");
    expect(lyDoDangBaoLuu(e, d("2026-07-31T00:00:00+07:00"))).toBeNull(); // trước khi bảo lưu
    expect(lyDoDangBaoLuu(e, d("2026-09-01T00:00:00+07:00"))).toBeNull(); // hiệu lực tới TRƯỚC endedAt
  });

  it("[BLDD-05] ngày hiển thị theo giờ VN: 00:30 sáng 01/10 ở VN (17:30Z ngày 30/09) vẫn là 01/10", () => {
    const r = { ...dongMo, startedAt: d("2026-09-30T17:30:00Z") };
    expect(lyDoDangBaoLuu({ reserves: [r] }, d("2026-10-10T00:00:00+07:00"))).toContain("từ 01/10/2026");
  });

  it("[BLDD-06] CÙNG định nghĩa với `laDangBaoLuuTheoQuyChe`: khớp ở mọi mốc, kể cả hai biên", () => {
    const e = { reserves: [dongDaDong, dongMo] };
    for (const ngay of ["2026-07-31", "2026-08-01", "2026-08-31", "2026-09-01", "2026-09-30", "2026-10-01", "2026-12-31"]) {
      const t = d(`${ngay}T00:00:00+07:00`);
      expect(lyDoDangBaoLuu(e, t) !== null, ngay).toBe(laDangBaoLuuTheoQuyChe(e, t));
    }
  });
});
