import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// API di động KHÔNG dùng phiên web (xem xac-thuc.spec.ts): chặn `@/lib/auth` để mọi đường lỡ gọi `auth()` thật sẽ đỏ.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { POST as dangNhapRoute } from "@/app/api/mobile/v1/auth/login/route";
import { POST as quyDinhDongY } from "@/app/api/mobile/v1/parent/policy/accept/route";
import { GET as chinhSachBaoLuuGet } from "@/app/api/mobile/v1/students/[studentId]/policies/reserve/route";
import { GET as yeuCauGet, POST as yeuCauPost } from "@/app/api/mobile/v1/students/[studentId]/requests/route";
import { db } from "@/lib/db";
import { getSettingDef } from "@/lib/settings/registry";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * [D01] Yêu cầu chuyển lớp · chuyển cơ sở · bảo lưu (chủ dự án chốt 19/11/2026) trên POSTGRES THẬT, gọi thẳng route handler.
 *   [D01-DB-01] chuyển lớp có cấu trúc: nhiều ngày + khung giờ + ngày bắt đầu + ghi chú ⇒ ĐÚNG MỘT yêu cầu PENDING, nội dung + `preferredDate` đúng; GHI DANH / LỚP của con KHÔNG đổi
 *   [D01-DB-02] chuyển cơ sở có cấu trúc ⇒ yêu cầu chờ duyệt; cơ sở của con KHÔNG đổi, lịch sử cơ sở không thêm dòng
 *   [D01-DB-03] từ chối ở máy chủ (400, KHÔNG tạo yêu cầu): ngày «Thứ Hai», ngày lặp, ngày bắt đầu quá khứ, ngày không có thật; đọc lại thấy `ngayTrongTuan` = Thứ Ba…Chủ nhật và chi tiết «Muốn chuyển từ ngày»
 *   [D01-DB-04] chính sách bảo lưu: giá trị = ĐÚNG cấu hình của web (mặc định registry khi chưa lưu dòng nào); khoá `allowPause=false` ⇒ cảnh báo THEO KHOÁ, nhưng yêu cầu bảo lưu VẪN gửi được (như trang phụ huynh web)
 *   [D01-DB-05] chính sách: chưa đăng nhập ⇒ 401; học viên nhà khác ⇒ 404
 * File spec riêng ⇒ bộ đếm rate-limit trong bộ nhớ riêng (không chung với xac-thuc.spec.ts).
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "mobile_b1_nhap" || TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "d01test-";
const MAT_KHAU = "Mat-khau-test-2026";
const PHONE = { A: "0966200001", B: "0966200002" };
let dem = 0;
const ipMoi = () => `10.88.0.${(++dem % 250) + 1}`;
const req = (url: string, body?: unknown, auth?: string) =>
  new Request(`http://localhost${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ipMoi(), ...(auth ? { authorization: auth } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async (r: Response) => (await r.json()) as { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
const ctx = (id: string) => ({ params: Promise.resolve({ studentId: id }) });
const ymd = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000 + 7 * 3_600_000); // giờ VN
  return d.toISOString().slice(0, 10);
};
const ids: Record<string, string> = {};

async function dangNhap(phone: string, n: number) {
  const r = await dangNhapRoute(
    req("/api/mobile/v1/auth/login", { dinhDanh: phone, matKhau: MAT_KHAU, thietBi: { maThietBi: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, nenTang: "android", tenMay: "Pixel", phienBanApp: "1.0.0" } }),
  );
  const b = await json(r);
  if (r.status !== 200) throw new Error(`đăng nhập thất bại ${r.status} ${JSON.stringify(b)}`);
  return (b.data as { accessToken: string }).accessToken;
}

async function don() {
  const users = await db.user.findMany({ where: { email: { startsWith: NS } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  await db.parentRequest.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.mobileSession.deleteMany({ where: { userId: { in: uids } } });
  await db.sitePolicyAcceptance.deleteMany({ where: { userId: { in: uids } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: NS } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.class.deleteMany({ where: { id: { startsWith: NS } } });
  await db.course.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
  await db.user.deleteMany({ where: { id: { in: uids } } });
  await db.authAttemptCounter.deleteMany({});
}

describe.skipIf(!RUN)("[D01] chuyển lớp · chuyển cơ sở · bảo lưu — Postgres thật", () => {
  let tokA = "";
  let tokB = "";
  beforeAll(async () => {
    process.env.MOBILE_API_ENABLED = "true";
    delete process.env.LOGIN_RATELIMIT_DISABLED;
    await don();
    const hash = await bcrypt.hash(MAT_KHAU, 4);
    for (const k of ["A", "B"] as const) {
      const u = await db.user.create({ data: { email: `${NS}${k}@seed.invalid`, name: `${NS}${k}`, phone: `84${PHONE[k].slice(1)}`, password: hash, role: "PARENT", roles: ["PARENT"] } as never, select: { id: true } });
      ids[k] = u.id;
    }
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở D01-1", slug: `${NS}cs1`, address: "Địa chỉ 1" } });
    await db.center.create({ data: { id: `${NS}cs2`, name: "Cơ sở D01-2", slug: `${NS}cs2`, address: "Địa chỉ 2" } });
    await db.course.create({ data: { id: `${NS}kh-ok`, name: "Khoá cho bảo lưu", slug: `${NS}kh-ok`, totalSessions: 12 } });
    await db.course.create({ data: { id: `${NS}kh-tat`, name: "Khoá KHÔNG bảo lưu", slug: `${NS}kh-tat`, totalSessions: 12, allowPause: false } as never });
    for (const [c, kh, cs] of [["l1", "kh-ok", "cs1"], ["l2", "kh-ok", "cs2"], ["l3", "kh-tat", "cs1"]] as const) {
      await db.class.create({ data: { id: `${NS}${c}`, name: `Lớp ${c}`, classCode: `D01.${c}`, courseId: `${NS}${kh}`, centerId: `${NS}${cs}`, status: "ACTIVE", isActive: true, startTime: "18:00", endTime: "19:00" } });
    }
    await db.student.create({ data: { id: `${NS}hs-a`, name: `${NS}An`, parentUserId: ids.A, centerId: `${NS}cs1` } as never });
    await db.student.create({ data: { id: `${NS}hs-a2`, name: `${NS}An2`, parentUserId: ids.A, centerId: `${NS}cs1` } as never });
    await db.student.create({ data: { id: `${NS}hs-b`, name: `${NS}Binh`, parentUserId: ids.B } as never });
    await db.enrollment.create({ data: { id: `${NS}dk-a`, studentId: `${NS}hs-a`, classId: `${NS}l1`, courseId: `${NS}kh-ok`, status: "ACTIVE", centerId: `${NS}cs1` } });
    await db.enrollment.create({ data: { id: `${NS}dk-a2`, studentId: `${NS}hs-a2`, classId: `${NS}l3`, courseId: `${NS}kh-tat`, status: "ACTIVE", centerId: `${NS}cs1` } });
    tokA = await dangNhap(PHONE.A, 1);
    tokB = await dangNhap(PHONE.B, 2);
    for (const t of [tokA, tokB]) await quyDinhDongY(req("/x", {}, `Bearer ${t}`));
  }, 60_000);
  afterAll(don);

  const gui = (tok: string, hs: string, than: unknown) => yeuCauPost(req("/x", than, `Bearer ${tok}`), ctx(hs));

  it("[D01-DB-01] chuyển lớp có cấu trúc ⇒ MỘT yêu cầu chờ duyệt; lớp / ghi danh của con KHÔNG đổi", async () => {
    const truoc = await db.enrollment.findUniqueOrThrow({ where: { id: `${NS}dk-a` }, select: { classId: true, status: true } });
    const tu = ymd(5);
    const r = await gui(tokA, `${NS}hs-a`, { loai: "doi-lop", ngayMongMuon: ["Thứ Tư", "Thứ Sáu"], khungGio: ["Chiều"], tuNgay: tu, ghiChu: "Con có lớp năng khiếu" });
    expect(r.status).toBe(200);
    const dong = await db.parentRequest.findMany({ where: { studentId: `${NS}hs-a`, type: "TRANSFER_CLASS" } });
    expect(dong).toHaveLength(1);
    expect(dong[0]!.status).toBe("PENDING");
    expect(dong[0]!.content).toBe(`Xin chuyển lớp. Ngày mong muốn: Thứ Tư, Thứ Sáu. Khung giờ mong muốn: Chiều. Muốn chuyển từ ngày ${tu.split("-").reverse().join("/")}. Ghi chú: Con có lớp năng khiếu`);
    expect(dong[0]!.preferredDate?.toISOString()).toBe(new Date(`${tu}T00:00:00+07:00`).toISOString());
    const sau = await db.enrollment.findUniqueOrThrow({ where: { id: `${NS}dk-a` }, select: { classId: true, status: true } });
    expect(sau).toEqual(truoc); // chỉ TẠO YÊU CẦU, không đổi lớp
  });

  it("[D01-DB-02] chuyển cơ sở có cấu trúc ⇒ yêu cầu chờ duyệt; cơ sở của con KHÔNG đổi", async () => {
    const lichSuTruoc = await db.studentCenterHistory.count({ where: { studentId: `${NS}hs-a` } });
    const r = await gui(tokA, `${NS}hs-a`, { loai: "doi-co-so", coSoId: `${NS}cs2`, ngayMongMuon: ["Thứ Sáu", "Chủ nhật"], khungGio: ["Sáng"], tuNgay: ymd(10), ghiChu: "Gần nhà hơn" });
    expect(r.status).toBe(200);
    const dong = await db.parentRequest.findFirstOrThrow({ where: { studentId: `${NS}hs-a`, type: "TRANSFER_CENTER" } });
    expect(dong.status).toBe("PENDING");
    expect(dong.content).toContain("Xin chuyển sang cơ sở Cơ sở D01-2 (Địa chỉ 2). Ngày học mong muốn ở cơ sở mới: Thứ Sáu, Chủ nhật. Khung giờ mong muốn: Sáng. Muốn chuyển từ ngày");
    expect(dong.content).toContain("Ghi chú: Gần nhà hơn");
    expect(dong.preferredDate).not.toBeNull();
    expect((await db.student.findUniqueOrThrow({ where: { id: `${NS}hs-a` }, select: { centerId: true } })).centerId).toBe(`${NS}cs1`);
    expect(await db.studentCenterHistory.count({ where: { studentId: `${NS}hs-a` } })).toBe(lichSuTruoc);
  });

  it("[D01-DB-03] máy chủ từ chối (400, không tạo yêu cầu) + đọc lại: danh sách ngày Thứ Ba…Chủ nhật, chi tiết «Muốn chuyển từ ngày»", async () => {
    const dem0 = await db.parentRequest.count({ where: { studentId: `${NS}hs-a` } });
    const sai: Array<[string, unknown]> = [
      ["Thứ Hai (trung tâm nghỉ)", { loai: "doi-lop", ngayMongMuon: ["Thứ Hai"] }],
      ["ngày lặp", { loai: "doi-lop", ngayMongMuon: ["Thứ Ba", "Thứ Ba"] }],
      ["ngày bắt đầu quá khứ", { loai: "doi-lop", khungGio: ["Sáng"], tuNgay: "2020-01-01" }],
      ["ngày không có thật", { loai: "doi-lop", khungGio: ["Sáng"], tuNgay: "2099-13-45" }],
      ["chuyển cơ sở ngày quá khứ", { loai: "doi-co-so", coSoId: `${NS}cs2`, tuNgay: "2020-01-01" }],
      ["chuyển lớp rỗng", { loai: "doi-lop" }],
    ];
    for (const [ten, than] of sai) expect([ten, (await gui(tokA, `${NS}hs-a`, than)).status]).toEqual([ten, 400]);
    expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-a` } })).toBe(dem0);

    const doc = await yeuCauGet(req("/x", undefined, `Bearer ${tokA}`), ctx(`${NS}hs-a`));
    const d = (await json(doc)).data as { daGui: Array<{ loai: string; chiTiet: Array<{ nhan: string; giaTri: string }> }>; tuyChon: { ngayTrongTuan: string[] } };
    expect(d.tuyChon.ngayTrongTuan).toEqual(["Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"]);
    const lop = d.daGui.find((x) => x.loai === "doi-lop")!;
    expect(lop.chiTiet.map((c) => c.nhan)).toContain("Muốn chuyển từ ngày");
  });

  it("[D01-DB-04] chính sách bảo lưu = cấu hình web; khoá KHÔNG bảo lưu ⇒ cảnh báo theo khoá nhưng vẫn gửi được yêu cầu", async () => {
    const r = await chinhSachBaoLuuGet(req("/x", undefined, `Bearer ${tokA}`), ctx(`${NS}hs-a2`));
    expect(r.status).toBe(200);
    const d = (await json(r)).data as {
      coSoDangBat: boolean; toiDaThang: number; giaHan: { soLanToiDa: number; moiLanToiDaThang: number }; soLanBaoLuuToiDaMoiGhiDanh: number;
      lungNgayToiDaBuoi: number; nganNhatNgay: number; omDauPhaiCoMinhChungTrenNgay: number; congNoQuaHanChanDuyetNgay: number;
      khoaDangHoc: Array<{ tenKhoa: string; choPhepBaoLuu: boolean }>; canhBao: string[];
    };
    const mac = (k: string) => (getSettingDef(k as never) as { default: unknown }).default;
    // Chưa ai lưu dòng cấu hình nào ở DB cô lập ⇒ giá trị = MẶC ĐỊNH của registry web (không phải số gõ cứng trong app).
    expect(d.toiDaThang).toBe(mac("enrollment.suspendMaxMonths"));
    expect(d.giaHan).toEqual({ soLanToiDa: mac("pause.extendTimes"), moiLanToiDaThang: mac("pause.extendMaxMonths") });
    expect(d.soLanBaoLuuToiDaMoiGhiDanh).toBe(mac("pause.maxPerEnrollment"));
    expect(d.lungNgayToiDaBuoi).toBe(mac("pause.backdateMaxSessions"));
    expect(d.nganNhatNgay).toBe(mac("pause.minDays"));
    expect(d.omDauPhaiCoMinhChungTrenNgay).toBe(mac("pause.medicalProofDays"));
    expect(d.congNoQuaHanChanDuyetNgay).toBe(mac("pause.maxOverdueDebtDays"));
    expect(d.coSoDangBat).toBe(mac("pause.enabled"));
    expect(d.khoaDangHoc).toEqual([{ khoaId: `${NS}kh-tat`, tenKhoa: "Khoá KHÔNG bảo lưu", choPhepBaoLuu: false }]);
    expect(d.canhBao.some((c) => c.includes("Khoá KHÔNG bảo lưu"))).toBe(true);
    // Đối chứng dương: con học khoá CÓ bảo lưu thì không có cảnh báo theo khoá.
    const ok = (await json(await chinhSachBaoLuuGet(req("/x", undefined, `Bearer ${tokA}`), ctx(`${NS}hs-a`)))).data as { canhBao: string[]; khoaDangHoc: Array<{ choPhepBaoLuu: boolean }> };
    expect(ok.khoaDangHoc.every((k) => k.choPhepBaoLuu)).toBe(true);
    expect(ok.canhBao.some((c) => c.includes("không áp dụng bảo lưu"))).toBe(false);
    // KHÔNG chặn gửi: web chỉ tạo bản ghi yêu cầu, nhân sự quyết khi lập hồ sơ.
    const gs = await gui(tokA, `${NS}hs-a2`, { loai: "bao-luu", lyDo: "Việc gia đình", ngay: ymd(7) });
    expect(gs.status).toBe(200);
    expect(await db.parentRequest.count({ where: { studentId: `${NS}hs-a2`, type: "RESERVE", status: "PENDING" } })).toBe(1);
    // Ngày không có thật ở đường bảo lưu cũng bị từ chối (sửa lỗi `parseVnYmd` tràn ngày).
    expect((await gui(tokA, `${NS}hs-a2`, { loai: "bao-luu", lyDo: "Việc gia đình", ngay: "2099-13-45" })).status).toBe(400);
  });

  it("[D01-DB-05] chính sách bảo lưu: chưa đăng nhập ⇒ 401; học viên nhà khác ⇒ 404 (đối chứng: nhà đó đọc được)", async () => {
    expect((await chinhSachBaoLuuGet(req("/x"), ctx(`${NS}hs-a`))).status).toBe(401);
    expect((await chinhSachBaoLuuGet(req("/x", undefined, `Bearer ${tokB}`), ctx(`${NS}hs-a`))).status).toBe(404);
    expect((await chinhSachBaoLuuGet(req("/x", undefined, `Bearer ${tokB}`), ctx(`${NS}hs-b`))).status).toBe(200);
  });
});
