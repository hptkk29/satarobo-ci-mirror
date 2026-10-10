/**
 * Ca [NHH-SRC-00x] — CỜ TẮT ⇒ KHÔNG MỘT truy vấn nào (ngoài việc đọc cờ), KHÔNG một bản ghi nào. THUẦN (DB giả bằng Proxy ném lỗi).
 *
 * Vì sao có (luật 14): ca DB `[NHH-SRC-07*-off]` chứng minh "0 bản ghi", nhưng KHÔNG chứng minh "0 truy vấn". Bản đầu của PR2 gọi
 * `await orgUnitIdForCenter(centerId)` ở CHỖ GỌI, trước khi cờ được đọc ⇒ mọi lead tạo lúc cờ TẮT vẫn tốn thêm một truy vấn. Không
 * ca DB nào đỏ vì kết quả đúng; chỉ ca này đỏ vì cái DB giả NỔ khi bị chạm.
 */
import { describe, expect, it, vi } from "vitest";

const co = vi.hoisted(() => ({ bat: false, loiPii: false }));
const orgUnit = vi.hoisted(() => ({ goi: vi.fn(async () => "OU1") }));

vi.mock("./feature", () => ({
  laQuanLyNguonBat: async () => co.bat,
  laEpChonNguon: async () => false,
  cachXuLyNhanLa: () => "UNKNOWN_XEM_TAY",
}));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: orgUnit.goi }));
vi.mock("./thu-thap-tin-hieu", () => ({
  thuThapTinHieuTheoLo: async () => {
    throw new Error(co.loiPii ? 'Invalid `findMany()` where: { phone: { in: ["0903000001"] } } khach@example.com' : "thuThapTinHieuTheoLo bị gọi khi cờ TẮT");
  },
}));

import {
  chuanBiQuyNguon,
  dungDuLieuTuKetQua,
  dungTouchpointDenSau,
  ghiNguonDenSauChoLeadCu,
  nhanKhaiCuaDuongVao,
  ghiQuyNguonLeadMoi,
  ghiQuyNguonTheoLo,
  ghiTinHieuDenSau,
  ghiTinHieuDenSauTheoLo,
  type DauVaoNoiDay,
  type TinHieuDenSau,
} from "./noi-day";
import { KHONG_CO_TIN_HIEU_NGUON, type KetQuaQuyNguon } from "./tin-hieu";

/** DB/tx giả: chạm vào BẤT KỲ thuộc tính nào cũng ném. */
const dbNo = new Proxy({}, { get: (_t, p) => { throw new Error(`DB bị chạm (${String(p)}) khi cờ TẮT`); } }) as never;

const dong = (): DauVaoNoiDay => ({
  bayGio: new Date("2026-10-08T03:00:00.000Z"),
  duongVao: "facebook",
  conversionEntry: "facebook",
  nhanKhai: null,
  laNhapExcel: false,
  sdtKhach: "0901234567",
  maNvNguoiNhap: null,
  nguoiNhapUserId: null,
  nhanSuGioiThieuEmployeeId: null,
  phuHuynhGioiThieu: null,
  ref: "ABC",
  refSau: [],
  quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
  utm: KHONG_CO_TIN_HIEU_NGUON.utm,
  pageId: null,
  orgUnitId: null,
  centerId: "CT1",
});

describe("[NHH-SRC-00a] cờ master TẮT ⇒ chuanBiQuyNguon không chạm DB, không tra cơ sở", () => {
  it("N dòng ⇒ N phần tử `{ bat: false }`; DB giả không bị chạm; orgUnitIdForCenter KHÔNG được gọi", async () => {
    co.bat = false;
    orgUnit.goi.mockClear();
    const kq = await chuanBiQuyNguon(dbNo, [dong(), dong(), dong()]);
    expect(kq).toEqual([{ bat: false }, { bat: false }, { bat: false }]);
    expect(orgUnit.goi).not.toHaveBeenCalled();
  });

  it("lô RỖNG ⇒ [] và không đọc cờ", async () => {
    expect(await chuanBiQuyNguon(dbNo, [])).toEqual([]);
  });

  it("đối chứng dương: cờ BẬT ⇒ đi tiếp vào bước thu thập (và lỗi ở đó bị NUỐT, lead không bị chặn — T4)", async () => {
    co.bat = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const kq = await chuanBiQuyNguon(dbNo, [dong()]);
    expect(kq).toHaveLength(1);
    expect(kq[0]).toMatchObject({ bat: false });
    expect((kq[0] as { loi?: string }).loi).toMatch(/thuThapTinHieuTheoLo bị gọi khi cờ TẮT/); // chứng minh nó ĐÃ đi vào bước thu thập
    expect(log).toHaveBeenCalled();
    log.mockRestore();
    co.bat = false;
  });
});

describe("[NHH-SRC-00b] `bat: false` ⇒ các hàm GHI không chạm tx", () => {
  it("ghiQuyNguonLeadMoi / ghiQuyNguonTheoLo / ghiTinHieuDenSau(bat=false) / ghiTinHieuDenSauTheoLo(bat=false) đều là no-op", async () => {
    const t = { kind: "NHAP_LAI" as const, conversionEntry: null, nhanKhai: null, ref: "X", quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao, utm: KHONG_CO_TIN_HIEU_NGUON.utm, pageId: null, nguoiGioiThieu: null };
    await expect(ghiQuyNguonLeadMoi(dbNo, "L1", { bat: false }, null)).resolves.toBeUndefined();
    await expect(ghiQuyNguonTheoLo(dbNo, [{ leadId: "L1", chuanBi: { bat: false } }], null)).resolves.toBeUndefined();
    await expect(ghiTinHieuDenSau(dbNo, "L1", t, null, false)).resolves.toBe(0);
    await expect(ghiTinHieuDenSauTheoLo(dbNo, [{ leadId: "L1", t }], null, false)).resolves.toBe(0);
  });
});

// ── Lưới siết sau lượt cấy lỗi (luật 14) ────────────────────────────────────────────────────────────────

const denSau = (over: Partial<TinHieuDenSau> = {}): TinHieuDenSau => ({
  kind: "NHAP_LAI",
  conversionEntry: "web",
  nhanKhai: null,
  ref: null,
  quangCao: KHONG_CO_TIN_HIEU_NGUON.quangCao,
  utm: KHONG_CO_TIN_HIEU_NGUON.utm,
  pageId: null,
  nguoiGioiThieu: null,
  ...over,
});

describe("[NHH-SRC-00c] dungTouchpointDenSau — mã ref được CHUẨN HOÁ như lúc quy nguồn (cùng một mã không thành hai chuỗi)", () => {
  // Cấy `ma ?? t.ref.trim()` → `t.ref.trim()`: mã `an-nguyen` ghi vào sổ khác chuỗi `ANNGUYEN` mà aff được tra bằng — đối soát theo mã hụt.
  it("`an-nguyen` ⇒ REF_SAU mang `ANNGUYEN`; mã quá ngắn (<3 ký tự sau chuẩn hoá) ⇒ giữ nguyên chữ người gửi, không mất", () => {
    const tps = dungTouchpointDenSau(denSau({ ref: "  an-nguyen " }));
    expect(tps.map((t) => t.kind)).toEqual(["NHAP_LAI", "REF_SAU"]);
    expect(tps[1]!.signals).toEqual({ ref: "ANNGUYEN" });
    expect(dungTouchpointDenSau(denSau({ ref: " ab " }))[1]!.signals).toEqual({ ref: "ab" });
  });
  it("không ref ⇒ chỉ MỘT touchpoint; ref toàn khoảng trắng cũng không đẻ REF_SAU", () => {
    expect(dungTouchpointDenSau(denSau()).map((t) => t.kind)).toEqual(["NHAP_LAI"]);
    expect(dungTouchpointDenSau(denSau({ ref: "   " })).map((t) => t.kind)).toEqual(["NHAP_LAI"]);
  });
});

describe("[NHH-SRC-00d] dungDuLieuTuKetQua — mã nhóm ⇒ id nhóm, và 'không có nhóm' KHÔNG bị đổi thành UNKNOWN", () => {
  // Cấy `claimedGroupId: null` → `UNKNOWN` khi touchpoint không tuyên bố nhóm nào: sổ sẽ nói người nhập "đòi" nhóm Không xác định.
  const nhomId = new Map([
    ["UNKNOWN", "id-unk"],
    ["PAID_ADS", "id-ad"],
    ["PARENT_REFERRAL", "id-ph"],
  ]);
  const ketQua = (over: Partial<KetQuaQuyNguon> = {}): KetQuaQuyNguon => ({
    groupCode: "PAID_ADS",
    originalGroupCode: "PARENT_REFERRAL",
    inheritedFromLeadId: "L0",
    attributedAt: new Date("2026-06-01T00:00:00.000Z"),
    luat: "KE_THUA_SDT",
    identificationMethod: "EXISTING_LEAD",
    reasonText: "t",
    nguoi: null,
    referrerMissing: false,
    otherSourceNote: null,
    canhBao: [],
    xemTay: [],
    khoaNguon: false,
    anhChup: { referrerRoleCode: null, referrerSaleUserId: null, nguoiGioiThieu: null, nguon: null },
    conversionEntry: "web",
    signals: {},
    touchpointThua: [
      { kind: "TAO_LEAD", claimedGroupCode: null, signals: {} },
      { kind: "TAO_LEAD", claimedGroupCode: "PAID_ADS", signals: {} },
      { kind: "TAO_LEAD", claimedGroupCode: "MA_KHONG_CO", signals: {} },
    ],
    ...over,
  });

  it("[DYN-ND-01] ẢNH CHỤP đi thẳng xuống hai cột: referrerRoleCode · referrerSaleUserId (KHÔNG tính lại ở tầng ghi); null giữ null", () => {
    const co = dungDuLieuTuKetQua(ketQua({ anhChup: { referrerRoleCode: "TEACHER", referrerSaleUserId: "sale-X", nguoiGioiThieu: null, nguon: null } }), nhomId).duLieu;
    expect(co).toMatchObject({ referrerRoleCode: "TEACHER", referrerSaleUserId: "sale-X" });
    expect(dungDuLieuTuKetQua(ketQua(), nhomId).duLieu).toMatchObject({ referrerRoleCode: null, referrerSaleUserId: null });
  });

  it("nhóm hiện hành và nhóm GỐC đi hai đường riêng; touchpoint không tuyên bố nhóm ⇒ null; mã lạ ⇒ null (không đoán)", () => {
    const { duLieu, touchpoints } = dungDuLieuTuKetQua(ketQua(), nhomId);
    expect(duLieu.groupId).toBe("id-ad");
    expect(duLieu.originalGroupId).toBe("id-ph");
    expect(duLieu.inheritedFromLeadId).toBe("L0");
    expect(touchpoints.map((t) => t.claimedGroupId)).toEqual([null, "id-ad", null]);
  });

  it("mã nhóm của kết quả không có trong danh mục ⇒ rơi về UNKNOWN (không ném, không để groupId undefined)", () => {
    const { duLieu } = dungDuLieuTuKetQua(ketQua({ groupCode: "MA_LA", originalGroupCode: "MA_LA_2" }), nhomId);
    expect(duLieu.groupId).toBe("id-unk");
    expect(duLieu.originalGroupId).toBe("id-unk");
  });

  it("danh mục thiếu UNKNOWN ⇒ NÉM (lỗi triển khai, không âm thầm ghi nhóm rỗng)", () => {
    expect(() => dungDuLieuTuKetQua(ketQua(), new Map([["PAID_ADS", "id-ad"]]))).toThrow(/UNKNOWN/);
  });
});

describe("[NHH-SRC-00e] ghiNguonDenSauChoLeadCu — lỗi KHÔNG làm hỏng lượt gộp phiếu (T4); cờ TẮT ⇒ không mở transaction", () => {
  // Cấy `console.error(...)` → `throw err`: một lỗi DB khi ghi dấu vết nguồn sẽ làm sập cả lượt nhập lead trùng SĐT.
  const mo = (loi: Error | null) => {
    const create = vi.fn(async () => ({ id: "tp" }));
    const tx = { leadTouchpoint: { create } };
    const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
      if (loi) throw loi;
      return cb(tx);
    });
    return { client: { $transaction: transaction } as never, create, transaction };
  };

  it("cờ BẬT + transaction NÉM ⇒ nuốt, ghi log mang tên đường; không ném ra ngoài", async () => {
    co.bat = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { client } = mo(new Error("boom"));
      await expect(ghiNguonDenSauChoLeadCu(client, "L1", denSau({ ref: "ABC123" }), null, "kiem-tra")).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toContain("[nguon:kiem-tra]");
    } finally {
      log.mockRestore();
    }
  });

  it("đối chứng dương: cờ BẬT + DB tốt ⇒ ghi đủ NHAP_LAI + REF_SAU trong MỘT transaction", async () => {
    co.bat = true;
    const { client, create, transaction } = mo(null);
    await ghiNguonDenSauChoLeadCu(client, "L1", denSau({ ref: "ABC123" }), "U1", "kiem-tra");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("cờ TẮT ⇒ KHÔNG mở transaction, KHÔNG ghi gì", async () => {
    co.bat = false;
    const { client, create, transaction } = mo(null);
    await ghiNguonDenSauChoLeadCu(client, "L1", denSau({ ref: "ABC123" }), null, "kiem-tra");
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("[NHH-SRC-00f] nhanKhaiCuaDuongVao — chữ người gõ thắng; không gõ thì CHỈ đường 'người nhập quyết nhóm' mới tự thành nhãn", () => {
  // Cấy `return laNhanTheo…(…) ? duongVao : null` → `return duongVao`: mọi đường máy (quatang · facebook · web…) bị đẩy qua bảng 28 nhãn cũ
  // như thể người nhập đã khai; `quatang` là nhãn #5 nên lead đi cổng quatang đổi từ SYSTEM_DEFAULT sang MANUAL/KHAI_TAY mà không ca nào đỏ.
  it("có chữ người gõ ⇒ chữ đó (đã trim), kể cả khi đường vào là đường máy", () => {
    expect(nhanKhaiCuaDuongVao("facebook", "  Ads ")).toBe("Ads");
    expect(nhanKhaiCuaDuongVao("sale-form", "Quản Lý Trung Tâm")).toBe("Quản Lý Trung Tâm");
  });
  it("không gõ + đường máy ⇒ null (đi luật DUONG_VAO_MAC_DINH, không phải nhãn)", () => {
    for (const duong of ["facebook", "zalo", "google-form", "quatang", "web", "import-excel", "nhap-tay"]) {
      expect(nhanKhaiCuaDuongVao(duong, null), duong).toBeNull();
      expect(nhanKhaiCuaDuongVao(duong, "   "), duong).toBeNull();
    }
  });
  it("không gõ + đường 'người nhập quyết nhóm' (sale-form, sale-form-app) ⇒ chính tên đường là nhãn (D12), kể cả hoa/thường", () => {
    expect(nhanKhaiCuaDuongVao("sale-form", undefined)).toBe("sale-form");
    expect(nhanKhaiCuaDuongVao("sale-form-app", null)).toBe("sale-form-app");
    expect(nhanKhaiCuaDuongVao("Sale-Form-App", null)).toBe("Sale-Form-App");
  });
});

describe("[NHH-SRC-00g] nhật ký lỗi của nối dây KHÔNG mang SĐT/email (lỗi Prisma có thể chèn giá trị truy vấn vào message)", () => {
  // Cấy `${moTaLoiAnToan(err)}` → `err` (log nguyên đối tượng lỗi): SĐT khách nằm trong message lỗi đi thẳng vào log/Sentry.
  const loiCoPii = () => Object.assign(new Error('Invalid `findMany()` where: { phone: { in: ["0903000001","84903000001"] } } khach@example.com'), { code: "P2010" });

  it("ghiNguonDenSauChoLeadCu: log không chứa chuỗi ≥ 9 chữ số hay '@'; vẫn mang tên lỗi + mã", async () => {
    co.bat = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const client = { $transaction: async () => { throw loiCoPii(); } } as never;
      await ghiNguonDenSauChoLeadCu(client, "L1", denSau({ ref: "ABC123" }), null, "kiem-tra");
      const dongLog = JSON.stringify(log.mock.calls.map((c) => c.map((x) => (x instanceof Error ? { name: x.name, message: x.message } : x))));
      expect(dongLog).not.toMatch(/\d{9,}/);
      expect(dongLog).not.toMatch(/@/);
      expect(dongLog).toContain("P2010");
    } finally {
      log.mockRestore();
    }
  });

  it("chuanBiQuyNguon: lỗi thu thập ⇒ log + trường `loi` trả về đều không mang PII", async () => {
    co.bat = true;
    co.loiPii = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const kq = await chuanBiQuyNguon(dbNo, [dong()]);
      const dongLog = JSON.stringify(log.mock.calls.map((c) => c.map((x) => (x instanceof Error ? { name: x.name, message: x.message } : x))));
      expect(dongLog).not.toMatch(/\d{9,}/);
      expect(JSON.stringify(kq)).not.toMatch(/\d{9,}/);
    } finally {
      log.mockRestore();
      co.loiPii = false;
      co.bat = false;
    }
  });
});
