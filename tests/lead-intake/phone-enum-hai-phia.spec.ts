// @vitest-environment node
/**
 * [PE-*] — PHONE_ENUMERATION HAI PHÍA (reviewer độc lập 20/10/2026, finding HIGH): cùng MỘT đầu vào, một lần với SĐT ĐÃ CÓ trong CRM và một lần với SĐT CHƯA CÓ, phải ra cùng
 * status · cùng thân · cùng header (redirect) · cùng số lần chờ — KỂ CẢ khi đầu vào làm hỏng nhánh «lead mới».
 *
 * Vì sao lưới này tồn tại: `[LDD-*]`/`[ADT-*]`/`[SRC-INT-08]` chỉ so mới/trùng/bot trên đầu vào HỢP LỆ; `[LDD-05]` ép lỗi ở bước kiểm trùng (cả hai nhánh cùng chạm). Không ca nào gửi đầu vào mà nhánh «mới»
 * ném còn nhánh «trùng» thì không (tên chứa NUL / lone surrogate · centerId/courseId lạ · eventId đã dùng) ⇒ 200 (số đã có) vs 500 (số chưa có) — dò SĐT bằng MÃ TRẠNG THÁI, không cần đo thời gian.
 *
 * Mỗi ca khẳng định: (1) hai phía GIỐNG HỆT nhau; (2) status TUYỆT ĐỐI đúng (so bằng nhau thôi thì cả hai cùng 500 vẫn xanh); (3) ĐỐI CHỨNG DƯƠNG trong DB — phía «đã có» để lại dấu vết trùng, phía «chưa có»
 * tạo lead (hoặc đúng là không tạo với 400 / replay eventId).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dọn theo tiền tố `PEH` và dải SĐT 0906xxxxxx / 84906xxxxxx (đường affiliate lưu dạng canonical `84…`). LUẬT 18: mỗi ca tự dựng hiện trường.
 */
import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const REC = vi.hoisted(() => ({ cho: [] as number[], ip: 0 }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": `10.55.${Math.floor((REC.ip += 1) / 250) % 250}.${(REC.ip % 250) + 1}` }) }));
vi.mock("@/lib/tracking", () => ({ sendMetaCapi: async () => {}, sendGa4Event: async () => {} }));
vi.mock("@/lib/security/dong-deu-thoi-gian", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/dong-deu-thoi-gian")>()),
  // ĐỒNG HỒ ĐÓNG BĂNG (luật 19): phép đếm «mỗi lượt chạm khách chờ ĐÚNG MỘT lần» phụ thuộc việc phần việc thật có vượt ngưỡng 700 ms hay không (vượt ⇒ không chờ bù, đúng thiết kế) — dưới tải
  // máy lượt nào cũng có thể vượt và ca đỏ ngẫu nhiên. Đo THỜI GIAN thật là việc của `[LDD-04]`/`[ADT-01]`; ở đây chỉ đo MÃ TRẠNG THÁI/thân/header/số lần chờ.
  phuThuocThoiGianThat: () => {
    const t = new Date();
    return { now: () => t, cho: async (ms: number) => void REC.cho.push(ms), nhieuMs: () => 0 };
  },
}));

import { NextRequest } from "next/server";
import { db } from "../../lib/db";
import { RUN_DB_TESTS } from "../_helpers/db-gate";
import { POST as leadsPost } from "../../app/api/leads/route";
import { POST as saleFormPost } from "../../app/api/public/lead-intake/sale-form/route";
import { ingestIntakeLead, type IntakeContext } from "../../lib/lead/intake/ingest";
import type { MappedLead } from "../../lib/lead/intake/types";
import { KHONG_CO_TIN_HIEU_NGUON } from "../../lib/nguon/tin-hieu";
import { xuLyIntakeGioiThieu, xuLyIntakeKhiTatTheoDoi, type PhuThuocIntake } from "../../lib/affiliate/intake-cong-khai";
import { sinhToken } from "../../lib/affiliate/token";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon, datEpChonNguonCoSo } from "./_nguon-fixture";

const RUN = RUN_DB_TESTS;
const P = "PEH";
const CASE = 300_000;
const SDT_CO_SAN = "0906000001";
const RATE_LIMIT_KEY = "public.leadRateLimitMax";

const bienThe = (s: string) => [s, `84${s.slice(1)}`];
let phoneSeq = 0;
const sdtMoi = () => `0906${String(100_000 + (phoneSeq += 1)).slice(-6)}`;

async function don(): Promise<void> {
  const leads = await db.lead.findMany({ where: { OR: [{ parentName: { startsWith: P } }, { phone: { startsWith: "0906" } }, { phone: { startsWith: "84906" } }] }, select: { id: true } });
  const ids = leads.map((l) => l.id);
  if (ids.length > 0) {
    await db.leadDuplicate.deleteMany({ where: { primaryLeadId: { in: ids } } });
    await db.leadChild.deleteMany({ where: { leadId: { in: ids } } });
    await db.lead.deleteMany({ where: { id: { in: ids } } });
  }
  await db.systemSetting.deleteMany({ where: { key: { startsWith: "nguon." } } });
  await db.centerSetting.deleteMany({ where: { key: "nguon.epChonNguon" } });
  await db.systemSetting.deleteMany({ where: { key: RATE_LIMIT_KEY } });
}

/** Bật «ÉP CHỌN NGUỒN» cho cơ sở CS1: nhánh «mới» có thêm một cửa từ chối (`chanNhap`) mà nhánh «trùng» không chạm tới — nếu đầu vào ẩn danh với tới được nó thì status tách hai nhánh. */
async function epChonNguonCs1(): Promise<void> {
  const ou = await db.orgUnit.findFirst({ where: { code: "CS1" }, select: { id: true } });
  if (!ou) throw new Error("fixture thiếu OrgUnit CS1");
  await datEpChonNguonCoSo(ou.id, true);
}

/** Hiện trường «SĐT ĐÃ CÓ»: một lead đang mở, tạo thẳng bằng DB (không qua endpoint đang đo). */
async function leadCoSan(over: Record<string, unknown> = {}) {
  return db.lead.create({ data: { parentName: `${P} Có sẵn`, phone: SDT_CO_SAN, status: "MOI", source: "lien-he", lastInboundAt: new Date(), ...over } });
}

/** Cái người dò nhìn thấy. */
type Thay = { status: number; thanHoacDich: string; soLanCho: number; /** header phản hồi (bỏ `date`) — hoặc `acao` của lõi affiliate */ header: string };

const headerCuaResponse = (r: Response): string =>
  [...r.headers.entries()]
    .filter(([k]) => k.toLowerCase() !== "date")
    .map(([k, v]) => `${k.toLowerCase()}=${v}`)
    .sort()
    .join("|");

const thanCuaResponse = async (r: Response): Promise<string> => {
  const loc = r.headers.get("location");
  if (loc) {
    const u = new URL(loc);
    return `${u.pathname}?${[...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join("&")}`;
  }
  return await r.text();
};

// ───────────── /api/leads ─────────────
const leadsBody = (phone: string, over: Record<string, unknown> = {}) => ({
  parentName: `${P} Khách web`,
  phone,
  source: "lien-he",
  eventId: `evt-${phone}-${Math.random().toString(36).slice(2, 10)}`,
  dongYChinhSachBaoMat: true,
  consentMarketing: false,
  timeOnPage: 30,
  ...over,
});
async function guiLeads(phone: string, over: Record<string, unknown>): Promise<Thay> {
  REC.cho = [];
  const r = await leadsPost(new NextRequest("http://localhost/api/leads", { method: "POST", body: JSON.stringify(leadsBody(phone, over)), headers: { "content-type": "application/json" } }));
  return { status: r.status, thanHoacDich: await thanCuaResponse(r), soLanCho: REC.cho.length, header: headerCuaResponse(r) };
}

// ───────────── affiliate intake (lõi) ─────────────
let keySeq = 0;
const khoaMoi = () => `peh-${(keySeq += 1)}-${Math.random().toString(36).slice(2, 8)}`;
async function guiAffiliate(ham: typeof xuLyIntakeGioiThieu, phone: string, over: Record<string, unknown>): Promise<Thay> {
  const cho: number[] = [];
  const t = new Date(); // đồng hồ đóng băng — xem chú thích ở mock `dong-deu-thoi-gian`
  const pt: PhuThuocIntake = { now: () => t, choPhepTanSuat: async () => true, cho: async (ms) => void cho.push(ms), nhieuMs: () => 0 };
  const kq = await ham(
    { thanTho: JSON.stringify({ v: 1, token: sinhToken(), idempotencyKey: khoaMoi(), parentName: `${P} Phụ huynh`, phone, children: [{ fullName: `${P} Bé An` }], consentMarketing: true, ...over }), origin: null, ip: "10.88.0.1", userAgent: null },
    pt,
  );
  return { status: kq.status, thanHoacDich: JSON.stringify(kq.body), soLanCho: cho.length, header: `acao=${kq.acao}` };
}

// ───────────── sale-form (ẩn danh khi cờ bắt buộc đăng nhập TẮT) ─────────────
async function guiSaleForm(phone: string, over: Record<string, string>): Promise<Thay> {
  REC.cho = [];
  const r = await saleFormPost(
    new NextRequest("http://localhost/api/public/lead-intake/sale-form", {
      method: "POST",
      body: new URLSearchParams({ CustomField15: phone, CustomField25: `${P} Phụ huynh`, LastName: `${P} Bé`, ...over }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.77.${(REC.ip += 1) % 250}.${(REC.ip % 200) + 1}` },
    }),
  );
  return { status: r.status, thanHoacDich: await thanCuaResponse(r), soLanCho: REC.cho.length, header: headerCuaResponse(r) };
}

type Mong = { status: number; /** phía «chưa có» tạo lead mới? */ taoLead: boolean; soLanCho: 0 | 1; /** phía «đã có» đi nhánh TRÙNG SĐT (để dấu vết LeadDuplicate)? false = nó đã dừng sớm ở «eventId đã xử lý». */ dauVetTrung?: boolean };
type LeadDoc = { parentName: string; note: string | null; fbclid: string | null; referrer: string | null; landingPage: string | null; centerId: string | null; courseId: string | null };
/** `kiemLead`: khẳng định thêm về lead phía «chưa có» — để MỖI LỚP chặn có ca riêng (đai an toàn rút gọn sẽ làm rơi `note`/tracking, nên ca nào đòi giữ chúng thì đỏ khi lớp làm sạch/tra khoá bị gỡ dù đai vẫn cứu được status). */
type Ca = { ten: string; over: Record<string, unknown>; mong: Mong; truoc?: () => Promise<void>; kiemLead?: (l: LeadDoc) => void };

async function soHaiPhia(gui: (phone: string, over: Record<string, unknown>) => Promise<Thay>, ca: Ca, thanDich: (s: Thay) => void = () => {}) {
  const goc = await leadCoSan();
  await ca.truoc?.();
  const dupTruoc = await db.leadDuplicate.count({ where: { primaryLeadId: goc.id } });
  const moi = sdtMoi();
  const coSan = await gui(SDT_CO_SAN, ca.over);
  const chuaCo = await gui(moi, ca.over);
  // (1) hai phía GIỐNG HỆT nhau — status, thân/Location, số lần chờ
  expect(chuaCo, `${ca.ten}: SĐT chưa có phải ra Y HỆT SĐT đã có`).toEqual(coSan);
  // (2) status TUYỆT ĐỐI
  expect(coSan.status, `${ca.ten}: status tuyệt đối`).toBe(ca.mong.status);
  expect(coSan.soLanCho, `${ca.ten}: số lần chờ`).toBe(ca.mong.soLanCho);
  thanDich(coSan);
  // (3) ĐỐI CHỨNG DƯƠNG trong DB: hai phía thật sự đi hai nhánh khác nhau
  expect(await db.lead.count({ where: { phone: { in: bienThe(moi) }, deletedAt: null } }), `${ca.ten}: phía «chưa có» ${ca.mong.taoLead ? "phải" : "không được"} tạo lead`).toBe(ca.mong.taoLead ? 1 : 0);
  if (ca.kiemLead) {
    const l = await db.lead.findFirst({ where: { phone: { in: bienThe(moi) } }, select: { parentName: true, note: true, fbclid: true, referrer: true, landingPage: true, centerId: true, courseId: true } });
    expect(l, `${ca.ten}: lead phía «chưa có»`).not.toBeNull();
    ca.kiemLead(l!);
  }
  if ((ca.mong.status === 200 || ca.mong.status === 303) && ca.mong.dauVetTrung !== false) {
    expect(await db.leadDuplicate.count({ where: { primaryLeadId: goc.id } }) - dupTruoc, `${ca.ten}: phía «đã có» phải để lại dấu vết trùng (đối chứng dương)`).toBeGreaterThanOrEqual(1);
  } else {
    // 400 (chưa chạm khách) HOẶC replay eventId (dừng TRƯỚC khi rẽ nhánh theo SĐT): cả hai đều KHÔNG được để dấu vết trùng.
    expect(await db.leadDuplicate.count({ where: { primaryLeadId: goc.id } }) - dupTruoc, `${ca.ten}: không được rẽ nhánh theo SĐT`).toBe(0);
  }
}

const NUL = String.fromCharCode(0);
const LONE = "\ud800";
const LONE_THAP = "\udc00";
const DAI = "x".repeat(5_000);

const CA_LEADS: Ca[] = [
  { ten: "tên PH chứa NUL", over: { parentName: `${P} Ab${NUL}c` }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.parentName).toBe(`${P} Abc`) },
  { ten: "tên PH chứa lone surrogate (cao)", over: { parentName: `${P} Ab${LONE}c` }, mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "tên PH chứa lone surrogate (thấp)", over: { parentName: `${P} Ab${LONE_THAP}c` }, mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "ghi chú chứa NUL + surrogate", over: { note: `a${NUL}b${LONE}c` }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.note, "ghi chú được GIỮ (đã làm sạch), không rơi theo đai rút gọn").toBe("ab\ufffdc") },
  { ten: "mã click fbclid chứa NUL", over: { fbclid: `fb${NUL}x` }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.fbclid).toBe("fbx") },
  { ten: "referrer chứa surrogate", over: { referrer: `https://a.test/${LONE}` }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.referrer).toBe("https://a.test/\ufffd") },
  { ten: "landingPage là URL hợp lệ nhưng chứa surrogate", over: { landingPage: `https://a.test/${LONE}` }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.landingPage).toBe("https://a.test/\ufffd") },
  { ten: "ĐỐI CHỨNG: ref chứa NUL (đã an toàn từ trước — `resolveAffiliateByCode` chuẩn hoá mã; ca này xanh cả trên mã cũ)", over: { ref: `ab${NUL}c` }, mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "source chứa NUL", over: { source: `lien${NUL}he` }, mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "centerId không tồn tại (vi phạm khoá ngoại)", over: { centerId: "khong-co-co-so-nay", note: "giữ ghi chú" }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => expect(l.note, "tra khoá TRƯỚC khi rẽ nhánh ⇒ lưu bản đầy đủ, không phải bản rút gọn").toBe("giữ ghi chú") },
  { ten: "courseId không tồn tại (vi phạm khoá ngoại)", over: { courseId: "khong-co-khoa-nay", note: "giữ ghi chú" }, mong: { status: 200, taoLead: true, soLanCho: 1 }, kiemLead: (l) => (expect(l.courseId).toBeNull(), expect(l.note).toBe("giữ ghi chú")) },
  { ten: "eventId 5 KB (vỡ btree unique)", over: { eventId: DAI }, mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "eventId ĐÃ DÙNG bởi lead khác (vỡ UNIQUE ở nhánh mới)", over: { eventId: "evt-da-dung-peh-0001" }, truoc: async () => void (await db.lead.create({ data: { parentName: `${P} Giữ eventId`, phone: "0906999999", status: "MOI", source: "lien-he", eventId: "evt-da-dung-peh-0001", lastInboundAt: new Date() } })), mong: { status: 200, taoLead: false, soLanCho: 1, dauVetTrung: false } },
];

const SAU = <T extends Record<string, unknown>>(o: T) => o;
const CA_AFFILIATE: Ca[] = [
  { ten: "tên PH chứa lone surrogate", over: SAU({ parentName: `A${LONE}b` }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "tên PH chứa NUL", over: SAU({ parentName: `A${NUL}b` }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "tên con chứa lone surrogate", over: SAU({ children: [{ fullName: `Bé${LONE_THAP}` }] }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "ghi chú chứa lone surrogate", over: SAU({ note: `x${LONE}` }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "utm chứa lone surrogate", over: SAU({ utm: { utm_source: `fb${LONE}` } }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "email chứa lone surrogate", over: SAU({ email: `a${LONE}@b.co` }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "mã cơ sở chứa lone surrogate", over: SAU({ centerCode: `CS${LONE}` }), mong: { status: 400, taoLead: false, soLanCho: 0 } },
  { ten: "đối chứng: ký tự Unicode HỢP LỆ (tên có dấu + emoji cặp thay thế) vẫn là lead thường", over: SAU({ parentName: "Nguyễn Thị Ánh 😀" }), mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "ÉP CHỌN NGUỒN bật cho CS1 + khách chọn CS1 (`chanNhap` chỉ ném ở nhánh mới — đầu vào ẩn danh không với tới được)", over: SAU({ centerCode: "CS1" }), truoc: epChonNguonCs1, mong: { status: 200, taoLead: true, soLanCho: 1 } },
  { ten: "idempotencyKey ĐÃ DÙNG (vỡ UNIQUE eventId ở nhánh mới)", over: SAU({ idempotencyKey: "peh-khoa-da-dung-0001" }), truoc: async () => void (await db.lead.create({ data: { parentName: `${P} Giữ khoá`, phone: "0906999998", status: "MOI", source: "affiliate", eventId: "affiliate:peh-khoa-da-dung-0001", lastInboundAt: new Date() } })), mong: { status: 200, taoLead: false, soLanCho: 1, dauVetTrung: false } },
];

const CA_SALE_FORM: Ca[] = [
  { ten: "tên PH chứa lone surrogate", over: { CustomField25: `${P} A${LONE}b` }, mong: { status: 303, taoLead: true, soLanCho: 1 } },
  { ten: "ÉP CHỌN NGUỒN bật cho CS1 + khách chọn CS1 (`chanNhap` chỉ ném ở nhánh mới — đầu vào ẩn danh không với tới được)", over: { CustomField17: "1" }, truoc: epChonNguonCs1, mong: { status: 303, taoLead: true, soLanCho: 1 } },
  { ten: "tên con chứa lone surrogate", over: { LastName: `${P} Bé${LONE_THAP}` }, mong: { status: 303, taoLead: true, soLanCho: 1 } },
  { ten: "tên trường chứa NUL", over: { CustomField14: `a${NUL}b`, LastName: `${P} Bé` }, mong: { status: 303, taoLead: true, soLanCho: 1 } },
];

describe.skipIf(!RUN)("PHONE_ENUMERATION hai phía — mọi đường công khai nhận SĐT (reviewer 20/10/2026)", () => {
  beforeAll(async () => {
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["CENTER_SALES_CSM"] });
    // Khởi động nguội: lượt ĐẦU TIÊN nạp module + mở kết nối (hàng trăm ms) — làm nóng trước, ngoài mọi ca, để ca đầu không chạm timeout.
    await guiLeads(sdtMoi(), {});
    await don();
  }, 120_000);
  beforeEach(async () => {
    await don();
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.create({ data: { key: RATE_LIMIT_KEY, valueJson: 1000 } });
    clearSettingsCache();
    REC.cho = [];
    delete process.env.LEAD_INTAKE_REQUIRE_AUTH;
  }, CASE);
  afterAll(async () => {
    delete process.env.LEAD_INTAKE_REQUIRE_AUTH;
    await don();
    await db.$disconnect();
  }, 180_000);

  CA_LEADS.forEach((ca, i) => {
    it(`[PE-L${String(i + 1).padStart(2, "0")}] /api/leads — ${ca.ten}: SĐT đã có ≡ SĐT chưa có`, async () => {
      await soHaiPhia((phone, over) => guiLeads(phone, over), ca);
    }, CASE);
  });

  it("[PE-L99] /api/leads — đối chứng: phía «chưa có» với eventId đã dùng KHÔNG tạo lead thứ hai cho eventId đó (replay idempotent, không phải lỗi)", async () => {
    await leadCoSan();
    await db.lead.create({ data: { parentName: `${P} Giữ eventId`, phone: "0906999999", status: "MOI", source: "lien-he", eventId: "evt-da-dung-peh-0002", lastInboundAt: new Date() } });
    const r = await guiLeads(sdtMoi(), { eventId: "evt-da-dung-peh-0002" });
    expect(r.status).toBe(200);
    expect(await db.lead.count({ where: { eventId: "evt-da-dung-peh-0002" } })).toBe(1);
  }, CASE);

  for (const [ten, ham] of [["cờ Affiliate BẬT", xuLyIntakeGioiThieu], ["cờ Affiliate TẮT", xuLyIntakeKhiTatTheoDoi]] as const) {
    CA_AFFILIATE.forEach((ca, i) => {
      it(`[PE-A${ham === xuLyIntakeGioiThieu ? "1" : "2"}${String(i + 1).padStart(2, "0")}] intake Affiliate (${ten}) — ${ca.ten}: SĐT đã có ≡ SĐT chưa có`, async () => {
        await soHaiPhia((phone, over) => guiAffiliate(ham, phone, over), ca);
      }, CASE);
    });
  }

  describe("`ingestIntakeLead` trực tiếp — làm sạch ở CỬA VÀO của mọi đường (lớp riêng, không để lược đồ phía trên che)", () => {
    const chay = (phone: string, mapped: Partial<MappedLead>, ctx: Partial<IntakeContext>) =>
      ingestIntakeLead(
        { parentName: `${P} Trực tiếp`, phone, email: null, noteLines: [], warnings: [], children: [], ...mapped } as MappedLead,
        { source: "peh-truc-tiep", actorName: "test", chiGhiDauVetKhiTrung: false, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON, ...ctx } as IntakeContext,
      );
    const BIEN_THE: [string, Partial<MappedLead>][] = [
      ["tên con chứa lone surrogate", { children: [{ fullName: `${P} Bé${LONE}` }] }],
      ["tên PH chứa NUL", { parentName: `${P} A${NUL}b` }],
      ["ghi chú chứa lone surrogate", { noteLines: [`x${LONE_THAP}y`] }],
    ];
    for (const chiGhi of [false, true]) {
      BIEN_THE.forEach(([ten, mapped], i) => {
        it(`[PE-I${chiGhi ? "2" : "1"}${String(i + 1).padStart(2, "0")}] ingest (chiGhiDauVetKhiTrung=${chiGhi}) — ${ten}: SĐT đã có ⇒ ok · SĐT chưa có ⇒ ok VÀ lưu lead`, async () => {
          await leadCoSan();
          const coSan = await chay(SDT_CO_SAN, mapped, { chiGhiDauVetKhiTrung: chiGhi });
          const moi = sdtMoi();
          const chuaCo = await chay(`84${moi.slice(1)}`, mapped, { chiGhiDauVetKhiTrung: chiGhi });
          expect(coSan.ok, "phía đã có").toBe(true);
          expect(chuaCo.ok, "phía chưa có — đầu vào cấm không được làm vỡ riêng nhánh «mới»").toBe(true);
          expect(await db.lead.count({ where: { phone: { in: bienThe(moi) } } })).toBe(1);
        }, CASE);
      });
    }
  });

  it("[PE-C01] ĐỐI CHỨNG ép chọn nguồn: chính cửa `chanNhap` CÓ tách hai nhánh khi đầu vào gõ được nhãn nguồn lạ (chỉ biểu mẫu NỘI BỘ có ô đó, có đăng nhập) — chứng minh các ca «ÉP CHỌN» của affiliate/sale-form không xanh vì fixture không bật ép", async () => {
    await epChonNguonCs1();
    await leadCoSan();
    const mapped = { parentName: `${P} Nhãn lạ`, phone: "", email: null, noteLines: [], warnings: [], children: [], leadSource: "Hội thảo STEM tháng 10", centerHint: { kind: "code", value: "CS1" } } as unknown as MappedLead;
    const ctx = { source: "peh-truc-tiep", actorName: "test", chiGhiDauVetKhiTrung: false, tinHieuNguon: KHONG_CO_TIN_HIEU_NGUON } as IntakeContext;
    const coSan = await ingestIntakeLead({ ...mapped, phone: SDT_CO_SAN }, ctx);
    const chuaCo = await ingestIntakeLead({ ...mapped, phone: `84${sdtMoi().slice(1)}` }, ctx);
    expect(coSan.ok, "phía đã có đi nhánh trùng, không chạm cửa chặn").toBe(true);
    expect(chuaCo.ok, "phía chưa có bị cửa `chanNhap` chặn").toBe(false);
    expect(chuaCo.error).toMatch(/không có trong danh sách nguồn/);
  }, CASE);

  describe("nhánh TRÙNG của /api/leads không chép chữ tự do của kẻ lạ vào hồ sơ người khác (LOW)", () => {
    const noiDungTimeline = async (leadId: string) => (await db.leadActivity.findMany({ where: { leadId }, select: { content: true } })).map((a) => a.content ?? "").join("\n");
    it("[PE-D01] source tuỳ ý của kẻ lạ ⇒ KHÔNG nằm trong dòng thời gian / LeadDuplicate.source của lead nạn nhân (nhãn cố định `web`)", async () => {
      const goc = await leadCoSan();
      const r = await guiLeads(SDT_CO_SAN, { source: "Goi 0909 nhan uu dai hoc phi" });
      expect(r.status).toBe(200);
      expect(await noiDungTimeline(goc.id)).not.toContain("nhan uu dai");
      expect(await noiDungTimeline(goc.id), "đối chứng dương: dấu vết trùng vẫn được ghi").toContain('từ nguồn "web"');
      expect((await db.leadDuplicate.findMany({ where: { primaryLeadId: goc.id } })).map((d) => d.source)).toEqual(["web"]);
    }, CASE);

    it("[PE-D02] khoá định tuyến ĐÃ BIẾT (mã trang công khai) vẫn được ghi đúng — không làm mất tín hiệu thật", async () => {
      const goc = await leadCoSan();
      expect((await guiLeads(SDT_CO_SAN, { source: "consult-modal" })).status).toBe(200);
      expect(await noiDungTimeline(goc.id)).toContain('từ nguồn "consult-modal"');
    }, CASE);

    it("[PE-D03] trần dấu vết trùng: 8 lượt gửi lại trong ngày ⇒ tất cả 200 y hệt nhau nhưng chỉ GHI 5 dấu vết lên lead nạn nhân (chống spam hồ sơ biết SĐT)", async () => {
      const goc = await leadCoSan();
      const kq: Thay[] = [];
      for (let i = 0; i < 8; i += 1) kq.push(await guiLeads(SDT_CO_SAN, {}));
      for (const k of kq) expect(k).toEqual(kq[0]);
      expect(kq[0]!.status).toBe(200);
      expect(await db.leadDuplicate.count({ where: { primaryLeadId: goc.id } })).toBe(5);
    }, CASE);
  });

  describe("đai an toàn — lỗi GHI do đầu vào ở nhánh «mới» vẫn ra y hệt nhánh «trùng» (lớp 4)", () => {
    afterEach(() => vi.restoreAllMocks());
    /** Ép ĐÚNG lần ghi lead (callback chứa `lead.create`) ném `err` MỘT lần — mô phỏng một lỗi do đầu vào mà ba lớp trước chưa lường tới. */
    const epLoiGhiLeadMotLan = (err: Error, tuyChon: { lanNem?: number; truocKhiNem?: () => Promise<void> } = {}) => {
      const that = db.$transaction.bind(db) as (...a: unknown[]) => Promise<unknown>;
      let daNem = 0;
      const lanNem = tuyChon.lanNem ?? 1;
      return vi.spyOn(db, "$transaction").mockImplementation(((fn: unknown, ...rest: unknown[]) => {
        if (daNem < lanNem && typeof fn === "function" && fn.toString().includes("lead.create")) {
          daNem += 1;
          return (async () => {
            await tuyChon.truocKhiNem?.();
            throw err;
          })();
        }
        return that(fn, ...rest);
      }) as never);
    };
    const loiFk = () => new Prisma.PrismaClientKnownRequestError("FK", { code: "P2003", clientVersion: "t" });

    it("[PE-B01] /api/leads — lỗi do đầu vào (khoá ngoại) khi lưu bản đầy đủ ⇒ thử lại bản RÚT GỌN: 200 y hệt phía «đã có», lead VẪN được lưu (không mất khách)", async () => {
      await leadCoSan();
      const coSan = await guiLeads(SDT_CO_SAN, {});
      const spy = epLoiGhiLeadMotLan(loiFk());
      const moi = sdtMoi();
      const chuaCo = await guiLeads(moi, { parentName: `${P} Rút gọn`, note: "ghi chú sẽ rơi khỏi bản rút gọn" });
      expect(spy).toHaveBeenCalled();
      expect(chuaCo).toEqual(coSan);
      expect(chuaCo.status).toBe(200);
      const lead = await db.lead.findFirst({ where: { phone: { in: bienThe(moi) } } });
      expect(lead, "đối chứng dương: lead được lưu bằng bản rút gọn").not.toBeNull();
      expect(lead?.parentName).toBe(`${P} Rút gọn`);
      expect(lead?.note, "bản rút gọn bỏ ghi chú").toBeNull();
    }, CASE);

    it("[PE-B02] /api/leads — UNIQUE khi lead giữ eventId ĐÃ CÓ THẬT (hai lượt gửi lặp đua nhau, lượt kia đã lưu) ⇒ phát lại như thành công, KHÔNG thử lại (thử lại sẽ ĐẺ LEAD THỨ HAI cho cùng một lần gửi)", async () => {
      const spy = epLoiGhiLeadMotLan(new Prisma.PrismaClientKnownRequestError("UQ", { code: "P2002", clientVersion: "t" }), {
        // Lượt kia THẮNG cuộc đua: nó lưu lead giữ eventId NGAY TRƯỚC khi lượt này vỡ UNIQUE.
        truocKhiNem: async () => void (await db.lead.create({ data: { parentName: `${P} Thắng đua`, phone: "0906999997", status: "MOI", source: "lien-he", eventId: "evt-dua-peh-0001", lastInboundAt: new Date() } })),
      });
      const moi = sdtMoi();
      // `eventId` phải sinh RA SAU pre-check: pre-check thấy chưa ai giữ ⇒ đi tiếp ⇒ vỡ UNIQUE ở lần ghi (đúng thứ tự của cuộc đua thật).
      const r = await guiLeads(moi, { eventId: "evt-dua-peh-0001" });
      expect(spy).toHaveBeenCalled();
      expect(r.status).toBe(200);
      expect(r.soLanCho).toBe(1);
      expect(await db.lead.count({ where: { phone: { in: bienThe(moi) } } }), "không tạo lead thứ hai cho cùng một lần gửi").toBe(0);
      expect(await db.lead.count({ where: { eventId: "evt-dua-peh-0001" } })).toBe(1);
    }, CASE);

    it("[PE-B02b] /api/leads — UNIQUE nhưng KHÔNG lead nào giữ eventId (đến từ chỗ khác trong giao dịch) ⇒ KHÔNG được trả 200 rỗng: thử bản rút gọn và lead VẪN được lưu (không mất lead CÂM)", async () => {
      epLoiGhiLeadMotLan(new Prisma.PrismaClientKnownRequestError("UQ", { code: "P2002", clientVersion: "t" }));
      const loi = vi.spyOn(console, "error").mockImplementation(() => {});
      const moi = sdtMoi();
      const r = await guiLeads(moi, {});
      expect(r.status).toBe(200);
      expect(await db.lead.count({ where: { phone: { in: bienThe(moi) } } }), "lead được lưu bằng bản rút gọn").toBe(1);
      expect(loi.mock.calls.some((c) => String(c[0]).includes("KHÔNG có lead nào giữ eventId")), "và có log").toBe(true);
    }, CASE);

    it("[PE-B02c] /api/leads — UNIQUE không có chủ VÀ bản rút gọn cũng vỡ ⇒ 500 có log (lỗi KÊU, không câm)", async () => {
      epLoiGhiLeadMotLan(new Prisma.PrismaClientKnownRequestError("UQ", { code: "P2002", clientVersion: "t" }), { lanNem: 2 });
      vi.spyOn(console, "error").mockImplementation(() => {});
      const moi = sdtMoi();
      const r = await guiLeads(moi, {});
      expect(r.status).toBe(500);
      expect(await db.lead.count({ where: { phone: { in: bienThe(moi) } } })).toBe(0);
    }, CASE);

    it("[PE-B03] /api/leads — lỗi HẠ TẦNG (không phải do đầu vào) vẫn là 500 'Lỗi hệ thống' — đai an toàn không nuốt lỗi hệ thống", async () => {
      epLoiGhiLeadMotLan(new Prisma.PrismaClientKnownRequestError("pool", { code: "P2024", clientVersion: "t" }));
      const r = await guiLeads(sdtMoi(), {});
      expect(r.status).toBe(500);
      expect(JSON.parse(r.thanHoacDich)).toEqual({ ok: false, error: "Lỗi hệ thống" });
    }, CASE);

    it("[PE-B04] intake Affiliate — lỗi do đầu vào khi lưu bản đầy đủ ⇒ thử lại bản RÚT GỌN: 200 y hệt phía «đã có», lead VẪN được lưu", async () => {
      await leadCoSan();
      const coSan = await guiAffiliate(xuLyIntakeKhiTatTheoDoi, SDT_CO_SAN, {});
      const spy = epLoiGhiLeadMotLan(loiFk());
      const moi = sdtMoi();
      const chuaCo = await guiAffiliate(xuLyIntakeKhiTatTheoDoi, moi, { parentName: `${P} Đối tác`, children: [{ fullName: `${P} Bé Bình` }] });
      expect(spy).toHaveBeenCalled();
      expect(chuaCo).toEqual(coSan);
      expect(chuaCo.status).toBe(200);
      const lead = await db.lead.findFirst({ where: { phone: { in: bienThe(moi) } }, include: { children: true } });
      expect(lead, "đối chứng dương: lead được lưu bằng bản rút gọn").not.toBeNull();
      expect(lead?.children, "bản rút gọn bỏ tên con").toHaveLength(0);
    }, CASE);
  });

  CA_SALE_FORM.forEach((ca, i) => {
    it(`[PE-S${String(i + 1).padStart(2, "0")}] sale-form ẨN DANH (cờ đăng nhập TẮT) — ${ca.ten}: SĐT đã có ≡ SĐT chưa có`, async () => {
      process.env.LEAD_INTAKE_REQUIRE_AUTH = "false";
      await soHaiPhia((phone, over) => guiSaleForm(phone, over as Record<string, string>), ca);
    }, CASE);
  });
});
