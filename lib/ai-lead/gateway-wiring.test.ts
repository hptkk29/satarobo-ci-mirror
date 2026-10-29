// @vitest-environment node
// lib/ai-lead/gateway-wiring.test.ts — LƯỚI GHIM MÃ NGUỒN của cổng AI Lead (lát G). Mã ca: [AIL-GW-*].
//
// Dùng cho những luật dạng "lời gọi này phải có / không được có" mà test hành vi KHÔNG chứng minh được (CLAUDE.md, mẫu "lưới ghim mã nguồn").
// Luật 11: neo vào BIỂU THỨC ĐIỀU KIỆN và SỐ LẦN khớp, không neo vào chỗ đặt `await`; và đọc mã ĐÃ BỎ CHÚ THÍCH (chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm).
// Luật 14: lưới nào cũng phải được CẤY LẠI lỗi và thấy đỏ — xem bảng cấy ở báo cáo lát G.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { boChuThich } from "./ho-tro-test";

const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const ROUTES = [
  ["catalog", "GET", "catalog", "xuLyCatalog"],
  ["lead-intakes", "POST", "leadIntakes", "xuLyLeadIntake"],
  ["handoffs", "POST", "handoffs", "xuLyHandoff"],
  ["incidents", "POST", "incidents", "xuLyIncident"],
  ["heartbeats", "POST", "heartbeats", "xuLyHeartbeat"],
] as const;

describe("[AIL-GW-01] năm route MỎNG: một lời gọi `chayEndpointAgent`, đúng endpoint, đúng dịch vụ, đúng phương thức", () => {
  it.each(ROUTES)("%s", (dir, method, endpoint, dichVu) => {
    const ma = doc(`app/api/ai-lead-agent/v1/${dir}/route.ts`);
    expect(dem(ma, /\bchayEndpointAgent\(/g), "đúng MỘT lời gọi vỏ").toBe(1);
    expect(dem(ma, new RegExp(`chayEndpointAgent\\(req, "${endpoint}",`, "g"))).toBe(1);
    expect(dem(ma, new RegExp(`\\b${dichVu}\\b`, "g")), `route phải dùng ${dichVu}`).toBeGreaterThanOrEqual(2); // import + gọi
    const xuat = [...ma.matchAll(/export (?:async function|const) (\w+)/g)].map((m) => m[1]).sort();
    expect(xuat, "chỉ xuất đúng một phương thức + ba cấu hình").toEqual([method, "dynamic", "maxDuration", "runtime"].sort());
    expect(ma).toMatch(/export const runtime = "nodejs";/);
    expect(ma).toMatch(/export const dynamic = "force-dynamic";/);
    expect(ma, "route mỏng: không `db`, không zod, không NextResponse trần").not.toMatch(/@\/lib\/db|NextResponse\.json|from "zod"/);
  });
});

/** Tệp nằm trên ĐƯỜNG PHẢN HỒI của Agent — không được đọc CRM (N1). */
const DUONG_PHAN_HOI = [
  "lib/ai-lead/xac-thuc.ts",
  "lib/ai-lead/tu-choi.ts",
  "lib/ai-lead/dich-vu/intake.ts",
  "lib/ai-lead/dich-vu/handoff.ts",
  "lib/ai-lead/dich-vu/incident.ts",
  "lib/ai-lead/dich-vu/heartbeat.ts",
  "lib/ai-lead/dich-vu/catalog.ts",
  "lib/ai-lead/dich-vu/idempotency.ts",
  "lib/ai-lead/dich-vu/hoi-thoai.ts",
  "lib/ai-lead/trang-thai.ts",
  "lib/ai-lead/trang-thai-handoff.ts",
];

describe("[AIL-GW-02] N1: đường phản hồi KHÔNG import và KHÔNG gọi model CRM", () => {
  it.each(DUONG_PHAN_HOI)("%s", (tep) => {
    const ma = doc(tep);
    expect(ma, "import module CRM/nguồn/tiền").not.toMatch(/from "@\/lib\/(?:lead|crm|nguon|orders|finance|students|payments|inbox|hoa-hong|enrollment)\b/);
    expect(ma, "import tao-lead (CRM) vào đường phản hồi").not.toMatch(tep.endsWith("intake.ts") ? /(?!)/ : /from "\.\/tao-lead"/);
    const MODEL_CRM = "lead|leadChild|leadTouchpoint|leadAttribution|contact|student|parent|order|orderItem|payment|enrollment|course|customer|invoice|receipt|user|staffNotification";
    expect(ma, "truy cập model CRM").not.toMatch(new RegExp(`\\b(?:db|tx|prisma)\\.(?:${MODEL_CRM})\\b`));
    // Dạng ép kiểu để lách (`(tx as unknown as {…}).lead.count(…)`) — phép cấy M4 đã lọt qua regex cũ.
    expect(ma, "truy cập model CRM qua ép kiểu").not.toMatch(new RegExp(`\\)\\.(?:${MODEL_CRM})\\.(?:count|find\\w*|create\\w*|update\\w*|delete\\w*|upsert|aggregate|groupBy)\\(`));
  });
  it("intake.ts chỉ gọi `taoLeadTuHoSo` bên trong HÀM VIỆC NỀN (`tuTaoLeadRoiBao`), đúng một chỗ", () => {
    const ma = doc("lib/ai-lead/dich-vu/intake.ts");
    expect(dem(ma, /\btaoLeadTuHoSo\(/g)).toBe(1);
    const thanHam = ma.slice(ma.indexOf("export async function tuTaoLeadRoiBao"));
    expect(thanHam).toMatch(/taoLeadTuHoSo\(/);
    expect(ma.slice(0, ma.indexOf("export async function tuTaoLeadRoiBao"))).not.toMatch(/taoLeadTuHoSo\(/);
  });
  it("intake.ts chỉ đưa việc nền qua `lenLichNen` (không `await` thẳng thông báo/tạo lead trong đường giao dịch)", () => {
    const ma = doc("lib/ai-lead/dich-vu/intake.ts");
    expect(dem(ma, /deps\.lenLichNen\(/g)).toBe(2);
    // Phần TRƯỚC hàm việc nền = đường phản hồi (hàm `tuTaoLeadRoiBao` tự `await` thông báo là đúng — nó chạy SAU phản hồi).
    const duongPhanHoi = ma.slice(0, ma.indexOf("export async function tuTaoLeadRoiBao"));
    expect(duongPhanHoi, "không await thẳng việc nền trong đường phản hồi").not.toMatch(/await\s+(?:baoHoSoCanXuLy|tuTaoLeadRoiBao)\(/);
  });
});

describe("[AIL-GW-03] xac-thuc.ts: thứ tự các lời gọi then chốt (nonce SAU chữ ký · giờ · active · PROD · hạn mức)", () => {
  const ma = doc("lib/ai-lead/xac-thuc.ts");
  const at = (re: RegExp) => {
    const m = re.exec(ma);
    expect(m, `không thấy ${re}`).not.toBeNull();
    return m!.index;
  };
  it("đúng MỘT lần ghi nonce, MỘT lần so chữ ký, MỘT lần tra agent", () => {
    expect(dem(ma, /\.aiLeadNonce\.create\(/g)).toBe(1);
    expect(dem(ma, /\bsafeEqual\(/g)).toBe(1);
    expect(dem(ma, /\.aiLeadAgent\.findUnique\(/g)).toBe(1);
    expect(dem(ma, /\bkiemLechGio\(/g)).toBe(1);
  });
  it("trình tự trong mã: cờ → master key → hợp đồng → query/header → thân → IP → agent → chữ ký → giờ → active → PROD → nhóm → nonce → JSON → page", () => {
    const thuTu = [
      at(/isAiLeadGatewayEnabled\(\)/),
      at(/masterKeyCoSan\(\)/),
      at(/kiemHopDong\(/),
      at(/req\.nextUrl\.search/),
      at(/docThanCoTran\(req,/),
      at(/laJson\(req\.headers/),
      at(/ai-lead:ip:/),
      at(/\.aiLeadAgent\.findUnique\(/),
      at(/\bsafeEqual\(/),
      at(/\bkiemLechGio\(/),
      at(/!agent\.active/),
      at(/congProd\(\)/),
      at(/ai-lead:\$\{nhom\}:/),
      at(/\.aiLeadNonce\.create\(/),
      at(/JSON\.parse\(/),
      at(/PAGE_NOT_ALLOWED/),
      at(/PAGE_PAUSED/),
      at(/contractStatus === "INCOMPATIBLE"/),
      at(/ai-lead:psid:/),
    ];
    expect(thuTu, "thứ tự lời gọi bị đảo").toEqual([...thuTu].sort((a, b) => a - b));
  });
  it("so chữ ký: `!agent || !khop` đứng NGAY SAU lần so — không rẽ nhánh sớm trước khi ký", () => {
    expect(ma).toMatch(/const khop = safeEqual\(kyChuoi\(khoa, chuoi\), hd\.sig\);\s*if \(!agent \|\| !khop\) return loi\("BAD_SIGNATURE"\);/);
  });
  it("khoá hạn mức dùng HMAC của psid, không psid thô", () => {
    expect(ma).toMatch(/kyChuoi\(khoa, `psid:\$\{psid\}`\)/);
    expect(ma).not.toMatch(/ai-lead:psid:\$\{agent\.id\}:\$\{psid\}/);
  });
  it("bước 4 (thân) đứng TRƯỚC bước 5 (Content-Type)", () => {
    expect(at(/docThanCoTran\(req,/)).toBeLessThan(at(/laJson\(req\.headers/));
  });
});

describe("[AIL-GW-04] log: không bao giờ in đối tượng lỗi / message lỗi (lỗi Prisma có thể kèm giá trị cột)", () => {
  const TEP = [
    "lib/ai-lead/xac-thuc.ts",
    "lib/ai-lead/dich-vu/nen.ts",
    "lib/ai-lead/dich-vu/thong-bao.ts",
    "lib/ai-lead/dich-vu/don-dep.ts",
    "lib/ai-lead/dich-vu/intake.ts",
    "lib/ai-lead/dich-vu/handoff.ts",
    "lib/ai-lead/dich-vu/incident.ts",
    "lib/ai-lead/dich-vu/heartbeat.ts",
    "lib/ai-lead/dich-vu/catalog.ts",
    "lib/ai-lead/dich-vu/hoi-thoai.ts",
    "lib/ai-lead/dich-vu/idempotency.ts",
    "app/api/cron/ai-lead-don-dep/route.ts",
    ...ROUTES.map(([d]) => `app/api/ai-lead-agent/v1/${d}/route.ts`),
  ];
  it.each(TEP)("%s", (tep) => {
    const ma = doc(tep);
    for (const m of ma.matchAll(/console\.\w+\(([^;]*)\)/g)) {
      const doi = m[1]!.replace(/maLoiNoiBo\(err\)/g, ""); // `maLoiNoiBo` chỉ trả MÃ (Pxxxx / tên lớp lỗi), không bao giờ message
      expect(doi, `console.* nhận đối tượng lỗi: ${m[0].slice(0, 120)}`).not.toMatch(/\berr\b|\.message\b|\.stack\b/);
      expect(doi.trim().startsWith("`") || doi.trim().startsWith('"'), `console.* phải bắt đầu bằng chuỗi: ${m[0].slice(0, 120)}`).toBe(true);
    }
  });
});

describe("[AIL-GW-05] cron: route dùng withCron + đồng hồ dạng HÀM; hàm dọn đúng ngưỡng", () => {
  it("route: withCron đúng tên, đồng hồ HÀM, chỉ xuất GET + cấu hình", () => {
    const ma = doc("app/api/cron/ai-lead-don-dep/route.ts");
    expect(dem(ma, /\bwithCron\("ai-lead-don-dep",/g)).toBe(1);
    expect(dem(ma, /chayDonDep\(\{ dongHo: \(\) => new Date\(\) \}\)/g)).toBe(1);
    expect(dem(ma, /\bnow:/g)).toBe(0);
    expect([...ma.matchAll(/export const (\w+)/g)].map((m) => m[1]).sort()).toEqual(["GET", "dynamic", "maxDuration", "runtime"]);
  });
  it("don-dep.ts: nonce xoá theo `nonceTtlHieuLucMs` (không riêng nonceTtlMinutes); EXPIRED lặp lại ĐÚNG `where` trong UPDATE có điều kiện", () => {
    const ma = doc("lib/ai-lead/dich-vu/don-dep.ts");
    expect(dem(ma, /nonceTtlHieuLucMs\(c\)/g)).toBe(1);
    expect(ma).not.toMatch(/nonceTtlMinutes/);
    expect(ma).toMatch(/updateMany\(\{\s*where: \{ \.\.\.dk, id: d\.id \}/);
    expect(ma).toMatch(/const dk = \{ state: \{ in: \[\.\.\.TRANG_THAI_CO_THE_HET_HAN\] \}, claimedById: null, leadId: null, updatedAt: \{ lt: cat \} \}(?: satisfies [\w.]+)?;/);
  });
});

describe("[AIL-GW-05b] FIX-04: giai đoạn tự đóng ASSIGNMENT_PENDING trong cron dọn", () => {
  // Neo vào LỜI GỌI/biểu thức trên mã đã bỏ chú thích (luật 14/11): không neo vào dòng import hay chú thích giải thích bản vá.
  const ma = doc("lib/ai-lead/dich-vu/don-dep.ts"); // `doc` đã bỏ chú thích
  it("chạy trong giaiDoan riêng; đọc lại lead TRONG giao dịch với chủ còn hoạt động + lead chưa xoá; UPDATE có điều kiện id+version+state; không chạm bảng lead", () => {
    expect(dem(ma, /giaiDoan\("assignment-pending"/g)).toBe(1);
    expect(dem(ma, /tx\.lead\.findFirst\(/g)).toBe(1);
    expect(ma).toMatch(/deletedAt: null, assignedToId: \{ not: null \}, assignedTo: \{ is: \{ isActive: true, deletedAt: null \} \}/);
    expect(ma).toMatch(/updateMany\(\{\s*where: \{ id: d\.id, version: d\.version, state: "ASSIGNMENT_PENDING" \}/);
    expect(dem(ma, /\btx\.lead\.(?:update|updateMany|create|delete|deleteMany|upsert)\(/g), "tự đóng KHÔNG được sửa lead (không chia sale)").toBe(0);
    expect(dem(ma, /action: "CLOSE_EXCEPTION_AUTO"/g)).toBe(1);
  });
});

describe("[AIL-GW-05d] hằng cứng đã thành tham số ai.*", () => {
  it("ket-noi.ts / don-dep.ts đọc ttl · ngưỡng ngắt · giữ idempotency từ cấu hình, không còn hằng *_TAM_MS / GIU_REQUEST_NGAY", () => {
    const kn = doc("lib/ai-lead/dich-vu/ket-noi.ts");
    expect(kn).toMatch(/nguongNgatKetNoiMs: cai\.disconnectHours \* GIO_MS/);
    expect(kn).toMatch(/ttlKiemChungMs: cai\.verifyTtlHours \* GIO_MS/);
    expect(kn).not.toMatch(/TTL_KIEM_CHUNG_TAM_MS|NGUONG_NGAT_TAM_MS/);
    const dd = doc("lib/ai-lead/dich-vu/don-dep.ts");
    expect(dd).toMatch(/c\.requestRetentionDays \* NGAY_MS/);
    expect(dd).not.toMatch(/GIU_REQUEST_NGAY/);
  });
});

describe("[AIL-GW-05c] Rule Builder: điểm nối vào intake + engine THUẦN", () => {
  // Neo vào LỜI GỌI / biểu thức trên mã đã bỏ chú thích (`doc`), không neo vào dòng import (luật 14).
  it("intake.ts: đọc bộ quy tắc MỘT lần, chỉ qua hàm bọc có try/catch (lỗi đọc không bao giờ làm hỏng phản hồi Agent) và lỗi đọc = HỎNG ⇒ thu hẹp KHÔNG fail-open; SLA + thu hẹp + ruleSetVersion đều qua engine", () => {
    const ma = doc("lib/ai-lead/dich-vu/intake.ts");
    expect(dem(ma, /await docBoQuyTacAnToan\(\)/g)).toBe(1);
    expect(dem(ma, /await docTrangThaiBoQuyTac\(\)/g)).toBe(1);
    const ham = ma.slice(ma.indexOf("async function docBoQuyTacAnToan"));
    expect(ham).toMatch(/try \{\s*return await docTrangThaiBoQuyTac\(\);\s*\} catch \(err\) \{/);
    const thanCatch = /catch \(err\) \{([\s\S]*?)\n {2}\}/.exec(ham)?.[1] ?? "";
    expect(thanCatch, "catch phải ghi log mã và trả HỎNG (không phải «chưa có quy tắc»)").toMatch(/console\.error\([\s\S]*?\);\s*return \{ ban: null, hong: true \};/);
    // thu hẹp KHÔNG fail-open: quy tắc đọc hỏng/không đọc được thì không tự tạo lead (đi đường nhân viên duyệt)
    expect(dem(ma, /!boQuyTacHong &&/g)).toBe(1);
    expect(ma.indexOf("!boQuyTacHong &&")).toBeLessThan(ma.indexOf("thuHepTuTao(timQuyTacAuto("));
    expect(thanCatch, "catch KHÔNG được ném tiếp").not.toMatch(/\bthrow\b/);
    expect(dem(ma, /hanSlaTheoQuyTac\(/g)).toBe(1);
    expect(dem(ma, /thuHepTuTao\(timQuyTacAuto\(/g)).toBe(1);
    expect(dem(ma, /ruleSetVersion: boQuyTac\?\.version \?\? null/g)).toBe(2);
    // thu hẹp là VÀ-thêm sau cổng gốc, không phải thay thế: cổng `choPhepTuTaoLead` vẫn có mặt và đứng trước.
    expect(ma.indexOf("choPhepTuTaoLead({")).toBeLessThan(ma.indexOf("thuHepTuTao("));
    expect(ma).not.toMatch(/ctx\.cai\.slaClaimMinutes|ctx\.cai\.slaResolveMinutes/); // hạn chỉ qua engine (tham số ai.* là đường lùi BÊN TRONG engine)
  });
  it("bo-quy-tac.ts (engine) THUẦN: không import runtime nào, không DB/env/đồng hồ/ngẫu nhiên", () => {
    const ma = doc("lib/ai-lead/dich-vu/bo-quy-tac.ts");
    expect([...ma.matchAll(/^import\s+(?!type)[^\n]*from\s+"([^"]+)"/gm)].map((m) => m[1])).toEqual([]);
    expect(ma).not.toMatch(/\bprocess\.env\b|\bnew Date\(|\bDate\.now\(|\bMath\.random\(|\bdb\./);
  });
  it("bo-quy-tac-db.ts: chỉ INSERT bảng phiên bản (không update/delete), mỗi lần chụp ghi audit trong cùng giao dịch", () => {
    const ma = doc("lib/ai-lead/dich-vu/bo-quy-tac-db.ts");
    expect(dem(ma, /aiLeadRuleSet\.create\(/g)).toBe(1);
    expect(ma).not.toMatch(/aiLeadRuleSet\.(update|updateMany|delete|deleteMany|upsert)\(/);
    expect(dem(ma, /writeAudit\(\{\s*tx,/g)).toBe(1);
  });
});

describe("[AIL-GW-06] idempotency + tranh chấp: câu ĐẦU của giao dịch là giữ khoá; hội thoại bị KHOÁ HÀNG trước mọi phép ghi hồ sơ", () => {
  it.each(["intake", "handoff", "incident"])("%s.ts: giữ khoá trước, ghi phản hồi trong CÙNG giao dịch, đúng một lần mỗi loại", (ten) => {
    const ma = doc(`lib/ai-lead/dich-vu/${ten}.ts`);
    expect(dem(ma, /\bgiuKhoaTrongTx\(tx,/g)).toBe(1);
    expect(dem(ma, /\bghiPhanHoiTrongTx\(tx,/g)).toBe(1);
    expect(dem(ma, /\bgiaoDichCoThuLai\(/g)).toBe(1);
    expect(ma.indexOf("giuKhoaTrongTx(tx,")).toBeLessThan(ma.indexOf("ghiPhanHoiTrongTx(tx,"));
    // Cổng "đã có" trả ra TRƯỚC mọi phép ghi nghiệp vụ (luật rollback: từ chối đứng trước phép ghi đầu tiên).
    const batDau = ma.indexOf("giuKhoaTrongTx(tx,");
    expect(ma.slice(batDau).search(/\.(?:create|update|upsert|updateMany|createMany)\(/)).toBeGreaterThan(ma.slice(batDau).search(/g\.loai === "phat-lai"/));
  });
  it("intake.ts: khoá hàng hội thoại SAU khoá idempotency và TRƯỚC mọi đọc/ghi hồ sơ", () => {
    const ma = doc("lib/ai-lead/dich-vu/intake.ts");
    expect(dem(ma, /\bkhoaHoiThoai\(tx,/g)).toBe(1);
    const iKhoa = ma.indexOf("khoaHoiThoai(tx,");
    expect(ma.indexOf("giuKhoaTrongTx(tx,")).toBeLessThan(iKhoa);
    expect(ma.slice(0, iKhoa), "đọc/ghi hồ sơ trước khi khoá hàng").not.toMatch(/tx\.aiLeadDraft\./);
    expect(ma.slice(iKhoa)).toMatch(/tx\.aiLeadDraft\.findFirst\(/);
  });
  it("handoff.ts: khoá hàng hội thoại SAU khoá idempotency và TRƯỚC khi đổi ownerState / chuyển hồ sơ", () => {
    const ma = doc("lib/ai-lead/dich-vu/handoff.ts");
    expect(dem(ma, /\bkhoaHoiThoai\(tx,/g)).toBe(1);
    const dau = ma.indexOf("export async function xuLyHandoff");
    const iKhoa = ma.indexOf("khoaHoiThoai(tx,");
    expect(ma.indexOf("giuKhoaTrongTx(tx,")).toBeLessThan(iKhoa);
    expect(ma.slice(dau, iKhoa)).not.toMatch(/tx\.aiLeadConversation\.|chuyenHoSoThuThapSangNguoi\(tx/);
    expect(ma.slice(iKhoa)).toMatch(/chuyenHoSoThuThapSangNguoi\(tx,/);
  });
  it("hoi-thoai.ts: khoá bằng `FOR UPDATE`; idempotency.ts: INSERT … ON CONFLICT qua `skipDuplicates: true`", () => {
    expect(doc("lib/ai-lead/dich-vu/hoi-thoai.ts")).toMatch(/FOR UPDATE/);
    expect(dem(doc("lib/ai-lead/dich-vu/idempotency.ts"), /skipDuplicates: true/g)).toBe(1);
  });
  it("handoff: UPDATE có điều kiện `ownerState = AI_ACTIVE` mới được QUEUED; đổi 0 dòng ⇒ chạy lại cả giao dịch", () => {
    const ma = doc("lib/ai-lead/dich-vu/handoff.ts");
    expect(ma).toMatch(/updateMany\(\{\s*where: \{ id: h\.id, ownerState: "AI_ACTIVE" \}/);
    expect(ma).toMatch(/if \(r\.count !== 1\) throw new ChayLaiGiaoDich\(/);
  });
  it("intake: cập nhật hồ sơ có điều kiện `version`; trượt ⇒ chạy lại", () => {
    const ma = doc("lib/ai-lead/dich-vu/intake.ts");
    expect(ma).toMatch(/updateMany\(\{\s*where: \{ id: mo\.id, version: mo\.version \}/);
    expect(ma).toMatch(/if \(r\.count !== 1\) throw new ChayLaiGiaoDich\(/);
  });
  it("incident: severity chỉ nâng bằng UPDATE có điều kiện trên mức thấp hơn", () => {
    expect(doc("lib/ai-lead/dich-vu/incident.ts")).toMatch(/updateMany\(\{ where: \{ id: row\.id, severity: \{ in: mucThapHon\(b\.severity\) \} \}/);
  });
});


describe("[AIL-GW-RC] bộ đếm yêu cầu bị từ chối: nối đúng chỗ, riêng tư theo cấu trúc", () => {
  it("xac-thuc.ts: MỘT lời ghi nhận trong `loi`, bật theo ai.rejectLogEnabled đọc từ cài đặt, agentId chỉ đặt SAU lời từ chối BAD_SIGNATURE", () => {
    const ma = doc("lib/ai-lead/xac-thuc.ts");
    expect(dem(ma, /\bghiNhanTuChoi\(/g), "đúng MỘT lời gọi").toBe(1);
    expect(ma).toMatch(/ghiNhanTuChoi\(\{ batGhi: batGhiTuChoi, endpoint: x\.endpoint, ma, agentId: agentDaKy, nowMs \}\)/);
    expect(dem(ma, /batGhiTuChoi = cai\.rejectLogEnabled === true;/g)).toBe(1);
    expect(dem(ma, /\bagentDaKy = /g), "agentDaKy chỉ được GÁN một lần").toBe(1);
    const iSai = ma.indexOf('if (!agent || !khop) return loi("BAD_SIGNATURE");');
    const iGan = ma.indexOf("agentDaKy = agent.id;");
    expect(iSai).toBeGreaterThan(0);
    expect(iGan, "gán agentDaKy phải đứng SAU cổng chữ ký").toBeGreaterThan(iSai);
    expect(ma, "không đưa IP/header/thân vào lời ghi nhận").not.toMatch(/ghiNhanTuChoi\([^)]*(?:headers|ipChoRateLimit|doc\.than|req\.)/);
  });
  it("chỉ tu-choi.ts chạm bảng AiLeadRejectCounter (không nơi nào khác ghi vào đó); create chỉ mang bảy cột", () => {
    const tc = doc("lib/ai-lead/tu-choi.ts");
    expect(dem(tc, /\baiLeadRejectCounter\.upsert\(/g)).toBe(1);
    expect(tc).toMatch(/create: \{ day: k\.day, endpoint: k\.endpoint, code: k\.code, agentId: k\.agentId, count: d\.n, firstAt: new Date\(d\.dauMs\), lastAt: new Date\(d\.cuoiMs\) \}/);
    // Quét CẢ cây mã nguồn (không chỉ ba tệp đoán trước): thêm một nơi ghi/đọc bảng này ngoài tu-choi.ts là đỏ ở đây.
    const goc = resolve(process.cwd());
    const nguoiDung: string[] = [];
    for (const thuMuc of ["lib", "app", "components", "scripts"]) {
      for (const tep of readdirSync(resolve(goc, thuMuc), { recursive: true }) as string[]) {
        const duongDan = tep.replace(/\\/g, "/");
        if (!/\.(ts|tsx|mjs)$/.test(duongDan) || /\.test\.|\.spec\./.test(duongDan)) continue;
        if (`${thuMuc}/${duongDan}` === "lib/ai-lead/tu-choi.ts") continue;
        if (/\baiLeadRejectCounter\b/.test(readFileSync(resolve(goc, thuMuc, duongDan), "utf8"))) nguoiDung.push(`${thuMuc}/${duongDan}`);
      }
    }
    expect(nguoiDung, "chỉ lib/ai-lead/tu-choi.ts được chạm bảng AiLeadRejectCounter").toEqual([]);
  });
  it("don-dep.ts xả + dọn theo ai.rejectLogRetentionDays; ket-noi.ts chỉ đọc khi cờ BẬT (tắt ⇒ null ⇒ «chưa đo», không in 0)", () => {
    const dd = doc("lib/ai-lead/dich-vu/don-dep.ts");
    expect(dd).toMatch(/await xaBoDem\(\);/);
    expect(dd).toMatch(/donBoDemCu\(now\.getTime\(\), c\.rejectLogRetentionDays\)/);
    const kn = doc("lib/ai-lead/dich-vu/ket-noi.ts");
    expect(kn).toMatch(/cai\.rejectLogEnabled \? await docTuChoiGanDay\(now\)\.catch\(\(\) => null\) : null/);
    expect(kn).toMatch(/tuChoi: tuChoiDoc \? /);
  });
});


describe("[AIL-GW-NDC] người nhận thông báo / ứng viên giao của cơ sở lấy từ QUYỀN ai-leads:review (nguoiDuyetCoSo), không từ cột vai cũ", () => {
  // Các bộ test hành vi MOCK nguoi-duyet-co-so (duyet.spec/ngoai-le.spec thay bằng truy vấn cột cũ để giữ ý nghĩa ca), nên hoàn nguyên đường gọi ở mã sản xuất không làm ca hành vi nào đỏ — ghim ở đây.
  it.each([
    ["lib/ai-lead/dich-vu/duyet.ts", /await nguoiDuyetCoSo\(centerId\)/],
    ["lib/ai-lead/dich-vu/thong-bao.ts", /nguoiDuyetCoSo\(centerId, now\)/],
  ])("%s", (tep, goi) => {
    const ma = doc(tep);
    expect(ma).toMatch(goi);
    expect(dem(ma, /\bquanLyCoSo\(/g), "không còn gọi quanLyCoSo (cột vai cũ) ở đường AI Lead").toBe(0);
    expect(ma).not.toMatch(/nguoi-nhan-phia-sale[^;]*\bquanLyCoSo\b/);
  });
  it("nguoi-duyet-co-so.ts: đủ các điều kiện hiệu lực trong MỘT truy vấn (ACTIVE · đang trong khoảng hiệu lực · vai còn dùng · quyền review · tài khoản còn hoạt động, chưa xoá)", () => {
    const ma = doc("lib/ai-lead/dich-vu/nguoi-duyet-co-so.ts");
    for (const re of [/status: "ACTIVE"/, /effectiveFrom: \{ lte: now \}/, /effectiveTo: null \}, \{ effectiveTo: \{ gte: now \}/, /isActive: true, permissions: \{ some: \{ action: "ai-leads:review" \} \}/, /isActive: true, deletedAt: null/]) {
      expect(ma, String(re)).toMatch(re);
    }
  });
});
