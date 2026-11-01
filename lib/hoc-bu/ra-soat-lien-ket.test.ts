// [RSL-*] — liên kết từ phát hiện của checker tới màn xử lý (THUẦN). Chỉ trả liên kết tới đường dẫn BIẾT CHẮC tồn tại.
import { describe, expect, it } from "vitest";
import { lienKetPhatHien } from "@/lib/hoc-bu/ra-soat-lien-ket";
import type { Finding } from "@/lib/hoc-bu/toan-ven";

const f = (p: Partial<Finding> & Pick<Finding, "luat" | "id" | "thucThe">): Finding => ({
  nghiemTrong: "MEDIUM",
  phanLoai: "NEEDS_MANUAL_REVIEW",
  lyDo: "x",
  deXuat: "y",
  ...p,
});

describe("[RSL] lienKetPhatHien", () => {
  it("[RSL-01] phát hiện trên CASE ⇒ liên kết mở đúng case", () => {
    expect(lienKetPhatHien(f({ luat: "TV-13", id: "case-1", thucThe: "MakeupCase" }))).toEqual([{ href: "/hoc-bu/case/case-1", nhan: "Mở case" }]);
  });

  it("[RSL-02] phát hiện có học viên (TV-51/TV-20) ⇒ liên kết hồ sơ học viên tới `/students/<id>/edit` (đường duy nhất tồn tại — `students/[id]` không có page)", () => {
    const l = lienKetPhatHien(f({ luat: "TV-51", id: "n1", thucThe: "MakeupNeed", lienQuan: { hocVien: "hv-1", khoa: "k-1" } }));
    expect(l).toEqual([{ href: "/students/hv-1/edit", nhan: "Hồ sơ học viên" }]);
    expect(l.every((x) => !/^\/students\/[^/]+$/.test(x.href))).toBe(true);
  });

  it("[RSL-03] case + học viên ⇒ cả hai liên kết; id có ký tự lạ bị mã hoá (không chen được đường dẫn)", () => {
    const l = lienKetPhatHien(f({ luat: "TV-43", id: "a/b?c", thucThe: "MakeupCase", lienQuan: { hocVien: "x y" } }));
    expect(l.map((x) => x.href)).toEqual(["/hoc-bu/case/a%2Fb%3Fc", "/students/x%20y/edit"]);
  });

  it("[RSL-04] dòng cần bù / điểm danh KHÔNG có học viên ⇒ về tab Cần bù (không đoán đường tới từng dòng)", () => {
    expect(lienKetPhatHien(f({ luat: "TV-03", id: "n1", thucThe: "MakeupNeed" }))).toEqual([{ href: "/hoc-bu?tab=can-bu", nhan: "Màn Học bù" }]);
    expect(lienKetPhatHien(f({ luat: "TV-21", id: "s|h", thucThe: "Attendance", lienQuan: { buoiGoc: "s" } }))).toEqual([{ href: "/hoc-bu?tab=can-bu", nhan: "Màn Học bù" }]);
  });

  it("[RSL-05] thực thể khác (sổ lượt…) ⇒ về màn Học bù; luôn có ÍT NHẤT một liên kết, mọi liên kết là đường nội bộ", () => {
    const ds = [
      f({ luat: "TV-32", id: "tk-1", thucThe: "MakeupCreditAccount" as Finding["thucThe"] }),
      f({ luat: "TV-93", id: "gv|2026-10", thucThe: "AttendancePeriod" as Finding["thucThe"] }),
    ];
    for (const d of ds) {
      const l = lienKetPhatHien(d);
      expect(l.length).toBeGreaterThan(0);
      for (const k of l) expect(k.href.startsWith("/")).toBe(true);
    }
  });
});
