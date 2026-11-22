// Ca [POS4-HT-01..03] — chữ của màn Sức khoẻ POS Agent (GĐ4). THUẦN. Mỗi câu là một lời hứa (luật 12): thẻ
// nói "Đang làm việc" chỉ khi máy vừa gọi về trong ngưỡng gác sale (3 phút — cùng `sucKhoeAgent`).
import { describe, it, expect } from "vitest";
import { khoang, luc, tomTatSuKien, trangThaiThe, truocDay } from "./hien-thi";

const GIAY = 1_000;
const PHUT = 60 * GIAY;
/** Thứ Tư 07/10/2026 10:20:00 giờ VN. */
const NOW = new Date("2026-10-07T03:20:00Z");
const truoc = (ms: number) => new Date(NOW.getTime() - ms);

const BASE = {
  active: true,
  sessionState: "READY" as const,
  sessionDoiLuc: null,
  sessionExpiresAt: new Date("2026-10-08T01:15:00Z"),
  lastHeartbeatAt: truoc(25 * GIAY),
  matKetNoiTuLuc: null,
  lastSyncedAt: truoc(40 * GIAY),
  coSo: "CS1",
};

describe("[POS4-HT-01] luc / khoang", () => {
  it("cùng ngày VN ⇒ hh:mm; khác ngày ⇒ hh:mm dd/mm; giây khi xin", () => {
    expect(luc(truoc(10 * PHUT), NOW)).toBe("10:10");
    expect(luc(new Date("2026-10-06T15:00:00Z"), NOW)).toBe("22:00 06/10");
    expect(luc(truoc(5 * GIAY), NOW, true)).toBe("10:19:55");
  });
  it("mốc vừa qua: < 5 giây ⇒ 'vừa xong' (không in '0 giây trước'); từ 5 giây ⇒ 'N giây trước'", () => {
    expect(truocDay(0)).toBe("vừa xong");
    expect(truocDay(4_999)).toBe("vừa xong");
    expect(truocDay(5_000)).toBe("5 giây trước");
    expect(trangThaiThe({ ...BASE, lastHeartbeatAt: truoc(800) }, NOW).cau).toBe("Liên lạc vừa xong, nhận lô cuối lúc 10:19.");
  });
  it("khoảng gọn tiếng Việt", () => {
    expect(khoang(25 * GIAY)).toBe("25 giây");
    expect(khoang(7 * PHUT)).toBe("7 phút");
    expect(khoang(190 * PHUT)).toBe("3 giờ 10 phút");
    expect(khoang(52 * 60 * PHUT)).toBe("2 ngày 4 giờ");
  });
});

describe("[POS4-HT-02] trangThaiThe — cùng ngưỡng D9 (3 phút)", () => {
  it("vừa gọi về ⇒ Đang làm việc, không việc phải làm", () => {
    expect(trangThaiThe(BASE, NOW)).toEqual({
      nhan: "Đang làm việc",
      tone: "success",
      cau: "Liên lạc 25 giây trước, nhận lô cuối lúc 10:19.",
      lamGi: null,
    });
  });
  it("im 3′+1ms ⇒ Mất kết nối + việc phải làm; đúng 3′ ⇒ vẫn làm việc", () => {
    expect(trangThaiThe({ ...BASE, lastHeartbeatAt: truoc(3 * PHUT + 1) }, NOW)).toMatchObject({ nhan: "Mất kết nối", tone: "danger" });
    expect(trangThaiThe({ ...BASE, lastHeartbeatAt: truoc(3 * PHUT) }, NOW).nhan).toBe("Đang làm việc");
  });
  it("hết phiên ⇒ câu nói đúng điều sale đang thấy + việc phải làm (remote, đăng nhập lại hồ sơ CS1)", () => {
    const t = trangThaiThe({ ...BASE, sessionState: "EXPIRED", sessionDoiLuc: truoc(20 * PHUT) }, NOW);
    expect(t.nhan).toBe("Hết phiên");
    expect(t.cau).toContain("Tạm mất kết nối Techcombank CS1");
    expect(t.lamGi).toBe("Remote vào máy POS Agent, mở hồ sơ Chrome CS1 và đăng nhập lại portal.");
  });
  it("tắt ⇒ Đã tắt (thắng mọi trạng thái); chưa từng gọi ⇒ Chưa kết nối; UNKNOWN ⇒ Chưa rõ phiên", () => {
    expect(trangThaiThe({ ...BASE, active: false, sessionState: "EXPIRED" }, NOW).nhan).toBe("Đã tắt");
    expect(trangThaiThe({ ...BASE, lastHeartbeatAt: null }, NOW).nhan).toBe("Chưa kết nối");
    expect(trangThaiThe({ ...BASE, sessionState: "UNKNOWN" }, NOW).nhan).toBe("Chưa rõ phiên");
  });
  it("phiên hết hạn trước 21:00 hôm nay ⇒ nhắc đăng nhập lại trước giờ đó (chưa hết thì vẫn Đang làm việc)", () => {
    const t = trangThaiThe({ ...BASE, sessionExpiresAt: new Date("2026-10-07T13:00:00Z") }, NOW);
    expect(t.nhan).toBe("Đang làm việc");
    expect(t.lamGi).toBe("Phiên portal hết hạn lúc 20:00 hôm nay — đăng nhập lại trước giờ đó.");
  });
});

describe("[POS4-HT-03] tomTatSuKien — chỉ số đếm / mã, không PII", () => {
  it("SYNC: nhận luôn in; số 0 bỏ; trễ > 10′ in", () => {
    expect(tomTatSuKien("SYNC", null, { received: 12, created: 2, updated: 0, matched: 1, rejected: 0, errors: 0, treNhatPhut: 95 })).toBe(
      "nhận 12 · mới 2 · khớp 1 · trễ nhất 1 giờ 35 phút",
    );
  });
  it("[POS4-G3-HT] SYNC mang `lech` (gộp GĐ3) ⇒ in 'lệch N' khi > 0; 0 / vắng (sự kiện trước gộp) ⇒ không in", () => {
    expect(tomTatSuKien("SYNC", null, { received: 3, updated: 2, lech: 2, rejected: 0, errors: 0, treNhatPhut: 0 })).toBe(
      "nhận 3 · cập nhật 2 · lệch 2",
    );
    expect(tomTatSuKien("SYNC", null, { received: 3, updated: 2, lech: 0 })).toBe("nhận 3 · cập nhật 2");
    expect(tomTatSuKien("SYNC", null, { received: 3, updated: 2 })).toBe("nhận 3 · cập nhật 2");
  });
  it("ERROR gộp ngày: mã ⇒ chữ + số lần; mã lạ giữ nguyên", () => {
    expect(tomTatSuKien("ERROR", "HEADER_NOT_CAPTURED", { dem: 3 })).toBe("Chưa bắt được header portal · 3 lần trong ngày");
    expect(tomTatSuKien("ERROR", "MA_LA_X", { dem: 1 })).toBe("MA_LA_X");
  });
  it("HEARTBEAT: kết nối lại sau N phút · đổi phiên bản", () => {
    expect(tomTatSuKien("HEARTBEAT", "KET_NOI_LAI", { phut: 7 })).toBe("Kết nối lại sau 7 phút");
    expect(tomTatSuKien("HEARTBEAT", "DOI_PHIEN_BAN", { tu: "0.1.0", den: "0.2.0" })).toBe("Extension 0.1.0 → 0.2.0");
  });
  it("[POS4-HT-03b] SESSION_*: lý do ⇒ chữ người đọc (không in trần 'Lý do REDIRECT_LOGIN'); mã lạ giữ 'Lý do <mã>'", () => {
    expect(tomTatSuKien("SESSION_EXPIRED", null, { reason: "REDIRECT_LOGIN" })).toBe("Portal chuyển về trang đăng nhập");
    expect(tomTatSuKien("SESSION_READY", null, { reason: "USER_PRESENT" })).toBe("Đã đăng nhập lại portal");
    expect(tomTatSuKien("SESSION_READY", null, { reason: "HEARTBEAT" })).toBe("Báo qua tín hiệu định kỳ");
    expect(tomTatSuKien("SESSION_EXPIRED", null, { reason: "MA_LA_Y" })).toBe("Lý do MA_LA_Y");
    expect(tomTatSuKien("SESSION_EXPIRED", null, {})).toBe("—");
  });
});
