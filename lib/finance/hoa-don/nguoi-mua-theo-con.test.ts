// [NMC-*] Người mua là BA/MẸ hay CON — ba tình huống kế toán đưa nguyên văn (17/11/2026) + các chỗ KHÔNG được chọn con.
import { describe, it, expect } from "vitest";
import { conChoChungTu, conChoNguoiMua, diemThongTin, quyetNguoiMuaTheoCon, type DuKienConUngVien, type ThongTinConDon } from "./nguoi-mua-theo-con";

const ung = (o: Partial<DuKienConUngVien> = {}): DuKienConUngVien => ({
  apDung: true,
  chungTuTruocMoc: false,
  tenTrenDon: null,
  cccdTrenDon: null,
  tenHoSo: null,
  cccdHoSo: null,
  ...o,
});

describe("[NMC-01] ba tình huống của kế toán — địa chỉ dùng chung nên không làm hai bên khác điểm", () => {
  it("TH1: mẹ có tên + CCCD, con chỉ có tên ⇒ MẸ (nội dung cũ)", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ 1", cccd: "048000000001" }, con: { hoTen: "Con 1", cccd: null }, coDonVi: false })).toBe("PHU_HUYNH");
  });
  it("TH2: mẹ chỉ có tên, con có tên + CCCD ⇒ CON", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ 2", cccd: null }, con: { hoTen: "Con 2", cccd: "048000000002" }, coDonVi: false })).toBe("CON");
  });
  it("TH3: mẹ chỉ có tên, con chỉ có tên ⇒ CON (bằng nhau ⇒ con)", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ 3", cccd: null }, con: { hoTen: "Con 3", cccd: null }, coDonVi: false })).toBe("CON");
  });
  it("cả hai đủ tên + CCCD ⇒ bằng nhau ⇒ CON", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ", cccd: "048000000001" }, con: { hoTen: "Con", cccd: "048000000002" }, coDonVi: false })).toBe("CON");
  });
  it("khoảng trắng không phải thông tin", () => {
    expect(diemThongTin({ hoTen: "  ", cccd: " " })).toBe(0);
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ", cccd: "048000000001" }, con: { hoTen: "Con", cccd: "   " }, coDonVi: false })).toBe("PHU_HUYNH");
  });
});

describe("[NMC-02] chỗ KHÔNG được chọn con", () => {
  const ph = { hoTen: "Mẹ", cccd: null };
  const con = { hoTen: "Con", cccd: "048000000002" };
  it("đơn có tên đơn vị / MST ⇒ người mua là doanh nghiệp ⇒ ba/mẹ dù con đủ hơn", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: ph, con, coDonVi: true })).toBe("PHU_HUYNH");
  });
  it("không có con ứng viên ⇒ ba/mẹ", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: ph, con: null, coDonVi: false })).toBe("PHU_HUYNH");
  });
  it("con không có họ tên ⇒ ba/mẹ dù con có CCCD", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: ph, con: { hoTen: null, cccd: "048000000002" }, coDonVi: false })).toBe("PHU_HUYNH");
  });
});

describe("[NMC-03] conChoNguoiMua — con ứng viên của một đơn", () => {
  it("luật CHƯA áp dụng (chưa đặt mốc) ⇒ null, dù đơn có đủ tên con", () => {
    expect(conChoNguoiMua(ung({ apDung: false, tenTrenDon: "Con" }))).toBeNull();
  });
  it("đơn ĐÃ có phiếu thu / hoá đơn trước mốc ⇒ null (giữ ba/mẹ)", () => {
    expect(conChoNguoiMua(ung({ chungTuTruocMoc: true, tenTrenDon: "Con" }))).toBeNull();
  });
  it("không có tên con ở đâu cả ⇒ null", () => {
    expect(conChoNguoiMua(ung())).toBeNull();
    expect(conChoNguoiMua(ung({ tenTrenDon: "  ", tenHoSo: "" }))).toBeNull();
  });
  it("giá trị TRÊN ĐƠN thắng hồ sơ; thiếu thì rơi về hồ sơ", () => {
    expect(conChoNguoiMua(ung({ tenTrenDon: "Tên trên đơn", tenHoSo: "Tên hồ sơ", cccdHoSo: "048000000009" }))).toEqual({ hoTen: "Tên trên đơn", cccd: "048000000009" });
    expect(conChoNguoiMua(ung({ tenTrenDon: "A", cccdTrenDon: "048000000001", cccdHoSo: "048000000009" }))).toEqual({ hoTen: "A", cccd: "048000000001" });
    expect(conChoNguoiMua(ung({ tenHoSo: "Chỉ hồ sơ" }))).toEqual({ hoTen: "Chỉ hồ sơ", cccd: null });
  });
  it("không có tên con ở đâu cả hoặc hồ sơ trống ⇒ null (đối chứng của ca «0 học viên» ở [NMC-07])", () => {
    expect(conChoNguoiMua(ung({ tenTrenDon: null, tenHoSo: null, cccdHoSo: "048000000009" }))).toBeNull();
  });
});

// ─── [NMC-07] ĐƠN NHIỀU CON — mỗi chứng từ một bé, so với ba/mẹ ĐỘC LẬP (chủ dự án 17/11/2026) ─────────────────────────────────────────────────────────────────────
const tt = (o: Partial<ThongTinConDon> = {}): ThongTinConDon => ({
  apDung: true,
  chungTuTruocMoc: false,
  tenTrenDon: null,
  cccdTrenDon: null,
  khaiThem: [],
  hocVienCuaDon: null,
  hocVien: {},
  hocVienCuaDong: {},
  ...o,
});
/** Đơn hai con: A (đủ tên + CCCD ở hồ sơ), B (chỉ có tên). Dòng iA → A, iB → B. */
const HAI_CON = tt({
  hocVien: { sA: { ten: "Bé A", cccd: "048000000001" }, sB: { ten: "Bé B", cccd: null } },
  hocVienCuaDong: { iA: "sA", iB: "sB" },
});

describe("[NMC-07] conChoChungTu — đơn nhiều con", () => {
  it("chứng từ của bé A ⇒ thông tin bé A; của bé B ⇒ thông tin bé B (mỗi tờ một bé)", () => {
    expect(conChoChungTu(HAI_CON, ["iA"])).toEqual({ hoTen: "Bé A", cccd: "048000000001" });
    expect(conChoChungTu(HAI_CON, ["iB"])).toEqual({ hoTen: "Bé B", cccd: null });
    expect(conChoChungTu(HAI_CON, ["iA", "iA"])).toEqual({ hoTen: "Bé A", cccd: "048000000001" });
  });
  it("chứng từ GỘP khoản của hai bé ⇒ null (một tờ không đứng tên hai bé) ⇒ ba/mẹ", () => {
    expect(conChoChungTu(HAI_CON, ["iA", "iB"])).toBeNull();
  });
  it("cả đơn (không truyền chứng từ — màn đơn) ⇒ đơn hai con ra null", () => {
    expect(conChoChungTu(HAI_CON)).toBeNull();
  });
  it("luật tắt / đơn đã có chứng từ trước mốc ⇒ null cho MỌI bé", () => {
    expect(conChoChungTu(tt({ ...HAI_CON, apDung: false }), ["iA"])).toBeNull();
    expect(conChoChungTu({ ...HAI_CON, chungTuTruocMoc: true }, ["iA"])).toBeNull();
    expect(conChoChungTu(null, ["iA"])).toBeNull();
  });
  it("khoản chưa gắn dòng (null) ⇒ bé mặc định của đơn; không có bé mặc định ⇒ null", () => {
    expect(conChoChungTu({ ...HAI_CON, hocVienCuaDon: "sA" }, [null])).toEqual({ hoTen: "Bé A", cccd: "048000000001" });
    expect(conChoChungTu(HAI_CON, [null])).toBeNull();
  });
  it("ô «em thứ nhất» trên đơn ghép theo HỌ TÊN: em thứ nhất = Bé A ⇒ CCCD trên đơn thắng hồ sơ; em khai thêm = Bé B ⇒ CCCD khai thêm", () => {
    const d = { ...HAI_CON, tenTrenDon: " bé  a ", cccdTrenDon: "048111111111", khaiThem: [{ ten: "Bé B", cccd: "048222222222" }] };
    expect(conChoChungTu(d, ["iA"])).toEqual({ hoTen: "bé  a", cccd: "048111111111" });
    expect(conChoChungTu(d, ["iB"])).toEqual({ hoTen: "Bé B", cccd: "048222222222" });
  });
  it("ô trên đơn KHÔNG khớp tên bé nào ⇒ chỉ dùng hồ sơ của chính bé (không gán nhầm CCCD của em khác)", () => {
    const d = { ...HAI_CON, tenTrenDon: "Em Lạ", cccdTrenDon: "048999999999" };
    expect(conChoChungTu(d, ["iA"])).toEqual({ hoTen: "Bé A", cccd: "048000000001" });
    expect(conChoChungTu(d, ["iB"])).toEqual({ hoTen: "Bé B", cccd: null });
  });
  it("đơn MỘT con không khai thêm: ô trên đơn thắng hồ sơ (hành vi #1247 không đổi)", () => {
    const d = tt({ tenTrenDon: "Tên trên đơn", hocVien: { sA: { ten: "Tên hồ sơ", cccd: "048000000001" } }, hocVienCuaDong: { iA: "sA" }, hocVienCuaDon: "sA" });
    expect(conChoChungTu(d, ["iA"])).toEqual({ hoTen: "Tên trên đơn", cccd: "048000000001" });
    expect(conChoChungTu(d)).toEqual({ hoTen: "Tên trên đơn", cccd: "048000000001" });
  });
  it("đơn chưa gắn học viên nào mà Sale đã gõ tên con ⇒ dùng ô trên đơn; nhưng nếu còn khai thêm em thì không biết ô đó của em nào ⇒ null", () => {
    expect(conChoChungTu(tt({ tenTrenDon: "Con Do Sale Gõ", cccdTrenDon: "048000000077" }), [null])).toEqual({ hoTen: "Con Do Sale Gõ", cccd: "048000000077" });
    expect(conChoChungTu(tt({ tenTrenDon: "A", khaiThem: [{ ten: "B", cccd: null }] }), [null])).toBeNull();
  });
});

describe("[NMC-07b] khai thêm em mà không truy được về dòng đơn ⇒ ba/mẹ (không đoán)", () => {
  it("có khai thêm em nhưng đơn chỉ có MỘT học viên (các em kia không có hồ sơ) ⇒ null", () => {
    const d = tt({ khaiThem: [{ ten: "Em hai", cccd: null }], hocVien: { sA: { ten: "Bé A", cccd: "048000000001" } }, hocVienCuaDong: { iA: "sA" }, hocVienCuaDon: "sA" });
    expect(conChoChungTu(d, ["iA"])).toBeNull();
    expect(conChoChungTu(d)).toBeNull();
  });
  it("đơn hai học viên + khai thêm: khoản CHƯA gắn dòng (null) không truy được bé ⇒ null; khoản có dòng thì vẫn ra đúng bé", () => {
    const d = { ...HAI_CON, hocVienCuaDon: "sA", khaiThem: [{ ten: "Bé B", cccd: "048222222222" }] };
    expect(conChoChungTu(d, [null])).toBeNull();
    expect(conChoChungTu(d, ["iB"])).toEqual({ hoTen: "Bé B", cccd: "048222222222" });
  });
});

describe("[NMC-08] đơn nhiều con: MỖI tờ so với ba/mẹ ĐỘC LẬP — bé A ≥ ba/mẹ ra tờ của A; bé B < ba/mẹ vẫn ra ba/mẹ", () => {
  const ph = { hoTen: "Mẹ", cccd: "048000000099" }; // ba/mẹ có tên + CCCD (2 điểm)
  it("bé A (tên + CCCD = 2 điểm) bằng mẹ ⇒ CON; bé B (chỉ tên = 1 điểm) kém mẹ ⇒ MẸ", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: ph, con: conChoChungTu(HAI_CON, ["iA"]), coDonVi: false })).toBe("CON");
    expect(quyetNguoiMuaTheoCon({ phuHuynh: ph, con: conChoChungTu(HAI_CON, ["iB"]), coDonVi: false })).toBe("PHU_HUYNH");
  });
  it("mẹ chỉ có tên ⇒ cả hai bé ≥ mẹ ⇒ hai tờ, mỗi tờ một bé (TH3 nhân đôi)", () => {
    const me = { hoTen: "Mẹ", cccd: null };
    expect(quyetNguoiMuaTheoCon({ phuHuynh: me, con: conChoChungTu(HAI_CON, ["iA"]), coDonVi: false })).toBe("CON");
    expect(quyetNguoiMuaTheoCon({ phuHuynh: me, con: conChoChungTu(HAI_CON, ["iB"]), coDonVi: false })).toBe("CON");
  });
  it("tờ gộp hai bé ⇒ ba/mẹ dù mẹ chỉ có tên", () => {
    expect(quyetNguoiMuaTheoCon({ phuHuynh: { hoTen: "Mẹ", cccd: null }, con: conChoChungTu(HAI_CON, ["iA", "iB"]), coDonVi: false })).toBe("PHU_HUYNH");
  });
});
