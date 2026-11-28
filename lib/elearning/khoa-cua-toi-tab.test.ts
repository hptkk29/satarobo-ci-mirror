/**
 * [KCT-*] "Khoá của tôi" chia 3 tab theo URL. Lưới chính: ba tab CHIA ĐÔI tập khoá, và khớp với KPI của Tổng quan.
 * Đồng hồ đóng băng (luật 19).
 */
import { describe, expect, it } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { napDanhSachKhoaCuaToi } from "./course-view";
import { tinhKpi } from "./dashboard-pure";
import {
  BIET_DANH_TT,
  MA_TAB_KHOA,
  docSapXepTab,
  locSapXepTheoTab,
  moTaPhuKhoa,
  tabCuaKhoa,
  type KhoaDong,
} from "./khoa-cua-toi-tab";
import { LOC_TRANG_THAI } from "./dashboard-pure";

const NOW = new Date("2026-10-25T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function khoa(id: string, status: string, dueAt: Date | null, extra: Partial<KhoaDong> = {}): KhoaDong {
  return {
    enrollmentId: id,
    tenKhoa: `Khoá ${id}`,
    status,
    dueAt,
    progressPercent: 0,
    createdAt: ngay(-10),
    completedAt: null,
    soBai: 4,
    coKiemTra: false,
    tienDoBai: { xong: 0, tong: 4 },
    ...extra,
  };
}

const MAU: KhoaDong[] = [
  khoa("a", "NOT_STARTED", ngay(20)),
  khoa("b", "IN_PROGRESS", ngay(3)),
  khoa("c", "OVERDUE", ngay(-2)),
  khoa("d", "IN_PROGRESS", ngay(-1)), // hạn đã qua mà cron chưa chuyển OVERDUE
  khoa("e", "COMPLETED", ngay(-30)),
  khoa("f", "COMPLETED_LATE", ngay(-5)),
  khoa("g", "NOT_STARTED", null),
];

describe("[KCT-01] ba tab chia đôi tập khoá", () => {
  it("mỗi khoá thuộc ĐÚNG một tab, tổng ba tab = tổng khoá", () => {
    const dem: Record<string, number> = { "can-lam": 0, "qua-han": 0, "da-xong": 0 };
    for (const k of MAU) dem[tabCuaKhoa(k, NOW)] += 1;
    expect(dem).toEqual({ "can-lam": 3, "qua-han": 2, "da-xong": 2 });
    expect(dem["can-lam"] + dem["qua-han"] + dem["da-xong"]).toBe(MAU.length);
  });

  it("KHỚP KPI Tổng quan: số 'quá hạn' và 'hoàn thành' của tab = của tinhKpi", () => {
    const kpi = tinhKpi(MAU, NOW);
    const r = locSapXepTheoTab(MAU, { tab: "can-lam", q: "", sapXep: "han", trang: 1 }, NOW);
    expect(r.dem["qua-han"]).toBe(kpi.quaHan);
    expect(r.dem["da-xong"]).toBe(kpi.hoanThanh);
  });

  it("hạn đã qua mà cron chưa chuyển OVERDUE vẫn vào tab quá hạn (đọc ngày, không đọc cờ)", () => {
    expect(tabCuaKhoa(khoa("d", "IN_PROGRESS", ngay(-1)), NOW)).toBe("qua-han");
  });
});

describe("[KCT-02] liên kết cũ ?tt= ánh xạ đủ sáu giá trị về tab hợp lệ", () => {
  it("mọi giá trị của LOC_TRANG_THAI đều có biệt danh trỏ vào tab có thật", () => {
    for (const l of LOC_TRANG_THAI) {
      expect(BIET_DANH_TT[l.ma], l.ma).toBeDefined();
      expect(MA_TAB_KHOA).toContain(BIET_DANH_TT[l.ma]);
    }
  });
  it("quá hạn → quá hạn; hoàn thành → đã xong; tất cả → mặc định", () => {
    expect(BIET_DANH_TT["qua-han"]).toBe("qua-han");
    expect(BIET_DANH_TT["hoan-thanh"]).toBe("da-xong");
    expect(BIET_DANH_TT["tat-ca"]).toBe("can-lam");
  });
});

describe("[KCT-03] tìm + đếm theo ô tìm", () => {
  it("khoá khớp nằm ở tab khác ⇒ tab đang mở trống nhưng số đếm tab kia cho thấy nó", () => {
    const r = locSapXepTheoTab(MAU, { tab: "can-lam", q: "khoa e", sapXep: "han", trang: 1 }, NOW);
    expect(r.tong).toBe(0);
    expect(r.dem["da-xong"]).toBe(1); // đối chứng dương: khoá có thật, chỉ nằm ở tab khác
  });
  it("bỏ dấu: 'KHOA' khớp 'Khoá'", () => {
    const r = locSapXepTheoTab(MAU, { tab: "qua-han", q: "KHOA c", sapXep: "han", trang: 1 }, NOW);
    expect(r.dong.map((k) => k.enrollmentId)).toEqual(["c"]);
  });
});

describe("[KCT-04] sắp xếp + phân trang", () => {
  it("hạn gần nhất trước, khoá không hạn cuối", () => {
    const r = locSapXepTheoTab(MAU, { tab: "can-lam", q: "", sapXep: "han", trang: 1 }, NOW);
    expect(r.dong.map((k) => k.enrollmentId)).toEqual(["b", "a", "g"]);
  });
  it("mới giao nhất", () => {
    const m = [khoa("x", "NOT_STARTED", ngay(5), { createdAt: ngay(-1) }), khoa("y", "NOT_STARTED", ngay(5), { createdAt: ngay(-9) })];
    const r = locSapXepTheoTab(m, { tab: "can-lam", q: "", sapXep: "moi-giao", trang: 1 }, NOW);
    expect(r.dong.map((k) => k.enrollmentId)).toEqual(["x", "y"]);
  });
  it("trang vượt biên bị kẹp về trang cuối; sx lạ rơi về 'han'", () => {
    const nhieu = Array.from({ length: 30 }, (_, i) => khoa(`k${i}`, "NOT_STARTED", ngay(i + 1)));
    const r = locSapXepTheoTab(nhieu, { tab: "can-lam", q: "", sapXep: "han", trang: 99 }, NOW);
    expect(r.trang).toBe(3);
    expect(r.dong).toHaveLength(6);
    expect(docSapXepTab("bậy")).toBe("han");
  });
});

describe("[KCT-05] dòng phụ", () => {
  it("'4 bài · có bài kiểm tra'; chưa đếm được thì không bịa số", () => {
    expect(moTaPhuKhoa({ soBai: 4, coKiemTra: true })).toBe("4 bài · có bài kiểm tra");
    expect(moTaPhuKhoa({ soBai: null, coKiemTra: false })).toBeNull();
  });
});

describe("[KCT-06] napDanhSachKhoaCuaToi — số truy vấn cố định", () => {
  function dbGia(soKhoa: number) {
    let goi = 0;
    const dong = Array.from({ length: soKhoa }, (_, i) => ({
      id: `e${i}`,
      courseId: `c${i}`,
      status: "NOT_STARTED",
      dueAt: ngay(i + 1),
      progressPercent: 0,
      createdAt: ngay(-1),
      completedAt: null,
    }));
    const dem = <T,>(kq: T) => async () => {
      goi += 1;
      return kq;
    };
    const db = {
      trnEnrollment: { findMany: dem(dong) },
      trnCourse: { findMany: dem(dong.map((d) => ({ id: d.courseId, title: `K ${d.courseId}` }))) },
      // B-11b — bản đang phát hành mỗi khoá (không có bản ⇒ đọc cây sống).
      trnCourseVersion: { findMany: dem([]) },
      // Bài DONE của người này — cùng định nghĩa n/m với Tổng quan (`tien-do-bat-buoc.ts`).
      trnLessonProgress: { findMany: dem([{ enrollmentId: "e0", lessonId: "c0-a" }]) },
      trnLesson: {
        findMany: dem(
          dong.flatMap((d) => [
            { id: `${d.courseId}-a`, title: "A", kind: "READ", orderIndex: 0, module: { courseId: d.courseId, orderIndex: 0 } },
            { id: `${d.courseId}-q`, title: "Q", kind: "QUIZ", orderIndex: 1, module: { courseId: d.courseId, orderIndex: 0 } },
          ]),
        ),
      },
    } as unknown as ScopedDb;
    return { db, so: () => goi };
  }
  it("1 khoá và 100 khoá cùng số lời gọi (5)", async () => {
    const a = dbGia(1);
    const b = dbGia(100);
    await napDanhSachKhoaCuaToi(a.db, "u");
    await napDanhSachKhoaCuaToi(b.db, "u");
    expect(a.so()).toBe(5);
    expect(b.so()).toBe(a.so());
  });
  it("gộp đúng số bài và cờ kiểm tra theo khoá", async () => {
    const { db } = dbGia(2);
    const r = await napDanhSachKhoaCuaToi(db, "u");
    expect(r[0]).toMatchObject({ soBai: 2, coKiemTra: true, tienDoBai: { xong: 1, tong: 2 } });
    // Khoá chưa có bài nào xong ⇒ 0/2, không bịa.
    expect(r[1]?.tienDoBai).toEqual({ xong: 0, tong: 2 });
  });
  it("không khoá nào ⇒ trả rỗng, KHÔNG truy vấn đếm bài", async () => {
    const { db, so } = dbGia(0);
    expect(await napDanhSachKhoaCuaToi(db, "u")).toEqual([]);
    expect(so()).toBe(1);
  });
});
