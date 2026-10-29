// lib/ai-lead/ho-tro-test.ts — HỖ TRỢ CHO TEST của AI Lead Gateway (đọc fixture + trích khối YAML). KHÔNG import từ mã chạy thật.
//
// Vì sao tự trích YAML bằng văn bản mà không dùng bộ phân tích YAML: repo không có `yaml`/`ajv` trong dependencies (chúng chỉ nằm trong
// docs/ai-lead-admin/integration-handoff/tools, không vào `pnpm install` của dự án). Thêm thư viện để kiểm một tệp là đánh đổi tệ — hợp đồng có cấu trúc
// phẳng, đủ để trích khối theo THỤT LỀ. Hậu quả phải biết: bộ trích này chỉ đúng với layout hiện tại của YAML; đổi layout ⇒ ca `[AIL-FX-00]` đỏ vì
// không tìm thấy khối (thà đỏ còn hơn xanh nhầm).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const GOC = resolve(process.cwd(), "tests/fixtures/ai-lead");
export const DUONG_FIXTURE = join(GOC, "request-response-fixtures");
export const DUONG_YAML = join(GOC, "api-contract-v1.yaml");
export const DUONG_YAML_GOC_DOCS = resolve(process.cwd(), "docs/ai-lead-admin/integration-handoff/api-contract-v1.yaml");
export const DUONG_FIXTURE_GOC_DOCS = resolve(process.cwd(), "docs/ai-lead-admin/integration-handoff/request-response-fixtures");

export type Fixture = {
  ten: string;
  tep: string;
  description: string;
  validates: {
    request?: string;
    requestExpect?: "VALID" | "INVALID" | "NA";
    response?: string;
    responseExpect?: "VALID" | "INVALID" | "NA";
  };
  request: { method: string; path: string; body?: unknown };
  response: { status: number; headers: Record<string, string>; body: unknown };
  idempotency?: { kind: string; seed: string; v: number };
};

export function tatCaFixture(): Fixture[] {
  return readdirSync(DUONG_FIXTURE)
    .filter((f) => /^\d\d-.*\.json$/.test(f))
    .sort()
    .map((tep) => ({ ...(JSON.parse(readFileSync(join(DUONG_FIXTURE, tep), "utf8")) as Fixture), tep }));
}

export function docFixture(soHieu: string): Fixture {
  const f = tatCaFixture().find((x) => x.tep.startsWith(`${soHieu}-`));
  if (!f) throw new Error(`Không có fixture ${soHieu}`);
  return f;
}

export type HmacVectors = {
  agentId: string;
  agentSecret: string;
  vectors: { ten: string; method: string; path: string; ts: string; nonce: string; body: string; bodyBytes: number; bodySha256: string; chuoiKy: string; sig: string }[];
  negatives: { ten: string; moTa: string; sig: string }[];
};

export function docHmacVectors(): HmacVectors {
  return JSON.parse(readFileSync(join(DUONG_FIXTURE, "hmac-vectors.json"), "utf8")) as HmacVectors;
}

export function docYaml(): string {
  return readFileSync(DUONG_YAML, "utf8");
}

/** Có bản gốc trong docs/ không (CI gương KHÔNG có docs/ ⇒ các ca so bản sao với bản gốc tự bỏ qua). */
export function coBanGocDocs(): boolean {
  return existsSync(DUONG_YAML_GOC_DOCS);
}

function thut(dong: string): number {
  return dong.length - dong.trimStart().length;
}

/**
 * Trích KHỐI của khoá `ten` (dòng `<thụt lề><ten>:` rồi mọi dòng thụt sâu hơn hoặc rỗng). Trả văn bản khối KHÔNG gồm dòng tiêu đề.
 * Ném nếu không thấy hoặc thấy hơn một khối cùng tên cùng mức thụt (mơ hồ).
 */
export function khoiYaml(van: string, ten: string, thutChuan?: number): string {
  const dong = van.replace(/\r/g, "").split("\n");
  const thay: number[] = [];
  dong.forEach((d, i) => {
    const m = d.match(/^(\s*)([A-Za-z0-9_.-]+):\s*(#.*)?$/);
    if (m && m[2] === ten && (thutChuan === undefined || m[1]!.length === thutChuan)) thay.push(i);
  });
  if (thay.length !== 1) throw new Error(`Khối YAML "${ten}": thấy ${thay.length} chỗ (cần đúng 1)`);
  const dau = thay[0]!;
  const mucDau = thut(dong[dau]!);
  const ra: string[] = [];
  for (let i = dau + 1; i < dong.length; i++) {
    const d = dong[i]!;
    if (d.trim() === "") {
      ra.push(d);
      continue;
    }
    if (thut(d) <= mucDau) break;
    ra.push(d);
  }
  return ra.join("\n");
}

/** `pattern: '…'` ĐẦU TIÊN trong văn bản (YAML dùng nháy đơn, không có nháy đơn lồng). */
export function patternDauTien(van: string): string {
  const m = van.match(/pattern:\s*'([^']*)'/);
  if (!m) throw new Error("Không thấy pattern");
  return m[1]!;
}

/** `enum: [A, B]` (một dòng) hoặc `enum:` + danh sách `- X` — ĐẦU TIÊN trong văn bản. */
export function enumDauTien(van: string): string[] {
  const mot = van.match(/enum:\s*\[([^\]]*)\]/);
  const nhieu = van.match(/enum:[ \t]*\n((?:[ \t]+-[ \t]+\S+[ \t]*\n?)+)/);
  // Lấy kiểu nào đứng TRƯỚC: nếu không, `enum` nhiều dòng của khoá này bị che bởi `enum: [..]` của khoá đứng sau nó.
  if (mot && (!nhieu || mot.index! < nhieu.index!)) {
    return mot[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
  }
  if (nhieu) return nhieu[1]!.split("\n").map((s) => s.trim().replace(/^-\s+/, "")).filter(Boolean);
  throw new Error("Không thấy enum");
}

/** So regex nguồn: `/` trong lớp ký tự bị JS thoát thành `\/` khi in `.source` — gỡ để so với văn bản YAML. */
export function nguonRegex(re: RegExp): string {
  // `.source` in NBSP thật thay vì chuỗi `\u00A0` mà YAML ghi — đưa về dạng thoát để so từng chữ.
  return re.source.replace(/\\\//g, "/").replace(/\u00A0/g, "\\u00A0");
}

/**
 * Bỏ chú thích khỏi mã nguồn TS để lưới ghim-mã-nguồn không khớp nhầm vào văn bản giải thích bản vá (luật 14, CLAUDE.md).
 * THỨ TỰ có chủ đích: chú thích `//` TRƯỚC, khối `/* … *\/` SAU — nếu ngược lại, một dòng `// …app/api/x/**` làm `/*` mở khối giả và nuốt cả phần
 * mã đứng sau (đã gặp ở lưới [AIL-PH-W1]). Không xử lý chuỗi chứa `//` (ngoài `://`) — đủ cho các tệp lưới đang đọc.
 */
export function boChuThich(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}
