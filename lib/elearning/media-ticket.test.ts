// @vitest-environment node
/**
 * EL-10 — vé phát media.
 *
 * Case đắt nhất là hai case của nhóm "tách không gian khoá": nếu vé SCORM mở được
 * video đào tạo (hoặc ngược lại) thì cả hai đường vẫn "hoạt động bình thường" và
 * không ai phát hiện — hai hệ có luật cấp vé khác nhau, nên đó là một đường vòng
 * qua luật của hệ kia.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/signing-key", () => ({
  getSigningSecret: () => "secret-test-khong-dung-that",
}));

import { kyVeMedia, kiemVeMedia, khoaThuocBai, revCuaVe, thoiDiemPhatVe, VE_TTL_GIAY } from "@/lib/elearning/media-ticket";
import { signScormTicket } from "@/lib/scorm/ticket";

const NGUOI = { lessonId: "les1", userId: "u1" };

beforeEach(() => vi.useRealTimers());

describe("ký và kiểm", () => {
  it("vé vừa ký thì hợp lệ, và mang đúng bài + đúng người", () => {
    const r = kiemVeMedia(kyVeMedia(NGUOI));
    expect(r.ok).toBe(true);
    expect(r.ve?.lessonId).toBe("les1");
    expect(r.ve?.userId).toBe("u1");
  });

  it("vé HẾT HẠN bị từ chối", () => {
    const t = kyVeMedia(NGUOI, 1);
    expect(kiemVeMedia(t, Date.now() + 2000).ok).toBe(false);
  });

  it("hạn mặc định đủ dài cho một bài 15 phút", () => {
    // Vé ngắn hơn bài học nghĩa là video đứng giữa chừng và người học không hiểu
    // vì sao — họ không biết vé là gì.
    expect(VE_TTL_GIAY).toBeGreaterThanOrEqual(15 * 60);
  });
});

describe("từ chối vé hỏng hoặc bị sửa", () => {
  it("chuỗi rác, rỗng, sai số phần", () => {
    for (const t of ["", "abc", "a.b.c", null, undefined]) {
      expect(kiemVeMedia(t as string).ok, JSON.stringify(t)).toBe(false);
    }
  });

  it("SỬA phần thân mà giữ chữ ký cũ ⇒ từ chối", () => {
    // Đây là cách tấn công hiển nhiên nhất: đổi `lessonId` trong payload để mở
    // bài khác.
    const t = kyVeMedia(NGUOI);
    const [, sig] = t.split(".");
    const than = Buffer.from(
      JSON.stringify({ lessonId: "les-khac", userId: "u1", exp: Date.now() + 60000 }),
    ).toString("base64url");
    expect(kiemVeMedia(`${than}.${sig}`).ok).toBe(false);
  });

  it("thiếu trường bắt buộc ⇒ từ chối", () => {
    // Vé không có `userId` thì mọi kiểm quyền phía sau đều so với `undefined`.
    const than = Buffer.from(
      JSON.stringify({ lessonId: "les1", exp: Date.now() + 60000 }),
    ).toString("base64url");
    expect(kiemVeMedia(`${than}.x`).ok).toBe(false);
  });
});

describe("TÁCH không gian khoá khỏi vé SCORM", () => {
  it("vé SCORM KHÔNG mở được media đào tạo", () => {
    // Dùng chung tiền tố chuỗi ký thì một vé SCORM hợp lệ cũng mở được video đào
    // tạo — và cả hai đường vẫn "hoạt động bình thường", nên không ai phát hiện.
    const veScorm = signScormTicket({ packageId: "p1", sessionId: null, userId: "u1" });
    expect(kiemVeMedia(veScorm).ok).toBe(false);
  });

  it("hai hệ ký cùng nội dung ra hai chữ ký KHÁC nhau", () => {
    const a = kyVeMedia({ lessonId: "x", userId: "u1" });
    const b = signScormTicket({ packageId: "x", sessionId: null, userId: "u1" });
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });
});

describe("khoá tệp phải THUỘC bài của vé", () => {
  it("khoá đúng bài thì cho", () => {
    for (const loai of ["master", "caption", "audio"]) {
      expect(khoaThuocBai(`elearning/${loai}/les1/abc.mp4`, "les1"), loai).toBe(true);
    }
  });

  it("khoá của bài KHÁC bị chặn", () => {
    // Hàng rào cuối: khoá đến từ URL, không kiểm thì ai có vé bài A cũng đọc được
    // tệp bài B chỉ bằng cách đổi đường dẫn.
    expect(khoaThuocBai("elearning/master/les2/abc.mp4", "les1")).toBe(false);
  });

  it("đi lùi thư mục bị chặn dù tiền tố đúng", () => {
    // `elearning/master/les1/../les2/x.mp4` có tiền tố đúng nhưng trỏ sang bài
    // khác — so tiền tố suông là lọt.
    expect(khoaThuocBai("elearning/master/les1/../les2/x.mp4", "les1")).toBe(false);
    expect(khoaThuocBai("elearning/master/les1//x.mp4", "les1")).toBe(false);
  });

  it("khoá ngoài phạm vi module bị chặn", () => {
    for (const k of ["uploads/videos/x.mp4", "scorm/p1/index.html", "elearning/x.mp4"]) {
      expect(khoaThuocBai(k, "les1"), k).toBe(false);
    }
  });

  it("đầu vào rỗng bị chặn", () => {
    expect(khoaThuocBai("", "les1")).toBe(false);
    expect(khoaThuocBai("elearning/master/les1/a.mp4", "")).toBe(false);
  });
});

describe("thoiDiemPhatVe — mốc sớm nhất của việc xem (ngân sách thời gian thật neo vào đây)", () => {
  it("vé mới mang đúng thời điểm phát (đồng hồ server, ký trong vé nên không sửa được)", () => {
    const luc = Date.UTC(2026, 9, 28, 8, 0, 0);
    const r = kiemVeMedia(kyVeMedia(NGUOI, undefined, luc), luc + 1000);
    expect(r.ve?.iat).toBe(luc);
    expect(thoiDiemPhatVe(r.ve!, luc + 1000)).toBe(luc);
  });

  it("sửa `iat` trong thân vé làm hỏng chữ ký — kẻ dùng vé không dời được mốc về quá khứ để có thêm ngân sách", () => {
    const luc = Date.UTC(2026, 9, 28, 8, 0, 0);
    const [body, sig] = kyVeMedia(NGUOI, undefined, luc).split(".");
    const nho = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
    nho.iat = luc - 3_600_000;
    const gia = `${Buffer.from(JSON.stringify(nho)).toString("base64url")}.${sig}`;
    expect(kiemVeMedia(gia, luc + 1000).ok).toBe(false);
  });

  it("vé phát trước bản này (không có `iat`) rơi về `exp − hạn mặc định` — mốc SỚM hơn thật, nên chỉ có thể rộng hơn tới cửa sổ ngân sách", () => {
    const luc = Date.UTC(2026, 9, 28, 8, 0, 0);
    expect(thoiDiemPhatVe({ lessonId: "l", userId: "u", exp: luc + VE_TTL_GIAY * 1000 }, luc + 5000)).toBe(luc);
  });

  it("kẹp trên `now`: vé 'từ tương lai' (lệch đồng hồ giữa hai máy chủ) không biến thành ngân sách âm", () => {
    const luc = Date.UTC(2026, 9, 28, 8, 0, 0);
    expect(thoiDiemPhatVe({ lessonId: "l", userId: "u", exp: luc + 10_000, iat: luc + 4000 }, luc)).toBe(luc);
  });
});

describe("revCuaVe — phiên bản nội dung ghi trong vé", () => {
  it("vé mang `rev` ký trong thân: đọc lại đúng, và sửa `rev` làm hỏng chữ ký (không nâng/hạ phiên bản để lách cổng)", () => {
    const luc = Date.UTC(2026, 9, 28, 8, 0, 0);
    const t = kyVeMedia({ ...NGUOI, rev: 3 }, undefined, luc);
    expect(revCuaVe(kiemVeMedia(t, luc + 1000).ve!)).toBe(3);
    const [body, sig] = t.split(".");
    const nho = JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as Record<string, unknown>;
    nho.rev = 4;
    expect(kiemVeMedia(`${Buffer.from(JSON.stringify(nho)).toString("base64url")}.${sig}`, luc + 1000).ok).toBe(false);
  });

  it("vé kiểu cũ (không `rev`) hoặc `rev` hỏng (âm, 0, số lẻ, chuỗi) = phiên bản 1", () => {
    const co = { lessonId: "l", userId: "u", exp: 1 };
    expect(revCuaVe(co)).toBe(1);
    for (const rev of [0, -2, 1.5, "2" as unknown as number, Number.NaN]) {
      expect(revCuaVe({ ...co, rev }), String(rev)).toBe(1);
    }
    expect(revCuaVe({ ...co, rev: 7 })).toBe(7);
  });
});
