// Ca [NLT-P*] — luật THUẦN của đường báo ngoại lệ TỨC THỜI (Invoice Hub, §6 hợp đồng đợt 2): loại nào được báo tức thời, mức nào, khoá chống trùng ra sao.
// Hành vi ghi / chuông / cô lập cơ sở đo ở `tests/finance/hoa-don-ngoai-le-tuc-thoi-db.test.ts` (Postgres thật).
import { describe, expect, it } from "vitest";
import { LOAI_TUC_THOI, dungThongBaoTucThoi, khoaNgoaiLeTucThoi, khoaThongBaoTucThoi, loaiQuaHan, mucTucThoi } from "./ngoai-le-tuc-thoi";
import { TIEN_TO_NGOAI_LE } from "./quet-nghia-vu-thong-bao";

describe("[NLT-P01] mức theo loại: từ chối nhà cung cấp = cần xử lý; không rõ kết quả = KHẨN (có thể đã phát hành thật ⇒ nguy cơ trùng / mất)", () => {
  it("hai loại, hai mức; đối chứng: không có loại thứ ba lọt vào", () => {
    expect(mucTucThoi("TU_CHOI_NHA_CUNG_CAP")).toBe("CAN_XU_LY");
    expect(mucTucThoi("KHONG_RO_QUA_HAN")).toBe("KHAN");
    expect(mucTucThoi("LOI_TEP_QUA_HAN")).toBe("CAN_XU_LY");
    expect(mucTucThoi("LOI_KY")).toBe("CAN_XU_LY");
    expect([...LOAI_TUC_THOI].sort()).toEqual(["KHONG_RO_QUA_HAN", "LOI_KY", "LOI_TEP_QUA_HAN", "TU_CHOI_NHA_CUNG_CAP"]);
  });
});

describe("[NLT-P02] khoá chống trùng: theo loại + hoá đơn + khoá lượt (refId) — cùng lượt trùng khoá, lượt phát hành lại thì khác", () => {
  it("cùng ba thành phần ⇒ cùng khoá; đổi MỘT thành phần ⇒ khác khoá", () => {
    const k = khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", "hd1", "ref-1");
    expect(khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", "hd1", "ref-1")).toBe(k);
    expect(khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", "hd1", "ref-2")).not.toBe(k);
    expect(khoaNgoaiLeTucThoi("TU_CHOI_NHA_CUNG_CAP", "hd2", "ref-1")).not.toBe(k);
    expect(khoaNgoaiLeTucThoi("KHONG_RO_QUA_HAN", "hd1", "ref-1")).not.toBe(k);
  });
  it("khoá bắt đầu bằng loại (chỉ mục từng phần và bộ lọc theo loại đọc theo tiền tố) và không chứa khoảng trắng", () => {
    const k = khoaNgoaiLeTucThoi("KHONG_RO_QUA_HAN", "hd1", "ref-1");
    expect(k.startsWith("KHONG_RO_QUA_HAN:")).toBe(true);
    expect(k).not.toMatch(/\s/);
  });
});

describe("[NLT-P03] chuông của MỘT ngoại lệ: khoá riêng, không PII, không người nhận ⇒ không gửi", () => {
  const co = { ngoaiLeId: "nl-1", loai: "TU_CHOI_NHA_CUNG_CAP" as const, muc: "CAN_XU_LY" as const, tenCoSo: "Cơ sở A", nguoiNhan: ["u1", "u2", "u1", ""] };
  it("khoá theo ngoại lệ, dưới tiền tố đã khai trong catalog, KHÁC khoá theo ngày của scanner; người nhận lọc trùng / rỗng", () => {
    const tb = dungThongBaoTucThoi(co)!;
    expect(tb.dedupeKey).toBe(khoaThongBaoTucThoi("nl-1"));
    expect(tb.dedupeKey.startsWith(TIEN_TO_NGOAI_LE)).toBe(true);
    expect(tb.dedupeKey).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(tb.userIds).toEqual(["u1", "u2"]);
    expect(dungThongBaoTucThoi({ ...co, ngoaiLeId: "nl-2" })!.dedupeKey).not.toBe(tb.dedupeKey);
  });
  it("nội dung chỉ có tên cơ sở; mức KHẨN được nói ra; đối chứng: mức thường không có chữ KHẨN", () => {
    const thuong = dungThongBaoTucThoi(co)!;
    expect(thuong.body).toContain("Cơ sở A");
    expect(`${thuong.title} ${thuong.body}`).not.toMatch(/KHẨN|\d{6,}|@|ORD-/);
    const khan = dungThongBaoTucThoi({ ...co, loai: "KHONG_RO_QUA_HAN", muc: "KHAN" })!;
    expect(khan.body).toMatch(/KHẨN/);
  });
  it("không người nhận ⇒ null (không gửi chuông rỗng)", () => {
    expect(dungThongBaoTucThoi({ ...co, nguoiNhan: [] })).toBeNull();
    expect(dungThongBaoTucThoi({ ...co, nguoiNhan: [""] })).toBeNull();
  });
});

describe("[NLT-P04] «quá hạn» tính từ lúc gửi, theo ngưỡng cấu hình; không ngưỡng thì không báo", () => {
  const NOW = new Date("2026-11-02T04:00:00Z");
  const gui = new Date("2026-11-02T03:00:00Z"); // 60 phút trước
  const tao = new Date("2026-11-02T02:00:00Z"); // 120 phút trước
  const co = { guiLuc: gui, taoLuc: tao, soHoaDon: null, now: NOW, slaPhut: 60 };
  it("đúng tại mốc ⇒ báo; thiếu một phút ⇒ chưa báo (biên >=)", () => {
    expect(loaiQuaHan(co)).toBe("KHONG_RO_QUA_HAN");
    expect(loaiQuaHan({ ...co, now: new Date(NOW.getTime() - 60_000) })).toBeNull();
  });
  it("chưa gửi lần nào ⇒ tính từ lúc TẠO; đối chứng: có `guiLuc` mới hơn thì tính từ đó", () => {
    expect(loaiQuaHan({ ...co, guiLuc: null })).toBe("KHONG_RO_QUA_HAN");
    expect(loaiQuaHan({ ...co, guiLuc: null, slaPhut: 180 })).toBeNull();
    expect(loaiQuaHan({ ...co, guiLuc: new Date(NOW.getTime() - 5 * 60_000) })).toBeNull();
  });
  it("đã CÓ SỐ hoá đơn ⇒ LOI_TEP_QUA_HAN; số rỗng chuỗi coi như chưa có", () => {
    expect(loaiQuaHan({ ...co, soHoaDon: "127" })).toBe("LOI_TEP_QUA_HAN");
    expect(loaiQuaHan({ ...co, soHoaDon: "" })).toBe("KHONG_RO_QUA_HAN");
  });
  it("ngưỡng null / 0 / âm / NaN ⇒ KHÔNG BAO GIỜ báo (cấu hình hỏng không thành «báo mọi bản»)", () => {
    for (const sla of [null, 0, -5, Number.NaN]) expect(loaiQuaHan({ ...co, slaPhut: sla }), String(sla)).toBeNull();
  });
});
