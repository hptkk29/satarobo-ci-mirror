// Ca [HVT-*] — các EM CÒN LẠI của đơn nhiều con trên biểu mẫu QR (09/11/2026). Luật thuần, không DB.
import { describe, expect, it } from "vitest";
import {
  TOI_DA_HOC_VIEN_THEM,
  cheHocVienThem,
  dienSanHocVienThem,
  docHocVienThemLuu,
  docHocVienThemTho,
  dungHocVienThemLuu,
  giongHocVienThem,
  hopNhatHocVienThem,
  kiemHocVienThem,
  type HocVienThem,
} from "./hoc-vien-them";

const tho = (ten: string, ngaySinh = "", cccd = "") => ({ ten, ngaySinh, cccd });
const em = (ten: string, ngaySinh: string | null = null, cccd: string | null = null): HocVienThem => ({ ten, ngaySinh, cccd });

describe("[HVT-01] đọc đầu vào không tin cậy", () => {
  it("không phải mảng / phần tử không phải object / khoá lạ ⇒ bỏ, kiểu sai ⇒ ô rỗng", () => {
    expect(docHocVienThemTho(null)).toEqual([]);
    expect(docHocVienThemTho("x")).toEqual([]);
    expect(docHocVienThemTho({ ten: "A" })).toEqual([]);
    expect(docHocVienThemTho([1, null, "a", [], { ten: 5, khoaLa: "x", ngaySinh: "2016-01-02" }])).toEqual([{ ten: "", ngaySinh: "2016-01-02", cccd: "" }]);
  });
  it("chuỗi quá dài bị cắt ở trần 500 ký tự (chặn gói tin khổng lồ)", () => {
    expect(docHocVienThemTho([{ ten: "a".repeat(9000) }])[0]!.ten.length).toBe(500);
  });
});

describe("[HVT-02] kiểm danh sách", () => {
  it("dòng HOÀN TOÀN TRỐNG bị bỏ — không phải lỗi; dòng đủ được chuẩn hoá", () => {
    const r = kiemHocVienThem([tho(""), tho("  Trần  Văn Bé ", "2016-08-03", "048 987 654 321"), tho("   ")]);
    expect(r).toEqual({ ok: true, ds: [{ ten: "Trần Văn Bé", ngaySinh: "2016-08-03", cccd: "048987654321" }] });
  });
  it("ô tuỳ chọn trống ⇒ null (không phải chuỗi rỗng)", () => {
    expect(kiemHocVienThem([tho("Trần Văn Bé")])).toEqual({ ok: true, ds: [{ ten: "Trần Văn Bé", ngaySinh: null, cccd: null }] });
  });
  it("có ngày sinh hoặc CCCD mà thiếu TÊN ⇒ lỗi đúng dòng, đúng ô; lỗi giữ chỉ số GỐC kể cả khi dòng trước là dòng trống", () => {
    const r = kiemHocVienThem([tho(""), tho("", "2016-08-03"), tho("", "", "048987654321")]);
    expect(r).toEqual({ ok: false, theoDong: { 1: { ten: "Nhập họ và tên học viên" }, 2: { ten: "Nhập họ và tên học viên" } } });
  });
  it("định dạng sai ⇒ lời của CHÍNH schema ba ô học viên cũ (không có bản luật thứ hai)", () => {
    const r = kiemHocVienThem([tho("Bé A", "03/08/2016", "123")]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.theoDong[0]!.ngaySinh).toMatch(/năm-tháng-ngày/);
      expect(r.theoDong[0]!.cccd).toMatch(/12 chữ số/);
      expect(r.theoDong[0]!.ten).toBeUndefined();
    }
  });
  it(`tối đa ${TOI_DA_HOC_VIEN_THEM} em thêm: đúng trần qua, quá trần bị TỪ CHỐI (không cắt lặng lẽ); dòng trống không tính vào trần`, () => {
    const nam = Array.from({ length: TOI_DA_HOC_VIEN_THEM }, (_, i) => tho(`Bé số ${i + 1}`));
    expect(kiemHocVienThem(nam).ok).toBe(true);
    expect(kiemHocVienThem([...nam, tho(""), tho("")]).ok).toBe(true);
    const qua = kiemHocVienThem([...nam, tho("Bé thừa")]);
    expect(qua.ok).toBe(false);
    if (!qua.ok) expect(qua.chung).toMatch(/tối đa 6 học viên/);
  });
});

describe("[HVT-03] đọc lại cột đã lưu — phòng thủ", () => {
  it("null / không phải mảng / phần tử hỏng ⇒ bỏ, không ném", () => {
    expect(docHocVienThemLuu(null)).toEqual([]);
    expect(docHocVienThemLuu({ a: 1 })).toEqual([]);
    expect(docHocVienThemLuu([null, 3, { ten: "" }, { ten: 9 }, { ten: "Bé A", ngaySinh: 5, cccd: null }])).toEqual([em("Bé A")]);
  });
  it("quá trần ⇒ chỉ giữ phần đầu; vòng khứ hồi dungHocVienThemLuu → docHocVienThemLuu giữ nguyên; rỗng ⇒ null", () => {
    const nhieu = Array.from({ length: 9 }, (_, i) => ({ ten: `Bé ${i}` }));
    expect(docHocVienThemLuu(nhieu)).toHaveLength(TOI_DA_HOC_VIEN_THEM);
    const ds = [em("Bé A", "2016-08-03", "048987654321"), em("Bé B")];
    expect(docHocVienThemLuu(dungHocVienThemLuu(ds))).toEqual(ds);
    expect(dungHocVienThemLuu([])).toBeNull();
  });
});

describe("[HVT-04] hợp nhất vào bản đang lưu — ô trống KHÔNG xoá, ghép theo TÊN chứ không theo chỉ số", () => {
  const luu = [em("Bé A", "2016-08-03", "048111111111"), em("Bé B", "2018-01-02", "048222222222")];
  it("phụ huynh gửi lại tên mà không gõ lại CCCD ⇒ giữ CCCD + ngày sinh đang lưu của CHÍNH em đó", () => {
    expect(hopNhatHocVienThem(luu, [em("Bé A"), em("Bé B")])).toEqual(luu);
    expect(hopNhatHocVienThem(luu, [em("bé a")])[0]).toEqual({ ten: "bé a", ngaySinh: "2016-08-03", cccd: "048111111111" });
  });
  it("GỠ em ở giữa: CCCD của em bị gỡ biến mất cùng em, và KHÔNG trượt sang em kế (ghép theo chỉ số sẽ gán CCCD của A cho B)", () => {
    const r = hopNhatHocVienThem(luu, [em("Bé B")]);
    expect(r).toEqual([em("Bé B", "2018-01-02", "048222222222")]);
    expect(JSON.stringify(r)).not.toContain("048111111111");
  });
  it("đổi TÊN em ⇒ coi là em khác: không thừa hưởng CCCD của tên cũ", () => {
    expect(hopNhatHocVienThem(luu, [em("Bé C")])).toEqual([em("Bé C")]);
  });
  it("giá trị phụ huynh GÕ MỚI thắng giá trị đang lưu", () => {
    expect(hopNhatHocVienThem(luu, [em("Bé A", "2016-09-09", "048333333333")])[0]).toEqual(em("Bé A", "2016-09-09", "048333333333"));
  });
  it("hai em TRÙNG TÊN: mỗi bản lưu chỉ được ghép một lần, theo thứ tự", () => {
    const trung = [em("Bé Na", null, "048111111111"), em("Bé Na", null, "048222222222")];
    expect(hopNhatHocVienThem(trung, [em("Bé Na"), em("Bé Na")])).toEqual(trung);
  });
});

describe("[HVT-05] điền sẵn + che + so sánh", () => {
  it("điền sẵn KHÔNG BAO GIỜ mang CCCD (kể cả khi đang lưu)", () => {
    const d = dienSanHocVienThem([em("Bé A", "2016-08-03", "048111111111")]);
    expect(d).toEqual([em("Bé A", "2016-08-03", null)]);
    expect(JSON.stringify(d)).not.toContain("048111111111");
  });
  it("thiếu quyền xem thông tin cá nhân ⇒ chỉ còn TÊN; có quyền ⇒ đủ; không đổi bản gốc", () => {
    const goc = [em("Bé A", "2016-08-03", "048111111111")];
    expect(cheHocVienThem(goc, false)).toEqual([em("Bé A")]);
    expect(cheHocVienThem(goc, true)).toEqual(goc);
    expect(goc[0]!.cccd).toBe("048111111111");
  });
  it("giongHocVienThem: khác số lượng / khác ô / khác thứ tự ⇒ false", () => {
    const a = [em("Bé A", "2016-08-03"), em("Bé B")];
    expect(giongHocVienThem(a, [em("Bé A", "2016-08-03"), em("Bé B")])).toBe(true);
    expect(giongHocVienThem(a, [em("Bé A", "2016-08-03")])).toBe(false);
    expect(giongHocVienThem(a, [em("Bé A", "2016-08-04"), em("Bé B")])).toBe(false);
    expect(giongHocVienThem(a, [em("Bé B"), em("Bé A", "2016-08-03")])).toBe(false);
  });
});
