// @vitest-environment node
/**
 * [ADT-DB-*] — ĐỐI TÁC · LOẠI · NHÃN của tab Affiliate trên Postgres THẬT (`lib/affiliate/ghi-doi-tac.ts`, `ghi-loai-nhan.ts`, `doc-doi-tac.ts`; AFF-P0b). Mọi dòng do test TẠO mang tiền tố `FXADT` / `fxadt`.
 *
 *   [ADT-DB-01] tạo: loại cần duyệt ⇒ PENDING (isActive=false), loại không cần duyệt ⇒ ACTIVE (isActive=true); mã chuẩn hoá; nhãn; audit AFFILIATE_TAO CÙNG giao dịch
 *   [ADT-DB-02] quan hệ tổ chức: câu tiếng Việt TRƯỚC khi CHECK nổ; và CHECK của migration CHẶN THẬT khi đi vòng qua tầng ứng dụng bằng SQL
 *   [ADT-DB-03] mã trùng: kiểm trước + ĐUA tạo cùng mã ⇒ đúng một bên thắng, bên kia «đã có» (không 500), đúng 1 dòng + 1 audit; [03b] ĐUA XÁC ĐỊNH (giao dịch giữ mã chưa commit) ⇒ vỡ khoá duy nhất vẫn dịch ra «mã đã có»
 *   [ADT-DB-04] loại / nhãn / cơ sở: ngừng hoặc không tồn tại ⇒ từ chối khi TẠO lẫn khi SỬA đổi sang, DB không đổi; đối chứng dương: đang dùng ⇒ qua
 *   [ADT-DB-05] một nhân viên – một đối tác chưa kết thúc: từ chối nêu tên; ĐUA hai lượt cùng nhân viên ⇒ đúng một thắng; nhân viên nghỉ việc bị chặn; đối tác ENDED giải phóng nhân viên
 *   [ADT-DB-06] cha/con: con thuộc tổ chức được; cha là cá nhân / tổ chức đã kết thúc bị chặn; tổ chức còn thành viên không đổi thành cá nhân
 *   [ADT-DB-07] sửa: audit đúng cũ→mới; SĐT/email/ghi chú KHÔNG chép giá trị vào nhật ký; không đổi gì ⇒ không audit, mốc giữ nguyên
 *   [ADT-DB-08] khoá lạc quan: mốc cũ ⇒ «vừa được người khác thay đổi», DB + audit không đổi; sửa CHỈ NHÃN cũng làm mốc nhích
 *   [ADT-DB-09] mã `?ref=` KHOÁ khi đã có lead (Lead.affiliateId HOẶC LeadAttribution), kể cả lead ở cơ sở khác; chưa có lead thì đổi được, đòi lý do khi đã rời nháp
 *   [ADT-DB-10] isActive ≡ (status = ACTIVE) ở MỌI bước chuyển; duyệt ghi approvedBy/At; `resolveAffiliateByCode` (đường cũ) chỉ thấy ACTIVE
 *   [ADT-DB-11] bảng chuyển trạng thái bị cưỡng chế ở máy chủ: ENDED cuối, thiếu lý do, bước không có trong bảng, DRAFT→ACTIVE theo loại; từ chối ⇒ DB + audit không đổi
 *   [ADT-DB-12] kết thúc KHÔNG xoá lead / attribution; đối tác ENDED không sửa được
 *   [ADT-DB-13] loại: mã bất biến, trùng mã (kể cả đua), nguồn mặc định ACTIVE ∧ selectable, khoá lạc quan, ngừng đòi lý do + KHÔNG đụng đối tác cũ; đối tác MỚI không chọn được loại đã ngừng
 *   [ADT-DB-14] nhãn: tạo / sửa / ngừng / bật lại; mã bất biến; ngừng đòi lý do; đối tác cũ giữ nhãn đã ngừng khi sửa tên
 *   [ADT-DB-15] CHECK `*_code_chk` của loại / nhãn chặn thật bằng SQL trực tiếp
 *   [ADT-DB-16] CÁCH LY: số lead đếm qua scopedDb — QLCS CS1 không đếm lead CS2; Hội sở đếm đủ (đối chứng dương); `phamViLead` nói đúng
 *   [ADT-DB-17] PII: người chỉ xem nhận SĐT/email đã che + ghi chú/tỉ lệ null + không tìm được theo SĐT; người quản lý nhận nguyên (đối chứng dương)
 *   [ADT-DB-18] đọc: lọc trạng thái / loại / từ khoá, ký tự đại diện LIKE không khớp mọi dòng, phân trang, đếm theo trạng thái, chương trình đang hoạt động, đếm hàng chờ duyệt
 *   [ADT-DB-19] đọc loại / nhãn: số đối tác + số quy tắc campaign + phân trang; nguồn chọn được làm mặc định
 *   [ADT-DB-20] page.tsx dựng bằng dữ liệu thật: nút ghi theo quyền, HTML gửi trình duyệt KHÔNG chứa liên hệ thật của người chỉ xem, lead theo tầm nhìn, thiếu quyền, kẹp trang, bộ lọc rác
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng fixture, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày TUYỆT ĐỐI; `Date.now()` chỉ để tạo hậu tố mã duy nhất, không bao giờ để so sánh.
 * AN TOÀN DB: không `resetDb()` — dọn THEO TIỀN TỐ. Cổng địa chỉ riêng (`assertDbThu`): Postgres trên máy này, không phải tunnel VPS, không phải DB của dev server.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

// [ADT-DB-20] dựng CHÍNH page.tsx bằng dữ liệu Postgres thật: cổng vào (vaoTab) và hàng chờ của khung được thay bằng bản giả có kiểm soát, còn lại — hàm đọc, scopedDb, che PII, các component — chạy thật.
const TRANG = vi.hoisted(() => ({ vaoTab: vi.fn() }));
vi.mock("../../app/(admin)/admin/nguon-hoa-hong/_lib/vao-tab", () => ({ vaoTab: (...a: unknown[]) => TRANG.vaoTab(...a) }));
vi.mock("@/lib/nguon-hoa-hong/hang-cho", () => ({ docSoHangChoTheoTab: async () => ({}) }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => {
    throw new Error(`REDIRECT:${u}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => React.createElement("a", { href, ...rest }, children),
}));

import AffiliatePage from "../../app/(admin)/admin/nguon-hoa-hong/affiliate/page";
import type { Actor } from "../../lib/auth/actor";
import { dungNguonHoaHongScope, type ModuleKey } from "../../lib/nguon-hoa-hong/scope";
import { db } from "../../lib/db";
import { laDbCucBo } from "../../lib/security/url-db-cuc-bo";
import { LY_DO_BO_QUA, RUN_DB_TESTS } from "../_helpers/db-gate";
import { resolveAffiliateByCode } from "../../lib/affiliate";
import { KICH_THUOC_TRANG_AFFILIATE, demDoiTacChoDuyet, docCacLoaiChoLoc, docDanhSachDoiTac, docDanhSachLoai, docDanhSachNhan, docNguonChoLoai, timDoiTacDaCoLead } from "../../lib/affiliate/doc-doi-tac";
import { doiTrangThaiDoiTac, suaDoiTac, taoDoiTac } from "../../lib/affiliate/ghi-doi-tac";
import { batTatLoai, batTatNhan, suaLoai, suaNhan, taoLoai, taoNhan } from "../../lib/affiliate/ghi-loai-nhan";

if (!RUN_DB_TESTS) console.warn(`[ADT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fxadt";
const MA = "FXADT";
const NGUOI = { userId: "fxadt-nguoi-ghi", ten: "fxadt Admin fixture" };
const NOW = new Date("2026-10-13T03:00:00.000Z");
const LY_DO = "Chủ dự án chốt ngày 12/10/2026";

let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

/** Cổng địa chỉ riêng của bộ này: KHÔNG dùng `assertTestDb()` (chỉ nhận `satarobo_test`/`ci_test`) vì bộ không reset gì — nhưng vẫn không được chạy vào DB đang phục vụ người xem. */
async function assertDbThu(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!laDbCucBo(url)) throw new Error("[ADT-DB] TỪ CHỐI: DATABASE_URL không trỏ Postgres cục bộ (hoặc là tunnel VPS).");
  const r = await db.$queryRaw<{ ten: string }[]>`select current_database() as ten`;
  const ten = r[0]?.ten ?? "";
  if (/^(satarobo_local|satarobo_dev)/.test(ten)) throw new Error(`[ADT-DB] TỪ CHỐI: database "${ten}" là DB đang phục vụ dev server.`);
}

async function don(): Promise<void> {
  const ds = await db.affiliate.findMany({ where: { code: { startsWith: MA } }, select: { id: true } });
  const ids = ds.map((x) => x.id);
  await db.lead.deleteMany({ where: { parentName: { startsWith: P } } }); // kéo theo LeadAttribution (onDelete Cascade)
  await db.affiliate.updateMany({ where: { id: { in: ids } }, data: { parentPartyId: null } });
  await db.affiliatePartyTag.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliateMembership.deleteMany({ where: { partyId: { in: ids } } });
  await db.affiliate.deleteMany({ where: { id: { in: ids } } });
  await db.affiliateCampaignRule.deleteMany({ where: { campaign: { code: { startsWith: MA } } } });
  await db.affiliateCampaign.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateTag.deleteMany({ where: { code: { startsWith: MA } } });
  await db.affiliateType.deleteMany({ where: { code: { startsWith: MA } } });
  await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: MA } } });
  await db.employee.deleteMany({ where: { employeeCode: { startsWith: MA } } });
  await db.center.deleteMany({ where: { id: { startsWith: P } } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: P } }, { entityId: { in: ids } }] } });
}

// ── fixture ─────────────────────────────────────────────────────────────────────────────────────────
const taoLoaiFx = (ghi: Partial<{ requiresApproval: boolean; isActive: boolean; defaultSourceGroupId: string | null }> = {}) =>
  db.affiliateType.create({ data: { code: `${MA}_L${hau()}`, name: `Loại ${P}`, requiresApproval: true, isActive: true, sortOrder: 100, ...ghi } });
const taoNhanFx = (ghi: Partial<{ isActive: boolean }> = {}) => db.affiliateTag.create({ data: { code: `${MA}_N${hau()}`, name: `Nhãn ${P}`, isActive: true, ...ghi } });
const taoNhanVienFx = (status: "ACTIVE" | "RESIGNED" = "ACTIVE") =>
  db.employee.create({ data: { employeeCode: `${MA}${hau()}`, fullName: `${P} nhân viên ${hau()}`, jobTitle: "Tư vấn", department: "KINH_DOANH", status } });
const taoCoSoFx = (ten: string, isActive = true) => db.center.create({ data: { id: `${P}-${ten}-${hau()}`.toLowerCase(), name: `Cơ sở ${ten}`, slug: `${P}-${ten}-${hau()}`.toLowerCase(), address: "x", isActive } });

const vaoMau = (typeId: string, ghi: Record<string, unknown> = {}) => ({
  partyKind: "PERSON",
  name: `Chị An ${P}`,
  typeId,
  tagIds: [] as string[],
  code: `${MA}${hau()}`,
  phone: null,
  email: null,
  note: null,
  centerId: null,
  commissionPercent: null,
  employeeId: null,
  parentPartyId: null,
  ...ghi,
});

/** Tạo đối tác qua ĐƯỜNG THẬT (`taoDoiTac`) và trả `id` + mốc `updatedAt` như người dùng thấy. */
async function taoDt(typeId: string, ghi: Record<string, unknown> = {}) {
  const vao = vaoMau(typeId, ghi);
  const r = await taoDoiTac({ nguoi: NGUOI, vao });
  if (!r.ok) throw new Error(`taoDoiTac: ${r.truong}: ${r.loi}`);
  return { id: r.id, ma: r.ma, capNhatLuc: new Date(r.capNhatLuc), trangThai: r.trangThai, vao };
}
const doc = (id: string) => db.affiliate.findUniqueOrThrow({ where: { id } });
const soAudit = (entityId: string, action?: string) => db.auditLog.count({ where: { entityId, ...(action ? { action } : {}) } });

/** Đưa MỘT đối tác vào trạng thái cho trước bằng ĐÚNG đường chuyển thật (không `update` thẳng) — để ca kiểm tra chạy trên trạng thái có thật. */
async function dua(id: string, mocDau: Date, den: Array<"ACTIVE" | "SUSPENDED" | "ENDED">): Promise<Date> {
  let moc = mocDau;
  for (const d of den) {
    const r = await doiTrangThaiDoiTac({ nguoi: NGUOI, id, updatedAtDaThay: moc, den: d, lyDo: LY_DO, now: NOW });
    if (!r.ok) throw new Error(`dua → ${d}: ${r.loi}`);
    moc = new Date(r.capNhatLuc);
  }
  return moc;
}

const actorCoSo = (centerIds: string[]): Actor =>
  ({
    userId: `${P}-actor`,
    isSuperAdmin: false,
    isHoLevel: false,
    orgRoles: [],
    permissions: [],
    visibleCenterIds: centerIds,
    visibleOrgUnitIds: [],
    grantsAllow: new Set<string>(),
    assignedClassIds: new Set<string>(),
  }) as Actor;
const actorHoiSo = (): Actor => ({ ...actorCoSo([]), isSuperAdmin: true }) as Actor;

const LOC = { trang: 1, kichThuoc: KICH_THUOC_TRANG_AFFILIATE, trangThai: null, loaiMa: null, tuKhoa: null, coTheXemLienHe: true } as const;

describe.skipIf(!RUN_DB_TESTS)("[ADT-DB] tab Affiliate — đối tác · loại · nhãn — Postgres thật", () => {
  beforeEach(async () => {
    await assertDbThu();
    await don();
  }, 60_000);
  afterAll(async () => {
    await don();
  }, 60_000);

  it("[ADT-DB-01] tạo: loại cần duyệt ⇒ PENDING, không cần duyệt ⇒ ACTIVE; isActive đi cùng; mã chuẩn hoá; nhãn; audit cùng giao dịch", async () => {
    const canDuyet = await taoLoaiFx({ requiresApproval: true });
    const khongCan = await taoLoaiFx({ requiresApproval: false });
    const nhan1 = await taoNhanFx();
    const nhan2 = await taoNhanFx();

    const a = await taoDt(canDuyet.id, { code: `fx-adt-${hau().toLowerCase()}`, name: "  Chị An fxadt  ", tagIds: [nhan1.id, nhan2.id, nhan1.id], phone: "0905 123 456", commissionPercent: 12.5 });
    const dA = await doc(a.id);
    expect(dA.status).toBe("PENDING");
    expect(dA.isActive).toBe(false);
    expect(dA.approvedAt).toBeNull();
    expect(dA.approvedById).toBeNull();
    expect(dA.code).toMatch(/^FXADT[A-Z0-9]+$/); // mã người gõ `fx-adt-…` đã thành chữ HOA + số, không gạch
    expect(dA.name).toBe("Chị An fxadt");
    expect(dA.createdById).toBe(NGUOI.userId);
    expect(dA.commissionPercent).toBe(12.5);
    expect((await db.affiliatePartyTag.findMany({ where: { partyId: a.id } })).map((t) => t.tagId).sort()).toEqual([nhan1.id, nhan2.id].sort());

    const b = await taoDt(khongCan.id);
    const dB = await doc(b.id);
    expect(dB.status).toBe("ACTIVE");
    expect(dB.isActive).toBe(true);

    // audit: đúng MỘT dòng mỗi lần tạo, cùng thực thể, mang trạng thái ban đầu
    const au = await db.auditLog.findMany({ where: { entityId: a.id } });
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: "AFFILIATE_TAO", entityType: "Affiliate", module: "nguon-hoa-hong", actorId: NGUOI.userId });
    expect((au[0]!.newValues as { status: string }).status).toBe("PENDING");
  });

  it("[ADT-DB-02] quan hệ tổ chức: câu tiếng Việt TRƯỚC khi CHECK nổ; và CHECK của migration vẫn CHẶN THẬT khi đi vòng bằng SQL", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const org = await taoDt(loai.id, { partyKind: "ORGANIZATION", name: `Trường ${P}` });
    const nguoi = await taoDt(loai.id, { name: `Cô Lan ${P}` });

    // tầng ứng dụng: tổ chức có cha ⇒ câu rõ ràng, chưa chạm DB
    const loi = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { partyKind: "ORGANIZATION", parentPartyId: org.id }) });
    expect(loi).toMatchObject({ ok: false, truong: "parentPartyId" });
    if (!loi.ok) expect(loi.loi).toMatch(/không thuộc một tổ chức khác/);

    // đi vòng tầng ứng dụng: CHECK của Postgres chặn
    await expect(db.$executeRaw`UPDATE "Affiliate" SET "parentPartyId" = ${org.id} WHERE "id" = ${org.id}`).rejects.toThrow(/Affiliate_org_khong_co_cha_chk|Affiliate_khong_tu_cha_chk/);
    await expect(db.$executeRaw`UPDATE "Affiliate" SET "parentPartyId" = ${nguoi.id} WHERE "id" = ${org.id}`).rejects.toThrow(/Affiliate_org_khong_co_cha_chk/);
    // đối chứng dương: cá nhân thuộc tổ chức hợp lệ
    await db.$executeRaw`UPDATE "Affiliate" SET "parentPartyId" = ${org.id} WHERE "id" = ${nguoi.id}`;
    expect((await doc(nguoi.id)).parentPartyId).toBe(org.id);
  });

  it("[ADT-DB-03] mã trùng: kiểm trước + ĐUA tạo cùng mã ⇒ đúng một bên thắng, bên kia «đã có» (không phải lỗi 500)", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const ma = `${MA}DUA${hau()}`;
    const dau = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { code: ma }) });
    expect(dau.ok).toBe(true);
    const lap = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { code: ma.toLowerCase() }) }); // khác hoa/thường vẫn là cùng mã
    expect(lap).toMatchObject({ ok: false, truong: "code" });
    if (!lap.ok) expect(lap.loi).toMatch(/đã có/);

    const maDua = `${MA}RACE${hau()}`;
    const [x, y] = await Promise.all([taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { code: maDua }) }), taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { code: maDua }) })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    const thua = x.ok ? y : x;
    expect(thua).toMatchObject({ ok: false, truong: "code" });
    expect(await db.affiliate.count({ where: { code: maDua } })).toBe(1);
    const thang = await db.affiliate.findUniqueOrThrow({ where: { code: maDua } });
    expect(await soAudit(thang.id, "AFFILIATE_TAO")).toBe(1); // bên thua không để lại audit mồ côi
  });

  it("[ADT-DB-03b] ĐUA XÁC ĐỊNH: người kia đang GIỮ mã trong một giao dịch chưa commit ⇒ kiểm trước không thấy, INSERT chờ rồi vỡ khoá duy nhất ⇒ vẫn là «mã đã có» (không ném lỗi thô)", async () => {
    // Ca ngẫu nhiên ở trên chỉ đỏ khi hai giao dịch tình cờ đan xen; ca này BUỘC đan xen: giao dịch giữ mã chưa commit ⇒ `kiemMaChuaCo` của bên kia không thấy dòng, còn INSERT thì phải chờ.
    const loai = await taoLoaiFx({ requiresApproval: false });
    const ma = `${MA}HOLD${hau()}`;
    let benKia: Promise<Awaited<ReturnType<typeof taoDoiTac>>> | null = null;
    let daThayCho = false;
    await db.$transaction(
      async (tx) => {
        await tx.affiliate.create({ data: { code: ma, name: `Giữ mã ${P}`, typeId: loai.id, status: "ACTIVE", isActive: true } });
        benKia = taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { code: ma }) });
        // Chờ tới khi bên kia THẬT SỰ bị chặn ở khoá chờ giao dịch của ta (không đoán bằng giờ). Chỉ tính ổ khoá ĐANG CHỜ của DATABASE NÀY và của kết nối KHÁC ta — máy chủ Postgres có thể dùng chung
        // với bộ test khác, nên đếm mọi `pg_locks` chưa cấp sẽ cho kết quả đúng "tình cờ" và để ca này lặng lẽ thôi canh cuộc đua.
        for (let i = 0; i < 100 && !daThayCho; i += 1) {
          // `pg_stat_activity` bị ĐÓNG BĂNG trong suốt một giao dịch (stats_fetch_consistency = cache) — không xoá ảnh chụp thì vòng này không bao giờ thấy kết nối mới của bên kia.
          await tx.$executeRaw`select pg_stat_clear_snapshot()`;
          const cho = await tx.$queryRaw<{ n: bigint }[]>`
            select count(*)::bigint as n
            from pg_locks l join pg_stat_activity a on a.pid = l.pid
            where not l.granted and l.locktype in ('transactionid', 'tuple') and a.datname = current_database() and a.pid <> pg_backend_pid()`;
          daThayCho = Number(cho[0]?.n ?? 0) > 0;
          if (!daThayCho) await new Promise((r) => setTimeout(r, 50));
        }
      },
      { timeout: 15_000 },
    );
    // Không thấy bên kia bị chặn = ca KHÔNG còn canh cuộc đua: phải đỏ chứ không được xanh giả.
    expect(daThayCho, "bên kia phải bị chặn ở khoá chờ giao dịch (nếu không, ca này không canh được cuộc đua)").toBe(true);
    const kq = await benKia!;
    expect(kq).toMatchObject({ ok: false, truong: "code" });
    if (!kq.ok) expect(kq.loi).toMatch(/đã có/);
    expect(await db.affiliate.count({ where: { code: ma } })).toBe(1);
  });

  it("[ADT-DB-04] loại / nhãn / cơ sở ngừng hoặc không tồn tại ⇒ từ chối, DB không đổi; đang dùng ⇒ tạo được", async () => {
    const ok = await taoLoaiFx({ requiresApproval: false });
    const ngung = await taoLoaiFx({ isActive: false });
    const nhanOk = await taoNhanFx();
    const nhanNgung = await taoNhanFx({ isActive: false });
    const csOk = await taoCoSoFx("ok");
    const csNgung = await taoCoSoFx("ngung", false);
    const truoc = await db.affiliate.count({ where: { code: { startsWith: MA } } });

    const casuc: [string, Record<string, unknown>, string, RegExp][] = [
      ["loại ngừng", vaoMau(ngung.id), "typeId", /đã ngừng/],
      ["loại không tồn tại", vaoMau("khong-co-loai-nay"), "typeId", /Không tìm thấy loại/],
      ["nhãn ngừng", vaoMau(ok.id, { tagIds: [nhanNgung.id] }), "tagIds", /đã ngừng/],
      ["nhãn không tồn tại", vaoMau(ok.id, { tagIds: ["khong-co-nhan"] }), "tagIds", /Có nhãn không tồn tại/],
      ["cơ sở ngừng", vaoMau(ok.id, { centerId: csNgung.id }), "centerId", /ngừng hoạt động/],
      ["cơ sở không tồn tại", vaoMau(ok.id, { centerId: "khong-co-co-so" }), "centerId", /Không tìm thấy cơ sở/],
    ];
    for (const [ten, vao, truong, re] of casuc) {
      const r = await taoDoiTac({ nguoi: NGUOI, vao });
      expect(r.ok, ten).toBe(false);
      if (!r.ok) {
        expect(r.truong, ten).toBe(truong);
        expect(r.loi, ten).toMatch(re);
      }
    }
    expect(await db.affiliate.count({ where: { code: { startsWith: MA } } }), "không từ chối nào được để lại dòng").toBe(truoc);

    // đối chứng dương
    const t = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(ok.id, { tagIds: [nhanOk.id], centerId: csOk.id }) });
    expect(t.ok).toBe(true);
    if (t.ok) expect((await doc(t.id)).centerId).toBe(csOk.id);

    // SỬA: đổi sang loại / nhãn / cơ sở đã ngừng cũng bị chặn (chỉ kiểm cái ĐỔI, nhưng cái đổi sang đồ ngừng thì phải bị chặn)
    const a = await taoDt(ok.id);
    const suaDen = (ghi: Record<string, unknown>) => suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, ...ghi }, lyDo: null });
    expect(await suaDen({ typeId: ngung.id })).toMatchObject({ ok: false, truong: "typeId" });
    expect(await suaDen({ tagIds: [nhanNgung.id] })).toMatchObject({ ok: false, truong: "tagIds" });
    expect(await suaDen({ centerId: csNgung.id })).toMatchObject({ ok: false, truong: "centerId" });
    const dA = await doc(a.id);
    expect([dA.typeId, dA.centerId]).toEqual([ok.id, null]);
    expect(await db.affiliatePartyTag.count({ where: { partyId: a.id } })).toBe(0);
    // đối chứng dương: đổi sang cái ĐANG DÙNG thì qua
    expect((await suaDen({ typeId: (await taoLoaiFx()).id, tagIds: [nhanOk.id], centerId: csOk.id })).ok).toBe(true);
  });

  it("[ADT-DB-05] một nhân viên – một đối tác chưa kết thúc: từ chối nêu tên, ĐUA chỉ một thắng, nhân viên nghỉ bị chặn, ENDED giải phóng", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const nv = await taoNhanVienFx();
    const dau = await taoDt(loai.id, { employeeId: nv.id, name: `Gắn NV ${P}` });
    expect((await doc(dau.id)).employeeId).toBe(nv.id);

    const lan2 = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { employeeId: nv.id }) });
    expect(lan2).toMatchObject({ ok: false, truong: "employeeId" });
    if (!lan2.ok) expect(lan2.loi).toContain(`Gắn NV ${P}`);

    // đua: hai lượt cùng nhân viên mới, hai mã khác nhau
    const nv2 = await taoNhanVienFx();
    const [x, y] = await Promise.all([taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { employeeId: nv2.id }) }), taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { employeeId: nv2.id }) })]);
    expect([x.ok, y.ok].filter(Boolean), "hai lượt cùng gắn một nhân viên không được cùng qua").toHaveLength(1);
    expect(await db.affiliate.count({ where: { employeeId: nv2.id } })).toBe(1);

    // nhân viên đã nghỉ
    const nghi = await taoNhanVienFx("RESIGNED");
    const r = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { employeeId: nghi.id }) });
    expect(r).toMatchObject({ ok: false, truong: "employeeId" });
    if (!r.ok) expect(r.loi).toMatch(/đã nghỉ việc/);

    // ENDED giải phóng nhân viên
    await dua(dau.id, dau.capNhatLuc, ["ENDED"]);
    const lai = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { employeeId: nv.id }) });
    expect(lai.ok).toBe(true);
  });

  it("[ADT-DB-06] cha/con: con thuộc tổ chức được; cha cá nhân / tổ chức đã kết thúc bị chặn; tổ chức còn thành viên không đổi thành cá nhân", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const org = await taoDt(loai.id, { partyKind: "ORGANIZATION", name: `Trường ${P}` });
    const canhan = await taoDt(loai.id, { name: `Cô Lan ${P}` });

    const con = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { parentPartyId: org.id }) });
    expect(con.ok).toBe(true); // đối chứng dương

    const chaCaNhan = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { parentPartyId: canhan.id }) });
    expect(chaCaNhan).toMatchObject({ ok: false, truong: "parentPartyId" });
    if (!chaCaNhan.ok) expect(chaCaNhan.loi).toMatch(/là cá nhân/);

    // ORG còn thành viên ⇒ không đổi sang cá nhân
    const moc = new Date((await doc(org.id)).updatedAt);
    const doi = await suaDoiTac({ nguoi: NGUOI, id: org.id, updatedAtDaThay: moc, vao: { ...org.vao, partyKind: "PERSON" }, lyDo: null });
    expect(doi).toMatchObject({ ok: false, truong: "partyKind" });
    if (!doi.ok) expect(doi.loi).toMatch(/1 cá nhân thuộc về/);
    expect((await doc(org.id)).partyKind).toBe("ORGANIZATION");

    // tổ chức đã kết thúc ⇒ không nhận thành viên mới
    const org2 = await taoDt(loai.id, { partyKind: "ORGANIZATION", name: `Trường cũ ${P}` });
    await dua(org2.id, org2.capNhatLuc, ["ENDED"]);
    const conMoi = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { parentPartyId: org2.id }) });
    expect(conMoi).toMatchObject({ ok: false, truong: "parentPartyId" });
    if (!conMoi.ok) expect(conMoi.loi).toMatch(/đã kết thúc/);
  });

  it("[ADT-DB-07] sửa: audit đúng cũ→mới; SĐT/email/ghi chú KHÔNG vào nhật ký; không đổi gì ⇒ không audit, mốc giữ nguyên", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const a = await taoDt(loai.id, { phone: "0905 123 456", email: "an@example.com", note: "ghi chú mật" });
    const truocAudit = await soAudit(a.id);

    const r = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, name: "Chị Bình fxadt", phone: "0905 999 888", email: "binh@example.com", note: "ghi chú khác" }, lyDo: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doi).toBe(true);
    expect(r.truongDoi.sort()).toEqual(["email", "name", "note", "phone"]);
    const d = await doc(a.id);
    expect(d.name).toBe("Chị Bình fxadt");
    expect(d.phone).toBe("0905 999 888");

    const au = await db.auditLog.findMany({ where: { entityId: a.id, action: "AFFILIATE_SUA" } });
    expect(au).toHaveLength(1);
    expect(await soAudit(a.id)).toBe(truocAudit + 1);
    expect(au[0]!.changedFields.sort()).toEqual(["email", "name", "note", "phone"]);
    expect(au[0]!.oldValues).toMatchObject({ name: "Chị An fxadt" });
    expect(au[0]!.newValues).toMatchObject({ name: "Chị Bình fxadt" });
    // nhật ký đọc được rộng hơn trang quản lý ⇒ không chép liên hệ / ghi chú
    const chuoi = JSON.stringify([au[0]!.oldValues, au[0]!.newValues]);
    for (const nhay of ["0905", "an@example.com", "binh@example.com", "ghi chú"]) expect(chuoi, nhay).not.toContain(nhay);

    // không đổi gì
    const moc = new Date(r.capNhatLuc);
    const khong = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: moc, vao: { ...a.vao, name: "Chị Bình fxadt", phone: "0905 999 888", email: "binh@example.com", note: "ghi chú khác" }, lyDo: null });
    expect(khong).toMatchObject({ ok: true, doi: false, truongDoi: [] });
    expect(await soAudit(a.id)).toBe(truocAudit + 1);
    expect((await doc(a.id)).updatedAt.toISOString()).toBe(moc.toISOString());
  });

  it("[ADT-DB-08] khoá lạc quan: mốc cũ ⇒ «vừa được người khác thay đổi»; sửa CHỈ NHÃN cũng làm mốc nhích (không mất lượt sửa nhãn)", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const nhan = await taoNhanFx();
    const a = await taoDt(loai.id);

    const lan1 = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, tagIds: [nhan.id] }, lyDo: null }); // CHỈ đổi nhãn
    expect(lan1.ok).toBe(true);
    if (!lan1.ok) return;
    expect(lan1.truongDoi).toEqual(["tagIds"]);
    expect(new Date(lan1.capNhatLuc).getTime(), "sửa chỉ nhãn phải làm mốc nhích").toBeGreaterThan(a.capNhatLuc.getTime());
    expect((await db.affiliatePartyTag.findMany({ where: { partyId: a.id } })).map((t) => t.tagId)).toEqual([nhan.id]);

    // người thứ hai vẫn cầm mốc CŨ ⇒ bị từ chối; DB + audit giữ nguyên
    const truocAudit = await soAudit(a.id);
    const lan2 = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, name: "Tên của người chậm" }, lyDo: null });
    expect(lan2).toMatchObject({ ok: false, truong: "vuaDoi" });
    if (!lan2.ok) expect(lan2.loi).toMatch(/vừa được người khác thay đổi/);
    expect((await doc(a.id)).name).toBe(a.vao.name);
    expect(await soAudit(a.id)).toBe(truocAudit);
    // đối chứng dương: cùng bản sửa với mốc MỚI thì qua
    const lan3 = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: new Date(lan1.capNhatLuc), vao: { ...a.vao, tagIds: [nhan.id], name: "Tên của người chậm" }, lyDo: null });
    expect(lan3.ok).toBe(true);

    // đổi trạng thái cũng dùng cùng khoá
    const dt = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, den: "SUSPENDED", lyDo: LY_DO, now: NOW });
    expect(dt).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await doc(a.id)).status).toBe("ACTIVE");

    // không tìm thấy
    expect(await suaDoiTac({ nguoi: NGUOI, id: "khong-co", updatedAtDaThay: NOW, vao: a.vao, lyDo: null })).toMatchObject({ ok: false, truong: "khongTimThay" });
  });

  it("[ADT-DB-09] mã ?ref= KHOÁ khi đã có lead (Lead.affiliateId HOẶC LeadAttribution), kể cả lead cơ sở khác; chưa có lead thì đổi được và đòi lý do khi đã rời nháp", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const cs = await taoCoSoFx("khoa");
    const nguon = await db.leadSourceGroup.findFirstOrThrow({ select: { id: true } });

    // A: chưa có lead
    const a = await taoDt(loai.id);
    const maMoi = `${MA}MOI${hau()}`;
    const thieuLyDo = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, code: maMoi }, lyDo: null });
    expect(thieuLyDo).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await doc(a.id)).code).toBe(a.ma);
    const doiMa = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: a.capNhatLuc, vao: { ...a.vao, code: maMoi }, lyDo: LY_DO });
    expect(doiMa.ok).toBe(true);
    expect((await doc(a.id)).code).toBe(maMoi);

    // B: có Lead.affiliateId ở CƠ SỞ KHÁC (cổng ghi không có actor ⇒ không scope)
    const b = await taoDt(loai.id);
    await db.lead.create({ data: { parentName: `${P}-ph-b`, phone: "0900000001", centerId: cs.id, affiliateId: b.id } });
    const khoaB = await suaDoiTac({ nguoi: NGUOI, id: b.id, updatedAtDaThay: b.capNhatLuc, vao: { ...b.vao, code: `${MA}KHAC${hau()}` }, lyDo: LY_DO });
    expect(khoaB).toMatchObject({ ok: false, truong: "code" });
    if (!khoaB.ok) expect(khoaB.loi).toMatch(/đã có lead/);
    expect((await doc(b.id)).code).toBe(b.ma);
    // khoá mã KHÔNG khoá việc sửa ô khác (đối chứng dương)
    const doiTen = await suaDoiTac({ nguoi: NGUOI, id: b.id, updatedAtDaThay: b.capNhatLuc, vao: { ...b.vao, name: "Đổi tên vẫn được" }, lyDo: null });
    expect(doiTen.ok).toBe(true);

    // C: chỉ có LeadAttribution (người giới thiệu), Lead.affiliateId để trống
    const c = await taoDt(loai.id);
    const leadC = await db.lead.create({ data: { parentName: `${P}-ph-c`, phone: "0900000002", centerId: cs.id } });
    await db.leadAttribution.create({
      data: { leadId: leadC.id, groupId: nguon.id, originalGroupId: nguon.id, referrerKind: "AFFILIATE", referrerAffiliateId: c.id, identificationMethod: "AFFILIATE", matchedRule: "fx", reasonText: "fixture" },
    });
    const khoaC = await suaDoiTac({ nguoi: NGUOI, id: c.id, updatedAtDaThay: c.capNhatLuc, vao: { ...c.vao, code: `${MA}KHAC${hau()}` }, lyDo: LY_DO });
    expect(khoaC).toMatchObject({ ok: false, truong: "code" });

    // tập khoá: A không, B và C có
    expect([...(await timDoiTacDaCoLead(db, [a.id, b.id, c.id]))].sort()).toEqual([b.id, c.id].sort());
    expect((await timDoiTacDaCoLead(db, [])).size).toBe(0);

    // mã đã thuộc đối tác khác ⇒ «đã có»
    const d = await taoDt(loai.id);
    const trung = await suaDoiTac({ nguoi: NGUOI, id: d.id, updatedAtDaThay: d.capNhatLuc, vao: { ...d.vao, code: maMoi }, lyDo: LY_DO });
    expect(trung).toMatchObject({ ok: false, truong: "code" });
    if (!trung.ok) expect(trung.loi).toMatch(/đã có/);
  });

  it("[ADT-DB-10] isActive ≡ (status = ACTIVE) ở MỌI bước chuyển; duyệt ghi người + giờ; đường cũ resolveAffiliateByCode chỉ thấy ACTIVE; audit mỗi bước", async () => {
    const loai = await taoLoaiFx({ requiresApproval: true });
    const a = await taoDt(loai.id);
    const nhat: Array<[string, boolean]> = [];
    const ghiNhan = async () => {
      const d = await doc(a.id);
      nhat.push([d.status, d.isActive]);
      expect(d.isActive, `status=${d.status}`).toBe(d.status === "ACTIVE");
      return d;
    };

    await ghiNhan(); // PENDING
    expect(await resolveAffiliateByCode(a.ma)).toBeNull();

    let moc = a.capNhatLuc;
    const buoc = async (den: "ACTIVE" | "SUSPENDED" | "ENDED", lyDo: string | null) => {
      const r = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: moc, den, lyDo, now: NOW });
      expect(r.ok, den).toBe(true);
      if (r.ok) moc = new Date(r.capNhatLuc);
      return ghiNhan();
    };

    const duyet = await buoc("ACTIVE", null); // PENDING → ACTIVE: lý do tuỳ chọn
    expect(duyet.approvedById).toBe(NGUOI.userId);
    expect(duyet.approvedAt?.toISOString()).toBe(NOW.toISOString());
    expect((await resolveAffiliateByCode(a.ma))?.id).toBe(a.id); // đối chứng dương: đường cũ thấy ACTIVE

    const tamDung = await buoc("SUSPENDED", LY_DO);
    expect(tamDung.approvedAt?.toISOString()).toBe(NOW.toISOString()); // không đụng người duyệt
    expect(await resolveAffiliateByCode(a.ma)).toBeNull();

    await buoc("ACTIVE", null); // kích hoạt lại
    expect((await resolveAffiliateByCode(a.ma))?.id).toBe(a.id);
    await buoc("ENDED", LY_DO);
    expect(await resolveAffiliateByCode(a.ma)).toBeNull();

    expect(nhat).toEqual([["PENDING", false], ["ACTIVE", true], ["SUSPENDED", false], ["ACTIVE", true], ["ENDED", false]]);
    const au = await db.auditLog.findMany({ where: { entityId: a.id, action: "AFFILIATE_DOI_TRANG_THAI" }, orderBy: { createdAt: "asc" } });
    expect(au.map((x) => (x.newValues as { status: string }).status)).toEqual(["ACTIVE", "SUSPENDED", "ACTIVE", "ENDED"]);
    expect(au.map((x) => (x.oldValues as { status: string }).status)).toEqual(["PENDING", "ACTIVE", "SUSPENDED", "ACTIVE"]);
    expect(au[1]!.reason).toBe(LY_DO);
  });

  it("[ADT-DB-11] bảng chuyển trạng thái cưỡng chế ở máy chủ: ENDED cuối · thiếu lý do · bước ngoài bảng · DRAFT→ACTIVE theo loại; từ chối ⇒ DB + audit không đổi", async () => {
    const canDuyet = await taoLoaiFx({ requiresApproval: true });
    const khongCan = await taoLoaiFx({ requiresApproval: false });

    // PENDING → SUSPENDED không có trong bảng
    const p = await taoDt(canDuyet.id);
    const truocAudit = await soAudit(p.id);
    const sai = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: p.id, updatedAtDaThay: p.capNhatLuc, den: "SUSPENDED", lyDo: LY_DO, now: NOW });
    expect(sai).toMatchObject({ ok: false, truong: "trangThai" });
    // PENDING → ENDED (từ chối) thiếu lý do
    for (const lyDo of [null, "", "ngắn", "123456789"]) {
      const r = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: p.id, updatedAtDaThay: p.capNhatLuc, den: "ENDED", lyDo, now: NOW });
      expect(r, String(lyDo)).toMatchObject({ ok: false, truong: "lyDo" });
    }
    expect((await doc(p.id)).status).toBe("PENDING");
    expect(await soAudit(p.id)).toBe(truocAudit);

    // ENDED là cuối
    const e = await taoDt(khongCan.id);
    const mocE = await dua(e.id, e.capNhatLuc, ["ENDED"]);
    for (const den of ["ACTIVE", "PENDING", "SUSPENDED", "DRAFT"] as const) {
      const r = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: e.id, updatedAtDaThay: mocE, den, lyDo: LY_DO, now: NOW });
      expect(r.ok, den).toBe(false);
    }
    expect((await doc(e.id)).status).toBe("ENDED");

    // DRAFT (dòng nhập từ ngoài): loại cần duyệt ⇒ không nhảy thẳng ACTIVE; loại không cần ⇒ được
    const mk = async (typeId: string) => {
      const d = await db.affiliate.create({ data: { code: `${MA}DR${hau()}`, name: `Nháp ${P}`, typeId, status: "DRAFT", isActive: false } });
      return { id: d.id, moc: d.updatedAt };
    };
    const d1 = await mk(canDuyet.id);
    const r1 = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: d1.id, updatedAtDaThay: d1.moc, den: "ACTIVE", lyDo: null, now: NOW });
    expect(r1).toMatchObject({ ok: false, truong: "trangThai" });
    expect((await doiTrangThaiDoiTac({ nguoi: NGUOI, id: d1.id, updatedAtDaThay: d1.moc, den: "PENDING", lyDo: null, now: NOW })).ok).toBe(true);
    const d2 = await mk(khongCan.id);
    const r2 = await doiTrangThaiDoiTac({ nguoi: NGUOI, id: d2.id, updatedAtDaThay: d2.moc, den: "ACTIVE", lyDo: null, now: NOW });
    expect(r2.ok).toBe(true);
    const sau2 = await doc(d2.id);
    expect(sau2.isActive).toBe(true);
    expect(sau2.approvedAt, "kích hoạt từ nháp KHÔNG phải là duyệt").toBeNull();
  });

  it("[ADT-DB-12] kết thúc KHÔNG xoá lead / attribution; đối tác đã kết thúc không sửa được", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const nguon = await db.leadSourceGroup.findFirstOrThrow({ select: { id: true } });
    const a = await taoDt(loai.id);
    const lead = await db.lead.create({ data: { parentName: `${P}-ph-ket`, phone: "0900000003", affiliateId: a.id } });
    await db.leadAttribution.create({ data: { leadId: lead.id, groupId: nguon.id, originalGroupId: nguon.id, referrerKind: "AFFILIATE", referrerAffiliateId: a.id, identificationMethod: "AFFILIATE", matchedRule: "fx", reasonText: "fixture" } });

    const moc = await dua(a.id, a.capNhatLuc, ["ENDED"]);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).affiliateId).toBe(a.id);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id } })).referrerAffiliateId).toBe(a.id);

    const sua = await suaDoiTac({ nguoi: NGUOI, id: a.id, updatedAtDaThay: moc, vao: { ...a.vao, name: "Sửa sau khi kết thúc" }, lyDo: null });
    expect(sua).toMatchObject({ ok: false, truong: "trangThai" });
    if (!sua.ok) expect(sua.loi).toMatch(/đã kết thúc/);
  });

  it("[ADT-DB-13] loại: mã bất biến · trùng mã (kể cả đua) · nguồn mặc định ACTIVE ∧ selectable · khoá lạc quan · ngừng đòi lý do và KHÔNG đụng đối tác cũ", async () => {
    const nguonOk = await db.leadSourceGroup.create({ data: { code: `${MA}OK${hau()}`, name: `Nguồn ${P} ok`, status: "ACTIVE", selectable: true, sourceType: "MARKETING" } });
    const nguonNgung = await db.leadSourceGroup.create({ data: { code: `${MA}NG${hau()}`, name: `Nguồn ${P} ngừng`, status: "INACTIVE", selectable: true, sourceType: "MARKETING" } });
    const nguonKhongChon = await db.leadSourceGroup.create({ data: { code: `${MA}KC${hau()}`, name: `Nguồn ${P} không chọn`, status: "ACTIVE", selectable: false, sourceType: "MARKETING" } });

    const vao = (ghi: Record<string, unknown> = {}) => ({ code: `${MA}_L${hau()}`, name: `Loại mới ${P}`, description: null, defaultSourceGroupId: null, requiresApproval: false, sortOrder: 50, ...ghi });
    const t = await taoLoai({ nguoi: NGUOI, vao: vao({ defaultSourceGroupId: nguonOk.id, code: `${MA}_phu huynh ${hau()}` }) });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.ma).toMatch(/^FXADT_PHU_HUYNH_[A-Z0-9]+$/);
    expect(await soAudit(t.id, "AFFILIATE_LOAI_TAO")).toBe(1);

    for (const [ten, id] of [["nguồn ngừng", nguonNgung.id], ["nguồn không chọn được", nguonKhongChon.id], ["nguồn không tồn tại", "khong-co"]] as const) {
      const r = await taoLoai({ nguoi: NGUOI, vao: vao({ defaultSourceGroupId: id }) });
      expect(r, ten).toMatchObject({ ok: false, truong: "defaultSourceGroupId" });
    }

    // trùng mã + đua
    expect(await taoLoai({ nguoi: NGUOI, vao: vao({ code: t.ma.toLowerCase() }) })).toMatchObject({ ok: false, truong: "code" });
    const maDua = `${MA}_RACE${hau()}`;
    const [x, y] = await Promise.all([taoLoai({ nguoi: NGUOI, vao: vao({ code: maDua }) }), taoLoai({ nguoi: NGUOI, vao: vao({ code: maDua }) })]);
    expect([x.ok, y.ok].filter(Boolean)).toHaveLength(1);
    expect(await db.affiliateType.count({ where: { code: maDua } })).toBe(1);

    // sửa: mã bất biến (schema strict từ chối ô `code`), khoá lạc quan, nguồn mặc định chỉ kiểm khi ĐỔI
    const moc = new Date(t.capNhatLuc);
    const suaVao = (ghi: Record<string, unknown> = {}) => ({ name: "Tên mới", description: "mô tả", defaultSourceGroupId: nguonOk.id, requiresApproval: false, sortOrder: 60, ...ghi });
    expect(await suaLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: { ...suaVao(), code: "DOI_MA" } })).toMatchObject({ ok: false });
    expect((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).code).toBe(t.ma);
    const s1 = await suaLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: suaVao() });
    expect(s1).toMatchObject({ ok: true, doi: true });
    if (!s1.ok) return;
    expect(s1.truongDoi.sort()).toEqual(["description", "name", "sortOrder"]);
    expect(await suaLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: suaVao({ name: "Người chậm" }) })).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).name).toBe("Tên mới");
    // nguồn mặc định sau này bị ngừng KHÔNG chặn việc sửa tên (chỉ kiểm khi đổi)
    await db.leadSourceGroup.update({ where: { id: nguonOk.id }, data: { status: "INACTIVE" } });
    const mocMoi = new Date(s1.capNhatLuc);
    expect((await suaLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: mocMoi, vao: suaVao({ name: "Sửa tên khi nguồn đã ngừng" }) })).ok).toBe(true);
    // …nhưng ĐỔI sang nguồn đã ngừng thì bị chặn
    const mocSau = new Date((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    expect(await suaLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: mocSau, vao: suaVao({ name: "Sửa tên khi nguồn đã ngừng", defaultSourceGroupId: nguonNgung.id }) })).toMatchObject({ ok: false, truong: "defaultSourceGroupId" });

    // ngừng: đòi lý do; đối tác cũ KHÔNG bị đụng; đối tác MỚI không chọn được
    const dtCu = await taoDt(t.id);
    const cuTruoc = await doc(dtCu.id);
    const moc2 = new Date((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    for (const lyDo of [null, "ngắn", "123456789"]) {
      expect(await batTatLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc2, batLai: false, lyDo }), String(lyDo)).toMatchObject({ ok: false, truong: "lyDo" });
    }
    expect((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).isActive).toBe(true);
    const ngung = await batTatLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc2, batLai: false, lyDo: LY_DO });
    expect(ngung).toMatchObject({ ok: true, dangDung: false });
    expect(await soAudit(t.id, "AFFILIATE_LOAI_NGUNG")).toBe(1);
    const cuSau = await doc(dtCu.id);
    expect(cuSau.typeId).toBe(t.id); // giữ loại
    expect(cuSau.updatedAt.toISOString()).toBe(cuTruoc.updatedAt.toISOString()); // không bị đụng
    const moi = await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(t.id) });
    expect(moi).toMatchObject({ ok: false, truong: "typeId" });
    // đối tác cũ vẫn SỬA được khi giữ loại đã ngừng (không đổi loại ⇒ không kiểm loại)
    const suaCu = await suaDoiTac({ nguoi: NGUOI, id: dtCu.id, updatedAtDaThay: dtCu.capNhatLuc, vao: { ...dtCu.vao, name: "Sửa khi loại đã ngừng" }, lyDo: null });
    expect(suaCu.ok).toBe(true);
    // bật lại không đòi lý do; đang bật mà bật lại ⇒ từ chối
    const moc3 = new Date((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    expect(await batTatLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc3, batLai: true, lyDo: null })).toMatchObject({ ok: true, dangDung: true });
    const moc4 = new Date((await db.affiliateType.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    expect(await batTatLoai({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc4, batLai: true, lyDo: null })).toMatchObject({ ok: false });
  });

  it("[ADT-DB-14] nhãn: tạo · sửa · ngừng · bật lại; mã bất biến; ngừng đòi lý do; đối tác cũ giữ nhãn đã ngừng khi sửa tên", async () => {
    const t = await taoNhan({ nguoi: NGUOI, vao: { code: `${MA}_gv ${hau()}`, name: `Giáo viên ${P}`, description: null } });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.ma).toMatch(/^FXADT_GV_[A-Z0-9]+$/);
    expect(await taoNhan({ nguoi: NGUOI, vao: { code: t.ma, name: "Trùng", description: null } })).toMatchObject({ ok: false, truong: "code" });

    const moc = new Date(t.capNhatLuc);
    expect(await suaNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: { name: "Tên khác", description: null, code: "DOI_MA" } })).toMatchObject({ ok: false });
    const s = await suaNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: { name: `Giáo viên ${P} (mới)`, description: "mô tả" } });
    expect(s).toMatchObject({ ok: true, doi: true });
    expect(await suaNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc, vao: { name: "Người chậm", description: null } })).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await db.affiliateTag.findUniqueOrThrow({ where: { id: t.id } })).code).toBe(t.ma);
    if (!s.ok) return;
    // sửa không đổi gì ⇒ doi=false, không audit thêm
    const truoc = await soAudit(t.id);
    expect(await suaNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: new Date(s.capNhatLuc), vao: { name: `Giáo viên ${P} (mới)`, description: "mô tả" } })).toMatchObject({ ok: true, doi: false });
    expect(await soAudit(t.id)).toBe(truoc);

    // đối tác gắn nhãn rồi nhãn bị ngừng
    const loai = await taoLoaiFx({ requiresApproval: false });
    const dt = await taoDt(loai.id, { tagIds: [t.id] });
    const moc2 = new Date((await db.affiliateTag.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    expect(await batTatNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc2, batLai: false, lyDo: "ngắn" })).toMatchObject({ ok: false, truong: "lyDo" });
    expect(await batTatNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc2, batLai: false, lyDo: LY_DO })).toMatchObject({ ok: true, dangDung: false });
    // đối tác cũ: vẫn giữ nhãn; sửa tên mà GIỮ NGUYÊN nhãn ⇒ qua
    expect((await db.affiliatePartyTag.findMany({ where: { partyId: dt.id } })).map((x) => x.tagId)).toEqual([t.id]);
    const sua = await suaDoiTac({ nguoi: NGUOI, id: dt.id, updatedAtDaThay: dt.capNhatLuc, vao: { ...dt.vao, name: "Sửa khi nhãn đã ngừng" }, lyDo: null });
    expect(sua.ok).toBe(true);
    expect((await db.affiliatePartyTag.findMany({ where: { partyId: dt.id } })).map((x) => x.tagId)).toEqual([t.id]);
    // đối tác MỚI không chọn được nhãn đã ngừng
    expect(await taoDoiTac({ nguoi: NGUOI, vao: vaoMau(loai.id, { tagIds: [t.id] }) })).toMatchObject({ ok: false, truong: "tagIds" });
    // gỡ nhãn đã ngừng khỏi đối tác cũ thì được (bỏ nhãn luôn được)
    const goNhan = await suaDoiTac({ nguoi: NGUOI, id: dt.id, updatedAtDaThay: new Date((await doc(dt.id)).updatedAt), vao: { ...dt.vao, name: "Sửa khi nhãn đã ngừng", tagIds: [] }, lyDo: null });
    expect(goNhan.ok).toBe(true);
    expect(await db.affiliatePartyTag.count({ where: { partyId: dt.id } })).toBe(0);
    // bật lại
    const moc3 = new Date((await db.affiliateTag.findUniqueOrThrow({ where: { id: t.id } })).updatedAt);
    expect(await batTatNhan({ nguoi: NGUOI, id: t.id, updatedAtDaThay: moc3, batLai: true, lyDo: null })).toMatchObject({ ok: true, dangDung: true });
    expect(await soAudit(t.id, "AFFILIATE_NHAN_BAT_LAI")).toBe(1);
  });

  it("[ADT-DB-15] CHECK mã danh mục của migration chặn thật khi đi vòng bằng SQL", async () => {
    await expect(db.$executeRaw`INSERT INTO "AffiliateType" ("id","code","name","updatedAt") VALUES (${`${P}-ck1`}, 'ab', 'x', now())`).rejects.toThrow(/AffiliateType_code_chk/);
    await expect(db.$executeRaw`INSERT INTO "AffiliateType" ("id","code","name","updatedAt") VALUES (${`${P}-ck2`}, 'chu thuong', 'x', now())`).rejects.toThrow(/AffiliateType_code_chk/);
    await expect(db.$executeRaw`INSERT INTO "AffiliateTag" ("id","code","name","updatedAt") VALUES (${`${P}-ck3`}, 'ab', 'x', now())`).rejects.toThrow(/AffiliateTag_code_chk/);
    // đối chứng dương: mã hợp lệ vào được
    await db.$executeRaw`INSERT INTO "AffiliateTag" ("id","code","name","updatedAt") VALUES (${`${P}-ck4`}, ${`${MA}_CK`}, 'x', now())`;
    expect(await db.affiliateTag.count({ where: { code: `${MA}_CK` } })).toBe(1);
  });

  it("[ADT-DB-16] CÁCH LY: số lead đếm qua scopedDb — QLCS CS1 không đếm lead CS2; Hội sở đủ; phamViLead nói đúng", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const cs1 = await taoCoSoFx("cs1");
    const cs2 = await taoCoSoFx("cs2");
    const a = await taoDt(loai.id);
    const mk = (i: number, centerId: string, status: "MOI" | "DA_DANG_KY", xoa = false) =>
      db.lead.create({ data: { parentName: `${P}-ph-${i}`, phone: `09000001${String(i).padStart(2, "0")}`, centerId, affiliateId: a.id, status, ...(xoa ? { deletedAt: new Date("2026-10-01T00:00:00.000Z") } : {}) } });
    await mk(1, cs1.id, "MOI");
    await mk(2, cs1.id, "DA_DANG_KY");
    await mk(3, cs2.id, "MOI");
    await mk(4, cs2.id, "DA_DANG_KY");
    await mk(5, cs2.id, "DA_DANG_KY");
    await mk(6, cs1.id, "DA_DANG_KY", true); // lead đã xoá mềm không đếm

    const lay = async (actor: Actor) => {
      const r = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: a.ma });
      return { dong: r.dong.find((d) => d.id === a.id)!, pham: r.phamViLead };
    };
    const ho = await lay(actorHoiSo());
    expect([ho.dong.soLead, ho.dong.soLeadDaChot, ho.pham]).toEqual([5, 3, "TAT_CA"]); // đối chứng dương: Hội sở thấy đủ
    const c1 = await lay(actorCoSo([cs1.id]));
    expect([c1.dong.soLead, c1.dong.soLeadDaChot, c1.pham]).toEqual([2, 1, "GIOI_HAN"]);
    const c2 = await lay(actorCoSo([cs2.id]));
    expect([c2.dong.soLead, c2.dong.soLeadDaChot]).toEqual([3, 2]);
    const ca2 = await lay(actorCoSo([cs1.id, cs2.id]));
    expect([ca2.dong.soLead, ca2.dong.soLeadDaChot]).toEqual([5, 3]);
    const khong = await lay(actorCoSo([]));
    expect([khong.dong.soLead, khong.dong.soLeadDaChot]).toEqual([0, 0]);
    // đọc thẳng không scope thấy cả 5 — vì sao scopedDb tồn tại
    expect(await db.lead.count({ where: { affiliateId: a.id, deletedAt: null } })).toBe(5);
    // người cấp cơ sở vẫn thấy ĐỐI TÁC (danh mục dùng chung) — cách ly nằm ở cổng quyền
    expect((await docDanhSachDoiTac(actorCoSo([cs1.id]), { ...LOC, tuKhoa: a.ma })).tong).toBe(1);
    // mã khoá đo KHÔNG scope: lead chỉ ở CS2 vẫn khoá mã khi người xem là CS1
    expect(c1.dong.maDaKhoa).toBe(true);
    expect(khong.dong.maDaKhoa).toBe(true);
  });

  it("[ADT-DB-17] PII: người chỉ xem nhận liên hệ đã che + ghi chú/tỉ lệ null + không tìm được theo SĐT; người quản lý nhận nguyên", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    // SĐT/email DUY NHẤT mỗi lượt chạy: DB của người chạy có thể đã có dữ liệu thật cùng số, và ca này đếm kết quả tìm theo số.
    const sdt = `0907${String(Date.now()).slice(-6)}`;
    const email = `nguyen.an.${hau().toLowerCase()}@example.com`;
    const a = await taoDt(loai.id, { phone: sdt, email, note: "ghi chú riêng", commissionPercent: 7 });

    const quanLy = await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: a.ma, coTheXemLienHe: true });
    const dQl = quanLy.dong[0]!;
    expect([dQl.dienThoai, dQl.email, dQl.ghiChu, dQl.tiLeThamChieu]).toEqual([sdt, email, "ghi chú riêng", 7]);

    const chiXem = await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: a.ma, coTheXemLienHe: false });
    const dX = chiXem.dong[0]!;
    expect(dX.dienThoai).not.toBe(sdt);
    expect(dX.dienThoai).toBe(`${sdt.slice(0, 3)}${"x".repeat(sdt.length - 6)}${sdt.slice(-3)}`);
    expect(dX.email).not.toBe(email);
    expect(dX.email).toMatch(/^ng\*+@example\.com$/);
    expect([dX.ghiChu, dX.tiLeThamChieu]).toEqual([null, null]);
    // tên, loại, trạng thái, mã vẫn thấy
    expect([dX.ten, dX.ma, dX.trangThai]).toEqual([dQl.ten, dQl.ma, "ACTIVE"]);
    // toàn bộ phản hồi cho người chỉ xem không chứa bản thật ở BẤT KỲ chỗ nào (RSC serialize nguyên đối tượng)
    const chuoi = JSON.stringify(chiXem);
    for (const nhay of [sdt, email, "ghi chú riêng"]) expect(chuoi, nhay).not.toContain(nhay);

    // tìm theo SĐT/email: chỉ người quản lý
    expect((await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: sdt, coTheXemLienHe: true })).tong).toBe(1);
    expect((await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: sdt, coTheXemLienHe: false })).tong).toBe(0);
    expect((await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: email.slice(0, 18), coTheXemLienHe: false })).tong).toBe(0);
    expect((await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: email, coTheXemLienHe: true })).tong).toBe(1);
    // tìm theo mã thì ai cũng tìm được (đối chứng)
    expect((await docDanhSachDoiTac(actorHoiSo(), { ...LOC, tuKhoa: a.ma, coTheXemLienHe: false })).tong).toBe(1);
  });

  it("[ADT-DB-18] đọc: lọc trạng thái / loại / từ khoá · ký tự đại diện LIKE · phân trang · đếm theo trạng thái · chương trình đang hoạt động · hàng chờ duyệt", async () => {
    const lA = await taoLoaiFx({ requiresApproval: false });
    const lB = await taoLoaiFx({ requiresApproval: true });
    const t1 = await taoDt(lA.id, { name: `Alpha ${P}` });
    const t2 = await taoDt(lA.id, { name: `Beta ${P}` });
    const t3 = await taoDt(lB.id, { name: `Gamma ${P}` }); // PENDING
    await dua(t2.id, t2.capNhatLuc, ["SUSPENDED"]);
    const actor = actorHoiSo();

    const tatCa = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P });
    expect(tatCa.tong).toBe(3);
    expect(tatCa.theoTrangThai.PENDING).toBeGreaterThanOrEqual(1);
    // trạng thái / loại
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, trangThai: "PENDING" })).dong.map((d) => d.id)).toEqual([t3.id]);
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, trangThai: "SUSPENDED" })).dong.map((d) => d.id)).toEqual([t2.id]);
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, loaiMa: lA.code })).dong.map((d) => d.id).sort()).toEqual([t1.id, t2.id].sort());
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, loaiMa: "KHONG_CO_LOAI" })).tong).toBe(0);
    // từ khoá theo tên và theo mã
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: "alpha" })).dong.map((d) => d.id)).toEqual([t1.id]);
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: t3.ma.slice(0, -1) })).dong.map((d) => d.id)).toContain(t3.id);
    // ký tự đại diện LIKE không khớp mọi dòng
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: "%%" })).tong).toBe(0);
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: "___" })).tong).toBe(0);
    // số trên chip trạng thái ĐẾM CÙNG bộ lọc loại + từ khoá mà chip mang sang (bấm chip nào ra đúng chừng ấy dòng)
    for (const loc of [{ loaiMa: lA.code }, { loaiMa: lB.code }, { tuKhoa: "alpha" }, { loaiMa: lA.code, tuKhoa: "beta" }] as const) {
      const goc = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, ...loc });
      const tong = Object.values(goc.theoTrangThai).reduce((a, b) => a + b, 0);
      expect(tong, `tổng chip ≡ số dòng khi lọc ${JSON.stringify(loc)}`).toBe(goc.tong);
      for (const tt of ["PENDING", "ACTIVE", "SUSPENDED"] as const) {
        const rieng = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, ...loc, trangThai: tt });
        expect(goc.theoTrangThai[tt], `chip ${tt} khi lọc ${JSON.stringify(loc)}`).toBe(rieng.tong);
      }
    }
    // chọn MỘT trạng thái không được làm các chip khác về 0 (người dùng phải còn thấy các trạng thái kia để đổi sang)
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, trangThai: "PENDING" })).theoTrangThai).toEqual(tatCa.theoTrangThai);
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, loaiMa: lA.code })).theoTrangThai).toMatchObject({ ACTIVE: 1, SUSPENDED: 1, PENDING: 0 }); // chip «Chờ duyệt» của loại A phải là 0, không phải 1 của loại B
    // phân trang
    const trang1 = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, kichThuoc: 2, trang: 1 });
    const trang2 = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, kichThuoc: 2, trang: 2 });
    expect([trang1.tong, trang1.dong.length, trang2.dong.length]).toEqual([3, 2, 1]);
    expect(new Set([...trang1.dong, ...trang2.dong].map((d) => d.id)).size).toBe(3); // không trùng, không sót
    expect((await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P, kichThuoc: 2, trang: 9 })).dong).toHaveLength(0);
    // chương trình ĐANG HOẠT ĐỘNG
    const cp = await db.affiliateCampaign.create({ data: { code: `${MA}CP${hau()}`, name: `CP ${P}` } });
    const cp2 = await db.affiliateCampaign.create({ data: { code: `${MA}CQ${hau()}`, name: `CQ ${P}` } });
    const cp3 = await db.affiliateCampaign.create({ data: { code: `${MA}CR${hau()}`, name: `CR ${P}` } });
    await db.affiliateMembership.create({ data: { partyId: t1.id, campaignId: cp.id, status: "ACTIVE" } });
    await db.affiliateMembership.create({ data: { partyId: t1.id, campaignId: cp2.id, status: "ACTIVE" } });
    await db.affiliateMembership.create({ data: { partyId: t1.id, campaignId: cp3.id, status: "ENDED" } });
    const sau = await docDanhSachDoiTac(actor, { ...LOC, tuKhoa: P });
    expect(sau.dong.find((d) => d.id === t1.id)!.soChuongTrinh).toBe(2);
    expect(sau.dong.find((d) => d.id === t3.id)!.soChuongTrinh).toBe(0);
    // hàng chờ duyệt: đếm đúng và là một con số thật
    const truocCho = await demDoiTacChoDuyet();
    await taoDt(lB.id, { name: `Delta ${P}` });
    expect(await demDoiTacChoDuyet()).toBe(truocCho + 1);
    // NHÁP chưa gửi duyệt KHÔNG phải việc của người duyệt: không được tính vào hàng chờ
    await db.affiliate.create({ data: { code: `${MA}NHAP${hau()}`, name: `Nháp ${P}`, typeId: lB.id, status: "DRAFT", isActive: false } });
    expect(await demDoiTacChoDuyet()).toBe(truocCho + 1);
    // ô lọc loại liệt kê cả loại đã ngừng (đối tác cũ vẫn mang)
    await db.affiliateType.update({ where: { id: lB.id }, data: { isActive: false } });
    expect((await docCacLoaiChoLoc()).map((l) => l.ma)).toContain(lB.code);
  });

  it("[ADT-DB-19] đọc loại / nhãn: số đối tác + số quy tắc campaign + phân trang; nguồn chọn được làm mặc định chỉ gồm ACTIVE ∧ selectable", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const nhan = await taoNhanFx();
    await taoDt(loai.id, { tagIds: [nhan.id] });
    await taoDt(loai.id, { tagIds: [nhan.id] });
    const cp = await db.affiliateCampaign.create({ data: { code: `${MA}CP${hau()}`, name: `CP ${P}` } });
    const nguon = await db.leadSourceGroup.findFirstOrThrow({ select: { id: true } });
    await db.affiliateCampaignRule.create({ data: { campaignId: cp.id, typeId: loai.id, tagId: null, ruleKey: `T:${loai.id}|G:*`, sourceGroupId: nguon.id } });
    await db.affiliateCampaignRule.create({ data: { campaignId: cp.id, typeId: null, tagId: nhan.id, ruleKey: `T:*|G:${nhan.id}`, sourceGroupId: nguon.id } });

    const dsLoai = await docDanhSachLoai({ trang: 1, kichThuoc: 1000 });
    const dLoai = dsLoai.dong.find((d) => d.id === loai.id)!;
    expect([dLoai.soDoiTac, dLoai.soQuyTac, dLoai.dangDung, dLoai.canDuyet]).toEqual([2, 1, true, false]);
    const dsNhan = await docDanhSachNhan({ trang: 1, kichThuoc: 1000 });
    const dNhan = dsNhan.dong.find((d) => d.id === nhan.id)!;
    expect([dNhan.soDoiTac, dNhan.soQuyTac]).toEqual([2, 1]);

    // phân trang: tổng đếm toàn bộ, dòng chỉ một trang
    const trang = await docDanhSachLoai({ trang: 1, kichThuoc: 1 });
    expect(trang.dong).toHaveLength(1);
    expect(trang.tong).toBe(dsLoai.tong);
    expect(trang.tong).toBeGreaterThanOrEqual(1);

    const ch = await db.leadSourceGroup.create({ data: { code: `${MA}CH${hau()}`, name: `Nguồn ${P} chọn được`, status: "ACTIVE", selectable: true, sourceType: "MARKETING" } });
    const kh = await db.leadSourceGroup.create({ data: { code: `${MA}KH${hau()}`, name: `Nguồn ${P} hệ thống`, status: "ACTIVE", selectable: false, sourceType: "MARKETING" } });
    const ng = await db.leadSourceGroup.create({ data: { code: `${MA}NG${hau()}`, name: `Nguồn ${P} ngừng`, status: "INACTIVE", selectable: true, sourceType: "MARKETING" } });
    const ids = (await docNguonChoLoai()).map((n) => n.id);
    expect(ids).toContain(ch.id); // đối chứng dương
    expect(ids).not.toContain(kh.id);
    expect(ids).not.toContain(ng.id);
  });

  // ═══ [ADT-DB-20] page.tsx dựng bằng dữ liệu thật ═══════════════════════════════════════════════════
  const scopeFx = (quyen: ModuleKey[]) =>
    dungNguonHoaHongScope({
      quyen: new Set(quyen),
      co: { nguon: true, engine: false, affiliate: true },
      centerIds: { Lead: "ALL", CommissionPeriod: "ALL", CommissionTransaction: "ALL", CommissionDispute: "ALL" },
      cacCoSo: [],
    });
  const dungTrang = async (p: { actor: Actor; quyen: ModuleKey[]; sp?: Record<string, string> }): Promise<string> => {
    TRANG.vaoTab.mockResolvedValue({ userId: "u", actor: p.actor, scope: scopeFx(p.quyen) });
    const el = await AffiliatePage({ searchParams: Promise.resolve(p.sp ?? {}) });
    return renderToStaticMarkup(el);
  };

  it("[ADT-DB-20] page.tsx trên dữ liệu thật: người QUẢN LÝ thấy nút ghi + liên hệ nguyên; người chỉ XEM không thấy nút ghi và HTML không chứa liên hệ thật; lead đếm theo tầm nhìn", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    const cs1 = await taoCoSoFx("pg1");
    const cs2 = await taoCoSoFx("pg2");
    const a = await taoDt(loai.id, { name: `Chị Mai ${P}`, phone: "0905123456", email: "mai.chi@example.com", note: "ghi chú riêng tư", commissionPercent: 7 });
    await db.lead.create({ data: { parentName: `${P}-pg-1`, phone: "0900100001", centerId: cs1.id, affiliateId: a.id, status: "DA_DANG_KY" } });
    await db.lead.create({ data: { parentName: `${P}-pg-2`, phone: "0900100002", centerId: cs2.id, affiliateId: a.id, status: "DA_DANG_KY" } });
    await db.lead.create({ data: { parentName: `${P}-pg-3`, phone: "0900100003", centerId: cs2.id, affiliateId: a.id, status: "MOI" } });
    const sp = { q: a.ma };
    const hang = (html: string) => html.slice(html.indexOf(`Chị Mai ${P}`));

    // QUẢN LÝ (Hội sở): nút Tạo + Sửa + Đổi trạng thái; liên hệ nguyên; lead 3 / chốt 2; không có dấu * (thấy tất cả)
    const ql = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view", "affiliates:manage"], sp });
    expect(ql).toContain("Tạo đối tác");
    expect(ql).toContain(`Sửa đối tác Chị Mai ${P}`);
    expect(ql).toContain(`Đổi trạng thái: đối tác Chị Mai ${P}`);
    expect(ql).toContain("0905123456");
    expect(ql).toContain("mai.chi@example.com");
    expect(ql).not.toContain("*</th>");
    // Nút «Link» (AFF-WEB) không còn dựng `?ref=` từ tên miền cứng: nó sao chép link ĐANG DÙNG của đối tác, hoặc dẫn sang tab tạo link — và chỉ với quyền `affiliate_links:manage`.
    // Đối tác này CHƯA tham gia chương trình nào ⇒ tab Link / QR / Mã cũng không phát được ⇒ không có gì để làm ⇒ không vẽ nút (kể cả khi có quyền link — đối chứng ở dưới).
    expect(ql).not.toContain("Sao chép link giới thiệu");
    expect(ql).not.toContain("Tạo link giới thiệu cho");
    const qlLink = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view", "affiliates:manage", "affiliate_links:manage"], sp });
    expect(qlLink).not.toContain("Sao chép link giới thiệu"); // chưa chương trình, chưa link
    expect(qlLink).not.toContain("Tạo link giới thiệu cho");
    expect(qlLink).not.toContain("satarobo.vn");
    expect(qlLink).not.toContain("?ref=" + a.ma); // không còn link mẫu ?ref= nào ở bất kỳ đâu trong trang

    // CHỈ XEM (QLCS CS1): KHÔNG nút ghi; HTML — thứ thật sự gửi tới trình duyệt — KHÔNG chứa liên hệ / ghi chú; lead chỉ của CS1; có chú thích bị cắt
    const xem = await dungTrang({ actor: actorCoSo([cs1.id]), quyen: ["affiliates:view"], sp });
    for (const cam of ["Tạo đối tác", "Sửa đối tác", "Đổi trạng thái", "Thao tác", "0905123456", "mai.chi@example.com", "ghi chú riêng tư"]) expect(xem, cam).not.toContain(cam);
    expect(xem).toContain("090xxxx456"); // bản đã che vẫn đủ để nhận ra
    expect(xem).toContain(`Chị Mai ${P}`);
    expect(xem).toContain("Lead*");
    expect(xem).toContain("lead của cơ sở khác không nằm trong con số này");
    expect(hang(xem)).toMatch(/>1<\/td><td[^>]*>1<\/td>/); // lead 1, đã chốt 1 (chỉ CS1)
    expect(hang(ql)).toMatch(/>3<\/td><td[^>]*>2<\/td>/); // đối chứng dương: Hội sở thấy lead 3, đã chốt 2
    expect(xem).not.toContain("Sao chép link giới thiệu"); // URL cuối mang token của đối tác ⇒ người chỉ xem không có nút (và tầng đọc không đưa token xuống)

    // Chế độ Loại / Nhãn: nút Tạo chỉ cho người quản lý
    const loaiQl = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view", "affiliates:manage"], sp: { xem: "loai" } });
    expect(loaiQl).toContain("Tạo loại");
    expect(loaiQl).toContain(`Sửa loại Loại ${P}`);
    const loaiXem = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view"], sp: { xem: "loai" } });
    expect(loaiXem).not.toContain("Tạo loại");
    expect(loaiXem).not.toContain("Sửa loại");
    expect(loaiXem).toContain(`Loại ${P}`); // vẫn xem được
    const nhanQl = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view", "affiliates:manage"], sp: { xem: "nhan" } });
    expect(nhanQl).toContain("Tạo nhãn");
    expect(await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view"], sp: { xem: "nhan" } })).not.toContain("Tạo nhãn");
  });

  it("[ADT-DB-20b] page.tsx: thiếu `affiliates:view` ⇒ trang «không có quyền» nêu khoá, KHÔNG có dữ liệu; ?trang= vượt biên ⇒ redirect về trang cuối; bộ lọc rác không làm sập", async () => {
    const loai = await taoLoaiFx({ requiresApproval: false });
    await taoDt(loai.id, { name: `Chị Hạnh ${P}`, phone: "0905999111" });
    const khongQuyen = await dungTrang({ actor: actorHoiSo(), quyen: [], sp: { q: P } });
    expect(khongQuyen).toContain("affiliates:view");
    expect(khongQuyen).not.toContain(`Chị Hạnh ${P}`);
    expect(khongQuyen).not.toContain("0905999111");

    TRANG.vaoTab.mockResolvedValue({ userId: "u", actor: actorHoiSo(), scope: scopeFx(["affiliates:view"]) });
    await expect(AffiliatePage({ searchParams: Promise.resolve({ q: `Chị Hạnh ${P}`, trang: "99" }) })).rejects.toThrow(/^REDIRECT:\/nguon-hoa-hong\/affiliate\?q=/);
    // lọc rác: trạng thái lạ bị bỏ qua (không ném, không lọc), loại lạ ⇒ rỗng chứ không sập
    const rac = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view"], sp: { trangthai: "XOA_SACH", q: `Chị Hạnh ${P}` } });
    expect(rac).toContain(`Chị Hạnh ${P}`);
    const loaiLa = await dungTrang({ actor: actorHoiSo(), quyen: ["affiliates:view"], sp: { loai: "KHONG_CO", q: P } });
    expect(loaiLa).toContain("Không có đối tác nào khớp bộ lọc");
  });

});
