// [BGV] 07/10/2026 — thông báo cho giáo viên của case dạy bù.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { moTaGioCaBu, thongBaoCaBu, type ThongTinCaBu } from "./bao-gv";
import { teacherHref } from "@/lib/teacher/notification-href";
import { classifyNotification } from "@/lib/notifications/catalog";

// 08/10/2026 là THỨ NĂM (01/01/2026 thứ Năm, cách 280 ngày = 40 tuần).
const CA: ThongTinCaBu = {
  caseId: "case1",
  teacherId: "gv1",
  date: new Date(Date.UTC(2026, 9, 8)),
  startTime: "18:00",
  endTime: "19:30",
  tenKhoa: "Sata 3",
  tenPhong: "CS2-301",
  soHocVien: 2,
};

describe("[BGV] nội dung thông báo ca dạy bù", () => {
  it("[BGV-01] ngày đọc theo UTC (cột @db.Date) và đúng thứ trong tuần", () => {
    expect(moTaGioCaBu(CA)).toBe("T5 08/10/2026 18:00–19:30");
  });

  it("[BGV-02] ca mới: báo đúng GV, có giờ · khoá · phòng · số học viên, link chi tiết ca", () => {
    const tb = thongBaoCaBu("ca-moi", CA, "quan-ly", 1);
    expect(tb).toEqual({
      userIds: ["gv1"],
      entityId: "case1",
      dedupeKey: "hoc-bu.ca-moi:case1",
      title: "Bạn có ca dạy bù mới",
      body: "T5 08/10/2026 18:00–19:30 · Sata 3 · phòng CS2-301 · 2 học viên.",
      href: "/hoc-bu/case/case1",
    });
  });

  it("[BGV-03] KHÔNG báo khi người bấm chính là giáo viên của ca — cả ba loại", () => {
    for (const loai of ["ca-moi", "them-hv", "huy"] as const) {
      expect(thongBaoCaBu(loai, CA, "gv1", 1)).toBeNull();
    }
  });

  it("[BGV-04] xếp thêm học viên: khoá mang MỐC — hai lượt xếp thêm là hai thông báo", () => {
    const a = thongBaoCaBu("them-hv", CA, "sale", 1000)!;
    const b = thongBaoCaBu("them-hv", CA, "sale", 2000)!;
    expect(a.dedupeKey).toBe("hoc-bu.them-hv:case1:1000");
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
    expect(a.body).toContain("nay có 2 học viên");
  });

  it("[BGV-05] huỷ: khoá theo ca, link về DANH SÁCH (chi tiết ca đã huỷ không còn việc gì)", () => {
    const tb = thongBaoCaBu("huy", CA, "quan-ly", 1)!;
    expect(tb.dedupeKey).toBe("hoc-bu.huy:case1");
    expect(tb.href).toBe("/hoc-bu");
    expect(tb.body).toContain("Không cần lên lớp");
  });

  it("[BGV-06] thiếu khoá/phòng ⇒ bỏ đoạn đó, không in 'null'", () => {
    const tb = thongBaoCaBu("ca-moi", { ...CA, tenKhoa: null, tenPhong: null }, "x", 1)!;
    expect(tb.body).toBe("T5 08/10/2026 18:00–19:30 · 2 học viên.");
  });
});

describe("[BGV-L] link trên site giáo viên", () => {
  it("[BGV-L1] chi tiết ca admin ⇒ chi tiết ca trên site GV (route động có thật)", () => {
    expect(teacherHref("/hoc-bu/case/case1")).toBe("/teacher/hoc-bu/case1");
  });
  it("[BGV-L2] danh sách ⇒ danh sách ca bù của GV", () => {
    expect(teacherHref("/hoc-bu")).toBe("/teacher/hoc-bu");
  });
  it("[BGV-L3] cả ba href mà thông báo phát ra đều dẫn tới một màn của site GV", () => {
    for (const loai of ["ca-moi", "them-hv", "huy"] as const) {
      const tb = thongBaoCaBu(loai, CA, "x", 1)!;
      expect(teacherHref(tb.href), loai).not.toBeNull();
      expect(classifyNotification(tb.dedupeKey).known, loai).toBe(true);
    }
  });
});

// ── [BGV-W] LƯỚI GHIM DÂY NỐI ──────────────────────────────────────────────────────────
// Test thuần ở trên không biết hàm ghi có GỌI nó không. Mã TRƯỚC bản vá: ba hàm dưới không
// gọi gì sau `$transaction` ⇒ giáo viên không bao giờ nhận tin. Neo vào LỜI GỌI đúng loại,
// đúng một lần trong thân hàm, và đứng SAU `$transaction(` (gửi trước commit là báo một ca
// có thể bị rollback).
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

function thanHam(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}(`);
  if (dau < 0) throw new Error(`không thấy hàm ${ten}`);
  const sau = src.indexOf("\nexport ", dau + 10);
  return src.slice(dau, sau < 0 ? undefined : sau);
}

describe("[BGV-W] ba hàm ghi của case dạy bù đều báo giáo viên sau commit", () => {
  const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/hoc-bu/case-db.ts"), "utf8"));
  it.each([
    ["taoCaseVaXep", "ca-moi"],
    ["xepVaoCaseCoSan", "them-hv"],
    ["huyCase", "huy"],
  ])("[BGV-W] %s gọi baoGvCaBu(\"%s\") đúng 1 lần, sau $transaction", (ten, loai) => {
    const than = thanHam(src, ten);
    const goi = [...than.matchAll(new RegExp(`baoGvCaBu\\("${loai}"`, "g"))];
    expect(goi.length).toBe(1);
    const tx = than.lastIndexOf("$transaction(");
    expect(tx).toBeGreaterThan(-1);
    expect(than.indexOf(`baoGvCaBu("${loai}"`)).toBeGreaterThan(tx);
  });
});
