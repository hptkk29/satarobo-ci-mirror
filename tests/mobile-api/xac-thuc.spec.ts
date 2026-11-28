import bcrypt from "bcryptjs";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Nền web của các hàm đọc (`lib/portal/*`) kéo `@/lib/auth` (next-auth). API di động KHÔNG dùng phiên web, nên chặn nó ở đây: nếu có đường nào
// gọi `auth()` thật, ca sẽ đỏ vì `auth` trả undefined — đó là bằng chứng token mobile không thay được cookie web.
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

import { GET as me } from "@/app/api/mobile/v1/auth/me/route";
import { GET as quyDinhGet } from "@/app/api/mobile/v1/parent/policy/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as lichGet } from "@/app/api/mobile/v1/students/[studentId]/schedule/route";
import { GET as tongQuanGet } from "@/app/api/mobile/v1/students/[studentId]/overview/route";
import { GET as tienDoGet } from "@/app/api/mobile/v1/students/[studentId]/progress/route";
import { GET as thongBaoGet } from "@/app/api/mobile/v1/notifications/route";
import { GET as nhanXetGet } from "@/app/api/mobile/v1/students/[studentId]/feedback/route";
import { GET as hocBaGet } from "@/app/api/mobile/v1/students/[studentId]/report-card/route";
import { GET as chuyenCanGet } from "@/app/api/mobile/v1/students/[studentId]/attendance/route";
import { GET as chiTietBuoiGet } from "@/app/api/mobile/v1/students/[studentId]/sessions/[sessionId]/route";
import { GET as hocPhiGet } from "@/app/api/mobile/v1/students/[studentId]/billing/route";
import { GET as sataCoinGet } from "@/app/api/mobile/v1/students/[studentId]/satacoin/route";
import { getBalance } from "@/lib/satacoin/service";
import { getStudentBilling } from "@/lib/portal/billing-student";
import { kiemTruocDangNhap } from "@/lib/security/gioi-han-dang-nhap/cong";
import { POST as thongBaoDoc } from "@/app/api/mobile/v1/notifications/read/route";
import { GET as yeuCauGet, POST as yeuCauPost } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { POST as yeuCauHuy } from "@/app/api/mobile/v1/students/[studentId]/requests/[requestId]/cancel/route";
import { GET as hoSoGet } from "@/app/api/mobile/v1/parent/profile/route";
import { GET as khuyenMaiGet } from "@/app/api/mobile/v1/students/[studentId]/promotions/route";
import { GET as gopYGet, POST as gopYPost } from "@/app/api/mobile/v1/students/[studentId]/center-feedback/route";
import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as dangXuatRoute } from "@/app/api/mobile/v1/auth/logout/route";
import { POST as lamMoiRoute } from "@/app/api/mobile/v1/auth/refresh/route";
import { db } from "@/lib/db";
import {
  laDbCucBo,
  laTenDbLaDbTest,
  tenDbCuaUrl,
} from "@/lib/security/url-db-cuc-bo";

/**
 * Xác thực di động trên POSTGRES THẬT (bảng MobileSession / AuthAttemptCounter). Mã ca: MA.
 * Gọi thẳng các route handler bằng `Request` thật: phủ cờ, lược đồ, cổng, dịch vụ, DB.
 *
 * Cổng DB: chỉ chạy khi DATABASE_URL trỏ máy cục bộ VÀ tên cơ sở dữ liệu nằm trong danh sách cho phép; không `resetDb` — mọi dữ liệu
 * tạo ra mang tiền tố `mobiletest-` và được dọn ở `afterAll`. KHÔNG BAO GIỜ chạy với cơ sở dữ liệu test dùng chung / production.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
// Nhận diện máy cục bộ CHỈ qua lib/security/url-db-cuc-bo.ts (lưới [UDB-LUOI-02]): nó tự loại SSH tunnel tới DB test / prod trên VPS (các cổng tunnel đó).
const CHO_PHEP =
  laDbCucBo(URL_DB) &&
  TEN_DB !== null &&
  (TEN_DB === "mobile_b1_nhap" ||
    TEN_DB === "satarobo_vitest" ||
    laTenDbLaDbTest(TEN_DB));
const RUN = CHO_PHEP;

const MAT_KHAU = "Mat-khau-test-2026";
const NS = "mobiletest-";
const THIET_BI = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let dem = 0;
const ipMoi = () => `10.77.${Math.floor(++dem / 250)}.${(dem % 250) + 1}`;

function req(
  url: string,
  body?: unknown,
  opts: { ip?: string; auth?: string; method?: string } = {},
): Request {
  return new Request(`http://localhost${url}`, {
    method: opts.method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": opts.ip ?? ipMoi(),
      ...(opts.auth ? { authorization: opts.auth } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async (r: Response) =>
  (await r.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };

const THU = {
  A: { phone: "0966100001", sdt84: "84966100001" },
  B: { phone: "0966100002" },
  NV: { phone: "0966100003" },
  KHOA: { phone: "0966100004" },
  CHUA: { phone: "0966100005" },
  TRONG: { phone: "0966100006" },
};
const ids: Record<string, string> = {};

async function dangNhap(phone: string, n = 1, ip?: string, matKhau = MAT_KHAU) {
  return dangNhapRoute(
    req(
      "/api/mobile/v1/auth/login",
      {
        dinhDanh: phone,
        matKhau,
        thietBi: {
          maThietBi: THIET_BI(n),
          nenTang: "ios",
          tenMay: "iPhone15,2",
          phienBanApp: "1.0.0",
        },
      },
      { ip },
    ),
  );
}
async function layCap(phone: string, n = 1) {
  const r = await dangNhap(phone, n);
  const b = await json(r);
  if (r.status !== 200)
    throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return b.data as {
    accessToken: string;
    refreshToken: string;
    hetHanSau: number;
  };
}
const bearer = (t: string) => `Bearer ${t}`;
const sessionCuaUser = (userId: string) =>
  db.mobileSession.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

async function xoaTatCa() {
  const users = await db.user.findMany({
    where: { email: { startsWith: NS } },
    select: { id: true },
  });
  const uids = users.map((u) => u.id);
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.auditLog.deleteMany({
    where: { module: "mobile-auth", actorId: { in: [...uids] } },
  });
  await db.auditLog.deleteMany({
    where: { module: "mobile-auth", entityId: "rate-limit" },
  });
  await db.portalFeedRead.deleteMany({ where: { userId: { in: uids } } });
  await db.studentSessionFeedback.deleteMany({
    where: { studentId: { startsWith: NS } },
  });
  await db.parentFeedback.deleteMany({ where: { parentUserId: { in: uids } } });
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.attendance.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.classSession.deleteMany({ where: { id: { startsWith: NS } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { name: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

/**
 * V8.29 — ĐỒNG HỒ CỐ ĐỊNH. Fixture lịch (`gio(n)`) và mọi hàm máy chủ đọc `new Date()` cùng chạy ở MỘT thời điểm tuyệt đối: thứ Tư 18/11/2026 12:00 giờ VN
 * (05:00Z). Trước đó fixture dùng `Date.now()` + `setHours(20)` (giờ MÁY) nên «hôm nay 20:00» lúc thì ở tương lai lúc thì ở quá khứ và «tuần này» đổi theo thứ trong tuần
 * ⇒ [MA-25]/[B4-07] đỏ theo giờ chạy (đo 22/11: Chủ nhật 09:35). Chỉ giả `Date` (không giả setTimeout) để I/O và bcrypt không bị ảnh hưởng.
 */
const DONG_HO_CO_DINH = new Date("2026-11-18T05:00:00.000Z");
/** 20:00 giờ VN (13:00Z) của ngày `18/11/2026 + ngay` — KHÔNG phụ thuộc múi giờ máy. */
const gio20VN = (ngay: number) => new Date(Date.UTC(2026, 10, 18, 13, 0, 0) + ngay * 86_400_000);

describe.skipIf(!RUN)("xác thực di động — Postgres thật", () => {
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DONG_HO_CO_DINH);
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await xoaTatCa();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    const tao = async (
      khoa: keyof typeof THU,
      data: Record<string, unknown>,
    ) => {
      const u = await db.user.create({
        data: {
          email: `${NS}${khoa}@seed.invalid`,
          name: `${NS}${khoa}`,
          phone: `84${THU[khoa].phone.slice(1)}`,
          password: hash,
          ...data,
        } as never,
        select: { id: true },
      });
      ids[khoa] = u.id;
    };
    await tao("A", { role: "PARENT", roles: ["PARENT"] });
    await tao("B", { role: "PARENT", roles: ["PARENT"] });
    await tao("NV", { role: "TEACHER", roles: ["TEACHER"] });
    await tao("KHOA", { role: "PARENT", roles: ["PARENT"], isActive: false });
    await tao("CHUA", {
      role: "PARENT",
      roles: ["PARENT"],
      accountStatus: "PENDING_ACTIVATION",
    });
    await tao("TRONG", { role: "PARENT", roles: ["PARENT"] });
    await db.student.createMany({
      data: [
        { id: `${NS}hs-a1`, name: `${NS}An A1`, parentUserId: ids.A },
        { id: `${NS}hs-a2`, name: `${NS}An A2`, parentUserId: ids.A },
        { id: `${NS}hs-b1`, name: `${NS}Binh B1`, parentUserId: ids.B },
      ] as never,
    });
    // Lớp học thật cho lịch học: A1 và B1 ghi danh; A2 KHÔNG ghi danh (empty state). Buổi: 1 đã qua, 1 sắp tới, 1 sắp tới bị huỷ.
    await db.center.create({
      data: {
        id: `${NS}cs`,
        name: "Cơ sở TEST",
        slug: `${NS}cs`,
        address: "Địa chỉ giả",
      },
    });
    await db.course.create({
      data: {
        id: `${NS}kh`,
        name: "Sata 3 TEST",
        slug: `${NS}kh`,
        totalSessions: 12,
      },
    });
    await db.class.create({
      data: {
        id: `${NS}lop`,
        name: "Lớp TEST",
        classCode: "MTEST.LOP",
        courseId: `${NS}kh`,
        centerId: `${NS}cs`,
        status: "ACTIVE",
        isActive: true,
        startTime: "20:00",
        endTime: "21:00",
      },
    });
    for (const hs of ["a1", "b1"])
      await db.enrollment.create({
        data: {
          id: `${NS}dk-${hs}`,
          studentId: `${NS}hs-${hs}`,
          classId: `${NS}lop`,
          courseId: `${NS}kh`,
          status: "ACTIVE",
          centerId: `${NS}cs`,
        },
      });
    const gio = gio20VN;
    // (điểm danh + nhận xét tạo sau khi có buổi — xem ngay dưới)
    await db.classSession.createMany({
      data: [
        {
          id: `${NS}b1`,
          classId: `${NS}lop`,
          date: gio(-7),
          status: "COMPLETED",
          topic: "Buổi đã học",
          centerId: `${NS}cs`,
        },
        {
          id: `${NS}b2`,
          classId: `${NS}lop`,
          date: gio(3),
          status: "SCHEDULED",
          topic: "Buổi sắp tới",
          centerId: `${NS}cs`,
        },
        {
          id: `${NS}b3`,
          classId: `${NS}lop`,
          date: gio(0),
          status: "CANCELLED",
          topic: "Buổi huỷ",
          centerId: `${NS}cs`,
        },
      ] as never,
    });
    await db.attendance.create({
      data: {
        id: `${NS}dd-a1`,
        sessionId: `${NS}b1`,
        studentId: `${NS}hs-a1`,
        status: "PRESENT",
        centerId: `${NS}cs`,
      },
    });
    await db.attendance.create({
      data: {
        id: `${NS}dd-b1`,
        sessionId: `${NS}b1`,
        studentId: `${NS}hs-b1`,
        status: "ABSENT_UNEXCUSED",
        centerId: `${NS}cs`,
      },
    });
    await db.studentSessionFeedback.create({
      data: {
        id: `${NS}nx-a1`,
        classSessionId: `${NS}b1`,
        studentId: `${NS}hs-a1`,
        comment: "Con làm việc nhóm rất tốt (nhận xét TEST của A1)",
        rating: 5,
        createdById: ids.NV,
      },
    });
    await db.studentSessionFeedback.create({
      data: {
        id: `${NS}nx-b1`,
        classSessionId: `${NS}b1`,
        studentId: `${NS}hs-b1`,
        comment: "Nhận xét TEST riêng của B1",
        rating: 4,
        createdById: ids.NV,
      },
    });
  }, 60_000);

  // Mỗi ca bắt đầu với bộ đếm trống: ngưỡng 5 lần/phút theo định danh sẽ chạm vì nhiều ca đăng nhập cùng một số điện thoại. Ca [MA-18..21] kiểm bộ đếm tự dọn.
  beforeEach(async () => {
    await db.authAttemptCounter.deleteMany({});
  });

  afterAll(async () => {
    await xoaTatCa();
    delete process.env.MOBILE_API_ENABLED;
    vi.useRealTimers();
  });

  it("[MA-01] cờ MOBILE_API_ENABLED tắt ⇒ cả bốn endpoint trả 404, không đụng DB", async () => {
    delete process.env.MOBILE_API_ENABLED;
    try {
      const truoc = await db.mobileSession.count();
      const bodyDn = {
        dinhDanh: THU.A.phone,
        matKhau: MAT_KHAU,
        thietBi: { maThietBi: THIET_BI(1), nenTang: "ios" },
      };
      for (const r of [
        await dangNhapRoute(req("/x", bodyDn)),
        await lamMoiRoute(req("/x", { refreshToken: "x" })),
        await dangXuatRoute(req("/x", { refreshToken: "x" })),
        await me(req("/x")),
      ]) {
        expect(r.status).toBe(404);
        expect((await json(r)).error?.code).toBe("NOT_FOUND");
      }
      expect(await db.mobileSession.count()).toBe(truoc);
    } finally {
      process.env.MOBILE_API_ENABLED = "true";
    }
  });

  it("[MA-02] đăng nhập đúng ⇒ 200, token đúng dạng, hetHanSau = 900; DB chỉ giữ BĂM (không có bản rõ của token ở đâu)", async () => {
    const r = await dangNhap(THU.A.phone, 11);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const d = (await json(r)).data as {
      accessToken: string;
      refreshToken: string;
      hetHanSau: number;
    };
    expect(d.accessToken).toMatch(/^sma_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(d.refreshToken).toMatch(
      /^smr_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(d.hetHanSau).toBe(900);
    const [p] = (await sessionCuaUser(ids.A)).filter(
      (s) => s.maThietBi === THIET_BI(11),
    );
    expect(p.accessHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.refreshHash).toMatch(/^[0-9a-f]{64}$/);
    const dong = JSON.stringify(p);
    expect(dong).not.toContain(d.accessToken.split(".")[1]);
    expect(dong).not.toContain(d.refreshToken.split(".")[1]);
    expect(p.xacNhanLuc).toBeNull();
    expect(p.tokenVersionLucCap).toBe(0);
  });

  it("[MA-03] mọi ca thất bại trả CÙNG một 401 INVALID_CREDENTIALS (sai mật khẩu · không có tài khoản · nhân viên · bị khoá · chưa kích hoạt)", async () => {
    const ca = [
      await dangNhap(THU.A.phone, 1, undefined, "Sai-mat-khau-1"),
      await dangNhap("0966199999"),
      await dangNhap(THU.NV.phone),
      await dangNhap(THU.KHOA.phone),
      await dangNhap(THU.CHUA.phone),
    ];
    const thans = await Promise.all(ca.map(json));
    for (const r of ca) expect(r.status).toBe(401);
    expect(
      new Set(thans.map((b) => `${b.error?.code}|${b.error?.message}`)).size,
    ).toBe(1);
    expect(thans[0].error?.code).toBe("INVALID_CREDENTIALS");
    // tài khoản nhân viên bị từ chối KHÔNG được ghi lastLoginAt
    const nv = await db.user.findUnique({
      where: { id: ids.NV },
      select: { lastLoginAt: true },
    });
    expect(nv?.lastLoginAt).toBeNull();
    expect((await sessionCuaUser(ids.NV)).length).toBe(0);
  });

  it("[MA-04] sai lược đồ ⇒ 400 VALIDATION; mã thiết bị viết hoa được hạ về chữ thường", async () => {
    const thieu = await dangNhapRoute(
      req("/x", { dinhDanh: THU.A.phone, matKhau: MAT_KHAU }),
    );
    expect(thieu.status).toBe(400);
    expect((await json(thieu)).error?.code).toBe("VALIDATION");
    const xau = await dangNhapRoute(
      req("/x", {
        dinhDanh: THU.A.phone,
        matKhau: MAT_KHAU,
        thietBi: { maThietBi: "khong-phai-uuid", nenTang: "ios" },
      }),
    );
    expect(xau.status).toBe(400);
    const khongPhaiJson = await dangNhapRoute(
      new Request("http://localhost/x", {
        method: "POST",
        body: "{{",
        headers: { "x-forwarded-for": ipMoi() },
      }),
    );
    expect(khongPhaiJson.status).toBe(400);
    const hoa = await dangNhapRoute(
      req("/x", {
        dinhDanh: THU.TRONG.phone,
        matKhau: MAT_KHAU,
        thietBi: { maThietBi: THIET_BI(41).toUpperCase(), nenTang: "android" },
      }),
    );
    expect(hoa.status).toBe(200);
    expect((await sessionCuaUser(ids.TRONG))[0].maThietBi).toBe(THIET_BI(41));
  });

  it("[MA-05] /auth/me: phụ huynh A chỉ thấy HAI con của mình; B chỉ thấy con của B; không lộ trường nội bộ", async () => {
    const a = await layCap(THU.A.phone, 21);
    const ra = await me(req("/x", undefined, { auth: bearer(a.accessToken) }));
    expect(ra.status).toBe(200);
    const da = (await json(ra)).data as {
      name: string;
      children: Array<{ id: string; name: string }>;
      quyDinh: unknown;
    };
    expect(da.children.map((c) => c.name).sort()).toEqual([
      `${NS}An A1`,
      `${NS}An A2`,
    ]);
    expect(da.quyDinh).toEqual({ ap: true, daDongY: false }); // A1 đã ghi danh lớp ⇒ phải đồng ý quy định
    const tho = JSON.stringify(da);
    for (const cam of [
      "debt",
      "familyCode",
      "parent2",
      "tokenVersion",
      "grants",
      "centerId",
      "password",
    ])
      expect(tho).not.toContain(cam);

    const b = await layCap(THU.B.phone, 22);
    const db_ = (
      await json(
        await me(req("/x", undefined, { auth: bearer(b.accessToken) })),
      )
    ).data as { children: Array<{ name: string }> };
    expect(db_.children.map((c) => c.name)).toEqual([`${NS}Binh B1`]);
    expect(JSON.stringify(db_)).not.toContain("An A");

    const trong = await layCap(THU.TRONG.phone, 23);
    const dt = (
      await json(
        await me(req("/x", undefined, { auth: bearer(trong.accessToken) })),
      )
    ).data as { children: unknown[] };
    expect(dt.children).toEqual([]); // EMPTY STATE đúng nghĩa
  });

  it("[MA-06] /me thiếu / sai token ⇒ 401 UNAUTHENTICATED; refresh token đưa vào chỗ access ⇒ 401; không phiên nào bị thu hồi", async () => {
    const cap = await layCap(THU.B.phone, 31);
    const cac = [
      undefined,
      "Bearer ",
      "Bearer rac",
      bearer(cap.refreshToken),
      bearer(cap.accessToken.slice(0, -2) + "xx"),
      `Basic ${cap.accessToken}`,
    ];
    for (const a of cac) {
      const r = await me(req("/x", undefined, { auth: a }));
      expect([a, r.status, (await json(r)).error?.code]).toEqual([
        a,
        401,
        "UNAUTHENTICATED",
      ]);
    }
    expect(
      (await sessionCuaUser(ids.B)).filter(
        (s) => s.maThietBi === THIET_BI(31),
      )[0].thuHoiLuc,
    ).toBeNull();
  });

  it("[MA-07] đổi vai thành đa vai ⇒ phiên chết ở yêu cầu kế tiếp (TOKEN_REVOKED, lý do tai-khoan); user bị khoá / xoá mềm cũng vậy", async () => {
    const cap = await layCap(THU.TRONG.phone, 51);
    await db.user.update({
      where: { id: ids.TRONG },
      data: { roles: ["PARENT", "TEACHER"] },
    });
    const r = await me(req("/x", undefined, { auth: bearer(cap.accessToken) }));
    expect(r.status).toBe(401);
    expect((await json(r)).error?.code).toBe("TOKEN_REVOKED");
    const p = (await sessionCuaUser(ids.TRONG)).find(
      (s) => s.maThietBi === THIET_BI(51),
    );
    expect(p?.lyDoThuHoi).toBe("tai-khoan");
    await db.user.update({
      where: { id: ids.TRONG },
      data: { roles: ["PARENT"] },
    });
  });

  it("[MA-08] tokenVersion tăng (đổi mật khẩu / đổi quyền) ⇒ MỌI phiên mobile của tài khoản chết", async () => {
    const c1 = await layCap(THU.B.phone, 61);
    const c2 = await layCap(THU.B.phone, 62);
    await db.user.update({
      where: { id: ids.B },
      data: { tokenVersion: { increment: 1 } },
    });
    for (const c of [c1, c2]) {
      const r = await me(req("/x", undefined, { auth: bearer(c.accessToken) }));
      expect([r.status, (await json(r)).error?.code]).toEqual([
        401,
        "TOKEN_REVOKED",
      ]);
    }
    await db.user.update({ where: { id: ids.B }, data: { tokenVersion: 0 } });
  });

  it("[MA-09] đăng xuất: 200; sau đó access và refresh đều TOKEN_REVOKED; gọi lặp / rác vẫn 200; thiếu thân ⇒ 400", async () => {
    const cap = await layCap(THU.A.phone, 71);
    const out = await dangXuatRoute(
      req("/x", { refreshToken: cap.refreshToken }),
    );
    expect(out.status).toBe(200);
    expect((await json(out)).data).toEqual({});
    const a = await me(req("/x", undefined, { auth: bearer(cap.accessToken) }));
    expect([a.status, (await json(a)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    const rf = await lamMoiRoute(req("/x", { refreshToken: cap.refreshToken }));
    expect([rf.status, (await json(rf)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    const p = (await sessionCuaUser(ids.A)).find(
      (s) => s.maThietBi === THIET_BI(71),
    )!;
    expect([
      p.lyDoThuHoi,
      p.accessHash,
      p.refreshHash,
      p.refreshHashTruoc,
      p.accessHetHan,
    ]).toEqual(["dang-xuat", null, null, null, null]);
    expect(
      (await dangXuatRoute(req("/x", { refreshToken: cap.refreshToken })))
        .status,
    ).toBe(200);
    expect(
      (await dangXuatRoute(req("/x", { refreshToken: "smr_rac" }))).status,
    ).toBe(200);
    expect((await dangXuatRoute(req("/x", {}))).status).toBe(400);
  });

  it("[MA-10] làm mới R4: cặp mới dùng được; access cũ ⇒ 401 UNAUTHENTICATED (lành tính, KHÔNG thu hồi)", async () => {
    const c0 = await layCap(THU.A.phone, 81);
    const rr = await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken }));
    expect(rr.status).toBe(200);
    const c1 = (await json(rr)).data as typeof c0;
    expect(c1.refreshToken).not.toBe(c0.refreshToken);
    expect(c1.accessToken.slice(4, 26)).toBe(c0.accessToken.slice(4, 26)); // mã tra cố định suốt đời phiên
    const cu = await me(req("/x", undefined, { auth: bearer(c0.accessToken) }));
    expect([cu.status, (await json(cu)).error?.code]).toEqual([
      401,
      "UNAUTHENTICATED",
    ]);
    const moi = await me(
      req("/x", undefined, { auth: bearer(c1.accessToken) }),
    );
    expect(moi.status).toBe(200);
    expect(
      (await sessionCuaUser(ids.A)).find((s) => s.maThietBi === THIET_BI(81))!
        .thuHoiLuc,
    ).toBeNull();
  });

  it("[MA-11] DÙNG LẠI refresh token (R6): cặp đã xác nhận rồi mà token cũ quay lại ⇒ thu hồi phiên + kiểm toán; token mới cũng chết", async () => {
    const c0 = await layCap(THU.A.phone, 91);
    const c1 = (
      await json(
        await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken })),
      )
    ).data as typeof c0;
    expect(
      (await me(req("/x", undefined, { auth: bearer(c1.accessToken) }))).status,
    ).toBe(200); // xác nhận cặp mới
    const trom = await lamMoiRoute(
      req("/x", { refreshToken: c0.refreshToken }),
    ); // bản sao của token cũ
    expect([trom.status, (await json(trom)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    const p = (await sessionCuaUser(ids.A)).find(
      (s) => s.maThietBi === THIET_BI(91),
    )!;
    expect(p.lyDoThuHoi).toBe("dung-lai-token");
    const phuHuynh = await lamMoiRoute(
      req("/x", { refreshToken: c1.refreshToken }),
    );
    expect([phuHuynh.status, (await json(phuHuynh)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    const kt = await db.auditLog.findMany({
      where: {
        module: "mobile-auth",
        action: "REFRESH_TOKEN_REUSE",
        entityId: p.id,
      },
    });
    expect(kt.length).toBe(1);
  });

  it("[MA-12] MẤT PHẢN HỒI (R5): làm mới hai lần bằng cùng token chưa dùng ⇒ KHÔNG ai bị đăng xuất; cặp phát hụt chết ở lần dùng sau", async () => {
    const c0 = await layCap(THU.A.phone, 101);
    const p1 = (
      await json(
        await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken })),
      )
    ).data as typeof c0; // phản hồi "bị mất"
    const q = await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken })); // app thử lại bằng token cũ ⇒ R5
    expect(q.status).toBe(200);
    const c2 = (await json(q)).data as typeof c0;
    expect(c2.refreshToken).not.toBe(p1.refreshToken);
    expect(
      (await me(req("/x", undefined, { auth: bearer(c2.accessToken) }))).status,
    ).toBe(200); // cặp Q dùng được ⇒ xác nhận
    // cặp phát hụt P: access ⇒ UNAUTHENTICATED; refresh ⇒ không phải H cũng không phải T ⇒ R6 ⇒ thu hồi
    const pa = await me(req("/x", undefined, { auth: bearer(p1.accessToken) }));
    expect([pa.status, (await json(pa)).error?.code]).toEqual([
      401,
      "UNAUTHENTICATED",
    ]);
    const pr = await lamMoiRoute(req("/x", { refreshToken: p1.refreshToken }));
    expect([pr.status, (await json(pr)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    // và phiên THẬT SỰ bị thu hồi ở DB (không chỉ trả mã lỗi): cặp Q — vừa dùng được — nay cũng chết
    expect(
      (await sessionCuaUser(ids.A)).find((x) => x.maThietBi === THIET_BI(101))!
        .lyDoThuHoi,
    ).toBe("dung-lai-token");
    const qa = await me(req("/x", undefined, { auth: bearer(c2.accessToken) }));
    expect([qa.status, (await json(qa)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
  });

  it("[MA-13] access token gửi vào /refresh (và ngược lại) ⇒ 401 UNAUTHENTICATED, KHÔNG thu hồi phiên", async () => {
    const c = await layCap(THU.B.phone, 111);
    const r = await lamMoiRoute(req("/x", { refreshToken: c.accessToken }));
    expect([r.status, (await json(r)).error?.code]).toEqual([
      401,
      "UNAUTHENTICATED",
    ]);
    expect(
      (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(111))!
        .thuHoiLuc,
    ).toBeNull();
  });

  it("[MA-14] đăng nhập lại trên CÙNG thiết bị thay phiên cũ (một phiên sống / thiết bị); token cũ ⇒ TOKEN_REVOKED", async () => {
    const c1 = await layCap(THU.TRONG.phone, 121);
    const c2 = await layCap(THU.TRONG.phone, 121);
    const phien = (await sessionCuaUser(ids.TRONG)).filter(
      (s) => s.maThietBi === THIET_BI(121),
    );
    expect(phien.length).toBe(2);
    expect(phien.filter((s) => !s.thuHoiLuc).length).toBe(1);
    expect(phien.find((s) => s.thuHoiLuc)!.lyDoThuHoi).toBe("dang-nhap-lai");
    const cu = await me(req("/x", undefined, { auth: bearer(c1.accessToken) }));
    expect([cu.status, (await json(cu)).error?.code]).toEqual([
      401,
      "TOKEN_REVOKED",
    ]);
    expect(
      (await me(req("/x", undefined, { auth: bearer(c2.accessToken) }))).status,
    ).toBe(200);
  });

  it("[MA-15] hai lượt đăng nhập CÙNG LÚC trên cùng thiết bị ⇒ đúng MỘT phiên sống (khoá theo người dùng + chỉ mục duy nhất từng phần)", async () => {
    await db.mobileSession.deleteMany({ where: { userId: ids.TRONG } });
    const kq = await Promise.all([
      dangNhap(THU.TRONG.phone, 131),
      dangNhap(THU.TRONG.phone, 131),
      dangNhap(THU.TRONG.phone, 131),
    ]);
    for (const r of kq) expect([200, 500]).toContain(r.status);
    expect(kq.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    const song = (await sessionCuaUser(ids.TRONG)).filter(
      (s) => s.maThietBi === THIET_BI(131) && !s.thuHoiLuc,
    );
    expect(song.length).toBe(1);
  });

  it("[MA-16] tối đa 5 phiên sống: đăng nhập máy thứ 6 thu hồi phiên lâu không dùng nhất (lý do vuot-so-thiet-bi)", async () => {
    await db.mobileSession.deleteMany({ where: { userId: ids.TRONG } });
    // Sáu lần đăng nhập trong cùng một phút sẽ chạm ngưỡng 5/phút theo định danh (đúng chính sách) — xoá bộ đếm giữa các lượt để kiểm RIÊNG luật 5 phiên.
    const sach = () => db.authAttemptCounter.deleteMany({});
    for (let i = 1; i <= 5; i++) {
      await sach();
      await layCap(THU.TRONG.phone, 140 + i);
    }
    await db.mobileSession.updateMany({
      where: { userId: ids.TRONG, maThietBi: THIET_BI(143) },
      data: { lanDungCuoi: new Date(Date.now() - 86_400_000) },
    });
    await sach();
    await layCap(THU.TRONG.phone, 146);
    const phien = await sessionCuaUser(ids.TRONG);
    expect(phien.filter((s) => !s.thuHoiLuc).length).toBe(5);
    expect(phien.find((s) => s.maThietBi === THIET_BI(143))!.lyDoThuHoi).toBe(
      "vuot-so-thiet-bi",
    );
  });

  it("[MA-17] access hết hạn ⇒ TOKEN_EXPIRED (và cặp được xác nhận); phiên quá hạn không dùng ⇒ thu hồi het-han ở lần làm mới", async () => {
    const c = await layCap(THU.B.phone, 151);
    await db.mobileSession.updateMany({
      where: { userId: ids.B, maThietBi: THIET_BI(151) },
      data: { accessHetHan: new Date(Date.now() - 1000) },
    });
    const r = await me(req("/x", undefined, { auth: bearer(c.accessToken) }));
    expect([r.status, (await json(r)).error?.code]).toEqual([
      401,
      "TOKEN_EXPIRED",
    ]);
    expect(
      (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(151))!
        .xacNhanLuc,
    ).not.toBeNull();
    await db.mobileSession.updateMany({
      where: { userId: ids.B, maThietBi: THIET_BI(151) },
      data: { hetHanKhongDung: new Date(Date.now() - 1000) },
    });
    const rf = await lamMoiRoute(req("/x", { refreshToken: c.refreshToken }));
    expect([rf.status, (await json(rf)).error?.code]).toEqual([
      401,
      "UNAUTHENTICATED",
    ]);
    expect(
      (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(151))!
        .lyDoThuHoi,
    ).toBe("het-han");
  });

  it("[MA-18] giới hạn tần suất đăng nhập: vượt 5 lần/phút theo định danh ⇒ 429 RATE_LIMITED + Retry-After; kể cả mật khẩu ĐÚNG ở lượt vượt; có dòng kiểm toán", async () => {
    await db.authAttemptCounter.deleteMany({});
    const ip = "10.88.0.1";
    const mk = (m: string) => dangNhap(THU.TRONG.phone, 161, ip, m);
    for (let i = 0; i < 5; i++)
      expect((await mk("Sai-mat-khau-1")).status).toBe(401);
    const vuot = await mk(MAT_KHAU);
    expect(vuot.status).toBe(429);
    expect(vuot.headers.get("retry-after")).toBe("60");
    expect((await json(vuot)).error?.code).toBe("RATE_LIMITED");
    expect(
      await db.auditLog.count({
        where: { module: "mobile-auth", action: "LOGIN_RATE_LIMITED" },
      }),
    ).toBeGreaterThanOrEqual(1);
    // khoá đếm KHÔNG chứa định danh / IP rõ
    const khoa = await db.authAttemptCounter.findMany({
      select: { khoa: true },
    });
    for (const k of khoa) expect(k.khoa).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[MA-19] giới hạn theo IP: > 10 lượt/phút từ một IP (định danh khác nhau) ⇒ 429", async () => {
    await db.authAttemptCounter.deleteMany({});
    const ip = "10.88.0.2";
    let cuoi = 0;
    for (let i = 0; i < 12; i++)
      cuoi = (
        await dangNhapRoute(
          req(
            "/x",
            {
              dinhDanh: `096620${String(i).padStart(4, "0")}`,
              matKhau: "Sai-mat-khau-1",
              thietBi: { maThietBi: THIET_BI(170), nenTang: "ios" },
            },
            { ip },
          ),
        )
      ).status;
    expect(cuoi).toBe(429);
  });

  it("[MA-20] khoá đếm khác định dạng nhưng cùng số điện thoại (0966… và 84966…) dùng CHUNG một ngăn (chuẩn hoá trước khi đếm)", async () => {
    await db.authAttemptCounter.deleteMany({});
    const ip = "10.88.0.3";
    for (let i = 0; i < 3; i++)
      await dangNhap(THU.A.phone, 181, ip, "Sai-mat-khau-1");
    for (let i = 0; i < 2; i++)
      await dangNhap(THU.A.sdt84, 181, ip, "Sai-mat-khau-1");
    expect((await dangNhap(THU.A.phone, 181, ip, MAT_KHAU)).status).toBe(429);
  });

  it("[MA-21] làm mới bằng token KHÔNG tra ra phiên: đếm theo IP, > 60/giờ ⇒ 429; token hợp lệ không bị ngăn IP chặn", async () => {
    await db.authAttemptCounter.deleteMany({});
    const ip = "10.88.0.4";
    const rac =
      "smr_AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let cuoi = 0;
    for (let i = 0; i < 62; i++)
      cuoi = (await lamMoiRoute(req("/x", { refreshToken: rac }, { ip })))
        .status;
    expect(cuoi).toBe(429);
    const c = await layCap(THU.B.phone, 191);
    expect(
      (
        await lamMoiRoute(
          req("/x", { refreshToken: c.refreshToken }, { ip: "10.88.0.5" }),
        )
      ).status,
    ).toBe(200);
  });

  it("[MA-22] kiểm toán + log: có dòng SESSION_CREATED / SESSION_REVOKED, KHÔNG chứa token, băm, mật khẩu hay mã tra", async () => {
    const c = await layCap(THU.A.phone, 201);
    await dangXuatRoute(req("/x", { refreshToken: c.refreshToken }));
    const kt = await db.auditLog.findMany({
      where: { module: "mobile-auth", actorId: ids.A },
    });
    expect(kt.map((k) => k.action)).toEqual(
      expect.arrayContaining(["SESSION_CREATED", "SESSION_REVOKED"]),
    );
    const tho = JSON.stringify(kt);
    const maTra = c.accessToken.slice(4, 26);
    for (const cam of [
      c.accessToken.split(".")[1],
      c.refreshToken.split(".")[1],
      maTra,
      MAT_KHAU,
      "sma_",
      "smr_",
    ])
      expect(tho).not.toContain(cam);
  });

  it("[MA-23] hai thiết bị cùng tài khoản độc lập: đăng xuất một máy KHÔNG đụng máy kia", async () => {
    await db.mobileSession.deleteMany({ where: { userId: ids.B } });
    const m1 = await layCap(THU.B.phone, 211);
    const m2 = await layCap(THU.B.phone, 212);
    await dangXuatRoute(req("/x", { refreshToken: m1.refreshToken }));
    expect(
      (await me(req("/x", undefined, { auth: bearer(m1.accessToken) }))).status,
    ).toBe(401);
    expect(
      (await me(req("/x", undefined, { auth: bearer(m2.accessToken) }))).status,
    ).toBe(200);
  });
  it("[MA-24] quy định đào tạo: cần đăng nhập; GET trả văn bản đang phát hành; POST đồng ý bản ĐANG PHÁT HÀNH (idempotent, bỏ qua phiên bản client gửi); /me phản ánh", async () => {
    expect((await quyDinhGet(req("/x"))).status).toBe(401);
    expect((await quyDinhDongY(req("/x", {}))).status).toBe(401);
    const c = await layCap(THU.TRONG.phone, 221);
    const g = await quyDinhGet(
      req("/x", undefined, { auth: bearer(c.accessToken) }),
    );
    expect(g.status).toBe(200);
    const d = (await json(g)).data as {
      phienBan: string;
      maVanBan: string;
      muc: Array<{ ten: string; dong: string[] }>;
    };
    expect(d.maVanBan).toBe("SR.VH.205");
    expect(d.muc.length).toBeGreaterThan(0);
    const truoc = (
      await json(
        await me(req("/x", undefined, { auth: bearer(c.accessToken) })),
      )
    ).data as { quyDinh: { daDongY: boolean } };
    expect(truoc.quyDinh.daDongY).toBe(false);
    for (let i = 0; i < 2; i++)
      expect(
        (
          await quyDinhDongY(
            req(
              "/x",
              { phienBan: "1999-01-01" },
              { auth: bearer(c.accessToken) },
            ),
          )
        ).status,
      ).toBe(200);
    const dong = await db.sitePolicyAcceptance.findMany({
      where: { userId: ids.TRONG },
    });
    expect(dong.length).toBe(1);
    expect(dong[0].version).toBe(d.phienBan); // phiên bản do MÁY CHỦ chọn, không phải "1999-01-01" của client
    const sau = (
      await json(
        await me(req("/x", undefined, { auth: bearer(c.accessToken) })),
      )
    ).data as { quyDinh: { daDongY: boolean } };
    expect(sau.quyDinh.daDongY).toBe(true);
  });
  it("[MA-25] lịch học: 401 khi chưa đăng nhập; 403 POLICY_REQUIRED khi chưa đồng ý quy định; sau khi đồng ý ⇒ 200 đúng dữ liệu của MỘT con", async () => {
    const ctx = (id: string) => ({
      params: Promise.resolve({ studentId: id }),
    });
    expect((await lichGet(req("/x"), ctx(`${NS}hs-a1`))).status).toBe(401);
    const a = await layCap(THU.A.phone, 231);
    const chua = await lichGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctx(`${NS}hs-a1`),
    );
    expect([chua.status, (await json(chua)).error?.code]).toEqual([
      403,
      "POLICY_REQUIRED",
    ]);
    expect(
      (await quyDinhDongY(req("/x", {}, { auth: bearer(a.accessToken) })))
        .status,
    ).toBe(200);
    const ok = await lichGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctx(`${NS}hs-a1`),
    );
    expect(ok.status).toBe(200);
    const d = (await json(ok)).data as {
      courseName: string | null;
      className: string | null;
      next: { title: string; trangThai: string } | null;
      upcoming: Array<{ title: string; trangThai: string }>;
      thisWeek: Array<{ title: string; trangThai: string }>;
    };
    expect(d.courseName).toBe("Sata 3 TEST");
    expect(d.className).toBe("MTEST.LOP");
    const tatCa = [...(d.next ? [d.next] : []), ...d.upcoming];
    expect(tatCa.map((b) => b.title)).toContain("Buổi sắp tới");
    // Theo nghiệp vụ của web: buổi ĐÃ HUỶ hiện ở "tuần này" (kèm nhãn huỷ) nhưng KHÔNG nằm trong "sắp tới" và không được chọn làm buổi kế tiếp.
    expect(d.thisWeek.find((b) => b.title === "Buổi huỷ")?.trangThai).toBe(
      "huy",
    );
    expect(tatCa.map((b) => b.title)).not.toContain("Buổi huỷ");
    const tho = JSON.stringify(d);
    for (const cam of [
      "dateISO",
      "attended",
      "ngoaiPhamVi",
      "centerId",
      "parentUserId",
    ])
      expect(tho).not.toContain(cam);
  });

  it("[MA-26] SỞ HỮU: A xin lịch của B1 / id lạ / id rác ⇒ CÙNG một 404 NOT_FOUND (không phân biệt của người khác với không có); B xin của A1 cũng vậy", async () => {
    const ctx = (id: string) => ({
      params: Promise.resolve({ studentId: id }),
    });
    const a = await layCap(THU.A.phone, 241);
    await quyDinhDongY(req("/x", {}, { auth: bearer(a.accessToken) }));
    const ketQua: string[] = [];
    for (const id of [
      `${NS}hs-b1`,
      "khong-ton-tai",
      "../../etc/passwd",
      "x".repeat(200),
      "",
    ]) {
      const r = await lichGet(
        req("/x", undefined, { auth: bearer(a.accessToken) }),
        ctx(id),
      );
      const b = await json(r);
      ketQua.push(`${r.status}|${b.error?.code}|${b.error?.message}`);
    }
    expect(new Set(ketQua).size).toBe(1);
    expect(ketQua[0].startsWith("404|NOT_FOUND|")).toBe(true);
    const b = await layCap(THU.B.phone, 242);
    await quyDinhDongY(req("/x", {}, { auth: bearer(b.accessToken) }));
    const rb = await lichGet(
      req("/x", undefined, { auth: bearer(b.accessToken) }),
      ctx(`${NS}hs-a1`),
    );
    expect([rb.status, (await json(rb)).error?.code]).toEqual([
      404,
      "NOT_FOUND",
    ]);
    const bCuaMinh = await lichGet(
      req("/x", undefined, { auth: bearer(b.accessToken) }),
      ctx(`${NS}hs-b1`),
    );
    expect(bCuaMinh.status).toBe(200);
    // học viên đã xoá mềm ⇒ 404 ngay cả với chủ
    await db.student.update({
      where: { id: `${NS}hs-a2` },
      data: { deletedAt: new Date() },
    });
    const xoa = await lichGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctx(`${NS}hs-a2`),
    );
    expect(xoa.status).toBe(404);
    await db.student.update({
      where: { id: `${NS}hs-a2` },
      data: { deletedAt: null },
    });
  });

  it("[MA-27] EMPTY STATE: con chưa ghi danh ⇒ 200 với lịch trống (không 404, không dữ liệu giả)", async () => {
    const ctx = { params: Promise.resolve({ studentId: `${NS}hs-a2` }) };
    const a = await layCap(THU.A.phone, 251);
    await quyDinhDongY(req("/x", {}, { auth: bearer(a.accessToken) }));
    const r = await lichGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctx,
    );
    expect(r.status).toBe(200);
    const d = (await json(r)).data as {
      next: unknown;
      thisWeek: unknown[];
      upcoming: unknown[];
    };
    expect([d.next, d.thisWeek, d.upcoming]).toEqual([null, [], []]);
  });
  const ctxHs = (id: string) => ({
    params: Promise.resolve({ studentId: id }),
  });
  const dongYQuyDinhChoTatCa = async () => {
    for (const k of ["A", "B"] as const) {
      const c = await layCap(THU[k].phone, k === "A" ? 301 : 302);
      await quyDinhDongY(req("/x", {}, { auth: bearer(c.accessToken) }));
    }
  };

  it("[MA-28] tổng quan: 401 / 403 POLICY_REQUIRED; sau đồng ý ⇒ dữ liệu THẬT của con (tên, lớp, buổi kế tiếp); trường không có dữ liệu là null (không tự sinh)", async () => {
    expect((await tongQuanGet(req("/x"), ctxHs(`${NS}hs-a1`))).status).toBe(
      401,
    );
    await db.sitePolicyAcceptance.deleteMany({ where: { userId: ids.A } }); // các ca trước có thể đã đồng ý
    const a = await layCap(THU.A.phone, 311);
    const chua = await tongQuanGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctxHs(`${NS}hs-a1`),
    );
    expect([chua.status, (await json(chua)).error?.code]).toEqual([
      403,
      "POLICY_REQUIRED",
    ]);
    await quyDinhDongY(req("/x", {}, { auth: bearer(a.accessToken) }));
    const r = await tongQuanGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctxHs(`${NS}hs-a1`),
    );
    expect(r.status).toBe(200);
    const d = (await json(r)).data as {
      tenCon: string;
      tiepTheo: { tieuDe: string } | null;
      hanhTrinh: { tenKhoa: string | null; hocPhan: unknown[] };
      nhanXet: { noiDung: string } | null;
      hocBu: unknown;
    };
    expect(d.tenCon).toContain("An A1");
    expect(d.tiepTheo?.tieuDe).toBe("Buổi sắp tới");
    expect(d.hanhTrinh.tenKhoa).toBe("Sata 3 TEST");
    expect(d.nhanXet?.noiDung ?? "").toContain("nhận xét TEST của A1");
    const tho = JSON.stringify(d);
    for (const cam of [
      "href",
      "hocPhiChiTiet",
      "nhomLop",
      "sapHetKhoa",
      "viecCanLam",
      "parentUserId",
      "Nhận xét TEST riêng của B1",
    ])
      expect(tho).not.toContain(cam);
  });

  it("[MA-29] tổng quan: SỞ HỮU (B xin của A1 ⇒ 404 cùng khuôn); con chưa ghi danh ⇒ 200 trống, KHÔNG số liệu giả", async () => {
    await dongYQuyDinhChoTatCa();
    const b = await layCap(THU.B.phone, 321);
    const rb = await tongQuanGet(
      req("/x", undefined, { auth: bearer(b.accessToken) }),
      ctxHs(`${NS}hs-a1`),
    );
    expect([rb.status, (await json(rb)).error?.code]).toEqual([
      404,
      "NOT_FOUND",
    ]);
    const a = await layCap(THU.A.phone, 322);
    const trong = await tongQuanGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctxHs(`${NS}hs-a2`),
    );
    expect(trong.status).toBe(200);
    const d = (await json(trong)).data as {
      tiepTheo: unknown;
      hanhTrinh: { hocPhan: unknown[] };
      nhanXet: unknown;
      hocBu: unknown;
    };
    expect([d.tiepTheo, d.hanhTrinh.hocPhan, d.nhanXet, d.hocBu]).toEqual([
      null,
      [],
      null,
      null,
    ]);
  });

  it("[MA-30] tiến độ: chuyên cần + nhận xét ĐÚNG của con; B chỉ thấy dữ liệu của B; không đường dẫn web; id lạ ⇒ 404", async () => {
    await dongYQuyDinhChoTatCa();
    const a = await layCap(THU.A.phone, 331);
    const r = await tienDoGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctxHs(`${NS}hs-a1`),
    );
    expect(r.status).toBe(200);
    const d = (await json(r)).data as {
      tenLop: string | null;
      chuyenCan: {
        coMat: number;
        phanTram: number | null;
        ganDay: Array<{ kieu: string }>;
      };
      nhanXet: Array<{
        chung: Array<{ text: string }>;
        giaoVien: string | null;
      }>;
    };
    expect(d.tenLop).toBe("MTEST.LOP");
    expect(d.chuyenCan.coMat).toBe(1);
    expect(d.chuyenCan.phanTram).toBe(100);
    expect(d.chuyenCan.ganDay.some((o) => o.kieu === "co")).toBe(true);
    expect(d.nhanXet.map((n) => n.chung.map((c) => c.text).join(" "))).toEqual([
      "Con làm việc nhóm rất tốt (nhận xét TEST của A1)",
    ]);
    const tho = JSON.stringify(d);
    for (const cam of ["href", "nut", "B1", "parentUserId"])
      expect(tho).not.toContain(cam);
    const b = await layCap(THU.B.phone, 332);
    const rb = await tienDoGet(
      req("/x", undefined, { auth: bearer(b.accessToken) }),
      ctxHs(`${NS}hs-b1`),
    );
    const db_ = (await json(rb)).data as {
      chuyenCan: {
        coMat: number;
        phanTram: number | null;
        vangKhongBu: number;
      };
      nhanXet: Array<{ chung: Array<{ text: string }> }>;
    };
    expect(db_.chuyenCan.coMat).toBe(0); // B1 vắng buổi duy nhất — KHÔNG lẫn điểm danh của A1
    expect(JSON.stringify(db_.nhanXet)).toContain("riêng của B1");
    expect(JSON.stringify(db_.nhanXet)).not.toContain("A1");
    const cheo = await tienDoGet(
      req("/x", undefined, { auth: bearer(b.accessToken) }),
      ctxHs(`${NS}hs-a1`),
    );
    expect(cheo.status).toBe(404);
  });

  it("[MA-31] tiến độ: con chưa ghi danh ⇒ 200, phần trăm chuyên cần = null (KHÔNG tự đặt 0% hay 100%), danh sách rỗng", async () => {
    await dongYQuyDinhChoTatCa();
    const a = await layCap(THU.A.phone, 341);
    const r = await tienDoGet(
      req("/x", undefined, { auth: bearer(a.accessToken) }),
      ctxHs(`${NS}hs-a2`),
    );
    expect(r.status).toBe(200);
    const d = (await json(r)).data as {
      chuyenCan: { phanTram: number | null; mauSo: number; ganDay: unknown[] };
      nhanXet: unknown[];
      hanhTrinh: { hocPhan: unknown[] };
    };
    expect(d.chuyenCan.phanTram).toBeNull();
    expect(d.chuyenCan.ganDay).toEqual([]);
    expect(d.nhanXet).toEqual([]);
    expect(d.hanhTrinh.hocPhan).toEqual([]);
  });

  it("[MA-32] thông báo: A chỉ thấy mục của A (nhận xét của A1), B chỉ thấy của B; đánh dấu đã đọc chỉ nhận id THẬT của chính mình, idempotent", async () => {
    await dongYQuyDinhChoTatCa();
    // Feed của web coi mục < 2 ngày là CHƯA ĐỌC (heuristic cũ của web): kéo buổi học về hôm qua để có mục chưa đọc, trả lại ở cuối ca.
    const homQua = new Date(Date.now() - 86_400_000);
    homQua.setHours(20, 0, 0, 0);
    const cu = await db.classSession.findUniqueOrThrow({
      where: { id: `${NS}b1` },
      select: { date: true },
    });
    await db.classSession.update({
      where: { id: `${NS}b1` },
      data: { date: homQua },
    });
    try {
      const a = await layCap(THU.A.phone, 351);
      const b = await layCap(THU.B.phone, 352);
      expect((await thongBaoGet(req("/x"))).status).toBe(401);
      const fa = (
        await json(
          await thongBaoGet(
            req("/x", undefined, { auth: bearer(a.accessToken) }),
          ),
        )
      ).data as {
        items: Array<{
          id: string;
          category: string;
          body: string;
          read: boolean;
          nhanLuc: string;
        }>;
        unreadTotal: number;
      };
      const fb = (
        await json(
          await thongBaoGet(
            req("/x", undefined, { auth: bearer(b.accessToken) }),
          ),
        )
      ).data as typeof fa;
      expect(JSON.stringify(fa.items)).toContain("nhận xét TEST của A1");
      expect(JSON.stringify(fa.items)).not.toContain("riêng của B1");
      expect(JSON.stringify(fb.items)).toContain("riêng của B1");
      expect(JSON.stringify(fb.items)).not.toContain("A1");
      expect(
        fa.items.every(
          (i) =>
            ["NHAN_XET", "HOC_BU", "HOC_BA", "KHAO_SAT", "THONG_BAO"].includes(
              i.category,
            ) && i.nhanLuc.length > 0,
        ),
      ).toBe(true);
      const chuaDoc = fa.items.filter((i) => !i.read);
      expect(chuaDoc.length).toBeGreaterThan(0);
      expect(fa.unreadTotal).toBe(chuaDoc.length);
      const id = chuaDoc[0].id;
      // B không đánh dấu hộ A được; id lạ bị bỏ; thân sai ⇒ 400
      const cheo = await thongBaoDoc(
        req("/x", { ids: [id] }, { auth: bearer(b.accessToken) }),
      );
      expect((await json(cheo)).data).toEqual({ daGhi: 0 });
      expect(await db.portalFeedRead.count({ where: { itemId: id } })).toBe(0);
      expect(
        (
          await json(
            await thongBaoDoc(
              req("/x", { ids: ["id-la"] }, { auth: bearer(a.accessToken) }),
            ),
          )
        ).data,
      ).toEqual({ daGhi: 0 });
      expect(
        (
          await thongBaoDoc(
            req("/x", { ids: "x" }, { auth: bearer(a.accessToken) }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await json(
            await thongBaoDoc(
              req("/x", { ids: [id] }, { auth: bearer(a.accessToken) }),
            ),
          )
        ).data,
      ).toEqual({ daGhi: 1 });
      expect(
        (
          await json(
            await thongBaoDoc(
              req("/x", { ids: [id] }, { auth: bearer(a.accessToken) }),
            ),
          )
        ).data,
      ).toEqual({ daGhi: 0 });
      const sau = (
        await json(
          await thongBaoGet(
            req("/x", undefined, { auth: bearer(a.accessToken) }),
          ),
        )
      ).data as typeof fa;
      expect(sau.items.find((i) => i.id === id)?.read).toBe(true);
    } finally {
      await db.classSession.update({
        where: { id: `${NS}b1` },
        data: { date: cu.date },
      });
    }
  });
  it("[MA-33] làm mới ĐỒNG THỜI bằng cùng một token (giới hạn G1): không lỗi 5xx, không thu hồi oan; kết cục nhất quán (mỗi bên 200 hoặc 401), phiên vẫn đúng một dòng", async () => {
    const c = await layCap(THU.A.phone, 401);
    const kq = await Promise.all([1, 2, 3].map(() => lamMoiRoute(req("/x", { refreshToken: c.refreshToken }))));
    for (const r of kq) expect([200, 401]).toContain(r.status);
    expect(kq.some((r) => r.status === 200)).toBe(true);
    const phien = (await sessionCuaUser(ids.A)).filter((x) => x.maThietBi === THIET_BI(401));
    expect(phien.length).toBe(1);
    // bên thắng nhận cặp mới dùng được hoặc (nếu bị cặp khác ghi đè theo R5) bị thu hồi — không bao giờ ở trạng thái nửa vời
    const thang = (await json(kq.find((r) => r.status === 200)!)).data as { accessToken: string };
    const dung = await me(req("/x", undefined, { auth: bearer(thang.accessToken) }));
    expect([200, 401]).toContain(dung.status);
    const ban = phien[0];
    expect(ban.thuHoiLuc === null ? ban.accessHash !== null && ban.refreshHash !== null : ban.accessHash === null && ban.refreshHash === null).toBe(true);
  });

  it("[MA-34] app bị đóng giữa lúc làm mới: phản hồi MẤT ⇒ mở lại bằng refresh token CŨ vẫn vào được (R5), và sau khi dùng cặp mới thì token cũ KHÔNG dùng lại được (R6)", async () => {
    const c0 = await layCap(THU.B.phone, 411);
    await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken })); // phản hồi bị mất vì app bị đóng
    const lai = await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken })); // lần mở sau: kho máy vẫn giữ token cũ
    expect(lai.status).toBe(200);
    const c1 = (await json(lai)).data as typeof c0;
    expect((await me(req("/x", undefined, { auth: bearer(c1.accessToken) }))).status).toBe(200);
    const trom = await lamMoiRoute(req("/x", { refreshToken: c0.refreshToken }));
    expect([trom.status, (await json(trom)).error?.code]).toEqual([401, "TOKEN_REVOKED"]);
  });
  it("[MA-35] HẾT HẠN TUYỆT ĐỐI (180 ngày): quá mốc thì làm mới ⇒ 401 + thu hồi het-han; access còn sống nhưng phiên quá mốc ⇒ 401 ở /me", async () => {
    const c = await layCap(THU.B.phone, 421);
    // Ràng buộc CHECK của DB (`MobileSession_han_check`): access ≤ không-dùng ≤ tuyệt-đối — hạn không-dùng và access LUÔN bị cắt bởi mốc tuyệt đối.
    // Nên "quá mốc tuyệt đối" trong dữ liệu thật nghĩa là cả ba mốc cùng nằm trong quá khứ (không thể đặt riêng mốc tuyệt đối vào quá khứ).
    const qua = new Date(Date.now() - 1000);
    await db.mobileSession.updateMany({
      where: { userId: ids.B, maThietBi: THIET_BI(421) },
      data: { accessHetHan: qua, hetHanKhongDung: qua, hetHanTuyetDoi: qua },
    });
    const m = await me(req("/x", undefined, { auth: bearer(c.accessToken) }));
    expect(m.status).toBe(401);
    const rf = await lamMoiRoute(req("/x", { refreshToken: c.refreshToken }));
    expect([rf.status, (await json(rf)).error?.code]).toEqual([401, "UNAUTHENTICATED"]);
    expect(
      (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(421))!.lyDoThuHoi,
    ).toBe("het-han");
  });

  it("[MA-36] 30 ngày là cửa sổ KHÔNG DÙNG TRƯỢT: mỗi lần xoay vòng gia hạn thêm 30 ngày NHƯNG không bao giờ vượt mốc tuyệt đối; mốc tuyệt đối không đổi", async () => {
    const NGAY_MS = 24 * 60 * 60 * 1000;
    // (a) còn xa mốc tuyệt đối: hạn không dùng = bây giờ + 30 ngày
    const a = await layCap(THU.B.phone, 422);
    await db.mobileSession.updateMany({
      where: { userId: ids.B, maThietBi: THIET_BI(422) },
      data: { hetHanKhongDung: new Date(Date.now() + 1 * NGAY_MS), hetHanTuyetDoi: new Date(Date.now() + 170 * NGAY_MS) },
    });
    const truocA = (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(422))!;
    const ra = await lamMoiRoute(req("/x", { refreshToken: a.refreshToken }));
    expect(ra.status).toBe(200);
    const sauA = (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(422))!;
    const kd = sauA.hetHanKhongDung.getTime() - Date.now();
    expect(kd).toBeGreaterThan(29.99 * NGAY_MS);
    expect(kd).toBeLessThanOrEqual(30 * NGAY_MS);
    expect(sauA.hetHanTuyetDoi.getTime()).toBe(truocA.hetHanTuyetDoi.getTime()); // mốc tuyệt đối KHÔNG bị gia hạn
    // (b) sát mốc tuyệt đối (còn 10 ngày): hạn không dùng bị CẮT đúng bằng mốc tuyệt đối, access cũng không vượt
    const b = await layCap(THU.B.phone, 423);
    const mocB = new Date(Date.now() + 10 * NGAY_MS);
    await db.mobileSession.updateMany({
      where: { userId: ids.B, maThietBi: THIET_BI(423) },
      data: { hetHanKhongDung: new Date(Date.now() + 1 * NGAY_MS), hetHanTuyetDoi: mocB },
    });
    const rb = await lamMoiRoute(req("/x", { refreshToken: b.refreshToken }));
    expect(rb.status).toBe(200);
    const sauB = (await sessionCuaUser(ids.B)).find((s) => s.maThietBi === THIET_BI(423))!;
    expect(sauB.hetHanKhongDung.getTime()).toBe(mocB.getTime());
    expect(sauB.hetHanTuyetDoi.getTime()).toBe(mocB.getTime());
    expect(sauB.accessHetHan!.getTime()).toBeLessThanOrEqual(mocB.getTime());
  });

  it("[MA-37] KHÔNG lộ tài khoản có tồn tại qua THỜI GIAN: mọi nhánh thất bại (không có tài khoản · bị khoá · chờ kích hoạt · sai mật khẩu) đều tốn đúng MỘT lượt bcrypt, và trả CÙNG một 401", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    try {
      const ca: Array<[string, string]> = [
        ["0966109999", MAT_KHAU], // không tồn tại
        [THU.KHOA.phone, MAT_KHAU], // bị khoá
        [THU.CHUA.phone, MAT_KHAU], // chờ kích hoạt
        [THU.A.phone, "sai-mat-khau-hoan-toan"], // sai mật khẩu
        [THU.NV.phone, MAT_KHAU], // nhân viên (đúng mật khẩu) — app chỉ nhận phụ huynh
      ];
      const kq: Array<[number, string | undefined, number]> = [];
      for (const [i, [dinhDanh, mk]] of ca.entries()) {
        compare.mockClear();
        const r = await dangNhap(dinhDanh, 600 + i, ipMoi(), mk);
        kq.push([r.status, (await json(r)).error?.code, compare.mock.calls.length]);
      }
      expect(kq).toEqual(ca.map(() => [401, "INVALID_CREDENTIALS", 1]));
      // nhân viên: lượt so duy nhất phải là băm GIẢ (cost 10), không phải băm thật của họ (cost 12 ở màn Cài đặt web) — nếu không, độ chậm lộ "đây là nhân viên"
      compare.mockClear();
      await dangNhap(THU.NV.phone, 650, ipMoi(), MAT_KHAU);
      expect(String(compare.mock.calls[0]?.[1])).not.toBe(String((await db.user.findUnique({ where: { id: ids.NV }, select: { password: true } }))?.password));
    } finally {
      compare.mockRestore();
    }
  });

  it("[MA-38] số chưa đọc ở CHUÔNG của /overview = số của danh sách /notifications, trước và sau \"Đọc hết\" (lỗi đo trên APK 17/11: 3 vs 0)", async () => {
    await dongYQuyDinhChoTatCa();
    const homQua = new Date(Date.now() - 86_400_000);
    homQua.setHours(20, 0, 0, 0);
    const cu = await db.classSession.findUniqueOrThrow({ where: { id: `${NS}b1` }, select: { date: true } });
    await db.classSession.update({ where: { id: `${NS}b1` }, data: { date: homQua } });
    try {
      await db.portalFeedRead.deleteMany({ where: { userId: ids.A } }); // ca trước (MA-32) đã đánh dấu đã đọc — về trạng thái sạch
      const a = await layCap(THU.A.phone, 381);
      const auth = { auth: bearer(a.accessToken) };
      const dem = async () => {
        const tq = (await json(await tongQuanGet(req("/x", undefined, auth), ctxHs(`${NS}hs-a1`)))).data as { soThongBaoChuaDoc: number };
        const tb = (await json(await thongBaoGet(req("/x", undefined, auth)))).data as { unreadTotal: number; items: Array<{ id: string; read: boolean }> };
        return { chuong: tq.soThongBaoChuaDoc, danhSach: tb.unreadTotal, ids: tb.items.filter((i) => !i.read).map((i) => i.id) };
      };
      const truoc = await dem();
      expect(truoc.danhSach).toBeGreaterThan(0);
      expect(truoc.chuong).toBe(truoc.danhSach);
      await thongBaoDoc(req("/x", { ids: truoc.ids }, auth));
      const sau = await dem();
      expect(sau.danhSach).toBe(0);
      expect(sau.chuong).toBe(0);
    } finally {
      await db.classSession.update({ where: { id: `${NS}b1` }, data: { date: cu.date } });
    }
  });
  it("[MA-44] /overview có `lienHe`: số + Zalo CHUNG của công ty và giờ mở cửa của cơ sở; KHÔNG lấy `Center.phone` (DB TEST còn 0818823720 — CONTACT_DATA_UNVERIFIED, xem OD-01: số nào là số đúng do chủ dự án xác nhận)", async () => {
    await dongYQuyDinhChoTatCa();
    const a = await layCap(THU.A.phone, 441);
    const tq = (await json(await tongQuanGet(req("/x", undefined, { auth: bearer(a.accessToken) }), ctxHs(`${NS}hs-a1`)))).data as {
      lienHe: { soHien: string; soTho: string; zaloUrl: string; gioMoCua: string; tenCoSo: string | null };
    };
    expect(tq.lienHe.soHien).toBe("0837.312.860");
    expect(tq.lienHe.soTho).toBe("0837312860");
    expect(tq.lienHe.zaloUrl).toBe("https://zalo.me/0837312860");
    expect(tq.lienHe.gioMoCua).toBe("T3 - CN: 8:00 - 21:00");
    expect(JSON.stringify(tq.lienHe)).not.toMatch(/0818|0702/);
    // Không có khoá lạ: chỉ đúng năm trường (không lộ cột nào khác của Center).
    expect(Object.keys(tq.lienHe).sort()).toEqual(["gioMoCua", "soHien", "soTho", "tenCoSo", "zaloUrl"]);
  });
  describe("[MA-39..43] bộ giới hạn đăng nhập DÙNG CHUNG (cờ LOGIN_LIMITER_V2 BẬT)", () => {
    const BAT = () => {
      process.env.LOGIN_LIMITER_V2 = "true";
    };
    const TAT = () => {
      delete process.env.LOGIN_LIMITER_V2;
    };
    const SAI = "mat-khau-sai-hoan-toan";

    it("[MA-39] cờ TẮT (mặc định) ⇒ đường CŨ: không ghi khoá `gh:` nào (bảng đếm chỉ có khoá của bộ cũ)", async () => {
      TAT();
      await db.authAttemptCounter.deleteMany({});
      expect((await dangNhap(THU.A.phone, 391, "10.39.0.1")).status).toBe(200);
      // bộ cũ lưu băm của `login:ip:` / `login:id:` — không có cách nhận ra bằng tiền tố vì đã băm; kiểm gián tiếp: số dòng = 2 (ip + định danh) chứ không phải 4–5 dòng của bộ mới
      expect(await db.authAttemptCounter.count()).toBeLessThanOrEqual(2);
    });

    it("[MA-40] cờ BẬT — không khoá nhầm: kẻ xấu 5 lượt sai từ IP X ⇒ lượt 6 (kể cả ĐÚNG) bị 429; nạn nhân từ IP Y đăng nhập đúng ⇒ 200", async () => {
      BAT();
      try {
        await db.authAttemptCounter.deleteMany({});
        for (let i = 0; i < 5; i++) expect((await dangNhap(THU.A.phone, 400 + i, "10.40.0.1", SAI)).status).toBe(401);
        expect((await dangNhap(THU.A.phone, 405, "10.40.0.1", MAT_KHAU)).status).toBe(429);
        expect((await dangNhap(THU.A.phone, 406, "10.40.0.2", MAT_KHAU)).status).toBe(200);
      } finally {
        TAT();
      }
    });

    it("[MA-41] cờ BẬT — lượt ĐÚNG được hoàn lại: 30 lần đăng nhập đúng liên tiếp cùng IP không bị chặn", async () => {
      BAT();
      try {
        await db.authAttemptCounter.deleteMany({});
        for (let i = 0; i < 30; i++) expect((await dangNhap(THU.A.phone, 410, "10.41.0.1")).status).toBe(200);
      } finally {
        TAT();
      }
    });

    it("[MA-42] cờ BẬT — KÊNH CHUNG: 3 lượt sai ở WEB (cổng dùng chung) + 2 sai ở MOBILE cùng (định danh, IP) ⇒ lượt thứ 6 ở bất kỳ kênh nào bị chặn", async () => {
      BAT();
      try {
        await db.authAttemptCounter.deleteMany({});
        for (let i = 0; i < 3; i++) expect((await kiemTruocDangNhap("web", "10.42.0.1", THU.A.phone)).cho).toBe(true);
        for (let i = 0; i < 2; i++) expect((await dangNhap(THU.A.phone, 420 + i, "10.42.0.1", SAI)).status).toBe(401);
        expect((await dangNhap(THU.A.phone, 425, "10.42.0.1", MAT_KHAU)).status).toBe(429);
        expect((await kiemTruocDangNhap("web", "10.42.0.1", THU.A.phone)).cho).toBe(false);
        // định danh viết dạng khác (0… / 84…) vẫn là CÙNG khoá
        expect((await kiemTruocDangNhap("web", "10.42.0.1", `84${THU.A.phone.slice(1)}`)).cho).toBe(false);
      } finally {
        TAT();
      }
    });

    it("[MA-43] cờ BẬT — dò PHÂN TÁN 30 IP: sau 20 lượt sai, đoán TRÚNG từ IP lạ ⇒ 429; IP đã từng đăng nhập đúng vào được; `maThietBi` do client khai KHÔNG tạo ra ngoại lệ nào", async () => {
      BAT();
      try {
        await db.authAttemptCounter.deleteMany({});
        expect((await dangNhap(THU.A.phone, 430, "10.43.1.1", MAT_KHAU)).status).toBe(200); // dấu ấy do máy chủ ghi cho (A, 10.43.1.1)
        let sai = 0;
        for (let i = 0; i < 30; i++) {
          const r = await dangNhap(THU.A.phone, 431 + i, `10.43.2.${i + 1}`, SAI);
          if (r.status === 401) sai++;
        }
        expect(sai).toBeGreaterThanOrEqual(15); // còn ít nhất 15 lượt chạm tới bước so mật khẩu (trần 20 trừ lượt thành công)
        expect(sai).toBeLessThanOrEqual(20);
        // IP lạ + maThietBi ĐÃ TỪNG có phiên (n=430) ⇒ vẫn bị chặn (client không khai được 'quen')
        expect((await dangNhap(THU.A.phone, 430, "10.43.3.9", MAT_KHAU)).status).toBe(429);
        // IP đã từng thành công ⇒ vào được (dấu ấy do máy chủ ghi)
        expect((await dangNhap(THU.A.phone, 499, "10.43.1.1", MAT_KHAU)).status).toBe(200);
      } finally {
        TAT();
      }
    });
  });
  describe("[B4-N1/N2] nhận xét · học bạ · chuyên cần · lịch tháng · chi tiết buổi", () => {
    type Duong = { ten: string; goi: (a: string, hs: string) => Promise<Response> };
    const auth = (t: string) => ({ auth: bearer(t) });
    const DUONG: Duong[] = [
      { ten: "feedback", goi: (a, hs) => nhanXetGet(req("/x", undefined, auth(a)), ctxHs(hs)) },
      { ten: "report-card", goi: (a, hs) => hocBaGet(req("/x", undefined, auth(a)), ctxHs(hs)) },
      { ten: "attendance", goi: (a, hs) => chuyenCanGet(req("/x", undefined, auth(a)), ctxHs(hs)) },
      { ten: "schedule?month", goi: (a, hs) => lichGet(req(`/x?month=${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`, undefined, auth(a)), ctxHs(hs)) },
      { ten: "sessions/:id", goi: (a, hs) => chiTietBuoiGet(req("/x", undefined, auth(a)), { params: Promise.resolve({ studentId: hs, sessionId: `${NS}b1` }) }) },
    ];

    it("[B4-01] CÁCH LY GIA ĐÌNH theo VÒNG LẶP mọi route có :id: không token ⇒ 401; con CỦA MÌNH ⇒ 200 (đối chứng dương); con của gia đình khác ⇒ 404 và GIỐNG HỆT id không tồn tại", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 501);
      const b = await layCap(THU.B.phone, 502);
      for (const d of DUONG) {
        expect([d.ten, (await d.goi("khong-co-token", `${NS}hs-a1`)).status]).toEqual([d.ten, 401]);
        expect([d.ten, (await d.goi(a.accessToken, `${NS}hs-a1`)).status]).toEqual([d.ten, 200]); // đối chứng dương
        expect([d.ten, (await d.goi(b.accessToken, `${NS}hs-b1`)).status]).toEqual([d.ten, 200]);
        const cheo = await d.goi(a.accessToken, `${NS}hs-b1`); // A đọc con của B
        const laDay = await d.goi(a.accessToken, `${NS}khong-ton-tai`);
        const cheo2 = await d.goi(b.accessToken, `${NS}hs-a1`); // B đọc con của A
        expect([d.ten, cheo.status, laDay.status, cheo2.status]).toEqual([d.ten, 404, 404, 404]);
        const boRid = (x: unknown) => JSON.stringify(x).replace(/"requestId":"[^"]*"/g, "");
        expect(boRid(await json(cheo))).toBe(boRid(await json(laDay)));
      }
    });

    it("[B4-02] NHẬN XÉT đúng dữ liệu: A1 thấy phiếu của A1, KHÔNG thấy của B1; DTO không có `hocBa` / `baiVe` / `coBaiTap` / `tenCon`", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 503);
      const r = await nhanXetGet(req("/x", undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`));
      const d = (await json(r)).data as { buoi: Array<{ id: string; kieu: string; phieu: { chung: Array<{ text: string }> } | null }> } & Record<string, unknown>;
      const chuoi = JSON.stringify(d);
      expect(chuoi).toContain("nhận xét TEST của A1");
      expect(chuoi).not.toContain("riêng của B1");
      for (const k of ["hocBa", "baiVe", "coBaiTap", "tenCon"]) expect(Object.keys(d)).not.toContain(k);
      const b1 = d.buoi.find((x) => x.id === `${NS}b1`);
      expect(b1?.kieu).toBe("phieu");
      expect(b1?.phieu?.chung.length).toBeGreaterThan(0);
    });

    it("[B4-03] HỌC BẠ: bản tạm tính khi chưa phát hành (`laChinhThuc=false`, `soBuoi.daDienRa` có số, `coMat=null`); không lộ `reportCardId` / đường PDF", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 504);
      const r = await hocBaGet(req("/x", undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`));
      const d = (await json(r)).data as { laChinhThuc: boolean; soBuoi: { coMat: number | null; daDienRa: number | null; tong: number } } & Record<string, unknown>;
      expect(d.laChinhThuc).toBe(false);
      expect(d.soBuoi.coMat).toBeNull();
      expect(typeof d.soBuoi.daDienRa).toBe("number");
      const chuoi = JSON.stringify(d);
      expect(chuoi).not.toMatch(/reportCardId|\/api\/portal\/report-card|\.pdf/i);
    });

    it("[B4-04] CHUYÊN CẦN: số lấy từ hàm nguồn (không tính lại); DTO bỏ `diem`/`baiVe`/`phep`/`xepLoai`/`canhBao`/`nut`; ô buổi có đủ `kieu`", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 505);
      const r = await chuyenCanGet(req("/x", undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`));
      const d = (await json(r)).data as { so: { coMat: number; tiLe: unknown }; hang: Array<{ o: Array<{ kieu: string }> }>; ketLuan: Record<string, unknown> } & Record<string, unknown>;
      expect(typeof d.so.coMat).toBe("number");
      for (const k of ["diem", "baiVe", "phep", "xepLoai", "canhBao", "coBaiTap", "sanPham", "tenCon"]) expect(Object.keys(d)).not.toContain(k);
      expect(Object.keys(d.ketLuan)).not.toContain("nut");
      expect(d.hang.flatMap((h) => h.o).length).toBeGreaterThan(0);
    });

    it("[B4-05] LỊCH THÁNG: `?month=YYYY-MM` trả lưới + buổi trong tháng; tháng sai ⇒ 400; không `month` ⇒ phản hồi CŨ (không có `buoi`/`o`)", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 506);
      const cu = (await json(await lichGet(req("/x", undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`)))).data as Record<string, unknown>;
      expect(Object.keys(cu)).toEqual(expect.arrayContaining(["next", "thisWeek", "upcoming"]));
      expect(Object.keys(cu)).not.toContain("buoi");
      const bay = new Date(Date.now() - 7 * 86_400_000);
      const thang = `${bay.getFullYear()}-${String(bay.getMonth() + 1).padStart(2, "0")}`;
      const m = (await json(await lichGet(req(`/x?month=${thang}`, undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`)))).data as { y: number; m0: number; o: unknown[]; buoi: Array<{ id: string; trangThai: string }> };
      expect(m.y).toBe(bay.getFullYear());
      expect(m.o.length).toBeGreaterThanOrEqual(28);
      expect(m.buoi.some((x) => x.id === `${NS}b1`)).toBe(true);
      for (const xau of ["2026-13", "2026-00", "abc", "2026-1", "99999-01", "1999-12"]) {
        expect([xau, (await lichGet(req(`/x?month=${xau}`, undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`))).status]).toEqual([xau, 400]);
      }
    });

    it("[B4-06] MÚI GIỜ: buổi lúc 00:30 ngày 1 theo GIỜ VN (= 17:30 UTC ngày cuối tháng trước) thuộc THÁNG SAU, không thuộc tháng trước", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 507);
      const id = `${NS}b-bien-gioi`;
      await db.classSession.create({
        data: { id, classId: `${NS}lop`, date: new Date("2031-12-01T00:30:00+07:00"), status: "SCHEDULED", topic: "Buổi ranh giới tháng", centerId: `${NS}cs` } as never,
      });
      try {
        const lay = async (thang: string) => ((await json(await lichGet(req(`/x?month=${thang}`, undefined, auth(a.accessToken)), ctxHs(`${NS}hs-a1`)))).data as { buoi: Array<{ id: string; ngayKey: string }> }).buoi;
        const thang12 = await lay("2031-12");
        const thang11 = await lay("2031-11");
        expect(thang12.find((x) => x.id === id)?.ngayKey).toBe("2031-12-01");
        expect(thang11.some((x) => x.id === id)).toBe(false);
      } finally {
        await db.classSession.delete({ where: { id } });
      }
    });

    it("[B4-07] CHI TIẾT BUỔI: A1 thấy buổi của lớp mình (`coNhanXet=true`); id lạ / buổi của lớp KHÁC / ký tự lạ ⇒ cùng 404; không lộ giờ-phòng-giáo viên của buổi đã qua", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 508);
      const goi = (sid: string) => chiTietBuoiGet(req("/x", undefined, auth(a.accessToken)), { params: Promise.resolve({ studentId: `${NS}hs-a1`, sessionId: sid }) });
      const d = (await json(await goi(`${NS}b1`))).data as { coNhanXet: boolean; daQua: boolean; gio: string | null; phong: string | null; giaoVien: string | null; trangThai: string };
      expect(d.coNhanXet).toBe(true);
      expect(d.daQua).toBe(true);
      expect(d.trangThai).toBe("co-mat");
      expect([d.gio, d.phong, d.giaoVien]).toEqual([null, null, null]);
      for (const sid of ["khong-ton-tai", "b1/../x", "<script>", "a".repeat(100)]) expect([sid, (await goi(sid)).status]).toEqual([sid, 404]);
    });

    it("[B4-08] QUÉT RIÊNG TƯ: phản hồi của cả năm route không chứa email, số điện thoại, CCCD, mật khẩu băm, tokenVersion, URL ảnh", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 509);
      for (const d of DUONG) {
        const chuoi = JSON.stringify((await json(await d.goi(a.accessToken, `${NS}hs-a1`))).data);
        expect([d.ten, /[\w.+-]+@[\w-]+\.[\w.]+/.test(chuoi)]).toEqual([d.ten, false]);
        expect([d.ten, /(?<!\d)(0|84)\d{9}(?!\d)/.test(chuoi)]).toEqual([d.ten, false]);
        expect([d.ten, /nationalId|cccd|password|tokenVersion|bcrypt|\$2[aby]\$|https?:\/\//i.test(chuoi)]).toEqual([d.ten, false]);
      }
    });
  });
  describe("[B4-N4] học phí (CHỈ ĐỌC): số liệu lấy từ hàm kế toán của web, không tính lại", () => {
    const DON = `${NS}don-hp`;
    const goi = (token: string, hs: string) => hocPhiGet(req("/x", undefined, { auth: bearer(token) }), ctxHs(hs));

    async function dungDuLieu() {
      await db.payment.deleteMany({ where: { orderId: DON } });
      await db.order.deleteMany({ where: { id: DON } });
      await db.enrollment.update({ where: { id: `${NS}dk-a1` }, data: { finalPrice: 3_000_000 } });
      await db.order.create({
        data: { id: DON, code: `ORD-B4HP-${Date.now() % 1_000_000}`, type: "COURSE", status: "PENDING_PAYMENT", customerName: "Phụ huynh A (TEST)", customerPhone: "0966100001", centerId: `${NS}cs` } as never,
      });
      const khoan = (id: string, amount: number, accountantStatus: string, extra: Record<string, unknown> = {}) =>
        db.payment.create({
          data: { id: `${NS}${id}`, orderId: DON, enrollmentId: `${NS}dk-a1`, amount, method: "BANK_TRANSFER", paidDate: new Date(Date.now() - 86_400_000), accountantStatus, centerId: `${NS}cs`, ...extra } as never,
        });
      await khoan("pay-ok", 1_000_000, "CONFIRMED", { confirmedAt: new Date() });
      await khoan("pay-cho", 500_000, "PENDING");
      await khoan("pay-tuchoi", 700_000, "REJECTED", { rejectReason: "Sai số tiền (nội bộ — không được lộ)" });
    }
    async function don() {
      await db.payment.deleteMany({ where: { orderId: DON } });
      await db.order.deleteMany({ where: { id: DON } });
      await db.enrollment.update({ where: { id: `${NS}dk-a1` }, data: { finalPrice: null } });
    }

    it("[B4-09] số của API == số của `getStudentBilling` (cùng DB): tổng, đã đóng, còn nợ, từng khoản; khoản bị TỪ CHỐI không vào 'đã đóng' và chỉ được ĐẾM; khoản chờ chỉ được ĐẾM", async () => {
      await dongYQuyDinhChoTatCa();
      await dungDuLieu();
      try {
        const a = await layCap(THU.A.phone, 601);
        const r = await goi(a.accessToken, `${NS}hs-a1`);
        expect(r.status).toBe(200);
        const d = (await json(r)).data as { tomTat: { tongHocPhi: number; daDong: number; conNo: number; dangCho: number; biTuChoi: number; nhanConNo: string }; khoan: Array<{ id: string; hocPhi: number; daDong: number; conNo: number }>; daDong: Array<{ id: string; soTien: number; nhanHinhThuc: string }> };
        const nguon = await getStudentBilling(`${NS}hs-a1`, new Date());
        expect(d.tomTat.tongHocPhi).toBe(nguon.tuition);
        expect(d.tomTat.daDong).toBe(nguon.paid);
        expect(d.tomTat.conNo).toBe(nguon.outstanding);
        expect(d.tomTat.dangCho).toBe(nguon.pendingCount);
        expect(d.tomTat.biTuChoi).toBe(nguon.rejectedCount);
        expect(d.khoan.map((k) => [k.id, k.hocPhi, k.daDong, k.conNo])).toEqual(nguon.rows.map((k) => [k.enrollmentId, k.finalPrice, k.paid, k.outstanding]));
        expect(d.tomTat.tongHocPhi).toBe(3_000_000);
        expect(d.tomTat.biTuChoi).toBe(1);
        expect(d.tomTat.dangCho).toBe(1);
        // khoản TỪ CHỐI (700.000) không nằm trong 'đã đóng' và không lộ số tiền / lý do
        expect(d.tomTat.daDong).toBeLessThan(3_000_000);
        expect(JSON.stringify(d)).not.toMatch(/700000|Sai số tiền|nội bộ/);
        expect(d.daDong.some((x) => x.id === `${NS}pay-tuchoi`)).toBe(false);
        expect(d.tomTat.nhanConNo).toMatch(/₫$/);
        // hình thức thanh toán là NHÃN do `getPaymentMethodLabels` của web giải mã (BANK_TRANSFER ⇒ "Chuyển khoản"), không phải mã thô
        const phieuOk = d.daDong.find((x) => x.id === `${NS}pay-ok`);
        expect(phieuOk?.nhanHinhThuc).toBe("Chuyển khoản");
        expect(JSON.stringify(d)).not.toMatch(/BANK_TRANSFER/);
      } finally {
        await don();
      }
    });

    it("[B4-10] CÁCH LY: gia đình khác / id lạ ⇒ cùng 404; không token ⇒ 401; con CỦA MÌNH ⇒ 200 (đối chứng dương)", async () => {
      await dongYQuyDinhChoTatCa();
      const a = await layCap(THU.A.phone, 602);
      const b = await layCap(THU.B.phone, 603);
      expect((await hocPhiGet(req("/x"), ctxHs(`${NS}hs-a1`))).status).toBe(401);
      expect((await goi(a.accessToken, `${NS}hs-a1`)).status).toBe(200);
      expect((await goi(b.accessToken, `${NS}hs-b1`)).status).toBe(200);
      const boRid = (x: unknown) => JSON.stringify(x).replace(/"requestId":"[^"]*"/g, "");
      const cheo = await goi(a.accessToken, `${NS}hs-b1`);
      const la = await goi(a.accessToken, `${NS}khong-ton-tai`);
      expect([cheo.status, la.status, (await goi(b.accessToken, `${NS}hs-a1`)).status]).toEqual([404, 404, 404]);
      expect(boRid(await json(cheo))).toBe(boRid(await json(la)));
    });

    it("[B4-11] QUÉT RIÊNG TƯ: không lộ mã đơn, id đơn/ghi danh thô của phiếu thu, tên phụ huynh, URL / chứng từ, tài khoản ngân hàng", async () => {
      await dongYQuyDinhChoTatCa();
      await dungDuLieu();
      try {
        const a = await layCap(THU.A.phone, 604);
        const chuoi = JSON.stringify((await json(await goi(a.accessToken, `${NS}hs-a1`))).data);
        expect(chuoi).not.toMatch(/ORD-|orderId|orderCode|receiptCode|evidence|https?:\/\/|Phụ huynh A|iban|stk|số tài khoản/i);
        expect(/[\w.+-]+@[\w-]+\.[\w.]+/.test(chuoi)).toBe(false);
        expect(/(?<!\d)(0|84)\d{9}(?!\d)/.test(chuoi)).toBe(false);
      } finally {
        await don();
      }
    });
  });
  describe("[B4-N5] SataCoin (CHỈ ĐỌC, theo cờ ẩn của chủ dự án)", () => {
    const goi = (token: string, hs: string) => sataCoinGet(req("/x", undefined, { auth: bearer(token) }), ctxHs(hs));
    const BAT = () => {
      process.env.PORTAL_SATACOIN_ENABLED = "true";
    };
    const TAT = () => {
      delete process.env.PORTAL_SATACOIN_ENABLED;
    };
    async function dung() {
      await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
      await db.sataCoinTransaction.createMany({
        data: [
          { id: `${NS}coin-1`, studentId: `${NS}hs-a1`, amount: 50, type: "EARN", reason: "ATTENDANCE", note: "Ghi chú NỘI BỘ của nhân viên — không được lộ", createdById: ids.NV },
          { id: `${NS}coin-2`, studentId: `${NS}hs-a1`, amount: -20, type: "SPEND", reason: "REDEEM_GIFT", createdById: ids.NV },
          { id: `${NS}coin-b`, studentId: `${NS}hs-b1`, amount: 999, type: "EARN", reason: "ATTENDANCE", createdById: ids.NV },
        ] as never,
      });
    }

    it("[B4-12] cờ TẮT (mặc định, chủ dự án ẩn SataCoin) ⇒ 404 cho cả con của mình — không đường nào lộ số dư", async () => {
      TAT();
      await dongYQuyDinhChoTatCa();
      await dung();
      try {
        const a = await layCap(THU.A.phone, 611);
        expect((await goi(a.accessToken, `${NS}hs-a1`)).status).toBe(404);
        expect((await goi(a.accessToken, `${NS}hs-b1`)).status).toBe(404);
      } finally {
        await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
      }
    });

    it("[B4-13] cờ BẬT ⇒ số dư == getBalance (Σ amount, không số giả), lịch sử đủ; KHÔNG lộ ghi chú nhân viên / ruleCode / createdById; con người khác ⇒ 404; không token ⇒ 401", async () => {
      BAT();
      await dongYQuyDinhChoTatCa();
      await dung();
      try {
        const a = await layCap(THU.A.phone, 612);
        const b = await layCap(THU.B.phone, 613);
        expect((await sataCoinGet(req("/x"), ctxHs(`${NS}hs-a1`))).status).toBe(401);
        const r = await goi(a.accessToken, `${NS}hs-a1`);
        expect(r.status).toBe(200);
        const d = (await json(r)).data as { soDu: number; giaoDich: Array<{ id: string; loai: string; soCoin: number }> };
        expect(d.soDu).toBe(await getBalance(`${NS}hs-a1`));
        expect(d.soDu).toBe(30);
        expect(d.giaoDich.map((g) => g.soCoin).sort()).toEqual([-20, 50]);
        const chuoi = JSON.stringify(d);
        expect(chuoi).not.toMatch(/NỘI BỘ|note|ruleCode|createdById|centerId|reversedTxId|999/);
        const boRid = (x: unknown) => JSON.stringify(x).replace(/"requestId":"[^"]*"/g, "");
        const cheo = await goi(a.accessToken, `${NS}hs-b1`);
        const la = await goi(a.accessToken, `${NS}khong-ton-tai`);
        expect([cheo.status, la.status, (await goi(b.accessToken, `${NS}hs-a1`)).status]).toEqual([404, 404, 404]);
        expect(boRid(await json(cheo))).toBe(boRid(await json(la)));
        expect((await goi(b.accessToken, `${NS}hs-b1`)).status).toBe(200); // đối chứng dương
      } finally {
        TAT();
        await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
      }
    });
  });
  describe("[B4.8-YC] Gửi yêu cầu đến trung tâm (6 loại như web)", () => {
    const goi = (tok: string, hs: string) => yeuCauGet(req("/x", undefined, { auth: bearer(tok) }), ctxHs(hs));
    const gui = (tok: string, hs: string, than: unknown) => yeuCauPost(req("/x", than, { auth: bearer(tok) }), ctxHs(hs));
    const huy = (tok: string, hs: string, id: string) => yeuCauHuy(req("/x", {}, { auth: bearer(tok) }), { params: Promise.resolve({ studentId: hs, requestId: id }) });
    const ngayMai = () => {
      const d = new Date(Date.now() + 3 * 86_400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    let tokA = "";
    let tokB = "";
    beforeAll(async () => {
      await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
      await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: NS } } });
      await dongYQuyDinhChoTatCa();
      tokA = (await layCap(THU.A.phone, 801)).accessToken;
      tokB = (await layCap(THU.B.phone, 802)).accessToken;
      // Học viên thật luôn thuộc một cơ sở: gắn A1 vào cơ sở của lớp để «cơ sở hiện tại» có nghĩa (web tra theo `Student.centerId`).
      await db.student.update({ where: { id: `${NS}hs-a1` }, data: { centerId: `${NS}cs` } });
      // Cơ sở thứ hai CÓ LỚP (cơ sở đích của «Chuyển cơ sở»).
      await db.center.create({ data: { id: `${NS}cs2`, name: "Cơ sở TEST 2", slug: `${NS}cs2`, address: "Địa chỉ giả 2" } });
      await db.class.create({
        data: { id: `${NS}lop2`, name: "Lớp TEST 2", classCode: "MTEST.LOP2", courseId: `${NS}kh`, centerId: `${NS}cs2`, status: "ACTIVE", isActive: true, startTime: "20:00", endTime: "21:00" },
      });
      // Dòng cần bù thật của A1 (buổi đã qua b1) + của B1 (đối chứng nhà khác).
      await db.makeupNeed.create({
        data: { id: `${NS}bu-a1`, studentId: `${NS}hs-a1`, classId: `${NS}lop`, courseId: `${NS}kh`, centerId: `${NS}cs`, missedSessionId: `${NS}b1`, status: "PENDING", sourceType: "ABSENCE" },
      });
      await db.makeupNeed.create({
        data: { id: `${NS}bu-b1`, studentId: `${NS}hs-b1`, classId: `${NS}lop`, courseId: `${NS}kh`, centerId: `${NS}cs`, missedSessionId: `${NS}b1`, status: "PENDING", sourceType: "ABSENCE" },
      });
    }, 30_000);
    afterAll(async () => {
      await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
      await db.makeupNeed.deleteMany({ where: { studentId: { startsWith: NS } } });
      await db.student.update({ where: { id: `${NS}hs-a1` }, data: { centerId: null } });
      await db.class.deleteMany({ where: { id: `${NS}lop2` } });
      await db.center.deleteMany({ where: { id: `${NS}cs2` } });
    });

    it("[YCD-01] đọc: 401 khi chưa đăng nhập; đăng nhập ⇒ lựa chọn THẬT của con (buổi sắp tới không gồm buổi đã huỷ/đã qua; buổi cần bù; cơ sở khác có lớp, KHÔNG gồm cơ sở hiện tại); danh sách lý do lấy từ máy chủ", async () => {
      expect((await yeuCauGet(req("/x"), ctxHs(`${NS}hs-a1`))).status).toBe(401);
      const r = await goi(tokA, `${NS}hs-a1`);
      expect(r.status).toBe(200);
      const d = (await json(r)).data as {
        daGui: unknown[];
        tuyChon: { buoiSapToi: Array<{ id: string }>; buoiCanBu: Array<{ id: string; trangThai: string }>; coSoDich: Array<{ id: string; ten: string }>; lyDoNghi: string[]; lyDoBaoLuu: string[]; khungGio: string[]; chuDe: string[]; homNay: string };
      };
      expect(d.daGui).toEqual([]);
      expect(d.tuyChon.buoiSapToi.map((b) => b.id)).toEqual([`${NS}b2`]); // b1 đã qua, b3 đã huỷ
      expect(d.tuyChon.buoiCanBu.map((b) => [b.id, b.trangThai])).toEqual([[`${NS}bu-a1`, "CAN_BU"]]);
      expect(d.tuyChon.coSoDich.map((c) => c.id)).toEqual([`${NS}cs2`]);
      expect(d.tuyChon.lyDoNghi).toContain("Con ốm");
      expect(d.tuyChon.lyDoBaoLuu.length).toBeGreaterThan(0);
      expect(d.tuyChon.khungGio).toContain("Cuối tuần");
      expect(d.tuyChon.chuDe).toContain("Khác");
      expect(d.tuyChon.homNay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("[YCD-02] xin nghỉ: tạo ĐÚNG MỘT đơn ABSENCE chờ xử lý gắn buổi + ngày buổi; nội dung do MÁY CHỦ ghép; gửi lại y hệt ⇒ cùng đơn (trungLap), không đơn thứ hai", async () => {
      const r1 = await gui(tokA, `${NS}hs-a1`, { loai: "nghi", buoiId: `${NS}b2`, lyDo: "Con ốm", ghiChu: "Sốt nhẹ", muonBu: true });
      expect(r1.status).toBe(200);
      const k1 = (await json(r1)).data as { id: string; trungLap: boolean };
      expect(k1.trungLap).toBe(false);
      const dong = await db.parentRequest.findUniqueOrThrow({ where: { id: k1.id } });
      expect([dong.type, dong.status, dong.sessionId, dong.studentId, dong.parentUserId]).toEqual(["ABSENCE", "PENDING", `${NS}b2`, `${NS}hs-a1`, ids.A]);
      expect(dong.content).toBe("Lý do: Con ốm. Ghi chú: Sốt nhẹ Con muốn học bù buổi này.");
      expect(dong.preferredDate).not.toBeNull();
      const r2 = await gui(tokA, `${NS}hs-a1`, { loai: "nghi", buoiId: `${NS}b2`, lyDo: "Con ốm", ghiChu: "Sốt nhẹ", muonBu: true });
      expect((await json(r2)).data).toEqual({ id: k1.id, trungLap: true });
      expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-a1`, type: "ABSENCE" } })).toBe(1);
      const ds = ((await json(await goi(tokA, `${NS}hs-a1`))).data as { daGui: Array<{ id: string; loai: string; nhanLoai: string; hanhDong: { kieu: string } | null; chiTiet: unknown[] }> }).daGui;
      expect(ds.map((x) => [x.id, x.loai, x.nhanLoai, x.hanhDong?.kieu])).toEqual([[k1.id, "nghi", "Báo vắng", "rut"]]);
      expect(ds[0]!.chiTiet.length).toBe(1);
    });

    it("[YCD-03] xin nghỉ bị từ chối: buổi đã huỷ / đã qua / không tồn tại / của lớp con KHÔNG học ⇒ 400, KHÔNG tạo đơn", async () => {
      const truoc = await db.parentRequest.count({ where: { studentId: { startsWith: NS } } });
      for (const buoiId of [`${NS}b3`, `${NS}b1`, `${NS}khong-co`]) {
        const r = await gui(tokA, `${NS}hs-a1`, { loai: "nghi", buoiId });
        expect([r.status, (await json(r)).error?.code]).toEqual([400, "VALIDATION"]);
      }
      // A2 không ghi danh lớp nào ⇒ không báo nghỉ được buổi của lớp A1 (đối chứng: A1 cùng buổi thì được ở YCD-02).
      const a2 = await gui(tokA, `${NS}hs-a2`, { loai: "nghi", buoiId: `${NS}b2` });
      expect(a2.status).toBe(400);
      expect(await db.parentRequest.count({ where: { studentId: { startsWith: NS } } })).toBe(truoc);
    });

    it("[YCD-04] CÁCH LY NHÀ: phụ huynh A gửi / đọc / huỷ cho con của B ⇒ cùng 404 như học viên không tồn tại; đối chứng dương: B làm được với con mình", async () => {
      const boRid = (x: unknown) => JSON.stringify(x).replace(/"requestId":"[^"]*"/g, "");
      const cheoGui = await gui(tokA, `${NS}hs-b1`, { loai: "khac", ghiChu: "Yêu cầu thử của nhà khác" });
      const cheoDoc = await goi(tokA, `${NS}hs-b1`);
      const la = await gui(tokA, `${NS}khong-ton-tai`, { loai: "khac", ghiChu: "Yêu cầu thử của nhà khác" });
      expect([cheoGui.status, cheoDoc.status, la.status]).toEqual([404, 404, 404]);
      expect(boRid(await json(cheoGui))).toBe(boRid(await json(la)));
      expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-b1` } })).toBe(0);
      const b = await gui(tokB, `${NS}hs-b1`, { loai: "khac", chuDe: "Lịch học", ghiChu: "Xin đổi lịch thử nghiệm" });
      expect(b.status).toBe(200);
      const idB = ((await json(b)).data as { id: string }).id;
      const huyCheo = await huy(tokA, `${NS}hs-a1`, idB); // id đơn của B qua endpoint của con A1
      const huyCheo2 = await huy(tokA, `${NS}hs-b1`, idB); // đúng con của B nhưng token A
      expect([huyCheo.status, huyCheo2.status]).toEqual([404, 404]);
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: idB } })).status).toBe("PENDING");
      expect((await huy(tokB, `${NS}hs-b1`, idB)).status).toBe(200); // đối chứng dương
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: idB } })).status).toBe("CANCELLED");
    });

    it("[YCD-04b] CÙNG gia đình, KHÁC con: huỷ đơn của con A1 qua đường dẫn của con A2 ⇒ 404 và đơn GIỮ NGUYÊN (phụ huynh sở hữu cả hai con nhưng endpoint theo MỘT con); qua đúng con thì huỷ được", async () => {
      const don = await db.parentRequest.create({ data: { studentId: `${NS}hs-a1`, parentUserId: ids.A, type: "OTHER", content: "Đơn của con A1 để thử huỷ chéo con", status: "PENDING" } });
      const cheo = await huy(tokA, `${NS}hs-a2`, don.id);
      expect(cheo.status).toBe(404);
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: don.id } })).status).toBe("PENDING");
      expect((await huy(tokA, `${NS}hs-a1`, don.id)).status).toBe(200); // đối chứng dương
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: don.id } })).status).toBe("CANCELLED");
      await db.parentRequest.delete({ where: { id: don.id } });
    });

    it("[YCD-05] xin học bù: đề xuất ngày + GIỜ ba mẹ tự chọn, gắn ĐÚNG dòng cần bù; quá khứ / dòng nhà khác ⇒ từ chối; gửi lần hai cho cùng dòng ⇒ từ chối (đã có đơn mở)", async () => {
      const qua = await gui(tokA, `${NS}hs-a1`, { loai: "hoc-bu", nhuCauBuId: `${NS}bu-a1`, ngay: "2020-01-01", gio: "18:30" });
      expect([qua.status, (await json(qua)).error?.code]).toEqual([400, "VALIDATION"]);
      const dem = await gui(tokA, `${NS}hs-a1`, { loai: "hoc-bu", nhuCauBuId: `${NS}bu-a1`, ngay: ngayMai(), gio: "23:30" });
      expect(dem.status).toBe(400); // giờ giữa đêm
      const khacNha = await gui(tokA, `${NS}hs-a1`, { loai: "hoc-bu", nhuCauBuId: `${NS}bu-b1`, ngay: ngayMai(), gio: "18:30" });
      expect(khacNha.status).toBe(409); // dòng của B1 không khớp con A1 (web: "Buổi cần bù không hợp lệ")
      const ok = await gui(tokA, `${NS}hs-a1`, { loai: "hoc-bu", nhuCauBuId: `${NS}bu-a1`, ngay: ngayMai(), gio: "18:30", ghiChu: "Con rảnh chiều thứ tư" });
      expect(ok.status).toBe(200);
      const dong = await db.parentRequest.findFirstOrThrow({ where: { studentId: `${NS}hs-a1`, type: "MAKEUP" } });
      expect([dong.makeupNeedId, dong.sessionId, dong.status, dong.content]).toEqual([`${NS}bu-a1`, `${NS}b1`, "PENDING", "Con rảnh chiều thứ tư"]);
      expect(dong.preferredDate).not.toBeNull();
      const lai = await gui(tokA, `${NS}hs-a1`, { loai: "hoc-bu", nhuCauBuId: `${NS}bu-a1`, ngay: ngayMai(), gio: "19:00" });
      expect(lai.status).toBe(409);
      expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-a1`, type: "MAKEUP" } })).toBe(1);
      const ds = ((await json(await goi(tokA, `${NS}hs-a1`))).data as { tuyChon: { buoiCanBu: Array<{ id: string; trangThai: string }> } }).tuyChon.buoiCanBu;
      expect(ds.map((b) => [b.id, b.trangThai])).toEqual([[`${NS}bu-a1`, "CHO_XEP"]]); // đã gửi ⇒ «chờ xếp», app không vẽ nút gửi nữa
    });

    it("[YCD-06] bảo lưu · chuyển lớp · chuyển cơ sở · khác: lựa chọn NGOÀI danh sách của web bị từ chối; hợp lệ ⇒ nội dung ghép bằng đúng khuôn của web; cơ sở đích phải là cơ sở có lớp và KHÁC cơ sở hiện tại", async () => {
      const sai: Array<[string, unknown]> = [
        ["lý do bảo lưu lạ", { loai: "bao-luu", lyDo: "Tự nghĩ ra lý do" }],
        ["ngày bảo lưu quá khứ", { loai: "bao-luu", lyDo: "Việc gia đình", ngay: "2020-01-01" }],
        ["chuyển lớp rỗng", { loai: "doi-lop" }],
        ["khung giờ lạ", { loai: "doi-lop", khungGio: ["Nửa đêm"] }],
        ["cơ sở hiện tại", { loai: "doi-co-so", coSoId: `${NS}cs` }],
        ["cơ sở không tồn tại", { loai: "doi-co-so", coSoId: "khong-co" }],
        ["khác quá ngắn", { loai: "khac", ghiChu: "ab" }],
        ["loại lạ", { loai: "xoa-tai-khoan" }],
      ];
      for (const [ten, than] of sai) {
        const r = await gui(tokA, `${NS}hs-a1`, than);
        expect([ten, r.status]).toEqual([ten, 400]);
      }
      expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-a1`, type: { in: ["RESERVE", "TRANSFER_CLASS", "TRANSFER_CENTER", "OTHER"] } } })).toBe(0);
      const cs = await gui(tokA, `${NS}hs-a1`, { loai: "doi-co-so", coSoId: `${NS}cs2`, ghiChu: "Gần nhà hơn" });
      expect(cs.status).toBe(200);
      const dong = await db.parentRequest.findFirstOrThrow({ where: { studentId: `${NS}hs-a1`, type: "TRANSFER_CENTER" } });
      expect(dong.content).toBe("Xin chuyển sang cơ sở Cơ sở TEST 2 (Địa chỉ giả 2). Ghi chú: Gần nhà hơn");
    });

    it("[YCD-07] huỷ: đơn chờ ⇒ CANCELLED; huỷ lại ⇒ 409 (không ghi đè); đơn đã được nhân viên xử lý ⇒ KHÔNG huỷ được (409), trạng thái giữ nguyên", async () => {
      const dong = await db.parentRequest.findFirstOrThrow({ where: { studentId: `${NS}hs-a1`, type: "TRANSFER_CENTER" } });
      expect((await huy(tokA, `${NS}hs-a1`, dong.id)).status).toBe(200);
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: dong.id } })).status).toBe("CANCELLED");
      const lai = await huy(tokA, `${NS}hs-a1`, dong.id);
      expect([lai.status, (await json(lai)).error?.code]).toEqual([409, "VALIDATION"]);
      const daXuLy = await db.parentRequest.create({ data: { studentId: `${NS}hs-a1`, parentUserId: ids.A, type: "OTHER", content: "Đơn đã được xử lý", status: "APPROVED", response: "Đã tiếp nhận" } });
      const r = await huy(tokA, `${NS}hs-a1`, daXuLy.id);
      expect(r.status).toBe(409);
      expect((await db.parentRequest.findUniqueOrThrow({ where: { id: daXuLy.id } })).status).toBe("APPROVED");
      await db.parentRequest.delete({ where: { id: daXuLy.id } });
    });

    it("[YCD-08] trần 10 đơn ĐANG CHỜ của phụ huynh (như web): đủ 10 ⇒ 409 và KHÔNG tạo thêm; huỷ một đơn thì gửi được lại", async () => {
      await db.parentRequest.deleteMany({ where: { parentUserId: ids.A } });
      await db.parentRequest.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({ studentId: `${NS}hs-a1`, parentUserId: ids.A, type: "OTHER" as const, content: `Đơn chờ số ${i}`, status: "PENDING" as const })),
      });
      const r = await gui(tokA, `${NS}hs-a1`, { loai: "khac", ghiChu: "Đơn thứ mười một" });
      expect([r.status, (await json(r)).error?.code]).toEqual([409, "VALIDATION"]);
      expect(await db.parentRequest.count({ where: { parentUserId: ids.A } })).toBe(10);
      await db.parentRequest.updateMany({ where: { parentUserId: ids.A, content: "Đơn chờ số 0" }, data: { status: "CANCELLED" } });
      expect((await gui(tokA, `${NS}hs-a1`, { loai: "khac", ghiChu: "Đơn thứ mười một" })).status).toBe(200); // đối chứng dương: hết chạm trần thì gửi được
      await db.parentRequest.deleteMany({ where: { parentUserId: ids.A } });
    });

    it("[YCD-09] GIỚI HẠN TẦN SUẤT chung với web (5 đơn / 10 phút / phụ huynh; nhà B đã dùng 1 ở YCD-04): đơn thứ sáu ⇒ 429, không tạo đơn", async () => {
      for (let i = 0; i < 4; i++) expect((await gui(tokB, `${NS}hs-b1`, { loai: "khac", ghiChu: `Yêu cầu thử số ${i} của nhà B` })).status).toBe(200);
      const sau = await gui(tokB, `${NS}hs-b1`, { loai: "khac", ghiChu: "Yêu cầu thử số 6 của nhà B" });
      expect([sau.status, (await json(sau)).error?.code]).toEqual([429, "RATE_LIMITED"]);
      expect(await db.parentRequest.count({ where: { parentUserId: ids.B, content: { contains: "số 6" } } })).toBe(0);
    });
  });

  describe("[B4.8-HS/KM/GY] Hồ sơ gia đình · Khuyến mãi · Góp ý (dùng lại nghiệp vụ web)", () => {
    const tai = (tok: string) => ({ headers: {} as Record<string, string>, auth: bearer(tok) });
    const doc = (ham: (r: Request, c?: never) => Promise<Response>, tok: string) => ham(req("/x", undefined, { auth: tai(tok).auth }));
    const docHs = (ham: (r: Request, c: { params: Promise<{ studentId: string }> }) => Promise<Response>, tok: string, hs: string) =>
      ham(req("/x", undefined, { auth: bearer(tok) }), ctxHs(hs));
    let tokA = "";
    let tokB = "";
    const MA_KM = "MTEST-KM-01";
    beforeAll(async () => {
      await dongYQuyDinhChoTatCa();
      tokA = (await layCap(THU.A.phone, 821)).accessToken;
      tokB = (await layCap(THU.B.phone, 822)).accessToken;
      await db.parentFeedback.deleteMany({ where: { parentUserId: { in: [ids.A, ids.B] } } });
      await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: "MTEST-KM" } } });
      const hom = new Date();
      const ngay = (d: number) => new Date(Date.UTC(hom.getUTCFullYear(), hom.getUTCMonth(), hom.getUTCDate() + d));
      await db.promotionPolicy.createMany({
        data: [
          { documentCode: MA_KM, name: "Ưu đãi mùa hè TEST", benefitText: "Giảm 10% học phí", conditionText: "Đóng đủ học phần", validFrom: ngay(-3), validUntil: ngay(20), orgUnitIds: [] },
          { documentCode: "MTEST-KM-HET", name: "Chương trình đã hết hạn", benefitText: "Giảm 50%", validFrom: ngay(-30), validUntil: ngay(-5), orgUnitIds: [] },
          { documentCode: "MTEST-KM-THUHOI", name: "Chương trình đã thu hồi", benefitText: "Giảm 30%", validFrom: ngay(-3), validUntil: ngay(20), orgUnitIds: [], revokedAt: new Date(Date.now() - 86_400_000) },
        ] as never,
      });
    }, 30_000);
    afterAll(async () => {
      await db.parentFeedback.deleteMany({ where: { parentUserId: { in: [ids.A, ids.B] } } });
      await db.promotionPolicy.deleteMany({ where: { documentCode: { startsWith: "MTEST-KM" } } });
    });

    it("[HS-01] hồ sơ: 401 khi chưa đăng nhập; đăng nhập ⇒ CHỈ dữ liệu của chính gia đình; KHÔNG có ảnh đại diện / mã nội bộ; nhà khác không lẫn vào", async () => {
      expect((await hoSoGet(req("/x"))).status).toBe(401);
      const a = await doc(hoSoGet as never, tokA);
      expect(a.status).toBe(200);
      const d = (await json(a)).data as { ten: string; con: Array<{ id: string; ten: string; dongYHinhAnh: boolean }>; maGiaDinh: string };
      expect(d.con.map((c) => c.id).sort()).toEqual([`${NS}hs-a1`, `${NS}hs-a2`]);
      expect(d.maGiaDinh).toMatch(/^SATAFAM-\d{4}$/);
      const chuoi = JSON.stringify(d);
      expect(chuoi).not.toMatch(/avatar|centerId|parentUserId|password|NS_B1|Binh B1/i);
      const b = (await json(await doc(hoSoGet as never, tokB))).data as { con: Array<{ id: string }> };
      expect(b.con.map((c) => c.id)).toEqual([`${NS}hs-b1`]); // đối chứng dương: B thấy con mình, không thấy con A
    });

    it("[HS-02] hồ sơ: trạng thái đồng ý hình ảnh của con phản ánh dữ liệu thật (có / chưa)", async () => {
      const truoc = (await json(await doc(hoSoGet as never, tokA))).data as { con: Array<{ id: string; dongYHinhAnh: boolean }> };
      expect(truoc.con.find((c) => c.id === `${NS}hs-a1`)!.dongYHinhAnh).toBe(false);
      await db.studentConsent.create({ data: { studentId: `${NS}hs-a1`, type: "CLASS_MEDIA", status: "GRANTED" } as never });
      try {
        const sau = (await json(await doc(hoSoGet as never, tokA))).data as { con: Array<{ id: string; dongYHinhAnh: boolean }> };
        expect(sau.con.find((c) => c.id === `${NS}hs-a1`)!.dongYHinhAnh).toBe(true);
        expect(sau.con.find((c) => c.id === `${NS}hs-a2`)!.dongYHinhAnh).toBe(false);
      } finally {
        await db.studentConsent.deleteMany({ where: { studentId: { startsWith: NS } } });
      }
    });

    it("[KM-01] khuyến mãi: chỉ chương trình ĐANG HIỆU LỰC (không hết hạn, không thu hồi); KHÔNG lộ mã văn bản nội bộ / tệp / mã giảm giá; nhà khác ⇒ 404", async () => {
      const r = await docHs(khuyenMaiGet as never, tokA, `${NS}hs-a1`);
      expect(r.status).toBe(200);
      const d = (await json(r)).data as { chuongTrinh: Array<{ id: string; ten: string; loiIch: string; dieuKien: string | null; hetHan: string }> };
      expect(d.chuongTrinh.map((k) => k.ten)).toEqual(["Ưu đãi mùa hè TEST"]);
      expect(d.chuongTrinh[0]!.dieuKien).toBe("Đóng đủ học phần");
      expect(JSON.stringify(d)).not.toMatch(/MTEST-KM|documentCode|fileKey|fileUrl|revoked|voucher/i);
      expect((await docHs(khuyenMaiGet as never, tokA, `${NS}hs-b1`)).status).toBe(404);
      expect((await docHs(khuyenMaiGet as never, tokB, `${NS}hs-b1`)).status).toBe(200); // đối chứng dương
    });

    it("[GY-01] góp ý: gửi 1–5 sao + chủ đề + nội dung ⇒ lưu đúng khuôn của web (có tên phụ huynh + con, KHÔNG ẩn danh); hiện ở danh sách đã gửi; gửi lại y hệt ⇒ không nhân đôi", async () => {
      const gui = (tok: string, hs: string, than: unknown) => gopYPost(req("/x", than, { auth: bearer(tok) }), ctxHs(hs));
      const ok = await gui(tokA, `${NS}hs-a1`, { sao: 4, chuDe: "Cơ sở vật chất", noiDung: "Phòng học hơi nóng vào buổi chiều" });
      expect(ok.status).toBe(200);
      const k = (await json(ok)).data as { id: string; trungLap: boolean };
      expect(k.trungLap).toBe(false);
      const dong = await db.parentFeedback.findUniqueOrThrow({ where: { id: k.id } });
      expect([dong.parentUserId, dong.studentId, dong.rating, dong.content]).toEqual([ids.A, `${NS}hs-a1`, 4, "[Cơ sở vật chất] Phòng học hơi nóng vào buổi chiều"]);
      expect(dong.parentName).toBeTruthy();
      expect(dong.studentName).toBe(`${NS}An A1`);
      const lai = await gui(tokA, `${NS}hs-a1`, { sao: 4, chuDe: "Cơ sở vật chất", noiDung: "Phòng học hơi nóng vào buổi chiều" });
      expect((await json(lai)).data).toEqual({ id: k.id, trungLap: true });
      expect(await db.parentFeedback.count({ where: { parentUserId: ids.A } })).toBe(1);
      await db.parentFeedback.update({ where: { id: k.id }, data: { adminResponse: "Trung tâm đã lắp thêm quạt", respondedAt: new Date() } });
      const ds = (await json(await docHs(gopYGet as never, tokA, `${NS}hs-a1`))).data as { chuDe: string[]; daGui: Array<{ id: string; sao: number; traLoi: string | null }> };
      expect(ds.daGui.map((g) => [g.id, g.sao, g.traLoi])).toEqual([[k.id, 4, "Trung tâm đã lắp thêm quạt"]]);
      expect(ds.chuDe).toContain("Học phí");
      // Nhà B không thấy góp ý của nhà A.
      expect(((await json(await docHs(gopYGet as never, tokB, `${NS}hs-b1`))).data as { daGui: unknown[] }).daGui).toEqual([]);
    });

    it("[GY-02] góp ý: sao ngoài 1–5 · chủ đề lạ · nội dung quá ngắn ⇒ 400; con của nhà khác ⇒ 404; không tạo bản ghi", async () => {
      const gui = (tok: string, hs: string, than: unknown) => gopYPost(req("/x", than, { auth: bearer(tok) }), ctxHs(hs));
      await db.parentFeedback.deleteMany({ where: { parentUserId: ids.A } });
      for (const than of [
        { sao: 0, chuDe: "Học phí", noiDung: "Học phí hơi cao" },
        { sao: 6, chuDe: "Học phí", noiDung: "Học phí hơi cao" },
        { sao: 3, chuDe: "Chủ đề tự nghĩ ra", noiDung: "Học phí hơi cao" },
        { sao: 3, chuDe: "Học phí", noiDung: "ab" },
      ]) expect((await gui(tokA, `${NS}hs-a1`, than)).status).toBe(400);
      expect((await gui(tokA, `${NS}hs-b1`, { sao: 3, chuDe: "Học phí", noiDung: "Học phí hơi cao" })).status).toBe(404);
      expect(await db.parentFeedback.count({ where: { parentUserId: { in: [ids.A, ids.B] } } })).toBe(0);
    });
  });

  describe("[B4-N7] đồng ý Quy định: IDEMPOTENT cả khi hai yêu cầu chồng nhau", () => {
    it("[B4-14] 8 yêu cầu ĐỒNG THỜI của cùng phụ huynh (app hết thời gian chờ rồi bấm lại) ⇒ cả 8 trả 200, đúng MỘT dòng mốc; không 500 do vi phạm khoá duy nhất", async () => {
      for (let vong = 0; vong < 3; vong++) {
        await db.sitePolicyAcceptance.deleteMany({ where: { userId: ids.A } });
        const a = await layCap(THU.A.phone, 700 + vong);
        const kq = await Promise.all(Array.from({ length: 8 }, () => quyDinhDongY(req("/x", {}, { auth: bearer(a.accessToken) }))));
        expect(kq.map((r) => r.status)).toEqual(Array(8).fill(200));
        expect(await db.sitePolicyAcceptance.count({ where: { userId: ids.A } })).toBe(1);
      }
      await dongYQuyDinhChoTatCa();
    });
  });
});
