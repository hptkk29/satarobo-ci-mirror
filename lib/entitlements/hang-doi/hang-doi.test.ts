// lib/entitlements/hang-doi/hang-doi.test.ts — HÀM THUẦN của hàng đợi quyền học. Không DB. `[HD-*]`.
// Hành vi trên Postgres thật: `tests/finance/hang-doi-quyen-hoc.test.ts` (`[HD-DB-*]`). Dây nối: `hang-doi-wiring.test.ts` (`[HD-W*]`).
import { describe, expect, it } from "vitest";
import { hanhDongChoChuyenDoi } from "../cho-chuyen-doi";
import { hanhDongChoXepLop } from "../cho-xep-lop";
import { boDaQuyet, docDauVanDaQuyet, docDaQuyet, ghiDaQuyet, payloadSauMoLai, type DaQuyet } from "../da-quyet";
import { anSoTienNeuThieuQuyen, anSoTienTrongChu, CHE_SO_TIEN } from "./an-tien";
import {
  keHoachLechMotDong,
  lyDoLech,
  phatHienLech,
  quyenDongConGhiDanhMo,
  type DongLechVao,
  type GhiDanhLech,
  type QuyenLech,
} from "./doi-soat-lech";
import {
  HANH_DONG_HANG_DOI,
  hanhDongDuocPhep,
  kiemLyDoNhap,
  xetHanhDong,
  type DongHangDoiXet,
  type NguCanhXet,
} from "./hanh-dong-duoc-phep";
import { laQuaHan, LOAI_HANG_DOI, NGUONG_QUA_HAN_MS } from "./loai";

const QUYET: DaQuyet = { dauVan: "thiếu 500000đ", hanhDong: "GIU_QUYEN", boi: { id: "u1", ten: "QLCS" }, luc: "2026-10-12T03:00:00.000Z", lyDo: "Phụ huynh đã hẹn nộp bù" };

describe("[HD-DQ] quyết định của người xử lý (da-quyet.ts)", () => {
  it("[HD-DQ-01] ghi rồi đọc lại: dấu vân + khối; payload cũ giữ nguyên các khoá khác", () => {
    const p = ghiDaQuyet({ chiTiet: [{ ma: "X" }] }, QUYET);
    expect(docDauVanDaQuyet(p)).toBe("thiếu 500000đ");
    expect(docDaQuyet(p)).toEqual(QUYET);
    expect(p).toMatchObject({ chiTiet: [{ ma: "X" }] });
  });

  it("[HD-DQ-02] hình dạng lạ / thiếu ⇒ null (fail-open về phía MỞ LẠI: máy cứ cảnh báo)", () => {
    for (const p of [null, undefined, 5, "x", [], {}, { daQuyet: 1 }, { daQuyet: {} }, { daQuyet: { dauVan: "" } }, { daQuyet: { dauVan: 3 } }]) {
      expect(docDauVanDaQuyet(p), JSON.stringify(p)).toBeNull();
    }
    expect(docDaQuyet({ daQuyet: { dauVan: "x", hanhDong: "DONG", luc: "t", lyDo: "l" } })).toBeNull(); // thiếu `boi`
  });

  it("[HD-DQ-03] gỡ quyết định: payload chỉ còn khoá khác; hết gì ⇒ null; không có quyết định ⇒ trả nguyên", () => {
    expect(boDaQuyet(ghiDaQuyet({ a: 1 }, QUYET))).toEqual({ a: 1 });
    expect(boDaQuyet(ghiDaQuyet(null, QUYET))).toBeNull();
    const nguyen = { a: 1 };
    expect(boDaQuyet(nguyen)).toBe(nguyen);
  });

  it("[HD-DQ-04] payloadSauMoLai: không có quyết định ⇒ KHÔNG ghi payload (tránh nhấp nháy updatedAt); có ⇒ gỡ khối đó", () => {
    expect(payloadSauMoLai(null)).toEqual({});
    expect(payloadSauMoLai({ a: 1 })).toEqual({});
    expect(payloadSauMoLai(ghiDaQuyet({ a: 1 }, QUYET))).toEqual({ payload: { a: 1 } });
    expect(Object.keys(payloadSauMoLai(ghiDaQuyet(null, QUYET)))).toEqual(["payload"]); // DbNull
  });
});

describe("[HD-LC] vòng đời dòng: người đã quyết ⇒ máy không mở lại cùng điều kiện", () => {
  const dong = (trangThai: "OPEN" | "DA_XU_LY" | "HUY", daQuyetDauVan: string | null, lyDo = "thiếu 500000đ") => ({ trangThai, lyDo, daQuyetDauVan });
  const cho = (lyDo: string) => ({ kieu: "PHAI_CHO", lyDo }) as const;

  it("[HD-LC-01] CHO_CHUYEN_DOI: đóng bởi người, cùng điều kiện ⇒ KHONG_LAM_GI; điều kiện đổi ⇒ MO_LAI chính dòng đó", () => {
    expect(hanhDongChoChuyenDoi(dong("DA_XU_LY", "thiếu 500000đ"), cho("thiếu 500000đ"))).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoChuyenDoi(dong("DA_XU_LY", "thiếu 500000đ"), cho("thiếu 800000đ"))).toEqual({ viec: "MO_LAI", lyDo: "thiếu 800000đ" });
  });

  it("[HD-LC-02] đóng bởi MÁY (không dấu vân) ⇒ vẫn MO_LAI như cũ — người không được chặn nhầm máy", () => {
    expect(hanhDongChoChuyenDoi(dong("DA_XU_LY", null), cho("thiếu 500000đ"))).toEqual({ viec: "MO_LAI", lyDo: "thiếu 500000đ" });
    expect(hanhDongChoChuyenDoi(dong("HUY", null), cho("thiếu 500000đ"))).toEqual({ viec: "MO_LAI", lyDo: "thiếu 500000đ" });
  });

  it("[HD-LC-03] dòng đang MỞ: dấu vân không ảnh hưởng (đổi lý do vẫn CAP_NHAT, cùng lý do vẫn KHONG_LAM_GI)", () => {
    expect(hanhDongChoChuyenDoi(dong("OPEN", "thiếu 500000đ"), cho("thiếu 900000đ"))).toEqual({ viec: "CAP_NHAT_LY_DO", lyDo: "thiếu 900000đ" });
    expect(hanhDongChoChuyenDoi(dong("OPEN", "thiếu 500000đ"), cho("thiếu 500000đ"))).toEqual({ viec: "KHONG_LAM_GI" });
  });

  it("[HD-LC-04] CHO_XEP_LOP: cùng quy tắc", () => {
    expect(hanhDongChoXepLop(dong("DA_XU_LY", "a", "a"), cho("a"))).toEqual({ viec: "KHONG_LAM_GI" });
    expect(hanhDongChoXepLop(dong("DA_XU_LY", "a", "a"), cho("b"))).toEqual({ viec: "MO_LAI", lyDo: "b" });
    expect(hanhDongChoXepLop(dong("DA_XU_LY", null, "a"), cho("a"))).toEqual({ viec: "MO_LAI", lyDo: "a" });
  });
});

describe("[HD-PH] xetHanhDong / hanhDongDuocPhep — MỘT chính sách cho nút và action", () => {
  const goc: DongHangDoiXet = { loai: "CHO_CHUYEN_DOI", trangThai: "OPEN", coQuyenHoc: false, trangThaiQuyenHoc: null, daTieuThu: false, quyenCanDuyet: null };
  const ok: NguCanhXet = { coQuyenManage: true, coBat: true, coQuyenDuyetNgoaiLe: false };
  const duoc = (hd: (typeof HANH_DONG_HANG_DOI)[number], d: Partial<DongHangDoiXet> = {}, nc: NguCanhXet = ok) => xetHanhDong(hd, { ...goc, ...d }, nc).duoc;

  it("[HD-PH-01] chỉ có quyền xem (không manage) ⇒ KHÔNG hành động nào, ở mọi loại — nút không hiện", () => {
    for (const loai of LOAI_HANG_DOI) {
      expect(hanhDongDuocPhep({ ...goc, loai, coQuyenHoc: true, trangThaiQuyenHoc: "ACTIVE" }, { coQuyenManage: false, coBat: true, coQuyenDuyetNgoaiLe: false }), loai).toEqual([]);
    }
  });

  it("[HD-PH-02] đối chứng dương: có manage + cờ BẬT + dòng mở ⇒ có hành động", () => {
    expect(hanhDongDuocPhep(goc, ok)).toEqual(["THU_LAI", "DONG", "DANH_DAU_CAN_DUYET"]);
  });

  it("[HD-PH-03] cờ TẮT ⇒ không hành động nào (đọc vẫn xem được)", () => {
    expect(hanhDongDuocPhep(goc, { coQuyenManage: true, coBat: false, coQuyenDuyetNgoaiLe: false })).toEqual([]);
  });

  it("[HD-PH-04] dòng đã đóng ⇒ không hành động nào", () => {
    expect(hanhDongDuocPhep({ ...goc, trangThai: "DA_XU_LY" }, ok)).toEqual([]);
    expect(hanhDongDuocPhep({ ...goc, trangThai: "HUY" }, ok)).toEqual([]);
  });

  it("[HD-PH-05] thu hồi: chỉ CAN_THU_HOI + có quyền học + CHƯA tiêu thụ + trạng thái có cạnh thu hồi", () => {
    const thuHoi: Partial<DongHangDoiXet> = { loai: "CAN_THU_HOI", coQuyenHoc: true, trangThaiQuyenHoc: "AWAITING_PLACEMENT", daTieuThu: false };
    expect(duoc("DUYET_THU_HOI", thuHoi)).toBe(true);
    expect(duoc("DUYET_THU_HOI", { ...thuHoi, daTieuThu: true })).toBe(false); // ĐÃ tiêu thụ ⇒ KHÔNG tự thu hồi
    expect(duoc("DUYET_THU_HOI", { ...thuHoi, daTieuThu: null })).toBe(false); // không đọc được sổ cái ⇒ fail-closed
    expect(duoc("DUYET_THU_HOI", { ...thuHoi, loai: "TREO_DUYET_TAY" })).toBe(false);
    expect(duoc("DUYET_THU_HOI", { ...thuHoi, coQuyenHoc: false, trangThaiQuyenHoc: null })).toBe(false);
    for (const s of ["SEAT_HOLD", "COMPLETED", "EXPIRED", "STOPPED", "VOIDED"]) expect(duoc("DUYET_THU_HOI", { ...thuHoi, trangThaiQuyenHoc: s }), s).toBe(false);
    for (const s of ["ACTIVE", "FROZEN", "EXHAUSTED"]) expect(duoc("DUYET_THU_HOI", { ...thuHoi, trangThaiQuyenHoc: s }), s).toBe(true);
  });

  it("[HD-PH-06] giữ quyền: chỉ CAN_THU_HOI / TREO_DUYET_TAY", () => {
    for (const loai of LOAI_HANG_DOI) expect(duoc("GIU_QUYEN", { loai }), loai).toBe(loai === "CAN_THU_HOI" || loai === "TREO_DUYET_TAY");
  });

  it("[HD-PH-07] cần duyệt tay: chỉ loại không có quyền học; ĐÃ có quyền học thì cap-tu-don tự quản nên không cho", () => {
    expect(duoc("DANH_DAU_CAN_DUYET", { loai: "THIEU_QUYEN_HOC" })).toBe(true);
    expect(duoc("DANH_DAU_CAN_DUYET", { loai: "LECH_DU_LIEU" })).toBe(true);
    expect(duoc("DANH_DAU_CAN_DUYET", { loai: "CHO_XEP_LOP" })).toBe(false);
    expect(duoc("DANH_DAU_CAN_DUYET", { loai: "CAN_THU_HOI" })).toBe(false);
    expect(duoc("DANH_DAU_CAN_DUYET", { loai: "LECH_DU_LIEU", coQuyenHoc: true, trangThaiQuyenHoc: "ACTIVE" })).toBe(false);
  });

  it("[HD-PH-08] nút ≡ action: hanhDongDuocPhep luôn bằng bộ lọc của xetHanhDong (không có hai chính sách)", () => {
    for (const loai of LOAI_HANG_DOI) {
      for (const coQuyenHoc of [false, true]) {
        for (const daTieuThu of [false, true, null]) {
          for (const coBat of [false, true]) {
            const d: DongHangDoiXet = { loai, trangThai: "OPEN", coQuyenHoc, trangThaiQuyenHoc: coQuyenHoc ? "ACTIVE" : null, daTieuThu, quyenCanDuyet: null };
            const nc = { coQuyenManage: true, coBat, coQuyenDuyetNgoaiLe: false };
            expect(hanhDongDuocPhep(d, nc)).toEqual(HANH_DONG_HANG_DOI.filter((hd) => xetHanhDong(hd, d, nc).duoc));
          }
        }
      }
    }
  });

  it("[HD-PH-09] lý do người nhập: ≥ 10 ký tự sau khi cắt khoảng trắng, ≤ 500", () => {
    expect(kiemLyDoNhap("ngắn")).not.toBeNull();
    expect(kiemLyDoNhap("          x          ")).not.toBeNull();
    expect(kiemLyDoNhap(null)).not.toBeNull();
    expect(kiemLyDoNhap("đủ mười ký tự")).toBeNull();
    expect(kiemLyDoNhap("x".repeat(501))).not.toBeNull();
  });
});

describe("[HD-AT] che số tiền trong câu chữ", () => {
  it("[HD-AT-01] mọi số tiền kết thúc bằng 'đ' bị che; số khác (số buổi, mã) giữ nguyên", () => {
    expect(anSoTienTrongChu("Tiền xác nhận không còn đủ cho dòng (còn thiếu 5000000đ). Mua 12 buổi.")).toBe(`Tiền xác nhận không còn đủ cho dòng (còn thiếu ${CHE_SO_TIEN}). Mua 12 buổi.`);
    expect(anSoTienTrongChu("ghi 10.560.000đ nhưng 8,976,000 đ")).toBe(`ghi ${CHE_SO_TIEN} nhưng ${CHE_SO_TIEN}`);
    expect(anSoTienTrongChu("ORD260924000001D1")).toBe("ORD260924000001D1");
  });

  it("[HD-AT-02] có quyền xem tiền ⇒ nguyên văn; null/undefined đi qua", () => {
    expect(anSoTienNeuThieuQuyen("thiếu 5000000đ", true)).toBe("thiếu 5000000đ");
    expect(anSoTienNeuThieuQuyen("thiếu 5000000đ", false)).toBe(`thiếu ${CHE_SO_TIEN}`);
    expect(anSoTienNeuThieuQuyen(null, false)).toBeNull();
    expect(anSoTienNeuThieuQuyen(undefined, false)).toBeUndefined();
  });
});

describe("[HD-QH] quá hạn", () => {
  const t0 = new Date("2026-10-01T00:00:00Z");
  it("[HD-QH-01] đúng biên: mở + cũ hơn ngưỡng ⇒ quá hạn; chưa tới ⇒ không; đã đóng ⇒ không", () => {
    const now = new Date(t0.getTime() + NGUONG_QUA_HAN_MS);
    expect(laQuaHan({ trangThai: "OPEN", updatedAt: t0 }, now)).toBe(true);
    expect(laQuaHan({ trangThai: "OPEN", updatedAt: t0 }, new Date(now.getTime() - 1))).toBe(false);
    expect(laQuaHan({ trangThai: "DA_XU_LY", updatedAt: t0 }, now)).toBe(false);
    expect(NGUONG_QUA_HAN_MS).toBe(72 * 3_600_000);
  });
});

// ── LỆCH DỮ LIỆU ────────────────────────────────────────────────────────────────────────────────────────────────────────
const GD = (o: Partial<GhiDanhLech> = {}): GhiDanhLech => ({ id: "gd1", studentId: "hv1", courseId: "khoa1", status: "STUDYING", deletedAt: null, ...o });
const Q = (o: Partial<QuyenLech> = {}): QuyenLech => ({
  id: "q1",
  status: "AWAITING_PLACEMENT",
  studentId: "hv1",
  courseId: "khoa1",
  orderId: "don1",
  centerId: "cs1",
  enrollmentId: null,
  netAmount: 8_976_000,
  purchaseSessions: 48,
  graceSessionsGranted: 0,
  graceSessionsUsed: 0,
  ...o,
});
const V = (o: Partial<DongLechVao> = {}): DongLechVao => ({
  orderItemId: "dong1",
  orderId: "don1",
  donCenterId: "cs1",
  courseIdDong: "khoa1",
  leadChildIdDong: "con1",
  dongStudentId: null,
  dongEnrollmentId: null,
  ghiDanhCuaDong: null,
  thanhTien: 8_976_000,
  soBuoiMua: 48,
  quyen: Q(),
  chiCoQuyenDaHuy: false,
  hocVienCuaQuyenLeadChildId: "con1",
  ghiDanhCuaQuyen: null,
  coDongGiaiThich: false,
  tienMoHo: false,
  conHieuLuc: true,
  ...o,
});
const ma = (v: DongLechVao) => phatHienLech(v).map((p) => p.ma);

describe("[HD-LECH] phát hiện dữ liệu lệch", () => {
  it("[HD-LECH-01] dữ liệu khớp hoàn toàn ⇒ không phát hiện gì", () => {
    expect(ma(V())).toEqual([]);
    expect(ma(V({ quyen: null }))).toEqual([]); // chưa có quyền học cũng không phải lệch (đó là việc của cap-tu-don)
  });

  it("[HD-LECH-02] #4 ghi danh gắn dòng SCOPE mà không có quyền học và không dòng nào giải thích ⇒ GHI_DANH_KHONG_QUYEN", () => {
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD() }))).toEqual(["GHI_DANH_KHONG_QUYEN"]);
  });

  it("[HD-LECH-03] #4 có dòng chờ giải thích / quyền đã bị huỷ / ghi danh đã xoá hoặc rút / dòng hết hiệu lực ⇒ KHÔNG phát hiện", () => {
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD(), coDongGiaiThich: true }))).toEqual([]);
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD(), chiCoQuyenDaHuy: true }))).toEqual([]);
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD({ deletedAt: new Date() }) }))).toEqual([]);
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD({ status: "DROPPED" }) }))).toEqual([]);
    expect(ma(V({ quyen: null, ghiDanhCuaDong: GD(), conHieuLuc: false }))).toEqual([]);
  });

  it("[HD-LECH-04] #6 từng kiểu lẫn ⇒ đúng một mã (đơn · cơ sở · khoá · học viên · ghi danh · bé · số tiền · số buổi)", () => {
    expect(ma(V({ quyen: Q({ orderId: "don-khac" }) }))).toEqual(["QUYEN_LECH_DON"]);
    expect(ma(V({ quyen: Q({ centerId: "cs2" }) }))).toEqual(["QUYEN_LECH_CO_SO"]);
    expect(ma(V({ quyen: Q({ courseId: "khoa2" }) }))).toEqual(["QUYEN_LECH_KHOA"]);
    expect(ma(V({ dongStudentId: "hv2" }))).toEqual(["QUYEN_LECH_HOC_VIEN"]);
    expect(ma(V({ ghiDanhCuaDong: GD({ studentId: "hv2" }) }))).toEqual(["QUYEN_LECH_HOC_VIEN"]);
    expect(ma(V({ dongEnrollmentId: "gd1", quyen: Q({ enrollmentId: "gd2" }) }))).toEqual(["QUYEN_LECH_GHI_DANH"]);
    expect(ma(V({ quyen: Q({ enrollmentId: "gd2" }), ghiDanhCuaQuyen: GD({ id: "gd2", courseId: "khoa-la" }) }))).toEqual(["QUYEN_LECH_GHI_DANH"]);
    expect(ma(V({ hocVienCuaQuyenLeadChildId: "con2" }))).toEqual(["QUYEN_LECH_BE"]);
    expect(ma(V({ quyen: Q({ netAmount: 5_000_000 }) }))).toEqual(["QUYEN_LECH_SO_TIEN"]);
    expect(ma(V({ quyen: Q({ purchaseSessions: 12 }) }))).toEqual(["QUYEN_LECH_SO_BUOI"]);
  });

  it("[HD-LECH-05] thiếu thông tin để so (null) ⇒ KHÔNG kết luận lệch (không đoán)", () => {
    expect(ma(V({ courseIdDong: null, leadChildIdDong: null, donCenterId: null, hocVienCuaQuyenLeadChildId: null }))).toEqual([]);
  });

  it("[HD-LECH-06] tiền không gắn được dòng ⇒ TIEN_KHONG_GAN_DONG; nhiều mã ⇒ sắp theo mã (câu chữ ổn định)", () => {
    expect(ma(V({ quyen: null, tienMoHo: true }))).toEqual(["TIEN_KHONG_GAN_DONG"]);
    const nhieu = ma(V({ tienMoHo: true, quyen: Q({ purchaseSessions: 12, courseId: "khoa2" }) }));
    expect(nhieu).toEqual([...nhieu].sort());
    expect(nhieu).toHaveLength(3);
  });

  it("[HD-LECH-07] số tiền trong câu chữ kết thúc bằng 'đ' ⇒ che được cho vai thiếu quyền xem tiền", () => {
    const [p] = phatHienLech(V({ quyen: Q({ netAmount: 5_000_000 }) }));
    expect(p!.moTa).toMatch(/5000000đ/);
    expect(anSoTienTrongChu(p!.moTa)).not.toMatch(/\d{4,}/);
  });

  it("[HD-LECH-08] dòng LECH: lệch ⇒ TAO_MOI; cùng lý do ⇒ KHONG_LAM_GI; hết lệch ⇒ đóng HUY; người đã quyết cùng bộ phát hiện ⇒ không mở lại; bộ phát hiện đổi ⇒ mở lại", () => {
    const ph = phatHienLech(V({ quyen: Q({ purchaseSessions: 12 }) }));
    const lyDo = lyDoLech(ph)!;
    expect(keHoachLechMotDong(ph, null).viec).toEqual({ viec: "TAO_MOI", lyDo });
    expect(keHoachLechMotDong(ph, { trangThai: "OPEN", lyDo, daQuyetDauVan: null }).viec).toEqual({ viec: "KHONG_LAM_GI" });
    expect(keHoachLechMotDong([], { trangThai: "OPEN", lyDo, daQuyetDauVan: null }).viec).toMatchObject({ viec: "DONG", trangThai: "HUY" });
    expect(keHoachLechMotDong([], null).viec).toEqual({ viec: "KHONG_LAM_GI" });
    expect(keHoachLechMotDong(ph, { trangThai: "DA_XU_LY", lyDo, daQuyetDauVan: lyDo }).viec).toEqual({ viec: "KHONG_LAM_GI" });
    const khac = phatHienLech(V({ quyen: Q({ purchaseSessions: 12, courseId: "khoa2" }) }));
    expect(keHoachLechMotDong(khac, { trangThai: "DA_XU_LY", lyDo, daQuyetDauVan: lyDo }).viec).toMatchObject({ viec: "MO_LAI" });
  });
});

describe("[HD-LECH-5] #5 quyền học đã đóng / hết hạn mà ghi danh còn học — chỉ BÁO", () => {
  const vao = (status: string, o: Partial<{ granted: number; used: number; gd: GhiDanhLech | null }> = {}) => ({
    quyenId: "q",
    status,
    graceSessionsGranted: o.granted ?? 0,
    graceSessionsUsed: o.used ?? 0,
    ghiDanh: o.gd === undefined ? GD() : o.gd,
  });
  it("[HD-LECH-5a] EXPIRED / STOPPED / SEAT_HOLD + ghi danh đang học ⇒ báo; EXHAUSTED chỉ khi hết ân hạn", () => {
    for (const s of ["EXPIRED", "STOPPED", "SEAT_HOLD"]) expect(quyenDongConGhiDanhMo(vao(s)), s).toBe(true);
    expect(quyenDongConGhiDanhMo(vao("EXHAUSTED", { granted: 2, used: 1 }))).toBe(false);
    expect(quyenDongConGhiDanhMo(vao("EXHAUSTED", { granted: 2, used: 2 }))).toBe(true);
    expect(quyenDongConGhiDanhMo(vao("ACTIVE"))).toBe(false);
    expect(quyenDongConGhiDanhMo(vao("COMPLETED"))).toBe(false);
  });
  it("[HD-LECH-5b] ghi danh đã rút / xoá / chưa xác nhận / không tìm thấy ⇒ không báo", () => {
    expect(quyenDongConGhiDanhMo(vao("STOPPED", { gd: GD({ status: "DROPPED" }) }))).toBe(false);
    expect(quyenDongConGhiDanhMo(vao("STOPPED", { gd: GD({ deletedAt: new Date() }) }))).toBe(false);
    expect(quyenDongConGhiDanhMo(vao("STOPPED", { gd: GD({ status: "PENDING" }) }))).toBe(false);
    expect(quyenDongConGhiDanhMo(vao("STOPPED", { gd: null }))).toBe(false);
  });
});
