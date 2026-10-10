/**
 * Ca [NHH-SRC-12] · [NHH-SRC-19a] · [NHH-SRC-19b] · [NHH-SRC-19d] — ánh xạ 28 nhãn cũ → 8 nguồn mặc định + UNKNOWN
 * (07 §2.6.2, §3.2). Mọi ngày là TUYỆT ĐỐI (luật 19) — không đọc đồng hồ thật.
 */
import { describe, expect, it } from "vitest";
import {
  BANG_ANH_XA_0610,
  MOC_KHAO_SAT_0610,
  MOC_NGUOI_NHAP,
  anhXaNhanCu,
  chuanHoaNhanNguon,
  dungBangTra,
  tomTatDiTru,
  type HangDiTru,
  type KetQuaAnhXa,
  type LuatNhan,
} from "./anh-xa-nhan-cu";
import { DANH_MUC_GOC, VAI_SANG_NGUON_MAC_DINH, type MaNhomGoc, type MaVaiNguon } from "./danh-muc-goc";

/** Phiếu tạo TRƯỚC mọi mốc — nơi bảng 28 dòng có hiệu lực nguyên vẹn. */
const TRUOC_MOC = new Date("2026-09-15T03:00:00.000Z");

const chay = (
  nhan: string | null,
  createdAt: Date = TRUOC_MOC,
  phu: Partial<Parameters<typeof anhXaNhanCu>[0]> = {},
): KetQuaAnhXa =>
  anhXaNhanCu(
    { nhan, createdAt, affiliate: null, nguoiNhap: null, maNvTrongNote: null, ...phu },
    VAI_SANG_NGUON_MAC_DINH,
    "EMPLOYEE_REFERRAL",
  );

/**
 * Bảng 28 dòng của văn bản 06/10 — chép NGUYÊN VĂN nhãn, độc lập với mã (đối chiếu hai chiều). Đích đã đổi sang DANH MỤC MỚI
 * (SPEC nguồn động 09/10/2026 §1.3): bốn nhóm nhân sự → `EMPLOYEE_REFERRAL` kèm VAI (ghi `referrerRoleCode`); nhóm quảng cáo cũ →
 * `PAID_ADS`; hai nhãn Organic (#15, #17) → `CENTER_ORGANIC` (ĐẢO bảng 06/10 theo yêu cầu 09/10 của chủ dự án).
 */
const BANG_28: readonly [number, string, MaNhomGoc, MaVaiNguon | null][] = [
  [1, "Quản Lý Trung Tâm", "EMPLOYEE_REFERRAL", "MANAGER"],
  [2, "legacy-sheet", "PAID_ADS", null],
  [3, "Nguồn từ Marketing Hội Sở từ Quảng Cáo", "PAID_ADS", null],
  [4, "Nguồn từ Ban lãnh đạo công ty", "EMPLOYEE_REFERRAL", "MANAGER"],
  [5, "quatang", "PAID_ADS", null], // THEO_AFF, không aff
  [6, "Ads", "PAID_ADS", null],
  [7, "sale-form", "PAID_ADS", null], // THEO_NGUOI_NHAP, trước 01/10
  [8, "Quản lý trung tâm", "EMPLOYEE_REFERRAL", "MANAGER"],
  [9, "covua.quatang.edu.vn", "PAID_ADS", null], // THEO_AFF, không aff
  [10, "Khác", "EMPLOYEE_REFERRAL", "SALE"],
  [11, "Giới thiệu", "PARENT_REFERRAL", null],
  [12, "sale-form-app", "PAID_ADS", null], // THEO_NGUOI_NHAP, trước 01/10
  [13, "Form", "PAID_ADS", null],
  [14, "Nguồn khác", "EMPLOYEE_REFERRAL", "MANAGER"],
  [15, "Organic", "CENTER_ORGANIC", null],
  [16, "Website", "WALK_IN", null],
  [17, "Nguồn từ Marketing Hội Sở từ Organic", "CENTER_ORGANIC", null],
  [18, "Sale tự kiếm", "EMPLOYEE_REFERRAL", "SALE"],
  [19, "Nguồn từ Sale tự kiếm", "EMPLOYEE_REFERRAL", "SALE"],
  [20, "Quản lý Trung Tâm", "EMPLOYEE_REFERRAL", "MANAGER"],
  [21, "Con cổ đông", "EMPLOYEE_REFERRAL", "MANAGER"],
  [22, "Nhập tay", "EMPLOYEE_REFERRAL", "MANAGER"],
  [23, "Tự khai thác", "EMPLOYEE_REFERRAL", "SALE"],
  [24, "lead cũ khi làm bên LTN gọi học trải nghiệm 5 buổi", "EMPLOYEE_REFERRAL", "MANAGER"],
  [25, "Nguồn từ phụ huynh giới thiệu", "PARENT_REFERRAL", null],
  [26, "Import Excel ĐK", "EMPLOYEE_REFERRAL", "MANAGER"],
  [27, "lien-he", "WALK_IN", null],
  [28, "Nguồn KH tự đến Trung Tâm", "WALK_IN", null],
];

describe("[NHH-SRC-19a] 28 nhãn NGUYÊN VĂN → đúng nguồn", () => {
  it("BANG_ANH_XA_0610 đúng 28 dòng, đúng thứ tự và chữ của văn bản", () => {
    expect(BANG_ANH_XA_0610).toHaveLength(28);
    expect(BANG_ANH_XA_0610.map((d) => [d.stt, d.nhan])).toEqual(BANG_28.map(([s, n]) => [s, n]));
  });

  it.each(BANG_28)("#%i %s → %s (vai %s)", (_stt, nhan, mong, vai) => {
    const kq = chay(nhan);
    expect(kq.loai).not.toBe("INVALID");
    if (kq.loai === "INVALID") return;
    expect(kq.nhom).toBe(mong);
    expect(kq.loai).toBe("MAPPED");
    // Vai của người giới thiệu là SNAPSHOT: nhãn nhân sự mang vai cố định (di trú ghi `referrerRoleCode`), nhãn khác thì null.
    expect(kq.vaiNguon).toBe(vai);
  });

  it("mọi đích của bảng 28 dòng nằm trong DANH MỤC 9 dòng; MỌI đích nhân sự đều là EMPLOYEE_REFERRAL (bốn mã cũ không còn)", () => {
    const hopLe = new Set<string>(DANH_MUC_GOC.map((d) => d.code));
    for (const [stt, nhan, dich] of BANG_28) expect(hopLe.has(dich), `#${stt} ${nhan}`).toBe(true);
    expect(new Set(BANG_28.filter(([, , , v]) => v !== null).map(([, , d]) => d))).toEqual(new Set(["EMPLOYEE_REFERRAL"]));
    // Đảo bảng 06/10: Organic không còn vào quảng cáo (đối chứng dương: Ads vẫn vào quảng cáo).
    expect(BANG_28.filter(([, , d]) => d === "CENTER_ORGANIC").map(([s]) => s)).toEqual([15, 17]);
    expect(BANG_28.filter(([, , d]) => d === "PAID_ADS").map(([s]) => s)).toEqual([2, 3, 5, 6, 7, 9, 12, 13]);
  });

  it("ba cách viết 'quản lý trung tâm' cùng ra EMPLOYEE_REFERRAL/MANAGER; câu kể #24 khớp", () => {
    for (const n of ["Quản Lý Trung Tâm", "Quản lý trung tâm", "Quản lý Trung Tâm", "  QUẢN  LÝ trung tâm "]) {
      const kq = chay(n);
      expect(kq.loai === "INVALID" ? "INVALID" : [kq.nhom, kq.vaiNguon], n).toEqual(["EMPLOYEE_REFERRAL", "MANAGER"]);
    }
    const k24 = chay("lead cũ khi làm bên LTN gọi học trải nghiệm 5 buổi");
    expect(k24.loai === "INVALID" ? null : k24.stt).toBe(24);
  });

  it("nhãn Unicode DỰNG SẴN (NFC) và TỔ HỢP (NFD) cho CÙNG một đích — bảng tính xuất ra hay là NFD", () => {
    const nfc = "Quản Lý Trung Tâm".normalize("NFC");
    const nfd = "Quản Lý Trung Tâm".normalize("NFD");
    expect(nfd).not.toBe(nfc); // fixture phải thật sự khác nhau, nếu không ca này vô nghĩa
    for (const n of [nfc, nfd]) {
      const kq = chay(n);
      expect(kq.loai === "INVALID" ? "INVALID" : kq.nhom, n).toBe("EMPLOYEE_REFERRAL");
    }
  });

  it("bảng tra có đúng 26 khoá cho 28 dòng, nạp không ném", () => {
    const bang = dungBangTra(BANG_ANH_XA_0610);
    expect(bang.size).toBe(26);
    expect(bang.get(chuanHoaNhanNguon("QUẢN LÝ TRUNG TÂM")!)?.luat).toEqual({
      kieu: "CO_DINH",
      nhom: "EMPLOYEE_REFERRAL",
      vai: "MANAGER",
    });
  });

  it("null / '' / '   ' ⇒ UNKNOWN (không INVALID), không người", () => {
    for (const v of [null, "", "   "]) {
      const kq = chay(v);
      expect(kq.loai, String(v)).toBe("UNKNOWN");
      if (kq.loai === "INVALID") continue;
      expect(kq.nhom).toBe("UNKNOWN");
      expect(kq.stt).toBeNull();
      expect(kq.nguoi).toBeNull();
      expect(kq.xemTay).toEqual([]);
    }
  });

  it("nhãn ngoài 28 dòng ⇒ INVALID (không đoán) — kể cả nhãn nghe hợp lý", () => {
    const kq = chay("Nguồn từ sự kiện");
    expect(kq).toEqual({ loai: "INVALID", nhanChuan: "nguồn từ sự kiện" });
  });

  it("quatang: không aff ⇒ PAID_ADS; có aff (chưa phân loại) ⇒ UNKNOWN + AFF_CHUA_PHAN_LOAI", () => {
    const khong = chay("quatang");
    expect(khong.loai === "INVALID" ? null : khong.nhom).toBe("PAID_ADS");
    const co = chay("quatang", TRUOC_MOC, { affiliate: { ton: true, loai: null } });
    expect(co.loai).toBe("UNKNOWN");
    if (co.loai === "INVALID") return;
    expect(co.nhom).toBe("UNKNOWN");
    expect(co.xemTay).toEqual(["AFF_CHUA_PHAN_LOAI"]);
    // aff KHÔNG tồn tại (id treo) ⇒ coi như không có aff: PAID_ADS, không xem tay.
    const treo = chay("quatang", TRUOC_MOC, { affiliate: { ton: false, loai: null } });
    expect(treo.loai === "INVALID" ? null : [treo.nhom, treo.xemTay]).toEqual(["PAID_ADS", []]);
    // Luật theo loại aff thuộc PR11 — dùng sớm là NÉM, không đoán.
    expect(() => chay("quatang", TRUOC_MOC, { affiliate: { ton: true, loai: "CA_NHAN" } })).toThrow(/PR11/);
  });

  it("nhóm cần người mà di trú không bao giờ tự gán ⇒ referrerMissing + THIEU_NGUOI", () => {
    const k = chay("Khác"); // #10 → EMPLOYEE_REFERRAL (vai SALE; trước mốc khảo sát)
    expect(k.loai === "INVALID" ? null : [k.nhom, k.referrerMissing, k.xemTay, k.nguoi]).toEqual([
      "EMPLOYEE_REFERRAL",
      true,
      ["THIEU_NGUOI"],
      null,
    ]);
    const p = chay("Giới thiệu");
    expect(p.loai === "INVALID" ? null : [p.referrerMissing, p.xemTay]).toEqual([true, ["THIEU_NGUOI"]]);
    // Đối chứng: nhóm KHÔNG cần người thì sạch.
    const w = chay("Website");
    expect(w.loai === "INVALID" ? null : [w.referrerMissing, w.xemTay]).toEqual([false, []]);
  });

  it("sale-form-app SAU mốc, không giải được người ⇒ OTHER + giải trình ≥10 ký tự + MA_NV_KHONG_GIAI", () => {
    const sau = new Date("2026-10-01T10:22:40.000Z");
    const kq = chay("sale-form-app", sau, { maNvTrongNote: "CS2.TTS.008" });
    expect(kq.loai).toBe("MAPPED");
    if (kq.loai === "INVALID") return;
    expect(kq.nhom).toBe("OTHER");
    expect(kq.giaiTrinh ?? "").toContain("CS2.TTS.008");
    expect((kq.giaiTrinh ?? "").length).toBeGreaterThanOrEqual(10);
    expect(kq.xemTay).toEqual(["MA_NV_KHONG_GIAI"]);
    expect(kq.nguoi).toBeNull();
    // Không có cả mã lẫn ID ⇒ vẫn có giải trình ≥ 10 ký tự.
    const khongMa = chay("sale-form-app", sau);
    expect(khongMa.loai === "INVALID" ? "" : khongMa.giaiTrinh ?? "").toMatch(/không có mã\/ID người nhập/);
  });

  it("vai chỉ suy được từ HIỆN TẠI ⇒ nhóm EMPLOYEE_REFERRAL + vai ghi lại + VAI_SUY_TU_HIEN_TAI (PB-12)", () => {
    const sau = new Date("2026-10-02T03:00:00.000Z");
    const kq = chay("sale-form-app", sau, {
      nguoiNhap: { employeeId: "E_X", roleCodes: ["TEACHER"], vaiTuHienTai: true },
    });
    expect(kq.loai === "INVALID" ? null : [kq.nhom, kq.vaiNguon, kq.xemTay, kq.nguoi]).toEqual([
      "EMPLOYEE_REFERRAL",
      "TEACHER",
      ["VAI_SUY_TU_HIEN_TAI"],
      { kind: "EMPLOYEE", employeeId: "E_X" },
    ]);
  });
});

describe("[NHH-SRC-12] mốc 01/10/2026 00:00 giờ VN cho nhãn máy (D12)", () => {
  it("MOC_NGUOI_NHAP = 2026-09-30T17:00:00.000Z", () => {
    expect(MOC_NGUOI_NHAP.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("sale-form 16:59:59.999Z ⇒ PAID_ADS không người; 17:00:00.000Z + nguoiNhap CSKH ⇒ EMPLOYEE_REFERRAL (vai SALE) + EMPLOYEE", () => {
    const truoc = chay("sale-form", new Date("2026-09-30T16:59:59.999Z"), {
      nguoiNhap: { employeeId: "E_CSKH", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
    });
    expect(truoc.loai === "INVALID" ? null : [truoc.nhom, truoc.nguoi, truoc.vaiNguon]).toEqual(["PAID_ADS", null, null]);
    const sau = chay("sale-form", new Date("2026-09-30T17:00:00.000Z"), {
      nguoiNhap: { employeeId: "E_CSKH", roleCodes: ["CENTER_SALES_CSM"], vaiTuHienTai: false },
    });
    expect(sau.loai === "INVALID" ? null : [sau.nhom, sau.vaiNguon, sau.nguoi, sau.referrerMissing, sau.xemTay]).toEqual([
      "EMPLOYEE_REFERRAL",
      "SALE",
      { kind: "EMPLOYEE", employeeId: "E_CSKH" },
      false,
      [],
    ]);
  });
});

describe("[NHH-SRC-19d] dungBangTra + mốc khảo sát của #10/#14/#22 (PB-9, PB-24)", () => {
  const hai = (luatB: LuatNhan) => [
    { stt: 1, nhan: "Quản lý trung tâm", luat: { kieu: "CO_DINH", nhom: "EMPLOYEE_REFERRAL", vai: "MANAGER" } as LuatNhan },
    { stt: 2, nhan: "QUẢN LÝ TRUNG TÂM", luat: luatB },
  ];

  it("hai dòng cùng khoá chuẩn hoá mà KHÁC luật ⇒ ném; cùng luật ⇒ gộp một khoá", () => {
    expect(() => dungBangTra(hai({ kieu: "CO_DINH", nhom: "PAID_ADS" }))).toThrow();
    // Cùng nhóm mà KHÁC VAI cũng là mâu thuẫn: vai là thứ được ghi vào `referrerRoleCode`.
    expect(() => dungBangTra(hai({ kieu: "CO_DINH", nhom: "EMPLOYEE_REFERRAL", vai: "SALE" }))).toThrow();
    const bang = dungBangTra(hai({ kieu: "CO_DINH", nhom: "EMPLOYEE_REFERRAL", vai: "MANAGER" }));
    expect(bang.size).toBe(1);
  });

  it("MOC_KHAO_SAT_0610 = 2026-10-06T09:21:00.000Z", () => {
    expect(MOC_KHAO_SAT_0610.toISOString()).toBe("2026-10-06T09:21:00.000Z");
  });

  it.each([
    ["Khác", "SALE"],
    ["Nguồn khác", "MANAGER"],
    ["Nhập tay", "MANAGER"],
  ] as const)("%s: trước mốc ⇒ EMPLOYEE_REFERRAL (vai %s); từ mốc ⇒ OTHER + NHAN_CHOT_THEO_PHIEU", (nhan, vai) => {
    const truoc = chay(nhan, new Date("2026-10-06T09:20:59.999Z"));
    expect(truoc.loai === "INVALID" ? null : [truoc.nhom, truoc.vaiNguon, truoc.xemTay.includes("NHAN_CHOT_THEO_PHIEU")]).toEqual([
      "EMPLOYEE_REFERRAL",
      vai,
      false,
    ]);
    const sau = chay(nhan, new Date("2026-10-06T09:21:00.000Z"));
    expect(sau.loai).toBe("MAPPED");
    if (sau.loai === "INVALID") return;
    expect(sau.nhom).toBe("OTHER");
    expect(sau.xemTay).toEqual(["NHAN_CHOT_THEO_PHIEU"]);
    expect((sau.giaiTrinh ?? "").length).toBeGreaterThanOrEqual(10);
    expect(sau.giaiTrinh).toContain(nhan);
    expect(sau.nguoi).toBeNull();
    expect(sau.vaiNguon).toBeNull(); // OTHER + xem tay: KHÔNG đoán vai
    expect(sau.referrerMissing).toBe(false);
  });

  it("đối chứng: nhãn CO_DINH thường ('Ads') SAU mốc vẫn PAID_ADS, không xem tay", () => {
    const kq = chay("Ads", new Date("2026-10-07T00:00:00.000Z"));
    expect(kq.loai === "INVALID" ? null : [kq.nhom, kq.xemTay]).toEqual(["PAID_ADS", []]);
  });
});

describe("[NHH-SRC-19b] tomTatDiTru — sáu nhóm là PHÂN HOẠCH", () => {
  const hang = (leadId: string, kq: KetQuaAnhXa, createdAt: Date = TRUOC_MOC): HangDiTru => ({
    leadId,
    kq,
    nhanChuan: kq.loai === "INVALID" ? kq.nhanChuan : "x",
    createdAt,
  });
  const mapped = (nhom: MaNhomGoc, xemTay: ("THIEU_NGUOI" | "MA_NV_KHONG_GIAI")[] = []): KetQuaAnhXa => ({
    loai: "MAPPED",
    nhom,
    stt: 1,
    nguoi: null,
    vaiNguon: null,
    referrerMissing: false,
    giaiTrinh: null,
    xemTay,
  });
  const rows: HangDiTru[] = [
    hang("L1", { loai: "INVALID", nhanChuan: "la" }),
    hang("L2", mapped("PAID_ADS")),
    hang("L3", mapped("PARENT_REFERRAL", ["THIEU_NGUOI"])), // vừa Duplicate vừa ManualReview
    hang("L4", mapped("PARENT_REFERRAL", ["THIEU_NGUOI"])),
    hang("L5", { loai: "UNKNOWN", nhom: "UNKNOWN", stt: null, nguoi: null, vaiNguon: null, referrerMissing: false, giaiTrinh: null, xemTay: [] }),
    hang("L6", mapped("WALK_IN"), new Date("2026-10-07T00:00:00.000Z")), // SAU mốc khảo sát
  ];

  it("cộng sáu nhóm = total; seGhi = total − invalid; Duplicate thắng ManualReview", () => {
    const t = tomTatDiTru(rows, new Set(["L3", "L2"]));
    expect(t.total).toBe(6);
    expect(t.invalid).toBe(1);
    expect(t.duplicate).toBe(2); // L2 + L3 — L3 còn xem tay nhưng Duplicate đứng trước
    expect(t.manualReview).toBe(1); // L4
    expect(t.unknown).toBe(1); // L5
    expect(t.mapped).toBe(1); // L6
    expect(t.mapped + t.unknown + t.invalid + t.duplicate + t.manualReview).toBe(t.total);
    expect(t.seGhi).toBe(5);
  });

  it("theoDich đếm CẢ dòng Duplicate/ManualReview, bỏ dòng Invalid; cắt đúng mốc khảo sát", () => {
    const t = tomTatDiTru(rows, new Set(["L3", "L2"]));
    expect(t.theoDich.PAID_ADS).toBe(1);
    expect(t.theoDich.PARENT_REFERRAL).toBe(2);
    expect(t.theoDich.WALK_IN).toBe(1);
    expect(t.theoDich.UNKNOWN).toBe(1);
    // WALK_IN do L6 tạo sau mốc ⇒ không nằm ở bảng "trước mốc".
    expect(t.theoDichTruocMocKhaoSat.WALK_IN).toBe(0);
    expect(t.theoDichTruocMocKhaoSat.PARENT_REFERRAL).toBe(2);
  });

  it("[F3] xemTayTheoLyDo đếm SAU phân hoạch: dòng Duplicate (L3) KHÔNG góp lý do; tổng = manualReview khi mỗi dòng một lý do", () => {
    const t = tomTatDiTru(rows, new Set(["L3", "L2"]));
    // L3 (THIEU_NGUOI) là Duplicate ⇒ không đếm; chỉ L4 là ManualReview.
    expect(t.xemTayTheoLyDo.THIEU_NGUOI).toBe(1);
    const tong = Object.values(t.xemTayTheoLyDo).reduce((a, b) => a + b, 0);
    expect(tong).toBe(t.manualReview);
    // Đối chứng dương: không trùng SĐT ⇒ cả L3 lẫn L4 là ManualReview, và lý do khớp.
    const t2 = tomTatDiTru(rows, new Set());
    expect(t2.manualReview).toBe(2);
    expect(t2.xemTayTheoLyDo.THIEU_NGUOI).toBe(2);
  });

  it("[M3] phiếu #10/#14/#22 SAU mốc mà trùng SĐT ⇒ MANUAL_REVIEW (không ghi tự động), KHÔNG Duplicate — kq lấy từ anhXaNhanCu THẬT", () => {
    // Đầu vào đi qua ĐÚNG đường thật (nhãn → anhXaNhanCu) thay vì gõ tay `xemTay` (luật 9 của docs/luat-doc-so-va-ket-luan).
    const SAU_MOC = new Date("2026-10-06T09:21:00.000Z");
    const chot = (nhan: string, id: string) => {
      const kq = chay(nhan, SAU_MOC);
      return hang(id, kq, SAU_MOC);
    };
    const A = chot("Khác", "A"); // #10 sau mốc ⇒ OTHER + NHAN_CHOT_THEO_PHIEU
    const B = chot("Nhập tay", "B"); // #22
    const C = hang("C", mapped("PARENT_REFERRAL", ["THIEU_NGUOI"])); // Duplicate thường: vẫn ghi (03 §7.1)
    const D = hang("D", mapped("PAID_ADS"));
    const E = hang("E", { loai: "INVALID", nhanChuan: "la" });
    // Đối chứng: xác nhận đầu vào THẬT mang đúng cờ — nếu không thì các khẳng định dưới trống rỗng.
    for (const h of [A, B]) {
      expect(h.kq.loai === "INVALID" ? null : [h.kq.nhom, h.kq.xemTay]).toEqual(["OTHER", ["NHAN_CHOT_THEO_PHIEU"]]);
    }
    const t = tomTatDiTru([A, B, C, D, E], new Set(["A", "B", "C", "D"]));
    expect(t.manualReview).toBe(2); // A + B — chỉ vì D21; KHÔNG vì trùng SĐT
    expect(t.duplicate).toBe(2); // C (THIEU_NGUOI: Duplicate vẫn thắng — hành vi cũ giữ nguyên) + D
    expect(t.invalid).toBe(1);
    expect(t.mapped + t.unknown + t.invalid + t.duplicate + t.manualReview).toBe(t.total);
    // SẼ GHI giữ nguyên định nghĩa (H21 còn mở): total − invalid. Số phiếu mặc định KHÔNG ghi tự động đọc từ xemTayTheoLyDo.
    expect(t.seGhi).toBe(t.total - t.invalid);
    expect(t.xemTayTheoLyDo.NHAN_CHOT_THEO_PHIEU).toBe(2);
    // Hai phiếu ấy đồng thời trùng SĐT — báo cáo phải nói được con số này (chúng KHÔNG còn ở mục Duplicate).
    expect(t.manualReviewTrungSdt).toBe(2);
    // Đối chứng dương: cùng hai phiếu, KHÔNG trùng SĐT ⇒ vẫn ManualReview, và con số trùng là 0.
    const t2 = tomTatDiTru([A, B, C, D, E], new Set(["C", "D"]));
    expect(t2.manualReview).toBe(2);
    expect(t2.duplicate).toBe(2);
    expect(t2.manualReviewTrungSdt).toBe(0);
  });

  it("[F3] một dòng NHIỀU lý do được đếm ở MỖI lý do (tổng lý do > manualReview) — cách đếm được ghi trong báo cáo", () => {
    const t = tomTatDiTru([hang("M1", mapped("PARENT_REFERRAL", ["THIEU_NGUOI", "MA_NV_KHONG_GIAI"]))], new Set());
    expect(t.manualReview).toBe(1);
    expect(t.xemTayTheoLyDo.THIEU_NGUOI).toBe(1);
    expect(t.xemTayTheoLyDo.MA_NV_KHONG_GIAI).toBe(1);
    // Dòng Duplicate nhiều lý do: không góp gì.
    const t2 = tomTatDiTru([hang("M1", mapped("PARENT_REFERRAL", ["THIEU_NGUOI", "MA_NV_KHONG_GIAI"]))], new Set(["M1"]));
    expect(Object.values(t2.xemTayTheoLyDo).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("[NHH-SRC-19e] theoNhan — mỗi dòng (nhãn × đích) nói được AUTO hay MANUAL_REVIEW (bảng báo cáo di trú)", () => {
  const hang = (leadId: string, nhan: string, createdAt: Date = TRUOC_MOC): HangDiTru => ({
    leadId,
    kq: chay(nhan, createdAt),
    nhanChuan: chuanHoaNhanNguon(nhan),
    createdAt,
  });

  it("nhãn không cần người ⇒ toàn AUTO; nhãn cần người ⇒ toàn xem tay; đếm đủ từng nhãn", () => {
    const t = tomTatDiTru(
      [hang("A1", "Ads"), hang("A2", "Ads"), hang("W1", "Website"), hang("E1", "Sale tự kiếm"), hang("E2", "Sale tự kiếm"), hang("P1", "Giới thiệu")],
      new Set(),
    );
    const dong = (nhan: string) => t.theoNhan.find((r) => r.nhanChuan === chuanHoaNhanNguon(nhan))!;
    expect([dong("Ads").nhom, dong("Ads").soLead, dong("Ads").soXemTay]).toEqual(["PAID_ADS", 2, 0]);
    expect([dong("Website").nhom, dong("Website").soLead, dong("Website").soXemTay]).toEqual(["WALK_IN", 1, 0]);
    // Đối chứng dương: nhãn cần NGƯỜI mà nhãn cũ không mang người ⇒ MỌI lead của dòng là xem tay.
    expect([dong("Sale tự kiếm").nhom, dong("Sale tự kiếm").soLead, dong("Sale tự kiếm").soXemTay]).toEqual(["EMPLOYEE_REFERRAL", 2, 2]);
    expect([dong("Giới thiệu").nhom, dong("Giới thiệu").soXemTay]).toEqual(["PARENT_REFERRAL", 1]);
    // Tổng soXemTay = số lead có lý do xem tay — độc lập với việc lead đó rơi vào nhóm phân hoạch nào.
    expect(t.theoNhan.reduce((a, r) => a + r.soXemTay, 0)).toBe(3);
  });

  it("dòng INVALID không có xem tay (soXemTay = 0) — nhãn lạ đứng riêng", () => {
    const h: HangDiTru = { leadId: "I1", kq: { loai: "INVALID", nhanChuan: "la" }, nhanChuan: "la", createdAt: TRUOC_MOC };
    const t = tomTatDiTru([h], new Set());
    expect(t.theoNhan).toEqual([{ nhanChuan: "la", stt: null, nhom: "INVALID", soLead: 1, soXemTay: 0 }]);
  });
});
