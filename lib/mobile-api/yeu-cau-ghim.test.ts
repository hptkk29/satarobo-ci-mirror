import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LƯỚI GHIM MÃ NGUỒN cho «Gửi yêu cầu» của app (B4.8). Mã ca: YCM-W.
 *
 * Test hành vi (`tests/mobile-api/xac-thuc.spec.ts` [YCD-01..09]) chứng minh các luật chạy đúng. Thứ nó KHÔNG canh:
 *  (a) điều phối của app (`dich-vu/yeu-cau.ts`) là BẢN THỨ HAI của `createParentRequest` (web) — hai bản phải giữ cùng trần / cùng hạn mức / cùng cổng, và cùng GỌI các lõi dùng chung;
 *  (b) mọi route di động mới phải đi qua MỘT trong ba cổng (đăng nhập → quy định → sở hữu); thêm route quên cổng là lỗ phân quyền mà test hành vi không thấy.
 * Lý do KHÔNG rút lõi dùng chung ngay: ba lưới của web ghim VĂN BẢN `app/(portal)/portal/yeu-cau/actions.ts` ([PHW-02], [YCL-*], rut-don-nghi-wiring). Nợ kỹ thuật ghi ở đầu `dich-vu/yeu-cau.ts`.
 */
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .map((d) => d.replace(/\s\/\/ .*$/, ""))
    .join("\n");

const WEB = boChuThich(doc("app/(portal)/portal/yeu-cau/actions.ts"));
const APP = boChuThich(doc("lib/mobile-api/dich-vu/yeu-cau.ts"));

describe("[YCM-W] «Gửi yêu cầu» của app ≡ web", () => {
  it("[YCM-W1] cùng trần đơn đang chờ, cùng hạn mức tần suất, CÙNG KHOÁ rate-limit (gửi từ web lẫn app cộng chung một hạn mức)", () => {
    const tran = /const MAX_PENDING_REQUESTS = (\d+);/.exec(WEB)?.[1];
    expect(tran, "web không còn hằng MAX_PENDING_REQUESTS").toBeDefined();
    expect(APP).toContain(`export const TRAN_DON_DANG_CHO = ${tran};`);
    expect(WEB).toContain("key: `parent-request:${ctx.parentUserId}`,");
    expect(WEB).toContain("max: 5,");
    expect(WEB).toContain("windowMs: 10 * 60_000,");
    expect(APP).toContain("key: `parent-request:${parentUserId}`");
    expect(APP).toContain("const GIOI_HAN_GUI = { max: 5, windowMs: 10 * 60_000 } as const;");
    // Trần chỉ đếm đơn CHỜ của chính phụ huynh.
    expect(WEB).toContain('where: { parentUserId: ctx.parentUserId, status: "PENDING" },');
    expect(APP).toContain('where: { parentUserId, status: "PENDING" }');
  });

  it("[YCM-W2] cùng cổng buổi xin nghỉ: buổi SẮP TỚI, chưa huỷ, ghi danh còn sống; cùng tập trạng thái ghi danh", () => {
    for (const s of [WEB, APP]) {
      expect(s).toContain('status: { not: "CANCELLED" },');
      expect(s).toContain('status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] },');
      expect(s).toContain("deletedAt: null");
    }
    expect(WEB).toContain("date: { gte: new Date() },");
    expect(APP).toContain("date: { gte: now },");
  });

  it("[YCM-W3] app GỌI các lõi của web (không chép luật): cổng dòng cần bù, rút đơn đã tiếp nhận, cùng sự kiện cho Sale/QLCS, ghi đơn + sự kiện CÙNG giao dịch", () => {
    for (const s of [WEB, APP]) {
      expect(s).toContain("kiemDongChoYeuCau(pdb,");
      expect(s).toContain("rutDonXinNghiDaTiepNhan({ requestId");
      expect(s).toContain('"parent_request.created"');
      expect(s).toContain("dedupeKey: `parent_request.created:${req.id}`");
    }
    // Sự kiện phải nằm TRONG callback giao dịch, SAU phép tạo đơn.
    const tx = APP.slice(APP.indexOf("portalTx(async (tx) =>"));
    expect(tx.indexOf("tx.parentRequest.create(")).toBeGreaterThan(-1);
    expect(tx.indexOf("publishEvent(")).toBeGreaterThan(tx.indexOf("tx.parentRequest.create("));
    expect(APP).toContain("{ tx, dedupeKey");
  });

  it("[YCM-W4] gửi đơn: mọi từ chối nghiệp vụ đứng TRƯỚC phép ghi đầu tiên (luật rollback — `return` không rollback); khử trùng + rate-limit cũng trước", () => {
    const ham = APP.slice(APP.indexOf("export async function guiYeuCau("), APP.indexOf("type Pdb ="));
    const ghi = ham.indexOf("tx.parentRequest.create(");
    for (const truoc of ["parentRequest.count(", "chuanHoaDon(", "parentRequest.findFirst(", "rateLimit("]) {
      const i = ham.indexOf(truoc);
      expect(i, truoc).toBeGreaterThan(-1);
      expect(i, truoc + " phải trước phép ghi").toBeLessThan(ghi);
    }
  });

  it("[YCM-W5] huỷ: chỉ đơn CỦA CON trong đường dẫn (khác con ⇒ 404), huỷ có điều kiện PENDING nguyên tử", () => {
    const ham = APP.slice(APP.indexOf("export async function huyYeuCau("));
    expect(ham).toContain("req.studentId !== hs");
    expect(ham).toContain('where: { id: requestId, status: "PENDING" }');
    expect(ham).toContain('data: { status: "CANCELLED" }');
  });

  it("[YCM-W6] app KHÔNG nhận câu chữ tự do vào trường chọn sẵn: lý do / chủ đề / khung giờ chỉ là enum lấy từ danh sách của web", () => {
    const s = boChuThich(doc("lib/mobile-api/schema/yeu-cau.ts"));
    for (const ten of ["lyDoBaoNghi", "LY_DO_BAO_LUU", "CHU_DE_KHAC", "KHUNG_GIO_MONG_MUON"]) expect(s, ten).toContain(`${ten} as unknown as [string, ...string[]]`);
  });
});

describe("[YCM-G] cổng của route di động", () => {
  const goc = resolve(process.cwd(), "app/api/mobile/v1");
  const tim = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? tim(join(d, f)) : f === "route.ts" ? [join(d, f)] : []));
  const tepRoute = tim(goc).map((p) => p.replace(goc, "").replace(/\\/g, "/"));

  it("[YCM-G1] mọi route NGOÀI nhóm /auth/{login,refresh,logout} đi qua một trong ba cổng; route theo học viên đi qua cổng sở hữu", () => {
    expect(tepRoute.length).toBeGreaterThan(15);
    for (const r of tepRoute) {
      if (/^\/auth\/(login|refresh|logout)\/route\.ts$/.test(r)) continue;
      // V8.45: bốn route OTP (kích hoạt / đặt lại mật khẩu) là cửa xác thực thứ hai — người dùng chưa có/quên mật khẩu nên KHÔNG có token; danh sách này được khoá cứng ở `[AUT-G1-W2]`.
      if (/^\/auth\/(activation|password-reset)\/(request-otp|confirm)\/route\.ts$/.test(r)) continue;
      const src = boChuThich(readFileSync(join(goc, r), "utf8"));
      const goiCong = /\bchay(TheoHocVien|ChoPhuHuynh|DaDangNhap)(CoThan|TrongThan)?\(/.test(src); // V8.17: thêm họ `…CoThan`/`…TrongThan` (xác thực → rồi mới đọc thân)
      expect(goiCong, `${r} thiếu cổng`).toBe(true);
      // Theo học viên: hoặc qua cổng gộp `chayTheoHocVien`, hoặc tự gọi ĐỦ cặp quy định + sở hữu (route lịch làm vậy vì còn đọc `?month=`).
      if (r.includes("[studentId]")) {
        const congGop = /\bchayTheoHocVien(CoThan|TrongThan)?\(/.test(src);
        const congTay = src.includes("chanNeuCanQuyDinh(") && src.includes("kiemHocVienCuaPhuHuynh(");
        expect(congGop || congTay, `${r} theo học viên mà không qua cổng quy định + sở hữu`).toBe(true);
      }
    }
  });

  it("[YCM-G2] các route B4.8 có mặt (đối chứng dương: lưới không rỗng)", () => {
    for (const r of ["/students/[studentId]/requests/route.ts", "/students/[studentId]/requests/[requestId]/cancel/route.ts", "/parent/profile/route.ts", "/students/[studentId]/promotions/route.ts", "/students/[studentId]/center-feedback/route.ts"]) expect(tepRoute).toContain(r);
  });
});
