/**
 * Ca [NHH-D8-01..07] — PR0 "Nối Order.leadId cho đơn cũ" (D8), phần THUẦN.
 *
 * Đặc tả: docs/source-commission/07-dac-ta-thi-cong-pr0-pr1.md §1.3, §3.1.
 * Mọi ngày là TUYỆT ĐỐI (luật 19). Không đọc đồng hồ thật.
 */
import { describe, expect, it } from "vitest";
import { pickEffectiveRates } from "@/lib/crm/commission-config";
import {
  mapButToanHoaHong,
  type HangThanhToanHoaHong,
} from "@/lib/crm/commission-run";
import { tinhHoaHongTheoKy, type DongHoaHongKy } from "@/lib/crm/commission-thuc-thu";
import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";
import {
  kyBiAnhHuong,
  lapKeHoachNoiDon,
  phanLoaiNoiDon,
  phanTichSoDuyet,
  quyetDinhGhiNoiDon,
  soBaCot,
  vaLeadTrongBoNho,
  type DonThieuLead,
  type UngVienLead,
} from "./noi-don";

const lead = (o: Partial<UngVienLead> & { leadId: string; phone: string }): UngVienLead => ({
  deletedAt: null,
  convertedById: null,
  adminId: null,
  centerId: null,
  ...o,
});

const don = (code: string, customerPhone: string, centerId: string | null = null): DonThieuLead => ({
  orderId: `o-${code}`,
  code,
  customerPhone,
  centerId,
});

describe("[NHH-D8-01] phanLoaiNoiDon", () => {
  it("0 ⇒ KHONG · 1 ⇒ MOT · hai lead khác nhau ⇒ NHIEU", () => {
    expect(phanLoaiNoiDon([])).toBe("KHONG");
    expect(phanLoaiNoiDon([{ leadId: "L1" }])).toBe("MOT");
    expect(phanLoaiNoiDon([{ leadId: "L1" }, { leadId: "L2" }])).toBe("NHIEU");
  });

  it("CÙNG một lead lặp hai lần (tra bằng cả hai biến thể SĐT) ⇒ vẫn MOT", () => {
    expect(phanLoaiNoiDon([{ leadId: "L1" }, { leadId: "L1" }])).toBe("MOT");
  });
});

describe("[NHH-D8-02] lapKeHoachNoiDon — khoá canonicalPhone", () => {
  it("đơn `0905123456` ↔ lead `84905123456` ⇒ MOT; và chiều ngược", () => {
    const kh1 = lapKeHoachNoiDon([don("A", "0905123456")], [lead({ leadId: "L1", phone: "84905123456" })]);
    expect(kh1.mot.map((m) => [m.code, m.lead.leadId])).toEqual([["A", "L1"]]);
    expect(kh1.nhieu).toEqual([]);
    expect(kh1.khong).toEqual([]);

    const kh2 = lapKeHoachNoiDon([don("B", "84905123456")], [lead({ leadId: "L2", phone: "0905123456" })]);
    expect(kh2.mot.map((m) => [m.code, m.lead.leadId])).toEqual([["B", "L2"]]);
  });

  it("lead đã xoá mềm KHÔNG là ứng viên; đối chứng: lead còn sống cùng số ⇒ MOT, không NHIEU", () => {
    const daXoa = lead({ leadId: "L_XOA", phone: "0905123456", deletedAt: new Date("2026-09-01T00:00:00Z") });
    const song = lead({ leadId: "L_SONG", phone: "84905123456" });

    const chiXoa = lapKeHoachNoiDon([don("A", "0905123456")], [daXoa]);
    expect(chiXoa.mot).toEqual([]);
    expect(chiXoa.khong).toEqual([{ orderId: "o-A", code: "A", lyDo: "KHONG_CO_LEAD" }]);

    const ca2 = lapKeHoachNoiDon([don("A", "0905123456")], [daXoa, song]);
    expect(ca2.mot.map((m) => m.lead.leadId)).toEqual(["L_SONG"]);
    expect(ca2.nhieu).toEqual([]);
  });

  it("hai lead sống khác nhau cùng số ⇒ NHIEU, liệt kê đủ leadId; cùng một lead lặp ⇒ MOT", () => {
    const kh = lapKeHoachNoiDon(
      [don("A", "0905123456"), don("B", "0905999888")],
      [
        // L2 chèn TRƯỚC L1: thứ tự chèn ≠ thứ tự sắp, nên bỏ `.sort()` ở `leadIds` thì ca này đỏ
        // (fixture cũ chèn L1 rồi L2 — đã đúng sẵn thứ tự sắp, cấy bỏ sort vẫn xanh).
        lead({ leadId: "L2", phone: "84905123456" }),
        lead({ leadId: "L1", phone: "0905123456" }),
        lead({ leadId: "L3", phone: "0905999888" }),
        lead({ leadId: "L3", phone: "0905999888" }),
      ],
    );
    expect(kh.nhieu).toEqual([{ orderId: "o-A", code: "A", leadIds: ["L1", "L2"] }]);
    expect(kh.mot.map((m) => [m.code, m.lead.leadId])).toEqual([["B", "L3"]]);
  });

  it("khacCoSo chỉ true khi cả hai cơ sở khác null và khác nhau", () => {
    const l = (centerId: string | null) => lead({ leadId: "L1", phone: "0905123456", centerId });
    const khacCoSo = (dc: string | null, lc: string | null) =>
      lapKeHoachNoiDon([don("A", "0905123456", dc)], [l(lc)]).mot[0]!.khacCoSo;
    expect(khacCoSo("C1", "C2")).toBe(true);
    expect(khacCoSo("C1", "C1")).toBe(false);
    expect(khacCoSo(null, "C2")).toBe(false);
    expect(khacCoSo("C1", null)).toBe(false);
  });
});

describe("[NHH-D8-03] SĐT không chuẩn hoá được ⇒ KHONG, KHÔNG rơi về so chuỗi thô", () => {
  it("số cố định `02363123456` và `` ⇒ SDT_KHONG_CHUAN_HOA dù có lead cùng chuỗi", () => {
    const leads = [
      lead({ leadId: "L_RONG", phone: "" }),
      lead({ leadId: "L_CODINH", phone: "02363123456" }),
    ];
    const kh = lapKeHoachNoiDon([don("CD", "02363123456"), don("RONG", "")], leads);
    expect(kh.mot).toEqual([]);
    expect(kh.nhieu).toEqual([]);
    expect(kh.khong).toEqual([
      { orderId: "o-CD", code: "CD", lyDo: "SDT_KHONG_CHUAN_HOA" },
      { orderId: "o-RONG", code: "RONG", lyDo: "SDT_KHONG_CHUAN_HOA" },
    ]);
  });

  it("đối chứng dương: SĐT di động hợp lệ vẫn nối được trong cùng lượt", () => {
    const kh = lapKeHoachNoiDon(
      [don("CD", "02363123456"), don("DD", "0905123456")],
      [lead({ leadId: "L_CODINH", phone: "02363123456" }), lead({ leadId: "L_DD", phone: "84905123456" })],
    );
    expect(kh.mot.map((m) => [m.code, m.lead.leadId])).toEqual([["DD", "L_DD"]]);
    expect(kh.khong.map((k) => k.code)).toEqual(["CD"]);
  });
});

describe("[NHH-D8-04] vaLeadTrongBoNho — chuỗi thuần THẬT (mapButToanHoaHong → tinhHoaHongTheoKy)", () => {
  const KY = "2026-09";
  const hang = (
    id: string,
    orderId: string,
    amount: number,
    order: HangThanhToanHoaHong["order"],
  ): HangThanhToanHoaHong & { orderId: string } => ({
    id,
    orderId,
    amount,
    // Hằng của trục A/thực thu — KHÔNG gõ literal (lưới `truc-a.test.ts` quét cả tệp test).
    accountantStatus: TRANG_THAI_THUC_THU[0],
    adjustmentOfId: null,
    paidDate: new Date("2026-09-15T03:00:00.000Z"),
    confirmedAt: new Date("2026-09-15T03:30:00.000Z"),
    centerId: null,
    adjustmentOf: null,
    enrollment: null,
    order,
  });

  const rows = [
    hang("P1", "O1", 10_000_000, { leadId: null, centerId: null, lead: null }),
    hang("P2", "O2", 5_000_000, {
      leadId: "L2",
      centerId: null,
      lead: { convertedById: "U2", adminId: "A2", centerId: null },
    }),
  ];
  const ungVien = lead({ leadId: "L1", phone: "84905123456", convertedById: "U1", adminId: "A1" });

  const tinh = (r: typeof rows): DongHoaHongKy[] =>
    tinhHoaHongTheoKy({
      period: KY,
      butToan: mapButToanHoaHong(r, []),
      ratesAt: (at) => pickEffectiveRates([], at),
    });

  it("trước: SALE/SALE_ADMIN của đơn O1 treo; sau: SALE → convertedById, SALE_ADMIN → adminId; O2 không đổi; đầu vào không bị đổi", () => {
    const banChup = structuredClone(rows);
    const truoc = tinh(rows);
    const rowsSau = vaLeadTrongBoNho(rows, new Map([["O1", ungVien]]));
    const sau = tinh(rowsSau);

    // đầu vào bất biến, trả mảng MỚI
    expect(rows).toEqual(banChup);
    expect(rowsSau).not.toBe(rows);

    const cua = (ds: DongHoaHongKy[], nguoi: string) =>
      ds.filter((d) => d.recipientId === nguoi).map((d) => [d.tier, d.amount, d.leadId]);

    expect(cua(truoc, "U1")).toEqual([]);
    expect(cua(truoc, "A1")).toEqual([]);
    expect(cua(sau, "U1")).toEqual([["SALE", 400_000, "L1"]]);
    expect(cua(sau, "A1")).toEqual([["SALE_ADMIN", 100_000, "L1"]]);

    // bút toán kia (O2) không đổi
    expect(cua(sau, "U2")).toEqual(cua(truoc, "U2"));
    expect(cua(sau, "A2")).toEqual(cua(truoc, "A2"));
    expect(cua(sau, "U2")).toEqual([["SALE", 200_000, "L2"]]);
  });

  it("chỉ vá dòng có order.leadId === null: đơn đã có lead KHÔNG bị đè dù có trong `va`", () => {
    const sau = vaLeadTrongBoNho(rows, new Map([["O2", ungVien]]));
    const p2 = sau.find((r) => r.id === "P2")!;
    expect(p2.order?.leadId).toBe("L2");
    expect(p2.order?.lead?.convertedById).toBe("U2");
  });

  it("vá đủ `order.lead` (convertedById/adminId/centerId), không chỉ `order.leadId`", () => {
    const sau = vaLeadTrongBoNho(rows, new Map([["O1", lead({ ...ungVien, centerId: "CX" })]]));
    const p1 = sau.find((r) => r.id === "P1")!;
    expect(p1.order?.leadId).toBe("L1");
    expect(p1.order?.lead).toEqual({ convertedById: "U1", adminId: "A1", centerId: "CX" });
  });
});

describe("[NHH-D8-05] kyBiAnhHuong — kỳ theo giờ VN", () => {
  const ids = new Set(["O1"]);
  it("biên +07:00: 16:59:59.999Z ⇒ tháng 9; 17:00:00.000Z ⇒ tháng 10", () => {
    expect(kyBiAnhHuong([{ orderId: "O1", paidDate: new Date("2026-09-30T16:59:59.999Z") }], ids)).toEqual([
      "2026-09",
    ]);
    expect(kyBiAnhHuong([{ orderId: "O1", paidDate: new Date("2026-09-30T17:00:00.000Z") }], ids)).toEqual([
      "2026-10",
    ]);
  });

  it("chỉ lấy bút toán của đơn sẽ nối; duy nhất + sắp tăng", () => {
    const rows = [
      { orderId: "O1", paidDate: new Date("2026-10-05T03:00:00Z") },
      { orderId: "O1", paidDate: new Date("2026-09-05T03:00:00Z") },
      { orderId: "O1", paidDate: new Date("2026-09-20T03:00:00Z") },
      { orderId: "O_KHAC", paidDate: new Date("2026-08-01T03:00:00Z") },
    ];
    expect(kyBiAnhHuong(rows, ids)).toEqual(["2026-09", "2026-10"]);
  });
});

describe("[NHH-D8-06] quyetDinhGhiNoiDon — thứ tự cổng", () => {
  const ok = {
    soDuyet: 5 as number | null,
    keHoach: 5,
    ghiDuoc: true as boolean | null,
    trangThaiKy: [] as { period: string; status: "DRAFT" | "APPROVED" | "REOPENED" }[],
  };
  const loi = (o: Partial<typeof ok>) => {
    const r = quyetDinhGhiNoiDon({ ...ok, ...o });
    return r.ok ? null : r.loi;
  };

  it("1) thiếu --expect · NaN · âm ⇒ từ chối (thắng mọi lỗi khác)", () => {
    const xau = { ghiDuoc: false, trangThaiKy: [{ period: "2026-09", status: "APPROVED" as const }] };
    expect(loi({ soDuyet: null, ...xau })).toMatch(/--expect/);
    expect(loi({ soDuyet: Number.NaN, ...xau })).toMatch(/--expect/);
    expect(loi({ soDuyet: -1, ...xau })).toMatch(/--expect/);
  });

  it("2) lệch kế hoạch ⇒ nêu cả hai số; thắng ghiDuoc/APPROVED", () => {
    const m = loi({ soDuyet: 4, keHoach: 5, ghiDuoc: false, trangThaiKy: [{ period: "2026-09", status: "APPROVED" }] });
    expect(m).toMatch(/≠/);
    expect(m).toMatch(/5/);
    expect(m).toMatch(/4/);
  });

  it("3) kết nối chỉ đọc ⇒ từ chối; thắng APPROVED", () => {
    expect(loi({ ghiDuoc: false, trangThaiKy: [{ period: "2026-09", status: "APPROVED" }] })).toMatch(/chỉ đọc/);
  });

  it("4) có kỳ APPROVED ⇒ từ chối, nêu kỳ + MANUAL_REVIEW_REQUIRED", () => {
    const m = loi({
      trangThaiKy: [
        { period: "2026-08", status: "DRAFT" },
        { period: "2026-09", status: "APPROVED" },
      ],
    });
    expect(m).toMatch(/2026-09/);
    expect(m).toMatch(/MANUAL_REVIEW_REQUIRED/);
    expect(m).not.toMatch(/2026-08/);
  });

  it("đối chứng dương: DRAFT / REOPENED / không bảng kê + số khớp ⇒ ok; ghiDuoc null (không rõ) vẫn ok", () => {
    expect(quyetDinhGhiNoiDon({ ...ok, trangThaiKy: [{ period: "2026-09", status: "DRAFT" }] })).toEqual({ ok: true });
    expect(quyetDinhGhiNoiDon({ ...ok, trangThaiKy: [{ period: "2026-09", status: "REOPENED" }] })).toEqual({
      ok: true,
    });
    expect(quyetDinhGhiNoiDon({ ...ok })).toEqual({ ok: true });
    expect(quyetDinhGhiNoiDon({ ...ok, ghiDuoc: null })).toEqual({ ok: true });
    expect(quyetDinhGhiNoiDon({ ...ok, soDuyet: 0, keHoach: 0 })).toEqual({ ok: true });
  });
});

describe("[NHH-D8-07] soBaCot", () => {
  const d = (tier: DongHoaHongKy["tier"], recipientId: string, amount: number): DongHoaHongKy => ({
    tier,
    recipientId,
    amount,
    isClawback: amount < 0,
    leadId: null,
    note: "",
  });

  it("gom theo (tầng, người); dòng chỉ ở một cột vẫn ra với cột kia = 0", () => {
    const { dong } = soBaCot(
      [
        { tier: "SALE", recipientId: "U2", amount: 100 },
        { tier: "SALE", recipientId: "U2", amount: 50 },
        { tier: "QC", recipientId: "Q1", amount: 70 },
      ],
      [d("SALE", "U2", 150), d("SALE", "U2", 30), d("QC", "Q1", 70)],
      [d("SALE", "U2", 180), d("SALE", "U1", 400), d("SALE_ADMIN", "A1", 100), d("QC", "Q1", 70)],
    );
    const tim = (tier: string, nguoi: string) => dong.find((x) => x.tier === tier && x.recipientId === nguoi);
    expect(tim("SALE", "U2")).toMatchObject({ dangLuu: 150, truoc: 180, sau: 180 });
    expect(tim("SALE", "U1")).toMatchObject({ dangLuu: 0, truoc: 0, sau: 400 });
    expect(tim("SALE_ADMIN", "A1")).toMatchObject({ dangLuu: 0, truoc: 0, sau: 100 });
    expect(tim("QC", "Q1")).toMatchObject({ dangLuu: 70, truoc: 70, sau: 70 });
    expect(dong).toHaveLength(4);
  });

  it("TRIAL_TEACHER của (a) bị TÁCH RA, không vào bảng so", () => {
    const { dong, trialTeacherDangLuu } = soBaCot(
      [
        { tier: "TRIAL_TEACHER", recipientId: "G1", amount: 90 },
        { tier: "TRIAL_TEACHER", recipientId: "G2", amount: 10 },
        { tier: "SALE", recipientId: "U1", amount: 5 },
      ],
      [],
      [],
    );
    expect(trialTeacherDangLuu).toBe(100);
    expect(dong.map((x) => x.tier)).toEqual(["SALE"]);
  });

  it("thứ tự tất định: theo tầng (QC, SALE_ADMIN, SALE, QL_TT) rồi theo người", () => {
    const { dong } = soBaCot([], [], [d("QL_TT", "Z", 1), d("SALE", "B", 1), d("SALE", "A", 1), d("QC", "M", 1)]);
    expect(dong.map((x) => `${x.tier}:${x.recipientId}`)).toEqual(["QC:M", "SALE:A", "SALE:B", "QL_TT:Z"]);
  });
});

describe("[NHH-D8-EXP] phanTichSoDuyet — `--expect=<N>` chỉ nhận chuỗi chữ số thập phân (M6)", () => {
  it("không truyền ⇒ null; chữ số thuần ⇒ số nguyên (kể cả 0)", () => {
    expect(phanTichSoDuyet([])).toBeNull();
    expect(phanTichSoDuyet(["--ghi"])).toBeNull();
    expect(phanTichSoDuyet(["--expect=2"])).toBe(2);
    expect(phanTichSoDuyet(["--expect=0"])).toBe(0);
    expect(phanTichSoDuyet(["--ghi", "--expect=137", "--x"])).toBe(137);
  });

  // Lỗ cũ (`Number(chuỗi)`): '' ⇒ 0 · '0x2' ⇒ 2 · '1e1' ⇒ 10 · ' 2' ⇒ 2 · '2 ' ⇒ 2 · '0b11' ⇒ 3 · '.5e1' ⇒ 5.
  it.each([
    ["rỗng", "--expect="],
    ["thập lục phân", "--expect=0x2"],
    ["mũ", "--expect=1e1"],
    ["âm", "--expect=-1"],
    ["chữ", "--expect=abc"],
    ["khoảng trắng đầu", "--expect= 2"],
    ["khoảng trắng cuối", "--expect=2 "],
    ["dấu cộng", "--expect=+2"],
    ["số thực", "--expect=2.0"],
    ["nhị phân", "--expect=0b11"],
    ["chữ số không phải ASCII", "--expect=٢"],
    ["quá lớn không biểu diễn chính xác", "--expect=99999999999999999999"],
  ])("%s (%s) ⇒ NaN — KHÔNG bị hiểu thành một số", (_ten, a) => {
    expect(Number.isNaN(phanTichSoDuyet([a]))).toBe(true);
  });

  it("NaN bị cổng ghi từ chối bằng đúng câu ``--expect``, không rơi sang so với kế hoạch", () => {
    const loi = (soDuyet: number | null) =>
      quyetDinhGhiNoiDon({ soDuyet, keHoach: 0, ghiDuoc: true, trangThaiKy: [] });
    // Đối chứng dương: 0 hợp lệ khi kế hoạch = 0 — hai cổng KHÔNG nhầm "0" với "rỗng".
    expect(loi(phanTichSoDuyet(["--expect=0"]))).toEqual({ ok: true });
    for (const a of ["--expect=", "--expect=0x0", "--expect=0e0"]) {
      const r = loi(phanTichSoDuyet([a]));
      expect(r.ok, a).toBe(false);
      expect(!r.ok && r.loi, a).toContain("`--expect=<N>`");
    }
  });
});
