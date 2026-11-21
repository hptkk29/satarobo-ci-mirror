// @vitest-environment node
// [NHH-FE-HC2-*] — HÀNG CHỜ CHÍNH SÁCH (thuần): bốn loại việc của tab Chính sách. Các ca canh ba điều dễ sai:
//   · biên "đủ 15 ngày làm việc" (đúng ngày thứ 15 là ĐỦ), có trừ ngày lễ — và chỉ lễ của cơ sở TRONG phạm vi;
//   · "sắp hiệu lực" chỉ là bản đã kích hoạt mà CHƯA tới ngày, trong 7 ngày (gồm cả ngày thứ 7);
//   · mỗi nháp rơi vào ĐÚNG MỘT loại (không đếm đôi) — vì con số này in trên pill tab và route gốc.
import { describe, expect, it } from "vitest";
import { hrefViecHangCho, phanLoaiHangChoChinhSach, type PhienBanHangCho, type ViecHangCho } from "./hang-cho-chinh-sach";

const NOW = new Date("2026-10-08T03:00:00.000Z"); // 10:00 thứ Năm 08/10/2026 giờ VN
const vb = (p: Partial<NonNullable<PhienBanHangCho["vanBan"]>> = {}) => ({
  documentCode: "SR.QD.300",
  publishedOn: "2026-03-02", // thứ Hai
  coTep: true,
  daThuHoi: false,
  ...p,
});
const pb = (p: Partial<PhienBanHangCho> = {}): PhienBanHangCho => ({
  versionId: "v1",
  policyId: "p1",
  policyCode: "POL-1",
  tenChinhSach: "Hoa hồng học viên mới",
  versionNo: 1,
  status: "DRAFT",
  effectiveFrom: new Date("2026-03-22T17:00:00.000Z"), // 23/03/2026 00:00 VN
  vanBan: vb(),
  coSoTrongPhamVi: new Set(["cs1", "cs2"]),
  codeVaiCoRule: ["SALE"],
  ...p,
});
const dauVao = (phienBan: PhienBanHangCho[], p: Partial<Parameters<typeof phanLoaiHangChoChinhSach>[0]> = {}) => ({
  phienBan,
  // Mặc định KHÔNG có vai nào: ca nào cần vai thì tự khai (vai mặc định "bật mà chưa có chính sách" sẽ chen vào mọi ca).
  vai: [],
  nghi: [],
  now: NOW,
  soNgayLamViec: 15,
  ...p,
});
const loai = (xs: ReturnType<typeof phanLoaiHangChoChinhSach>) => xs.map((x) => x.loai);

describe("[NHH-FE-HC2-01] nháp thiếu văn bản", () => {
  it("chưa gắn văn bản · văn bản chưa có tệp · văn bản đã thu hồi ⇒ cùng loại, lý do KHÁC nhau", () => {
    const r = phanLoaiHangChoChinhSach(
      dauVao([
        pb({ versionId: "a", vanBan: null }),
        pb({ versionId: "b", vanBan: vb({ coTep: false }) }),
        pb({ versionId: "c", vanBan: vb({ daThuHoi: true }) }),
      ]),
    );
    expect(r.map((x) => x.loai)).toEqual(["NHAP_THIEU_VAN_BAN", "NHAP_THIEU_VAN_BAN", "NHAP_THIEU_VAN_BAN"]);
    expect(new Set(r.map((x) => x.lyDo)).size).toBe(3);
    expect(r[0]!.lyDo).toMatch(/Chưa gắn văn bản/);
    expect(r[1]!.lyDo).toMatch(/tệp/);
    expect(r[2]!.lyDo).toMatch(/thu hồi/);
  });

  it("chỉ NHÁP: bản đã kích hoạt thiếu văn bản không vào loại này (cổng kích hoạt đã chặn)", () => {
    expect(phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", vanBan: null, effectiveFrom: new Date("2026-03-01T00:00:00.000Z") })]))).toEqual([]);
  });
});

describe("[NHH-FE-HC2-02] chưa đủ 15 ngày làm việc — in ngày sớm nhất hợp lệ", () => {
  it("công bố thứ Hai 02/03 + 15 NLV = 23/03: hiệu lực 20/03 ⇒ thiếu, in 23/03; đúng 23/03 ⇒ ĐỦ (biên)", () => {
    const som = phanLoaiHangChoChinhSach(dauVao([pb({ effectiveFrom: new Date("2026-03-19T17:00:00.000Z") })]));
    expect(loai(som)).toEqual(["CHUA_DU_NGAY_LAM_VIEC"]);
    expect(som[0]).toMatchObject({ ngay: "2026-03-23" });
    expect(som[0]!.lyDo).toMatch(/23\/03\/2026/);
    expect(phanLoaiHangChoChinhSach(dauVao([pb({ effectiveFrom: new Date("2026-03-22T17:00:00.000Z") })]))).toEqual([]);
  });

  it("ngày lễ toàn hệ thống đẩy mốc lùi: nghỉ 04/03 ⇒ sớm nhất 24/03 (23/03 không còn đủ)", () => {
    const nghi = [{ tuNgay: "2026-03-04", denNgay: "2026-03-04", loai: "HOLIDAY" as const, centerId: null }];
    const r = phanLoaiHangChoChinhSach(dauVao([pb()], { nghi }));
    expect(r[0]).toMatchObject({ loai: "CHUA_DU_NGAY_LAM_VIEC", ngay: "2026-03-24" });
  });

  it("lễ của cơ sở NGOÀI phạm vi không được trừ; lễ MAINTENANCE không phải ngày nghỉ", () => {
    const nghi = [
      { tuNgay: "2026-03-04", denNgay: "2026-03-04", loai: "HOLIDAY" as const, centerId: "cs9" },
      { tuNgay: "2026-03-05", denNgay: "2026-03-05", loai: "MAINTENANCE" as const, centerId: null },
    ];
    expect(phanLoaiHangChoChinhSach(dauVao([pb()], { nghi }))).toEqual([]);
  });

  it("bản đã kích hoạt không vào loại này (đã qua cổng); thiếu văn bản KHÔNG đồng thời vào loại này (không đếm đôi)", () => {
    expect(phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", effectiveFrom: new Date("2026-03-01T00:00:00.000Z") })]))).toEqual([]);
    const r = phanLoaiHangChoChinhSach(dauVao([pb({ vanBan: null, effectiveFrom: new Date("2026-03-01T00:00:00.000Z") })]));
    expect(loai(r)).toEqual(["NHAP_THIEU_VAN_BAN"]);
  });
});

describe("[NHH-FE-HC2-03] sắp hiệu lực (đã kích hoạt, chưa tới ngày, trong 7 ngày)", () => {
  const kich = (ngayVN: string, p: Partial<PhienBanHangCho> = {}) =>
    pb({ status: "ACTIVE", effectiveFrom: new Date(`${ngayVN}T00:00:00+07:00`), ...p });

  it("ngày mai và đúng 7 ngày nữa ⇒ có; 8 ngày nữa ⇒ không", () => {
    expect(loai(phanLoaiHangChoChinhSach(dauVao([kich("2026-10-09")])))).toEqual(["SAP_HIEU_LUC"]);
    expect(loai(phanLoaiHangChoChinhSach(dauVao([kich("2026-10-15")])))).toEqual(["SAP_HIEU_LUC"]);
    expect(phanLoaiHangChoChinhSach(dauVao([kich("2026-10-16")]))).toEqual([]);
  });

  it("đã có hiệu lực (hôm nay hoặc trước) ⇒ không; ngày in ra là ngày VN", () => {
    expect(phanLoaiHangChoChinhSach(dauVao([kich("2026-10-08")]))).toEqual([]);
    expect(phanLoaiHangChoChinhSach(dauVao([kich("2026-09-01")]))).toEqual([]);
    expect(phanLoaiHangChoChinhSach(dauVao([kich("2026-10-12")]))[0]).toMatchObject({ ngay: "2026-10-12" });
  });

  it("nháp có hiệu lực trong tương lai gần KHÔNG phải 'sắp hiệu lực' (chưa được kích hoạt)", () => {
    expect(loai(phanLoaiHangChoChinhSach(dauVao([pb({ effectiveFrom: new Date("2026-10-10T00:00:00+07:00") })])))).not.toContain("SAP_HIEU_LUC");
  });

  // Cấy 08/10 (rà soát độc lập): `effectiveFrom > now` → `>=` XANH 100% — mọi ca trên đặt hiệu lực ở 00:00 VN của một NGÀY, nên không ca nào có
  // `effectiveFrom` đúng bằng `now`. Biên này quyết định một bản "vừa tới giờ hiệu lực" còn nằm trong hàng chờ "sắp hiệu lực" hay không.
  it("biên: bản có hiệu lực ĐÚNG lúc now là đã hiệu lực (không còn 'sắp'); trễ 1 ms thì còn 'sắp'", () => {
    expect(phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", effectiveFrom: new Date(NOW) })]))).toEqual([]);
    expect(loai(phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", effectiveFrom: new Date(NOW.getTime() + 1) })])))).toEqual(["SAP_HIEU_LUC"]);
  });
});

describe("[NHH-FE-HC2-04] vai đang bật mà không có chính sách nào", () => {
  it("vai bật + không rule trong bản ACTIVE nào ⇒ một việc cho mỗi vai; vai tắt hoặc đã có rule ⇒ không", () => {
    const vai = [
      { code: "SALE", name: "Sale", isActive: true },
      { code: "AFFILIATE", name: "Cộng tác viên / đối tác", isActive: true },
      { code: "OLD", name: "Vai cũ", isActive: false },
    ];
    const r = phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", effectiveFrom: new Date("2026-03-01T00:00:00.000Z"), codeVaiCoRule: ["SALE"] })], { vai }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ loai: "VAI_KHONG_CO_CHINH_SACH", vai: { code: "AFFILIATE" }, versionId: null, policyId: null });
    expect(r[0]!.lyDo).toMatch(/Cộng tác viên/);
  });

  it("rule chỉ nằm trong NHÁP không tính là 'có chính sách'", () => {
    const r = phanLoaiHangChoChinhSach(dauVao([pb({ status: "DRAFT", codeVaiCoRule: ["SALE"] })], { vai: [{ code: "SALE", name: "Sale", isActive: true }] }));
    expect(r.filter((x) => x.loai === "VAI_KHONG_CO_CHINH_SACH").map((x) => x.vai?.code)).toEqual(["SALE"]);
  });

  it("rule trong bản ACTIVE sắp hiệu lực tính là đã có chính sách (đã được lên lịch)", () => {
    const r = phanLoaiHangChoChinhSach(dauVao([pb({ status: "ACTIVE", effectiveFrom: new Date("2026-10-12T00:00:00+07:00"), codeVaiCoRule: ["SALE"] })], { vai: [{ code: "SALE", name: "Sale", isActive: true }] }));
    expect(r.filter((x) => x.loai === "VAI_KHONG_CO_CHINH_SACH")).toEqual([]);
  });
});

describe("[NHH-FE-HC2-05] thứ tự và tổng", () => {
  it("thứ tự nhóm cố định: thiếu văn bản → chưa đủ ngày → sắp hiệu lực → vai; trong nhóm theo mã chính sách", () => {
    const r = phanLoaiHangChoChinhSach(
      dauVao(
        [
          pb({ versionId: "z", policyCode: "B", vanBan: null }),
          pb({ versionId: "y", policyCode: "A", vanBan: null }),
          pb({ versionId: "x", policyCode: "C", effectiveFrom: new Date("2026-03-19T17:00:00.000Z") }),
          pb({ versionId: "w", policyCode: "D", status: "ACTIVE", effectiveFrom: new Date("2026-10-10T00:00:00+07:00") }),
        ],
        { vai: [{ code: "AFFILIATE", name: "CTV", isActive: true }] },
      ),
    );
    expect(r.map((x) => `${x.loai}:${x.policyCode ?? x.vai?.code}`)).toEqual([
      "NHAP_THIEU_VAN_BAN:A",
      "NHAP_THIEU_VAN_BAN:B",
      "CHUA_DU_NGAY_LAM_VIEC:C",
      "SAP_HIEU_LUC:D",
      "VAI_KHONG_CO_CHINH_SACH:AFFILIATE",
    ]);
  });

  it("không có việc ⇒ mảng rỗng", () => {
    expect(phanLoaiHangChoChinhSach(dauVao([], { vai: [] }))).toEqual([]);
  });
});

describe("[NHH-FE-HC2-06] hrefViecHangCho — dòng chỉ bấm được khi đích có thật và người xem vào được", () => {
  const viec = (p: Partial<ViecHangCho>): ViecHangCho => ({
    loai: "NHAP_THIEU_VAN_BAN",
    versionId: "v9",
    policyId: "p9",
    policyCode: "POL",
    tenChinhSach: "Tên",
    versionNo: 3,
    vai: null,
    lyDo: "x",
    ngay: null,
    ...p,
  });

  it("người được soạn: thiếu văn bản ⇒ bước Văn bản; chưa đủ ngày ⇒ bước Hiệu lực (thẳng vào ô cần sửa)", () => {
    expect(hrefViecHangCho(viec({}), true)).toBe("/nguon-hoa-hong/chinh-sach/p9/soan?v=v9&buoc=van-ban");
    expect(hrefViecHangCho(viec({ loai: "CHUA_DU_NGAY_LAM_VIEC" }), true)).toBe("/nguon-hoa-hong/chinh-sach/p9/soan?v=v9&buoc=hieu-luc");
  });

  it("người chỉ xem: đi trang chi tiết (không dẫn vào trình soạn họ không mở được)", () => {
    expect(hrefViecHangCho(viec({}), false)).toBe("/nguon-hoa-hong/chinh-sach/p9?v=3");
    expect(hrefViecHangCho(viec({ loai: "CHUA_DU_NGAY_LAM_VIEC" }), false)).toBe("/nguon-hoa-hong/chinh-sach/p9?v=3");
  });

  it("sắp hiệu lực luôn đi chi tiết; vai chưa có chính sách: soạn ⇒ trang tạo, chỉ xem ⇒ KHÔNG đích (null)", () => {
    expect(hrefViecHangCho(viec({ loai: "SAP_HIEU_LUC" }), true)).toBe("/nguon-hoa-hong/chinh-sach/p9?v=3");
    const vai = viec({ loai: "VAI_KHONG_CO_CHINH_SACH", versionId: null, policyId: null, versionNo: null, vai: { code: "SALE", name: "Sale" } });
    expect(hrefViecHangCho(vai, true)).toBe("/nguon-hoa-hong/chinh-sach/moi");
    expect(hrefViecHangCho(vai, false)).toBeNull();
  });
});

