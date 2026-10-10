// @vitest-environment node
/**
 * [FRN-*] — PHẦN THUẦN của biểu mẫu Tạo / Sửa nguồn (`lib/nguon/form-nguon.ts`). Luật ĐƯỢC/KHÔNG ĐƯỢC KHÔNG viết lại ở đây: biểu mẫu chạy
 * CHÍNH `taoNguonSchema` / `suaNguonSchema` / `kiemSuaNguon` của `danh-muc-ghi-dau-vao.ts`; tệp này chỉ dịch ô nhập ↔ payload và dịch lỗi ra tiếng Việt.
 *
 *   [FRN-01] ngày theo giờ Việt Nam: ô ngày ↔ ISO, vòng tròn không lệch ngày
 *   [FRN-02] biểu mẫu trống: mặc định an toàn (nháp, chưa chọn nhóm, ai cũng chọn được)
 *   [FRN-03] kiểm tạo: mỗi lỗi đặt ĐÚNG ô, câu tiếng Việt (không lọt chữ Anh của Zod)
 *   [FRN-04] payload tạo khớp ĐÚNG tập khoá của `taoNguonSchema` (thêm trường vào schema mà quên ô ⇒ đỏ)
 *   [FRN-05] payload sửa chỉ chứa trường THẬT SỰ đổi (gửi lại ngày cũ không phải là đổi)
 *   [FRN-06] phân tích sửa: ô khoá, lý do đổi nhạy cảm, mặc định của quy nguồn
 *   [FRN-07] đổi ai-nhận-tiền: cảnh báo; thiếu quyền kích hoạt ⇒ chặn nút Lưu, kèm TÊN khoá
 *   [FRN-08] thao tác trạng thái: nút chỉ cho chuyển hợp lệ; hệ thống / đích mặc định có lý do thay nút
 */
import { describe, expect, it } from "vitest";
import {
  bienFormSua,
  bienFormTao,
  CAU_THIEU_QUYEN_KICH_HOAT,
  chanKhiTao,
  formTrong,
  formTuNguon,
  isoTuNgayVN,
  kiemFormTao,
  ngayVNTuISO,
  phanTichSua,
  phuDeTrangSua,
  thaoTacTrangThai,
  type BoiCanhSua,
  type GiaTriForm,
  type NguonFormView,
} from "./form-nguon";
import { taoNguonSchema, truongBiKhoa } from "./danh-muc-ghi-dau-vao";

const NOW = new Date("2026-10-09T03:00:00.000Z");
/** Nguồn KHÔNG dính chính sách riêng, không rule chủ-nguồn chạy — nút trạng thái không bị chặn bởi cổng «đụng tiền». */
const KHONG_DINH_TIEN = { chinhSachRieng: false, ruleChuChay: false };

const nguonMau = (p: Partial<NguonFormView> = {}): NguonFormView => ({
  id: "g1",
  code: "TIKTOK_ADS",
  name: "TikTok Ads",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  status: "ACTIVE",
  isSystem: false,
  sortOrder: 120,
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployee: null,
  effectiveFrom: null,
  effectiveTo: null,
  capNhatLuc: "2026-10-09T02:00:00.000Z",
  daDung: { attribution: false, touchpoint: false, phienBanChinhSach: false, so: false, page: false, nhomNhanSuMacDinh: false, daDung: false },
  ...p,
});

const boiCanh = (p: Partial<BoiCanhSua> = {}): BoiCanhSua => ({
  laDichMacDinh: false,
  nowIso: NOW.toISOString(),
  coQuyenKichHoat: true,
  dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false },
  ...p,
});

const formHopLe = (p: Partial<GiaTriForm> = {}): GiaTriForm => ({
  ...formTrong({ thuTuGoiY: 120 }),
  code: "tiktok_ads",
  name: "TikTok Ads",
  sourceType: "MARKETING",
  ...p,
});

describe("[FRN-01] ngày theo giờ Việt Nam", () => {
  it("00:00 ngày 10/10 giờ VN là 17:00 UTC ngày 09/10 — ô ngày đọc/ghi đúng NGÀY VN, không lệch một ngày", () => {
    expect(isoTuNgayVN("2026-10-10")).toBe("2026-10-09T17:00:00.000Z");
    expect(ngayVNTuISO("2026-10-09T17:00:00.000Z")).toBe("2026-10-10");
    expect(ngayVNTuISO(isoTuNgayVN("2027-01-01")!)).toBe("2027-01-01");
  });
  it("mốc giữa ngày vẫn thuộc ngày VN của nó; null/rỗng/sai dạng ⇒ rỗng", () => {
    expect(ngayVNTuISO("2026-10-09T16:59:59.000Z")).toBe("2026-10-09");
    expect(ngayVNTuISO("2026-10-09T17:00:00.000Z")).toBe("2026-10-10");
    expect(ngayVNTuISO(null)).toBe("");
    expect(isoTuNgayVN("")).toBeNull();
    expect(isoTuNgayVN("31/12/2026")).toBeNull();
    expect(isoTuNgayVN("2026-02-30")).toBeNull();
  });
});

describe("[FRN-02] biểu mẫu trống", () => {
  it("nháp · chưa chọn nhóm · cách xác định = không cần người · chọn được · không hoa hồng · cửa sổ để trống = dùng mặc định", () => {
    const f = formTrong({ thuTuGoiY: 140 });
    expect(f).toMatchObject({
      code: "",
      name: "",
      sourceType: "",
      referrerRequirement: "NONE",
      requiresNote: false,
      selectable: true,
      trangThai: "DRAFT",
      commissionEnabled: false,
      attributionWindowDays: "",
      sortOrder: "140",
      ownerEmployeeId: "",
      ownerOrgUnitId: "",
      effectiveFrom: "",
      effectiveTo: "",
      lyDo: "",
    });
  });
});

describe("[FRN-03] kiểm tạo — lỗi đặt đúng ô, tiếng Việt", () => {
  it("biểu mẫu hợp lệ ⇒ không lỗi", () => {
    expect(kiemFormTao(formHopLe())).toEqual({});
  });
  it("mã: ngắn · ký tự lạ · bắt đầu MANUAL · UNKNOWN ⇒ lỗi ở ô `code`", () => {
    expect(kiemFormTao(formHopLe({ code: "ab" })).code).toMatch(/3–40/);
    expect(kiemFormTao(formHopLe({ code: "paid ads" })).code).toMatch(/chữ HOA/);
    expect(kiemFormTao(formHopLe({ code: "manual_review" })).code).toMatch(/MANUAL/);
    expect(kiemFormTao(formHopLe({ code: " unknown " })).code).toMatch(/UNKNOWN/);
    expect(kiemFormTao(formHopLe({ code: "" })).code).toBeTruthy();
  });
  it("tên rỗng · nhóm chưa chọn ⇒ lỗi tiếng Việt, không lọt câu Anh của Zod", () => {
    const l = kiemFormTao(formHopLe({ name: " ", sourceType: "" }));
    expect(l.name).toMatch(/Tên nguồn/);
    expect(l.sourceType).toBe("Chọn nhóm nguồn.");
    for (const msg of Object.values(l)) expect(msg).not.toMatch(/Invalid|expected|received|Too small|Too big/i);
  });
  it("MỌI lỗi hiện MỘT lượt: mã sai + nhóm chưa chọn + tên rỗng + hiệu lực ngược — Zod bỏ `superRefine` khi ô khác lỗi, biểu mẫu không để người dùng sửa từng vòng một", () => {
    const l = kiemFormTao(formHopLe({ code: "paid ads", name: "", sourceType: "", effectiveFrom: "2026-11-01", effectiveTo: "2026-10-01" }));
    expect(Object.keys(l).sort()).toEqual(["code", "effectiveTo", "name", "sourceType"]);
  });
  it("loại SYSTEM không chọn được ở biểu mẫu tạo (chỉ nguồn hệ thống)", () => {
    expect(kiemFormTao(formHopLe({ sourceType: "SYSTEM" })).sourceType).toBe("Chọn nhóm nguồn.");
  });
  it("thứ tự / cửa sổ: không phải số nguyên, âm, 0, quá trần ⇒ lỗi cạnh ô; cửa sổ để trống là hợp lệ", () => {
    expect(kiemFormTao(formHopLe({ sortOrder: "abc" })).sortOrder).toMatch(/số nguyên/);
    expect(kiemFormTao(formHopLe({ sortOrder: "" })).sortOrder).toMatch(/số nguyên/);
    expect(kiemFormTao(formHopLe({ sortOrder: "-1" })).sortOrder).toBeTruthy();
    expect(kiemFormTao(formHopLe({ attributionWindowDays: "0" })).attributionWindowDays).toMatch(/≥ 1/);
    expect(kiemFormTao(formHopLe({ attributionWindowDays: "1.5" })).attributionWindowDays).toMatch(/số ngày nguyên/);
    expect(kiemFormTao(formHopLe({ attributionWindowDays: "99999" })).attributionWindowDays).toMatch(/tối đa/);
    expect(kiemFormTao(formHopLe({ attributionWindowDays: "" })).attributionWindowDays).toBeUndefined();
    expect(kiemFormTao(formHopLe({ attributionWindowDays: "120" })).attributionWindowDays).toBeUndefined();
  });
  it("hiệu lực: hết hạn phải SAU bắt đầu; ngày sai dạng bị chặn", () => {
    expect(kiemFormTao(formHopLe({ effectiveFrom: "2026-11-01", effectiveTo: "2026-10-01" })).effectiveTo).toMatch(/SAU/);
    expect(kiemFormTao(formHopLe({ effectiveFrom: "2026-11-01", effectiveTo: "2026-11-01" })).effectiveTo).toMatch(/SAU/);
    expect(kiemFormTao(formHopLe({ effectiveFrom: "2026-11-01", effectiveTo: "2026-12-01" }))).toEqual({});
    expect(kiemFormTao(formHopLe({ effectiveTo: "31/12/2026" })).effectiveTo).toMatch(/Ngày không hợp lệ/);
  });
});

describe("[FRN-04] payload tạo", () => {
  it("tập khoá của payload = ĐÚNG tập khoá của `taoNguonSchema` (thêm trường vào schema mà quên ô nhập ⇒ đỏ)", () => {
    const khoaSchema = Object.keys((taoNguonSchema as unknown as { shape: Record<string, unknown> }).shape).sort();
    expect(khoaSchema.length).toBeGreaterThan(10);
    const payload = bienFormTao(formHopLe()) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(khoaSchema);
  });
  it("rỗng ⇒ null; số ⇒ số; ngày ⇒ ISO giờ VN; payload qua được `taoNguonSchema` thật", () => {
    const payload = bienFormTao(
      formHopLe({ sortOrder: "250", attributionWindowDays: " 60 ", effectiveFrom: "2026-11-01", ownerEmployeeId: "emp1", ownerOrgUnitId: "", description: " ghi chú " }),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      sortOrder: 250,
      attributionWindowDays: 60,
      effectiveFrom: "2026-10-31T17:00:00.000Z",
      effectiveTo: null,
      ownerEmployeeId: "emp1",
      ownerOrgUnitId: null,
      code: "TIKTOK_ADS",
      trangThai: "DRAFT",
    });
    const kq = taoNguonSchema.safeParse(payload);
    expect(kq.success).toBe(true);
  });
});

describe("[FRN-05] payload sửa — chỉ trường thật sự đổi", () => {
  const goc = formTuNguon(nguonMau({ effectiveTo: "2026-12-31T17:00:00.000Z", attributionWindowDays: 45 }));
  it("không đổi gì ⇒ payload rỗng (kể cả ngày: nhận ISO, hiển thị ngày VN, gửi lại KHÔNG sinh khác biệt)", () => {
    expect(goc.effectiveTo).toBe("2027-01-01");
    const { vao } = bienFormSua(goc, goc);
    expect(vao).toEqual({});
  });
  it("đổi tên + xoá cửa sổ riêng + đổi ngày ⇒ đúng ba khoá, kiểu đúng", () => {
    const { vao } = bienFormSua({ ...goc, name: "TikTok mới", attributionWindowDays: "", effectiveTo: "2027-02-01" }, goc);
    expect(vao).toEqual({ name: "TikTok mới", attributionWindowDays: null, effectiveTo: "2027-01-31T17:00:00.000Z" });
  });
  it("lý do chỉ đi theo khi có chữ; nó không phải trường của nguồn", () => {
    const r = bienFormSua({ ...goc, name: "X", lyDo: "  vì thế  " }, goc);
    expect(r.lyDo).toBe("vì thế");
    expect(Object.keys(r.vao)).not.toContain("lyDo");
    expect(bienFormSua({ ...goc, name: "Y", lyDo: "   " }, goc).lyDo).toBeNull();
  });
});

describe("[FRN-06] phân tích sửa", () => {
  it("không đổi gì ⇒ không có thay đổi, không lỗi, không chặn", () => {
    const n = nguonMau();
    const f = formTuNguon(n);
    const kq = phanTichSua({ form: f, goc: f, nguon: n, boiCanh: boiCanh() });
    expect(kq.truongDoi).toEqual([]);
    expect(kq.loi).toEqual({});
    expect(kq.chanLuu).toBeNull();
    expect(kq.canLyDo).toBe(false);
  });
  it("đổi tên: KHÔNG cần lý do; đổi cửa sổ: CẦN lý do ≥ 10 ký tự, thiếu thì lỗi ở ô lý do", () => {
    const n = nguonMau();
    const goc = formTuNguon(n);
    const doiTen = phanTichSua({ form: { ...goc, name: "Tên mới" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(doiTen.canLyDo).toBe(false);
    expect(doiTen.loi.lyDo).toBeUndefined();
    const thieu = phanTichSua({ form: { ...goc, attributionWindowDays: "30", lyDo: "ngắn" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(thieu.canLyDo).toBe(true);
    expect(thieu.loi.lyDo).toMatch(/10 ký tự/);
    const du = phanTichSua({ form: { ...goc, attributionWindowDays: "30", lyDo: "Chủ dự án chốt 09/10" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(du.loi).toEqual({});
    expect(du.truongDoi).toEqual(["attributionWindowDays"]);
  });
  it("chạm vào trường nhạy cảm là ô lý do hiện NGAY — kể cả khi trường còn sai định dạng; cảnh báo «lead mới không chọn được» hiện cả khi chưa gõ lý do", () => {
    const n = nguonMau();
    const goc = formTuNguon(n);
    const sai = phanTichSua({ form: { ...goc, attributionWindowDays: "0" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(sai.canLyDo).toBe(true);
    expect(sai.loi.attributionWindowDays).toMatch(/≥ 1/);
    const tat = phanTichSua({ form: { ...goc, selectable: false }, goc, nguon: n, boiCanh: boiCanh() });
    expect(tat.loi.lyDo).toMatch(/10 ký tự/);
    expect(tat.canhBao.some((c) => /Lead MỚI sẽ không chọn được/.test(c.noiDung))).toBe(true);
  });
  it("lời giải thích khoá lấy từ CHÍNH `truongBiKhoa` (một nguồn sự thật với cổng ghi)", () => {
    const n = nguonMau({ code: "PAID_ADS", isSystem: true, daDung: { attribution: true, touchpoint: false, phienBanChinhSach: false, so: false, page: false, nhomNhanSuMacDinh: false, daDung: true } });
    const khoa = truongBiKhoa({ code: n.code, isSystem: n.isSystem, daDung: true });
    const goc = formTuNguon(n);
    const kq = phanTichSua({ form: { ...goc, code: "PAID_ADS_2" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(kq.loi.code).toBe(khoa.find((k) => k.truong === "code")!.lyDo);
  });
  it("nguồn là đích MẶC ĐỊNH của quy nguồn: tắt chọn / đặt hạn ⇒ lỗi cạnh ô theo CHÍNH `lamHongDichMacDinh`", () => {
    const n = nguonMau({ code: "PAID_ADS" });
    const goc = formTuNguon(n);
    const bc = boiCanh({ laDichMacDinh: true });
    expect(phanTichSua({ form: { ...goc, selectable: false, lyDo: "Chủ dự án chốt 09/10" }, goc, nguon: n, boiCanh: bc }).loi.selectable).toMatch(/MẶC ĐỊNH/);
    expect(phanTichSua({ form: { ...goc, effectiveTo: "2027-01-01", lyDo: "Chủ dự án chốt 09/10" }, goc, nguon: n, boiCanh: bc }).loi.effectiveTo).toMatch(/MẶC ĐỊNH/);
    expect(phanTichSua({ form: { ...goc, selectable: false, lyDo: "Chủ dự án chốt 09/10" }, goc, nguon: n, boiCanh: boiCanh() }).loi.selectable).toBeUndefined();
  });
  it("lỗi từ Zod (tên rỗng, cửa sổ 0) cũng đặt đúng ô", () => {
    const n = nguonMau();
    const goc = formTuNguon(n);
    const kq = phanTichSua({ form: { ...goc, name: "", attributionWindowDays: "0", lyDo: "Chủ dự án chốt 09/10" }, goc, nguon: n, boiCanh: boiCanh() });
    expect(kq.loi.name).toMatch(/Tên nguồn/);
    expect(kq.loi.attributionWindowDays).toMatch(/≥ 1/);
  });
});

describe("[FRN-07] đổi ai-nhận-tiền", () => {
  const dinhTien = { chinhSachRieng: true, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false };
  const n = nguonMau({ daDung: { attribution: true, touchpoint: false, phienBanChinhSach: true, so: false, page: false, nhomNhanSuMacDinh: false, daDung: true } });
  const goc = formTuNguon(n);
  const doi = { ...goc, commissionEnabled: true, lyDo: "Chủ dự án chốt 09/10" };

  it("nguồn ĐANG có chính sách chạy + người sửa THIẾU commission_policies:activate ⇒ chặn Lưu, nêu TÊN khoá", () => {
    const kq = phanTichSua({ form: doi, goc, nguon: n, boiCanh: boiCanh({ dinhTien, coQuyenKichHoat: false }) });
    expect(kq.chanLuu).toMatch(/commission_policies:activate/);
  });
  it("ĐỐI CHỨNG DƯƠNG: có quyền ⇒ không chặn, nhưng vẫn cảnh báo «đổi ai nhận tiền»", () => {
    const kq = phanTichSua({ form: doi, goc, nguon: n, boiCanh: boiCanh({ dinhTien, coQuyenKichHoat: true }) });
    expect(kq.chanLuu).toBeNull();
    expect(kq.canhBao.some((c) => c.truong === "commissionEnabled" && /nhận tiền/.test(c.noiDung))).toBe(true);
  });
  it("nguồn CHƯA dính tiền (không chính sách chạy, không dòng sổ) ⇒ không chặn, không cảnh báo tiền, dù thiếu quyền", () => {
    const sach = nguonMau();
    const g = formTuNguon(sach);
    const kq = phanTichSua({ form: { ...g, commissionEnabled: true, lyDo: "Chủ dự án chốt 09/10" }, goc: g, nguon: sach, boiCanh: boiCanh({ coQuyenKichHoat: false }) });
    expect(kq.chanLuu).toBeNull();
    expect(kq.canhBao.filter((c) => /nhận tiền/.test(c.noiDung))).toEqual([]);
  });
  it("đã có dòng sổ cũng là «dính tiền»; đổi TÊN thì không bao giờ chặn", () => {
    const coSo = nguonMau({ daDung: { attribution: true, touchpoint: false, phienBanChinhSach: false, so: true, page: false, nhomNhanSuMacDinh: false, daDung: true } });
    const g = formTuNguon(coSo);
    expect(phanTichSua({ form: { ...g, attributionWindowDays: "30", lyDo: "Chủ dự án chốt 09/10" }, goc: g, nguon: coSo, boiCanh: boiCanh({ coQuyenKichHoat: false }) }).chanLuu).toMatch(/commission_policies:activate/);
    expect(phanTichSua({ form: { ...g, name: "Tên khác" }, goc: g, nguon: coSo, boiCanh: boiCanh({ coQuyenKichHoat: false }) }).chanLuu).toBeNull();
  });
  it("đổi NGƯỜI PHỤ TRÁCH khi có rule vai SOURCE_OWNER chạy ở phạm vi chung ⇒ cũng đòi quyền kích hoạt", () => {
    const sach = nguonMau();
    const g = formTuNguon(sach);
    const kq = phanTichSua({
      form: { ...g, ownerEmployeeId: "emp-moi", lyDo: "Chủ dự án chốt 09/10" },
      goc: g,
      nguon: sach,
      boiCanh: boiCanh({ coQuyenKichHoat: false, dinhTien: { chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: true, ruleChuChay: true } }),
    });
    expect(kq.chanLuu).toMatch(/commission_policies:activate/);
  });
});

describe("[FRN-08] thao tác trạng thái", () => {
  const dich = new Set<string>();
  const ten = (r: ReturnType<typeof thaoTacTrangThai>) => r.duoc.map((t) => t.den);
  it("DRAFT: kích hoạt (không cần lý do) + lưu trữ; ACTIVE: ngừng + lưu trữ; INACTIVE: kích hoạt lại + lưu trữ; ARCHIVED: chỉ khôi phục", () => {
    const so = (status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED") => thaoTacTrangThai({ nguon: { code: "X_Y_Z", isSystem: false, status, ownerEmployeeId: null }, dichMacDinh: dich, dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW });
    expect(ten(so("DRAFT"))).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(so("DRAFT").duoc[0]).toMatchObject({ nhan: "Kích hoạt", canLyDo: false });
    expect(ten(so("ACTIVE"))).toEqual(["INACTIVE", "ARCHIVED"]);
    expect(so("ACTIVE").duoc[0]).toMatchObject({ nhan: "Ngừng", canLyDo: true });
    expect(so("INACTIVE").duoc[0]).toMatchObject({ den: "ACTIVE", nhan: "Kích hoạt lại", canLyDo: true });
    expect(ten(so("ARCHIVED"))).toEqual(["INACTIVE"]);
    expect(so("ARCHIVED").duoc[0]!.nhan).toBe("Khôi phục");
  });
  it("nguồn HỆ THỐNG: không có nút Lưu trữ + nói lý do; UNKNOWN: không có nút nào, nói lý do", () => {
    const he = thaoTacTrangThai({ nguon: { code: "WALK_IN", isSystem: true, status: "ACTIVE", ownerEmployeeId: null }, dichMacDinh: dich, dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW });
    expect(ten(he)).toEqual(["INACTIVE"]);
    expect(he.khongDuoc).toEqual([{ den: "ARCHIVED", nhan: "Lưu trữ", lyDo: "Nguồn hệ thống không lưu trữ được." }]);
    const kr = thaoTacTrangThai({ nguon: { code: "UNKNOWN", isSystem: true, status: "ACTIVE", ownerEmployeeId: null }, dichMacDinh: dich, dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW });
    expect(kr.duoc).toEqual([]);
    expect(kr.khongDuoc.length).toBeGreaterThan(0);
    expect(kr.khongDuoc.every((k) => /UNKNOWN luôn ở trạng thái hoạt động|không lưu trữ/.test(k.lyDo))).toBe(true);
  });
  it("nguồn là ĐÍCH MẶC ĐỊNH của quy nguồn: không có nút Ngừng / Lưu trữ, lý do nói «trỏ cấu hình sang nguồn khác trước»; nguồn khác thì vẫn có nút", () => {
    const d = thaoTacTrangThai({ nguon: { code: "PAID_ADS", isSystem: true, status: "ACTIVE", ownerEmployeeId: null }, dichMacDinh: new Set(["PAID_ADS"]), dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW });
    expect(d.duoc).toEqual([]);
    expect(d.khongDuoc.map((k) => k.den)).toEqual(["INACTIVE", "ARCHIVED"]);
    expect(d.khongDuoc[0]!.lyDo).toMatch(/trỏ cấu hình sang nguồn khác/);
    const khac = thaoTacTrangThai({ nguon: { code: "PAID_ADS", isSystem: true, status: "ACTIVE", ownerEmployeeId: null }, dichMacDinh: new Set(["WALK_IN"]), dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW });
    expect(ten(khac)).toEqual(["INACTIVE"]);
  });
  it("không có thao tác ẩn: mọi `den` trong `duoc` đều qua được cổng ghi `kiemDoiTrangThai` (nút ≡ cổng)", async () => {
    const { kiemDoiTrangThai } = await import("./danh-muc-ghi-dau-vao");
    for (const status of ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const) {
      for (const isSystem of [false, true]) {
        const nguon = { code: "SOURCE_Z", isSystem, status, ownerEmployeeId: null };
        for (const t of thaoTacTrangThai({ nguon, dichMacDinh: dich, dinhTien: KHONG_DINH_TIEN, coQuyenKichHoat: true, now: NOW }).duoc) {
          expect(kiemDoiTrangThai({ nguon, den: t.den, lyDo: "Chủ dự án chốt 09/10" }).ok, `${status}->${t.den}`).toBe(true);
        }
      }
    }
  });
});

describe("[FRN-09] phụ đề trang sửa NÓI THẬT điều được sửa (lấy từ CHÍNH cổng khoá — luật 12)", () => {
  // Lỗi sinh ra ca này (Q2 · 09/10): phụ đề trang sửa nguồn hệ thống gõ cứng «chỉ sửa được tên, mô tả, thứ tự, cửa sổ ghi công, hoa hồng nguồn và người phụ trách» —
  // đúng cho PAID_ADS nhưng sai cho UNKNOWN sau khi siết (ba ô đó đã khoá). Câu gõ cứng là lời hứa suông chờ ngày cổng đổi.
  it("UNKNOWN: chỉ tên · mô tả · thứ tự — KHÔNG nhắc cửa sổ / hoa hồng / người phụ trách", () => {
    const s = phuDeTrangSua({ code: "UNKNOWN", isSystem: true, daDung: true });
    expect(s).toContain("tên nguồn");
    expect(s).toContain("mô tả");
    expect(s).toContain("thứ tự");
    expect(s).not.toMatch(/cửa sổ|hoa hồng|phụ trách|đơn vị/i);
  });
  it("ĐỐI CHỨNG DƯƠNG: nguồn hệ thống khác (PAID_ADS) nhắc đủ cửa sổ · hoa hồng · người phụ trách", () => {
    const s = phuDeTrangSua({ code: "PAID_ADS", isSystem: true, daDung: true });
    expect(s).toMatch(/cửa sổ ghi công/);
    expect(s).toMatch(/hoa hồng/);
    expect(s).toMatch(/người phụ trách/);
  });
  it("nguồn tự tạo: câu chung, không liệt kê (mọi ô chưa khoá thì sửa được)", () => {
    expect(phuDeTrangSua({ code: "TIKTOK_ADS", isSystem: false, daDung: false })).toBe("Đổi thông tin, cửa sổ ghi công, người phụ trách hoặc hoa hồng của nguồn.");
  });
});

describe("[FRN-10] nút trạng thái NÓI THẬT với nguồn chưa có chủ và với người thiếu quyền (W2, res2 R2-M1)", () => {
  // Cấy: bỏ khối `chanNguonHoatDongKhongChu` khỏi `thaoTacTrangThai` ⇒ ca a đỏ (nút «Kích hoạt» vẽ ra rồi máy chủ từ chối); bỏ khối `canQuyenKichHoat` ⇒ ca d/e đỏ.
  const dich = new Set<string>();
  const nut = (status: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED", p: { owner?: string | null; chinhSachRieng?: boolean; ruleChuChay?: boolean; coQuyen?: boolean } = {}) =>
    thaoTacTrangThai({
      nguon: { code: "X_Y_Z", isSystem: false, status, ownerEmployeeId: p.owner ?? null },
      dichMacDinh: dich,
      dinhTien: { chinhSachRieng: p.chinhSachRieng ?? false, ruleChuChay: p.ruleChuChay ?? false },
      coQuyenKichHoat: p.coQuyen ?? true,
      now: NOW,
    });
  const den = (r: ReturnType<typeof thaoTacTrangThai>) => r.duoc.map((t) => t.den);

  it("a. nguồn NHÁP chưa có người phụ trách + rule SOURCE_OWNER đang chạy ⇒ «Kích hoạt» KHÔNG vẽ, nói lý do; «Lưu trữ» vẫn vẽ", () => {
    const r = nut("DRAFT", { ruleChuChay: true });
    expect(den(r)).toEqual(["ARCHIVED"]);
    const k = r.khongDuoc.find((x) => x.den === "ACTIVE");
    expect(k?.nhan).toBe("Kích hoạt");
    expect(k?.lyDo).toContain("người phụ trách");
    expect(k?.lyDo).toContain("trước khi kích hoạt");
  });
  it("b. cùng nguồn nhưng ĐÃ CÓ chủ ⇒ «Kích hoạt» vẽ (đối chứng dương); c. KHÔNG có rule chủ-nguồn chạy ⇒ vẽ dù chưa có chủ", () => {
    expect(den(nut("DRAFT", { ruleChuChay: true, owner: "E1" }))).toEqual(["ACTIVE", "ARCHIVED"]);
    expect(den(nut("DRAFT", { ruleChuChay: false }))).toEqual(["ACTIVE", "ARCHIVED"]);
  });
  it("d. nguồn CÓ chính sách riêng đang ACTIVE + người xem THIẾU quyền ⇒ «Ngừng» / «Lưu trữ» KHÔNG vẽ, lý do nêu TÊN khoá; có quyền ⇒ vẽ; nguồn không chính sách riêng ⇒ vẽ dù thiếu quyền", () => {
    const thieu = nut("ACTIVE", { chinhSachRieng: true, coQuyen: false });
    expect(den(thieu)).toEqual([]);
    expect(thieu.khongDuoc.map((k) => k.den)).toEqual(["INACTIVE", "ARCHIVED"]);
    expect(thieu.khongDuoc.every((k) => /commission_policies:activate/.test(k.lyDo))).toBe(true);
    expect(den(nut("ACTIVE", { chinhSachRieng: true, coQuyen: true }))).toEqual(["INACTIVE", "ARCHIVED"]);
    expect(den(nut("ACTIVE", { chinhSachRieng: false, coQuyen: false }))).toEqual(["INACTIVE", "ARCHIVED"]);
  });
  it("e. nguồn CÓ CHỦ mà rule SOURCE_OWNER đang chạy cũng «dính tiền»: thiếu quyền ⇒ không mở lại được; rule không chạy ⇒ không dính", () => {
    expect(den(nut("INACTIVE", { owner: "E1", ruleChuChay: true, coQuyen: false }))).toEqual([]);
    expect(den(nut("INACTIVE", { owner: "E1", ruleChuChay: false, coQuyen: false }))).toEqual(["ACTIVE", "ARCHIVED"]);
  });
  it("f. THỨ TỰ cổng như máy chủ: nguồn thiếu chủ vừa bị chặn «chưa có chủ» vừa thiếu quyền ⇒ nói lý do «chưa có chủ» (cổng tuyệt đối đứng trước cổng quyền)", () => {
    const k = nut("DRAFT", { ruleChuChay: true, chinhSachRieng: true, coQuyen: false }).khongDuoc.find((x) => x.den === "ACTIVE");
    expect(k?.lyDo).toContain("người phụ trách");
    expect(k?.lyDo).not.toContain("commission_policies:activate");
  });
});

describe("[FRN-11] biểu mẫu TẠO: «Kích hoạt ngay» nói thật (chanKhiTao)", () => {
  // Cấy: bỏ nhánh `chanChu` ⇒ ca a đỏ; bỏ `canQuyenKichHoat` ⇒ ca b đỏ; bỏ vế `f.trangThai !== "ACTIVE"` ⇒ bản nháp cũng bị chặn (ca c đỏ).
  const f = (p: Partial<GiaTriForm>): GiaTriForm => ({ ...formHopLe(), ...p });
  it("a. ACTIVE + chưa chọn người phụ trách + rule chủ-nguồn chạy ⇒ lỗi cạnh ô người phụ trách", () => {
    const r = chanKhiTao(f({ trangThai: "ACTIVE", ownerEmployeeId: "" }), { ruleChuChay: true, coQuyenKichHoat: true });
    expect(r.loi.ownerEmployeeId).toContain("người phụ trách");
    expect(r.chanLuu, "lý do cũng hiện ở CHÂN, cạnh nút Lưu").toBe(r.loi.ownerEmployeeId);
  });
  it("b. ACTIVE + CÓ người phụ trách + rule chạy + THIẾU quyền ⇒ khoá Lưu, nêu tên khoá; có quyền ⇒ qua", () => {
    const v = f({ trangThai: "ACTIVE", ownerEmployeeId: "E1" });
    expect(chanKhiTao(v, { ruleChuChay: true, coQuyenKichHoat: false }).chanLuu).toBe(CAU_THIEU_QUYEN_KICH_HOAT);
    expect(chanKhiTao(v, { ruleChuChay: true, coQuyenKichHoat: true })).toEqual({ loi: {}, chanLuu: null });
  });
  it("c. bản NHÁP không bị cổng nào chặn; ACTIVE khi KHÔNG có rule chủ-nguồn chạy cũng không (đối chứng dương)", () => {
    expect(chanKhiTao(f({ trangThai: "DRAFT", ownerEmployeeId: "E1" }), { ruleChuChay: true, coQuyenKichHoat: false })).toEqual({ loi: {}, chanLuu: null });
    expect(chanKhiTao(f({ trangThai: "DRAFT", ownerEmployeeId: "" }), { ruleChuChay: true, coQuyenKichHoat: false })).toEqual({ loi: {}, chanLuu: null });
    expect(chanKhiTao(f({ trangThai: "ACTIVE", ownerEmployeeId: "E1" }), { ruleChuChay: false, coQuyenKichHoat: false })).toEqual({ loi: {}, chanLuu: null });
    expect(chanKhiTao(f({ trangThai: "ACTIVE", ownerEmployeeId: "" }), { ruleChuChay: false, coQuyenKichHoat: false })).toEqual({ loi: {}, chanLuu: null });
  });
});

describe("[FRN-12] biểu mẫu SỬA: tắt hoa hồng khi có dòng thu hút bị CHẶN; đổi khả năng nhận lead của nguồn dính tiền đòi quyền (W2)", () => {
  const dt = (p: Partial<BoiCanhSua["dinhTien"]> = {}) => ({ chinhSachRieng: false, coDongThuHutRieng: false, ruleChuNguonBatKy: false, ruleChuChay: false, ...p });
  const nguon = nguonMau({ commissionEnabled: true });
  const goc = formTuNguon(nguon);
  const tat = { ...goc, commissionEnabled: false, lyDo: "Chủ dự án chốt 10/10" };

  it("tắt «tham gia hoa hồng» khi chính sách riêng có dòng THU HÚT ⇒ lỗi cạnh ô, kể cả người có đủ quyền; chỉ gồm EXCLUDE ⇒ qua; BẬT cờ ⇒ không chặn", () => {
    // Cấy: bỏ khối `chanTatHoaHongNguon` khỏi `phanTichSua` ⇒ ca đầu đỏ.
    const chan = phanTichSua({ form: tat, goc, nguon, boiCanh: boiCanh({ coQuyenKichHoat: true, dinhTien: dt({ chinhSachRieng: true, coDongThuHutRieng: true }) }) });
    expect(chan.loi.commissionEnabled).toContain("thu hút");
    expect(chan.chanLuu, "khoá Lưu + nói lý do ở chân (công tắc nằm xa nút)").toBe(chan.loi.commissionEnabled);
    const chiExclude = phanTichSua({ form: tat, goc, nguon, boiCanh: boiCanh({ coQuyenKichHoat: true, dinhTien: dt({ chinhSachRieng: true, coDongThuHutRieng: false }) }) });
    expect(chiExclude.loi.commissionEnabled).toBeUndefined();
    const nguonTat = nguonMau({ commissionEnabled: false });
    const g2 = formTuNguon(nguonTat);
    const bat = phanTichSua({ form: { ...g2, commissionEnabled: true, lyDo: "Chủ dự án chốt 10/10" }, goc: g2, nguon: nguonTat, boiCanh: boiCanh({ dinhTien: dt({ chinhSachRieng: true, coDongThuHutRieng: true }) }) });
    expect(bat.loi.commissionEnabled).toBeUndefined();
  });
  it("tắt «chọn được» của nguồn CÓ CHỦ + rule chủ-nguồn chạy, thiếu quyền ⇒ chặn Lưu; nguồn không chủ không chính sách ⇒ không chặn (đối chứng dương)", () => {
    // Cấy: bỏ `dangDinhTienTheoRule` khỏi lời gọi `canQuyenKichHoat` ở `phanTichSua` ⇒ ca đầu đỏ.
    const coChu = nguonMau({ ownerEmployee: { id: "E1", ten: "An", maNv: "NV1", coTaiKhoan: true } });
    const g = formTuNguon(coChu);
    const doi = { ...g, selectable: false, lyDo: "Chủ dự án chốt 10/10" };
    expect(phanTichSua({ form: doi, goc: g, nguon: coChu, boiCanh: boiCanh({ coQuyenKichHoat: false, dinhTien: dt({ ruleChuChay: true }) }) }).chanLuu).toBe(CAU_THIEU_QUYEN_KICH_HOAT);
    expect(phanTichSua({ form: doi, goc: g, nguon: coChu, boiCanh: boiCanh({ coQuyenKichHoat: true, dinhTien: dt({ ruleChuChay: true }) }) }).chanLuu).toBeNull();
    const khongChu = nguonMau();
    const g3 = formTuNguon(khongChu);
    expect(phanTichSua({ form: { ...g3, selectable: false, lyDo: "Chủ dự án chốt 10/10" }, goc: g3, nguon: khongChu, boiCanh: boiCanh({ coQuyenKichHoat: false, dinhTien: dt({ ruleChuChay: true }) }) }).chanLuu).toBeNull();
  });
  it("lời cảnh báo chỉ gọi tên trường THẬT SỰ đụng tiền (sửa cửa sổ + chọn được trên nguồn chỉ có dòng sổ: «chọn được» không bị gọi là đụng tiền)", () => {
    const coSo = nguonMau({ daDung: { attribution: true, touchpoint: false, phienBanChinhSach: false, so: true, page: false, nhomNhanSuMacDinh: false, daDung: true } });
    const g = formTuNguon(coSo);
    const kq = phanTichSua({ form: { ...g, attributionWindowDays: "30", selectable: false, lyDo: "Chủ dự án chốt 10/10" }, goc: g, nguon: coSo, boiCanh: boiCanh({ coQuyenKichHoat: true }) });
    const c = kq.canhBao.find((x) => /nhận tiền/.test(x.noiDung));
    expect(c?.noiDung).toContain("Cửa sổ ghi công");
    expect(c?.noiDung).not.toContain("Chọn được ở ô nhập");
  });
});
