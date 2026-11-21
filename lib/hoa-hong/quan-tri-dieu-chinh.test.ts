// [GOV-*] — QUẢN TRỊ ĐIỀU CHỈNH hoa hồng: một người duyệt hay hai, ai được duyệt (hàm THUẦN). Hướng B+C, 16/10/2026.
//
//   [GOV-01] dưới ngưỡng + trong cận + không cảnh báo ⇒ MỘT người (đối chứng dương: không phải cái gì cũng đẩy lên cấp hai)
//   [GOV-02] BẰNG ngưỡng ⇒ cấp hai (biên: `>=`)
//   [GOV-03] vượt ngưỡng ⇒ cấp hai, lý do ghi số đã so
//   [GOV-04] ngưỡng thiếu/hỏng ⇒ cấp hai dù số tiền bé (fail-closed)
//   [GOV-05] vượt cận tiền của giao dịch (|điều chỉnh| > hoa hồng đã ghi cho giao dịch) dù dưới ngưỡng ⇒ cấp hai (không im lặng cho qua)
//   [GOV-06] không tính được cận ⇒ cấp hai (fail-closed)
//   [GOV-07] có cảnh báo gian lận ⇒ cấp hai dù bé
//   [GOV-08] chuyển tiền A→B: absTotal = max(Σ dương, Σ |âm|); trong cận thì một người
//   [GOV-09] `canGocCuaO` = hoa hồng GỐC engine tính (ORIGINAL + LATE_ARRIVAL + REVERSAL); điều chỉnh KHÔNG làm cận lớn thêm; đầu vào hỏng ⇒ 0
//   [GOV-10] `dongDoiQuaRong`: đòi quá số ròng ⇒ chặn cứng
//   [GOV-11] `lyDoKhongDuocDuyet`: tách nhiệm đủ bốn kiểu + đối chứng dương
//   [GOV-12] `KHOA_DUYET_DE_XUAT`: mỗi nguồn gốc đúng MỘT khoá, không đẻ quyền mới
//   [GOV-13] TÍCH LUỸ: gói bé một mình nhưng cộng số đã điều chỉnh trước đó đạt ngưỡng ⇒ cấp hai (chuỗi khiếu nại nhỏ không leo thang)
//   [GOV-14] TÍCH LUỸ: gói bé một mình nhưng tổng với số đã điều chỉnh vượt hoa hồng gốc ⇒ VUOT_CAN, lý do mang `tichLuy`
//   [GOV-15] tích luỹ không đọc được (âm / NaN) ⇒ cấp hai (fail-closed)
//   [GOV-16] `tichLuy: 0` KHÔNG đổi hành vi cũ (đối chứng dương cho [GOV-13/14])
//   [GOV-17..20] YÊU CẦU LOGIC: ngưỡng so với tổng của cả yêu cầu (nhiều ô, một sự kiện / khiếu nại) — 4+4+4 ⇒ cấp hai; ba yêu cầu khác nhau ⇒ vẫn một người; đầu vào hỏng ⇒ cấp hai
//   [GOV-21] ngưỡng cấu hình sai hình (kể cả lớn hơn cột INT4) ⇒ cấp hai
//   [GOV-22] tách nhiệm ba vai: bảng chân trị — không ai giữ hai vai (yêu cầu · duyệt 1 · duyệt 2) ở cả hai cấp
import { describe, expect, it } from "vitest";

import { KHOA_DUYET_DE_XUAT, KIND_DONG_DO_ENGINE_GHI, TRAN_INT4, canGocCuaO, dongDoiQuaRong, lyDoKhongDuocDuyet, quyetQuanTri, tongGoi, type DongGoi, type NguCanhDuyet } from "./quan-tri-dieu-chinh";

// Số trong test là tham số của phép thử, KHÔNG phải cấu hình: ngưỡng thật đọc từ `hoaHong.nguongDuyetHaiCap`.
const NGUONG = 1_000;
const dong = (chenh: number, rong = 5_000): DongGoi => ({ key: "SALE|USER|u1", chenh, kyVong: rong + chenh, rong });
const khongCanh: readonly string[] = [];
/**
 * `tongYeuCau` là tham số BẮT BUỘC của `quyetQuanTri` (luật 7); phần lớn ca cũ canh luật THEO Ô nên cho "yêu cầu logic" chỉ gồm chính gói đang xét — đúng tình trạng
 * của một khiếu nại / sự kiện đổi nguồn chỉ có một ô. Ca nào canh luật THEO YÊU CẦU LOGIC truyền `tongYeuCau` tường minh.
 */
const quyet = (i: Omit<Parameters<typeof quyetQuanTri>[0], "tongYeuCau"> & { tongYeuCau?: number }) => quyetQuanTri({ ...i, tongYeuCau: i.tongYeuCau ?? tongGoi(i.goi).absTotal });

describe("[GOV] quyết định quản trị điều chỉnh", () => {
  it("[GOV-01] dưới ngưỡng, trong cận, không cảnh báo ⇒ SINGLE_APPROVAL", () => {
    const r = quyet({ goi: [dong(NGUONG - 1)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh });
    expect(r.quanTri).toBe("SINGLE_APPROVAL");
    expect(r.lyDo).toEqual([]);
  });

  it("[GOV-02] BẰNG ngưỡng ⇒ SECOND_APPROVAL_REQUIRED (biên là >=)", () => {
    const r = quyet({ goi: [dong(NGUONG)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh });
    expect(r.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(r.lyDo).toEqual([{ ma: "TU_NGUONG", absTotal: NGUONG, tichLuy: 0, nguong: NGUONG }]);
  });

  it("[GOV-03] vượt ngưỡng ⇒ cấp hai; số đòi lại (âm) cũng tính theo giá trị tuyệt đối", () => {
    expect(quyet({ goi: [dong(NGUONG * 5)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    const am = quyet({ goi: [dong(-NGUONG * 2, NGUONG * 3)], nguong: NGUONG, canTren: 0, tichLuy: 0, canhBao: khongCanh });
    expect(am.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(am.lyDo.some((l) => l.ma === "TU_NGUONG")).toBe(true);
  });

  it("[GOV-04] ngưỡng thiếu hoặc hỏng ⇒ cấp hai dù số tiền chỉ 1 đồng (không có nhánh mặc định 'một người')", () => {
    for (const nguong of [null, -1, 1.5, Number.NaN]) {
      const r = quyet({ goi: [dong(1)], nguong, canTren: NGUONG, tichLuy: 0, canhBao: khongCanh });
      expect(r.quanTri, `nguong=${String(nguong)}`).toBe("SECOND_APPROVAL_REQUIRED");
      expect(r.lyDo).toEqual([{ ma: "NGUONG_KHONG_DOC_DUOC" }]);
    }
  });

  it("[GOV-05] |điều chỉnh| vượt hoa hồng đã ghi cho giao dịch ⇒ cấp hai dù DƯỚI ngưỡng", () => {
    const r = quyet({ goi: [dong(500)], nguong: NGUONG, canTren: 499, tichLuy: 0, canhBao: khongCanh });
    expect(r.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(r.lyDo).toEqual([{ ma: "VUOT_CAN", canTren: 499, absTotal: 500, tichLuy: 0 }]);
    // đối chứng dương: đúng bằng cận thì vẫn một người
    expect(quyet({ goi: [dong(500)], nguong: NGUONG, canTren: 500, tichLuy: 0, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL");
  });

  it("[GOV-06] cận không tính được (null / âm / NaN) ⇒ cấp hai", () => {
    for (const canTren of [null, -1, Number.NaN]) {
      const r = quyet({ goi: [dong(1)], nguong: NGUONG, canTren, tichLuy: 0, canhBao: khongCanh });
      expect(r.quanTri, `canTren=${String(canTren)}`).toBe("SECOND_APPROVAL_REQUIRED");
      expect(r.lyDo).toEqual([{ ma: "KHONG_TINH_DUOC_CAN" }]);
    }
  });

  it("[GOV-07] có cảnh báo gian lận ⇒ cấp hai dù bé và trong cận", () => {
    const r = quyet({ goi: [dong(1)], nguong: NGUONG, canTren: NGUONG, tichLuy: 0, canhBao: ["TU_CLAIM"] });
    expect(r.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(r.lyDo).toEqual([{ ma: "CANH_BAO_GIAN_LAN", maCanhBao: ["TU_CLAIM"] }]);
  });

  it("[GOV-08] chuyển tiền A→B: absTotal = max(Σ dương, Σ |âm|); trong cận thì MỘT người, vượt cận thì cấp hai", () => {
    const goi: DongGoi[] = [
      { key: "SOURCE_OWNER|USER|a", chenh: -400, kyVong: 0, rong: 400 },
      { key: "SOURCE_OWNER|USER|b", chenh: 400, kyVong: 400, rong: 0 },
    ];
    expect(tongGoi(goi)).toEqual({ tongDuong: 400, tongAm: 400, absTotal: 400, net: 0 });
    expect(quyet({ goi, nguong: NGUONG, canTren: 400, tichLuy: 0, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL");
    expect(quyet({ goi, nguong: NGUONG, canTren: 399, tichLuy: 0, canhBao: khongCanh }).quanTri).toBe("SECOND_APPROVAL_REQUIRED");
  });

  it("[GOV-09] canGocCuaO = hoa hồng GỐC engine tính: chỉ ORIGINAL + LATE_ARRIVAL + REVERSAL; điều chỉnh không làm cận lớn thêm; ô rỗng = 0; đầu vào hỏng ⇒ 0", () => {
    expect([...KIND_DONG_DO_ENGINE_GHI].sort()).toEqual(["LATE_ARRIVAL", "ORIGINAL", "REVERSAL"]);
    expect(canGocCuaO([{ entryKind: "ORIGINAL", amount: 40_000 }, { entryKind: "ORIGINAL", amount: 50_000 }])).toBe(90_000);
    expect(canGocCuaO([{ entryKind: "ORIGINAL", amount: 90_000 }, { entryKind: "LATE_ARRIVAL", amount: 10_000 }])).toBe(100_000);
    // hoàn tiền (REVERSAL, âm) làm cận NHỎ lại
    expect(canGocCuaO([{ entryKind: "ORIGINAL", amount: 100_000 }, { entryKind: "REVERSAL", amount: -40_000 }])).toBe(60_000);
    // ĐIỂM MẤU CHỐT: điều chỉnh đã ghi (kể cả dương) KHÔNG nâng cận — cận tính từ số ròng sẽ tăng 900k sau khi ghi khiếu nại, cận gốc thì không
    expect(
      canGocCuaO([
        { entryKind: "ORIGINAL", amount: 100_000 },
        { entryKind: "DISPUTE_ADJUSTMENT", amount: 900_000 },
        { entryKind: "SOURCE_CORRECTION", amount: 50_000 },
        { entryKind: "INPUT_CORRECTION", amount: 7_000 },
      ]),
    ).toBe(100_000);
    expect(canGocCuaO([])).toBe(0);
    expect(canGocCuaO([{ entryKind: "ORIGINAL", amount: 10_000 }, { entryKind: "REVERSAL", amount: -30_000 }])).toBe(0); // tổng âm ⇒ 0, không phải số âm
    expect(canGocCuaO([{ entryKind: "ORIGINAL", amount: 100 }, { entryKind: "ORIGINAL", amount: Number.NaN }])).toBe(0);
  });

  it("[GOV-10] đòi lại quá số ròng ⇒ trả đúng dòng vi phạm; không quá ⇒ null", () => {
    const xau = { key: "SALE|USER|u1", chenh: -600, kyVong: 0, rong: 500 };
    expect(dongDoiQuaRong([dong(100), xau])).toBe(xau);
    expect(dongDoiQuaRong([{ ...xau, chenh: -500 }, dong(100)])).toBeNull();
  });

  it("[GOV-13] TÍCH LUỸ: gói bé một mình, nhưng cộng số đã điều chỉnh trước đó đạt ngưỡng ⇒ cấp hai (chuỗi khiếu nại nhỏ không leo thang)", () => {
    // mỗi lần 400 < NGUONG(1000): từng cái một thì lần nào cũng "một người"
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL");
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 400, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL"); // 800 < 1000
    const lan3 = quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 800, canhBao: khongCanh });
    expect(lan3.quanTri).toBe("SECOND_APPROVAL_REQUIRED"); // 1200 >= 1000
    expect(lan3.lyDo).toEqual([{ ma: "TU_NGUONG", absTotal: 400, tichLuy: 800, nguong: NGUONG }]);
    // biên: tích luỹ + gói = ĐÚNG ngưỡng ⇒ cấp hai (cùng biên `>=` với [GOV-02])
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 600, canhBao: khongCanh }).quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 599, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL");
  });

  it("[GOV-14] TÍCH LUỸ: gói bé, tổng với số đã điều chỉnh vượt hoa hồng GỐC ⇒ VUOT_CAN; lý do mang tichLuy", () => {
    const r = quyet({ goi: [dong(300)], nguong: NGUONG * 100, canTren: 1_000, tichLuy: 800, canhBao: khongCanh });
    expect(r.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(r.lyDo).toEqual([{ ma: "VUOT_CAN", canTren: 1_000, absTotal: 300, tichLuy: 800 }]);
    expect(quyet({ goi: [dong(200)], nguong: NGUONG * 100, canTren: 1_000, tichLuy: 800, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL"); // đúng bằng cận
  });

  it("[GOV-15] tích luỹ không đọc được (âm / NaN / vô hạn) ⇒ cấp hai dù gói 1 đồng — không rơi về 0", () => {
    for (const tichLuy of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = quyet({ goi: [dong(1)], nguong: NGUONG, canTren: NGUONG, tichLuy, canhBao: khongCanh });
      expect(r.quanTri, `tichLuy=${String(tichLuy)}`).toBe("SECOND_APPROVAL_REQUIRED");
      expect(r.lyDo.map((l) => l.ma)).toContain("TICH_LUY_KHONG_DOC_DUOC");
    }
  });

  it("[GOV-16] đối chứng dương: tichLuy = 0 cho đúng kết quả cũ của [GOV-01]/[GOV-02]/[GOV-05]", () => {
    expect(quyet({ goi: [dong(NGUONG - 1)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).lyDo).toEqual([]);
    expect(quyet({ goi: [dong(NGUONG)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).lyDo.map((l) => l.ma)).toEqual(["TU_NGUONG"]);
    expect(quyet({ goi: [dong(500)], nguong: NGUONG, canTren: 499, tichLuy: 0, canhBao: khongCanh }).lyDo.map((l) => l.ma)).toEqual(["VUOT_CAN"]);
  });

  // ── [GOV-17..21] YÊU CẦU LOGIC (08 §17.v4.Q): ngưỡng so với TỔNG của cả yêu cầu, không chỉ gói của MỘT ô ───────────────────────────────────────────
  // Một sự kiện đổi nguồn chạm nhiều ô, mỗi ô một đề xuất. Mỗi ô trống tích luỹ theo ô (`tichLuy: 0`) và mỗi gói dưới ngưỡng — nên chỉ có `tongYeuCau` mới thấy chúng là MỘT việc.
  it("[GOV-17] 4+4+4 cùng một yêu cầu logic, ba ô khác nhau: mỗi ô `tichLuy: 0` và 400 < 1000, nhưng tổng yêu cầu 1200 ≥ ngưỡng ⇒ cấp hai, lý do TU_NGUONG_YEU_CAU (không phải TU_NGUONG của ô)", () => {
    const r = quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, tongYeuCau: 1_200, canhBao: khongCanh });
    expect(r.quanTri).toBe("SECOND_APPROVAL_REQUIRED");
    expect(r.lyDo).toEqual([{ ma: "TU_NGUONG_YEU_CAU", absTotal: 400, tongYeuCau: 1_200, nguong: NGUONG }]);
  });

  it("[GOV-18] đối chứng dương: ba yêu cầu KHÁC nhau mỗi cái 400 (tongYeuCau = 400 mỗi cái) ⇒ vẫn MỘT người; biên `>=` ở tổng yêu cầu: 999 một người, 1000 cấp hai", () => {
    for (let i = 0; i < 3; i++) expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, tongYeuCau: 400, canhBao: khongCanh }).lyDo).toEqual([]);
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, tongYeuCau: NGUONG - 1, canhBao: khongCanh }).quanTri).toBe("SINGLE_APPROVAL");
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, tongYeuCau: NGUONG, canhBao: khongCanh }).lyDo.map((l) => l.ma)).toEqual(["TU_NGUONG_YEU_CAU"]);
  });

  it("[GOV-19] luật THEO Ô không bị nới: tích luỹ của ô đạt ngưỡng thì vẫn ra TU_NGUONG (mã của ô đứng trước), kể cả khi tổng yêu cầu cũng đạt — không báo hai lần cùng một việc", () => {
    const r = quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 800, tongYeuCau: 1_200, canhBao: khongCanh });
    expect(r.lyDo.map((l) => l.ma)).toEqual(["TU_NGUONG"]);
  });

  it("[GOV-20] tổng yêu cầu không đọc được (âm · NaN · vô hạn · NHỎ HƠN chính gói đang xét) ⇒ cấp hai, một mã TICH_LUY_KHONG_DOC_DUOC — không rơi về 'chỉ gói này'", () => {
    for (const tongYeuCau of [-1, Number.NaN, Number.POSITIVE_INFINITY, 399]) {
      const r = quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: 0, tongYeuCau, canhBao: khongCanh });
      expect(r.quanTri, `tongYeuCau=${String(tongYeuCau)}`).toBe("SECOND_APPROVAL_REQUIRED");
      expect(r.lyDo.map((l) => l.ma), `tongYeuCau=${String(tongYeuCau)}`).toEqual(["TICH_LUY_KHONG_DOC_DUOC"]);
    }
    // cả tích luỹ lẫn tổng yêu cầu hỏng: vẫn MỘT mã (không đẻ hai dòng lý do giống nhau)
    expect(quyet({ goi: [dong(400)], nguong: NGUONG, canTren: NGUONG * 10, tichLuy: -1, tongYeuCau: -1, canhBao: khongCanh }).lyDo.map((l) => l.ma)).toEqual(["TICH_LUY_KHONG_DOC_DUOC"]);
  });

  it("[GOV-21] NGƯỠNG cấu hình sai hình ⇒ cấp hai dù gói 1 đồng: null · âm · số lẻ · NaN · vô hạn · lớn hơn cột INT4 của `thresholdSnapshot` (nếu để lọt, chụp snapshot nổ lỗi tràn số thay vì fail-closed)", () => {
    for (const nguong of [null, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, TRAN_INT4 + 1, 100_000_000_000]) {
      const r = quyet({ goi: [dong(1)], nguong, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh });
      expect(r.quanTri, `nguong=${String(nguong)}`).toBe("SECOND_APPROVAL_REQUIRED");
      expect(r.lyDo.map((l) => l.ma), `nguong=${String(nguong)}`).toEqual(["NGUONG_KHONG_DOC_DUOC"]);
    }
    // đối chứng dương: 0 và đúng trần INT4 là ngưỡng HỢP LỆ
    expect(quyet({ goi: [dong(1)], nguong: TRAN_INT4, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).lyDo).toEqual([]);
    expect(quyet({ goi: [dong(1)], nguong: 0, canTren: NGUONG * 10, tichLuy: 0, canhBao: khongCanh }).lyDo.map((l) => l.ma)).toEqual(["TU_NGUONG"]);
  });

  // ── [GOV-22] TÁCH NHIỆM ba vai (yêu cầu · duyệt 1 · duyệt 2): bảng chân trị đầy đủ, không để MỘT người giữ hai vai ────────────────────────────────
  it("[GOV-22] mọi cặp vai trùng người đều bị chặn, ở cả hai cấp; chỉ người ngoài cả ba vai (và ngoài người hưởng) mới duyệt được", () => {
    const nguoi = ["yeuCau", "duyet1", "duyet2", "huong", "ngoai"] as const;
    const goc: NguCanhDuyet = { ...nenDuyet, requestedById: "yeuCau", nguoiHuongTrongGoi: new Set(["huong"]) };
    for (const ai of nguoi) {
      // cấp 1: người duyệt không được là người yêu cầu / người hưởng
      const c1 = lyDoKhongDuocDuyet({ ...goc, nguoiDuyetId: ai, cap: 1, quanTri: "SECOND_APPROVAL_REQUIRED", trangThai: "PENDING", approver1Id: null });
      expect(c1 === null, `cấp 1 · ${ai}`).toBe(ai === "duyet1" || ai === "duyet2" || ai === "ngoai");
      // cấp 2 (đã có người duyệt 1 = duyet1): không được là người yêu cầu, người duyệt 1, người hưởng
      const c2 = lyDoKhongDuocDuyet({ ...goc, nguoiDuyetId: ai, cap: 2, quanTri: "SECOND_APPROVAL_REQUIRED", trangThai: "APPROVED_L1", approver1Id: "duyet1" });
      expect(c2 === null, `cấp 2 · ${ai}`).toBe(ai === "duyet2" || ai === "ngoai");
    }
  });

  const nenDuyet: NguCanhDuyet = {
    nguoiDuyetId: "duyet",
    requestedById: "kn",
    approver1Id: null,
    nguoiHuongTrongGoi: new Set(["huong"]),
    cap: 1,
    quanTri: "SINGLE_APPROVAL",
    trangThai: "PENDING",
  };

  it("[GOV-11] tách nhiệm: người đề xuất · người hưởng · cấp 2 trùng cấp 1 · trạng thái sai đều bị chặn; người khác được duyệt", () => {
    expect(lyDoKhongDuocDuyet(nenDuyet)).toBeNull(); // đối chứng dương
    expect(lyDoKhongDuocDuyet({ ...nenDuyet, nguoiDuyetId: "kn" })).toMatch(/người đề xuất/);
    expect(lyDoKhongDuocDuyet({ ...nenDuyet, nguoiDuyetId: "huong" })).toMatch(/người hưởng/);
    const cap2: NguCanhDuyet = { ...nenDuyet, cap: 2, quanTri: "SECOND_APPROVAL_REQUIRED", trangThai: "APPROVED_L1", approver1Id: "a1" };
    expect(lyDoKhongDuocDuyet(cap2)).toBeNull();
    expect(lyDoKhongDuocDuyet({ ...cap2, nguoiDuyetId: "a1" })).toMatch(/cấp 1/);
    expect(lyDoKhongDuocDuyet({ ...cap2, nguoiDuyetId: "kn" })).toMatch(/người đề xuất/);
    expect(lyDoKhongDuocDuyet({ ...cap2, trangThai: "PENDING" })).toMatch(/Chưa qua cấp 1/);
    expect(lyDoKhongDuocDuyet({ ...cap2, quanTri: "SINGLE_APPROVAL" })).toMatch(/một người duyệt/);
    expect(lyDoKhongDuocDuyet({ ...nenDuyet, trangThai: "APPROVED_L1" })).toMatch(/qua cấp 1/);
    for (const t of ["POSTED", "REJECTED", "STALE"] as const) expect(lyDoKhongDuocDuyet({ ...nenDuyet, trangThai: t })).toMatch(/kết thúc/);
  });

  it("[GOV-12] mỗi nguồn gốc đúng MỘT khoá quyền có sẵn (không đẻ quyền mới)", () => {
    expect(KHOA_DUYET_DE_XUAT).toEqual({ DISPUTE: "commission_disputes:review", SOURCE_CHANGE: "commission_periods:manage" });
  });
});
