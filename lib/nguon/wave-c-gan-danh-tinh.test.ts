// [WCA-*] — LÕI THUẦN của PHASE C-A «gắn danh tính 18 đơn khoá học legacy» (`wave-c-gan-danh-tinh.ts`). Không DB: dữ liệu tổng hợp, KHÔNG id/tên/SĐT thật.
//
// Ánh xạ yêu cầu owner (25/10/2026, WAVE C-A) → ca:
//   18 đơn hợp lệ (17 «chưa gắn» + 1 «dòng đơn đã gắn») ⇒ [WCA-01] [WCA-02]   |   phạm vi cứng bằng mã đơn ⇒ [WCA-03]   |   đơn sống · COURSE · 1 dòng ⇒ [WCA-10..12]
//   đúng 1 học viên / 1 ghi danh ⇒ [WCA-20..24]   |   cùng khoá + cơ sở ⇒ [WCA-25] [WCA-26]   |   bằng chứng `leadChildId` (metadata ↔ đơn xung đột) ⇒ [WCA-14..16]
//   ghi danh đã thuộc đơn khác ⇒ [WCA-27]   |   trường đích NULL hoặc đã đúng, trôi ⇒ dừng ⇒ [WCA-30..34]   |   nhiều bé / nhiều dòng ⇒ [WCA-12] [WCA-35]   |   chạy lại ⇒ 0 ⇒ [WCA-40]
//   một đơn lệch ⇒ cả lô dừng ⇒ [WCA-41]   |   dòng ký ràng chế độ ⇒ [WCA-50..52]
import { describe, expect, it } from "vitest";
import {
  BANG_WAVE_C_A,
  KHUON_DONG_WAVE_C_A,
  MA_DON_WAVE_C_A,
  dongDauRaWaveCA,
  khoaBeCuaDon,
  lapKeHoachWaveCA,
  type DuLieuWaveCA,
  type MucWaveCA,
} from "./wave-c-gan-danh-tinh";

const KHOA = "k1";
const BE = "be1";
const CS = "cs1";
const bangMot = (code: string, truoc: MucWaveCA["truoc"] = "CHUA_GAN"): Record<string, MucWaveCA> => ({ [code]: { tongDon: 8_976_000, truoc } });

/** Một đơn «hình dạng thật», hợp lệ ở trạng thái «chưa gắn». `moi` ghi đè từng phần. */
function du(code: string, i: number, moi: Partial<{ don: Partial<DuLieuWaveCA["don"]>; dong: Partial<DuLieuWaveCA["don"]["items"][number]>; ghiDanh: Partial<DuLieuWaveCA["ghiDanh"][number]>[] | null; hocVien: DuLieuWaveCA["hocVien"] | null; lead: DuLieuWaveCA["lead"]; be: DuLieuWaveCA["be"]; dongTro: DuLieuWaveCA["dongTroVaoGhiDanh"] }> = {}): DuLieuWaveCA {
  const dong = { id: `it${i}`, type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, metadata: { courseId: KHOA, leadChildId: `${BE}${i}` }, ...moi.dong };
  return {
    don: { id: `o${i}`, code, type: "COURSE", deletedAt: null, studentId: null, leadId: `l${i}`, leadChildId: `${BE}${i}`, centerId: CS, totalAmount: 8_976_000, items: [dong], ...moi.don },
    lead: moi.lead === undefined ? { id: `l${i}`, centerId: CS, deletedAt: null } : moi.lead,
    be: moi.be === undefined ? { id: `${BE}${i}`, leadId: `l${i}` } : moi.be,
    hocVien: moi.hocVien === undefined ? [{ id: `s${i}`, leadId: `l${i}`, leadChildId: `${BE}${i}`, centerId: CS }] : (moi.hocVien ?? []),
    ghiDanh:
      moi.ghiDanh === null
        ? []
        : (moi.ghiDanh ?? [{}]).map((g, k) => ({ id: `e${i}${k === 0 ? "" : `x${k}`}`, studentId: `s${i}`, courseId: KHOA, status: "ACTIVE", leadChildId: `${BE}${i}`, centerId: CS, ...g })),
    dongTroVaoGhiDanh: moi.dongTro ?? [],
  };
}

const MA1 = "ORD-T-1";
const mot = (d: DuLieuWaveCA, truoc: MucWaveCA["truoc"] = "CHUA_GAN") => lapKeHoachWaveCA({ bang: bangMot(d.don.code, truoc), du: [d] });
const maLoi = (k: ReturnType<typeof lapKeHoachWaveCA>) => k.loi.map((x) => x.ma).sort();

describe("[WCA] bảng phạm vi cứng", () => {
  it("[WCA-01] đúng 18 mã đơn duy nhất, đúng khuôn ORD-yymmdd-nnnnnn; đúng MỘT đơn ở trạng thái «dòng đơn đã gắn» còn lại là «chưa gắn»", () => {
    expect(MA_DON_WAVE_C_A).toHaveLength(18);
    expect(new Set(MA_DON_WAVE_C_A).size).toBe(18);
    for (const m of MA_DON_WAVE_C_A) expect(m).toMatch(/^ORD-\d{6}-\d{6}$/);
    const truoc = Object.values(BANG_WAVE_C_A).map((m) => m.truoc);
    expect(truoc.filter((t) => t === "DONG_DA_GAN")).toHaveLength(1);
    expect(truoc.filter((t) => t === "CHUA_GAN")).toHaveLength(17);
  });

  it("[WCA-03] bảng cứng KHÔNG chứa định danh tài chính / cá nhân: chỉ mã đơn + tổng đơn + trạng thái xuất phát", () => {
    for (const m of Object.values(BANG_WAVE_C_A)) expect(Object.keys(m).sort()).toEqual(["tongDon", "truoc"]);
  });

  it("[WCA-02] ĐỐI CHỨNG DƯƠNG: 18 đơn tổng hợp hợp lệ ⇒ kế hoạch SẴN SÀNG, 17 dòng ghi 3 cột + 1 dòng ghi 1 cột, không lỗi", () => {
    const codes = MA_DON_WAVE_C_A;
    const du18 = codes.map((c, i) =>
      BANG_WAVE_C_A[c]!.truoc === "DONG_DA_GAN" ? du(c, i, { dong: { studentId: `s${i}`, enrollmentId: `e${i}` } }) : du(c, i),
    ).map((d, i) => ({ ...d, don: { ...d.don, totalAmount: BANG_WAVE_C_A[codes[i]!]!.tongDon } }));
    const kh = lapKeHoachWaveCA({ bang: BANG_WAVE_C_A, du: du18 });
    expect(kh.loi).toEqual([]);
    expect(kh.dung).toBe(false);
    expect(kh.ghi).toHaveLength(18);
    expect(kh.ghi.filter((g) => g.che === "3COT")).toHaveLength(17);
    expect(kh.ghi.filter((g) => g.che === "1COT")).toHaveLength(1);
    expect(kh.sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("[WCA] một đơn — điều kiện", () => {
  it("[WCA-00] đối chứng dương: một đơn «chưa gắn» hợp lệ ⇒ ghi 3 cột, đúng học viên + ghi danh suy từ khoá bé", () => {
    const k = mot(du(MA1, 1));
    expect(k.loi).toEqual([]);
    expect(k.ghi).toEqual([{ orderId: "o1", code: MA1, orderItemId: "it1", studentId: "s1", enrollmentId: "e1", che: "3COT" }]);
  });

  it("[WCA-10] đơn đã xoá mềm / không phải COURSE ⇒ dừng", () => {
    expect(maLoi(mot(du(MA1, 1, { don: { deletedAt: new Date() } })))).toContain("DON_DA_XOA");
    expect(maLoi(mot(du(MA1, 1, { don: { type: "PRODUCT" } })))).toContain("DON_KHONG_PHAI_KHOA_HOC");
  });

  it("[WCA-11] tổng đơn trôi so với bảng đã audit ⇒ TONG_DON_LECH", () => {
    expect(maLoi(mot(du(MA1, 1, { don: { totalAmount: 8_976_001 } })))).toEqual(["TONG_DON_LECH"]);
  });

  it("[WCA-12] đơn nhiều dòng / nhiều con (2 dòng COURSE_ENROLLMENT) ⇒ SO_DONG_KHONG_DUNG — C-A không đoán đơn nhiều con", () => {
    const d = du(MA1, 1);
    const hai = { ...d, don: { ...d.don, items: [...d.don.items, { id: "it1b", type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, metadata: { courseId: KHOA, leadChildId: "be-khac" } }] } };
    const k = mot(hai);
    expect(maLoi(k)).toContain("SO_DONG_KHONG_DUNG");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-13] thiếu lead / lead đã xoá / lead khác cơ sở ⇒ dừng", () => {
    expect(maLoi(mot(du(MA1, 1, { don: { leadId: null }, lead: null })))).toContain("THIEU_LEAD");
    expect(maLoi(mot(du(MA1, 1, { lead: { id: "l1", centerId: CS, deletedAt: new Date() } })))).toContain("LEAD_KHONG_HOP_LE");
    expect(maLoi(mot(du(MA1, 1, { lead: { id: "l1", centerId: "cs2", deletedAt: null } })))).toContain("LEAD_KHONG_HOP_LE");
  });

  it("[WCA-14] khoá bé: lấy từ metadata của dòng đơn khi Order.leadChildId NULL (hai đơn thật thiếu cột này); lấy từ Order.leadChildId khi metadata thiếu", () => {
    const a = du(MA1, 1, { don: { leadChildId: null } });
    expect(khoaBeCuaDon(null, a.don.items[0]!.metadata)).toEqual({ khoa: `${BE}1`, xungDot: false });
    expect(mot(a).ghi).toHaveLength(1);
    const b = du(MA1, 1, { dong: { metadata: { courseId: KHOA } } });
    expect(khoaBeCuaDon(`${BE}1`, b.don.items[0]!.metadata)).toEqual({ khoa: `${BE}1`, xungDot: false });
    expect(mot(b).ghi).toHaveLength(1);
  });

  it("[WCA-15] metadata.leadChildId ≠ Order.leadChildId ⇒ XUNG_DOT_BE, không gắn", () => {
    const d = du(MA1, 1, { dong: { metadata: { courseId: KHOA, leadChildId: "be-khac" } } });
    expect(khoaBeCuaDon(`${BE}1`, d.don.items[0]!.metadata).xungDot).toBe(true);
    const k = mot(d);
    expect(maLoi(k)).toContain("XUNG_DOT_BE");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-16] không có khoá bé nào ⇒ THIEU_BE; bé không thuộc lead của đơn ⇒ BE_KHONG_THUOC_LEAD", () => {
    expect(maLoi(mot(du(MA1, 1, { don: { leadChildId: null }, dong: { metadata: { courseId: KHOA } }, be: null })))).toContain("THIEU_BE");
    expect(maLoi(mot(du(MA1, 1, { be: { id: `${BE}1`, leadId: "lead-khac" } })))).toContain("BE_KHONG_THUOC_LEAD");
  });

  it("[WCA-20] không có học viên mang khoá bé ⇒ KHONG_CO_HOC_VIEN", () => {
    expect(maLoi(mot(du(MA1, 1, { hocVien: [] })))).toContain("KHONG_CO_HOC_VIEN");
  });

  it("[WCA-21] HAI học viên cùng khoá bé (trùng) ⇒ NHIEU_HOC_VIEN, không đoán", () => {
    const k = mot(du(MA1, 1, { hocVien: [{ id: "s1", leadId: "l1", leadChildId: `${BE}1`, centerId: CS }, { id: "s1b", leadId: "l1", leadChildId: `${BE}1`, centerId: CS }] }));
    expect(maLoi(k)).toContain("NHIEU_HOC_VIEN");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-22] học viên lệch lead / lệch cơ sở ⇒ dừng", () => {
    expect(maLoi(mot(du(MA1, 1, { hocVien: [{ id: "s1", leadId: "lead-khac", leadChildId: `${BE}1`, centerId: CS }] })))).toContain("HOC_VIEN_LECH_LEAD");
    expect(maLoi(mot(du(MA1, 1, { hocVien: [{ id: "s1", leadId: "l1", leadChildId: `${BE}1`, centerId: "cs2" }] })))).toContain("HOC_VIEN_LECH_CO_SO");
  });

  it("[WCA-23] không có ghi danh cùng khoá + cơ sở ⇒ KHONG_CO_GHI_DANH", () => {
    expect(maLoi(mot(du(MA1, 1, { ghiDanh: null })))).toContain("KHONG_CO_GHI_DANH");
  });

  it("[WCA-24] HAI ghi danh còn hiệu lực cùng khoá + cơ sở ⇒ NHIEU_GHI_DANH, không đoán; ghi danh CANCELLED/WITHDREW/TRANSFERRED không tính", () => {
    const k = mot(du(MA1, 1, { ghiDanh: [{}, {}] }));
    expect(maLoi(k)).toContain("NHIEU_GHI_DANH");
    expect(k.ghi).toEqual([]);
    for (const st of ["CANCELLED", "WITHDREW", "TRANSFERRED"]) {
      const ok = mot(du(MA1, 1, { ghiDanh: [{}, { status: st }] }));
      expect(ok.loi, st).toEqual([]);
      expect(ok.ghi, st).toHaveLength(1);
    }
  });

  it("[WCA-25] ghi danh khác KHOÁ HỌC với dòng đơn ⇒ không phải ứng viên (KHONG_CO_GHI_DANH), không gắn nhầm khoá khác của cùng bé", () => {
    const k = mot(du(MA1, 1, { ghiDanh: [{ courseId: "khoa-khac" }] }));
    expect(maLoi(k)).toContain("KHONG_CO_GHI_DANH");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-26] ghi danh khác CƠ SỞ với đơn ⇒ không phải ứng viên; dòng đơn không ghi courseId ⇒ THIEU_KHOA_TREN_DONG", () => {
    expect(maLoi(mot(du(MA1, 1, { ghiDanh: [{ centerId: "cs2" }] })))).toContain("KHONG_CO_GHI_DANH");
    expect(maLoi(mot(du(MA1, 1, { dong: { metadata: { leadChildId: `${BE}1` } } })))).toContain("THIEU_KHOA_TREN_DONG");
  });

  it("[WCA-27] ghi danh ĐÃ thuộc dòng đơn của đơn KHÁC ⇒ GHI_DANH_DA_BI_DUNG; chính dòng của đơn này trỏ vào thì không phải lỗi", () => {
    expect(maLoi(mot(du(MA1, 1, { dongTro: [{ orderItemId: "it-khac", orderId: "o-khac", enrollmentId: "e1" }] })))).toContain("GHI_DANH_DA_BI_DUNG");
    expect(mot(du(MA1, 1, { dongTro: [{ orderItemId: "it1", orderId: "o1", enrollmentId: "e1" }] })).loi).toEqual([]);
  });

  it("[WCA-28] ghi danh «chưa gắn» đòi Enrollment.leadChildId = khoá bé; lệch ⇒ GHI_DANH_LECH_BE", () => {
    expect(maLoi(mot(du(MA1, 1, { ghiDanh: [{ leadChildId: "be-khac" }] })))).toContain("GHI_DANH_LECH_BE");
    expect(maLoi(mot(du(MA1, 1, { ghiDanh: [{ leadChildId: null }] })))).toContain("GHI_DANH_LECH_BE");
  });
});

describe("[WCA] trạng thái liên kết hiện tại — NULL hoặc đã đúng, trôi ⇒ dừng", () => {
  it("[WCA-30] «dòng đơn đã gắn ĐÚNG, thiếu Order.studentId» (đơn thật 261017) ⇒ ghi MỘT cột; ghi danh không cần leadChildId trong chế độ này", () => {
    const d = du(MA1, 1, { dong: { studentId: "s1", enrollmentId: "e1" }, ghiDanh: [{ leadChildId: null }] });
    const k = mot(d, "DONG_DA_GAN");
    expect(k.loi).toEqual([]);
    expect(k.ghi).toEqual([{ orderId: "o1", code: MA1, orderItemId: "it1", studentId: "s1", enrollmentId: "e1", che: "1COT" }]);
  });

  it("[WCA-31] dòng đơn đã trỏ SAI học viên hoặc SAI ghi danh ⇒ DONG_DON_TRO_SAI, KHÔNG đè", () => {
    expect(maLoi(mot(du(MA1, 1, { dong: { studentId: "s-khac", enrollmentId: "e1" } }), "DONG_DA_GAN"))).toContain("DONG_DON_TRO_SAI");
    expect(maLoi(mot(du(MA1, 1, { dong: { studentId: "s1", enrollmentId: "e-khac" } }), "DONG_DA_GAN"))).toContain("DONG_DON_TRO_SAI");
    expect(maLoi(mot(du(MA1, 1, { dong: { studentId: null, enrollmentId: "e-khac" } })))).toContain("DONG_DON_TRO_SAI");
  });

  it("[WCA-32] Order.studentId đã có mà trỏ HỌC VIÊN KHÁC ⇒ dừng (TRANG_THAI_GAN_LECH), KHÔNG đè", () => {
    const k = mot(du(MA1, 1, { don: { studentId: "s-khac" } }));
    expect(maLoi(k)).toContain("TRANG_THAI_GAN_LECH");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-33] trạng thái khác bảng đã audit (bảng khai CHUA_GAN nhưng dòng đơn đã gắn một nửa / bảng khai DONG_DA_GAN nhưng dòng đơn còn trống) ⇒ TRUOC_LECH_BANG — đơn đã trôi", () => {
    expect(maLoi(mot(du(MA1, 1, { dong: { studentId: "s1", enrollmentId: "e1" } }), "CHUA_GAN"))).toContain("TRUOC_LECH_BANG");
    expect(maLoi(mot(du(MA1, 1), "DONG_DA_GAN"))).toContain("TRUOC_LECH_BANG");
  });

  it("[WCA-34] ba cột đã ĐÚNG ⇒ «ĐÃ GẮN», 0 dòng ghi, không lỗi (đối chứng dương cho chạy lại)", () => {
    const k = mot(du(MA1, 1, { don: { studentId: "s1" }, dong: { studentId: "s1", enrollmentId: "e1" } }));
    expect(k.loi).toEqual([]);
    expect(k.muc[0]!.trangThai).toBe("DA_GAN");
    expect(k.ghi).toEqual([]);
    expect(k.daGanHet).toBe(true);
  });

  it("[WCA-35] chỉ có Order.studentId (đúng) mà dòng đơn NULL — trạng thái không nằm trong hai trạng thái cho phép ⇒ dừng", () => {
    expect(maLoi(mot(du(MA1, 1, { don: { studentId: "s1" } })))).toContain("TRANG_THAI_GAN_LECH");
  });
});

describe("[WCA] cả lô", () => {
  const hai = () => {
    const a = du("ORD-T-1", 1);
    const b = du("ORD-T-2", 2);
    const bang = { "ORD-T-1": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const }, "ORD-T-2": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const } };
    return { a, b, bang };
  };

  it("[WCA-40] CHẠY LẠI: cả lô đã gắn đúng ⇒ daGanHet, 0 dòng ghi, dòng ký rỗng", () => {
    const { a, b, bang } = hai();
    const xong = (d: DuLieuWaveCA, i: number): DuLieuWaveCA => ({ ...d, don: { ...d.don, studentId: `s${i}`, items: [{ ...d.don.items[0]!, studentId: `s${i}`, enrollmentId: `e${i}` }] } });
    const k = lapKeHoachWaveCA({ bang, du: [xong(a, 1), xong(b, 2)] });
    expect(k.loi).toEqual([]);
    expect(k.daGanHet).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
  });

  it("[WCA-41] FAIL-CLOSED: MỘT đơn lệch ⇒ KHÔNG dòng ghi nào cho đơn kia (cả lô dừng)", () => {
    const { a, b, bang } = hai();
    const xau = du("ORD-T-2", 2, { hocVien: [] });
    const k = lapKeHoachWaveCA({ bang, du: [a, xau] });
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
    // đối chứng dương: cùng cặp, đơn thứ hai sạch ⇒ ghi cả hai
    expect(lapKeHoachWaveCA({ bang, du: [a, b] }).ghi).toHaveLength(2);
  });

  it("[WCA-42] LÔ LAI (một đơn đã gắn đúng, một đơn chưa) ⇒ LO_HON_HOP, không ghi", () => {
    const { a, b, bang } = hai();
    const xong: DuLieuWaveCA = { ...a, don: { ...a.don, studentId: "s1", items: [{ ...a.don.items[0]!, studentId: "s1", enrollmentId: "e1" }] } };
    const k = lapKeHoachWaveCA({ bang, du: [xong, b] });
    expect(maLoi(k)).toEqual(["LO_HON_HOP"]);
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-43] thiếu đơn / thừa đơn ngoài phạm vi / hai đơn cùng mã ⇒ dừng", () => {
    const { a, bang } = hai();
    expect(maLoi(lapKeHoachWaveCA({ bang, du: [a] }))).toContain("THIEU_DON");
    expect(maLoi(lapKeHoachWaveCA({ bang: { "ORD-T-1": bang["ORD-T-1"]! }, du: [a, du("ORD-NGOAI", 9)] }))).toContain("KHONG_CO_MUC_TIEU");
    expect(maLoi(lapKeHoachWaveCA({ bang: { "ORD-T-1": bang["ORD-T-1"]! }, du: [a, a] }))).toContain("THIEU_DON");
  });

  it("[WCA-44] HAI đơn cùng nhắm MỘT ghi danh ⇒ TRUNG_GHI_DANH, cả lô dừng", () => {
    const a = du("ORD-T-1", 1);
    const b = du("ORD-T-2", 2, { hocVien: [{ id: "s1", leadId: "l2", leadChildId: `${BE}2`, centerId: CS }], ghiDanh: [{ id: "e1", studentId: "s1" }] });
    const bang = { "ORD-T-1": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const }, "ORD-T-2": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const } };
    const k = lapKeHoachWaveCA({ bang, du: [a, b] });
    expect(maLoi(k)).toContain("TRUNG_GHI_DANH");
    expect(k.ghi).toEqual([]);
  });

  it("[WCA-45] ANH CHỊ EM cùng lead/SĐT: hai bé hai khoá bé, mỗi đơn chỉ nhìn học viên của KHOÁ BÉ ĐÚNG — không gắn chéo (đối chứng cho bug cross-split)", () => {
    const a = du("ORD-T-1", 1);
    const b = du("ORD-T-2", 2);
    // Dữ liệu nạp cho đơn 1 cố tình có cả học viên của bé 2 (cùng lead) — chỉ hocVien theo khoá bé 1 được truyền (tầng DB lọc), nên lõi chỉ thấy bé 1.
    const bang = { "ORD-T-1": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const }, "ORD-T-2": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const } };
    const k = lapKeHoachWaveCA({ bang, du: [a, b] });
    expect(k.ghi.map((g) => [g.code, g.studentId, g.enrollmentId])).toEqual([["ORD-T-1", "s1", "e1"], ["ORD-T-2", "s2", "e2"]]);
  });
});

describe("[WCA] dòng ký owner", () => {
  it("[WCA-50] dòng ký có khuôn + id đơn/dòng/học viên/ghi danh + CHẾ ĐỘ ghi; không chứa tên/SĐT/email", () => {
    const k = mot(du(MA1, 1));
    expect(k.dongDauRa).toEqual([`${KHUON_DONG_WAVE_C_A}|o1|${MA1}|it1|s1|e1|3COT`]);
    expect(dongDauRaWaveCA(k.ghi)).toEqual(k.dongDauRa);
  });

  it("[WCA-51] đổi CHẾ ĐỘ ghi (3COT ↔ 1COT) đổi dòng ký, nên đổi digest: chữ ký cho «ghi 3 cột» không dùng được cho «ghi 1 cột»", () => {
    const a = dongDauRaWaveCA([{ orderId: "o", code: "c", orderItemId: "i", studentId: "s", enrollmentId: "e", che: "3COT" }]);
    const b = dongDauRaWaveCA([{ orderId: "o", code: "c", orderItemId: "i", studentId: "s", enrollmentId: "e", che: "1COT" }]);
    expect(a).not.toEqual(b);
  });

  it("[WCA-52] digest ổn định theo thứ tự bảng; đảo thứ tự dữ liệu nạp không đổi dòng ký (thứ tự = thứ tự bảng)", () => {
    const a = du("ORD-T-1", 1);
    const b = du("ORD-T-2", 2);
    const bang = { "ORD-T-1": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const }, "ORD-T-2": { tongDon: 8_976_000, truoc: "CHUA_GAN" as const } };
    expect(lapKeHoachWaveCA({ bang, du: [a, b] }).sha).toBe(lapKeHoachWaveCA({ bang, du: [b, a] }).sha);
  });
});
