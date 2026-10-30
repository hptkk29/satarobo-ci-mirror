import { describe, expect, it } from "vitest";
import { CASE_KHONG_PHAI_LICH_THAT, kiemDuyetDuoc, laCaseSong, trangThaiCaseKhiTao } from "./duyet-case-thuan";

// [DCT] Luật THUẦN của case chờ duyệt (20/10/2026). Phần ghi DB có test Postgres thật (`tests/hoc-bu/duyet-case.test.ts`); đây là các quyết định không cần DB.
// Đồng hồ truyền vào (luật 19): ngày TUYỆT ĐỐI + `now` cố định, không đọc giờ thật.
const NGAY = "2026-11-05";
const khung = { ymd: NGAY, startTime: "18:00", endTime: "19:30" };
const luc = (hhmm: string, ngay = NGAY) => new Date(`${ngay}T${hhmm}:00+07:00`);

describe("[DCT-01] trạng thái case khi tạo", () => {
  it("không có quyền duyệt (Sale…) ⇒ CHỜ DUYỆT; có quyền duyệt (quản lý cơ sở / quản trị) ⇒ lịch thật ngay", () => {
    expect(trangThaiCaseKhiTao({ coQuyenDuyet: false })).toBe("PENDING_APPROVAL");
    expect(trangThaiCaseKhiTao({ coQuyenDuyet: true })).toBe("SCHEDULED");
  });
});

describe("[DCT-02] bộ lọc 'không phải lịch thật'", () => {
  it("gồm ĐÚNG đã huỷ + chờ duyệt — không gồm lịch đã duyệt / đã chốt (công dạy của GV đọc COMPLETED, NO_SHOW)", () => {
    expect([...CASE_KHONG_PHAI_LICH_THAT].sort()).toEqual(["CANCELLED", "PENDING_APPROVAL"]);
    for (const s of ["SCHEDULED", "COMPLETED", "NO_SHOW"] as const) expect(CASE_KHONG_PHAI_LICH_THAT).not.toContain(s);
  });
  it("case sống = đã duyệt đang chờ dạy hoặc đang chờ duyệt (bé của nó đang giữ lượt)", () => {
    expect(laCaseSong("SCHEDULED")).toBe(true);
    expect(laCaseSong("PENDING_APPROVAL")).toBe(true);
    for (const s of ["COMPLETED", "NO_SHOW", "CANCELLED"] as const) expect(laCaseSong(s)).toBe(false);
  });
});

describe("[DCT-03] duyệt được không", () => {
  it("đang chờ duyệt, chưa qua giờ kết thúc ⇒ được (kể cả đã qua giờ BẮT ĐẦU — giáo viên vẫn dạy được phần còn lại)", () => {
    expect(kiemDuyetDuoc({ status: "PENDING_APPROVAL", ...khung, now: luc("10:00") })).toEqual({ ok: true });
    expect(kiemDuyetDuoc({ status: "PENDING_APPROVAL", ...khung, now: luc("18:30") })).toEqual({ ok: true });
  });
  it("đúng giờ kết thúc trở đi ⇒ KHÔNG (phải từ chối để bé quay lại danh sách cần bù)", () => {
    const kq = kiemDuyetDuoc({ status: "PENDING_APPROVAL", ...khung, now: luc("19:30") });
    expect(kq.ok).toBe(false);
    expect(!kq.ok && kq.lyDo).toContain("đã qua giờ");
    expect(kiemDuyetDuoc({ status: "PENDING_APPROVAL", ...khung, now: luc("08:00", "2026-11-06") }).ok).toBe(false);
  });
  it("không ở trạng thái chờ duyệt ⇒ KHÔNG, dù giờ còn xa (đã duyệt rồi / đã huỷ / đã chốt)", () => {
    for (const status of ["SCHEDULED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
      const kq = kiemDuyetDuoc({ status, ...khung, now: luc("08:00", "2026-11-01") });
      expect(kq.ok, status).toBe(false);
      expect(!kq.ok && kq.lyDo, status).toContain("chờ duyệt");
    }
  });
});
