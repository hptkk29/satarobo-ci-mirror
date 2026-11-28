import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { datHomNay } from "@/lib/suc-khoe/dong-co-goc";
import { KHAO_SAT_CONG } from "@/lib/suc-khoe/khao-sat-cong";
import { KHUON_KET_QUA } from "@/lib/suc-khoe/khuon-ket-qua";
import { kiemBan, TOI_DA_BAN, TOI_DA_NGUOI_CONG } from "@/lib/suc-khoe/so-cong";

import { kiemCheDoHocSinh } from "../che-do-hoc-sinh-thuan";
import { LoiApiMobile } from "../xac-thuc/dich-vu";
import { danhGiaSucKhoe, danhGiaSucKhoeSchema, KHOANG_SO_DO, layNoiDungSucKhoe, motSucKhoeTat } from "./suc-khoe";

/**
 * [SKM] V8.23 — «Sức khoẻ cả nhà» / «Khảo sát thói quen» trên app: kiểm THUẦN (không DB, không HTTP).
 * Đồng hồ đóng băng ở 2026-11-21 (luật 19: test không đọc đồng hồ thật). Mọi số mong đợi tính tay ở chú thích từng ca.
 */
const HOM_NAY = "2026-11-21";

beforeEach(() => {
  process.env.SUC_KHOE_ENABLED = "true";
  datHomNay(HOM_NAY);
});
afterEach(() => {
  delete process.env.SUC_KHOE_ENABLED;
  datHomNay(null);
});

type Ban = { ngay: string; chieuCaoCm: number; canNangKg: number; vongEoCm?: number | null };
const nguoi = (o: Record<string, unknown> = {}) => ({
  ma: "ba",
  ngaySinh: "1990-01-01",
  gioiTinh: "nam",
  soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 65 }] as Ban[],
  ...o,
});
const parse = (nguoiDs: unknown[]) => danhGiaSucKhoeSchema.safeParse({ nguoi: nguoiDs });
const tinh = (o: Record<string, unknown> = {}) => {
  const p = parse([nguoi(o)]);
  if (!p.success) throw new Error(`lược đồ từ chối: ${JSON.stringify(p.error.issues)}`);
  return danhGiaSucKhoe(p.data).nguoi[0]!;
};

describe("[SKM-01] nội dung tham chiếu", () => {
  it("bộ câu khảo sát: đủ số câu như nguồn, chỉ số liền mạch, kiểu MOT/NHIEU đúng, không có trường thừa", () => {
    const nd = layNoiDungSucKhoe();
    expect(nd.khaoSat.tre).toHaveLength(KHAO_SAT_CONG.tre.length);
    expect(nd.khaoSat.nguoiLon).toHaveLength(KHAO_SAT_CONG.lon.length);
    expect(nd.khaoSat.tre.length).toBeGreaterThan(0);
    for (const ds of [nd.khaoSat.tre, nd.khaoSat.nguoiLon]) {
      ds.forEach((c, i) => {
        expect(c.chiSo).toBe(i);
        expect(c.luaChon.length).toBeGreaterThanOrEqual(2);
        expect(["MOT", "NHIEU"]).toContain(c.kieu);
        expect(Object.keys(c).sort()).toEqual(["cau", "chiSo", "ghiChu", "kieu", "luaChon", "maLinhVuc", "nhanNhom"]);
      });
    }
    // nguyên văn: giữ {ten}, kiểu 2 ⇒ NHIEU, ghi chú rỗng ⇒ null
    expect(nd.khaoSat.tre[0]!.cau).toContain("{ten}");
    expect(nd.khaoSat.tre.filter((c) => c.kieu === "NHIEU")).toHaveLength(KHAO_SAT_CONG.tre.filter((c) => c[3] === 2).length);
    expect(nd.khaoSat.tre[2]!.ghiChu).toBe(KHAO_SAT_CONG.tre[2]![5]);
    expect(nd.khaoSat.tre[0]!.ghiChu).toBeNull();
  });

  it("khuôn lời khuyên: đủ 6 khuôn, chữ y nguyên nguồn, tuần có/không đúng như nguồn; JSON-an toàn", () => {
    const nd = layNoiDungSucKhoe();
    expect(Object.keys(nd.khuon).sort()).toEqual(Object.keys(KHUON_KET_QUA).sort());
    for (const [ten, k] of Object.entries(KHUON_KET_QUA)) {
      const d = nd.khuon[ten as keyof typeof nd.khuon];
      expect(d.loiChao).toBe(k.loiChao);
      expect(d.giaiThich).toBe(k.giaiThich);
      expect(d.thuThach).toEqual([...k.thuThach]);
      expect(d.anUong.muc).toHaveLength(k.anUong.muc.length);
      expect(d.vanDong.tuan === null).toBe(k.vanDong.tuan === undefined);
    }
    expect(JSON.parse(JSON.stringify(nd))).toEqual(nd);
  });

  it("giới hạn lấy từ miền (không gõ lại)", () => {
    const nd = layNoiDungSucKhoe();
    expect(nd.gioiHan).toEqual({ toiDaNguoi: TOI_DA_NGUOI_CONG, toiDaBanMoiNguoi: TOI_DA_BAN, soCauThuThach: 3 });
    expect([TOI_DA_NGUOI_CONG, TOI_DA_BAN]).toEqual([6, 3]);
  });

  it("có dòng lưu ý chưa thẩm định y khoa", () => {
    expect(layNoiDungSucKhoe().luuY).toContain("chưa qua thẩm định y khoa");
  });
});

describe("[SKM-02] cờ SUC_KHOE_ENABLED", () => {
  it("tắt (mặc định) ⇒ cả hai hàm dịch vụ ném 404 NOT_FOUND; chỉ đúng chuỗi 'true' mới bật", () => {
    for (const v of [undefined, "false", "TRUE", "1", ""]) {
      if (v === undefined) delete process.env.SUC_KHOE_ENABLED;
      else process.env.SUC_KHOE_ENABLED = v;
      for (const chay of [() => layNoiDungSucKhoe(), () => danhGiaSucKhoe({ nguoi: [] })]) {
        let e: unknown;
        try {
          chay();
        } catch (x) {
          e = x;
        }
        expect(e, `cờ=${String(v)}`).toBeInstanceOf(LoiApiMobile);
        expect([(e as LoiApiMobile).code, (e as LoiApiMobile).status]).toEqual(["NOT_FOUND", 404]);
      }
    }
  });

  it("cổng của route: tắt ⇒ phản hồi 404 no-store; bật ⇒ null", async () => {
    delete process.env.SUC_KHOE_ENABLED;
    const r = motSucKhoeTat();
    expect(r?.status).toBe(404);
    expect(r?.headers.get("cache-control")).toBe("no-store");
    expect(((await r!.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
    process.env.SUC_KHOE_ENABLED = "true";
    expect(motSucKhoeTat()).toBeNull();
  });
});

describe("[SKM-03] đánh giá — kết quả đúng các hàm của miền (tính tay)", () => {
  it("nam 36 tuổi 170 cm / 65 kg: BMI 22,5 · bình thường · khuôn nl-binh-thuong · 2.380 kcal", () => {
    // BMI = 65 / 1,7² = 22,49 ⇒ 22,5 (< 23 ⇒ «Bình thường»). BMR = 650 + 1062,5 − 5×36 + 5 = 1537,5; × 1,55 = 2383,1 ⇒ làm tròn chục = 2380.
    const k = tinh();
    expect(k.tuoi).toEqual({ thang: 442, nhom: "nl", laTreEm: false });
    expect(k.soDo[0]!.bmi).toBe(22.5);
    expect(k.phanLoaiBmi).toEqual({ ma: "ok", ten: "Bình thường (châu Á)" });
    expect(k.khuon).toBe("nl-binh-thuong");
    expect(k.nangLuongUocTinhKcal).toBe(2380);
    expect(k.soVoiBanTruoc).toBeNull();
    expect(k.lonThemTuBanDau).toBeNull();
  });

  it("mức vận động đổi hệ số năng lượng (it 1,2 · nhieu 1,725)", () => {
    expect(tinh({ hoatDong: "it" }).nangLuongUocTinhKcal).toBe(1850); // 1537,5 × 1,2 = 1845 ⇒ 1850 (1845/10 = 184,5 ⇒ làm tròn 185)
    expect(tinh({ hoatDong: "nhieu" }).nangLuongUocTinhKcal).toBe(2650); // 1537,5 × 1,725 = 2652,2 ⇒ 2650
  });

  it("ngưỡng châu Á: nhẹ cân · thừa cân ⇒ khuôn tương ứng", () => {
    const nhe = tinh({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 50 }] }); // 17,3
    expect([nhe.phanLoaiBmi.ma, nhe.khuon]).toEqual(["cy", "nl-nhe-can"]);
    const thua = tinh({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 80 }] }); // 27,7
    expect([thua.phanLoaiBmi.ma, thua.khuon]).toEqual(["cy", "nl-can-chu-y"]);
  });

  it("bệnh nền người lớn ⇒ khuôn 'dac-biet'", () => {
    expect(tinh({ benhNen: true }).khuon).toBe("dac-biet");
  });

  it("nữ mang thai: không phân loại BMI, không năng lượng, khuôn 'dac-biet'; nam gửi cờ này ⇒ bị chuẩn hoá về false (như web)", () => {
    const nu = tinh({ ngaySinh: "1995-06-15", gioiTinh: "nu", mangThaiHoacChoConBu: true, soDo: [{ ngay: "2026-11-01", chieuCaoCm: 160, canNangKg: 55 }] });
    expect(nu.mangThaiHoacChoConBuApDung).toBe(true);
    expect(nu.phanLoaiBmi.ma).toBe("chua");
    expect(nu.nangLuongUocTinhKcal).toBeNull();
    expect(nu.khuon).toBe("dac-biet");
    const nam = tinh({ mangThaiHoacChoConBu: true });
    expect(nam.mangThaiHoacChoConBuApDung).toBe(false);
    expect(nam.khuon).toBe("nl-binh-thuong");
  });

  it("trẻ 7 tuổi: BMI thô, CHƯA đánh giá (không bịa «vùng tham khảo»), khuôn 'tre', không năng lượng; xếp số đo mới nhất trước; chênh lệch + «lớn thêm»", () => {
    const k = tinh({
      ngaySinh: "2019-05-10", // 90 tháng ⇒ nhóm c6
      gioiTinh: "nu",
      soDo: [
        { ngay: "2026-08-12", chieuCaoCm: 120, canNangKg: 22 }, // cố ý đưa bản CŨ lên đầu mảng
        { ngay: "2026-11-01", chieuCaoCm: 122, canNangKg: 23 },
      ],
    });
    expect(k.tuoi).toEqual({ thang: 90, nhom: "c6", laTreEm: true });
    expect(k.soDo.map((b) => b.ngay)).toEqual(["2026-11-01", "2026-08-12"]);
    expect(k.soDo[0]!.bmi).toBe(15.5); // 23 / 1,22² = 15,45
    expect(k.phanLoaiBmi).toEqual({ ma: "chua", ten: "Chưa đánh giá — cần so bảng chuẩn WHO theo tuổi và giới" });
    expect(k.khuon).toBe("tre");
    expect(k.nangLuongUocTinhKcal).toBeNull();
    expect(k.soVoiBanTruoc).toEqual({ ngayBanTruoc: "2026-08-12", chieuCaoCm: 2, canNangKg: 1 });
    expect(k.lonThemTuBanDau).toEqual({ ngayBanDau: "2026-08-12", cm: 2 });
  });

  it("trẻ dưới 6 tuổi ⇒ khuôn 'tre-nho'", () => {
    const k = tinh({ ngaySinh: "2023-03-01", gioiTinh: "nam", soDo: [{ ngay: "2026-11-01", chieuCaoCm: 98, canNangKg: 15 }] });
    expect([k.tuoi.nhom, k.khuon, k.lonThemTuBanDau]).toEqual(["u5", "tre-nho", null]);
  });

  it("chênh lệch không bao giờ ra -0", () => {
    const k = tinh({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 65 }, { ngay: "2026-10-01", chieuCaoCm: 170, canNangKg: 65 }] });
    expect(Object.is(k.soVoiBanTruoc!.chieuCaoCm, 0)).toBe(true);
    expect(Object.is(k.soVoiBanTruoc!.canNangKg, 0)).toBe(true);
  });

  it("đủ 6 người × 3 bản chạy được; phản hồi KHÔNG mang tên / ngày sinh gửi lên", () => {
    const ds = Array.from({ length: 6 }, (_, i) =>
      nguoi({ ma: `n${i}`, soDo: [1, 2, 3].map((j) => ({ ngay: `2026-0${j}-01`, chieuCaoCm: 170 + j, canNangKg: 60 + j })) }),
    );
    const p = parse(ds);
    expect(p.success).toBe(true);
    const kq = danhGiaSucKhoe((p as { data: Parameters<typeof danhGiaSucKhoe>[0] }).data);
    expect(kq.nguoi).toHaveLength(6);
    expect(JSON.stringify(kq)).not.toContain("1990-01-01");
  });

  it("không đụng đồng hồ toàn cục: gọi xong, 'hôm nay' vẫn là ngày đã đóng băng", () => {
    tinh();
    // ca ở ngày 2026-11-21 vẫn hợp lệ, ngày sau đó vẫn là «tương lai»
    expect(parse([nguoi({ soDo: [{ ngay: "2026-11-21", chieuCaoCm: 170, canNangKg: 65 }] })]).success).toBe(true);
    expect(parse([nguoi({ soDo: [{ ngay: "2026-11-22", chieuCaoCm: 170, canNangKg: 65 }] })]).success).toBe(false);
  });
});

describe("[SKM-04] lược đồ đầu vào — strict, có trần, lời lỗi không chứa giá trị", () => {
  const thongBao = (r: ReturnType<typeof parse>) => (r.success ? [] : r.error.issues.map((i) => i.message));

  it("khoảng số đo công bố = đúng biên của kiemBan (chống lệch nguồn)", () => {
    const ok = (cao: number, nang: number, eo: number | null) => kiemBan({ ngay: HOM_NAY, cao, nang, eo }, HOM_NAY);
    const { chieuCaoCm: c, canNangKg: n, vongEoCm: e } = KHOANG_SO_DO;
    expect([ok(c.tu, 50, null), ok(c.den, 50, null), ok(c.tu - 0.01, 50, null), ok(c.den + 0.01, 50, null)]).toEqual([null, null, "CAO_SAI", "CAO_SAI"]);
    expect([ok(170, n.tu, null), ok(170, n.den, null), ok(170, n.tu - 0.01, null), ok(170, n.den + 0.01, null)]).toEqual([null, null, "NANG_SAI", "NANG_SAI"]);
    expect([ok(170, 60, e.tu), ok(170, 60, e.den), ok(170, 60, e.tu - 0.01), ok(170, 60, e.den + 0.01)]).toEqual([null, null, "EO_SAI", "EO_SAI"]);
  });

  it("trường lạ ⇒ từ chối (strict) ở cả ba cấp, câu lỗi cố định, KHÔNG chứa tên đã gửi", () => {
    const ten = "Nguyen Bao An";
    for (const r of [
      danhGiaSucKhoeSchema.safeParse({ nguoi: [nguoi()], ten }),
      parse([nguoi({ ten })]),
      parse([nguoi({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: 65, ghiChu: ten }] })]),
    ]) {
      expect(r.success).toBe(false);
      expect(JSON.stringify(thongBao(r as ReturnType<typeof parse>))).not.toContain(ten);
      expect(thongBao(r as ReturnType<typeof parse>)).toEqual(["Có trường không được hỗ trợ."]);
    }
  });

  it("số đo ngoài khoảng ⇒ lỗi theo ĐÚNG trường, giá trị gửi lên không xuất hiện trong lỗi", () => {
    const r = parse([nguoi({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 999.123, canNangKg: 65 }] })]);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(["nguoi", 0, "soDo", 0, "chieuCaoCm"]);
      expect(JSON.stringify(r.error.issues)).not.toContain("999.123");
    }
    for (const [cao, nang, eo, truong] of [
      [170, 1, null, "canNangKg"],
      [170, 251, null, "canNangKg"],
      [39, 60, null, "chieuCaoCm"],
      [170, 60, 29, "vongEoCm"],
    ] as const) {
      const x = parse([nguoi({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: cao, canNangKg: nang, vongEoCm: eo }] })]);
      expect(x.success).toBe(false);
      if (!x.success) expect(x.error.issues[0]!.path.at(-1)).toBe(truong);
    }
  });

  it("kiểu sai (chuỗi thay số, null cân nặng) ⇒ từ chối", () => {
    expect(parse([nguoi({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: "170", canNangKg: 65 }] })]).success).toBe(false);
    expect(parse([nguoi({ soDo: [{ ngay: "2026-11-01", chieuCaoCm: 170, canNangKg: null }] })]).success).toBe(false);
  });

  it("ngày: định dạng, lịch thật, tương lai (ngày đo VÀ ngày sinh)", () => {
    for (const ngay of ["2026-11-22", "2026-02-30", "01/11/2026", "2026-1-1", ""]) {
      expect(parse([nguoi({ soDo: [{ ngay, chieuCaoCm: 170, canNangKg: 65 }] })]).success, `ngày đo ${ngay}`).toBe(false);
    }
    for (const ngaySinh of ["2026-11-22", "2030-01-01", "2026-13-01", "x"]) {
      expect(parse([nguoi({ ngaySinh })]).success, `ngày sinh ${ngaySinh}`).toBe(false);
    }
    expect(parse([nguoi({ ngaySinh: HOM_NAY })]).success).toBe(true); // sinh hôm nay: 0 tháng
  });

  it("trần: 0 hoặc > 6 người · 0 hoặc > 3 bản · mã trùng · mã sai ký tự", () => {
    expect(parse([]).success).toBe(false);
    expect(parse(Array.from({ length: 7 }, (_, i) => nguoi({ ma: `n${i}` }))).success).toBe(false);
    expect(parse([nguoi({ soDo: [] })]).success).toBe(false);
    const ban = (j: number) => ({ ngay: `2026-0${j}-01`, chieuCaoCm: 170, canNangKg: 65 });
    expect(parse([nguoi({ soDo: [1, 2, 3, 4].map(ban) })]).success).toBe(false);
    expect(parse([nguoi({ ma: "a" }), nguoi({ ma: "a" })]).success).toBe(false);
    for (const ma of ["", "có dấu", "a b", "x".repeat(41), "Nguyễn"]) expect(parse([nguoi({ ma })]).success, ma).toBe(false);
  });

  it("thiếu / sai giới tính, mức vận động; mặc định khi bỏ qua hoatDong · mangThai · benhNen", () => {
    expect(parse([nguoi({ gioiTinh: "khac" })]).success).toBe(false);
    expect(parse([nguoi({ gioiTinh: undefined })]).success).toBe(false);
    expect(parse([nguoi({ hoatDong: "rat-nhieu" })]).success).toBe(false);
    const p = parse([nguoi()]);
    expect(p.success && p.data.nguoi[0]).toMatchObject({ hoatDong: "vua", mangThaiHoacChoConBu: false, benhNen: false });
  });

  it("thân không phải đối tượng / mảng rỗng ⇒ từ chối", () => {
    for (const x of [null, [], "x", 1, {}, { nguoi: "x" }]) expect(danhGiaSucKhoeSchema.safeParse(x).success).toBe(false);
  });
});

describe("[SKM-05] chế độ học sinh bị chặn (allow-list mặc định từ chối, không cần sửa che-do-hoc-sinh-thuan.ts)", () => {
  const CAC_DUONG: Array<[string, string]> = [
    ["GET", "/api/mobile/v1/parent/health/content"],
    ["POST", "/api/mobile/v1/parent/health/evaluate"],
    // đường «theo học viên» giả định cũng KHÔNG nằm trong danh sách được xem
    ["GET", "/api/mobile/v1/students/s1/health"],
    ["POST", "/api/mobile/v1/students/s1/health/evaluate"],
  ];
  it("phiên học sinh ⇒ DANG_CHE_DO_HOC_SINH cho mọi đường sức khoẻ", () => {
    for (const [m, p] of CAC_DUONG) {
      expect(kiemCheDoHocSinh({ pathname: p, method: m, hocSinhId: "s1" }), `${m} ${p}`).toEqual({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    }
  });
  it("đối chứng dương: phiên phụ huynh (hocSinhId = null) đi qua; học sinh vẫn xem được mục có trong danh sách", () => {
    for (const [m, p] of CAC_DUONG) expect(kiemCheDoHocSinh({ pathname: p, method: m, hocSinhId: null }).ok).toBe(true);
    expect(kiemCheDoHocSinh({ pathname: "/api/mobile/v1/students/s1/schedule", method: "GET", hocSinhId: "s1" }).ok).toBe(true);
  });
});
