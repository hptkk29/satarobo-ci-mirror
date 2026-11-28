import { describe, expect, it } from "vitest";

import { kiemCheDoHocSinh } from "./che-do-hoc-sinh-thuan";

const HS = "hs-1";
const P = "/api/mobile/v1";
const qua = (method: string, path: string, hocSinhId: string | null = HS) => kiemCheDoHocSinh({ pathname: `${P}${path}`, method, hocSinhId });

describe("H-S3 — chế độ học sinh ép ở máy chủ (luật thuần, mặc định TỪ CHỐI)", () => {
  it("[HSM-01] phiên phụ huynh (hocSinhId null) ⇒ luật không áp dụng, mọi đường đều ok", () => {
    for (const [m, p] of [["GET", "/students/x/billing"], ["POST", "/students/x/requests"], ["GET", "/parent/profile"], ["GET", "/auth/me"]] as const) expect(qua(m, p, null)).toEqual({ ok: true });
  });

  it("[HSM-02] học sinh ĐƯỢC xem phần của CHÍNH MÌNH: lịch · tiến độ · chuyên cần · phiếu học tập · SataCoin · quà · buổi học", () => {
    for (const p of ["schedule", "progress", "attendance", "report-card", "satacoin", "gifts", "sessions/s9", "gift-redemptions"]) expect(qua("GET", `/students/${HS}/${p}`), p).toEqual({ ok: true });
    expect(qua("POST", `/students/${HS}/gift-redemptions`)).toEqual({ ok: true }); // đổi quà: HS gửi yêu cầu, trung tâm duyệt
    expect(qua("POST", `/students/${HS}/gift-redemptions/r1/cancel`)).toEqual({ ok: true });
  });

  it("[HSM-03] học sinh KHÔNG xem tài chính / chat / yêu cầu / khuyến mãi / góp ý / khảo sát / thu nhập thêm / hồ sơ & thông báo của ba mẹ", () => {
    const cam = ["/students/hs-1/billing", "/students/hs-1/requests", "/students/hs-1/requests/r1/cancel", "/students/hs-1/promotions", "/students/hs-1/center-feedback", "/students/hs-1/surveys", "/students/hs-1/overview", "/students/hs-1/feedback", "/students/hs-1/policies/reserve", "/parent/profile", "/parent/income", "/parent/policy", "/parent/policy/accept", "/notifications", "/notifications/read", "/auth/me", "/conversations", "/media/upload-url"];
    for (const p of cam) for (const m of ["GET", "POST"]) expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: expect.stringMatching(/DANG_CHE_DO_HOC_SINH|KHAC_HOC_SINH/) });
  });

  it("[HSM-04] KHÔNG đổi sang anh/chị/em: cùng đường dẫn hợp lệ nhưng studentId khác ⇒ KHAC_HOC_SINH", () => {
    expect(qua("GET", "/students/hs-2/schedule")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("POST", "/students/hs-2/gift-redemptions")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("GET", "/students/HS-1/schedule")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" }); // phân biệt hoa/thường, không chuẩn hoá
  });

  it("[HSM-09] V8: học sinh ĐỌC khu học tập của CHÍNH MÌNH; checkout/đơn hàng của phụ huynh bị chặn (default-deny)", () => {
    expect(qua("GET", `/students/${HS}/learning/areas`)).toEqual({ ok: true });
    expect(qua("GET", "/students/hs-2/learning/areas")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    for (const m of ["POST", "PUT", "DELETE"]) expect(qua(m, `/students/${HS}/learning/areas`), m).toMatchObject({ ok: false });
    expect(qua("GET", `/students/${HS}/learning/areas/x`)).toMatchObject({ ok: false });
    expect(qua("GET", "/parent/orders/o1/payment-status")).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("POST", "/parent/checkout/validate")).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
  });

  it("[HSM-10] V8.1: học sinh KHÔNG đăng ký/xoá token push, KHÔNG đọc/đổi tuỳ chọn thông báo (default-deny)", () => {
    for (const [m, p] of [["POST", "/devices/push-token"], ["DELETE", "/devices/push-token"], ["GET", "/notifications/preferences"], ["PUT", "/notifications/preferences"]] as const) {
      expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    }
  });

  it("[HSM-11] V8.2: học sinh ĐỌC «Tin mới» của CHÍNH MÌNH (students/:id/notifications); feed của ba mẹ + tuỳ chọn vẫn bị chặn; không ghi; không học viên khác", () => {
    expect(qua("GET", `/students/${HS}/notifications`)).toEqual({ ok: true });
    expect(qua("GET", "/students/hs-2/notifications")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("GET", `/students/${HS}/photos`)).toEqual({ ok: true }); // ảnh buổi học của CHÍNH mình (BR-PHOTO-01)
    expect(qua("GET", "/students/hs-2/photos")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("POST", `/students/${HS}/photos`)).toMatchObject({ ok: false });
    expect(qua("GET", `/students/${HS}/personality-robot`)).toEqual({ ok: true }); // Robot tính cách của CHÍNH mình (như cổng học sinh web)
    expect(qua("GET", `/students/${HS}/learning/session-homework`)).toEqual({ ok: true }); // bộ bài tập theo buổi (chỉ đọc)
    expect(qua("GET", "/students/hs-2/learning/session-homework")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("POST", `/students/${HS}/learning/session-homework`)).toMatchObject({ ok: false });
    expect(qua("GET", "/students/hs-2/personality-robot")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("POST", `/students/${HS}/personality-robot`)).toMatchObject({ ok: false });
    for (const m of ["POST", "PUT", "DELETE"]) expect(qua(m, `/students/${HS}/notifications`), m).toMatchObject({ ok: false });
    for (const p of [`/students/${HS}/notifications/read`, `/students/${HS}/notifications/x`]) expect(qua("GET", p), p).toMatchObject({ ok: false });
    for (const p of ["/notifications", "/notifications/read", "/notifications/preferences"]) expect(qua("GET", p), p).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
  });

  it("[HSM-12] V8.5: học sinh KHÔNG truy cập chat (mọi route /chat/** + học sinh khoá không có «tin nhắn»)", () => {
    for (const [m, p] of [["GET", "/chat/conversations"], ["GET", "/chat/conversations/c1/messages"], ["POST", "/chat/conversations/c1/messages"], ["POST", "/chat/conversations/c1/read"], ["DELETE", "/chat/conversations/c1/messages/m1"], ["GET", "/chat/conversations/c1/members"], ["GET", "/chat/unread"], ["GET", "/chat/policy"], ["POST", "/chat/policy/accept"], ["POST", "/chat/dm"], ["GET", "/chat/teachers"], ["GET", "/parent/referral"], ["POST", "/parent/referral/links"], ["POST", "/parent/referral/links/l1/qr"], ["GET", "/parent/invoices"], ["POST", "/parent/invoices/i1/download-link"], ["GET", "/parent/receipts/p1/pdf"]] as const) {
      expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    }
    expect(qua("GET", `/students/${HS}/chat`)).toMatchObject({ ok: false });
  });

  it("[HSM-13] V8.9 Online P0: HỌC SINH được GET đúng 5 đường Online của CHÍNH mình; KHÔNG POST/PUT/DELETE, KHÔNG đường sâu hơn/lạ, KHÔNG học viên khác", () => {
    for (const p of [`/students/${HS}/online/courses`, `/students/${HS}/online/entitlements`, `/students/${HS}/online/certificates`, `/students/${HS}/online/courses/c1`, `/students/${HS}/online/courses/c1/outline`, `/students/${HS}/online/courses/c1/lessons/l1`]) expect(qua("GET", p), p).toEqual({ ok: true });
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const p of [`/students/${HS}/online/courses`, `/students/${HS}/online/entitlements`, `/students/${HS}/online/courses/c1/lessons/l1`]) expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    }
    for (const p of [`/students/${HS}/online`, `/students/${HS}/online/courses/c1/lessons`, `/students/${HS}/online/courses/c1/lessons/l1/extra`, `/students/${HS}/online/courses/c1/progress`, `/students/${HS}/online/orders`]) expect(qua("GET", p), p).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("GET", "/students/anh-chi-em/online/courses")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-14] V8.12 Online ghi/làm bài: HỌC SINH được POST progress/attempts/submit và GET results của CHÍNH mình — đúng phương thức + độ sâu; không DELETE/PUT, không đường lạ, không học viên khác", () => {
    const L = `/students/${HS}/online/courses/c1/lessons/l1`;
    for (const [m, p] of [["POST", `${L}/progress`], ["POST", `${L}/attempts`], ["POST", `${L}/attempts/a1/submit`], ["GET", `${L}/results`]] as const) expect(qua(m, p), `${m} ${p}`).toEqual({ ok: true });
    for (const [m, p] of [["GET", `${L}/progress`], ["PUT", `${L}/progress`], ["DELETE", `${L}/attempts/a1`], ["GET", `${L}/attempts/a1/submit`], ["POST", `${L}/results`], ["POST", `${L}/attempts/a1`], ["POST", `${L}/attempts/a1/submit/x`], ["POST", `${L}/media`], ["POST", `${L}/attempts/a1/grade`]] as const) expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("POST", "/students/anh-chi-em/online/courses/c1/lessons/l1/progress")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-14b] V8.24 Online nháp/trạng thái lượt: HỌC SINH được GET/PUT draft và GET status của CHÍNH mình — đúng phương thức + độ sâu; không POST/DELETE, không đường lạ, không học viên khác", () => {
    const A = `/students/${HS}/online/courses/c1/lessons/l1/attempts/a1`;
    for (const [m, p] of [["GET", `${A}/draft`], ["PUT", `${A}/draft`], ["GET", `${A}/status`]] as const) expect(qua(m, p), `${m} ${p}`).toEqual({ ok: true });
    for (const [m, p] of [["POST", `${A}/draft`], ["DELETE", `${A}/draft`], ["PATCH", `${A}/draft`], ["PUT", `${A}/status`], ["POST", `${A}/status`], ["GET", `${A}/draft/x`], ["GET", `${A}/lich-su`], ["PUT", `${A}`], ["GET", `/students/${HS}/online/courses/c1/lessons/l1/attempts/draft`]] as const) expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("PUT", "/students/anh-chi-em/online/courses/c1/lessons/l1/attempts/a1/draft")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-15] V8.45 liên hệ cho học sinh: HS được GET /students/:id/contact của CHÍNH mình; KHÔNG POST/PUT/DELETE, không đường con, không em khác; /overview VẪN bị chặn", () => {
    expect(qua("GET", `/students/${HS}/contact`)).toEqual({ ok: true });
    for (const [m, p] of [["POST", `/students/${HS}/contact`], ["PUT", `/students/${HS}/contact`], ["DELETE", `/students/${HS}/contact`], ["GET", `/students/${HS}/contact/x`], ["GET", `/students/${HS}/contacts`], ["GET", `/students/${HS}/overview`], ["POST", `/students/${HS}/overview`]] as const) {
      expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false });
    }
    expect(qua("GET", "/students/anh-chi-em/contact")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("GET", `/students/${HS}/contact`, null)).toEqual({ ok: true }); // phiên phụ huynh: luật không áp dụng
  });

  it("[HSM-14d] V8.45 Online nộp sản phẩm (PRODUCT): HỌC SINH được POST upload-ticket/submit của CHÍNH mình — đúng phương thức + độ sâu; không GET/PUT/DELETE, không đường lạ, không học viên khác", () => {
    const A = `/students/${HS}/online/courses/c1/lessons/l1/attempts/a1/product`;
    for (const p of [`${A}/upload-ticket`, `${A}/submit`]) expect(qua("POST", p), `POST ${p}`).toEqual({ ok: true });
    for (const [m, p] of [["GET", `${A}/upload-ticket`], ["PUT", `${A}/submit`], ["DELETE", `${A}/submit`], ["POST", `${A}/upload`], ["POST", `${A}/submit/x`], ["POST", `${A}`], ["POST", `/students/${HS}/online/courses/c1/lessons/l1/product/submit`], ["POST", `/students/${HS}/online/courses/c1/lessons/l1/attempts/a1/products/submit`]] as const) {
      expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false });
    }
    expect(qua("POST", "/students/anh-chi-em/online/courses/c1/lessons/l1/attempts/a1/product/submit")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-14c] V8.44 Online video: HỌC SINH được POST video-ticket của CHÍNH mình — đúng phương thức + độ sâu; không GET/PUT/DELETE, không đường lạ, không học viên khác", () => {
    const L = `/students/${HS}/online/courses/c1/lessons/l1`;
    expect(qua("POST", `${L}/video-ticket`)).toEqual({ ok: true });
    for (const [m, p] of [["GET", `${L}/video-ticket`], ["PUT", `${L}/video-ticket`], ["DELETE", `${L}/video-ticket`], ["POST", `${L}/video-ticket/x`], ["POST", `${L}/video-tickets`], ["POST", `/students/${HS}/online/courses/c1/video-ticket`]] as const) expect(qua(m, p), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("POST", "/students/anh-chi-em/online/courses/c1/lessons/l1/video-ticket")).toMatchObject({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-05] sai phương thức ⇒ chặn: không POST/PUT/DELETE vào mục chỉ-đọc; không DELETE yêu cầu đổi quà", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) expect(qua(m, `/students/${HS}/schedule`), m).toMatchObject({ ok: false });
    expect(qua("DELETE", `/students/${HS}/gift-redemptions/r1`)).toMatchObject({ ok: false });
    expect(qua("GET", `/students/${HS}/gift-redemptions/r1/cancel`)).toMatchObject({ ok: false });
  });

  it("[HSM-08] LMS (B-LMS1): học sinh ĐỌC bài tập/bài thi/bài học/kết quả của CHÍNH MÌNH; KHÔNG ghi (POST/PUT), KHÔNG mục lạ, KHÔNG sai độ sâu, KHÔNG học viên khác", () => {
    for (const p of ["learning/assignments", "learning/assignments/a1", "learning/exams", "learning/exams/e1", "learning/lessons", "learning/lessons/l1", "learning/results"]) expect(qua("GET", `/students/${HS}/${p}`), p).toEqual({ ok: true });
    for (const p of ["learning", "learning/results/x", "learning/assignments/a1/submissions", "learning/uploads", "learning/attempts", "learning/attempts/t1/answers", "learning/attempts/t1/submit"]) expect(qua("GET", `/students/${HS}/${p}`), p).toMatchObject({ ok: false });
    // B-LMS3: học sinh làm bài thi của CHÍNH mình (bắt đầu/lịch sử · khôi phục · kết quả · lưu · nộp)
    for (const [m, p] of [["POST", "learning/exams/e1/attempts"], ["GET", "learning/exams/e1/attempts"], ["GET", "learning/attempts/t1"], ["GET", "learning/attempts/t1/result"], ["POST", "learning/attempts/t1/answers"], ["POST", "learning/attempts/t1/submit"]] as const) expect(qua(m, `/students/${HS}/${p}`), `${m} ${p}`).toEqual({ ok: true });
    for (const [m, p] of [["PUT", "learning/attempts/t1/answers"], ["GET", "learning/attempts/t1/submit"], ["POST", "learning/attempts/t1/result"], ["POST", "learning/attempts/t1"], ["DELETE", "learning/attempts/t1"], ["POST", "learning/attempts/t1/answers/x"], ["PUT", "learning/exams/e1/attempts"]] as const) expect(qua(m, `/students/${HS}/${p}`), `${m} ${p}`).toMatchObject({ ok: false });
    expect(qua("POST", "/students/hs-2/learning/exams/e1/attempts")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("POST", `/students/${HS}/learning/assignments/a1/submissions`)).toEqual({ ok: true }); // B-LMS2: học sinh nộp bài tập của chính mình
    expect(qua("POST", "/students/hs-2/learning/assignments/a1/submissions")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    for (const p of ["learning/assignments/a1/submissions/x", "learning/assignments/submissions", "learning/exams/e1/submissions"]) expect(qua("POST", `/students/${HS}/${p}`), p).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    for (const m of ["GET", "PUT", "DELETE"]) expect(qua(m, `/students/${HS}/learning/assignments/a1/submissions`), m).toMatchObject({ ok: false });
    for (const [m, p] of [["POST", "learning/assignments"], ["DELETE", "learning/assignments/a1"], ["POST", "learning/lessons"], ["POST", "learning/results"]] as const) expect(qua(m, `/students/${HS}/${p}`), `${m} ${p}`).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("GET", "/students/hs-2/learning/assignments")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
    expect(qua("GET", "/students/hs-2/learning/results")).toEqual({ ok: false, ma: "KHAC_HOC_SINH" });
  });

  it("[HSM-06] cửa thoát: chỉ GET trạng thái + POST exit/forgot + POST logout; KHÔNG có enter/code (không đổi chế độ từ trong chế độ học sinh)", () => {
    expect(qua("GET", "/student-mode")).toEqual({ ok: true });
    expect(qua("POST", "/student-mode/exit")).toEqual({ ok: true });
    expect(qua("POST", "/student-mode/forgot")).toEqual({ ok: true });
    expect(qua("POST", "/auth/logout")).toEqual({ ok: true });
    for (const p of ["/student-mode/enter", "/student-mode/code"]) expect(qua("POST", p), p).toMatchObject({ ok: false, ma: "DANG_CHE_DO_HOC_SINH" });
    expect(qua("GET", "/student-mode/exit")).toMatchObject({ ok: false });
  });

  it("[HSM-07] chống lách đường dẫn: dấu / cuối, đường dẫn lạ, đoạn thừa, tiền tố khác ⇒ không qua", () => {
    expect(qua("GET", `/students/${HS}/schedule/`)).toEqual({ ok: true }); // dấu / cuối chuẩn hoá
    expect(qua("GET", `/students/${HS}/schedule/extra`)).toMatchObject({ ok: false });
    expect(qua("GET", `/students/${HS}/billing/../schedule`)).toMatchObject({ ok: false });
    expect(qua("GET", `/students/${HS}`)).toMatchObject({ ok: false });
    expect(qua("GET", "/students")).toMatchObject({ ok: false });
    expect(kiemCheDoHocSinh({ pathname: "/anything/else", method: "GET", hocSinhId: HS })).toMatchObject({ ok: false });
  });
});
