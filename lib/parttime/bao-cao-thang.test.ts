// [P5-R*] — tổng hợp tháng (thuần). DB: tests/cham-cong/parttime-bao-cao-thang.spec.ts.
import { describe, expect, it } from "vitest";
import { CHI_SO, soCua, tongHopThang, type ChiSo } from "./bao-cao-thang";
import type { DongDieuChinhThang } from "./bao-cao-thang-kieu";
import type { DongTruc } from "./truc-van-hanh-db";
import type { DongDoiSoat } from "./workunit-db";

type Tuy = {
  id: string;
  user?: string;
  role?: "MAIN_TEACHER" | "TEACHING_ASSISTANT";
  activity?: "REGULAR_CLASS" | "MAKEUP" | "ADVANCE" | "TRIAL";
  kieu?: "SYSTEM" | "SUBSTITUTE" | "MANUAL";
  lop?: DongDoiSoat["ungVien"]["lop"];
  donVi?: "CONFIRMED" | "STALE" | null;
  diMuon?: boolean;
  raSom?: boolean;
  nhanXet?: "MISSING" | "LATE" | "ON_TIME" | null;
  dieuChinh?: { id: string; amount: number; status: string }[];
};
const day = (p: Tuy): DongDieuChinhThang =>
  ({
    dong: {
      bc: { assignmentId: p.id, userId: p.user ?? "gv", role: p.role ?? "MAIN_TEACHER", activity: p.activity ?? "REGULAR_CLASS", diMuon: p.diMuon ?? false, raSom: p.raSom ?? false },
      ungVien: { lop: p.lop ?? "TU_DONG", lyDo: [] },
      xacNhan: null,
      donVi: p.donVi ? { id: `w-${p.id}`, hieuLuc: p.donVi, workUnitType: p.role === "TEACHING_ASSISTANT" ? "ASSISTANT_TEACHING" : "MAIN_TEACHING", quantity: "1", standardMinutes: 100 } : null,
    },
    assignmentType: p.kieu ?? "SYSTEM",
    sourceWorkRequestId: null,
    nhanXet: p.nhanXet ? { trangThai: p.nhanXet } : null,
    muc: [],
    dieuChinh: (p.dieuChinh ?? []).map((a) => ({ ...a, type: "LATE_ARRIVAL", ruleCode: "X", decisionReason: null })),
  }) as unknown as DongDieuChinhThang;
const truc = (id: string, p: { donVi?: "1" | "0.5" | null; donViTra?: "1" | "0.5" | "0" | null; lop?: string; xn?: "CONFIRMED" | null; phut?: number; user?: string }): DongTruc =>
  ({
    dutyId: id,
    userId: p.user ?? "gv",
    danhGia: { lop: p.lop ?? "TU_DONG", donViTra: p.donViTra ?? null, phutCoMatTrongCa: p.phut ?? 0 },
    xacNhan: p.xn ? { decision: p.xn } : null,
    donVi: p.donVi ? { id: `w-${id}`, quantity: p.donVi, rateSnapshot: 90000, hieuLuc: "CONFIRMED" } : null,
  }) as unknown as DongTruc;

describe("[P5-R] tổng hợp tháng", () => {
  const ds = [
    day({ id: "thuong", donVi: "CONFIRMED" }),
    day({ id: "thay", kieu: "SUBSTITUTE", donVi: "CONFIRMED" }),
    day({ id: "bu", activity: "MAKEUP", donVi: "CONFIRMED", nhanXet: "MISSING", dieuChinh: [{ id: "a1", amount: -30000, status: "PROPOSED" }] }),
    day({ id: "vuot", activity: "ADVANCE", donVi: "CONFIRMED" }),
    day({ id: "ta", role: "TEACHING_ASSISTANT", donVi: "CONFIRMED", diMuon: true, dieuChinh: [{ id: "a2", amount: -10000, status: "CONFIRMED" }] }),
    day({ id: "cho", lop: "TU_DONG", donVi: null }),
    day({ id: "cu", donVi: "STALE" }),
    day({ id: "chan", lop: "CHAN", donVi: null, raSom: true }),
    day({ id: "trial", activity: "TRIAL", lop: "KHONG_AP_DUNG", donVi: null, diMuon: true }),
    day({ id: "chuaxong", lop: "CHUA_XONG", donVi: null, diMuon: true }),
  ];
  const tr = [truc("t1", { donVi: "1", phut: 225 }), truc("t05", { donVi: "0.5", phut: 200 }), truc("t0", { xn: "CONFIRMED", donViTra: "0", phut: 220 }), truc("tcho", { lop: "CHO", phut: 0 }), truc("tchan", { lop: "CHAN", phut: 0 })];
  const [r] = tongHopThang(ds, tr, [], []);

  it("[P5-R01] phân loại tiết ĐÃ XÁC NHẬN: thường · dạy thay · học bù · học vượt · trợ giảng — dạy thay / học bù là CHIỀU của đứng chính", () => {
    expect([r.ds.mainThuong, r.ds.mainDayThay, r.ds.mainHocBu, r.ds.mainHocVuot, r.ds.troGiang]).toEqual([["thuong"], ["thay"], ["bu"], ["vuot"], ["ta"]]);
    expect([r.soTiet, r.phutChuanDay]).toEqual([5, 500]);
  });

  it("[P5-R02] TỔNG = CHI TIẾT: mỗi tiết đã xác nhận nằm ở ĐÚNG MỘT nhóm dạy; tổng tiết = số khoá trong các nhóm dạy", () => {
    const nhom: ChiSo[] = ["mainThuong", "mainDayThay", "mainHocBu", "mainHocVuot", "mainKhac", "troGiang"];
    const khoa = nhom.flatMap((k) => r.ds[k]);
    expect(new Set(khoa).size).toBe(khoa.length);
    expect(khoa.length).toBe(r.soTiet);
    for (const k of CHI_SO) expect(soCua(r, k), k).toBe(r.ds[k].length);
  });

  it("[P5-R03] chưa xác nhận ⇒ 'chờ xác nhận', không vào số tiết; đơn vị cũ ⇒ 'cũ'; CHẶN ⇒ ngoại lệ; TRIAL / chưa xong không tính", () => {
    expect(r.ds.choXacNhan).toEqual(expect.arrayContaining(["cho"]));
    expect(r.ds.donViCu).toEqual(["cu"]);
    expect(r.ds.ngoaiLe).toEqual(expect.arrayContaining(["chan", "tchan"]));
    for (const k of CHI_SO) expect(r.ds[k], k).not.toContain("trial");
    expect(r.ds.diMuon).toEqual(["ta"]); // chưa xong + trial không đếm muộn
    expect(r.ds.veSom).toEqual(["chan"]);
  });

  it("[P5-R04] trực: 1,0 · 0,5 · 0 tách nhóm; đơn vị trực = tổng quantity; phút có mặt là thước đo RIÊNG (gồm cả ca chưa xác nhận)", () => {
    expect([r.ds.trucDu, r.ds.trucNua, r.ds.trucKhong]).toEqual([["t1"], ["t05"], ["t0"]]);
    expect(r.donViTruc).toBe(1.5);
    expect(r.phutCoMatTruc).toBe(225 + 200 + 220);
    // Ca CHỜ (tiết trong ca chưa quyết / chưa hết ca) chưa xác nhận được ⇒ không vào nhóm nào, như tiết "chưa xong".
    for (const k of CHI_SO) expect(r.ds[k], k).not.toContain("tcho");
  });

  it("[P5-R05] khoản trừ: đề xuất và đã xác nhận tách riêng, tiền = tổng đúng các khoản trong danh sách", () => {
    expect([r.ds.deXuat, r.tienDeXuat, r.ds.daXacNhanTru, r.tienDaXacNhan]).toEqual([["a1"], -30000, ["a2"], -10000]);
    expect(r.ds.thieuNhanXet).toEqual(["bu"]);
  });

  it("[P5-R06] mỗi người một dòng; người không có dữ liệu không xuất hiện", () => {
    const hai = tongHopThang([day({ id: "x", user: "a", donVi: "CONFIRMED" }), day({ id: "y", user: "b", donVi: "CONFIRMED" })], [truc("z", { user: "b", donVi: "1" })], [], []);
    expect(hai.map((x) => [x.userId, x.soTiet, x.donViTruc])).toEqual([
      ["a", 1, 0],
      ["b", 1, 1],
    ]);
    expect(tongHopThang([], [], [], [])).toEqual([]);
  });
});
