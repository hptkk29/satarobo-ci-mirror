/**
 * Bảng công site GV — bug prod 10/09/2026, lần thứ BA site GV dựng lại số của admin.
 *
 * Ca đo được trên prod dùng làm mốc: ngày 10/09, admin hiện `6h51` + cờ `THIEU_LUOT_RA`;
 * site GV hiện "Đã làm" và không có cột nào mang số. Hai màn nói hai chuyện về cùng một ngày.
 *
 * Luật 16 — mỗi vế CHẶN đi kèm vế CHO QUA:
 *   · "chưa có lượt chấm ⇒ KHÔNG 'Đã làm'"  ⇔  "411 phút ⇒ VẪN 'Đã làm'"
 *   · "X/P không ra 'theo nơi làm'"          ⇔  "LD/D1/D2 VẪN ra chuỗi đó"
 *   · "ngày mất ca vẫn hiện số"              ⇔  "ngày công RỖNG thì KHÔNG đẻ dòng rác"
 */
import { describe, expect, it } from "vitest";

import {
  dungDongBangCong,
  type BuoiDay,
  type CaXep,
  type CongNgay,
  type TheoPhanCongGv,
} from "./bang-cong-gv";
import type { ViecNgay } from "@/lib/parttime/viec-ngay";
import { NHAN_TRANG_THAI } from "./nhan-ca";

const HOM_NAY = "2026-09-10";

const caHC = (ngay: string, over: Partial<CaXep> = {}): CaXep => ({
  ngay,
  ma: "HC",
  ten: "Hành chính",
  kind: "TIMED",
  noi: "CS1",
  gio: "07:45–11:30 · 13:30–17:30",
  ...over,
});
const congNgay = (ngay: string, over: Partial<CongNgay> = {}): CongNgay => ({
  ngay,
  phutLam: 0,
  cong: 0,
  flags: [],
  ma: "HC",
  ...over,
});
const buoiDay = (ngay: string, over: Partial<BuoiDay> = {}): BuoiDay => ({
  key: "d-1",
  ngay,
  loai: "Dạy",
  ten: "Ca dạy chiều",
  phu: "Sata 3 · CS1",
  gio: "14:00–16:00",
  soGio: 2,
  hoanTat: false,
  ...over,
});
const dung = (i: {
  buoi?: readonly BuoiDay[];
  ca?: readonly CaXep[];
  cong?: readonly CongNgay[];
  homNay?: string;
  theoPhanCong?: TheoPhanCongGv | null;
}) =>
  dungDongBangCong({
    buoi: i.buoi ?? [],
    ca: i.ca ?? [],
    cong: i.cong ?? [],
    homNay: i.homNay ?? HOM_NAY,
    theoPhanCong: i.theoPhanCong ?? null,
  });

describe("Trạng thái đọc DỮ LIỆU, không so ngày", () => {
  // ── vế CHẶN ────────────────────────────────────────────────────────────────
  it("ngày quá khứ CHƯA có lượt chấm nào ⇒ KHÔNG in 'Đã làm'", () => {
    const [r] = dung({ ca: [caHC("2026-09-08")], cong: [congNgay("2026-09-08")] });
    expect(NHAN_TRANG_THAI[r.trangThai]).not.toBe("Đã làm");
    expect(r.trangThai).toBe("CHUA_CHAM");
  });

  it("ngày quá khứ mà engine CHƯA tính ⇒ cũng KHÔNG 'Đã làm'", () => {
    const [r] = dung({ ca: [caHC("2026-09-08")], cong: [] });
    expect(NHAN_TRANG_THAI[r.trangThai]).not.toBe("Đã làm");
    expect(r.phutLam).toBeNull();
    expect(r.cong).toBeNull();
  });

  it("buổi dạy quá khứ chưa ai bấm hoàn tất ⇒ KHÔNG 'Đã làm'", () => {
    const [r] = dung({ buoi: [buoiDay("2026-09-08")] });
    expect(NHAN_TRANG_THAI[r.trangThai]).not.toBe("Đã làm");
  });

  // ── vế CHO QUA (luật 16) ──────────────────────────────────────────────────
  it("ĐÚNG ca prod 10/09: 411 phút + THIEU_LUOT_RA ⇒ 411 + cờ + 'Đã làm'", () => {
    const [r] = dung({
      ca: [caHC(HOM_NAY)],
      cong: [congNgay(HOM_NAY, { phutLam: 411, cong: 1, flags: ["THIEU_LUOT_RA"] })],
    });
    // Site GV phải hiện ĐÚNG những gì admin hiện cho ngày này.
    expect(r.phutLam).toBe(411);
    expect(r.cong).toBe(1);
    expect(r.flags).toEqual(["THIEU_LUOT_RA"]);
    expect(NHAN_TRANG_THAI[r.trangThai]).toBe("Đã làm");
  });

  it("buổi dạy đã COMPLETED ⇒ VẪN 'Đã làm'", () => {
    const [r] = dung({ buoi: [buoiDay("2026-09-08", { hoanTat: true })] });
    expect(NHAN_TRANG_THAI[r.trangThai]).toBe("Đã làm");
  });

  it("ngày TƯƠNG LAI ⇒ 'Sắp tới'; HÔM NAY thì không", () => {
    const [mai] = dung({ ca: [caHC("2026-09-11")] });
    expect(mai.trangThai).toBe("SAP_TOI");
    const [nay] = dung({ ca: [caHC(HOM_NAY)], cong: [congNgay(HOM_NAY)] });
    expect(nay.trangThai).toBe("CHUA_CHAM");
  });
});

describe("Ngày nghỉ — `kind`, không phải `isLeave`", () => {
  it("X (OFF) VẪN hiện, nhãn 'Nghỉ', giờ '—', KHÔNG 'theo nơi làm'", () => {
    const [r] = dung({ ca: [caHC("2026-09-08", { ma: "X", ten: "Nghỉ", kind: "OFF", gio: "" })] });
    expect(r.loai).toBe("Nghỉ");
    expect(r.gio).toBe("—");
    expect(r.gio).not.toContain("nơi làm");
    expect(r.trangThai).toBe("NGHI");
  });

  it("P (LEAVE) KHÔNG còn biến mất khỏi bảng", () => {
    const rows = dung({
      ca: [caHC("2026-09-08", { ma: "P", ten: "Nghỉ phép", kind: "LEAVE", gio: "" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].loai).toBe("Nghỉ phép");
    expect(rows[0].gio).toBe("—");
  });

  it("ngày nghỉ KHÔNG mượn giờ làm của dòng ngày công", () => {
    // Nếu engine vẫn ghi một dòng ngày công cho ngày nghỉ, bảng không được in nó thành giờ làm.
    const [r] = dung({
      ca: [caHC("2026-09-08", { ma: "X", ten: "Nghỉ", kind: "OFF", gio: "" })],
      cong: [congNgay("2026-09-08", { phutLam: 90, cong: 0, flags: ["CHAM_NGOAI_LICH"] })],
    });
    expect(r.phutLam).toBeNull();
    expect(r.flags).toEqual([]);
    expect(r.trangThai).toBe("NGHI");
  });

  // ── vế CHO QUA ────────────────────────────────────────────────────────────
  it.each<["LOCATION_ONLY" | "FLEXIBLE", string]>([
    ["LOCATION_ONLY", "D1"],
    ["FLEXIBLE", "LD"],
  ])("%s (%s) không giờ ⇒ VẪN 'Ca làm · theo nơi làm'", (kind, ma) => {
    const [r] = dung({ ca: [caHC("2026-09-08", { ma, kind, gio: "" })] });
    expect(r.loai).toBe("Ca làm");
    expect(r.gio).toBe("theo nơi làm");
  });

  });

describe("Ngày công KHÔNG còn ca xếp — không được rơi mất số", () => {
  it("có phút làm nhưng ca đã bị gỡ ⇒ VẪN có một dòng mang số", () => {
    const rows = dung({
      ca: [],
      cong: [congNgay("2026-09-09", { phutLam: 480, cong: 1, ma: "HC" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].phutLam).toBe(480);
    expect(rows[0].cong).toBe(1);
  });

  it("cờ thôi (0 phút, 0 công) cũng đủ để hiện — đó là việc cần nộp đơn", () => {
    const rows = dung({ cong: [congNgay("2026-09-09", { flags: ["KHONG_CO_LUOT"] })] });
    expect(rows).toHaveLength(1);
    expect(rows[0].flags).toEqual(["KHONG_CO_LUOT"]);
  });

  // ── vế CHO QUA: không đẻ dòng rác ─────────────────────────────────────────
  it("ngày công RỖNG hoàn toàn ⇒ KHÔNG đẻ dòng", () => {
    expect(dung({ cong: [congNgay("2026-09-09")] })).toHaveLength(0);
  });

  it("ngày ĐÃ có ca xếp ⇒ KHÔNG nhân đôi thành hai dòng", () => {
    const rows = dung({
      ca: [caHC("2026-09-09")],
      cong: [congNgay("2026-09-09", { phutLam: 411, cong: 1 })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].phutLam).toBe(411);
  });
});

describe("Không nhân bản số của NGÀY lên từng buổi dạy", () => {
  it("một ngày có 2 buổi dạy + 1 ca ⇒ chỉ dòng ca mang giờ làm/công", () => {
    const rows = dung({
      buoi: [
        buoiDay("2026-09-09", { key: "d-1", hoanTat: true }),
        buoiDay("2026-09-09", { key: "d-2", hoanTat: true }),
      ],
      ca: [caHC("2026-09-09")],
      cong: [congNgay("2026-09-09", { phutLam: 411, cong: 1 })],
    });
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.phutLam != null)).toHaveLength(1);
    expect(rows.reduce((n, r) => n + (r.cong ?? 0), 0)).toBe(1);
  });
});

describe("Sắp xếp", () => {
  it("theo NGÀY tăng dần, ca nghỉ không bị đẩy ra khỏi dòng thời gian", () => {
    const rows = dung({
      ca: [
        caHC("2026-09-09"),
        caHC("2026-09-07", { ma: "X", kind: "OFF", gio: "" }),
        caHC("2026-09-08"),
      ],
    });
    expect(rows.map((r) => r.ngay)).toEqual(["2026-09-07", "2026-09-08", "2026-09-09"]);
  });
});

// ── GV parttime theo phân công (chủ dự án chốt 08/11/2026) ─────────────────────────────────────────────
describe("[BCGV-PC] GV parttime từ mốc: dòng = việc theo phân công, KHÔNG còn ô ca lịch rảnh", () => {
  const MOC = "2026-11-01";
  const viec = (ngay: string, p: Partial<ViecNgay> = {}): ViecNgay => ({
    userId: "u1",
    ten: "GV u1",
    ngay,
    coSo: ["cs2"],
    o: [{ centerId: "cs2", ca: "C", ma: "TD", coTrial: false, canhBao: [] }],
    tietChinh: 2,
    tietTroGiang: 0,
    trucDu: 0,
    trucNua: 1,
    trucQuyDoi: 0.5,
    soBuoiTrial: 0,
    tien: 285000,
    tienTheoNhom: { DAY_CHINH: 240000, DAY_BU: 0, DAY_THAY: 0, HOC_VUOT: 0, TRO_GIANG: 0, TRUC_DU: 0, TRUC_NUA: 45000, HO_TRO_TRIAL: 0 },
    chuaTinh: 0,
    ngoaiCa: 0,
    legacy: false,
    ...p,
  });
  const pc = (ds: ViecNgay[]): TheoPhanCongGv => ({ apDung: (n) => n >= MOC, viec: ds });
  const T = "2026-11-05";
  const caT = caHC(T, { ma: "T", ten: "Ca tối", kind: "TIMED" });

  it("[BCGV-PC-01] ngày ≥ mốc: ô ca T (0,5 công) BỊ BỎ, có MỘT dòng 'Phân công' mang việc + tiền dự kiến; quá khứ ⇒ 'Theo phân công'", () => {
    const rows = dung({ homNay: "2026-11-08", ca: [caT], cong: [congNgay(T, { ma: "T", cong: 0.5, phutLam: 200, flags: ["DI_MUON"] })], theoPhanCong: pc([viec(T)]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loai: "Phân công", cong: null, phutLam: null, flags: [], trangThai: "THEO_PHAN_CONG", phu: "Chiều · TD" });
    expect(rows[0]!.phanCong?.viec).toBe("2 tiết · trực ½");
    expect(NHAN_TRANG_THAI.THEO_PHAN_CONG).toBe("Theo phân công");
  });
  it("[BCGV-PC-02] ngày có ô ca mà KHÔNG có phân công ⇒ không dòng nào (không in 'Ngoài lịch · 0 công'); ngày tương lai ⇒ 'Sắp tới'", () => {
    const rows = dung({ homNay: "2026-11-08", ca: [caT, caHC("2026-11-06")], cong: [congNgay("2026-11-06", { flags: ["CHAM_NGOAI_LICH"] })], theoPhanCong: pc([viec("2026-11-20")]) });
    expect(rows.map((r) => `${r.ngay}:${r.loai}:${r.trangThai}`)).toEqual(["2026-11-20:Phân công:SAP_TOI"]);
  });
  it("[BCGV-PC-03] ngày TRƯỚC mốc giữ nguyên ô ca + công (đối chứng): 31/10 vẫn dòng 'Ca làm' 1 công", () => {
    const rows = dung({ homNay: "2026-11-08", ca: [caHC("2026-10-31")], cong: [congNgay("2026-10-31", { cong: 1, phutLam: 480 })], theoPhanCong: pc([viec(T)]) });
    expect(rows.map((r) => `${r.ngay}:${r.loai}:${r.cong}`)).toEqual(["2026-10-31:Ca làm:1", "2026-11-05:Phân công:null"]);
  });
  it("[BCGV-PC-04] FULLTIME (theoPhanCong null) sau mốc ⇒ y nguyên đường cũ: dòng ca mang công ô ca", () => {
    const rows = dung({ homNay: "2026-11-08", ca: [caHC(T)], cong: [congNgay(T, { cong: 1, phutLam: 480 })], theoPhanCong: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ loai: "Ca làm", cong: 1, phanCong: null });
  });
});
