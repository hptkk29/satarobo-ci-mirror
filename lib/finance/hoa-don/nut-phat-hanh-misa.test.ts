// Ca [PHM-05..06] — nút "Phát hành qua MISA" + khối trạng thái bản đang / lỗi phát hành. THUẦN.
// Mọi ca "KHÔNG hiện" đi kèm đối chứng dương cùng đầu vào trừ đúng một vế (CLAUDE.md luật 11).
import { describe, expect, it } from "vitest";
import { CAU_THAY_THE_LAM_TAY, khoiMisa, nutPhatHanhMisa } from "./nut-phat-hanh-misa";
import type { NguoiMuaHoaDon } from "./nguoi-mua";

const HD_TOT = { taiLen: { bat: true }, ngoaiLe: null };
/** Người mua HỢP LỆ với MISA — đối chứng dương cho mọi ca [PHM-06b]. */
const NM: NguoiMuaHoaDon = {
  hoTen: "Nguyễn Văn An",
  tenDonVi: null,
  maSoThue: null,
  diaChi: "12 Lê Lợi, Đà Nẵng",
  cccd: null,
  email: "ph@example.com",
  dienThoai: null,
};
const vao = (o: Partial<Parameters<typeof nutPhatHanhMisa>[0]> = {}) => ({
  misa: { moiTruong: "sandbox" as const },
  ngan: "cho",
  coQuyen: true,
  phapNhanMisa: true,
  nhaCungCap: "MISA_MEINVOICE" as const,
  thieuCauHinh: null,
  thayThe: false,
  hanhDong: HD_TOT,
  thieuNguoiMua: [],
  nguoiMua: NM,
  hoanChan: null,
  ...o,
});

// Smoke 30/09: email "…@x.c" (đuôi 1 chữ) qua được cổng người mua cũ (`thieuChoHoaDon` không soi email) ⇒ nút
// SÁNG, rồi MISA mới từ chối lúc gửi — đốt một lượt gửi + một bản LOI_PHAT_HANH. Luật MISA hỏi ở MỘT chỗ
// (`kiemNguoiMua`, lib/misa/meinvoice/anh-xa.ts) — nút và máy trạng thái cùng gọi.
describe("[PHM-06b] người mua KHÔNG hợp lệ theo luật MISA ⇒ nút tắt, nói rõ ô nào", () => {
  it("đối chứng dương: người mua hợp lệ ⇒ sáng", () => {
    expect(nutPhatHanhMisa(vao()).bat).toBe(true);
  });
  it.each([
    ["email đuôi tên miền 1 chữ", { email: "ph@example.c" }, /^Email người mua không hợp lệ với MISA: /],
    ["email đuôi tên miền 7 chữ", { email: "ph@example.academy" }, /^Email người mua không hợp lệ với MISA: /],
    ["email có dấu", { email: "phụhuynh@example.com" }, /^Email người mua không hợp lệ với MISA: /],
    ["MST 12 số (CCCD chủ hộ) — cổng cũ nhận", { tenDonVi: "Hộ KD An", maSoThue: "049189012543" }, /^MST người mua không hợp lệ với MISA: /],
    ["MST 13 số liền — cổng cũ nhận", { tenDonVi: "Công ty An", maSoThue: "0401234567001" }, /^MST người mua không hợp lệ với MISA: /],
    ["có MST mà thiếu tên đơn vị — cổng cũ không hỏi chiều này", { maSoThue: "0401234567" }, /tên đơn vị/],
  ])("%s ⇒ hiện mà TẮT", (_ten, o, lyDo) => {
    const r = nutPhatHanhMisa(vao({ nguoiMua: { ...NM, ...o } }));
    expect(r).toMatchObject({ hien: true, bat: false });
    expect(r.lyDo).toMatch(lyDo);
    expect(r.lyDo).toMatch(/sửa trên đơn rồi phát hành$/);
  });
  it("lý do KHÔNG in lại địa chỉ email (màn che PII khi thiếu orders:view-pii)", () => {
    expect(nutPhatHanhMisa(vao({ nguoiMua: { ...NM, email: "bimat@example.c" } })).lyDo).not.toContain("bimat");
  });
  it("'Phát hành lại' bản LỖI cũng tắt với CÙNG câu (không đốt thêm một lượt gửi)", () => {
    const hdLoi = {
      id: "hd1",
      trangThai: "LOI_PHAT_HANH" as const,
      updatedAt: new Date("2026-09-30T03:00:00Z"),
      kyHieu: "1C26TSR",
      soHoaDon: null,
      misaLoiMa: "X",
      misaLoiThongDiep: "sai",
      misaSoLanGui: 1,
      misaGuiLuc: null,
      nguonPhatHanh: "MISA_API",
    };
    const MISA = { moiTruong: "production" as const };
    const tot = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hdLoi, misa: MISA, coQuyen: true, thieuNguoiMua: [], nguoiMua: NM });
    expect(tot.phatHanhLai.bat).toBe(true);
    const k = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hdLoi, misa: MISA, coQuyen: true, thieuNguoiMua: [], nguoiMua: { ...NM, email: "ph@example.c" } });
    expect(k.phatHanhLai).toMatchObject({ bat: false, lyDo: expect.stringMatching(/^Email người mua không hợp lệ với MISA: /) });
    expect(k.boLamTay.bat).toBe(true);
  });
});

describe("[PHM-05] nút Phát hành qua MISA — HIỆN khi nào", () => {
  it("đối chứng dương: đủ mọi điều kiện ⇒ hiện + sáng + nói môi trường", () => {
    expect(nutPhatHanhMisa(vao())).toEqual({ hien: true, bat: true, cau: null, moiTruong: "sandbox", nhaCungCap: "MISA_MEINVOICE" });
    // [02/11/2026] pháp nhân VIN: cùng luật, nút mang nhà cung cấp VIN và câu lỗi nói tên VIN
    expect(nutPhatHanhMisa(vao({ nhaCungCap: "VIN_HOADON" }))).toMatchObject({ hien: true, bat: true, nhaCungCap: "VIN_HOADON" });
    const khoa = nutPhatHanhMisa(vao({ nhaCungCap: "VIN_HOADON", hanhDong: { taiLen: { bat: true }, ngoaiLe: { loai: "NGHI_TRUNG" } } as never }));
    expect(khoa.lyDo).toMatch(/VIN-HOADON/);
    expect(khoa.lyDo).not.toMatch(/MISA/);
    expect(nutPhatHanhMisa(vao({ ngan: "lech" })).hien).toBe(true);
  });
  it.each([
    ["công tắc tắt / cổng null", { misa: null }],
    ["không phải kế toán đúng cơ sở", { coQuyen: false }],
    ["pháp nhân không dùng MISA (VIN HOADON)", { phapNhanMisa: false }],
    ["ngăn đã tải tệp", { ngan: "nhap" }],
    ["ngăn đã xuất", { ngan: "da-xuat" }],
    ["ngăn đơn huỷ", { ngan: "don-huy" }],
    ["ngăn đang phát hành", { ngan: "phat-hanh" }],
  ])("%s ⇒ KHÔNG hiện", (_ten, o) => {
    const r = nutPhatHanhMisa(vao(o as Partial<Parameters<typeof nutPhatHanhMisa>[0]>));
    expect(r.hien).toBe(false);
    expect(r.bat).toBe(false);
  });
  it("hoá đơn THAY THẾ ⇒ không hiện nút, in câu 'làm tại MISA rồi tải lên'", () => {
    expect(nutPhatHanhMisa(vao({ thayThe: true }))).toMatchObject({ hien: false, cau: CAU_THAY_THE_LAM_TAY });
  });
});

describe("[PHM-06] nút hiện mà TẮT — kèm lý do", () => {
  it("kho chưa cấu hình ⇒ tắt với câu của kho", () => {
    const r = nutPhatHanhMisa(vao({ hanhDong: { taiLen: { bat: false, lyDo: "Kho lưu hoá đơn chưa cấu hình" }, ngoaiLe: null } }));
    expect(r).toMatchObject({ hien: true, bat: false, lyDo: "Kho lưu hoá đơn chưa cấu hình" });
  });
  it("lần thu thiếu / nghi trùng ⇒ tắt, trỏ sang luồng tải lên có lý do", () => {
    const thieu = nutPhatHanhMisa(vao({ hanhDong: { taiLen: { bat: true }, ngoaiLe: { loai: "THEO_SO_DA_THU", daChon: false, cau: "" } } }));
    expect(thieu.bat).toBe(false);
    expect(thieu.lyDo).toMatch(/thiếu tiền/);
    const trung = nutPhatHanhMisa(vao({ hanhDong: { taiLen: { bat: true }, ngoaiLe: { loai: "KHONG_TRUNG", daChon: false, cau: "" } } }));
    expect(trung.lyDo).toMatch(/nghi trùng/);
  });
  it("yêu cầu hoàn chạm lần thu ⇒ tắt với ĐÚNG câu `chotHoaDon` ném", () => {
    expect(nutPhatHanhMisa(vao({ hoanChan: "CÂU HOÀN" }))).toMatchObject({ hien: true, bat: false, lyDo: "CÂU HOÀN" });
  });
  it("người mua thiếu (MST với đơn vị) ⇒ tắt, nói thiếu gì", () => {
    const r = nutPhatHanhMisa(vao({ thieuNguoiMua: ["Mã số thuế (đã ghi tên đơn vị thì bắt buộc có MST)"] }));
    expect(r.bat).toBe(false);
    expect(r.lyDo).toMatch(/Mã số thuế/);
  });
});

describe("[PHM-07] khối bản đang / lỗi phát hành", () => {
  const hd = (o: Partial<Parameters<typeof khoiMisa>[0]["hd"]> = {}) => ({
    id: "hd1",
    trangThai: "DANG_PHAT_HANH" as const,
    updatedAt: new Date("2026-09-30T03:00:00Z"),
    kyHieu: "1C26TSR",
    soHoaDon: null,
    misaLoiMa: null,
    misaLoiThongDiep: null,
    misaSoLanGui: 1,
    misaGuiLuc: new Date("2026-09-30T03:00:00Z"),
    nguonPhatHanh: "MISA_API",
    ...o,
  });
  const MISA = { moiTruong: "production" as const };
  it("ĐANG: 'Kiểm tra lại' sáng; không có phát hành lại / bỏ", () => {
    const k = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd(), misa: MISA, coQuyen: true, thieuNguoiMua: [], nguoiMua: NM });
    expect([k.kiemTraLai.bat, k.phatHanhLai.bat, k.boLamTay.bat]).toEqual([true, false, false]);
    expect(k.guiLucLabel).toBe("10:00 30/09/2026");
    expect(k.so).toBeNull();
    expect(khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd({ soHoaDon: "88" }), misa: MISA, coQuyen: true, thieuNguoiMua: [], nguoiMua: NM }).so).toBe("1C26TSR-88");
  });
  it("LỖI: phát hành lại + bỏ làm tay sáng; 'Bỏ, làm tay' KHÔNG cần cổng (tắt MISA vẫn nhả được khoản)", () => {
    const k = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd({ trangThai: "LOI_PHAT_HANH" }), misa: MISA, coQuyen: true, thieuNguoiMua: [], nguoiMua: NM });
    expect([k.kiemTraLai.bat, k.phatHanhLai.bat, k.boLamTay.bat]).toEqual([false, true, true]);
    const khongCong = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd({ trangThai: "LOI_PHAT_HANH" }), misa: null, coQuyen: true, thieuNguoiMua: [], nguoiMua: NM });
    expect(khongCong.phatHanhLai).toMatchObject({ bat: false, lyDo: expect.stringMatching(/kết nối MISA/) });
    expect(khongCong.boLamTay.bat).toBe(true);
  });
  it("LỖI mà người mua còn thiếu ⇒ phát hành lại tắt, nói sửa gì trên đơn", () => {
    const k = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd({ trangThai: "LOI_PHAT_HANH" }), misa: MISA, coQuyen: true, thieuNguoiMua: ["Địa chỉ người mua"], nguoiMua: NM });
    expect(k.phatHanhLai).toMatchObject({ bat: false, lyDo: expect.stringMatching(/Địa chỉ người mua/) });
  });
  it("không quyền ⇒ mọi nút tắt kèm lý do quyền; bản mô phỏng gắn cờ", () => {
    const k = khoiMisa({ nhaCungCap: "MISA_MEINVOICE" as const, hd: hd({ trangThai: "LOI_PHAT_HANH", nguonPhatHanh: "MISA_GIA_LAP" }), misa: MISA, coQuyen: false, thieuNguoiMua: [], nguoiMua: NM });
    expect(k.boLamTay).toMatchObject({ bat: false, lyDo: expect.stringMatching(/payments:confirm/) });
    expect(k.moPhong).toBe(true);
  });
});

// [HMC-1x] S1 Invoice Hub (01/11/2026) — máy phát hành CHẶN khi cơ sở chưa có cấu hình hoá đơn dùng được cho hôm nay,
// nên nút phải tắt kèm đúng câu của hàm quyết (`phapNhanPhatHanhChoCoSo`) thay vì sáng rồi bị từ chối (luật 12).
describe("[HMC-10] cơ sở chưa có cấu hình hoá đơn dùng được ⇒ nút HIỆN nhưng TẮT, kèm câu của resolver", () => {
  const CAU = "Cơ sở chưa khai cấu hình hoá đơn (pháp nhân + ký hiệu) có hiệu lực ngày 2026-11-02 — khai ở màn Cấu hình ký hiệu trước khi lưu hoá đơn mới.";
  it("đối chứng dương: cùng đầu vào, thieuCauHinh=null ⇒ sáng", () => {
    expect(nutPhatHanhMisa(vao({ thieuCauHinh: null }))).toMatchObject({ hien: true, bat: true });
  });
  it("thieuCauHinh có câu ⇒ hien=true, bat=false, lyDo đúng câu đó (không câu chung chung)", () => {
    expect(nutPhatHanhMisa(vao({ thieuCauHinh: CAU }))).toMatchObject({ hien: true, bat: false, lyDo: CAU });
  });
  // [HMC-10b] THỨ TỰ ƯU TIÊN của lý do tắt (luật 12: nút nói đúng nguyên nhân). Máy phát hành ném CAU_HINH_CO_SO ở cổng
  // ĐẦU TIÊN sau các cổng chốt; nếu cơ sở chưa có cấu hình mà nút lại in lý do của một vế muộn hơn (kho chưa cấu hình, lần
  // thu thiếu tiền, người mua thiếu…), kế toán sửa vế đó xong vẫn bị chặn ở cấu hình — nút nói một nguyên nhân KHÁC nguyên
  // nhân thật. Mỗi ca bật ĐỒNG THỜI thieuCauHinh và đúng MỘT lý do muộn hơn; đối chứng dương: bỏ thieuCauHinh ⇒ lý do muộn
  // đó mới hiện (chứng minh đầu vào thật sự mang lý do kia, ca không xanh vì lý do muộn "không có").
  const LY_DO_MUON: ReadonlyArray<[string, Partial<Parameters<typeof nutPhatHanhMisa>[0]>, RegExp]> = [
    ["kho tệp chưa cấu hình (taiLen tắt)", { hanhDong: { taiLen: { bat: false, lyDo: "Kho lưu hoá đơn chưa cấu hình" }, ngoaiLe: null } }, /^Kho lưu hoá đơn chưa cấu hình$/],
    ["lần thu thiếu tiền (ngoại lệ THEO_SO_DA_THU)", { hanhDong: { taiLen: { bat: true }, ngoaiLe: { loai: "THEO_SO_DA_THU", daChon: false, cau: "" } } }, /thiếu tiền/],
    ["lần thu nghi trùng (ngoại lệ KHONG_TRUNG)", { hanhDong: { taiLen: { bat: true }, ngoaiLe: { loai: "KHONG_TRUNG", daChon: false, cau: "" } } }, /nghi trùng/],
    ["yêu cầu hoàn chạm lần thu", { hoanChan: "CÂU HOÀN" }, /^CÂU HOÀN$/],
    ["người mua thiếu ô bắt buộc", { thieuNguoiMua: ["Địa chỉ người mua"] }, /Địa chỉ người mua/],
    ["người mua sai luật MISA (email đuôi 1 chữ)", { nguoiMua: { ...NM, email: "ph@example.c" } }, /^Email người mua không hợp lệ với MISA: /],
  ];
  it.each(LY_DO_MUON)("thieuCauHinh THẮNG %s — in câu cấu hình, không in lý do muộn hơn", (_ten, muon, lyDoMuon) => {
    const khiThieuCauHinh = nutPhatHanhMisa(vao({ thieuCauHinh: CAU, ...muon }));
    expect(khiThieuCauHinh).toMatchObject({ hien: true, bat: false, lyDo: CAU });
    // Đối chứng dương: cùng đầu vào, cấu hình đủ ⇒ chính lý do muộn hơn hiện ra.
    const khiDuCauHinh = nutPhatHanhMisa(vao({ thieuCauHinh: null, ...muon }));
    expect(khiDuCauHinh).toMatchObject({ hien: true, bat: false });
    expect(khiDuCauHinh.lyDo).toMatch(lyDoMuon);
  });
  it.each<[string, Partial<Parameters<typeof nutPhatHanhMisa>[0]>]>([
    ["công tắc tắt / cổng null", { misa: null }],
    ["không phải kế toán đúng cơ sở", { coQuyen: false }],
    ["pháp nhân mặc định không dùng MISA", { phapNhanMisa: false }],
    ["ngăn đã xuất", { ngan: "da-xuat" }],
  ])("%s ⇒ vẫn KHÔNG hiện dù thiếu cấu hình (không lộ câu cấu hình cho người không có việc ở đây)", (_ten, o) => {
    const r = nutPhatHanhMisa(vao({ thieuCauHinh: CAU, ...o }));
    expect(r.hien).toBe(false);
  });
});
