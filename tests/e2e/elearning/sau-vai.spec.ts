/**
 * [SV-*] V9.4 P4 — kiểm toán quyền theo SÁU VAI trên máy chủ chạy thật: trang (menu · route), API xuất/tải dữ liệu, chứng nhận.
 *
 * Vai: Nhân viên (người học) · Đào tạo · Quản lý cơ sở (CS1 và CS2) · Kế toán · Marketing · Quản trị tối cao.
 * KỲ VỌNG KHÔNG GÕ TAY: suy ra từ `ROLE_SEED` (nguồn của bảng vai trên prod) — trang/API đòi quyền nào thì vai có quyền đó phải vào được, vai không có phải bị từ chối.
 * Mỗi hàng ÂM có ĐỐI CHỨNG DƯƠNG: mỗi trang/API có ít nhất một vai vào được, và mỗi vai vào được ít nhất một trang — "bị từ chối" luôn đạt nếu khung hỏng hẳn.
 * KHÔNG sửa ma trận quyền chung: spec chỉ ĐỌC và so với seed; chỗ lệch được ghi vào bằng chứng để Owner quyết.
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { ROLE_SEED } from "../../../prisma/seed-roles";
import { dungSauVai, MOI_NHAN, type BoSauVai, type Nhan } from "./_helpers/sau-vai";
import { capChungNhanThu, dungKhoaBaiTap } from "./_helpers/seed-elearning";
import { db } from "../../../lib/db";
import { tienToKhoaBaiNop } from "../../../lib/elearning/submission-file-rules";

test.describe.configure({ mode: "serial" });

const RA = process.env.XP_OUT ?? "E:/tmp/sau-vai";
const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.ELEARNING_E2E_PORT ?? "3141"}`;

let B: BoSauVai;
let certId = ""; // id (không phải số hiệu) chứng nhận của người học
let nopId = ""; // id lượt nộp (nháp) của người học

/** Vai hệ thống (RoleDef.code) của từng nhãn. */
const VAI_HE_THONG: Record<Nhan, string> = {
  HOC_VIEN: "TEACHER",
  DAO_TAO: "TRAINING",
  QLCS_CS1: "CENTER_MANAGER",
  QLCS_CS2: "CENTER_MANAGER",
  KE_TOAN: "HO_ACCOUNTANT",
  MARKETING: "HO_MARKETING",
  QTTC: "SUPER_ADMIN",
};
function coQuyen(nhan: Nhan, quyen: string): boolean {
  if (VAI_HE_THONG[nhan] === "SUPER_ADMIN") return true; // can() cho SUPER_ADMIN đi thẳng
  const vai = ROLE_SEED.find((r) => r.code === VAI_HE_THONG[nhan]);
  return !!vai && vai.perms.some((p) => p.action === quyen);
}
const coMot = (nhan: Nhan, qs: string[]) => qs.some((q) => coQuyen(nhan, q));

test.beforeAll(async ({ browser }) => {
  test.setTimeout(480_000);
  B = await dungSauVai(browser);
  const soHieu = await capChungNhanThu(B.d.enrollmentId);
  certId = (await db.trnCertificate.findFirstOrThrow({ where: { certCode: soHieu }, select: { id: true } })).id;
  nopId = (await dungKhoaBaiTap(B.d)).submissionNhapId;
  mkdirSync(RA, { recursive: true });
});

function cookieDe(n: Nhan): string {
  return B.hu.get(n)!.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Trang → quyền đòi (đọc từ `page.tsx`); `moi`: vai nào cũng cần MỘT trong các quyền (OR) — chỗ nào mã đòi AND thì lệch sẽ lộ ra ở bảng bằng chứng. */
const TRANG: Array<{ p: string; quyen: string[]; ghiChu?: string }> = [
  { p: "/elearning/dao-tao", quyen: ["elearning:assignment:create", "elearning:content:author", "elearning:exam:grade", "elearning:progress:view-all"] },
  { p: "/elearning/ma-tran", quyen: ["elearning:progress:view-all"] },
  { p: "/elearning/bao-cao-r4", quyen: ["elearning:progress:view-all"] },
  { p: "/elearning/bao-cao-r5", quyen: ["elearning:progress:view-all"] },
  { p: "/elearning/bao-cao-r7", quyen: ["elearning:progress:view-all"] },
  { p: "/elearning/cham-bai", quyen: ["elearning:exam:grade"] },
  { p: "/elearning/cham-bai-tap", quyen: ["elearning:exam:grade"] },
  { p: "/elearning/giao-bai", quyen: ["elearning:assignment:create"] },
  { p: "/elearning/soan-khoa", quyen: ["elearning:content:author"] },
  { p: "/elearning/khung-cham", quyen: ["elearning:content:author", "elearning:content:publish"] },
  { p: "/elearning/kho-cau-hoi", quyen: ["elearning:content:author", "elearning:content:publish"] },
  { p: "/elearning/muc-danh-gia", quyen: ["elearning:program:manage"] },
  { p: "/elearning/tu-dong-hoa", quyen: ["elearning:program:manage", "elearning:progress:view-all"] },
  { p: "/elearning/nguoi-hoc", quyen: ["elearning:progress:view-all", "elearning:progress:view-team"] },
  { p: "/elearning/chung-nhan", quyen: ["elearning:progress:view-all", "elearning:certificate:issue", "elearning:certificate:revoke"] },
];

async function xemTrang(page: Page, nhan: Nhan, duongDan: string) {
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.context().addCookies(B.hu.get(nhan)!);
  const res = await page.goto(duongDan, { waitUntil: "load" });
  const html = await page.content();
  const url = new URL(page.url()).pathname;
  const khungQuanTri = (await page.locator("aside.fixed").count()) > 0;
  const tuChoi = /không có quyền/i.test(html);
  const loiBoQua = res?.status() === 404;
  // "Vào được" = ở lại đúng đường, không bị từ chối, và (trang quản trị) có khung quản trị.
  const vaoDuoc = !loiBoQua && url === duongDan && !tuChoi && khungQuanTri;
  return { status: res?.status() ?? 0, url, khungQuanTri, tuChoi, vaoDuoc };
}

test("[SV-01] TRANG × 7 người: vào được ⇔ có quyền (theo ROLE_SEED); mỗi trang có ≥1 người vào được và mỗi người ≥1 trang", async ({ page }) => {
  test.setTimeout(600_000);
  const bang: Record<string, Record<string, ReturnType<typeof tomTatO>>> = {};
  const lech: string[] = [];
  const tomTatO = (r: Awaited<ReturnType<typeof xemTrang>>) => ({ vao: r.vaoDuoc, status: r.status, url: r.url, khung: r.khungQuanTri, tuChoi: r.tuChoi });
  for (const nhan of MOI_NHAN) {
    bang[nhan] = {};
    for (const t of TRANG) {
      const r = await xemTrang(page, nhan, t.p);
      bang[nhan][t.p] = tomTatO(r);
      const kyVong = coMot(nhan, t.quyen);
      if (r.vaoDuoc !== kyVong) lech.push(`${nhan} ${t.p}: quan sát=${r.vaoDuoc ? "VÀO" : "CHẶN"} · theo seed=${kyVong ? "VÀO" : "CHẶN"}`);
    }
  }
  const doiChungDuong = {
    moiTrangCoNguoiVao: TRANG.every((t) => MOI_NHAN.some((n) => bang[n][t.p].vao)),
    // vai quản trị/đào tạo (Đào tạo · Quản lý cơ sở ×2 · Quản trị tối cao) phải vào được ≥1 trang; Marketing · Kế toán · người học thuần KHÔNG vào được trang nào
    moiNguoiCoTrangVao: (["DAO_TAO", "QLCS_CS1", "QLCS_CS2", "QTTC"] as Nhan[]).every((n) => TRANG.some((t) => bang[n][t.p].vao)),
    nguoiHocKhongTrangNao: (["HOC_VIEN", "MARKETING", "KE_TOAN"] as Nhan[]).every((n) => TRANG.every((t) => !bang[n][t.p].vao)),
  };
  writeFileSync(`${RA}/sv-01-trang.json`, JSON.stringify({ lech, doiChungDuong, bang }, null, 2), "utf8");
  console.log("[SV-01]", JSON.stringify({ lech, doiChungDuong }));
  expect(doiChungDuong.moiTrangCoNguoiVao && doiChungDuong.moiNguoiCoTrangVao, "đối chứng dương: phép đo phải thấy người vào được").toBe(true);
  expect(doiChungDuong.nguoiHocKhongTrangNao, "người học · Marketing · Kế toán không vào được trang quản trị đào tạo nào").toBe(true);
  expect(lech, "trang quan sát lệch ma trận quyền của seed — xem sv-01-trang.json").toEqual([]);
});

/** `thatSu`: dùng id THẬT (đường kiểm tồn tại chạy trước đường kiểm quyền ⇒ id giả luôn ra 404 và không phân biệt được ai). Với id thật, "bị chặn" gồm cả 404 (người ngoài cơ sở không thấy bản ghi). */
const API: Array<{ ten: string; url: () => string; quyen: string[]; chu?: boolean; thatSu?: boolean }> = [
  { ten: "xuất người học", url: () => "/api/elearning/nguoi-hoc", quyen: ["elearning:report:export"] },
  { ten: "xuất báo cáo R1", url: () => "/api/elearning/bao-cao-r1?assignmentId=khong-co", quyen: ["elearning:report:export"] },
  { ten: "mẫu chứng nhận (xem)", url: () => "/api/elearning/chung-nhan/mau-xem", quyen: ["elearning:progress:view-all"] },
  { ten: "tải bài nộp", url: () => `/api/elearning/bai-nop/tai-ve?luot=${encodeURIComponent(nopId)}&khoa=${encodeURIComponent(tienToKhoaBaiNop(nopId) + "bai.pdf")}`, quyen: ["elearning:exam:grade"], chu: true, thatSu: true },
  { ten: "tải chứng nhận của người học", url: () => `/api/elearning/chung-nhan?id=${encodeURIComponent(certId)}`, quyen: ["elearning:progress:view-all"], chu: true, thatSu: true },
];

test("[SV-02] API xuất/tải × 7 người + đối chứng không phiên: 401 khi chưa đăng nhập; 403 khi thiếu quyền; qua cổng khi có quyền", async () => {
  test.setTimeout(300_000);
  const bang: Record<string, Record<string, number>> = {};
  const lech: string[] = [];
  for (const a of API) {
    const khach = await fetch(BASE + a.url(), { redirect: "manual" });
    bang[a.ten] = { KHONG_PHIEN: khach.status };
    for (const nhan of MOI_NHAN) {
      const r = await fetch(BASE + a.url(), { headers: { cookie: cookieDe(nhan) }, redirect: "manual" });
      bang[a.ten][nhan] = r.status;
      const choPhep = coMot(nhan, a.quyen) || (a.chu === true && nhan === "HOC_VIEN");
      const quaCong = r.status !== 401 && r.status !== 403 && !(a.thatSu && r.status === 404);
      if (quaCong !== choPhep) lech.push(`${a.ten} · ${nhan}: HTTP ${r.status} · theo seed=${choPhep ? "QUA CỔNG" : "CHẶN"}`);
    }
  }
  writeFileSync(`${RA}/sv-02-api.json`, JSON.stringify({ lech, bang }, null, 2), "utf8");
  console.log("[SV-02]", JSON.stringify({ lech, bang }));
  for (const a of API) {
    expect(bang[a.ten]["KHONG_PHIEN"], `${a.ten}: khách vãng lai phải bị chặn`).toBeGreaterThanOrEqual(401);
    expect(MOI_NHAN.some((n) => bang[a.ten][n] !== 401 && bang[a.ten][n] !== 403), `đối chứng dương: ${a.ten} phải có ít nhất một vai qua cổng`).toBe(true);
  }
  expect(lech, "API lệch ma trận quyền của seed — xem sv-02-api.json").toEqual([]);
});
