// [CBC-*] — báo cáo xem trước cutover tách theo MỐC ngày (20/10/2026: phạm vi CS2 từ 15/10, công cụ chạy 20/10).
import { describe, expect, it } from "vitest";
import type { KetQuaCutover } from "./cutover";
import { baoCaoTheoMoc, dongBaoCao } from "./cutover-bao-cao";

const k = (p: Partial<KetQuaCutover>): KetQuaCutover => ({
  sessionId: Math.random().toString(36).slice(2),
  centerCode: "CS2",
  classCode: "L1",
  ngay: "2026-10-20",
  gio: "08:00–09:40",
  mainId: "gv",
  taId: null,
  yeuCauTA: null,
  thoiLuongDayPhut: 100,
  chinhSach: null,
  nhom: "READY_TO_IMPORT",
  nhan: [],
  chinh: "READY_TO_IMPORT",
  lyDo: [],
  seNhap: [{ role: "MAIN_TEACHER", userId: "gv" }],
  ...p,
});

describe("[CBC] baoCaoTheoMoc", () => {
  const ds = [
    k({ ngay: "2026-10-15", classCode: "A" }),
    k({ ngay: "2026-10-19", classCode: "B", seNhap: [{ role: "MAIN_TEACHER", userId: "g" }, { role: "TEACHING_ASSISTANT", userId: "t" }] }),
    k({ ngay: "2026-10-20", classCode: "C", nhom: "MISSING_MAIN", seNhap: [] }),
    k({ ngay: "2026-10-21", classCode: "D", nhan: ["MISSING_TA", "NON_STANDARD_DURATION"] }),
    k({ ngay: "2026-10-22", classCode: "E", nhom: "INVALID", lyDo: ["THIEU_GIO"], seNhap: [] }),
    k({ ngay: "2026-10-22", classCode: "E", nhom: "PENDING_ACCEPTANCE", seNhap: [] }),
  ];
  const r = baoCaoTheoMoc(ds, "2026-10-20");

  it("[CBC-01] mốc tách: ngày < mốc là phần đã qua (gồm 15/10), ngày = mốc thuộc phần từ mốc", () => {
    expect(r.truocMoc.soBuoi).toBe(2);
    expect([r.truocMoc.tuNgay, r.truocMoc.denNgay]).toEqual(["2026-10-15", "2026-10-19"]);
    expect(r.tuMoc.soBuoi).toBe(4);
    expect(r.tuMoc.tuNgay).toBe("2026-10-20");
    expect(r.tong.soBuoi).toBe(r.truocMoc.soBuoi + r.tuMoc.soBuoi);
  });
  it("[CBC-02] đếm phân công sẽ nhập THEO VAI", () => {
    expect([r.truocMoc.seNhapGvChinh, r.truocMoc.seNhapTroGiang, r.truocMoc.buoiCoNhap]).toEqual([2, 1, 2]);
    expect([r.tuMoc.seNhapGvChinh, r.tuMoc.seNhapTroGiang]).toEqual([1, 0]);
  });
  it("[CBC-03] thiếu GV / thiếu TA / thời lượng không chuẩn / lỗi + lý do / đã có phân công", () => {
    expect(r.tuMoc.thieuGv).toBe(1);
    expect(r.tuMoc.thieuTa).toBe(1);
    expect(r.tuMoc.thoiLuongKhongChuan).toBe(1);
    expect(r.tuMoc.loi).toBe(1);
    expect(r.tuMoc.lyDoLoi).toEqual({ THIEU_GIO: 1 });
    expect(r.tuMoc.daCoPhanCong.choNhan).toBe(1);
    expect(r.truocMoc.thieuGv + r.truocMoc.thieuTa + r.truocMoc.loi).toBe(0);
  });
  it("[CBC-04] trùng lịch: cùng lớp × ngày × giờ > 1 buổi (đối chứng: lớp khác cùng giờ không tính)", () => {
    expect(r.tuMoc.trungLich).toBe(2);
    expect(r.truocMoc.trungLich).toBe(0);
  });
  it("[CBC-05] rỗng ⇒ số 0, ngày null; dòng log in được", () => {
    const rong = baoCaoTheoMoc([], "2026-10-20");
    expect(rong.tong).toMatchObject({ soBuoi: 0, tuNgay: null, denNgay: null, trungLich: 0 });
    expect(dongBaoCao("tổng", r.tong)).toContain("6 buổi (2026-10-15…2026-10-22)");
  });
});
