// [SGT-*] — LÕI THUẦN của P7-A «chuẩn hoá giá ghi danh theo đơn, phạm vi suy từ bằng chứng» (`sua-gia-theo-don.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Ánh xạ yêu cầu P7-A → ca:
//   không khoá cứng mã đơn, phạm vi do quy tắc ⇒ [SGT-00..03] [SGT-60..61]   |   gắn dòng đơn chỉ khi chứng minh được (4 bằng chứng) ⇒ [SGT-10..19]
//   KHÔNG mở sang G1b / mua theo số buổi / giảm có điều kiện / học bổng / khoản bị từ chối ⇒ [SGT-20..32]   |   giá đích TÍNH, không đọc từ đơn ⇒ [SGT-33]
//   idempotent ⇒ [SGT-40]   |   ngoại lệ listPrice ⇒ [SGT-41..42]   |   lô: đơn lệch bị LOẠI không làm dừng lô; lỗi cấp lô dừng cả lô ⇒ [SGT-50..51]   |   dòng ký ⇒ [SGT-52..54]
import { describe, expect, it } from "vitest";
import {
  KHUON_DONG_SUA_GIA_THEO_DON,
  PHAN_TRAM_CHO_PHEP,
  dongDauRaSuaGiaTheoDon,
  dungMucTuDon,
  lapKeHoachSuaGiaTheoDon,
  suyLienKetDong,
  type DuLieuTheoDon,
} from "./sua-gia-theo-don";
import { MA_DON_WAVE_C_B, giaDichWaveCB } from "./wave-c-sua-gia-ghi-danh";

// Không gõ nguyên văn cặp «trạng thái bán hàng = đã ghi nhận» / «trạng thái kế toán = đã xác nhận» dạng thuộc tính: lưới [BUOC-4b] + [BUOC-6] quét CẢ cây lib/ (kể cả chú thích) đòi các giá trị đó chỉ nằm ở nơi được phép.
const DA_GHI = "RECORDED";
const DA_XAC_NHAN = "CONFIRMED";
const LIST = 10_560_000;
const FINAL = 8_976_000;
const GIAM = 1_584_000;
const NGAY_DON = new Date("2026-10-10T00:00:00Z");
const NGAY_GIA = new Date("2026-08-04T00:00:00Z");
const LEGACY = { listPrice: LIST, discountType: null, discountAmount: 0, tuition: LIST, finalPrice: LIST };
const TRONG = { listPrice: null, discountType: null, discountAmount: null, tuition: null, finalPrice: null };
const DICH = giaDichWaveCB(LIST, 15);

type Moi = Partial<{
  nguon: "ORDER" | "ITEM";
  trỏ: boolean;
  don: Partial<DuLieuTheoDon["don"]>;
  dong: Partial<DuLieuTheoDon["don"]["items"][number]>;
  gia: Partial<NonNullable<DuLieuTheoDon["ghiDanh"]>["gia"]> | typeof TRONG;
  geStatus: string;
  khoa: DuLieuTheoDon["khoa"];
  khoan: Partial<DuLieuTheoDon["paymentSong"][number]>[];
  phanBo: number;
  ghiDanhHocVien: DuLieuTheoDon["ghiDanhCuaHocVien"];
  dongKhac: string[];
  beDon: string | null;
  phanTram: number;
}>;

/** Một đơn khoá học 10.560.000 → 8.976.000 (15%), đóng đủ, ghi danh e1 còn giá niêm yết. `trỏ=false`: dòng đơn CHƯA trỏ ghi danh (khoản thu thì đã gắn e1). */
function duT(code: string, moi: Moi = {}): DuLieuTheoDon {
  const nguon = moi.nguon ?? "ITEM";
  const pt = moi.phanTram ?? 15;
  const giam = Math.round((LIST * pt) / 100);
  const tro = moi.trỏ ?? true;
  const gia = { ...LEGACY, ...moi.gia };
  const dong = {
    id: "it1", type: "COURSE_ENROLLMENT", studentId: "s1", enrollmentId: tro ? "e1" : null, metadata: { courseId: "k1" }, quantity: 1, unitPrice: LIST, totalPrice: LIST,
    discountAmount: nguon === "ITEM" ? giam : 0, discountPercent: nguon === "ITEM" ? pt : null,
    discounts: nguon === "ITEM" ? [{ kieu: "PHAN_TRAM", phanTram: pt, giam, vuotTran: false, lyDo: "CS" }] : [],
    ...moi.dong,
  };
  const ge = { id: "e1", studentId: "s1", courseId: "k1", status: moi.geStatus ?? "ACTIVE", centerId: "cs1", deletedAt: null, leadChildId: null, gia: gia as typeof LEGACY };
  return {
    don: {
      id: "o1", code, type: "COURSE", deletedAt: null, createdAt: NGAY_DON, studentId: "s1", centerId: "cs1", subtotal: LIST, discountAmount: giam,
      discountPercent: nguon === "ORDER" ? pt : null, totalAmount: LIST - giam, discountApprovalStatus: nguon === "ORDER" ? "APPROVED" : null, items: [dong], ...moi.don,
    },
    ghiDanh: tro ? { id: ge.id, studentId: ge.studentId, courseId: ge.courseId, status: ge.status, centerId: ge.centerId, deletedAt: ge.deletedAt, gia: ge.gia } : null,
    khoa: moi.khoa === undefined ? { id: "k1", price: LIST, updatedAt: NGAY_GIA } : moi.khoa,
    paymentSong: (moi.khoan ?? [{}]).map((p, i) => ({ id: `p${i + 1}`, amount: LIST - giam, paymentType: "PAYMENT", saleStatus: DA_GHI, accountantStatus: DA_XAC_NHAN, adjustmentOfId: null, enrollmentId: "e1", centerId: "cs1", ...p })),
    tongPhanBoNganHang: moi.phanBo ?? LIST - giam,
    beTrenDon: moi.beDon ?? null,
    ghiDanhCuaHocVien: moi.ghiDanhHocVien ?? [ge],
    ghiDanhDaCoDongKhac: moi.dongKhac ?? [],
  };
}

const MA1 = "ORD-T-1";
const MA2 = "ORD-T-2";
const maLoai = (k: ReturnType<typeof lapKeHoachSuaGiaTheoDon>) => k.ketQuaBang.loai.map((x) => x.ma).sort();

describe("[SGT] phạm vi do QUY TẮC suy ra — đối chứng dương", () => {
  it("[SGT-00] ĐỐI CHỨNG DƯƠNG dòng đã trỏ ghi danh, nguồn ITEM: vào phạm vi, ghi 4 cột về giá đích, listPrice giữ nguyên, không gắn gì", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1)]);
    expect(k.dung).toBe(false);
    expect(k.ketQuaBang.loai).toEqual([]);
    expect(Object.keys(k.ketQuaBang.bang)).toEqual([MA1]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]).toMatchObject({ code: MA1, enrollmentId: "e1", truoc: LEGACY, sau: DICH, ghiListPrice: false, gan: null });
    expect(k.keHoach.noGiaTruoc).toBe(GIAM);
    expect(k.keHoach.noGiaSau).toBe(0);
  });

  it("[SGT-01] nguồn ORDER (giảm đã APPROVED ở mức đơn) cũng vào phạm vi, kết quả giá như nhau", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { nguon: "ORDER" })]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]).toMatchObject({ truoc: LEGACY, sau: DICH });
  });

  it("[SGT-02] mức 25% (chính sách cũ) vào phạm vi: giá đích = 75% niêm yết", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { phanTram: 25 })]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]!.sau).toMatchObject({ discountAmount: 2_640_000, finalPrice: 7_920_000, tuition: 7_920_000 });
  });

  it("[SGT-03] phạm vi cho phép đúng {15, 25}% — mức khác KHÔNG tự thêm", () => {
    expect([...PHAN_TRAM_CHO_PHEP]).toEqual([15, 25]);
  });
});

describe("[SGT] gắn dòng đơn → ghi danh CHỈ khi chứng minh được", () => {
  it("[SGT-10] ĐỐI CHỨNG DƯƠNG: dòng chưa trỏ + đủ bốn bằng chứng ⇒ gắn đúng MỘT dòng, dữ liệu ảo có ghi danh, kế hoạch sạch", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false })]);
    expect(k.dung).toBe(false);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]!.gan).toEqual({ orderItemId: "it1", enrollmentId: "e1" });
    expect(k.dongDauRa[0]).toContain("GAN_DONG:it1");
  });

  it("[SGT-11] dòng ĐÃ trỏ ⇒ không gắn lại (gan = null) và dòng ký ghi DONG_DA_TRO", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1)]);
    expect(k.ghi[0]!.gan).toBeNull();
    expect(k.dongDauRa[0]).toContain("DONG_DA_TRO");
  });

  it.each([
    ["Order.studentId rỗng", { don: { studentId: null } }],
    ["OrderItem.studentId rỗng", { dong: { studentId: null } }],
    ["Order.studentId ≠ OrderItem.studentId", { dong: { studentId: "s2" } }],
    ["dòng đơn không ghi khoá học", { dong: { metadata: {} } }],
    ["không khoản thu sống nào đã gắn ghi danh", { khoan: [{ enrollmentId: null }] }],
    ["khoản thu gắn ghi danh KHÁC", { khoan: [{ enrollmentId: "e9" }] }],
    ["một khoản gắn e1, một khoản gắn e9", { khoan: [{ amount: 4_488_000 }, { amount: 4_488_000, enrollmentId: "e9" }] }],
    ["ghi danh đã bị dòng đơn khác trỏ tới", { dongKhac: ["e1"] }],
  ] as [string, Moi][])("[SGT-12] KHÔNG gắn khi %s ⇒ loại KHONG_SUY_RA_GHI_DANH, không dòng ghi", (_ten, moi) => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, ...moi })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["KHONG_SUY_RA_GHI_DANH"]);
  });

  it("[SGT-13] học viên có HAI ghi danh còn hiệu lực cùng khoá + cơ sở ⇒ không đoán", () => {
    const e1 = { id: "e1", studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, leadChildId: null, gia: LEGACY };
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, ghiDanhHocVien: [e1, { ...e1, id: "e2" }] })]);
    expect(maLoai(k)).toEqual(["KHONG_SUY_RA_GHI_DANH"]);
  });

  it("[SGT-14] ghi danh khác khoá / khác cơ sở / đã đóng / đã xoá mềm KHÔNG được coi là ứng viên (và không bị đếm làm trùng)", () => {
    const e1 = { id: "e1", studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, leadChildId: null, gia: LEGACY };
    const khac = [
      { ...e1, id: "e2", courseId: "k2" },
      { ...e1, id: "e3", centerId: "cs2" },
      { ...e1, id: "e4", status: "WITHDREW" },
      { ...e1, id: "e5", deletedAt: new Date("2026-10-01T00:00:00Z") },
    ];
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, ghiDanhHocVien: [e1, ...khac] })]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]!.gan).toEqual({ orderItemId: "it1", enrollmentId: "e1" });
  });

  it("[SGT-15] ghi danh duy nhất đã ĐÓNG (WITHDREW) ⇒ không suy ra ghi danh (tiền nằm ở ghi danh đóng là việc nhóm G2, không phải lệnh này)", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, geStatus: "WITHDREW", ghiDanhHocVien: [{ id: "e1", studentId: "s1", courseId: "k1", centerId: "cs1", status: "WITHDREW", deletedAt: null, leadChildId: null, gia: LEGACY }] })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["KHONG_SUY_RA_GHI_DANH"]);
  });

  it("[SGT-16] bé trên đơn khác bé của ghi danh ⇒ không gắn; hai phía cùng bé ⇒ gắn; một phía trống ⇒ không mâu thuẫn nên gắn", () => {
    const ge = (lc: string | null) => ({ id: "e1", studentId: "s1", courseId: "k1", centerId: "cs1", status: "ACTIVE", deletedAt: null, leadChildId: lc, gia: LEGACY });
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, beDon: "b1", ghiDanhHocVien: [ge("b2")] })]).ghi).toEqual([]);
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, beDon: "b1", ghiDanhHocVien: [ge("b1")] })]).ghi).toHaveLength(1);
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, beDon: "b1", ghiDanhHocVien: [ge(null)] })]).ghi).toHaveLength(1);
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false, dong: { metadata: { courseId: "k1", leadChildId: "b9" } }, ghiDanhHocVien: [ge("b2")] })]).ghi).toEqual([]);
  });

  it("[SGT-17] đơn nhiều dòng ⇒ KHONG_PHAI_MOT_DONG_KHOA, không đoán dòng nào", () => {
    const d = duT(MA1, { trỏ: false });
    const hai: DuLieuTheoDon = { ...d, don: { ...d.don, items: [...d.don.items, { ...d.don.items[0]!, id: "it2" }] } };
    const r = suyLienKetDong(hai);
    expect("loai" in r && r.loai.ma).toBe("KHONG_PHAI_MOT_DONG_KHOA");
  });
});

describe("[SGT] KHÔNG mở rộng ra ngoài G1a (đo bằng quy tắc)", () => {
  it("[SGT-20] chưa đóng ĐỦ giá đích (nhóm G1b) ⇒ TIEN_PAYMENT_LECH ⇒ loại, không ghi", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { khoan: [{ amount: 2_376_000 }], phanBo: 2_376_000 })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("TIEN_PAYMENT_LECH");
  });

  it("[SGT-21] mua theo số buổi (Order.subtotal thấp hơn niêm yết của ghi danh) ⇒ GIA_KHONG_PHAI_LEGACY", () => {
    const d = duT(MA1, { don: { subtotal: 5_940_000, totalAmount: 5_049_000, discountAmount: 891_000 }, dong: { unitPrice: 5_940_000, totalPrice: 5_940_000, discountAmount: 891_000 }, khoan: [{ amount: 5_049_000 }], phanBo: 5_049_000 });
    const k = lapKeHoachSuaGiaTheoDon([d]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["GIA_KHONG_PHAI_LEGACY"]);
  });

  it.each([5, 10, 14])("[SGT-22] mức giảm %s%% (có điều kiện / số liệu tự mâu thuẫn) ⇒ PHAN_TRAM_NGOAI_CHINH_SACH", (pt) => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { phanTram: pt })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["PHAN_TRAM_NGOAI_CHINH_SACH"]);
  });

  it("[SGT-23] học bổng / chỉnh tay (discountType khác NULL) ⇒ GIA_KHONG_PHAI_LEGACY", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { gia: { discountType: "SCHOLARSHIP", discountAmount: LIST, finalPrice: 0, tuition: 0 } })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["GIA_KHONG_PHAI_LEGACY"]);
  });

  it("[SGT-24] khoản thu bị TỪ CHỐI còn sống trên đơn ⇒ PAYMENT_KHONG_HOP_LE (lệnh không tự gạt đi)", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { khoan: [{}, { accountantStatus: "REJECTED" }] })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("PAYMENT_KHONG_HOP_LE");
  });

  it("[SGT-25] khoản chưa xác nhận (chờ kế toán) ⇒ PAYMENT_KHONG_HOP_LE; không tự coi là đã đóng", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { khoan: [{ accountantStatus: "PENDING" }] })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("PAYMENT_KHONG_HOP_LE");
  });

  it("[SGT-26] Σ phân bổ ngân hàng ĐÃ KHỚP lệch giá đích (tiền mặt / nhập lịch sử) ⇒ TIEN_PHAN_BO_LECH", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { phanBo: 0 })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("TIEN_PHAN_BO_LECH");
  });

  it("[SGT-27] ghi danh đã đóng khi dòng đơn ĐÃ trỏ tới nó ⇒ GHI_DANH_KHONG_HIEU_LUC", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { geStatus: "TRANSFERRED" })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("GHI_DANH_KHONG_HIEU_LUC");
  });

  it("[SGT-28] không có bằng chứng giảm (ORDER chưa APPROVED, ITEM không có bản ghi) ⇒ KHONG_CO_BANG_CHUNG_GIAM", () => {
    expect(maLoai(lapKeHoachSuaGiaTheoDon([duT(MA1, { nguon: "ORDER", don: { discountApprovalStatus: "PENDING" } })]))).toEqual(["KHONG_CO_BANG_CHUNG_GIAM"]);
    expect(maLoai(lapKeHoachSuaGiaTheoDon([duT(MA1, { dong: { discounts: [] } })]))).toEqual(["KHONG_CO_BANG_CHUNG_GIAM"]);
    expect(maLoai(lapKeHoachSuaGiaTheoDon([duT(MA1, { dong: { discounts: [{ kieu: "PHAN_TRAM", phanTram: 15 }, { kieu: "PHAN_TRAM", phanTram: 5 }] } })]))).toEqual(["KHONG_CO_BANG_CHUNG_GIAM"]);
  });

  it("[SGT-29] bản ghi giảm vượt trần (vuotTran) ⇒ lõi từ chối (BANG_CHUNG_ITEM_LECH)", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { dong: { discounts: [{ kieu: "PHAN_TRAM", phanTram: 15, giam: GIAM, vuotTran: true }] } })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("BANG_CHUNG_ITEM_LECH");
  });

  it("[SGT-30] đơn không phải loại khoá học / đã xoá mềm ⇒ lõi từ chối", () => {
    expect(maLoai(lapKeHoachSuaGiaTheoDon([duT(MA1, { don: { type: "PRODUCT" } })]))).toContain("DON_KHONG_PHAI_KHOA_HOC");
    expect(maLoai(lapKeHoachSuaGiaTheoDon([duT(MA1, { don: { deletedAt: new Date("2026-10-11T00:00:00Z") } })]))).toContain("DON_DA_XOA");
  });

  it("[SGT-31] ghi danh khác cơ sở với đơn ⇒ lõi từ chối (GHI_DANH_LECH_CO_SO)", () => {
    const d = duT(MA1);
    const k = lapKeHoachSuaGiaTheoDon([{ ...d, ghiDanh: { ...d.ghiDanh!, centerId: "cs2" } }]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("GHI_DANH_LECH_CO_SO");
  });

  it("[SGT-32] đơn thuộc phạm vi Wave C-B bị loại dù dữ liệu hợp lệ — hai lệnh không cùng sở hữu một ghi danh", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA_DON_WAVE_C_B[0]!)]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toEqual(["THUOC_WAVE_C_B"]);
  });

  it("[SGT-33] giá đích TÍNH từ niêm yết + %, không đọc từ đơn: Order.totalAmount lệch 1đ ⇒ TONG_DON_LECH (không tautology)", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { don: { totalAmount: FINAL + 1 } })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("TONG_DON_LECH");
  });

  it("[SGT-34] dungMucTuDon không đọc tiền: chỉ dựng mục từ bằng chứng giá; mục dựng ra có tongDon = giá đích tính", () => {
    const r = dungMucTuDon(duT(MA1));
    expect("muc" in r && r.muc).toMatchObject({ listPrice: LIST, phanTram: 15, nguon: "ITEM", tongDon: FINAL, truoc: LEGACY });
  });
});

describe("[SGT] idempotent + ngoại lệ listPrice", () => {
  it("[SGT-40] ghi danh ĐÃ ở giá đích ⇒ không dòng ghi, nằm ở daDung (chạy lại ra 0)", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { gia: DICH })]);
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.ketQuaBang.daDung).toEqual([MA1]);
    expect(Object.keys(k.ketQuaBang.bang)).toEqual([]);
  });

  it("[SGT-41] ghi danh CẢ NĂM cột NULL + nguồn giá đủ (Course.price = Order.subtotal, Course.updatedAt trước đơn) ⇒ ghi cả listPrice", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { gia: TRONG })]);
    expect(k.ghi).toHaveLength(1);
    expect(k.ghi[0]).toMatchObject({ ghiListPrice: true, truoc: TRONG, sau: DICH });
    expect(k.dongDauRa[0]).toContain("GHI_LIST");
  });

  it("[SGT-42] cả năm cột NULL nhưng Course.updatedAt SAU thời điểm tạo đơn (giá khoá có thể đã đổi) ⇒ NGUON_NIEM_YET_KHONG_DU ⇒ loại", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { gia: TRONG, khoa: { id: "k1", price: LIST, updatedAt: new Date("2026-10-20T00:00:00Z") } })]);
    expect(k.ghi).toEqual([]);
    expect(maLoai(k)).toContain("NGUON_NIEM_YET_KHONG_DU");
  });
});

describe("[SGT] lô: đơn lệch bị LOẠI, lỗi cấp lô DỪNG", () => {
  it("[SGT-50] hai đơn hợp lệ + một đơn lệch ⇒ lô vẫn ghi hai đơn hợp lệ; đơn lệch có mặt trong danh sách loại", () => {
    const d2 = { ...duT(MA2), don: { ...duT(MA2).don, id: "o2" } };
    const d2fix: DuLieuTheoDon = { ...d2, ghiDanh: { ...d2.ghiDanh!, id: "e2" }, paymentSong: d2.paymentSong.map((p) => ({ ...p, id: "q1", enrollmentId: "e2" })), don: { ...d2.don, items: [{ ...d2.don.items[0]!, id: "it2", enrollmentId: "e2" }] } };
    const xau = duT("ORD-T-3", { khoan: [{ amount: 100 }], phanBo: 100 });
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1), d2fix, { ...xau, don: { ...xau.don, id: "o3", items: [{ ...xau.don.items[0]!, id: "it3", enrollmentId: "e3" }] }, ghiDanh: { ...xau.ghiDanh!, id: "e3" } }]);
    expect(k.dung).toBe(false);
    expect(k.ghi.map((g) => g.code)).toEqual([MA1, MA2]);
    expect(k.ketQuaBang.loai.map((l) => l.code)).toContain("ORD-T-3");
  });

  it("[SGT-51] hai đơn cùng trỏ MỘT ghi danh ⇒ TRUNG_GHI_DANH ở cấp lô ⇒ DỪNG CẢ LÔ, không dòng ghi", () => {
    const a = duT(MA1);
    const b = duT(MA2);
    const b2: DuLieuTheoDon = { ...b, don: { ...b.don, id: "o2", items: [{ ...b.don.items[0]!, id: "it2" }] }, paymentSong: b.paymentSong.map((p) => ({ ...p, id: "q1" })) };
    const k = lapKeHoachSuaGiaTheoDon([a, b2]);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.keHoach.loi.map((l) => l.ma)).toContain("TRUNG_GHI_DANH");
  });
});

describe("[SGT] dòng ký", () => {
  it("[SGT-52] dòng ký ràng giá TRƯỚC, giá SAU, chế độ listPrice và việc gắn dòng; không chứa tên/SĐT/email", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false })]);
    const [dong] = dongDauRaSuaGiaTheoDon(k.ghi);
    expect(dong!.split("|")).toEqual([KHUON_DONG_SUA_GIA_THEO_DON, "o1", MA1, "e1", `${LIST}/NULL/0/${LIST}/${LIST}`, `${LIST}/PERCENT/${GIAM}/${FINAL}/${FINAL}`, "CHI_DOC_LIST", "GAN_DONG:it1"]);
    expect(dong).not.toMatch(/@|\b0\d{9}\b/);
  });

  it("[SGT-53] PLAN_SHA ổn định (độc lập thứ tự đầu vào) và ĐỔI khi đổi việc gắn dòng / giá SAU", () => {
    const d1 = duT(MA1);
    const d2 = { ...duT(MA2), don: { ...duT(MA2).don, id: "o2", items: [{ ...duT(MA2).don.items[0]!, id: "it2", enrollmentId: "e2" }] }, ghiDanh: { ...duT(MA2).ghiDanh!, id: "e2" }, paymentSong: duT(MA2).paymentSong.map((p) => ({ ...p, id: "q1", enrollmentId: "e2" })) } as DuLieuTheoDon;
    expect(lapKeHoachSuaGiaTheoDon([d1, d2]).sha).toBe(lapKeHoachSuaGiaTheoDon([d2, d1]).sha);
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1)]).sha).not.toBe(lapKeHoachSuaGiaTheoDon([duT(MA1, { trỏ: false })]).sha);
    expect(lapKeHoachSuaGiaTheoDon([duT(MA1)]).sha).not.toBe(lapKeHoachSuaGiaTheoDon([duT(MA1, { phanTram: 25 })]).sha);
  });

  it("[SGT-54] phạm vi rỗng ⇒ sha của rỗng, không lỗi, không dòng ghi (kế hoạch rỗng KHÔNG phải lỗi)", () => {
    const k = lapKeHoachSuaGiaTheoDon([]);
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
  });
});

describe("[SGT] không khoá cứng mã đơn", () => {
  it("[SGT-60] thêm một đơn hợp lệ MỚI (mã chưa từng thấy) là vào phạm vi — không cần sửa mã nguồn", () => {
    const k = lapKeHoachSuaGiaTheoDon([duT("ORD-9-ZZZ")]);
    expect(k.ghi.map((g) => g.code)).toEqual(["ORD-9-ZZZ"]);
  });

  it("[SGT-61] không mã đơn nào do người dùng truyền vào: hàm lập kế hoạch chỉ nhận DỮ LIỆU đơn, không nhận danh sách mã", () => {
    expect(lapKeHoachSuaGiaTheoDon.length).toBe(1);
  });
});
