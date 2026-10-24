// lib/security/cong-ghi-wave1.ts — LỚP NỐI cổng GHI Wave 1 (artifact Ed25519 của `phe-duyet-ghi.ts`) vào các LÕI GHI có DB.
//
// `phe-duyet-ghi.ts` là hàm THUẦN (chữ ký · hạn · digest · số dòng). Tệp này là phần còn lại mà mọi lõi ghi cần, để KHÔNG lõi nào tự
// chép tay một nửa cổng:
//   1. `kiemCongGhiTruocGhi` — chạy TRƯỚC phép ghi đầu tiên của lõi: môi trường hợp lệ · khoá công khai + vân tay GHIM bắt buộc có mặt ·
//      môi trường khớp tên DB · nonce chưa dùng (đọc `AuditLog wg:<nonce>`) · `kiemPheDuyetChoRows` trên CHÍNH các dòng sắp ghi.
//      Mọi từ chối là `throw CongGhiTuChoi` (KHÔNG `return`), mang mã `MA_LOI` cố định.
//   2. `claimPheDuyet` — phép ghi ĐẦU TIÊN trong transaction ghi: INSERT `AuditLog id='wg:<nonce>'`. `id` là khoá chính nên lần INSERT thứ hai
//      cùng nonce vỡ khoá chính (P2002) ⇒ `CongGhiTuChoi("DA_DUNG")` ⇒ transaction lùi. Đây mới là cổng dùng-một-lần THẬT; kiểm sớm ở (1) chỉ để báo sớm.
//   3. `docCongGhiTuMoiTruong` — lớp mỏng ngoài cùng (script): đọc artifact + khoá + vân tay ghim + môi trường từ env. KHÔNG có cách nào ghi đè đồng hồ.
//
// ── Quy ước ─────────────────────────────────────────────────────────────────────────────────────────
// · `workflow` KHÔNG do người gọi (CLI/env) quyết: mỗi lõi ghi truyền hằng của nó (`WORKFLOW_WAVE1.*`). Artifact ký cho việc khác ⇒ `SAI_WORKFLOW`.
// · `moiTruong` là enum đóng (`test` | `prod`); artifact ký cho môi trường khác ⇒ `SAI_MOI_TRUONG`, và môi trường phải KHỚP TÊN DATABASE đang nối (heuristic — xem tài liệu 15 §10).
// · `now` do nơi gọi truyền (luật 19). Không có cờ/biến môi trường nào dời đồng hồ: đó sẽ là cửa hậu cho artifact hết hạn.
// · Thiếu khoá công khai hoặc thiếu vân tay ghim ⇒ TỪ CHỐI (fail-closed). Bản CLI chung (`kiem-phe-duyet-ghi.ts`) cho phép không ghim; đường GHI thì không.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { kiemPheDuyetChoRows, taoBanGhiDaDung, TIEN_TO_ID_DA_DUNG, type KetQuaKiem, type MaLoi } from "./phe-duyet-ghi";

export const MOI_TRUONG_GHI = ["test", "prod"] as const;
export type MoiTruongGhi = (typeof MOI_TRUONG_GHI)[number];

/** Tên workflow trong artifact — MỖI việc ghi một tên (không dùng chung artifact giữa việc). Khớp `--workflow` của bước verify trong yaml (lưới `[WGB-WF-*]`). */
export const WORKFLOW_WAVE1 = {
  diTru: "wave1-nguon-di-tru",
  noiDon: "wave1-noi-don-ve-lead",
  noiHocVien: "wave1-noi-hoc-vien-lead",
  gopLead: "wave1-gop-lead",
  doiNguonSauThu: "wave1-doi-nguon-sau-thu",
  suaNguoiChot: "wave1-sua-nguoi-chot-legacy",
  ganDanhTinhDon: "wave1-gan-danh-tinh-don",
  suaGiaGhiDanh: "wave1-sua-gia-ghi-danh",
} as const;
export type TenWorkflowWave1 = (typeof WORKFLOW_WAVE1)[keyof typeof WORKFLOW_WAVE1];

const RE_HEX64 = /^[0-9a-f]{64}$/;
const RE_HEX32 = /^[0-9a-f]{32}$/;

/** Từ chối của cổng. Luôn mang `ma` cố định của `MA_LOI` để log/CI so được. */
export class CongGhiTuChoi extends Error {
  constructor(
    readonly ma: MaLoi,
    readonly lyDo: string,
  ) {
    super(`TỪ CHỐI GHI [${ma}]: ${lyDo}`);
    this.name = "CongGhiTuChoi";
  }
}

/** TẤT CẢ trường BẮT BUỘC khai (luật 7): thiếu trường là `tsc` liệt kê chỗ gọi, không phải mặc định "cho qua". */
export type DauVaoCongGhi = {
  /** JSON (chuỗi hoặc object) của `phe-duyet.json`. `null`/`undefined`/rỗng ⇒ `THIEU_ARTIFACT`. */
  artifact: unknown;
  /** Khoá công khai owner (PEM). Rỗng ⇒ từ chối. */
  publicKeyPem: string;
  /** Vân tay khoá (sha256 SPKI, 64 hex) GHIM ở nơi PR không sửa được (biến của GitHub Environment). Rỗng/sai khuôn ⇒ từ chối. */
  keyIdTinCay: string;
  /** Môi trường đang ghi. Ngoài {test, prod} ⇒ `SAI_MOI_TRUONG`. */
  moiTruong: string;
  /** `null` = không giới hạn danh tính owner; mảng = chỉ chấp nhận các `ownerIdentity` này. */
  ownerIdentities: readonly string[] | null;
  /** Đồng hồ — TRUYỀN VÀO. */
  now: Date;
  /** Tham chiếu lượt chạy (GitHub run id…) — vào audit `wg:<nonce>`. */
  runRef: string;
};

/** Phần của Prisma client mà cổng cần — nhận cả `PrismaClient` lẫn `TransactionClient`. */
export type KhachCongGhi = {
  auditLog: { findUnique: (a: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null> };
  $queryRaw: <T = unknown>(q: TemplateStringsArray, ...v: unknown[]) => Promise<T>;
};

export type KetQuaCongOk = Extract<KetQuaKiem, { ok: true }>;

const RE_DB_THU = /test|local|vitest|lamviec|dev|shadow/i;

/** `null` nếu môi trường khớp tên DB; ngược lại câu mô tả lỗi. Heuristic theo TÊN (không phải bằng chứng mật mã) — xem tài liệu 15. */
export function kiemMoiTruongVoiDb(moiTruong: string, tenDb: string): string | null {
  if (moiTruong === "test") {
    return /test/i.test(tenDb) ? null : `môi trường 'test' nhưng database «${tenDb}» không có chữ 'test' trong tên — nghi trỏ nhầm DB thật`;
  }
  if (moiTruong === "prod") {
    return RE_DB_THU.test(tenDb) ? `môi trường 'prod' nhưng database «${tenDb}» mang tên của DB test/local/dev — nghi trỏ nhầm` : null;
  }
  return `môi trường «${moiTruong}» không thuộc {${MOI_TRUONG_GHI.join(", ")}}`;
}

/** Lấy `payload.nonce` của artifact (nếu đọc được và đúng khuôn) — CHỈ để tra "đã dùng" sớm; mọi kiểm thật nằm ở `kiemPheDuyetChoRows`. */
function nonceCuaArtifact(artifact: unknown): string | null {
  try {
    const e = typeof artifact === "string" ? (JSON.parse(artifact) as unknown) : artifact;
    if (typeof e !== "object" || e === null) return null;
    const p = (e as { payload?: unknown }).payload;
    if (typeof p !== "object" || p === null) return null;
    const n = (p as { nonce?: unknown }).nonce;
    return typeof n === "string" && RE_HEX32.test(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * CỔNG TRƯỚC PHÉP GHI ĐẦU TIÊN. Thành công ⇒ trả kết quả đã kiểm (mang `payload` để `claimPheDuyet`). Mọi từ chối ⇒ `throw CongGhiTuChoi`.
 * `rows` PHẢI là các dòng mà lõi sắp ghi, do CHÍNH lõi dựng (không nhận từ tham số dòng lệnh): digest + số dòng được tính lại ở đây.
 */
export async function kiemCongGhiTruocGhi(
  c: KhachCongGhi,
  cong: DauVaoCongGhi,
  workflow: TenWorkflowWave1,
  rows: readonly string[],
): Promise<KetQuaCongOk> {
  if (!(MOI_TRUONG_GHI as readonly string[]).includes(cong.moiTruong)) {
    throw new CongGhiTuChoi("SAI_MOI_TRUONG", `môi trường «${cong.moiTruong}» không thuộc {${MOI_TRUONG_GHI.join(", ")}} (biến WG_MOI_TRUONG).`);
  }
  if (typeof cong.publicKeyPem !== "string" || cong.publicKeyPem.trim() === "") {
    throw new CongGhiTuChoi("KHOA_CONG_KHAI_SAI", "chưa có khoá công khai của owner (OWNER_APPROVAL_PUBKEY) — chưa ghim khoá thì KHÔNG ghi.");
  }
  if (typeof cong.keyIdTinCay !== "string" || !RE_HEX64.test(cong.keyIdTinCay)) {
    throw new CongGhiTuChoi("KHOA_KHONG_KHOP", "chưa ghim vân tay khoá (OWNER_APPROVAL_KEY_ID, 64 hex thường) — đường GHI không chạy khi chưa ghim.");
  }
  const db = await c.$queryRaw<{ db: string }[]>`SELECT current_database()::text AS db`;
  const tenDb = db[0]?.db ?? "";
  const loiDb = kiemMoiTruongVoiDb(cong.moiTruong, tenDb);
  if (loiDb !== null) throw new CongGhiTuChoi("SAI_MOI_TRUONG", loiDb);

  // Kiểm SỚM nonce đã dùng (báo sớm, không phải cổng). Cổng thật: `claimPheDuyet` trong transaction ghi.
  const nonce = nonceCuaArtifact(cong.artifact);
  const daCo = nonce === null ? null : await c.auditLog.findUnique({ where: { id: TIEN_TO_ID_DA_DUNG + nonce }, select: { id: true } });
  const ketQua = kiemPheDuyetChoRows({
    artifact: cong.artifact,
    publicKeyPem: cong.publicKeyPem,
    expected: {
      workflow,
      targetEnvironment: cong.moiTruong,
      rows,
      ownerIdentities: cong.ownerIdentities ?? undefined,
      keyIdTinCay: cong.keyIdTinCay,
    },
    now: cong.now,
    daDung: (n) => daCo !== null && n === nonce,
  });
  if (!ketQua.ok) throw new CongGhiTuChoi(ketQua.ma, ketQua.ly_do);
  return ketQua;
}

function laTrungKhoaChinh(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * CLAIM nguyên tử — PHÉP GHI ĐẦU TIÊN của transaction ghi. Gọi ngay đầu callback `$transaction`, sau các cổng ĐỌC và TRƯỚC mọi phép ghi nghiệp vụ.
 * Trùng nonce ⇒ `CongGhiTuChoi("DA_DUNG")` (rollback cả transaction). Mọi lỗi khác ném nguyên (cũng rollback).
 * `rowCount` = số dòng artifact đã duyệt (số THỰC GHI nằm ở bản ghi kết quả của từng lõi).
 */
export async function claimPheDuyet(
  tx: Prisma.TransactionClient,
  ok: KetQuaCongOk,
  chiTiet: { appliedAt: Date; rowCount: number; runRef: string },
): Promise<void> {
  try {
    await tx.auditLog.create({ data: taoBanGhiDaDung(ok.payload, chiTiet) });
  } catch (e) {
    if (laTrungKhoaChinh(e)) throw new CongGhiTuChoi("DA_DUNG", "artifact đã được dùng (nonce đã có trong AuditLog) — transaction lùi, KHÔNG ghi gì.");
    throw e;
  }
}

/** Gói `claimPheDuyet` cho lõi: một hàm nhận `tx` — nơi gọi (lô đầu / transaction duy nhất) chỉ cần `await claim(tx)`. */
export function dungClaim(ok: KetQuaCongOk, cong: DauVaoCongGhi, rowCount: number): (tx: Prisma.TransactionClient) => Promise<void> {
  return (tx) => claimPheDuyet(tx, ok, { appliedAt: cong.now, rowCount, runRef: cong.runRef });
}

// ─── Lớp mỏng ngoài cùng: đọc từ env (script) ──────────────────────────────────────────────────────────

/**
 * Đọc đầu vào cổng từ môi trường của script. KHÔNG validate nội dung (cổng làm việc đó): thiếu gì thì để trống để `kiemCongGhiTruocGhi` từ chối với mã rõ ràng.
 *   PHE_DUYET_TEP        đường dẫn tệp phe-duyet.json (ưu tiên)   · PHE_DUYET   nội dung JSON trực tiếp
 *   OWNER_APPROVAL_PUBKEY / OWNER_APPROVAL_KEY_ID   biến của GitHub Environment (ngoài tầm sửa của PR)
 *   OWNER_APPROVAL_OWNERS  danh sách danh tính owner chấp nhận, ngăn bằng dấu phẩy (tuỳ chọn)
 *   WG_MOI_TRUONG        `test` | `prod` — hằng của workflow, không phải ô người gõ
 *   GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT
 * `now` TRUYỀN VÀO (đồng hồ đọc ở biên của script). Không có biến nào dời đồng hồ.
 */
export function docCongGhiTuMoiTruong(env: Readonly<Record<string, string | undefined>>, now: Date): DauVaoCongGhi {
  const tep = (env.PHE_DUYET_TEP ?? "").trim();
  let artifact: string | null = null;
  if (tep !== "") {
    try {
      artifact = readFileSync(resolve(tep), "utf8");
    } catch {
      artifact = null; // tệp không đọc được ⇒ coi như THIẾU artifact (cổng từ chối)
    }
  } else if ((env.PHE_DUYET ?? "").trim() !== "") {
    artifact = env.PHE_DUYET ?? null;
  }
  const owners = (env.OWNER_APPROVAL_OWNERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  const runId = (env.GITHUB_RUN_ID ?? "").trim();
  return {
    artifact,
    publicKeyPem: (env.OWNER_APPROVAL_PUBKEY ?? "").replace(/\\n/g, "\n").trim(),
    keyIdTinCay: (env.OWNER_APPROVAL_KEY_ID ?? "").trim().toLowerCase(),
    moiTruong: (env.WG_MOI_TRUONG ?? "").trim(),
    ownerIdentities: owners.length > 0 ? owners : null,
    now,
    runRef: runId === "" ? "khong-co-run" : `${runId}:${(env.GITHUB_RUN_ATTEMPT ?? "1").trim() || "1"}`,
  };
}

/**
 * Ghi các dòng đầu ra dry-run (để owner tải về, đọc, ký) nếu env `WG_XUAT_DONG` khai đường dẫn. Trả đường dẫn đã ghi hoặc `null`.
 * Mỗi dòng = MỘT bản ghi sẽ ghi — đúng các dòng mà lõi ghi tự dựng lại và đưa vào `kiemCongGhiTruocGhi`. Không chứa tên/SĐT/email.
 */
export function xuatDongDauRa(env: Readonly<Record<string, string | undefined>>, rows: readonly string[]): string | null {
  const p = (env.WG_XUAT_DONG ?? "").trim();
  if (p === "") return null;
  const dich = resolve(p);
  writeFileSync(dich, rows.map((r) => r + "\n").join(""), "utf8");
  return dich;
}
