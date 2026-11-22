// lib/security/phe-duyet-ghi.ts — CỔNG GHI Wave 1 bằng "owner approval artifact" đã KÝ (Ed25519).
//
// Luồng:  dry-run → digest đầu ra → số dòng kỳ vọng → OWNER KÝ (khoá riêng ở máy owner) →
//         verify (chữ ký · môi trường · workflow · digest · số dòng · hạn · dùng-một-lần) → apply → audit.
//
// ── Vì sao KHÔNG dùng reviewer GitHub cùng tài khoản ─────────────────────────────────────────────
// Mọi phiên Claude chạy dưới cùng tài khoản `hptkk29` với owner, nên "reviewer duyệt" không phân biệt
// được người với phiên. Chữ ký bất đối xứng thì khác: thứ phiên Claude KHÔNG có là KHOÁ RIÊNG. Xem
// `docs/source-commission/15-cong-ghi-wave1-owner-artifact.md` — kể cả phần "giới hạn còn lại".
//
// ── Quy ước của tệp này ──────────────────────────────────────────────────────────────────────────
// · Mọi hàm kiểm là THUẦN: không đọc đồng hồ (`now` TRUYỀN VÀO — luật 19), không đọc env, không chạm
//   DB/tệp. Lớp mỏng ngoài cùng (`scripts/ops/*.ts`) lo đồng hồ, tệp, env.
// · `kiemPheDuyetGhi` / `kiemPheDuyetChoRows` KHÔNG BAO GIỜ ném: mọi nhánh lỗi trả `{ ok:false, ma, ly_do }`
//   (kể cả lỗi bất ngờ ⇒ `LOI_NOI_BO`). Người gọi phải ABORT khi `ok !== true`, TRƯỚC phép ghi đầu tiên.
// · Không phụ thuộc thư viện ngoài: chỉ `node:crypto`. KHÔNG `import "server-only"` (CLI chạy dưới tsx).
// · Tuyệt đối không có khoá (PEM) nào nằm trong repo; test sinh khoá lúc chạy.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";

// ─── Hằng số ────────────────────────────────────────────────────────────────────────────────────

export const PHIEN_BAN_ARTIFACT = 1 as const;
/** Hạn mặc định khi owner ký (giờ). */
export const HAN_MAC_DINH_GIO = 24;
/** TRẦN CỨNG của hạn (giờ). Artifact dài hơn bị từ chối dù chữ ký đúng. */
export const HAN_TRAN_GIO = 72;
export const HAN_TRAN_MS = HAN_TRAN_GIO * 60 * 60 * 1000;
/** Lệch đồng hồ cho phép giữa máy owner (lúc ký) và máy chạy verify: `issuedAt` được phép ở TƯƠNG LAI tối đa chừng này. */
export const DUNG_SAI_DONG_HO_MS = 5 * 60 * 1000;
/** Tiền tố tách miền (domain separation): chữ ký của cổng này không thể bị dùng cho thứ khác và ngược lại. */
export const TIEN_TO_KY = "satarobo-phe-duyet-ghi/v1\n";
export const TIEN_TO_DIGEST = "satarobo-wg-digest/v1\n";
/** Tiền tố id bản ghi "đã dùng" trong AuditLog — id = khoá chính nên INSERT thứ hai cùng nonce thất bại (claim nguyên tử, không cần migration). */
export const TIEN_TO_ID_DA_DUNG = "wg:";
const KICH_THUOC_TOI_DA_ARTIFACT = 16 * 1024;

/** Mã lỗi CỐ ĐỊNH. Thêm mã ⇒ thêm hàng vào ma trận ở tài liệu 15 (lưới `phe-duyet-ghi-tai-lieu.test.ts` canh). */
export const MA_LOI = [
  "THIEU_ARTIFACT",
  "SCHEMA_SAI",
  "THAM_SO_KY_VONG_SAI",
  "KHOA_CONG_KHAI_SAI",
  "KHOA_KHONG_KHOP",
  "SAI_CHU_KY",
  "HAN_KHONG_HOP_LE",
  "HAN_QUA_DAI",
  "SAI_WORKFLOW",
  "SAI_MOI_TRUONG",
  "SAI_OWNER",
  "LECH_DIGEST",
  "LECH_SO_DONG",
  "CHUA_DEN_HAN",
  "HET_HAN",
  "DA_DUNG",
  "LOI_NOI_BO",
] as const;
export type MaLoi = (typeof MA_LOI)[number];

// ─── Kiểu ───────────────────────────────────────────────────────────────────────────────────────

export type PayloadPheDuyet = {
  v: typeof PHIEN_BAN_ARTIFACT;
  /** 16 byte ngẫu nhiên (hex) — định danh DUY NHẤT, khoá chống dùng lại. */
  nonce: string;
  /** sha256 (hex) của SPKI DER của khoá công khai đã ký — ghi vào log để owner đối chiếu. */
  keyId: string;
  workflow: string;
  targetEnvironment: string;
  /** Kết quả `tinhDigestDauRa(rows).digest`. */
  inputDigest: string;
  expectedRowCount: number;
  /** ISO UTC giây: `YYYY-MM-DDTHH:mm:ssZ`. */
  issuedAt: string;
  expiresAt: string;
  ownerIdentity: string;
};

export type ArtifactPheDuyet = { payload: PayloadPheDuyet; signature: string };

export type KetQuaKiem =
  | { ok: true; nonce: string; keyId: string; ownerIdentity: string; payload: PayloadPheDuyet }
  | { ok: false; ma: MaLoi; ly_do: string };

export type KyVongGhi = {
  workflow: string;
  targetEnvironment: string;
  inputDigest: string;
  rowCount: number;
  /** Tuỳ chọn: danh sách owner được chấp nhận. Có khai mà `ownerIdentity` không nằm trong đó ⇒ `SAI_OWNER`. */
  ownerIdentities?: readonly string[];
  /**
   * Tuỳ chọn: vân tay khoá (sha256 SPKI, 64 hex thường) đã GHIM ở nơi `hptkk29` không ghi được. Có khai mà vân tay của
   * `publicKeyPem` khác ⇒ `KHOA_KHONG_KHOP` (chặn kịch bản đổi khoá công khai trong GitHub). Nên truyền ở MỌI nơi gọi, kể cả script apply.
   */
  keyIdTinCay?: string;
};

export type DauVaoKiem = {
  artifact: unknown;
  publicKeyPem: string;
  expected: KyVongGhi;
  /** TRUYỀN VÀO — hàm thuần không đọc đồng hồ. */
  now: Date;
  /**
   * BẮT BUỘC khai (luật 7 — mặc định "chưa ai dùng" là mặc định nguy hiểm). Trả true nếu nonce này ĐÃ được dùng
   * (hoặc đã bị thu hồi). Đây chỉ là kiểm sớm; phép CLAIM nguyên tử nằm trong transaction apply (xem tài liệu 15 §6).
   */
  daDung: (nonce: string) => boolean;
};

/** Lỗi của các hàm trợ giúp (ký, canonical, digest). Hai hàm `kiem*` bắt nó và đổi thành `{ ok:false }`. */
export class LoiPheDuyet extends Error {
  constructor(
    readonly ma: MaLoi,
    message: string,
  ) {
    super(message);
    this.name = "LoiPheDuyet";
  }
}

// ─── Canonical hoá ──────────────────────────────────────────────────────────────────────────────

const DO_SAU_TOI_DA = 16;

/**
 * JSON canonical: khoá sắp theo thứ tự đơn vị mã UTF-16, đệ quy; không khoảng trắng thừa.
 * CHỈ nhận null · boolean · string · số nguyên an toàn · mảng · object thường. Mọi thứ khác (undefined, NaN, số
 * thực, Date, hàm, vòng tham chiếu) NÉM `LoiPheDuyet("SCHEMA_SAI")` — im lặng bỏ qua một khoá là đúng loại lỗi làm
 * hai bên ký/kiểm cùng một chuỗi mà khác ý nghĩa.
 */
export function canonicalHoa(value: unknown, doSau = 0): string {
  if (doSau > DO_SAU_TOI_DA) throw new LoiPheDuyet("SCHEMA_SAI", "canonical: lồng quá sâu");
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new LoiPheDuyet("SCHEMA_SAI", "canonical: chỉ nhận số nguyên an toàn");
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((x) => canonicalHoa(x, doSau + 1)).join(",")}]`;
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new LoiPheDuyet("SCHEMA_SAI", "canonical: chỉ nhận object thường");
      const obj = value as Record<string, unknown>;
      const khoa = Object.keys(obj).sort();
      return `{${khoa.map((k) => `${JSON.stringify(k)}:${canonicalHoa(obj[k], doSau + 1)}`).join(",")}}`;
    }
    default:
      throw new LoiPheDuyet("SCHEMA_SAI", `canonical: kiểu ${typeof value} không được hỗ trợ`);
  }
}

// ─── Digest đầu ra dry-run ──────────────────────────────────────────────────────────────────────

/**
 * Digest của ĐẦU RA dry-run = tập các dòng SẼ GHI. Mỗi phần tử là MỘT dòng đã chuẩn hoá bởi người gọi (chuỗi).
 * Sắp xếp ổn định theo đơn vị mã UTF-16 ⇒ thứ tự dòng không đổi digest; nội dung đổi một byte ⇒ digest đổi.
 * Dòng trùng nhau được GIỮ NGUYÊN (không dedupe) để `rowCount` = số dòng thật sẽ ghi.
 */
export function tinhDigestDauRa(rows: readonly string[]): { digest: string; rowCount: number } {
  if (!Array.isArray(rows)) throw new LoiPheDuyet("THAM_SO_KY_VONG_SAI", "rows phải là mảng chuỗi");
  for (const r of rows) if (typeof r !== "string") throw new LoiPheDuyet("THAM_SO_KY_VONG_SAI", "mỗi dòng phải là chuỗi");
  const daSap = [...rows].sort();
  const digest = createHash("sha256")
    .update(TIEN_TO_DIGEST + canonicalHoa({ v: PHIEN_BAN_ARTIFACT, rows: daSap }), "utf8")
    .digest("hex");
  return { digest, rowCount: rows.length };
}

/** Tách văn bản đầu ra dry-run thành các dòng: cắt theo `\n`/`\r\n`, BỎ dòng trống. Mọi CLI dùng chung để cùng một tệp ra cùng một digest. */
export function docDongTuVanBan(text: string): string[] {
  return text.split(/\r?\n/).filter((d) => d.length > 0);
}

// ─── Khoá ───────────────────────────────────────────────────────────────────────────────────────

/** sha256 (hex) của SPKI DER. Ném `LoiPheDuyet("KHOA_CONG_KHAI_SAI")` nếu PEM không phải khoá công khai Ed25519. */
export function dauVanTayKhoa(publicKeyPem: string): string {
  let key: KeyObject;
  try {
    key = createPublicKey(publicKeyPem);
  } catch {
    throw new LoiPheDuyet("KHOA_CONG_KHAI_SAI", "không đọc được khoá công khai (PEM)");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new LoiPheDuyet("KHOA_CONG_KHAI_SAI", "khoá công khai phải là Ed25519");
  return createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
}

/** Sinh cặp khoá Ed25519. `matKhau` có ⇒ khoá riêng được mã hoá (PKCS#8 + aes-256-cbc). Dùng cho CLI `--tao-khoa` và test. */
export function taoCapKhoa(matKhau?: string): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = (
    matKhau
      ? privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: matKhau })
      : privateKey.export({ type: "pkcs8", format: "pem" })
  ).toString();
  return { privateKeyPem, publicKeyPem, keyId: dauVanTayKhoa(publicKeyPem) };
}

// ─── Ký (chạy ở MÁY OWNER) ──────────────────────────────────────────────────────────────────────

function baiKy(payload: unknown): Buffer {
  return Buffer.from(TIEN_TO_KY + canonicalHoa(payload), "utf8");
}

/**
 * Ký THÔ một payload — KHÔNG kiểm gì về payload. Xuất ra chủ yếu để test dựng artifact "hợp lệ chữ ký nhưng sai nội
 * dung" (trần 72h, hạn đảo ngược…). Đường ký thật của owner là `kyPheDuyetGhi`.
 */
export function kyThoPayload(payload: unknown, privateKeyPem: string, matKhau?: string): string {
  let key: KeyObject;
  try {
    key = createPrivateKey(matKhau ? { key: privateKeyPem, passphrase: matKhau } : privateKeyPem);
  } catch {
    throw new LoiPheDuyet("KHOA_CONG_KHAI_SAI", "không đọc được khoá riêng (sai PEM hoặc sai mật khẩu)");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new LoiPheDuyet("KHOA_CONG_KHAI_SAI", "khoá riêng phải là Ed25519");
  return cryptoSign(null, baiKy(payload), key).toString("base64");
}

const GIAY_MS = 1000;

export type DauVaoKy = {
  privateKeyPem: string;
  matKhau?: string;
  workflow: string;
  targetEnvironment: string;
  /** Các dòng dry-run MÀ OWNER ĐÃ XEM — digest và số dòng suy ra từ đây, không nhận từ chỗ khác. */
  rows: readonly string[];
  /** Số dòng owner TỰ KHAI; khác số dòng thật của `rows` ⇒ từ chối ký (một lần xác nhận bằng tay). */
  soDongOwnerKhai: number;
  ownerIdentity: string;
  now: Date;
  hanGio?: number;
  /** Chỉ để test cố định; mặc định 16 byte ngẫu nhiên. */
  nonce?: string;
};

/** Dựng + ký artifact. Ném `LoiPheDuyet` khi đầu vào sai (hạn ngoài (0, 72h], số dòng không khớp, tên sai khuôn…). */
export function kyPheDuyetGhi(i: DauVaoKy): ArtifactPheDuyet {
  const hanGio = i.hanGio ?? HAN_MAC_DINH_GIO;
  if (!(hanGio > 0) || hanGio > HAN_TRAN_GIO || !Number.isFinite(hanGio)) {
    throw new LoiPheDuyet("HAN_QUA_DAI", `hạn phải trong (0, ${HAN_TRAN_GIO}] giờ`);
  }
  const { digest, rowCount } = tinhDigestDauRa(i.rows);
  if (!Number.isSafeInteger(i.soDongOwnerKhai) || i.soDongOwnerKhai !== rowCount) {
    throw new LoiPheDuyet("LECH_SO_DONG", `owner khai ${String(i.soDongOwnerKhai)} dòng nhưng đầu ra dry-run có ${rowCount} dòng — KHÔNG ký`);
  }
  if (!(i.now instanceof Date) || Number.isNaN(i.now.getTime())) throw new LoiPheDuyet("THAM_SO_KY_VONG_SAI", "now không hợp lệ");
  const phatHanhMs = Math.floor(i.now.getTime() / GIAY_MS) * GIAY_MS;
  const hanMs = Math.round((hanGio * 3600 * GIAY_MS) / GIAY_MS) * GIAY_MS;
  let keyId: string;
  try {
    const pub = createPublicKey(
      createPrivateKey(i.matKhau ? { key: i.privateKeyPem, passphrase: i.matKhau } : i.privateKeyPem),
    );
    keyId = dauVanTayKhoa(pub.export({ type: "spki", format: "pem" }).toString());
  } catch (e) {
    if (e instanceof LoiPheDuyet) throw e;
    throw new LoiPheDuyet("KHOA_CONG_KHAI_SAI", "không đọc được khoá riêng (sai PEM hoặc sai mật khẩu)");
  }
  const payload: PayloadPheDuyet = {
    v: PHIEN_BAN_ARTIFACT,
    nonce: i.nonce ?? randomBytes(16).toString("hex"),
    keyId,
    workflow: i.workflow,
    targetEnvironment: i.targetEnvironment,
    inputDigest: digest,
    expectedRowCount: rowCount,
    issuedAt: isoGiay(phatHanhMs),
    expiresAt: isoGiay(phatHanhMs + hanMs),
    ownerIdentity: i.ownerIdentity,
  };
  const loiSchema = kiemPayload(payload);
  if (loiSchema) throw new LoiPheDuyet("SCHEMA_SAI", loiSchema);
  return { payload, signature: kyThoPayload(payload, i.privateKeyPem, i.matKhau) };
}

function isoGiay(ms: number): string {
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

// ─── Kiểm schema ────────────────────────────────────────────────────────────────────────────────

const RE_TEN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RE_HEX32 = /^[0-9a-f]{32}$/;
const RE_HEX64 = /^[0-9a-f]{64}$/;
const RE_ISO_GIAY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const KHOA_PAYLOAD = [
  "expectedRowCount",
  "expiresAt",
  "inputDigest",
  "issuedAt",
  "keyId",
  "nonce",
  "ownerIdentity",
  "targetEnvironment",
  "v",
  "workflow",
] as const;

function laLaObjectThuong(x: unknown): x is Record<string, unknown> {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const p = Object.getPrototypeOf(x) as unknown;
  return p === Object.prototype || p === null;
}

function laIsoGiayHopLe(s: unknown): s is string {
  if (typeof s !== "string" || !RE_ISO_GIAY.test(s)) return false;
  const ms = Date.parse(s);
  return Number.isFinite(ms) && isoGiay(ms) === s;
}

/** Trả `null` nếu hợp lệ, ngược lại là câu mô tả lỗi. Từ chối khoá LẠ (strict) để không có trường nào "đi nhờ" chữ ký. */
function kiemPayload(p: unknown): string | null {
  if (!laLaObjectThuong(p)) return "payload phải là object";
  const khoa = Object.keys(p).sort();
  if (khoa.length !== KHOA_PAYLOAD.length || khoa.some((k, idx) => k !== KHOA_PAYLOAD[idx])) {
    return `payload phải có đúng các khoá: ${KHOA_PAYLOAD.join(", ")}`;
  }
  if (p.v !== PHIEN_BAN_ARTIFACT) return `v phải là ${PHIEN_BAN_ARTIFACT}`;
  if (typeof p.nonce !== "string" || !RE_HEX32.test(p.nonce)) return "nonce phải là 32 ký tự hex";
  if (typeof p.keyId !== "string" || !RE_HEX64.test(p.keyId)) return "keyId phải là 64 ký tự hex";
  if (typeof p.workflow !== "string" || !RE_TEN.test(p.workflow)) return "workflow sai khuôn";
  if (typeof p.targetEnvironment !== "string" || !RE_TEN.test(p.targetEnvironment)) return "targetEnvironment sai khuôn";
  if (typeof p.inputDigest !== "string" || !RE_HEX64.test(p.inputDigest)) return "inputDigest phải là 64 ký tự hex";
  if (typeof p.expectedRowCount !== "number" || !Number.isSafeInteger(p.expectedRowCount) || p.expectedRowCount < 1) {
    return "expectedRowCount phải là số nguyên ≥ 1";
  }
  if (!laIsoGiayHopLe(p.issuedAt)) return "issuedAt phải là ISO UTC dạng YYYY-MM-DDTHH:mm:ssZ";
  if (!laIsoGiayHopLe(p.expiresAt)) return "expiresAt phải là ISO UTC dạng YYYY-MM-DDTHH:mm:ssZ";
  if (typeof p.ownerIdentity !== "string" || p.ownerIdentity.length < 1 || p.ownerIdentity.length > 200 || p.ownerIdentity !== p.ownerIdentity.trim() || Array.from(p.ownerIdentity).some((ch) => ch.charCodeAt(0) < 32)) {
    return "ownerIdentity phải là chuỗi 1..200 ký tự, không khoảng trắng đầu/cuối, không ký tự điều khiển";
  }
  return null;
}

// ─── Kiểm (chạy ở WORKFLOW, TRƯỚC phép ghi đầu tiên) ────────────────────────────────────────────

function loi(ma: MaLoi, ly_do: string): KetQuaKiem {
  return { ok: false, ma, ly_do };
}

/**
 * Kiểm artifact. THỨ TỰ CỐ ĐỊNH (mỗi bước là cổng; qua hết mới `ok:true`):
 *  1 THIEU_ARTIFACT · 2 THAM_SO_KY_VONG_SAI · 3 SCHEMA_SAI · 4 KHOA_CONG_KHAI_SAI · 5 KHOA_KHONG_KHOP · 6 SAI_CHU_KY
 *  7 HAN_KHONG_HOP_LE · 8 HAN_QUA_DAI · 9 SAI_WORKFLOW · 10 SAI_MOI_TRUONG · 11 SAI_OWNER · 12 LECH_DIGEST · 13 LECH_SO_DONG
 *  14 CHUA_DEN_HAN · 15 HET_HAN · 16 DA_DUNG.
 * Chữ ký được kiểm TRƯỚC mọi quyết định dựa trên nội dung payload (bước 9-16 chỉ chạy trên payload đã được ký).
 * Không bao giờ ném.
 */
export function kiemPheDuyetGhi(input: DauVaoKiem): KetQuaKiem {
  try {
    return kiemNoiBo(input);
  } catch (e) {
    if (e instanceof LoiPheDuyet) return loi(e.ma, e.message);
    return loi("LOI_NOI_BO", "lỗi bất ngờ khi kiểm — coi như KHÔNG được duyệt");
  }
}

function kiemNoiBo(input: DauVaoKiem): KetQuaKiem {
  if (typeof input !== "object" || input === null) return loi("THAM_SO_KY_VONG_SAI", "thiếu đầu vào");
  const { artifact, publicKeyPem, expected, now, daDung } = input;

  // 1 — artifact có mặt.
  if (artifact === null || artifact === undefined || (typeof artifact === "string" && artifact.trim() === "")) {
    return loi("THIEU_ARTIFACT", "không có artifact phê duyệt — KHÔNG ghi");
  }

  // 2 — phía kỳ vọng phải tự đúng khuôn (nếu không, so sánh phía dưới vô nghĩa).
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return loi("THAM_SO_KY_VONG_SAI", "now không hợp lệ");
  if (typeof daDung !== "function") return loi("THAM_SO_KY_VONG_SAI", "thiếu hàm daDung (kiểm dùng-một-lần)");
  if (typeof publicKeyPem !== "string" || publicKeyPem.trim() === "") return loi("KHOA_CONG_KHAI_SAI", "thiếu khoá công khai");
  if (
    !laLaObjectThuong(expected) ||
    typeof expected.workflow !== "string" ||
    typeof expected.targetEnvironment !== "string" ||
    typeof expected.inputDigest !== "string" ||
    !RE_HEX64.test(expected.inputDigest) ||
    typeof expected.rowCount !== "number" ||
    !Number.isSafeInteger(expected.rowCount) ||
    expected.rowCount < 0 ||
    (expected.keyIdTinCay !== undefined && (typeof expected.keyIdTinCay !== "string" || !RE_HEX64.test(expected.keyIdTinCay))) ||
    (expected.ownerIdentities !== undefined &&
      (!Array.isArray(expected.ownerIdentities) || expected.ownerIdentities.some((o: unknown) => typeof o !== "string")))
  ) {
    return loi("THAM_SO_KY_VONG_SAI", "expected sai khuôn (workflow/targetEnvironment/inputDigest(64 hex)/rowCount)");
  }

  // 3 — envelope + payload đúng khuôn.
  let envelope: unknown = artifact;
  if (typeof artifact === "string") {
    if (artifact.length > KICH_THUOC_TOI_DA_ARTIFACT) return loi("SCHEMA_SAI", "artifact quá lớn");
    try {
      envelope = JSON.parse(artifact) as unknown;
    } catch {
      return loi("SCHEMA_SAI", "artifact không phải JSON");
    }
  }
  if (!laLaObjectThuong(envelope)) return loi("SCHEMA_SAI", "artifact phải là object { payload, signature }");
  const khoaEnv = Object.keys(envelope).sort();
  if (khoaEnv.length !== 2 || khoaEnv[0] !== "payload" || khoaEnv[1] !== "signature") {
    return loi("SCHEMA_SAI", "artifact phải có đúng hai khoá: payload, signature");
  }
  const loiPayload = kiemPayload(envelope.payload);
  if (loiPayload) return loi("SCHEMA_SAI", loiPayload);
  const payload = envelope.payload as PayloadPheDuyet;
  const sigB64 = envelope.signature;
  if (typeof sigB64 !== "string" || sigB64.length === 0) return loi("SCHEMA_SAI", "signature phải là chuỗi base64");
  const sig = Buffer.from(sigB64, "base64");
  if (sig.length !== 64 || sig.toString("base64") !== sigB64) return loi("SCHEMA_SAI", "signature phải là base64 chuẩn của 64 byte");

  // 4 — khoá công khai hợp lệ + Ed25519.
  let key: KeyObject;
  let keyIdThat: string;
  try {
    key = createPublicKey(publicKeyPem);
    keyIdThat = dauVanTayKhoa(publicKeyPem);
  } catch (e) {
    if (e instanceof LoiPheDuyet) return loi(e.ma, e.message);
    return loi("KHOA_CONG_KHAI_SAI", "không đọc được khoá công khai (PEM)");
  }
  if (key.asymmetricKeyType !== "ed25519") return loi("KHOA_CONG_KHAI_SAI", "khoá công khai phải là Ed25519");

  // 5a — khoá đang được đưa vào phải đúng bản đã GHIM (nếu có ghim).
  if (expected.keyIdTinCay !== undefined && expected.keyIdTinCay !== keyIdThat) {
    return loi("KHOA_KHONG_KHOP", "vân tay khoá công khai khác bản đã ghim — có thể khoá đã bị thay");
  }

  // 5 — artifact tự nhận ký bằng khoá nào; khác khoá đang tin ⇒ dừng sớm với câu nói thẳng (xoay khoá).
  if (payload.keyId !== keyIdThat) return loi("KHOA_KHONG_KHOP", "keyId của artifact khác khoá công khai đang tin cậy");

  // 6 — CHỮ KÝ. Từ đây trở xuống payload mới là thứ "owner đã nói".
  if (!cryptoVerify(null, baiKy(payload), key, sig)) return loi("SAI_CHU_KY", "chữ ký không khớp nội dung artifact");

  // 7-8 — hạn của chính artifact.
  const phatHanh = Date.parse(payload.issuedAt);
  const hetHan = Date.parse(payload.expiresAt);
  if (!(hetHan > phatHanh)) return loi("HAN_KHONG_HOP_LE", "expiresAt phải sau issuedAt");
  if (hetHan - phatHanh > HAN_TRAN_MS) return loi("HAN_QUA_DAI", `hạn vượt trần ${HAN_TRAN_GIO} giờ`);

  // 9-13 — artifact phải đúng là của VIỆC NÀY, DỮ LIỆU NÀY.
  if (payload.workflow !== expected.workflow) return loi("SAI_WORKFLOW", "artifact không dành cho workflow này");
  if (payload.targetEnvironment !== expected.targetEnvironment) return loi("SAI_MOI_TRUONG", "artifact không dành cho môi trường này");
  if (expected.ownerIdentities !== undefined && !expected.ownerIdentities.includes(payload.ownerIdentity)) {
    return loi("SAI_OWNER", "ownerIdentity không nằm trong danh sách được chấp nhận");
  }
  if (payload.inputDigest !== expected.inputDigest) return loi("LECH_DIGEST", "đầu ra dry-run đã khác bản owner duyệt");
  if (payload.expectedRowCount !== expected.rowCount) return loi("LECH_SO_DONG", "số dòng sẽ ghi khác số dòng owner duyệt");

  // 14-15 — thời gian (now truyền vào). Biên: now == expiresAt vẫn hợp lệ; now > expiresAt thì hết hạn.
  const nowMs = now.getTime();
  if (nowMs < phatHanh - DUNG_SAI_DONG_HO_MS) return loi("CHUA_DEN_HAN", "artifact phát hành ở tương lai");
  if (nowMs > hetHan) return loi("HET_HAN", "artifact đã hết hạn");

  // 16 — dùng một lần (kiểm sớm; claim nguyên tử nằm trong transaction apply).
  if (daDung(payload.nonce)) return loi("DA_DUNG", "artifact đã được dùng (hoặc đã bị thu hồi)");

  return { ok: true, nonce: payload.nonce, keyId: payload.keyId, ownerIdentity: payload.ownerIdentity, payload };
}

/**
 * Cổng khuyên dùng ở ĐẦU script apply: tự TÍNH digest + số dòng từ chính các dòng sẽ ghi (không nhận từ chỗ khác),
 * rồi kiểm. Nhờ vậy "artifact của dry-run A không áp được cho dữ liệu B" không phụ thuộc người gọi nhớ tính đúng.
 * Apply nên chạy lại câu dry-run TRONG transaction rồi truyền kết quả vào đây (dữ liệu có thể trôi giữa dry-run và apply).
 */
export function kiemPheDuyetChoRows(
  input: Omit<DauVaoKiem, "expected"> & {
    expected: Omit<KyVongGhi, "inputDigest" | "rowCount"> & { rows: readonly string[] };
  },
): KetQuaKiem {
  try {
    const { rows, ...phanConLai } = input.expected;
    const { digest, rowCount } = tinhDigestDauRa(rows);
    return kiemPheDuyetGhi({ ...input, expected: { ...phanConLai, inputDigest: digest, rowCount } });
  } catch (e) {
    if (e instanceof LoiPheDuyet) return loi(e.ma, e.message);
    return loi("LOI_NOI_BO", "lỗi bất ngờ khi kiểm — coi như KHÔNG được duyệt");
  }
}

// ─── Bản ghi "đã dùng" (thuần — việc INSERT là của script apply, trong transaction) ──────────────

export type BanGhiDaDung = {
  /** Khoá chính của AuditLog = `wg:<nonce>` ⇒ INSERT lần hai cùng nonce vỡ khoá chính ⇒ transaction apply ROLLBACK. */
  id: string;
  actorName: string;
  module: "write-gate";
  entityType: "WriteGateArtifact";
  entityId: string;
  action: "APPLY";
  /** Rõ ràng `[]`: cột `changedFields` là TEXT[] (nullable ở DB) — đừng để NULL lọt vào qua đường INSERT thô. */
  changedFields: string[];
  newValues: Record<string, string | number>;
  reason: string;
};

/**
 * Dựng dữ liệu hàng AuditLog cho việc "artifact này đã dùng để ghi". KHÔNG chạm DB. Script apply phải `create` hàng này
 * như phép ghi ĐẦU TIÊN trong transaction ghi (claim), và nếu `create` ném (P2002) thì abort cả transaction.
 */
export function taoBanGhiDaDung(
  payload: PayloadPheDuyet,
  chiTiet: { appliedAt: Date; rowCount: number; runRef: string },
): BanGhiDaDung {
  return {
    id: TIEN_TO_ID_DA_DUNG + payload.nonce,
    actorName: payload.ownerIdentity,
    module: "write-gate",
    entityType: "WriteGateArtifact",
    entityId: payload.nonce,
    action: "APPLY",
    changedFields: [],
    newValues: {
      workflow: payload.workflow,
      targetEnvironment: payload.targetEnvironment,
      inputDigest: payload.inputDigest,
      expectedRowCount: payload.expectedRowCount,
      appliedRowCount: chiTiet.rowCount,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      keyId: payload.keyId,
      appliedAt: chiTiet.appliedAt.toISOString(),
      runRef: chiTiet.runRef,
    },
    reason: `Owner phê duyệt ghi ${payload.expectedRowCount} dòng cho ${payload.workflow}@${payload.targetEnvironment}`,
  };
}

/**
 * Đọc tệp danh sách nonce đã dùng/thu hồi: mỗi dòng một mục, bỏ dòng trống, cắt khoảng trắng. Chấp nhận CẢ HAI dạng
 * `<nonce>` và `wg:<nonce>` (id hàng AuditLog) để câu SELECT `id` hay `entityId` đều dùng được — nếu chỉ nhận một dạng thì
 * kiểm sớm sẽ chết im lặng khi workflow cấp dạng kia.
 */
export function docDanhSachDaDung(text: string): Set<string> {
  return new Set(
    docDongTuVanBan(text)
      .map((d) => d.trim())
      .map((d) => (d.startsWith(TIEN_TO_ID_DA_DUNG) ? d.slice(TIEN_TO_ID_DA_DUNG.length) : d))
      .filter((d) => d.length > 0),
  );
}

// ─── Đọc tham số dòng lệnh (thuần — dùng chung hai CLI) ─────────────────────────────────────────

/** `--khoa giá-trị` / `--khoa=giá-trị` / cờ trần `--co`. Trả Map khoá → giá trị ("" cho cờ trần). Tham số lạ (không bắt đầu `--`) ném lỗi. */
export function docThamSo(argv: readonly string[]): Map<string, string> {
  const kq = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`tham số lạ: ${a}`);
    const eq = a.indexOf("=");
    if (eq > 0) {
      kq.set(a.slice(2, eq), a.slice(eq + 1));
      continue;
    }
    const tiep = argv[i + 1];
    if (tiep !== undefined && !tiep.startsWith("--")) {
      kq.set(a.slice(2), tiep);
      i++;
    } else {
      kq.set(a.slice(2), "");
    }
  }
  return kq;
}
