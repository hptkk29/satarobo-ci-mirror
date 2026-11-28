import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/rate-limit", async (goc) => {
  const that = await goc<typeof import("@/lib/rate-limit")>();
  return { ...that, rateLimit: () => Promise.resolve({ success: true, remaining: 999, resetAt: Date.now() + 1000 } as Awaited<ReturnType<typeof that.rateLimit>>) };
});
// Phiếu thu PDF: sở hữu + nhóm chứng từ do web kiểm (đã có bộ test riêng); ở đây chỉ đo LỚP BỌC (childIds từ phiên, ánh xạ lỗi, tiêu đề).
const PT = vi.hoisted(() => ({ goi: [] as Array<{ ids: string[]; id: string }>, tra: null as unknown }));
vi.mock("@/lib/portal/phieu-thu-ph", () => ({ taoPdfPhieuThuChoPhuHuynh: async (ids: readonly string[], id: string) => (PT.goi.push({ ids: [...ids], id }), PT.tra) }));
// Kho hoá đơn: KHÔNG gọi R2 thật — bộ ký giả trả URL có dấu vết khoá + TTL; cổng «đã cấu hình» điều khiển được từng ca.
const KHO = vi.hoisted(() => ({ cauHinh: true, ky: [] as Array<{ khoa: string; ttl: number }> }));
vi.mock("@/lib/finance/hoa-don/kho-tep", async (goc) => {
  const that = await goc<typeof import("@/lib/finance/hoa-don/kho-tep")>();
  return {
    ...that,
    khoHoaDonDaCauHinh: () => KHO.cauHinh,
    kyUrlTaiVeHoaDon: async (khoa: string, _ten: string, ttl: number) => (KHO.ky.push({ khoa, ttl }), `https://kho.invalid/tai?exp=${ttl}`),
  };
});
vi.mock("@/lib/portal/hoa-don-phu-huynh-url", () => ({ kyUrlXemPdfHoaDon: async (khoa: string, ttl: number) => (KHO.ky.push({ khoa, ttl }), `https://kho.invalid/xem?exp=${ttl}`) }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { GET as dsGet } from "@/app/api/mobile/v1/parent/invoices/route";
import { GET as pdfTheoLienKetGet } from "@/app/api/dl/phieu-thu/[token]/route";
import { POST as lienKetPhieuThuPost } from "@/app/api/mobile/v1/parent/receipts/[paymentId]/download-link/route";
import { GET as hocPhiGet } from "@/app/api/mobile/v1/students/[studentId]/billing/route";
import { kiemLienKetPhieuThu, taoLienKetPhieuThu } from "@/lib/mobile-api/lien-ket-phieu-thu";
import { GET as phieuThuGet } from "@/app/api/mobile/v1/parent/receipts/[paymentId]/pdf/route";
import { POST as taiPost } from "@/app/api/mobile/v1/parent/invoices/[invoiceId]/download-link/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { POST as codePost } from "@/app/api/mobile/v1/student-mode/code/route";
import { POST as enterPost } from "@/app/api/mobile/v1/student-mode/enter/route";
import { db } from "@/lib/db";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";
import { clearSettingsCache } from "@/lib/settings/service";

/**
 * [HDPH-DB] V8.6 — hoá đơn điện tử phía phụ huynh trên app (chỉ ĐỌC + liên kết tải), Postgres thật:
 *   [HDPH-DB-01] cờ hoá đơn tắt ⇒ 404; bật ⇒ 200; không đăng nhập ⇒ 401
 *   [HDPH-DB-02] danh sách: chỉ hoá đơn ĐÃ XÁC NHẬN của CON MÌNH; NHÁP / giả lập / của nhà khác / đơn không khai người mua ⇒ không hiện; không lộ khoá tệp / URL
 *   [HDPH-DB-03] liên kết tải: của mình ⇒ 200 + URL ký TTL 300 + AuditLog (không chứa khoá/URL); của nhà khác / NHÁP / không tồn tại / id dài / không có XML ⇒ cùng 404
 *   [HDPH-DB-04] kho chưa cấu hình ⇒ 503 KHO_HOA_DON_CHUA_SAN_SANG, KHÔNG ký, KHÔNG audit; tham số lạ ⇒ 400
 *   [HDPH-DB-06] phiếu thu PDF: childIds = con CỦA PHIÊN (không từ client); web trả null ⇒ 404; lỗi tạo ⇒ 503; thành công ⇒ application/pdf no-store; id dài ⇒ 404; chế độ học sinh ⇒ 403
 *   [HDPH-DB-07] V8.10 liên kết phiếu thu: chỉ khoản ĐÃ ĐÓNG + có biên nhận + đơn nhóm «phiếu thu» của CON MÌNH ⇒ 200 + URL tự ký 300s + AuditLog (không chứa token/URL); của nhà khác / nhóm hoá đơn / không biên nhận / không tồn tại ⇒ 404; token sai chữ ký / hết hạn / sửa nội dung ⇒ 404; khoản đổi chủ sau khi cấp ⇒ 404 (kiểm lại lúc tải)
 *   [HDPH-DB-08] V8.10 `coPhieuThu` trong billing.daDong[]: true CHỈ khi tải được (đúng điều kiện của liên kết); `hocVienId`/`tenHocVien` của hoá đơn: đúng con, null khi không suy ra MỘT con
 *   [HDPH-DB-05] chế độ học sinh ⇒ 403 ở cả hai route
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "hdph-";
const MK = "Mat-khau-test-2026";
let dem = 0;
const ip = () => `10.95.0.${(++dem % 250) + 1}`;
const req = (method: string, url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", "x-forwarded-for": ip(), ...(auth ? { authorization: auth } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
type Tra = { ok: boolean; data?: any; error?: { code: string; message: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any
const json = async (r: Response) => (await r.json()) as Tra;
const bearer = (t: string) => `Bearer ${t}`;
const ma = async (r: Response) => [r.status, (await json(r)).error?.code];
const A = (k: string) => `${NS}${k}`;
const MOC = new Date("2026-11-10T03:00:00.000Z"); // sau mốc 01/11/2026 của luật hiển thị

async function don() {
  const us = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = us.map((u) => u.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: uids } }, { entityId: { startsWith: NS } }] } });
  await db.hoaDonKhoan.deleteMany({ where: { hoaDon: { id: { startsWith: NS } } } }).catch(() => undefined);
  await db.receipt.deleteMany({ where: { code: { startsWith: "RCP-HDPH-" } } });
  await db.payment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.hoaDonDienTu.deleteMany({ where: { id: { startsWith: NS } } });
  await db.order.deleteMany({ where: { id: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.authAttemptCounter.deleteMany({});
  await db.user.deleteMany({ where: { id: { in: uids } } });
}
async function batCo(bat: boolean) {
  await db.systemSetting.deleteMany({ where: { key: "billing.hoaDonEnabled" } });
  await db.systemSetting.create({ data: { key: "billing.hoaDonEnabled", valueJson: bat } });
  clearSettingsCache();
}

describe.skipIf(!RUN)("[HDPH-DB] hoá đơn phụ huynh — Postgres thật", () => {
  const ids: Record<string, string> = {};
  let tA = "";
  let tB = "";
  const ds = (tok?: string) => dsGet(req("GET", "/api/mobile/v1/parent/invoices", undefined, tok ? bearer(tok) : undefined));
  const tai = (tok: string, id: string, than: unknown) => taiPost(req("POST", `/api/mobile/v1/parent/invoices/${id}/download-link`, than, bearer(tok)), { params: Promise.resolve({ invoiceId: id }) });

  const donVaHoaDon = async (k: string, studentId: string, o: { khaiNguoiMua?: boolean; trangThai?: string; nguon?: string; xml?: boolean; pdf?: boolean } = {}) => {
    await db.order.create({ data: { id: A(`don-${k}`), code: `HDPH-${k}`, type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0900000000", totalAmount: 1_000_000, studentId, createdAt: MOC, ...(o.khaiNguoiMua === false ? {} : { invoiceBuyerName: "Nguyễn Văn Mua", invoiceEmail: "mua@example.com" }) } as never });
    await db.hoaDonDienTu.create({
      data: {
        id: A(`hd-${k}`), orderId: A(`don-${k}`), centerId: A("cs"), trangThai: (o.trangThai ?? "DA_XAC_NHAN") as never, nguonPhatHanh: (o.nguon ?? "TAI_LEN") as never, kyHieu: "1C26HDPH", soHoaDon: `${k.length}${dem}`.slice(0, 6),
        ngayPhatHanh: new Date("2026-11-10T00:00:00Z"), tongTien: 1_000_000, taoBoiId: ids.KT!, xacNhanBoiId: ids.KT!, xacNhanLuc: MOC,
        ...(o.pdf === false ? {} : { tepPdfKey: `hoa-don/${A(`hd-${k}`)}.pdf`, tepPdfTen: "a.pdf", tepPdfCo: 100, tepPdfSha256: "a".repeat(64) }),
        ...(o.xml ? { tepXmlKey: `hoa-don/${A(`hd-${k}`)}.xml`, tepXmlTen: "a.xml" } : {}),
      } as never,
    });
  };

  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    if ((process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? "").length < 32) process.env.NEXTAUTH_SECRET = "ci-build-only-secret-do-not-use-in-prod-32chars";
    await don();
    const hash = await bcrypt.hash(MK, 4);
    const mk = async (k: string, vai: "PARENT" | "ACCOUNTANT", sdt: string | null) => (ids[k] = (await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `U ${k}`, phone: sdt, password: hash, role: vai, roles: [vai] } as never, select: { id: true } })).id);
    await mk("A", "PARENT", "84966970001");
    await mk("B", "PARENT", "84966970002");
    await mk("KT", "ACCOUNTANT", null);
    await db.center.create({ data: { id: A("cs"), name: "Cơ sở HDPH", slug: A("cs"), address: "Địa chỉ" } });
    await db.student.create({ data: { id: A("sA"), name: "An", parentUserId: ids.A, centerId: A("cs") } as never });
    await db.student.create({ data: { id: A("sB"), name: "Bình", parentUserId: ids.B, centerId: A("cs") } as never });
    await batCo(true);
    await donVaHoaDon("a1", A("sA"), { xml: true });
    await donVaHoaDon("a-nhap", A("sA"), { trangThai: "NHAP" });
    await donVaHoaDon("a-gia", A("sA"), { nguon: "MISA_GIA_LAP" });
    await donVaHoaDon("a-khong-nhu-cau", A("sA"), { khaiNguoiMua: false });
    await donVaHoaDon("b1", A("sB"), {});
    const dn = async (sdt: string, n: number) => {
      const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: sdt, matKhau: MK, thietBi: { maThietBi: `00000000-0000-4000-9e00-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
      return ((await json(r)).data as { accessToken: string }).accessToken;
    };
    tA = await dn("0966970001", 1);
    tB = await dn("0966970002", 2);
  }, 180_000);
  afterAll(async () => {
    await don();
    await db.systemSetting.deleteMany({ where: { key: "billing.hoaDonEnabled" } });
    clearSettingsCache();
  }, 180_000);

  it("[HDPH-DB-01] cờ tắt ⇒ 404; chưa đồng ý chính sách ⇒ 403; đồng ý ⇒ 200; 401", async () => {
    // (cổng Quy định đào tạo chỉ chặn khi có con ĐÃ ĐĂNG KÝ chưa đồng ý — kiểm ở bộ quy định; ở đây học viên chưa ghi danh)
    for (const t of [tA, tB]) await quyDinhDongY(req("POST", "/x", {}, bearer(t)));
    expect((await ds(tA)).status).toBe(200);
    await batCo(false);
    try {
      expect(await ma(await ds(tA))).toEqual([404, "NOT_FOUND"]);
      expect(await ma(await tai(tA, A("hd-a1"), { loai: "pdf" }))).toEqual([404, "NOT_FOUND"]);
    } finally {
      await batCo(true);
    }
    expect((await ds(tA)).status).toBe(200);
    expect(await ma(await ds())).toEqual([401, "UNAUTHENTICATED"]);
  });

  it("[HDPH-DB-02] danh sách đúng người, đúng bản; không lộ khoá tệp", async () => {
    const a = await json(await ds(tA));
    expect(a.data.hienMuc).toBe(true);
    expect(a.data.muc.map((m: { id: string }) => m.id)).toEqual([A("hd-a1")]); // KHÔNG nháp / giả lập / không-nhu-cầu / của B
    const ja = JSON.stringify(a.data);
    expect(ja).not.toMatch(/hoa-don\/|\.pdf|\.xml|kho\.invalid|https?:/);
    expect(ja).not.toContain(A("hd-b1"));
    const b = await json(await ds(tB));
    expect(b.data.muc.map((m: { id: string }) => m.id)).toEqual([A("hd-b1")]);
    expect(a.data.muc[0]).toMatchObject({ tongTien: 1_000_000, coPdf: true, coXml: true });
  });

  it("[HDPH-DB-03] liên kết tải: của mình 200 + audit; còn lại cùng 404", async () => {
    KHO.ky.length = 0;
    const r = await tai(tA, A("hd-a1"), { loai: "pdf", cachMo: "xem" });
    expect(r.status).toBe(200);
    const d = (await json(r)).data;
    expect(d).toMatchObject({ hetHanSauGiay: 300 });
    expect(d.url).toContain("exp=300");
    expect(KHO.ky).toEqual([{ khoa: `hoa-don/${A("hd-a1")}.pdf`, ttl: 300 }]);
    const au = await db.auditLog.findMany({ where: { entityType: "HoaDonDienTu", entityId: A("hd-a1"), action: "PH_TAI_TEP_HOA_DON" } });
    expect(au.length).toBe(1);
    expect(JSON.stringify(au[0])).not.toMatch(/hoa-don\/|kho\.invalid|https?:/); // không chép khoá/URL
    expect((await tai(tA, A("hd-a1"), { loai: "xml" })).status).toBe(200);
    for (const [ten, id, loai] of [["của nhà khác", A("hd-b1"), "pdf"], ["nháp", A("hd-a-nhap"), "pdf"], ["giả lập", A("hd-a-gia"), "pdf"], ["không nhu cầu", A("hd-a-khong-nhu-cau"), "pdf"], ["không tồn tại", "khong-co", "pdf"], ["id dài", "x".repeat(80), "pdf"], ["không có XML", A("hd-b1"), "xml"]] as const) {
      expect(await ma(await tai(tA, id, { loai })), ten).toEqual([404, "NOT_FOUND"]);
    }
    expect(KHO.ky.length).toBe(2); // các lượt bị từ chối KHÔNG ký
    expect(await db.auditLog.count({ where: { entityType: "HoaDonDienTu", action: "PH_TAI_TEP_HOA_DON" } })).toBe(2); // chỉ hai lượt thành công (pdf + xml) — lượt bị từ chối không để lại dấu
  });

  it("[HDPH-DB-04] kho chưa cấu hình ⇒ 503, không ký, không audit; tham số lạ ⇒ 400", async () => {
    const truoc = await db.auditLog.count({ where: { action: "PH_TAI_TEP_HOA_DON" } });
    KHO.cauHinh = false;
    KHO.ky.length = 0;
    try {
      expect(await ma(await tai(tA, A("hd-a1"), { loai: "pdf" }))).toEqual([503, "KHO_HOA_DON_CHUA_SAN_SANG"]);
    } finally {
      KHO.cauHinh = true;
    }
    expect(KHO.ky.length).toBe(0);
    expect(await db.auditLog.count({ where: { action: "PH_TAI_TEP_HOA_DON" } })).toBe(truoc);
    for (const x of [{}, { loai: "exe" }, { loai: "pdf", url: "https://x" }, { loai: "pdf", cachMo: "mo" }]) expect((await tai(tA, A("hd-a1"), x)).status, JSON.stringify(x)).toBe(400);
  });

  it("[HDPH-DB-06] phiếu thu PDF", async () => {
    const pt = (tok: string, id: string) => phieuThuGet(req("GET", `/api/mobile/v1/parent/receipts/${id}/pdf`, undefined, bearer(tok)), { params: Promise.resolve({ paymentId: id }) });
    PT.goi.length = 0;
    PT.tra = { ok: true, pdf: Buffer.from("%PDF-1.4 test"), tenTep: "phieu thu/a b.pdf" };
    const r = await pt(tA, "pay-1");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("content-disposition")).toBe('inline; filename="phieu_thu_a_b.pdf"'); // tên tệp không chứa ký tự lạ
    expect(PT.goi).toEqual([{ ids: [A("sA")], id: "pay-1" }]); // CHỈ con của A, lấy từ DB theo phiên
    PT.tra = null;
    expect(await ma(await pt(tA, "pay-khac"))).toEqual([404, "NOT_FOUND"]);
    PT.tra = { ok: false, status: 404 };
    expect(await ma(await pt(tA, "pay-2"))).toEqual([404, "NOT_FOUND"]);
    PT.tra = { ok: false, status: 500 };
    expect(await ma(await pt(tA, "pay-3"))).toEqual([503, "SERVER"]);
    PT.goi.length = 0;
    expect(await ma(await pt(tA, "x".repeat(80)))).toEqual([404, "NOT_FOUND"]);
    expect(PT.goi.length).toBe(0); // id dài bị chặn trước khi gọi web
    expect((await phieuThuGet(req("GET", "/x"), { params: Promise.resolve({ paymentId: "p" }) })).status).toBe(401);
  });

  it("[HDPH-DB-07] liên kết phiếu thu (tự ký) + đổi token lấy PDF", async () => {
    // fixture: lớp + ghi danh cho con A; hai khoản đã đóng — p1: đơn KHÔNG khai người mua (nhóm phiếu thu) CÓ biên nhận; p2: đơn có khai người mua (nhóm hoá đơn); p3: không có biên nhận
    const enr = await db.enrollment.create({ data: { id: A("dk-pt"), studentId: A("sA"), classId: A("l-pt"), courseId: A("kh-pt"), status: "ACTIVE", centerId: A("cs") } as never }).catch(async () => {
      await db.course.create({ data: { id: A("kh-pt"), name: "Khoá PT", slug: A("kh-pt"), totalSessions: 12 } });
      await db.class.create({ data: { id: A("l-pt"), name: "Lớp PT", classCode: A("l-pt"), courseId: A("kh-pt"), centerId: A("cs"), status: "ACTIVE", isActive: true, startTime: "18:00" } as never });
      return db.enrollment.create({ data: { id: A("dk-pt"), studentId: A("sA"), classId: A("l-pt"), courseId: A("kh-pt"), status: "ACTIVE", centerId: A("cs") } as never });
    });
    const dong = async (k: string, o: { khaiNguoiMua: boolean; bienNhan: boolean }) => {
      await db.order.create({ data: { id: A(`don-${k}`), code: `HDPH-${k}`, type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0900000000", totalAmount: 500_000, studentId: A("sA"), createdAt: new Date(o.khaiNguoiMua ? "2026-11-10T03:00:00.000Z" : "2026-10-01T03:00:00.000Z"), ...(o.khaiNguoiMua ? { invoiceBuyerName: "Nguyễn Văn Mua", invoiceEmail: "mua@example.com" } : {}) } as never });
      const pay = await db.payment.create({ data: { id: A(`pay-${k}`), orderId: A(`don-${k}`), enrollmentId: enr.id, amount: 500_000, method: "CASH", paidDate: new Date("2026-10-02T03:00:00.000Z"), accountantStatus: "CONFIRMED", centerId: A("cs") } as never });
      if (o.bienNhan) await db.receipt.create({ data: { code: `RCP-HDPH-${k}`, enrollmentId: enr.id, paymentId: pay.id, status: "ACTIVE" } });
    };
    await dong("p1", { khaiNguoiMua: false, bienNhan: true });
    await dong("p2", { khaiNguoiMua: true, bienNhan: true });
    await dong("p3", { khaiNguoiMua: false, bienNhan: false });
    await db.order.create({ data: { id: A("don-pB"), code: "HDPH-pB", type: "COURSE", status: "CONFIRMED", customerName: "PH", customerPhone: "0900000001", totalAmount: 1, studentId: A("sB"), createdAt: new Date("2026-10-01T03:00:00.000Z") } as never });
    const lk = (tok: string, id: string, than: unknown = {}) => lienKetPhieuThuPost(req("POST", `/api/mobile/v1/parent/receipts/${id}/download-link`, than, bearer(tok)), { params: Promise.resolve({ paymentId: id }) });
    const doi = (token: string) => pdfTheoLienKetGet(req("GET", `/api/dl/phieu-thu/${token}`), { params: Promise.resolve({ token }) });
    PT.tra = { ok: true, pdf: Buffer.from("%PDF-1.4 lien ket"), tenTep: "phieu-thu.pdf" };
    const r = await lk(tA, A("pay-p1"));
    expect(r.status).toBe(200);
    const d = (await json(r)).data as { url: string; hetHanSauGiay: number };
    expect(d.hetHanSauGiay).toBe(300);
    const token = d.url.split("/api/dl/phieu-thu/")[1]!;
    expect(d.url).toContain("/api/dl/phieu-thu/");
    expect(await db.auditLog.count({ where: { entityType: "Payment", entityId: A("pay-p1"), action: "PH_TAI_PHIEU_THU" } })).toBe(1);
    expect(JSON.stringify(await db.auditLog.findMany({ where: { action: "PH_TAI_PHIEU_THU" } }))).not.toContain(token);
    // đổi token ⇒ PDF
    const pdf = await doi(token);
    expect([pdf.status, pdf.headers.get("content-type"), pdf.headers.get("cache-control")]).toEqual([200, "application/pdf", "private, no-store"]);
    // không đủ điều kiện ⇒ cùng 404: nhóm hoá đơn / không biên nhận / không tồn tại / của nhà khác
    for (const [ten, id] of [["nhóm hoá đơn", A("pay-p2")], ["không biên nhận", A("pay-p3")], ["không tồn tại", "khong-co"], ["id dài", "x".repeat(80)]] as const) expect(await ma(await lk(tA, id)), ten).toEqual([404, "NOT_FOUND"]);
    expect(await ma(await lk(tB, A("pay-p1")))).toEqual([404, "NOT_FOUND"]); // B không phải chủ con A
    expect((await lienKetPhieuThuPost(req("POST", "/x", {}), { params: Promise.resolve({ paymentId: "p" }) })).status).toBe(401);
    expect((await lk(tA, A("pay-p1"), { loai: "x" })).status).toBe(400); // strict
    // token hỏng
    const [payload, chuKy] = token.split(".") as [string, string];
    for (const [ten, x] of [["sai chữ ký", `${payload}.${chuKy.slice(0, -2)}AA`], ["sửa nội dung", `${Buffer.from(JSON.stringify({ u: ids.B, p: A("pay-p1"), e: Date.now() + 100000 })).toString("base64url")}.${chuKy}`], ["rác", "abc"], ["quá dài", "a".repeat(700)]] as const) expect((await doi(x)).status, ten).toBe(404);
    // hết hạn (đóng băng đồng hồ): token cấp ở quá khứ
    const cu = taoLienKetPhieuThu(ids.A!, A("pay-p1"), new Date(Date.now() - 10 * 60_000));
    expect(kiemLienKetPhieuThu(cu.token, new Date())).toMatchObject({ ok: false, ly: "HET_HAN" });
    expect((await doi(cu.token)).status).toBe(404);
    // khoản đổi chủ SAU khi cấp (đơn chuyển sang con B) ⇒ kiểm lại lúc tải ⇒ 404
    await db.payment.update({ where: { id: A("pay-p1") }, data: { enrollmentId: null } });
    expect((await doi(token)).status).toBe(404);
    await db.payment.update({ where: { id: A("pay-p1") }, data: { enrollmentId: A("dk-pt") } });
    expect((await doi(token)).status).toBe(200); // đối chứng dương
  });

  it("[HDPH-DB-08] coPhieuThu + hocVienId/tenHocVien", async () => {
    PT.tra = null;
    const bl = await hocPhiGet(req("GET", `/api/mobile/v1/students/${A("sA")}/billing`, undefined, bearer(tA)), { params: Promise.resolve({ studentId: A("sA") }) });
    expect(bl.status).toBe(200);
    const dd = ((await json(bl)).data as { daDong: Array<{ id: string; coPhieuThu: boolean }> }).daDong;
    const co = (id: string) => dd.find((x) => x.id === id)?.coPhieuThu;
    expect(co(A("pay-p1"))).toBe(true); // nhóm phiếu thu + có biên nhận
    expect(co(A("pay-p2"))).toBe(false); // nhóm hoá đơn ⇒ KHÔNG có phiếu thu (đối chứng ÂM)
    expect(co(A("pay-p3"))).toBe(false); // không biên nhận
    // hoá đơn: đúng con; không suy ra MỘT con ⇒ null
    const dsHd = (await json(await ds(tA))).data.muc as Array<{ id: string; hocVienId: string | null; tenHocVien: string | null }>;
    const a1 = dsHd.find((x) => x.id === A("hd-a1"));
    expect(a1).toMatchObject({ hocVienId: A("sA"), tenHocVien: "An" });
    const dsB = (await json(await ds(tB))).data.muc as Array<{ id: string; hocVienId: string | null }>;
    expect(dsB.find((x) => x.id === A("hd-b1"))).toMatchObject({ hocVienId: A("sB") });
    // hoá đơn có thêm khoản của con NHÀ KHÁC (khoản trộn): chỉ tính con TRONG NHÀ ⇒ vẫn đúng con A (không thành «nhiều con» ⇒ null)
    await db.enrollment.create({ data: { id: A("dk-pt-b"), studentId: A("sB"), classId: A("l-pt"), courseId: A("kh-pt"), status: "ACTIVE", centerId: A("cs") } as never });
    const pB = await db.payment.create({ data: { id: A("pay-pB"), orderId: A("don-pB"), enrollmentId: A("dk-pt-b"), amount: 1, method: "CASH", paidDate: new Date("2026-10-02T03:00:00.000Z"), accountantStatus: "CONFIRMED", centerId: A("cs") } as never });
    await db.hoaDonKhoan.create({ data: { hoaDonId: A("hd-a1"), paymentId: pB.id, soTien: 1 } as never });
    expect(((await json(await ds(tA))).data.muc as Array<{ id: string; hocVienId: string | null }>).find((x) => x.id === A("hd-a1"))?.hocVienId).toBe(A("sA"));
    await db.hoaDonKhoan.deleteMany({ where: { hoaDonId: A("hd-a1"), paymentId: pB.id } });
    // hoá đơn không gắn con nào (đơn không có studentId, không có khoản) ⇒ null
    await db.order.update({ where: { id: A("don-a1") }, data: { studentId: null } });
    expect(((await json(await ds(tA))).data.muc as Array<{ id: string; hocVienId: string | null }>).find((x) => x.id === A("hd-a1"))?.hocVienId ?? "x").not.toBe(A("sA"));
    await db.order.update({ where: { id: A("don-a1") }, data: { studentId: A("sA") } });
  });

  it("[HDPH-DB-05] chế độ học sinh ⇒ 403 ở cả hai route", async () => {
    const r = await dangNhapRoute(req("POST", "/x", { dinhDanh: "0966970001", matKhau: MK, thietBi: { maThietBi: "00000000-0000-4000-9e00-0000000000a9", nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }));
    const hs = ((await json(r)).data as { accessToken: string }).accessToken;
    await quyDinhDongY(req("POST", "/x", {}, bearer(hs)));
    expect((await codePost(req("POST", "/x", { ma: "4827", xacNhan: "4827" }, bearer(hs)))).status).toBe(200);
    expect((await enterPost(req("POST", "/x", { studentId: A("sA") }, bearer(hs)))).status).toBe(200);
    expect(await ma(await ds(hs))).toEqual([403, "FORBIDDEN"]);
    expect(await ma(await tai(hs, A("hd-a1"), { loai: "pdf" }))).toEqual([403, "FORBIDDEN"]);
    expect((await phieuThuGet(req("GET", "/x", undefined, bearer(hs)), { params: Promise.resolve({ paymentId: "p" }) })).status).toBe(403);
  });
});
