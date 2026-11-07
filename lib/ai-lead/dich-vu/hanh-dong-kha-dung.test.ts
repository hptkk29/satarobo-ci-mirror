// lib/ai-lead/dich-vu/hanh-dong-kha-dung.test.ts — bảng nút của màn chi tiết + nút «Mở hội thoại Facebook». Thuần, không DB, không đồng hồ.
import { describe, expect, it } from "vitest";
import { bangNut, type DauVaoNut } from "./hanh-dong-kha-dung";
import { khoiLienKetHoiThoai } from "./lien-ket-inbox";

const MAU = "https://business.facebook.com/latest/inbox/all?thread_id={threadId}";

const goc: DauVaoNut = { state: "READY_FOR_REVIEW", claimedById: null, claimedBoiToi: false, claimedTen: null, coQuyenReview: true, thieu: [], ownerState: "AI_ACTIVE" };
const voi = (o: Partial<DauVaoNut>): DauVaoNut => ({ ...goc, ...o });

describe("[HDK] bangNut — nút nào hiện/sáng/tối", () => {
  it("[HDK-01] hồ sơ đủ điều kiện, chưa ai nhận: nhận · bổ sung · duyệt · từ chối sáng; chuyển/trả ẩn", () => {
    const b = bangNut(goc);
    expect([b.nhanXuLy, b.boSung, b.duyet, b.tuChoi].map((n) => n.bat)).toEqual([true, true, true, true]);
    expect(b.chuyenNguoi.hien).toBe(false);
    expect(b.traHoSo.hien).toBe(false);
    expect(b.baoDaNhan.hien).toBe(false); // hội thoại còn AI giữ
  });

  it("[HDK-02] THIẾU điều kiện: Duyệt TỐI kèm đúng câu «còn thiếu gì»; Bổ sung vẫn sáng", () => {
    const b = bangNut(voi({ thieu: ["fbName", "campus"] }));
    expect(b.duyet).toMatchObject({ hien: true, bat: false });
    expect(b.duyet.lyDoKhoa).toContain("Tên Facebook");
    expect(b.duyet.lyDoKhoa).toContain("cơ sở");
    expect(b.boSung.bat).toBe(true);
  });

  it("[HDK-03] người KHÁC đang giữ: mọi nút ghi TỐI kèm tên người giữ; không có nút nhận/chuyển/trả", () => {
    const b = bangNut(voi({ state: "IN_PROGRESS", claimedById: "u2", claimedTen: "Chị Hoa" }));
    for (const n of [b.boSung, b.duyet, b.tuChoi]) {
      expect(n.bat).toBe(false);
      expect(n.lyDoKhoa).toContain("Chị Hoa");
    }
    expect([b.nhanXuLy.hien, b.chuyenNguoi.hien, b.traHoSo.hien]).toEqual([false, false, false]);
  });

  it("[HDK-04] CHÍNH MÌNH giữ: chuyển + trả hiện và sáng; nhận ẩn", () => {
    const b = bangNut(voi({ state: "IN_PROGRESS", claimedById: "me", claimedBoiToi: true }));
    expect(b.chuyenNguoi).toMatchObject({ hien: true, bat: true });
    expect(b.traHoSo).toMatchObject({ hien: true, bat: true });
    expect(b.nhanXuLy.hien).toBe(false);
    expect(b.duyet.bat).toBe(true);
  });

  it("[HDK-05] chỉ có quyền XEM: MỌI nút ẩn + lời giải thích nêu đúng quyền cần", () => {
    const b = bangNut(voi({ coQuyenReview: false }));
    expect(Object.values(b).filter((v) => typeof v === "object" && v !== null && (v as { hien: boolean }).hien)).toHaveLength(0);
    expect(b.ghiChu).toContain("ai-leads:review");
  });

  it.each(["COMPLETED", "ASSIGNMENT_PENDING", "REJECTED", "EXPIRED"])("[HDK-06] hồ sơ %s: không nút nào, có lời giải thích", (state) => {
    const b = bangNut(voi({ state }));
    expect([b.nhanXuLy, b.boSung, b.duyet, b.tuChoi, b.chuyenNguoi, b.traHoSo, b.baoDaNhan].filter((n) => n.hien)).toHaveLength(0);
    expect(b.ghiChu).toBeTruthy();
  });

  it("[HDK-07] COLLECTING (Agent còn hỏi): chỉ có Từ chối; còn lại ẩn + giải thích", () => {
    const b = bangNut(voi({ state: "COLLECTING" }));
    expect(b.tuChoi).toMatchObject({ hien: true, bat: true });
    expect([b.nhanXuLy, b.boSung, b.duyet].filter((n) => n.hien)).toHaveLength(0);
    expect(b.ghiChu).toContain("thu thập");
  });

  it.each([
    ["AI_ACTIVE", false],
    ["PAUSED", false],
    ["HUMAN_ACTIVE", false],
    ["HANDOFF_REQUESTED", true],
    ["TAKEOVER_PENDING", true],
  ])("[HDK-08] «Báo đã nhận trong Page Inbox» với hội thoại %s ⇒ hiện = %s", (ownerState, hien) => {
    expect(bangNut(voi({ ownerState })).baoDaNhan.hien).toBe(hien);
  });
});

describe("[LKI] khoiLienKetHoiThoai — nút «Mở hội thoại Facebook»", () => {
  it("[LKI-01] có mẫu hợp lệ + mã hội thoại hợp lệ ⇒ LINK, mã đã encode", () => {
    expect(khoiLienKetHoiThoai(MAU, "t_123456")).toEqual({ loai: "LINK", href: "https://business.facebook.com/latest/inbox/all?thread_id=t_123456" });
  });
  it("[LKI-02] mẫu RỖNG (mặc định) ⇒ KHÔNG link, hướng dẫn tìm tay", () => {
    expect(khoiLienKetHoiThoai("", "t_123456")).toEqual({ loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MAU" });
    expect(khoiLienKetHoiThoai("   ", "t_123456")).toEqual({ loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MAU" });
  });
  it("[LKI-03] thiếu mã hội thoại ⇒ KHÔNG link", () => {
    expect(khoiLienKetHoiThoai(MAU, null)).toEqual({ loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MA_HOI_THOAI" });
    expect(khoiLienKetHoiThoai(MAU, "")).toEqual({ loai: "HUONG_DAN_TAY", lyDo: "CHUA_CO_MA_HOI_THOAI" });
  });
  it("[LKI-04] mẫu trỏ host lạ / không https ⇒ KHÔNG link (không bao giờ dựng link ra ngoài Facebook)", () => {
    for (const mau of ["https://evil.test/x?t={threadId}", "http://business.facebook.com/x?t={threadId}", "https://facebook.com.evil.test/{threadId}", "https://{threadId}.facebook.com/"]) {
      expect(khoiLienKetHoiThoai(mau, "t_123456").loai, mau).toBe("HUONG_DAN_TAY");
    }
  });
  it("[LKI-05] mã hội thoại chứa ký tự tấn công ⇒ KHÔNG link", () => {
    for (const ma of ["../../x", "t 1", "t?x=1&y=2", "<script>", "a".repeat(300)]) expect(khoiLienKetHoiThoai(MAU, ma).loai, ma).toBe("HUONG_DAN_TAY");
  });
});
