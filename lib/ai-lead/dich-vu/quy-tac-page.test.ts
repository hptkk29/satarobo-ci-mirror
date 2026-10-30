// @vitest-environment node
// [QTP] QUY TẮC THEO PAGE (E2): tự tạo lead = công tắc toàn hệ ∧ cờ riêng của Page ∧ Page ENABLED ∧ Agent active. THUẦN + lưới ghim mã nguồn.
//
// Hai loại ca:
//   · hành vi (bảng chân lý) — không cần DB;
//   · ghim mã nguồn — luật "intake.ts chỉ có MỘT chỗ tự tạo lead và nó đi qua choPhepTuTaoLead" là loại luật mà test hành vi KHÔNG chứng minh được khi gỡ lời gọi
//     (xem CLAUDE.md luật 14: lưới neo vào chuỗi có mặt ở dòng import sẽ xanh trên mã đã hỏng ⇒ ở đây neo theo LỜI GỌI `ten(`, trên mã đã BỎ chú thích).
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { datTuTaoLeadSchema } from "./quy-tac-page-schema";
import { CAU_LY_DO_TU_TAO, choPhepTuTaoLead, type DauVaoTuTao, type LyDoTuTao } from "./quy-tac-page";
import { TRANG_THAI_PAGE, MOI_TRUONG } from "../hop-dong";

const doc = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8").split("\r\n").join("\n"); // checkout CRLF của Windows không được làm lưới đỏ
const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/(?<=\S)\s+\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const BOOL = [false, true] as const;
const goc: DauVaoTuTao = { autoCreateToanHe: true, pageAutoCreate: true, pageState: "ENABLED", agentActive: true, environment: "TEST" };

describe("[QTP-01] bảng chân lý: 4 biến nhị phân = 16 tổ hợp, CHỈ tổ hợp đủ cả bốn mới cho phép (mỗi môi trường)", () => {
  for (const env of MOI_TRUONG) {
    for (const toanHe of BOOL) for (const pageBat of BOOL) for (const state of TRANG_THAI_PAGE) for (const active of BOOL) {
      const dauVao: DauVaoTuTao = { autoCreateToanHe: toanHe, pageAutoCreate: pageBat, pageState: state, agentActive: active, environment: env };
      const mong = toanHe && pageBat && state === "ENABLED" && active;
      it(`[QTP-01] ${env} · toànHệ=${toanHe} · pageBật=${pageBat} · ${state} · agentActive=${active} ⇒ ${mong ? "CHO PHÉP" : "TỪ CHỐI"}`, () => {
        const r = choPhepTuTaoLead(dauVao);
        expect(r.allowed).toBe(mong);
        expect(r.lyDo === "CHO_PHEP", "lyDo CHO_PHEP ⇔ allowed").toBe(mong);
      });
    }
  }
});

describe("[QTP-02] lý do: mỗi nguyên nhân thiếu có MÃ riêng, theo thứ tự công tắc toàn hệ → cờ Page → tạm dừng → Agent tắt", () => {
  it.each([
    [{ autoCreateToanHe: false }, "TOAN_HE_TAT"],
    [{ pageAutoCreate: false }, "PAGE_TAT"],
    [{ pageState: "PAUSED" as const }, "PAGE_TAM_DUNG"],
    [{ agentActive: false }, "AGENT_TAT"],
  ] as const)("thiếu đúng một vế %j ⇒ %s", (sua, ma) => {
    expect(choPhepTuTaoLead({ ...goc, ...sua })).toEqual({ allowed: false, lyDo: ma });
  });
  it("thiếu nhiều vế ⇒ báo vế ĐẦU (công tắc toàn hệ trước), không bao giờ CHO_PHEP", () => {
    expect(choPhepTuTaoLead({ autoCreateToanHe: false, pageAutoCreate: false, pageState: "PAUSED", agentActive: false, environment: "TEST" }).lyDo).toBe("TOAN_HE_TAT");
    expect(choPhepTuTaoLead({ ...goc, pageAutoCreate: false, pageState: "PAUSED", agentActive: false }).lyDo).toBe("PAGE_TAT");
  });
  it("mọi mã lý do đều có câu tiếng Việt; câu CHO_PHEP không nhắc 'chờ'", () => {
    const ma: LyDoTuTao[] = ["CHO_PHEP", "TOAN_HE_TAT", "PAGE_TAT", "PAGE_TAM_DUNG", "AGENT_TAT", "MOI_TRUONG_LA"];
    for (const m of ma) expect(CAU_LY_DO_TU_TAO[m].length, m).toBeGreaterThan(10);
    expect(Object.keys(CAU_LY_DO_TU_TAO).sort()).toEqual([...ma].sort());
    expect(CAU_LY_DO_TU_TAO.TOAN_HE_TAT).toMatch(/chờ công tắc toàn hệ/);
  });
});

describe("[QTP-03] FAIL-CLOSED trước dữ liệu hỏng (ép kiểu): giá trị lạ / thiếu ⇒ KHÔNG BAO GIỜ cho phép", () => {
  const ep = (x: Record<string, unknown>) => ({ ...goc, ...x }) as unknown as DauVaoTuTao;
  it.each([
    ["môi trường lạ", { environment: "STAGING" }, "MOI_TRUONG_LA"],
    ["môi trường undefined", { environment: undefined }, "MOI_TRUONG_LA"],
    ["pageState lạ", { pageState: "DELETED" }, "PAGE_TAM_DUNG"],
    ["pageState undefined", { pageState: undefined }, "PAGE_TAM_DUNG"],
    ["cờ Page undefined (Page không có cột)", { pageAutoCreate: undefined }, "PAGE_TAT"],
    ["cờ Page là chuỗi 'true'", { pageAutoCreate: "true" }, "PAGE_TAT"],
    ["cờ Page là số 1", { pageAutoCreate: 1 }, "PAGE_TAT"],
    ["công tắc toàn hệ undefined (đọc cài đặt lỗi)", { autoCreateToanHe: undefined }, "TOAN_HE_TAT"],
    ["công tắc toàn hệ là chuỗi 'true'", { autoCreateToanHe: "true" }, "TOAN_HE_TAT"],
    ["agentActive undefined", { agentActive: undefined }, "AGENT_TAT"],
    ["agentActive là số 1", { agentActive: 1 }, "AGENT_TAT"],
  ])("%s", (_t, sua, ma) => {
    expect(choPhepTuTaoLead(ep(sua))).toEqual({ allowed: false, lyDo: ma });
  });
});

describe("[QTP-04] `environment` TEST và PROD cho cùng kết quả (cổng PROD ở xac-thuc.ts, KHÔNG lặp ở đây)", () => {
  it("đổi môi trường giữa hai giá trị hợp lệ không lật kết quả nào của 16 tổ hợp", () => {
    for (const toanHe of BOOL) for (const pageBat of BOOL) for (const state of TRANG_THAI_PAGE) for (const active of BOOL) {
      const d = { autoCreateToanHe: toanHe, pageAutoCreate: pageBat, pageState: state, agentActive: active };
      expect(choPhepTuTaoLead({ ...d, environment: "TEST" })).toEqual(choPhepTuTaoLead({ ...d, environment: "PROD" }));
    }
  });
  it("quy-tac-page.ts THUẦN: chỉ `import type`, không DB / env / đồng hồ (để intake.ts giữ N1 và màn hình gọi cùng hàm)", () => {
    const ma = boChuThich(doc("lib/ai-lead/dich-vu/quy-tac-page.ts"));
    expect(dem(ma, /^import\s+(?!type\b)/gm), "mọi import phải là `import type`").toBe(0);
    expect(ma).not.toMatch(/process\.env|Date\.now|new Date\(|@\/lib\/db|prisma/);
  });
});

describe("[QTP-W] LƯỚI GHIM MÃ NGUỒN — intake.ts chỉ có MỘT chỗ tự tạo lead và nó đi qua choPhepTuTaoLead", () => {
  const nguon = doc("lib/ai-lead/dich-vu/intake.ts");
  const ma = boChuThich(nguon);

  it("[QTP-W1] đúng MỘT lời gọi `tuTaoLeadRoiBao(` (không tính dòng định nghĩa) và nó nằm trong nhánh `READY_FOR_REVIEW && tuTao`", () => {
    const loiGoi = [...ma.matchAll(/(?<!function\s)\btuTaoLeadRoiBao\(/g)];
    expect(loiGoi, "lời gọi tuTaoLeadRoiBao(").toHaveLength(1);
    expect(ma).toMatch(/if \(hk\.trangThai === "READY_FOR_REVIEW" && tuTao\) \{\s*deps\.lenLichNen\(\(\) => tuTaoLeadRoiBao\(hk, now\)\);/);
  });

  it("[QTP-W2] `tuTao` được dựng từ MỘT lời gọi `choPhepTuTaoLead(` và lấy `.allowed`; Page không tìm thấy ⇒ từ chối", () => {
    expect(dem(ma, /\bchoPhepTuTaoLead\(/g)).toBe(1);
    expect(ma).toMatch(/const tuTao =\s*dongPage !== undefined &&\s*choPhepTuTaoLead\(\{[\s\S]*?\}\)\.allowed\s*&&[\s\S]*?thuHepTuTao\([\s\S]*?\)\.allowed;/); // + ràng buộc THU HẸP của bộ quy tắc (VÀ-thêm, không thay thế)
  });

  it("[QTP-W3] đủ BỐN vế đi vào hàm, mỗi vế lấy từ nguồn đúng (cờ Page từ dòng Page của request, không phải hằng)", () => {
    const khoi = /choPhepTuTaoLead\(\{([\s\S]*?)\}\)\.allowed/.exec(ma)?.[1] ?? "";
    expect(khoi).toMatch(/autoCreateToanHe:\s*ctx\.cai\.autoCreateEnabled/);
    expect(khoi).toMatch(/pageAutoCreate:\s*dongPage\.autoCreate/);
    expect(khoi).toMatch(/pageState:\s*dongPage\.state/);
    expect(khoi).toMatch(/agentActive:\s*ctx\.agent\.active/);
    expect(khoi).toMatch(/environment:\s*ctx\.agent\.environment/);
  });

  it("[QTP-W4] `ctx.cai.autoCreateEnabled` KHÔNG còn đứng một mình làm điều kiện tự tạo (chỉ nằm bên trong lời gọi choPhepTuTaoLead)", () => {
    expect(dem(ma, /ctx\.cai\.autoCreateEnabled/g)).toBe(1);
    expect(ma).not.toMatch(/READY_FOR_REVIEW"\s*&&\s*ctx\.cai\.autoCreateEnabled/);
  });

  it("[QTP-W5] nhánh bị từ chối vẫn BÁO QLCS: `else if (hk.canBao)` còn nguyên và là nhánh liền sau", () => {
    expect(ma).toMatch(/tuTaoLeadRoiBao\(hk, now\)\);\s*\} else if \(hk\.canBao\) \{\s*deps\.lenLichNen\(\(\) => baoHoSoCanXuLy\(/);
  });

  it("[QTP-W6] ngoài intake.ts, KHÔNG mã không phải test nào trong lib/ hoặc app/ gọi `tuTaoLeadRoiBao(` hay `taoLeadTuHoSo(… tu: \"AUTO\"`", () => {
    const quet = (thuMuc: string): string[] => {
      const ra: string[] = [];
      const duyet = (d: string) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          const p = `${d}/${e.name}`;
          if (e.isDirectory()) {
            if (e.name === "node_modules" || e.name === ".next") continue;
            duyet(p);
          } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) ra.push(p);
        }
      };
      duyet(resolve(process.cwd(), thuMuc));
      return ra;
    };
    const tep = [...quet("lib"), ...quet("app")];
    expect(tep.length).toBeGreaterThan(500);
    const phamLuat = tep.filter((p) => {
      if (p.replace(/\\/g, "/").endsWith("lib/ai-lead/dich-vu/intake.ts")) return false;
      const m = boChuThich(readFileSync(p, "utf8"));
      return /\btuTaoLeadRoiBao\(/.test(m) || /\btaoLeadTuHoSo\([^)]*tu:\s*"AUTO"/.test(m);
    });
    expect(phamLuat).toEqual([]);
  });

  it("[QTP-W7] cổng `ai.autoCreateEnabled` ở tao-lead.ts (lớp thứ hai) GIỮ NGUYÊN", () => {
    const tl = boChuThich(doc("lib/ai-lead/dich-vu/tao-lead.ts"));
    expect(tl).toMatch(/getSetting\("ai\.autoCreateEnabled"\)/);
  });
});

describe("[QTP-M] MẶC ĐỊNH TẮT được ghim ở cả SQL lẫn schema (Prisma dựa vào DEFAULT của DB — sửa một bên không đổi hành vi nếu bên kia sai)", () => {
  it("[QTP-M1] migration: ADD COLUMN IF NOT EXISTS … BOOLEAN NOT NULL DEFAULT false (chạy lại được)", () => {
    const sql = boChuThich(doc("prisma/migrations/20261109090000_ai_lead_page_rules/migration.sql").replace(/^--.*$/gm, ""));
    expect(sql).toMatch(/ALTER TABLE "AiLeadAgentPage" ADD COLUMN IF NOT EXISTS "autoCreate" BOOLEAN NOT NULL DEFAULT false;/);
    expect(sql).not.toMatch(/DEFAULT true/i);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDROP\b|\bDELETE\b/i);
  });
  it("[QTP-M2] schema.prisma: model AiLeadAgentPage có `autoCreate Boolean @default(false)`", () => {
    const s = doc("prisma/schema.prisma");
    const model = /model AiLeadAgentPage \{[\s\S]*?\n\}/.exec(s)?.[0] ?? "";
    expect(model).toMatch(/\n\s+autoCreate\s+Boolean\s+@default\(false\)/);
    expect(model).not.toMatch(/@default\(true\)/);
  });
  it("[QTP-M3] xac-thuc.ts chọn `autoCreate` cho pages của agent (thiếu ⇒ cờ Page luôn undefined ⇒ không bao giờ tự tạo)", () => {
    const x = boChuThich(doc("lib/ai-lead/xac-thuc.ts"));
    expect(x).toMatch(/pages:\s*\{\s*select:\s*\{[^}]*\bautoCreate:\s*true/);
  });
});

describe("[QTP-N] `autoCreate` là cấu hình nội bộ Admin: KHÔNG xuất hiện ở hợp đồng / response / catalog / gói bàn giao", () => {
  it("[QTP-N1] không có trong schemas.ts, hop-dong.ts, và các dịch vụ dựng response (catalog · heartbeat · handoff · incident · idempotency · phan-hoi)", () => {
    for (const rel of [
      "lib/ai-lead/schemas.ts",
      "lib/ai-lead/hop-dong.ts",
      "lib/ai-lead/phan-hoi.ts",
      "lib/ai-lead/trang-thai.ts",
      "lib/ai-lead/dich-vu/catalog.ts",
      "lib/ai-lead/dich-vu/heartbeat.ts",
      "lib/ai-lead/dich-vu/handoff.ts",
      "lib/ai-lead/dich-vu/incident.ts",
      "lib/ai-lead/dich-vu/idempotency.ts",
    ]) {
      // `autoCreateEnabled` (khoá cài đặt TOÀN HỆ `ai.autoCreateEnabled`) là khái niệm khác và có mặt hợp lệ ở hop-dong.ts; cờ RIÊNG của Page là `autoCreate` trần.
      expect(boChuThich(doc(rel)), rel).not.toMatch(/autoCreate(?!Enabled)/);
    }
  });
});

describe("[QTP-OFF] TẮT tự tạo lead luôn khả dụng (FIX-02) — bộ lọc Page mẫu chỉ chặn BẬT", () => {
  const goc = { agentId: "cm0abcdefghijklmnopqrstuv", lyDo: "Lý do đủ dài để ghi nhật ký" };
  const MAU = "104500000000001"; // Page mẫu của gói bàn giao (`hop-dong.ts`)
  it("[QTP-OFF-01] BẬT cho Page mẫu ⇒ từ chối (nói rõ vì sao, gắn đúng ô pageId)", () => {
    const r = datTuTaoLeadSchema.safeParse({ ...goc, pageId: MAU, bat: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ path: ["pageId"], message: expect.stringMatching(/Page mẫu/) });
  });
  it("[QTP-OFF-02] TẮT cho Page mẫu ⇒ được (đối chứng dương của OFF-01)", () => {
    expect(datTuTaoLeadSchema.safeParse({ ...goc, pageId: MAU, bat: false }).success).toBe(true);
  });
  it("[QTP-OFF-03] TẮT vẫn đòi lý do và pageId đúng dạng (nhật ký đầy đủ, không mở cổng cho rác)", () => {
    expect(datTuTaoLeadSchema.safeParse({ ...goc, pageId: MAU, bat: false, lyDo: "ngắn" }).success).toBe(false);
    expect(datTuTaoLeadSchema.safeParse({ ...goc, pageId: "a b", bat: false }).success).toBe(false);
    expect(datTuTaoLeadSchema.safeParse({ ...goc, pageId: MAU, bat: false, khoaLa: 1 }).success).toBe(false);
  });
  it("[QTP-OFF-04] Page thường: BẬT và TẮT đều qua", () => {
    for (const bat of [true, false]) expect(datTuTaoLeadSchema.safeParse({ ...goc, pageId: "104500000000777", bat }).success).toBe(true);
  });
});

describe("[QTP-SCH] schema action (tệp riêng, vì cau-hinh-thuan.ts chưa export `id`/`lyDoNguyHiem`)", () => {
  it("[QTP-SCH-01] hai bản chép khớp từng ký tự với cau-hinh-thuan.ts (lệch ⇒ đỏ cho tới khi coordinator export và thay bằng import)", () => {
    const thuan = doc("lib/ai-lead/dich-vu/cau-hinh-thuan.ts");
    const rieng = doc("lib/ai-lead/dich-vu/quy-tac-page-schema.ts");
    for (const re of [/^const id = .*$/m, /^const lyDoNguyHiem = .*$/m]) {
      const a = re.exec(thuan)?.[0];
      expect(a, String(re)).toBeTruthy();
      expect(rieng.includes(a!), String(re)).toBe(true);
    }
  });
});
