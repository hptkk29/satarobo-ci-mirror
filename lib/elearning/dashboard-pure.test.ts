import { describe, it, expect } from "vitest";
import {
  chonTiepTuc,
  chuanHoaTim,
  dongHan,
  locSapXepKhoa,
  nhomHan,
  nhomViecCanLam,
  tinhKpi,
  trangThaiHienThi,
  type KhoaRut,
} from "./dashboard-pure";

// Đồng hồ ĐÓNG BĂNG (luật 19): ngày tuyệt đối + `now` truyền vào, không bao giờ `new Date()`.
const NOW = new Date("2026-10-25T03:00:00.000Z");
const ngay = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let seq = 0;
const k = (p: Partial<KhoaRut> & { tenKhoa: string }): KhoaRut => ({
  enrollmentId: `e${++seq}`,
  status: "NOT_STARTED",
  dueAt: null,
  progressPercent: 0,
  ...p,
});

describe("[DB-01] nhomHan", () => {
  it("xong thì không có hạn", () => {
    expect(nhomHan({ status: "COMPLETED", dueAt: ngay(-3) }, NOW)).toBe("XONG");
    expect(nhomHan({ status: "COMPLETED_LATE", dueAt: ngay(-3) }, NOW)).toBe("XONG");
  });
  it("OVERDUE do server đặt ⇒ quá hạn, kể cả khi hạn còn ghi tương lai (gia hạn chưa đồng bộ)", () => {
    expect(nhomHan({ status: "OVERDUE", dueAt: ngay(2) }, NOW)).toBe("QUA_HAN");
  });
  it("hạn đã qua mà cron chưa chuyển OVERDUE ⇒ vẫn quá hạn", () => {
    expect(nhomHan({ status: "IN_PROGRESS", dueAt: ngay(-1) }, NOW)).toBe("QUA_HAN");
  });
  it("biên 7 ngày: đúng 7 ngày là sắp hạn, 7 ngày + 1 giây là còn hạn", () => {
    expect(nhomHan({ status: "IN_PROGRESS", dueAt: ngay(7) }, NOW)).toBe("SAP_HAN");
    expect(nhomHan({ status: "IN_PROGRESS", dueAt: new Date(ngay(7).getTime() + 1000) }, NOW)).toBe("CON_HAN");
  });
  it("không hạn", () => {
    expect(nhomHan({ status: "NOT_STARTED", dueAt: null }, NOW)).toBe("KHONG_HAN");
  });
});

describe("[DB-02] tinhKpi — số thật từ danh sách, không số nào bịa", () => {
  const ds = [
    k({ tenKhoa: "A", status: "IN_PROGRESS", dueAt: ngay(3), progressPercent: 40 }), // sắp hạn
    k({ tenKhoa: "B", status: "IN_PROGRESS", dueAt: ngay(30), progressPercent: 10 }),
    k({ tenKhoa: "C", status: "NOT_STARTED", dueAt: ngay(-2) }), // quá hạn (cron lag)
    k({ tenKhoa: "D", status: "OVERDUE", dueAt: ngay(-9), progressPercent: 5 }),
    k({ tenKhoa: "E", status: "COMPLETED", dueAt: ngay(-5), progressPercent: 100 }),
    k({ tenKhoa: "F", status: "COMPLETED_LATE", dueAt: ngay(-20), progressPercent: 100 }),
    k({ tenKhoa: "G", status: "NOT_STARTED" }),
  ];
  it("đếm đúng từng ô", () => {
    expect(tinhKpi(ds, NOW)).toEqual({
      tong: 7,
      dangHoc: 2,
      chuaBatDau: 2,
      hoanThanh: 2,
      sapHan: 1,
      quaHan: 2,
    });
  });
  it("danh sách rỗng ⇒ toàn số 0 (không NaN)", () => {
    expect(tinhKpi([], NOW)).toEqual({ tong: 0, dangHoc: 0, chuaBatDau: 0, hoanThanh: 0, sapHan: 0, quaHan: 0 });
  });
});

describe("[DB-03] trạng thái hiển thị — luôn có chữ, không chỉ màu", () => {
  it("nhãn và sắc theo bảng", () => {
    expect(trangThaiHienThi({ status: "IN_PROGRESS", dueAt: ngay(20) }, NOW)).toEqual({ nhan: "Đang học", sac: "success" });
    expect(trangThaiHienThi({ status: "COMPLETED", dueAt: null }, NOW)).toEqual({ nhan: "Đã hoàn thành", sac: "info" });
    expect(trangThaiHienThi({ status: "NOT_STARTED", dueAt: null }, NOW)).toEqual({ nhan: "Chưa bắt đầu", sac: "muted" });
  });
  it("hạn đã qua ⇒ 'Quá hạn' cho khớp dòng hạn", () => {
    expect(trangThaiHienThi({ status: "IN_PROGRESS", dueAt: ngay(-1) }, NOW)).toEqual({ nhan: "Quá hạn", sac: "danger" });
  });
  it("trạng thái lạ in nguyên mã, không đoán", () => {
    expect(trangThaiHienThi({ status: "REVOKED", dueAt: null }, NOW).nhan).toBe("REVOKED");
  });
  it("dòng hạn: sắp hạn, quá hạn, chưa đặt hạn, xong", () => {
    expect(dongHan({ status: "IN_PROGRESS", dueAt: ngay(3) }, NOW)).toEqual({ chu: "Hạn 28/10/2026 · còn 3 ngày", sac: "warning" });
    expect(dongHan({ status: "OVERDUE", dueAt: ngay(-2) }, NOW)?.chu).toBe("Hạn 23/10/2026 · quá 2 ngày");
    expect(dongHan({ status: "NOT_STARTED", dueAt: null }, NOW)).toEqual({ chu: "Chưa đặt hạn", sac: "muted" });
    expect(dongHan({ status: "COMPLETED", dueAt: ngay(3) }, NOW)).toBeNull();
  });
});

describe("[DB-04] chonTiepTuc", () => {
  it("khoá đã có tiến độ thắng khoá chưa bắt đầu dù hạn xa hơn", () => {
    const a = k({ tenKhoa: "A", status: "NOT_STARTED", dueAt: ngay(1) });
    const b = k({ tenKhoa: "B", status: "IN_PROGRESS", dueAt: ngay(9), progressPercent: 30 });
    expect(chonTiepTuc([a, b])?.tenKhoa).toBe("B");
  });
  it("không có khoá đang dở ⇒ lấy khoá chưa xong đầu danh sách", () => {
    const a = k({ tenKhoa: "A", status: "NOT_STARTED", dueAt: ngay(1) });
    expect(chonTiepTuc([k({ tenKhoa: "X", status: "COMPLETED" }), a])?.tenKhoa).toBe("A");
  });
  it("toàn khoá đã xong hoặc rỗng ⇒ null", () => {
    expect(chonTiepTuc([k({ tenKhoa: "X", status: "COMPLETED" })])).toBeNull();
    expect(chonTiepTuc([])).toBeNull();
  });
});

describe("[DB-05] nhomViecCanLam", () => {
  it("gom theo độ gấp, bỏ khoá đã xong, bỏ nhóm rỗng, mỗi nhóm hạn gần lên trước", () => {
    const nhom = nhomViecCanLam(
      [
        k({ tenKhoa: "xong", status: "COMPLETED", dueAt: ngay(-1) }),
        k({ tenKhoa: "sau-xa", status: "IN_PROGRESS", dueAt: ngay(40) }),
        k({ tenKhoa: "sap-2", status: "IN_PROGRESS", dueAt: ngay(5) }),
        k({ tenKhoa: "sap-1", status: "IN_PROGRESS", dueAt: ngay(2) }),
        k({ tenKhoa: "qua", status: "OVERDUE", dueAt: ngay(-4) }),
        k({ tenKhoa: "khong-han", status: "NOT_STARTED" }),
      ],
      NOW,
    );
    expect(nhom.map((g) => g.ma)).toEqual(["QUA_HAN", "SAP_HAN", "SAU_DO"]);
    expect(nhom[0]!.muc.map((x) => x.tenKhoa)).toEqual(["qua"]);
    expect(nhom[1]!.muc.map((x) => x.tenKhoa)).toEqual(["sap-1", "sap-2"]);
    expect(nhom[2]!.muc.map((x) => x.tenKhoa)).toEqual(["sau-xa", "khong-han"]);
  });
  it("không còn việc ⇒ mảng rỗng", () => {
    expect(nhomViecCanLam([k({ tenKhoa: "x", status: "COMPLETED" })], NOW)).toEqual([]);
  });
});

describe("[DB-06] locSapXepKhoa", () => {
  const ds = [
    k({ tenKhoa: "Quy trình an toàn", status: "IN_PROGRESS", dueAt: ngay(3), progressPercent: 50 }),
    k({ tenKhoa: "Đạo đức nghề nghiệp", status: "NOT_STARTED", dueAt: ngay(20) }),
    k({ tenKhoa: "Bảo mật dữ liệu", status: "OVERDUE", dueAt: ngay(-5), progressPercent: 10 }),
    k({ tenKhoa: "Giới thiệu công ty", status: "COMPLETED", dueAt: ngay(-30), progressPercent: 100 }),
  ];
  const go = (o: Partial<Parameters<typeof locSapXepKhoa>[1]> = {}) =>
    locSapXepKhoa(ds, { loc: "tat-ca", q: "", sapXep: "han", trang: 1, ...o }, NOW);

  it("mặc định: chưa xong trước, hạn gần nhất trước; đã xong cuối", () => {
    expect(go().dong.map((x) => x.tenKhoa)).toEqual([
      "Bảo mật dữ liệu",
      "Quy trình an toàn",
      "Đạo đức nghề nghiệp",
      "Giới thiệu công ty",
    ]);
  });
  it("lọc trạng thái + đếm theo từng chip trên toàn danh sách", () => {
    const r = go({ loc: "qua-han" });
    expect(r.dong.map((x) => x.tenKhoa)).toEqual(["Bảo mật dữ liệu"]);
    expect(r.dem).toEqual({
      "tat-ca": 4,
      "dang-hoc": 1,
      "chua-bat-dau": 1,
      "sap-han": 1,
      "qua-han": 1,
      "hoan-thanh": 1,
    });
  });
  it("tìm bỏ dấu, không phân biệt hoa thường, và số chip không đổi theo ô tìm", () => {
    const r = go({ q: "dao duc" });
    expect(r.dong.map((x) => x.tenKhoa)).toEqual(["Đạo đức nghề nghiệp"]);
    expect(r.dem["tat-ca"]).toBe(4);
    expect(chuanHoaTim("  ĐẠO Đức ")).toBe("dao duc");
  });
  it("sắp theo tiến độ và theo tên", () => {
    expect(go({ sapXep: "tien-do" }).dong[0]!.tenKhoa).toBe("Giới thiệu công ty");
    expect(go({ sapXep: "ten" }).dong.map((x) => x.tenKhoa)).toEqual([
      "Bảo mật dữ liệu",
      "Đạo đức nghề nghiệp",
      "Giới thiệu công ty",
      "Quy trình an toàn",
    ]);
  });
  it("phân trang: kẹp trang ngoài biên, tính tổng trang, rỗng vẫn có 1 trang", () => {
    const r = go({ trang: 99 });
    expect(r).toMatchObject({ trang: 1, tongTrang: 1, tong: 4 });
    const nho = locSapXepKhoa(ds, { loc: "tat-ca", q: "", sapXep: "ten", trang: 2, coTrang: 3 }, NOW);
    expect(nho.dong).toHaveLength(1);
    expect(nho.tongTrang).toBe(2);
    expect(go({ q: "khong-co-khoa-nay" })).toMatchObject({ tong: 0, tongTrang: 1, trang: 1, dong: [] });
  });
});
