// lib/entitlements/chinh-sach-p5.test.ts — PR5, phần THUẦN: FREE_MAKEUP không trừ quyền chính · KEEP_LATEST biên · đề xuất / duyệt học vượt · nút theo quyền. Mã ca: [P5-xx].
// (Postgres thật: tests/finance/chinh-sach-p5*.test.ts — [P5-DB-*] / [P5-CD-*].)
import { describe, expect, it, vi } from "vitest";
import { tinhBatDauKhiXepLop, type KetQuaXepLop } from "./bat-dau-khi-xep-lop";
import { chiaBaiThanhBuoi } from "./hoc-vuot";
import { caiDatPhamViRoRang, cauHinhPhamViTuCaiDat } from "./cai-dat";
import { CAU_HINH_PHAM_VI_MAC_DINH, type CauHinhPhamVi } from "./pham-vi-hoc";
import { baiBoSungTuSo, laBaiBoSung, phanLoaiBai, quyetDinhGhiNhan, tinhConLai, tinhDaTieuThu, type DongSoCai, type QuyenHocTomTat } from "./tieu-thu";
import {
  apDungDuyetHocVuot,
  deXuatHocVuot,
  dinhDangDaiBai,
  docDeXuat,
  LoiDuyetHocVuot,
  lyDoChoDuyetHocVuot,
  payloadDeXuat,
  quyenCanDuyetHocVuot,
} from "./hoc-vuot-duyet";
import { hanhDongDuocPhep, xetHanhDong, HANH_DONG_HANG_DOI, type DongHangDoiXet, type NguCanhXet } from "./hang-doi/hanh-dong-duoc-phep";
import { LOAI_HANG_DOI } from "./hang-doi/loai";
import { SETTINGS } from "@/lib/settings/registry";

const CH = CAU_HINH_PHAM_VI_MAC_DINH;
const r = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const full = (N: number, cauHinh: CauHinhPhamVi = CH) => tinhBatDauKhiXepLop({ loai: "FULL", soBuoi: 48, baiKeTiepCuaLop: N, cauHinh, baiMoiBuoiHocVuot: 3 });
// Dòng xin duyệt CŨ (mở trước 21/10/2026) sinh từ chính sách KEEP_LATEST: giữ n bài GẦN NHẤT, bỏ phần đầu. Planner hiện tại KHÔNG còn sinh dạng này (vượt n ⇒ bỏ hết, không xin duyệt);
// dạng này chỉ còn để dựng dòng cũ cho các ca duyệt (`deXuatHocVuot` / `apDungDuyetHocVuot`) — dòng đã mở vẫn phải duyệt được.
const cuKeepLatest = (N: number, cauHinh: CauHinhPhamVi = CH): KetQuaXepLop => {
  const daQua = r(1, N - 1);
  const cat = Math.max(0, daQua.length - cauHinh.catchUpMaxSessions);
  const giu = daQua.slice(cat);
  return { ...full(N, cauHinh), skippedLessons: daQua.slice(0, cat), requiredCatchupLessons: giu, catchupSessions: chiaBaiThanhBuoi(giu, 3), catchupMode: "OVER_CAP_SKIPPED", canXemTay: true };
};
const dong = (lessonOrder: number, source: DongSoCai["source"] = "CLASS", voided = false): DongSoCai => ({ lessonOrder, source, voidedAt: voided ? new Date(0) : null });

// Quyền học FULL 48, bài 1..48, 3 bài học bù miễn phí đầu (vào lớp sau 3 bài).
const QUYEN_FM: QuyenHocTomTat = { purchaseSessions: 48, startLessonOrder: 1, endLessonOrder: 48, baiBoQua: [], freeMakeupSessions: 3, graceSessionsGranted: 2 };

describe("[P5] FREE_MAKEUP — KHÔNG trừ quyền học chính (quyết định 1)", () => {
  it("[P5-01] bài bổ sung = tiền tố liền từ start; ranh giới đúng (start−1 và start+n ngoài)", () => {
    expect(baiBoSungTuSo(1, 3)).toEqual([1, 2, 3]);
    expect(baiBoSungTuSo(13, 2)).toEqual([13, 14]);
    expect(baiBoSungTuSo(5, 0)).toEqual([]);
    const lop = Array.from({ length: 6 }, (_, i) => i + 1).map((b) => [b, laBaiBoSung(QUYEN_FM, b)]);
    expect(lop).toEqual([[1, true], [2, true], [3, true], [4, false], [5, false], [6, false]]);
    expect(laBaiBoSung({ ...QUYEN_FM, freeMakeupSessions: 0 }, 1), "0 bài bổ sung ⇒ không bài nào").toBe(false);
    expect(laBaiBoSung({ startLessonOrder: 13, freeMakeupSessions: 2 }, 12)).toBe(false);
    expect(laBaiBoSung({ startLessonOrder: 13, freeMakeupSessions: 2 }, 15)).toBe(false);
  });

  it("[P5-02] bài học bù miễn phí ⇒ quyết định BO_SUNG (không TIEU_THU), với MỌI nguồn; bài lớp bình thường vẫn TIEU_THU", () => {
    for (const nguon of ["CLASS", "MAKEUP", "CATCH_UP"] as const) {
      expect(quyetDinhGhiNhan(QUYEN_FM, [], 2, nguon), nguon).toEqual({ loai: "BO_SUNG" });
    }
    expect(quyetDinhGhiNhan(QUYEN_FM, [], 4, "CLASS")).toEqual({ loai: "TIEU_THU", nguon: "CLASS", kichHoatLai: false });
    // Đối chứng: cùng quyền học với freeMakeupSessions = 0 thì bài 2 là bài thường.
    expect(quyetDinhGhiNhan({ ...QUYEN_FM, freeMakeupSessions: 0 }, [], 2, "MAKEUP")).toEqual({ loai: "TIEU_THU", nguon: "MAKEUP", kichHoatLai: false });
  });

  it("[P5-03] `phanLoaiBai` KHÔNG đổi (bài bổ sung vẫn TRONG_PHAM_VI — roster / tiến độ chưa nối không bị đụng); idempotent: bài đã có dòng ⇒ DA_CO đi trước", () => {
    expect(phanLoaiBai(QUYEN_FM, 2)).toBe("TRONG_PHAM_VI");
    expect(quyetDinhGhiNhan(QUYEN_FM, [dong(2)], 2, "CLASS")).toEqual({ loai: "DA_CO" });
  });

  it("[P5-04] remaining trừ bài bổ sung: học hết 4–48 (45 bài) mà không bù 1–3 ⇒ còn lại 0 (quyền học HẾT đúng lúc), không kẹt ở 3", () => {
    const soCai = r(4, 48).map((b) => dong(b));
    expect(tinhDaTieuThu(soCai)).toBe(45);
    expect(tinhConLai(QUYEN_FM, 45)).toBe(0);
    expect(tinhConLai({ ...QUYEN_FM, freeMakeupSessions: 0 }, 45), "đối chứng: không trừ ⇒ kẹt ở 3").toBe(3);
    // Còn 1 bài chưa học ⇒ còn 1, chưa hết.
    expect(tinhConLai(QUYEN_FM, 44)).toBe(1);
    // Ân hạn mở NGAY sau bài cuối (không bị bài bổ sung chưa bù giữ lại); quá dải ân hạn thì ngoài phạm vi.
    expect(quyetDinhGhiNhan(QUYEN_FM, soCai, 49, "CLASS")).toEqual({ loai: "AN_HAN", kichHoatLai: false });
    expect(quyetDinhGhiNhan(QUYEN_FM, soCai, 51, "CLASS")).toEqual({ loai: "TU_CHOI", lyDo: "NGOAI_PHAM_VI" });
    expect(quyetDinhGhiNhan(QUYEN_FM, soCai, 48, "CLASS")).toEqual({ loai: "DA_CO" });
  });

  it("[P5-05] gói trọn KHÔNG còn FREE_MAKEUP (21/10/2026: gộp vào n, luôn tạo case bù); FREE_MAKEUP và OVER_CAP_SKIPPED vẫn loại trừ nhau ở MỌI kết quả xếp lớp (cùng CHECK SQL)", () => {
    for (let N = 1; N <= 49; N++) {
      const x = full(N);
      expect(x.freeMakeupLessons, `N=${N}`).toEqual([]);
      expect(x.freeMakeupLessons.length === 0 || x.skippedLessons.length === 0, `N=${N}`).toBe(true);
    }
    expect(full(4).requiredCatchupLessons).toEqual([1, 2, 3]);
    expect(full(5).requiredCatchupLessons).toEqual([1, 2, 3, 4]);
    expect(full(7).requiredCatchupLessons).toEqual(r(1, 6));
    // Mua tiếp (`truoc`) vẫn là FREE_MAKEUP: các bài lỡ học bù miễn phí.
    const tiep = tinhBatDauKhiXepLop({ loai: "MILESTONE", soBuoi: 12, baiKeTiepCuaLop: 20, truoc: { end: 12, graceUsed: 0 }, cauHinh: CH, baiMoiBuoiHocVuot: 3 });
    expect(tiep.catchupMode).toBe("FREE_MAKEUP");
    expect(tiep.freeMakeupLessons.length === 0 || tiep.skippedLessons.length === 0).toBe(true);
  });
});

describe("[P5] học vượt: ≤ n tạo case bù miễn phí, > n vào từ buổi kế tiếp (chốt 21/10/2026)", () => {
  it("[P5-10] ĐÚNG n (đã dạy 6): CATCH_UP, bù cả 6, không bỏ bài nào; n+1 (đã dạy 7): bỏ HẾT, không bù, không học vượt", () => {
    const cap = full(7);
    expect(cap).toMatchObject({ catchupMode: "CATCH_UP", skippedLessons: [], requiredCatchupLessons: r(1, 6), canXemTay: false });
    const vuot = full(8);
    expect(vuot).toMatchObject({ catchupMode: "OVER_CAP_SKIPPED", skippedLessons: r(1, 7), requiredCatchupLessons: [], catchupSessions: [], canXemTay: true });
  });

  it("[P5-11] RẤT NHIỀU buổi (đã dạy 36): bỏ cả 36 bài, không bù bài nào (KHÔNG còn giữ n bài gần nhất); bài bỏ qua LIỀN từ bài 1", () => {
    const x = full(37);
    expect(x.requiredCatchupLessons).toEqual([]);
    expect(x.catchupSessions).toEqual([]);
    expect(x.skippedLessons).toEqual(r(1, 36));
    expect(x.startLesson).toBe(1);
    expect(full(48).skippedLessons).toEqual(r(1, 47));
  });

  it("[P5-12] n CẤU HÌNH THEO CƠ SỞ: n=3 ⇒ đã dạy 5 bỏ hết; n=10 ⇒ đã dạy 8 bù đủ; n=12 (trần của QLCS) ⇒ đã dạy 12 vẫn bù; n=0 ⇒ bỏ hết", () => {
    expect(full(6, { ...CH, catchUpMaxSessions: 3 })).toMatchObject({ requiredCatchupLessons: [], skippedLessons: r(1, 5) });
    expect(full(9, { ...CH, catchUpMaxSessions: 10 })).toMatchObject({ catchupMode: "CATCH_UP", requiredCatchupLessons: r(1, 8), skippedLessons: [] });
    expect(full(13, { ...CH, catchUpMaxSessions: 12 })).toMatchObject({ catchupMode: "CATCH_UP", requiredCatchupLessons: r(1, 12) });
    expect(full(6, { ...CH, catchUpMaxSessions: 0 })).toMatchObject({ requiredCatchupLessons: [], skippedLessons: r(1, 5) });
  });

  it("[P5-13] chính sách vượt trần cũ (KEEP_LATEST / DROP_ALL) KHÔNG còn tác dụng với gói trọn: cùng kết quả, bỏ TẤT CẢ, không học vượt", () => {
    const d = { ...CH, catchUpOverCapPolicy: "DROP_ALL" as const };
    const k = { ...CH, catchUpOverCapPolicy: "KEEP_LATEST" as const };
    expect(full(9, d)).toEqual(full(9, k));
    expect(full(9, d)).toMatchObject({ requiredCatchupLessons: [], skippedLessons: r(1, 8), catchupMode: "OVER_CAP_SKIPPED" });
    // Trong n thì hai chính sách như nhau.
    expect(full(7, d).requiredCatchupLessons).toEqual(r(1, 6));
  });

  it("[P5-14] MẶC ĐỊNH là KEEP_LATEST ở CẢ BA nguồn: hằng `CAU_HINH_PHAM_VI_MAC_DINH`, mặc định của registry, và `cauHinhPhamViTuCaiDat` khi cài đặt = mặc định registry; chính sách LẠ rơi về DROP_ALL (an toàn) và bị đánh dấu KHÔNG RÕ", () => {
    expect(CAU_HINH_PHAM_VI_MAC_DINH.catchUpOverCapPolicy).toBe("KEEP_LATEST");
    const mdReg = SETTINGS["enrollment.catchUpOverCapPolicy"].default;
    expect(mdReg).toBe("KEEP_LATEST");
    const tuReg = {
      lateEntryMaxLessons: SETTINGS["enrollment.lateEntryMaxLessons"].default as number,
      catchUpMaxSessions: SETTINGS["enrollment.catchUpMaxSessions"].default as number,
      catchUpOverCapPolicy: mdReg as string,
      graceCountsTowardNextPurchase: SETTINGS["enrollment.graceCountsTowardNextPurchase"].default as boolean,
    };
    expect(cauHinhPhamViTuCaiDat(tuReg)).toMatchObject({ catchUpOverCapPolicy: "KEEP_LATEST", catchUpMaxSessions: 6, lateEntryMaxLessons: 4 });
    expect(caiDatPhamViRoRang(tuReg)).toBe(true);
    const la = { ...tuReg, catchUpOverCapPolicy: "ABC" };
    expect(cauHinhPhamViTuCaiDat(la).catchUpOverCapPolicy).toBe("DROP_ALL");
    expect(caiDatPhamViRoRang(la)).toBe(false);
    expect(caiDatPhamViRoRang({ ...tuReg, catchUpMaxSessions: -1 })).toBe(false);
    expect(caiDatPhamViRoRang({ ...tuReg, catchUpMaxSessions: 2.5 })).toBe(false);
  });

  it("[P5-15] chỉ OVER_CAP_SKIPPED mới có đề xuất; FREE_MAKEUP / NONE / CATCH_UP ⇒ null (mọi N từ 1 đến 49)", () => {
    for (let N = 1; N <= 49; N++) {
      const x = full(N);
      const dx = deXuatHocVuot(x, CH, true, 3);
      if (x.catchupMode === "OVER_CAP_SKIPPED") expect(dx, `N=${N}`).not.toBeNull();
      else expect(dx, `N=${N}`).toBeNull();
    }
  });
});

describe("[P5] đề xuất / duyệt học vượt (quyết định 5)", () => {
  const dx = deXuatHocVuot(cuKeepLatest(10), CH, true, 3)!; // đã dạy 9: giữ 4–9, bỏ 1–3

  it("[P5-20] định dạng dải bài ổn định; lý do KHÔNG mang số tiền; cùng đầu vào ⇒ cùng chuỗi (dấu vân của điều kiện)", () => {
    expect(dinhDangDaiBai([1, 2, 3, 4, 5])).toBe("1–5");
    expect(dinhDangDaiBai([4, 7])).toBe("4, 7");
    expect(dinhDangDaiBai([3, 4, 5, 9])).toBe("3–5, 9");
    expect(dinhDangDaiBai([5, 3, 4, 3])).toBe("3–5");
    expect(dinhDangDaiBai([])).toBe("");
    const lyDo = lyDoChoDuyetHocVuot(dx);
    expect(lyDo).toBe(lyDoChoDuyetHocVuot(deXuatHocVuot(cuKeepLatest(10), CH, true, 3)!));
    expect(lyDo).not.toMatch(/\d\s?đ/);
    expect(lyDo).toMatch(/9 bài/);
    expect(lyDo).toMatch(/vượt trần học vượt 6 bài/);
    expect(lyDo).not.toBe(lyDoChoDuyetHocVuot(deXuatHocVuot(cuKeepLatest(11), CH, true, 3)!)); // điều kiện đổi ⇒ lý do đổi ⇒ mở lại dòng đã đóng
  });

  it("[P5-21] payload khứ hồi đọc lại đúng; hình dạng lạ ⇒ null (không duyệt theo thứ đoán)", () => {
    const p = payloadDeXuat(dx, { entitlementId: "q1", enrollmentId: "g1", classId: "l1" });
    expect(docDeXuat(p)).toEqual({ ...dx, entitlementId: "q1", enrollmentId: "g1", classId: "l1" });
    expect(docDeXuat(null)).toBeNull();
    expect(docDeXuat({})).toBeNull();
    expect(docDeXuat({ hocVuot: { ...(p.hocVuot as object), baiBoQua: "1,2" } })).toBeNull();
    expect(docDeXuat({ hocVuot: { ...(p.hocVuot as object), chinhSach: "KHAC" } })).toBeNull();
    expect(docDeXuat({ hocVuot: { ...(p.hocVuot as object), entitlementId: 5 } })).toBeNull();
  });

  it("[P5-22] ai được duyệt: cấu hình RÕ ⇒ chỉ approve-exception; cấu hình KHÔNG RÕ và tổng ≤ trần mặc định 6 ⇒ manage cũng duyệt được; tổng > 6 ⇒ approve-exception", () => {
    expect(quyenCanDuyetHocVuot({ capRoRang: true, baiDaGiu: [3], baiDeXuatThem: [1] })).toBe("APPROVE_EXCEPTION");
    expect(quyenCanDuyetHocVuot({ capRoRang: false, baiDaGiu: [3, 4, 5], baiDeXuatThem: [1, 2] })).toBe("MANAGE"); // 5 ≤ 6
    expect(quyenCanDuyetHocVuot({ capRoRang: false, baiDaGiu: r(1, 3), baiDeXuatThem: r(4, 6) })).toBe("MANAGE"); // = 6, biên
    expect(quyenCanDuyetHocVuot({ capRoRang: false, baiDaGiu: r(1, 3), baiDeXuatThem: r(4, 7) })).toBe("APPROVE_EXCEPTION"); // 7 > 6
  });

  it("[P5-23] áp dụng duyệt: đưa các bài CUỐI của tiền tố bỏ qua trở lại; skipped co lại; catchupSessions chia lại theo baiMoiBuoi; khớp baiBoQuaTuSo", () => {
    const kq = apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: dx });
    expect(kq).toEqual({ skippedMoi: 0, requiredMoi: r(1, 9), catchupSessionsMoi: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] });
    // Đề xuất một ĐUÔI liền của phần bỏ (duyệt một phần): phần còn bỏ vẫn liền từ start.
    const mot = apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: { ...dx, baiDeXuatThem: [3] } });
    expect(mot).toMatchObject({ skippedMoi: 2, requiredMoi: [3, ...r(4, 9)] });
  });

  it("[P5-24] áp dụng duyệt TỪ CHỐI khi dữ liệu đã đổi (đã duyệt rồi / xếp lại): số bài bỏ không khớp, bài đề xuất ngoài phần bỏ, đề xuất không phải đuôi liền", () => {
    expect(() => apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 0, requiredHienTai: r(1, 9), deXuat: dx })).toThrow(LoiDuyetHocVuot); // đã duyệt rồi
    expect(() => apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 2, requiredHienTai: r(3, 9), deXuat: dx })).toThrow(LoiDuyetHocVuot);
    expect(() => apDungDuyetHocVuot({ startLesson: 5, skippedSessions: 3, requiredHienTai: r(8, 9), deXuat: dx })).toThrow(LoiDuyetHocVuot); // lệch start
    expect(() => apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: { ...dx, baiDeXuatThem: [7] } })).toThrow(LoiDuyetHocVuot);
    expect(() => apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: { ...dx, baiDeXuatThem: [1] } })).toThrow(/CUỐI/); // bỏ 1 thì để hở bài 2,3 phía sau
    expect(() => apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: { ...dx, baiDeXuatThem: [] } })).toThrow(LoiDuyetHocVuot);
  });

  it("[P5-26] đề xuất LỆCH ĐỘ DÀI so với phần đang bị bỏ ⇒ từ chối (stale): đề xuất cũ phủ một TIỀN TỐ (bỏ [1,2,3]) của phần bỏ hiện tại ([1..6]) không được duyệt phần đuôi; ngược lại (hiện ít hơn đề xuất) cũng từ chối", () => {
    // Cả hai vế độ dài đều phải đòi bằng nhau: `baiBoQua.some((b, i) => b !== hienBoQua[i])` MỘT MÌNH sẽ cho qua cả hai ca dưới (tiền tố khớp từng phần tử).
    expect(() =>
      apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 6, requiredHienTai: r(7, 12), deXuat: { baiBoQua: [1, 2, 3], baiDeXuatThem: [4, 5, 6], baiMoiBuoi: 3 } }),
    ).toThrow(LoiDuyetHocVuot);
    expect(() =>
      apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 3, requiredHienTai: r(4, 9), deXuat: { baiBoQua: [1, 2, 3, 4, 5, 6], baiDeXuatThem: [4, 5, 6], baiMoiBuoi: 3 } }),
    ).toThrow(LoiDuyetHocVuot);
    // Đối chứng dương: đúng độ dài thì duyệt được.
    expect(apDungDuyetHocVuot({ startLesson: 1, skippedSessions: 6, requiredHienTai: r(7, 12), deXuat: { baiBoQua: r(1, 6), baiDeXuatThem: [4, 5, 6], baiMoiBuoi: 3 } })).toMatchObject({ skippedMoi: 3 });
  });

  it("[P5-25] `lyDoChoDuyetHocVuot` là hàm THUẦN của đề xuất: không đọc đồng hồ, không ngẫu nhiên — cùng đề xuất ⇒ cùng chuỗi dù đồng hồ nhích; đề xuất khác ⇒ chuỗi khác (dấu vân của điều kiện)", () => {
    let t = 1_000;
    const dongHo = vi.spyOn(Date, "now").mockImplementation(() => (t += 7_919));
    try {
      const a = lyDoChoDuyetHocVuot(dx);
      const b = lyDoChoDuyetHocVuot(dx);
      const c = lyDoChoDuyetHocVuot(deXuatHocVuot(cuKeepLatest(10), CH, true, 3)!);
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(lyDoChoDuyetHocVuot(deXuatHocVuot(cuKeepLatest(11), CH, true, 3)!)).not.toBe(a);
    } finally {
      dongHo.mockRestore();
    }
  });
});

describe("[P5] nút ≡ action cho DUYET_HOC_VUOT", () => {
  const goc: DongHangDoiXet = { loai: "CHO_DUYET_HOC_VUOT", trangThai: "OPEN", coQuyenHoc: true, trangThaiQuyenHoc: "ACTIVE", daTieuThu: false, quyenCanDuyet: "APPROVE_EXCEPTION" };
  const nc = (o: Partial<NguCanhXet> = {}): NguCanhXet => ({ coQuyenManage: false, coBat: true, coQuyenDuyetNgoaiLe: false, ...o });
  const duoc = (d: Partial<DongHangDoiXet>, n: Partial<NguCanhXet>) => xetHanhDong("DUYET_HOC_VUOT", { ...goc, ...d }, nc(n));

  it("[P5-30] vượt trần: chỉ approve-exception duyệt được; manage thì KHÔNG (và lý do nói rõ nhưng cho đóng); chỉ-xem thì không", () => {
    expect(duoc({}, { coQuyenDuyetNgoaiLe: true }).duoc).toBe(true);
    expect(duoc({}, { coQuyenDuyetNgoaiLe: true, coQuyenManage: true }).duoc).toBe(true);
    const qlcs = duoc({}, { coQuyenManage: true });
    expect(qlcs.duoc).toBe(false);
    expect(!qlcs.duoc && qlcs.lyDo).toMatch(/vượt trần/);
    expect(duoc({}, {}).duoc).toBe(false);
  });

  it("[P5-31] cấu hình không rõ (quyenCan = MANAGE): manage duyệt được; không quyền nào thì không", () => {
    expect(duoc({ quyenCanDuyet: "MANAGE" }, { coQuyenManage: true }).duoc).toBe(true);
    expect(duoc({ quyenCanDuyet: "MANAGE" }, {}).duoc).toBe(false);
  });

  it("[P5-32] fail-closed: payload không đọc được (quyenCan = null) ⇒ không ai duyệt, kể cả approve-exception; sai loại ⇒ không", () => {
    expect(duoc({ quyenCanDuyet: null }, { coQuyenDuyetNgoaiLe: true, coQuyenManage: true }).duoc).toBe(false);
    expect(duoc({ loai: "CHO_XEP_LOP" }, { coQuyenDuyetNgoaiLe: true }).duoc).toBe(false);
  });

  it("[P5-33] cờ TẮT / dòng đã đóng / quyền học không còn hiệu lực ⇒ không duyệt", () => {
    expect(duoc({}, { coQuyenDuyetNgoaiLe: true, coBat: false }).duoc).toBe(false);
    expect(duoc({ trangThai: "DA_XU_LY" }, { coQuyenDuyetNgoaiLe: true }).duoc).toBe(false);
    expect(duoc({ trangThai: "HUY" }, { coQuyenDuyetNgoaiLe: true }).duoc).toBe(false);
    for (const s of ["VOIDED", "STOPPED", "COMPLETED", "EXPIRED", "SEAT_HOLD", "AWAITING_PLACEMENT"]) expect(duoc({ trangThaiQuyenHoc: s }, { coQuyenDuyetNgoaiLe: true }).duoc, s).toBe(false);
    for (const s of ["ACTIVE", "EXHAUSTED", "FROZEN"]) expect(duoc({ trangThaiQuyenHoc: s }, { coQuyenDuyetNgoaiLe: true }).duoc, s).toBe(true);
    expect(duoc({ coQuyenHoc: false, trangThaiQuyenHoc: null }, { coQuyenDuyetNgoaiLe: true }).duoc).toBe(false);
  });

  it("[P5-34] trên dòng CHO_DUYET_HOC_VUOT: QLCS có 'Đóng' nhưng KHÔNG có 'Thử cấp lại' / 'Duyệt học vượt'; người duyệt có cả hai; chỉ-xem rỗng", () => {
    expect(hanhDongDuocPhep(goc, nc({ coQuyenManage: true }))).toEqual(["DONG"]);
    expect(hanhDongDuocPhep(goc, nc({ coQuyenManage: true, coQuyenDuyetNgoaiLe: true }))).toEqual(["DONG", "DUYET_HOC_VUOT"]);
    expect(hanhDongDuocPhep(goc, nc())).toEqual([]);
    // Chỉ approve-exception, không manage: duyệt được nhưng các hành động manage khác KHÔNG.
    expect(hanhDongDuocPhep(goc, nc({ coQuyenDuyetNgoaiLe: true }))).toEqual(["DUYET_HOC_VUOT"]);
  });

  it("[P5-35] nút ≡ action mọi tổ hợp: `hanhDongDuocPhep` luôn bằng bộ lọc của `xetHanhDong`; DUYET_HOC_VUOT chỉ xuất hiện ở loại CHO_DUYET_HOC_VUOT", () => {
    for (const loai of LOAI_HANG_DOI) {
      for (const quyenCanDuyet of [null, "MANAGE", "APPROVE_EXCEPTION"] as const) {
        for (const manage of [false, true]) {
          for (const duyet of [false, true]) {
            for (const coBat of [false, true]) {
              const d: DongHangDoiXet = { loai, trangThai: "OPEN", coQuyenHoc: true, trangThaiQuyenHoc: "ACTIVE", daTieuThu: false, quyenCanDuyet };
              const n: NguCanhXet = { coQuyenManage: manage, coBat, coQuyenDuyetNgoaiLe: duyet };
              const ds = hanhDongDuocPhep(d, n);
              expect(ds).toEqual(HANH_DONG_HANG_DOI.filter((hd) => xetHanhDong(hd, d, n).duoc));
              if (loai !== "CHO_DUYET_HOC_VUOT") expect(ds).not.toContain("DUYET_HOC_VUOT");
            }
          }
        }
      }
    }
  });
});
