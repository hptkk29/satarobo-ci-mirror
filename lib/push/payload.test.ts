// Gói tin gửi vào máy nhân viên: đúng hợp đồng của `public/sw.js`, đúng đường theo host, và
// không bao giờ vượt trần 3993 byte. THUẦN — không DB, không mạng.

import { describe, expect, it } from "vitest";
import { dungGoiTin, duongChoThietBi, TRAN_PAYLOAD_BYTE } from "./payload";

const ADMIN = "https://admin.satarobo.vn";
const GV = "https://giaovien.satarobo.vn";

const CO_BAN = {
  title: "Bạn có lead mới",
  body: "Chị Lan — Cơ sở 1",
  href: "/leads/lead_1",
  dedupeKey: "lead.moi:lead_1",
  origin: ADMIN,
};

function byte(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

describe("[PUSH-D4-T07] hợp đồng bốn khoá với public/sw.js", () => {
  it("gói tin có ĐÚNG title · body · url · tag", () => {
    // `bocPayload` trong sw.js chỉ đọc bốn khoá này. Đổi tên khoá ở đây mà quên sửa sw.js thì
    // mọi thông báo hiện chữ mặc định "Sata Robo / Bạn có thông báo mới" — triệu chứng trông
    // y hệt "payload rỗng", nên rất dễ đi tìm nhầm chỗ.
    const { goiTin } = dungGoiTin(CO_BAN);
    expect(Object.keys(goiTin).sort()).toEqual(["body", "tag", "title", "url"]);
  });

  it("tag = dedupeKey ⇒ hai lần đẩy cùng một việc thì ĐÈ nhau, không xếp chồng", () => {
    expect(dungGoiTin(CO_BAN).goiTin.tag).toBe("lead.moi:lead_1");
  });

  it("nội dung lấy NGUYÊN từ chuông, không thêm gì", () => {
    // Thông báo đẩy hiện trên MÀN HÌNH KHOÁ — kênh duy nhất trong hệ thống mà dữ liệu bay ra
    // ngoài phiên đăng nhập. Thêm SĐT/nguồn/cơ sở ở đây là không có `can()` nào gác được.
    const { goiTin, chuoi } = dungGoiTin(CO_BAN);
    expect(goiTin.title).toBe(CO_BAN.title);
    expect(goiTin.body).toBe(CO_BAN.body);
    expect(chuoi).toBe(JSON.stringify(goiTin));
  });
});

describe("[PUSH-D4-T08] đường mở tính theo TỪNG thiết bị", () => {
  it("origin admin ⇒ giữ nguyên đường clean-URL của chuông", () => {
    expect(duongChoThietBi("/leads/lead_1", ADMIN)).toBe("/leads/lead_1");
  });

  it("origin giáo viên ⇒ đi qua teacherHref, KHÔNG để nguyên đường admin", () => {
    // Mở đường admin từ máy GV là bị `decideRoute` đá ngược về giaovien — một vòng nhảy khó
    // hiểu ngay sau khi người ta vừa bấm thông báo.
    expect(duongChoThietBi("/attendance", GV)).toBe("/teacher/diem-danh");
    expect(duongChoThietBi("/lich", GV)).toBe("/teacher/lich");
  });

  it("đường mà site GV KHÔNG có màn ⇒ về /teacher, tuyệt đối không undefined", () => {
    // `teacherHref("/leads/...")` trả null — mà `/leads/` là loại DUY NHẤT trong allowlist đợt
    // đầu. Để null chui vào `data.url` là sw.js rơi về "/" (trang chủ của host GV), còn để
    // undefined thì `JSON.stringify` NUỐT HẲN khoá `url`. Cả hai đều im lặng.
    expect(duongChoThietBi("/leads/lead_1", GV)).toBe("/teacher");
    const { goiTin } = dungGoiTin({ ...CO_BAN, origin: GV });
    expect(goiTin.url).toBe("/teacher");
    expect(JSON.parse(dungGoiTin({ ...CO_BAN, origin: GV }).chuoi)).toHaveProperty("url");
  });

  it("href rỗng/null ⇒ '/' chứ không phải chuỗi rỗng", () => {
    expect(duongChoThietBi(null, ADMIN)).toBe("/");
    expect(duongChoThietBi("", ADMIN)).toBe("/");
    expect(duongChoThietBi("   ", ADMIN)).toBe("/");
  });

  it("localhost KHÔNG bị coi là host giáo viên", () => {
    expect(duongChoThietBi("/leads/x", "http://localhost:3000")).toBe("/leads/x");
  });
});

describe("[PUSH-D4-T09] trần kích thước — ĐO BẰNG BYTE", () => {
  it("gói tin thường không bị cắt", () => {
    const { daCat, chuoi } = dungGoiTin(CO_BAN);
    expect(daCat).toBe(false);
    expect(byte(chuoi)).toBeLessThanOrEqual(TRAN_PAYLOAD_BYTE);
  });

  it("nội dung dài TIẾNG VIỆT CÓ DẤU bị cắt về dưới trần", () => {
    // Đây là ca mà một cổng đếm KÝ TỰ sẽ cho qua: 2000 ký tự "ằ" là 6000 byte UTF-8, tức gần
    // gấp đôi trần, trong khi `.length` chỉ báo 2000. Repo đã dính đúng bẫy này một lần rồi.
    const body = "ằ".repeat(2000);
    expect(body.length).toBeLessThan(TRAN_PAYLOAD_BYTE);
    expect(byte(body)).toBeGreaterThan(TRAN_PAYLOAD_BYTE);

    const { chuoi, daCat, goiTin } = dungGoiTin({ ...CO_BAN, body });
    expect(daCat).toBe(true);
    expect(byte(chuoi)).toBeLessThanOrEqual(TRAN_PAYLOAD_BYTE);
    // Cắt xong vẫn phải là JSON đọc được và vẫn giữ đủ bốn khoá.
    expect(JSON.parse(chuoi)).toEqual(goiTin);
  });

  it("cắt KHÔNG để lại ký tự hỏng ở đuôi", () => {
    // `Buffer.subarray` cắt đứt đôi một ký tự 3 byte ⇒ chuỗi ra có "�" hiện thẳng trên màn
    // hình khoá của người dùng.
    const { goiTin } = dungGoiTin({ ...CO_BAN, body: "ằ".repeat(2000) });
    expect(goiTin.body).not.toContain("�");
    expect(goiTin.body.endsWith("…")).toBe(true);
  });

  it("cắt NỘI DUNG trước, giữ nguyên tiêu đề", () => {
    // Tiêu đề là thứ người dùng đọc để quyết có mở hay không; mất nó là mất tác dụng của cả
    // thông báo.
    const { goiTin } = dungGoiTin({ ...CO_BAN, body: "x".repeat(5000) });
    expect(goiTin.title).toBe(CO_BAN.title);
  });

  it("chính TIÊU ĐỀ quá dài ⇒ cũng bị cắt, vẫn dưới trần", () => {
    const { chuoi, goiTin } = dungGoiTin({ ...CO_BAN, title: "T".repeat(9000), body: "b" });
    expect(byte(chuoi)).toBeLessThanOrEqual(TRAN_PAYLOAD_BYTE);
    expect(goiTin.title.length).toBeLessThan(9000);
  });

  it("url và tag KHÔNG BAO GIỜ bị cắt — cắt url là bấm vào đi lạc, cắt tag là mất chống trùng", () => {
    const { goiTin } = dungGoiTin({ ...CO_BAN, title: "T".repeat(9000), body: "b".repeat(9000) });
    expect(goiTin.url).toBe("/leads/lead_1");
    expect(goiTin.tag).toBe("lead.moi:lead_1");
  });
});
