// [TBT-*] — MA TRẬN THÔNG BÁO HỌC BÙ, phần THUẦN (T13). Đường chạy thật qua outbox + Postgres: tests/hoc-bu/thong-bao.test.ts.
import { describe, expect, it } from "vitest";
import {
  daQuaHan,
  gioCase,
  gvKhongConCaBu,
  khoaSuKien,
  lietKeThayDoi,
  NHAC_TRUOC_DEN_GIO,
  NHAC_TRUOC_TU_GIO,
  QUA_HAN_SAU_PHUT,
  SU_KIEN,
  tinGiaoVienDaXep,
  tinGiaoVienDoiLich,
  tinGiaoVienDoiNguoi,
  tinGiaoVienHuy,
  tinGiaoVienNhac,
  tinPhuHuynhDaXep,
  tinPhuHuynhDoiLich,
  tinPhuHuynhHuy,
  tinPhuHuynhKetQua,
  tinPhuHuynhNhac,
  tinQuaHan,
  tinQuanLyGvKhongConCa,
  tinSaleBeVang,
  tinSaleCanThuPhi,
  trongCuaSoNhac,
  type NguCanhCase,
  type TinNhan,
} from "./thong-bao-thuan";

const NC: NguCanhCase = { tenBe: "Bé An", ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", tenGv: "Cô Lan", tenPhong: "P1", tenBai: ["Bài 5", "Bài 6"] };

describe("[TBT] ma trận thông báo học bù", () => {
  it("[TBT-01] chín sự kiện, tên khác nhau, đúng chuỗi đã chốt", () => {
    expect(Object.values(SU_KIEN).sort()).toEqual(
      [
        "makeup.absent", "makeup.case.cancelled", "makeup.case.changed", "makeup.case.reminder", "makeup.case.scheduled",
        "makeup.completed", "makeup.overdue", "makeup.payment-required", "makeup.teacher-unavailable",
      ].sort(),
    );
  });

  it("[TBT-02] khoá chống trùng gắn với MỘT sự việc: cùng sự việc ⇒ cùng khoá; sự việc mới (mục mới, phiên bản mới, ngày mới) ⇒ khoá mới", () => {
    expect(khoaSuKien.caseDaXep("p1", "m1")).toBe(khoaSuKien.caseDaXep("p1", "m1"));
    expect(khoaSuKien.caseDaXep("p1", "m1")).not.toBe(khoaSuKien.caseDaXep("p1", "m2"));
    expect(khoaSuKien.caseDoi("c1", 1)).not.toBe(khoaSuKien.caseDoi("c1", 2));
    expect(khoaSuKien.hoanThanh("p1", 1)).not.toBe(khoaSuKien.hoanThanh("p1", 2)); // sửa điểm danh = sự việc mới
    expect(khoaSuKien.caseNhac("c1", "2026-10-15")).not.toBe(khoaSuKien.caseNhac("c1", "2026-10-16")); // dời sang ngày khác được nhắc lại
    expect(khoaSuKien.caseHuyGv("c1")).not.toBe(khoaSuKien.caseHuyBe("p1", 1));
    expect(khoaSuKien.gvKhongConCa("c1", "gv1", "2026-10-15")).not.toBe(khoaSuKien.gvKhongConCa("c1", "gv2", "2026-10-15"));
    // Mỗi khoá bắt đầu bằng tên sự kiện — nên catalog (khớp theo tiền tố) luôn phân loại được.
    for (const k of [
      khoaSuKien.caseDaXep("p", "m"), khoaSuKien.caseDoi("c", 1), khoaSuKien.caseHuyBe("p", 1), khoaSuKien.caseHuyGv("c"), khoaSuKien.caseNhac("c", "d"),
      khoaSuKien.hoanThanh("p", 1), khoaSuKien.beVang("p", 1), khoaSuKien.canThuPhi("n"), khoaSuKien.gvKhongConCa("c", "g", "d"), khoaSuKien.quaHan("c"),
    ]) {
      expect(Object.values(SU_KIEN).some((s) => k.startsWith(`${s}:`)), k).toBe(true);
    }
  });

  it("[TBT-03] tin phụ huynh: tên bé, bài, giờ, ngày, giáo viên, phòng — không số điện thoại / email", () => {
    const tin = [tinPhuHuynhDaXep(NC), tinPhuHuynhNhac(NC), tinPhuHuynhDoiLich(NC, ["đổi phòng"]), tinPhuHuynhHuy(NC)];
    expect(tin[0]!.noiDung).toBe("Bé An được xếp học bù Bài 5, Bài 6 lúc 18:00–19:30 ngày 15/10/2026 với giáo viên Cô Lan, phòng P1.");
    expect(tin[2]!.noiDung).toContain("(đổi phòng)");
    expect(tin[3]!.noiDung).toContain("đã được huỷ");
    for (const t of tin) {
      expect(t.noiDung).not.toMatch(/@|[0-9]{9,}/);
      expect(t.tieuDe.length).toBeGreaterThan(0);
    }
  });

  it("[TBT-04] kết quả buổi bù kèm đánh giá từng bài; sửa điểm danh đổi tiêu đề; nhận xét chung chỉ hiện khi có", () => {
    const ketQua = [
      { tenBai: "Bài 5", ketQua: "COMPLETED" as const, danhGia: "Làm tốt" },
      { tenBai: "Bài 6", ketQua: "NOT_COMPLETED" as const, danhGia: null },
    ];
    const t = tinPhuHuynhKetQua({ tenBe: "Bé An", ymd: "2026-10-15", ketQua, nhanXetChung: "Con tập trung", sua: false });
    expect(t.tieuDe).toBe("Kết quả buổi học bù");
    expect(t.noiDung).toContain("• Bài 5: đã học xong — Làm tốt");
    expect(t.noiDung).toContain("• Bài 6: chưa hoàn thành, sẽ xếp bù lại");
    expect(t.noiDung).toContain("Nhận xét chung: Con tập trung");
    const sua = tinPhuHuynhKetQua({ tenBe: "Bé An", ymd: "2026-10-15", ketQua, nhanXetChung: null, sua: true });
    expect(sua.tieuDe).toBe("Kết quả buổi học bù đã được cập nhật");
    expect(sua.noiDung).not.toContain("Nhận xét chung");
  });

  it("[TBT-05] tin nhân sự nói đúng việc của từng người", () => {
    const gv = { ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", tenPhong: "P1", tenBai: ["Bài 5"] };
    expect(tinGiaoVienDaXep({ ...gv, soBe: 3 }).noiDung).toContain("cho 3 học viên");
    expect(tinGiaoVienNhac({ ...gv, soBe: 2 }).noiDung).toContain("cho 2 học viên");
    expect(tinGiaoVienDoiLich(gv, ["ngày 15/10/2026 → 16/10/2026"]).noiDung).toContain("(ngày 15/10/2026 → 16/10/2026)");
    expect(tinGiaoVienDoiNguoi(gv).noiDung).toContain("không cần dạy buổi này nữa");
    expect(tinGiaoVienHuy(gv).tieuDe).toBe("Buổi dạy bù đã huỷ");
    expect(tinSaleBeVang({ tenBe: "Bé An", ymd: "2026-10-15" }).noiDung).toContain("Lượt bù không bị tiêu");
    expect(tinSaleCanThuPhi({ tenBe: "Bé An", tenBai: "Bài 5" }).noiDung).toContain("hết lượt học bù (buổi vắng: Bài 5)");
    expect(tinSaleCanThuPhi({ tenBe: "Bé An", tenBai: null }).noiDung).not.toContain("buổi vắng");
    expect(tinQuanLyGvKhongConCa({ tenGv: "Cô Lan", ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", soBe: 2 }).noiDung).toContain("Cô Lan không còn ca làm phủ");
    expect(tinQuaHan({ ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", soBeChoDiemDanh: 2 }).noiDung).toContain("còn 2 học viên chưa được điểm danh");
  });

  it("[TBT-06] liệt kê thay đổi: chỉ ngày / giờ / giáo viên / phòng; ghi chú không phải thay đổi", () => {
    const a = { ymd: "2026-10-15", startTime: "18:00", endTime: "19:30", teacherId: "g1", roomId: "r1" };
    expect(lietKeThayDoi(a, a)).toEqual([]);
    expect(lietKeThayDoi(a, { ...a, ymd: "2026-10-16" })).toEqual(["ngày 15/10/2026 → 16/10/2026"]);
    expect(lietKeThayDoi(a, { ...a, startTime: "17:00" })).toEqual(["giờ 18:00–19:30 → 17:00–19:30"]);
    expect(lietKeThayDoi(a, { ...a, teacherId: "g2", roomId: null })).toEqual(["đổi giáo viên", "đổi phòng"]);
  });

  it("[TBT-07] cửa sổ nhắc [23h, 25h) trước giờ bắt đầu: biên dưới LẤY, biên trên LOẠI", () => {
    const { batDau } = gioCase({ ymd: "2026-10-15", startTime: "18:00", endTime: "19:30" });
    const truoc = (gio: number) => new Date(batDau.getTime() - gio * 3_600_000);
    expect([NHAC_TRUOC_TU_GIO, NHAC_TRUOC_DEN_GIO]).toEqual([23, 25]);
    expect(trongCuaSoNhac(truoc(23), batDau)).toBe(true);
    expect(trongCuaSoNhac(truoc(24), batDau)).toBe(true);
    expect(trongCuaSoNhac(truoc(25), batDau)).toBe(false);
    expect(trongCuaSoNhac(truoc(22.99), batDau)).toBe(false);
    // Cron mỗi giờ: các giờ nguyên trong 48 giờ trước đều trúng ĐÚNG hai mốc (23h và 24h) — dedupe lo phần trùng.
    const trung = Array.from({ length: 48 }, (_, i) => truoc(i)).filter((n) => trongCuaSoNhac(n, batDau));
    expect(trung.length).toBe(2);
  });

  it("[TBT-08] quá hạn: đúng 120 phút sau giờ kết thúc là quá hạn, 119 phút thì chưa", () => {
    const { ketThuc } = gioCase({ ymd: "2026-10-15", startTime: "18:00", endTime: "19:30" });
    expect(QUA_HAN_SAU_PHUT).toBe(120);
    expect(daQuaHan(new Date(ketThuc.getTime() + 119 * 60_000), ketThuc)).toBe(false);
    expect(daQuaHan(new Date(ketThuc.getTime() + 120 * 60_000), ketThuc)).toBe(true);
    expect(daQuaHan(ketThuc, ketThuc)).toBe(false);
  });

  it("[TBT-09] giáo viên không còn ca: chỉ khi lưới NÓI RÕ; thiếu dữ liệu ≠ vắng", () => {
    const co = (ketQuaPhu: Parameters<typeof gvKhongConCaBu>[0]["ketQuaPhu"], caCenterId: string | null | undefined = "cs1") =>
      gvKhongConCaBu({ ketQuaPhu, caCenterId, centerId: "cs1" });
    expect(co("NGHI")).toBe(true);
    expect(co("KHONG_PHU")).toBe(true);
    expect(co("KHONG_GIO")).toBe(true);
    expect(co("PHU_TRON")).toBe(false);
    expect(co("PHU_TRON", "cs2")).toBe(true); // hôm đó làm ở cơ sở khác
    expect(co("PHU_TRON", null)).toBe(false); // ca không gắn cơ sở: không loại
    for (const thieu of ["KHONG_CO_CA", "CHUA_VAO_LUOI", "CHUA_CO_LUOI"] as const) expect(co(thieu), thieu).toBe(false);
  });

  it("[TBT-10] mọi composer trả tiêu đề + nội dung không rỗng (không thể gửi tin trống)", () => {
    const g = { ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", tenPhong: null, tenBai: [] as string[] };
    const tat: TinNhan[] = [
      tinPhuHuynhDaXep({ ...NC, tenBai: [], tenGv: null, tenPhong: null }),
      tinGiaoVienDaXep({ ...g, soBe: 1 }),
      tinGiaoVienNhac({ ...g, soBe: 1 }),
      tinGiaoVienHuy(g),
      tinQuaHan({ ymd: "2026-10-15", gioBatDau: "18:00", gioKetThuc: "19:30", soBeChoDiemDanh: 1 }),
    ];
    for (const t of tat) {
      expect(t.tieuDe.trim().length).toBeGreaterThan(0);
      expect(t.noiDung.trim().length).toBeGreaterThan(0);
      expect(t.noiDung).not.toContain("undefined");
      expect(t.noiDung).not.toContain("null");
    }
  });
});
