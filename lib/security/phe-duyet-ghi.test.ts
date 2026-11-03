// [WG-*] Cổng GHI Wave 1 bằng owner approval artifact (Ed25519) — hàm THUẦN, không cần Postgres.
// Khoá sinh LÚC CHẠY (không có PEM nào nằm trong repo). Mọi mốc thời gian là ngày TUYỆT ĐỐI + `now` truyền vào (luật 19).
import { createHash, createPrivateKey, generateKeyPairSync, sign as cSign } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DUNG_SAI_DONG_HO_MS,
  HAN_TRAN_MS,
  MA_LOI,
  TIEN_TO_KY,
  canonicalHoa,
  dauVanTayKhoa,
  docDanhSachDaDung,
  docDongTuVanBan,
  docThamSo,
  kiemPheDuyetChoRows,
  kiemPheDuyetGhi,
  kyPheDuyetGhi,
  kyThoPayload,
  taoBanGhiDaDung,
  taoCapKhoa,
  tinhDigestDauRa,
  type ArtifactPheDuyet,
  type DauVaoKiem,
  type MaLoi,
  type PayloadPheDuyet,
} from "./phe-duyet-ghi";

const KY_LUC = new Date("2026-10-20T03:00:00Z");
const HET_HAN_LUC = Date.parse("2026-10-21T03:00:00Z"); // KY_LUC + 24h
const ROWS = ["wave1|lead:L001|nguon:FB", "wave1|lead:L002|nguon:ZALO", "wave1|lead:L003|nguon:REF"];
const NONCE = "0123456789abcdef0123456789abcdef";
const WORKFLOW = "wave1-backfill-attribution";
const MOI_TRUONG = "prod";
const OWNER = "owner@satarobo.example";
const SAU_KY = new Date("2026-10-20T04:00:00Z"); // 1h sau khi ký — nằm giữa hạn

let khoaA: ReturnType<typeof taoCapKhoa>;
let khoaB: ReturnType<typeof taoCapKhoa>;
let artifact: ArtifactPheDuyet;
let digest: string;

beforeAll(() => {
  khoaA = taoCapKhoa();
  khoaB = taoCapKhoa();
  artifact = kyPheDuyetGhi({
    privateKeyPem: khoaA.privateKeyPem,
    workflow: WORKFLOW,
    targetEnvironment: MOI_TRUONG,
    rows: ROWS,
    soDongOwnerKhai: ROWS.length,
    ownerIdentity: OWNER,
    now: KY_LUC,
    nonce: NONCE,
  });
  digest = tinhDigestDauRa(ROWS).digest;
});

function dauVao(ghiDe: Omit<Partial<DauVaoKiem>, "expected"> & { expected?: Partial<DauVaoKiem["expected"]> } = {}): DauVaoKiem {
  const { expected, ...con } = ghiDe;
  return {
    artifact,
    publicKeyPem: khoaA.publicKeyPem,
    expected: { workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, inputDigest: digest, rowCount: ROWS.length, ...expected },
    now: SAU_KY,
    daDung: () => false,
    ...con,
  };
}

/** Payload hợp lệ về khuôn, tuỳ biến; ký bằng khoá `privateKeyPem` (mặc định khoá A) — để dựng artifact "chữ ký ĐÚNG nhưng nội dung SAI". */
function ky(ghiDe: Partial<PayloadPheDuyet>, privateKeyPem = khoaA.privateKeyPem): ArtifactPheDuyet {
  const payload: PayloadPheDuyet = { ...artifact.payload, ...ghiDe };
  return { payload, signature: kyThoPayload(payload, privateKeyPem) };
}

function mang(r: ReturnType<typeof kiemPheDuyetGhi>): MaLoi | "OK" {
  return r.ok ? "OK" : r.ma;
}

/** Đổi đúng MỘT ký tự của một chuỗi hex (chắc chắn khác). */
function doiMotKyTu(s: string, vt: number): string {
  const c = s[vt] === "0" ? "1" : "0";
  return s.slice(0, vt) + c + s.slice(vt + 1);
}

describe("[WG-01] artifact hợp lệ được chấp nhận", () => {
  it("[WG-01a] object", () => {
    const r = kiemPheDuyetGhi(dauVao());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nonce).toBe(NONCE);
      expect(r.ownerIdentity).toBe(OWNER);
      expect(r.keyId).toBe(khoaA.keyId);
      expect(r.payload.expectedRowCount).toBe(3);
    }
  });
  it("[WG-01b] chuỗi JSON (đúng dạng workflow đọc từ tệp)", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: JSON.stringify(artifact) })))).toBe("OK");
  });
  it("[WG-01c] mã lỗi cố định, không trùng", () => {
    expect(new Set(MA_LOI).size).toBe(MA_LOI.length);
    expect(MA_LOI).toContain("DA_DUNG");
  });
});

describe("[WG-02] thiếu artifact", () => {
  it.each([null, undefined, "", "   \n"])("[WG-02] %j", (a) => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: a })))).toBe("THIEU_ARTIFACT");
  });
});

describe("[WG-03] sai khuôn (SCHEMA_SAI)", () => {
  const p = () => ({ ...artifact.payload });
  const sig = () => artifact.signature;
  const ca: Array<[string, () => unknown]> = [
    ["[WG-03a] không phải JSON", () => "{khong phai json"],
    ["[WG-03b] mảng", () => []],
    ["[WG-03c] số", () => 42],
    ["[WG-03d] thiếu signature", () => ({ payload: p() })],
    ["[WG-03e] thêm khoá lạ ở envelope", () => ({ payload: p(), signature: sig(), extra: 1 })],
    ["[WG-03f] payload thêm khoá lạ (dù chữ ký là của khoá thật)", () => ky({ ...({ them: "x" } as object) } as Partial<PayloadPheDuyet>)],
    ["[WG-03g] payload thiếu khoá", () => { const x: Partial<PayloadPheDuyet> = p(); delete x.nonce; return { payload: x, signature: sig() }; }],
    ["[WG-03h] expectedRowCount = 0", () => ky({ expectedRowCount: 0 })],
    ["[WG-03i] expectedRowCount thực", () => ({ payload: { ...p(), expectedRowCount: 1.5 }, signature: sig() })],
    ["[WG-03j] issuedAt sai khuôn (có mili giây)", () => ky({ issuedAt: "2026-10-20T03:00:00.000Z" })],
    ["[WG-03k] issuedAt ngày không tồn tại", () => ky({ issuedAt: "2026-02-31T03:00:00Z" })],
    ["[WG-03l] signature không phải base64 chuẩn", () => ({ payload: p(), signature: "!!!" })],
    ["[WG-03m] signature sai độ dài", () => ({ payload: p(), signature: Buffer.alloc(63).toString("base64") })],
    ["[WG-03n] workflow viết hoa", () => ky({ workflow: "Wave1" })],
    ["[WG-03o] nonce sai độ dài", () => ky({ nonce: "abc" })],
    ["[WG-03p] ownerIdentity có khoảng trắng đầu", () => ky({ ownerIdentity: " owner" })],
    ["[WG-03q] v = 2", () => ky({ v: 2 as unknown as 1 })],
    ["[WG-03r] ownerIdentity có ký tự điều khiển", () => ky({ ownerIdentity: "owner\u0001x" })],
  ];
  it.each(ca)("%s", (_ten, tao) => {
    const r = kiemPheDuyetGhi(dauVao({ artifact: tao() }));
    expect(mang(r)).toBe("SCHEMA_SAI");
  });
});

describe("[WG-04] sửa một byte ⇒ SAI_CHU_KY (chữ ký được kiểm TRƯỚC mọi so khớp nội dung)", () => {
  const sua = (ghiDe: Partial<PayloadPheDuyet>): ArtifactPheDuyet => ({ payload: { ...artifact.payload, ...ghiDe }, signature: artifact.signature });
  it("[WG-04a] đổi expectedRowCount", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: sua({ expectedRowCount: 4 }), expected: { rowCount: 4 } })))).toBe("SAI_CHU_KY");
  });
  it("[WG-04b] đổi một ký tự inputDigest (và expected khớp theo bản sửa)", () => {
    const d = doiMotKyTu(digest, 10);
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: sua({ inputDigest: d }), expected: { inputDigest: d } })))).toBe("SAI_CHU_KY");
  });
  it("[WG-04c] đổi một ký tự ownerIdentity", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: sua({ ownerIdentity: "owner@satarobo.exampla" }) })))).toBe("SAI_CHU_KY");
  });
  it("[WG-04d] đổi expiresAt kéo dài hạn", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: sua({ expiresAt: "2026-10-22T03:00:00Z" }) })))).toBe("SAI_CHU_KY");
  });
  it("[WG-04e] đổi một byte của chữ ký", () => {
    const buf = Buffer.from(artifact.signature, "base64");
    buf[5] ^= 1;
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: { payload: artifact.payload, signature: buf.toString("base64") } })))).toBe("SAI_CHU_KY");
  });
  it("[WG-04f] đổi workflow trong artifact để khớp workflow khác", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: sua({ workflow: "wave1-khac" }), expected: { workflow: "wave1-khac" } })))).toBe("SAI_CHU_KY");
  });
});

describe("[WG-05] khoá công khai", () => {
  it("[WG-05a] khoá công khai KHÁC khoá đã ký ⇒ KHOA_KHONG_KHOP", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ publicKeyPem: khoaB.publicKeyPem })))).toBe("KHOA_KHONG_KHOP");
  });
  it("[WG-05b] kẻ giả ký bằng khoá B nhưng ghi keyId của A ⇒ SAI_CHU_KY", () => {
    const gia = ky({}, khoaB.privateKeyPem); // payload mang keyId của A, chữ ký của B
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: gia })))).toBe("SAI_CHU_KY");
  });
  it("[WG-05c] kẻ giả ký bằng khoá B, ghi keyId B, còn verifier tin khoá A ⇒ KHOA_KHONG_KHOP", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: ky({ keyId: khoaB.keyId }, khoaB.privateKeyPem) })))).toBe("KHOA_KHONG_KHOP");
  });
  it("[WG-05d] PEM rác ⇒ KHOA_CONG_KHAI_SAI", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ publicKeyPem: "khong-phai-pem" })))).toBe("KHOA_CONG_KHAI_SAI");
    expect(mang(kiemPheDuyetGhi(dauVao({ publicKeyPem: "" })))).toBe("KHOA_CONG_KHAI_SAI");
  });
  it("[WG-05e] khoá không phải Ed25519 (EC P-256) ⇒ KHOA_CONG_KHAI_SAI", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(mang(kiemPheDuyetGhi(dauVao({ publicKeyPem: ec })))).toBe("KHOA_CONG_KHAI_SAI");
    expect(() => dauVanTayKhoa(ec)).toThrow();
  });
  it("[WG-05f] tách miền: chữ ký trên canonical TRẦN (không tiền tố) bị từ chối", () => {
    const sig = kyThoPayloadKhongTienTo(artifact.payload, khoaA.privateKeyPem);
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: { payload: artifact.payload, signature: sig } })))).toBe("SAI_CHU_KY");
    expect(TIEN_TO_KY.length).toBeGreaterThan(10);
  });
});

function kyThoPayloadKhongTienTo(payload: unknown, pem: string): string {
  return cSign(null, Buffer.from(canonicalHoa(payload), "utf8"), createPrivateKey(pem)).toString("base64");
}

describe("[WG-05g] ghim vân tay khoá (keyIdTinCay) — kiểm trong lib, không chỉ ở CLI", () => {
  it("[WG-05g] ghim đúng ⇒ OK; ghim khoá khác ⇒ KHOA_KHONG_KHOP; ghim sai khuôn ⇒ THAM_SO_KY_VONG_SAI", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { keyIdTinCay: khoaA.keyId } })))).toBe("OK");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { keyIdTinCay: khoaB.keyId } })))).toBe("KHOA_KHONG_KHOP");
    // kẻ đổi khoá công khai thành khoá B + tự ký bằng B (artifact khớp khoá B) vẫn bị bản ghim chặn:
    const giaMao = ky({ keyId: khoaB.keyId }, khoaB.privateKeyPem);
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: giaMao, publicKeyPem: khoaB.publicKeyPem })))).toBe("OK");
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: giaMao, publicKeyPem: khoaB.publicKeyPem, expected: { keyIdTinCay: khoaA.keyId } })))).toBe("KHOA_KHONG_KHOP");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { keyIdTinCay: "abc" } })))).toBe("THAM_SO_KY_VONG_SAI");
  });
});

describe("[WG-06] workflow / môi trường / owner", () => {
  it("[WG-06a] sai workflow ⇒ SAI_WORKFLOW", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { workflow: "wave1-khac" } })))).toBe("SAI_WORKFLOW");
  });
  it("[WG-06b] artifact ký cho test, áp ở prod ⇒ SAI_MOI_TRUONG", () => {
    const choTest = ky({ targetEnvironment: "test" });
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: choTest })))).toBe("SAI_MOI_TRUONG");
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: choTest, expected: { targetEnvironment: "test" } })))).toBe("OK");
  });
  it("[WG-06c] ownerIdentities có khai mà không chứa owner ⇒ SAI_OWNER; chứa ⇒ OK", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { ownerIdentities: ["nguoi.khac"] } })))).toBe("SAI_OWNER");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { ownerIdentities: [OWNER] } })))).toBe("OK");
  });
});

describe("[WG-07] digest và số dòng", () => {
  it("[WG-07a] artifact của dry-run A KHÔNG áp được cho dữ liệu B (cùng số dòng, đổi một dòng) ⇒ LECH_DIGEST", () => {
    const B = [...ROWS.slice(0, 2), "wave1|lead:L003|nguon:KHAC"];
    const r = kiemPheDuyetChoRows({ ...dauVao(), expected: { workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: B } });
    expect(mang(r)).toBe("LECH_DIGEST");
  });
  it("[WG-07b] thêm một dòng ⇒ digest đổi trước (LECH_DIGEST)", () => {
    const r = kiemPheDuyetChoRows({ ...dauVao(), expected: { workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: [...ROWS, "them"] } });
    expect(mang(r)).toBe("LECH_DIGEST");
  });
  it("[WG-07c] chỉ khác ký tự CUỐI của digest ⇒ LECH_DIGEST (không so lỏng)", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { inputDigest: doiMotKyTu(digest, 63) } })))).toBe("LECH_DIGEST");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { inputDigest: doiMotKyTu(digest, 0) } })))).toBe("LECH_DIGEST");
  });
  it("[WG-07d] digest đúng nhưng số dòng thật lệch ±1 ⇒ LECH_SO_DONG", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { rowCount: 2 } })))).toBe("LECH_SO_DONG");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { rowCount: 4 } })))).toBe("LECH_SO_DONG");
    expect(mang(kiemPheDuyetGhi(dauVao({ expected: { rowCount: 0 } })))).toBe("LECH_SO_DONG");
  });
  it("[WG-07e] cùng tập dòng, thứ tự khác ⇒ vẫn OK (cổng tự tính digest từ các dòng)", () => {
    const r = kiemPheDuyetChoRows({ ...dauVao(), expected: { workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: [...ROWS].reverse() } });
    expect(mang(r)).toBe("OK");
  });
  it("[WG-07f] dòng không phải chuỗi ⇒ THAM_SO_KY_VONG_SAI, không ném", () => {
    const r = kiemPheDuyetChoRows({ ...dauVao(), expected: { workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: [1 as unknown as string] } });
    expect(mang(r)).toBe("THAM_SO_KY_VONG_SAI");
  });
});

describe("[WG-08] hạn dùng (now truyền vào, ngày tuyệt đối)", () => {
  it("[WG-08a] đúng expiresAt ⇒ OK; +1ms ⇒ HET_HAN", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date(HET_HAN_LUC) })))).toBe("OK");
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date(HET_HAN_LUC + 1) })))).toBe("HET_HAN");
  });
  it("[WG-08b] ngày sau hạn xa ⇒ HET_HAN", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date("2027-01-01T00:00:00Z") })))).toBe("HET_HAN");
  });
  it("[WG-08c] sát biên dưới: issuedAt − dung sai ⇒ OK; − 1ms ⇒ CHUA_DEN_HAN", () => {
    const phatHanh = Date.parse(artifact.payload.issuedAt);
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date(phatHanh - DUNG_SAI_DONG_HO_MS) })))).toBe("OK");
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date(phatHanh - DUNG_SAI_DONG_HO_MS - 1) })))).toBe("CHUA_DEN_HAN");
  });
  it("[WG-08d] expiresAt = issuedAt hoặc trước ⇒ HAN_KHONG_HOP_LE (artifact do khoá thật ký)", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: ky({ expiresAt: artifact.payload.issuedAt }) })))).toBe("HAN_KHONG_HOP_LE");
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: ky({ expiresAt: "2026-10-19T03:00:00Z" }) })))).toBe("HAN_KHONG_HOP_LE");
  });
  it("[WG-08e] now không hợp lệ ⇒ THAM_SO_KY_VONG_SAI", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ now: new Date("khong") })))).toBe("THAM_SO_KY_VONG_SAI");
    expect(mang(kiemPheDuyetGhi(dauVao({ now: "2026-10-20" as unknown as Date })))).toBe("THAM_SO_KY_VONG_SAI");
  });
});

describe("[WG-09] trần cứng 72 giờ", () => {
  it("[WG-09a] đúng 72h ⇒ OK (ký bằng đường chính thức)", () => {
    const a72 = kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC, hanGio: 72, nonce: NONCE });
    expect(Date.parse(a72.payload.expiresAt) - Date.parse(a72.payload.issuedAt)).toBe(HAN_TRAN_MS);
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: a72 })))).toBe("OK");
  });
  it("[WG-09b] 72h + 1 giây (chữ ký thật, ký thô) ⇒ HAN_QUA_DAI — verifier tự canh trần, không tin người ký", () => {
    const qua = ky({ expiresAt: "2026-10-23T03:00:01Z" });
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: qua })))).toBe("HAN_QUA_DAI");
  });
  it("[WG-09c] đường ký chính thức từ chối hạn 0 / âm / NaN / >72h", () => {
    for (const hanGio of [0, -1, Number.NaN, 72.001, 1000]) {
      expect(() => kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC, hanGio })).toThrow();
    }
  });
  it("[WG-09d] hạn mặc định = 24 giờ", () => {
    expect(Date.parse(artifact.payload.expiresAt)).toBe(HET_HAN_LUC);
  });
});

describe("[WG-10] dùng một lần", () => {
  it("[WG-10a] nonce đã dùng ⇒ DA_DUNG; daDung nhận đúng nonce", () => {
    const daDung = vi.fn((n: string) => n === NONCE);
    expect(mang(kiemPheDuyetGhi(dauVao({ daDung })))).toBe("DA_DUNG");
    expect(daDung).toHaveBeenCalledWith(NONCE);
  });
  it("[WG-10b] chưa dùng ⇒ OK", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ daDung: (n) => n !== NONCE })))).toBe("OK");
  });
  it("[WG-10c] daDung CHỈ được hỏi khi mọi cổng khác đã qua (không rò trạng thái cho artifact sai)", () => {
    const daDung = vi.fn(() => true);
    kiemPheDuyetGhi(dauVao({ daDung, expected: { workflow: "wave1-khac" } }));
    kiemPheDuyetGhi(dauVao({ daDung, now: new Date(HET_HAN_LUC + 1) }));
    kiemPheDuyetGhi(dauVao({ daDung, publicKeyPem: khoaB.publicKeyPem }));
    expect(daDung).not.toHaveBeenCalled();
  });
  it("[WG-10d] thiếu hàm daDung ⇒ THAM_SO_KY_VONG_SAI (không mặc định 'chưa dùng')", () => {
    expect(mang(kiemPheDuyetGhi(dauVao({ daDung: undefined as unknown as DauVaoKiem["daDung"] })))).toBe("THAM_SO_KY_VONG_SAI");
  });
  it("[WG-10e] hai lần ký cùng dữ liệu ⇒ hai nonce khác nhau", () => {
    const x = kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC });
    const y = kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC });
    expect(x.payload.nonce).not.toBe(y.payload.nonce);
    expect(x.payload.nonce).toMatch(/^[0-9a-f]{32}$/);
  });
  it("[WG-10g] danh sách đã dùng nhận CẢ `<nonce>` lẫn `wg:<nonce>` (id hàng AuditLog) — để kiểm sớm không chết im lặng", () => {
    for (const dong of [NONCE, `wg:${NONCE}`, `  wg:${NONCE}  `]) {
      const ds = docDanhSachDaDung(`\r\nkhac\r\n${dong}\r\n`);
      expect(ds.has(NONCE)).toBe(true);
      expect(mang(kiemPheDuyetGhi(dauVao({ daDung: (n) => ds.has(n) })))).toBe("DA_DUNG");
    }
    expect(docDanhSachDaDung("").size).toBe(0);
    expect(docDanhSachDaDung("wg:").has("")).toBe(false);
  });
  it("[WG-10f] bản ghi 'đã dùng' lấy id = wg:<nonce> (khoá chính ⇒ claim nguyên tử), không chứa khoá/chữ ký", () => {
    const ban = taoBanGhiDaDung(artifact.payload, { appliedAt: new Date("2026-10-20T04:30:00Z"), rowCount: 3, runRef: "run-123" });
    expect(ban.id).toBe(`wg:${NONCE}`);
    expect(ban.entityId).toBe(NONCE);
    expect(ban.newValues.inputDigest).toBe(digest);
    expect(ban.newValues.appliedRowCount).toBe(3);
    expect(JSON.stringify(ban)).not.toContain(artifact.signature);
    expect(ban.changedFields).toEqual([]);
    // Kiểm BIÊN DỊCH: bản ghi phải gán được vào đầu vào create của AuditLog (thiếu cột bắt buộc/sai kiểu ⇒ tsc đỏ).
    const choPrisma: Prisma.AuditLogUncheckedCreateInput = ban;
    expect(choPrisma.id).toBe(`wg:${NONCE}`);
  });
});

describe("[WG-11] tham số kỳ vọng sai ⇒ lỗi, không so sánh bừa", () => {
  it.each([
    ["digest không phải hex 64", { inputDigest: "abc" }],
    ["rowCount âm", { rowCount: -1 }],
    ["rowCount thực", { rowCount: 1.5 }],
    ["workflow không phải chuỗi", { workflow: 5 as unknown as string }],
  ])("[WG-11] %s", (_t, expected) => {
    expect(mang(kiemPheDuyetGhi(dauVao({ expected })))).toBe("THAM_SO_KY_VONG_SAI");
  });
});

describe("[WG-12] KHÔNG BAO GIỜ ném", () => {
  const vong: Record<string, unknown> = {};
  vong.tuTro = vong;
  const getterNem = { get payload(): never { throw new Error("no") }, signature: "x" };
  const rac: unknown[] = [42, true, Symbol("x"), BigInt(10), () => 1, vong, getterNem, { payload: vong, signature: "x" }, new Date(), "[]", "null", "{}", "9".repeat(20_000)];
  it.each(rac.map((x, i) => [i, x] as const))("[WG-12] đầu vào rác #%i", (_i, x) => {
    const chay = () => kiemPheDuyetGhi(dauVao({ artifact: x }));
    expect(chay).not.toThrow();
    expect(chay().ok).toBe(false);
  });
  it("[WG-12b] đầu vào không phải object", () => {
    expect(kiemPheDuyetGhi(null as unknown as DauVaoKiem).ok).toBe(false);
    expect(kiemPheDuyetGhi(undefined as unknown as DauVaoKiem).ok).toBe(false);
  });
  it("[WG-12c] lỗi khi đọc thuộc tính của input ⇒ LOI_NOI_BO, không ném", () => {
    const doc = { get publicKeyPem(): never { throw new Error("boom") }, artifact, expected: dauVao().expected, now: SAU_KY, daDung: () => false } as unknown as DauVaoKiem;
    const r = kiemPheDuyetGhi(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("LOI_NOI_BO");
  });
});

describe("[WG-13] canonical hoá — known-answer", () => {
  it("[WG-13a] KAT: khoá sắp xếp, đệ quy, không khoảng trắng", () => {
    expect(canonicalHoa({ b: [1, { d: null, c: "é\n" }], a: true })).toBe('{"a":true,"b":[1,{"c":"é\\n","d":null}]}');
  });
  it("[WG-13b] thứ tự khoá không đổi kết quả", () => {
    expect(canonicalHoa({ x: 1, y: { p: 1, q: 2 } })).toBe(canonicalHoa({ y: { q: 2, p: 1 }, x: 1 }));
  });
  it("[WG-13c] từ chối undefined / số thực / NaN / Date / hàm / vòng", () => {
    const vong: Record<string, unknown> = {};
    vong.a = vong;
    for (const x of [{ a: undefined }, 1.5, Number.NaN, new Date(), () => 1, vong]) expect(() => canonicalHoa(x)).toThrow();
  });
  it("[WG-13d] thứ tự khoá KHÁC nhau trong JSON của artifact vẫn xác minh được (cùng canonical)", () => {
    const dao = JSON.stringify({ signature: artifact.signature, payload: Object.fromEntries(Object.entries(artifact.payload).reverse()) });
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: dao })))).toBe("OK");
  });
});

describe("[WG-14] digest đầu ra dry-run — known-answer", () => {
  it("[WG-14a] KAT độc lập (sha256 tính bằng Python): ba dòng mẫu", () => {
    expect(tinhDigestDauRa(ROWS)).toEqual({ digest: "aef0e5a626151391f06c6e270ef03a3d0762ed902a2e4145a810cade7ea849f8", rowCount: 3 });
  });
  it("[WG-14b] thứ tự dòng không đổi digest", () => {
    expect(tinhDigestDauRa([ROWS[2], ROWS[0], ROWS[1]]).digest).toBe(tinhDigestDauRa(ROWS).digest);
  });
  it("[WG-14c] đổi một byte của một dòng ⇒ digest đổi", () => {
    const d = tinhDigestDauRa(["wave1|lead:L001|nguon:FB", ROWS[1], "wave1|lead:L003|nguon:REG"]).digest;
    expect(d).not.toBe(tinhDigestDauRa(ROWS).digest);
  });
  it("[WG-14d] dòng trùng được đếm (không dedupe); ranh giới dòng không nhập nhằng", () => {
    expect(tinhDigestDauRa(["a", "a"]).rowCount).toBe(2);
    expect(tinhDigestDauRa(["a", "a"]).digest).not.toBe(tinhDigestDauRa(["a"]).digest);
    expect(tinhDigestDauRa(["a\nb"]).digest).not.toBe(tinhDigestDauRa(["a", "b"]).digest);
  });
  it("[WG-14e] tập rỗng ⇒ digest có, rowCount 0; và không thể ký (số dòng 0 ≠ ≥1)", () => {
    expect(tinhDigestDauRa([]).rowCount).toBe(0);
    expect(() => kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: [], soDongOwnerKhai: 0, ownerIdentity: OWNER, now: KY_LUC })).toThrow();
  });
  it("[WG-14f] digest dùng đúng tiền tố tách miền (không phải sha256 trần của canonical)", () => {
    const tran = createHash("sha256").update('{"rows":["a"],"v":1}').digest("hex");
    expect(tinhDigestDauRa(["a"]).digest).not.toBe(tran);
  });
  it("[WG-14g] docDongTuVanBan: CRLF = LF, bỏ dòng trống ⇒ cùng digest", () => {
    const lf = docDongTuVanBan(ROWS.join("\n") + "\n");
    const crlf = docDongTuVanBan(ROWS.join("\r\n") + "\r\n\r\n");
    expect(crlf).toEqual(lf);
    expect(tinhDigestDauRa(crlf).digest).toBe(tinhDigestDauRa(ROWS).digest);
  });
});

describe("[WG-15] ký (phía owner)", () => {
  it("[WG-15a] từ chối ký khi số dòng owner khai ≠ số dòng thật", () => {
    expect(() => kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 2, ownerIdentity: OWNER, now: KY_LUC })).toThrow(/KHÔNG ký/);
  });
  it("[WG-15b] issuedAt cắt về giây", () => {
    const a = kyPheDuyetGhi({ privateKeyPem: khoaA.privateKeyPem, workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: new Date("2026-10-20T03:00:00.999Z") });
    expect(a.payload.issuedAt).toBe("2026-10-20T03:00:00Z");
  });
  it("[WG-15c] khoá riêng có mật khẩu: đúng ⇒ ký được; sai ⇒ ném; keyId = vân tay khoá công khai", () => {
    const k = taoCapKhoa("mat-khau-thu");
    const a = kyPheDuyetGhi({ privateKeyPem: k.privateKeyPem, matKhau: "mat-khau-thu", workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC, nonce: NONCE });
    expect(a.payload.keyId).toBe(k.keyId);
    expect(mang(kiemPheDuyetGhi(dauVao({ artifact: a, publicKeyPem: k.publicKeyPem })))).toBe("OK");
    expect(() => kyPheDuyetGhi({ privateKeyPem: k.privateKeyPem, matKhau: "sai", workflow: WORKFLOW, targetEnvironment: MOI_TRUONG, rows: ROWS, soDongOwnerKhai: 3, ownerIdentity: OWNER, now: KY_LUC })).toThrow();
    expect(k.privateKeyPem).toContain("ENCRYPTED");
  });
  it("[WG-15d] artifact sinh ra không chứa khoá riêng", () => {
    expect(JSON.stringify(artifact)).not.toContain("PRIVATE KEY");
  });
});

describe("[WG-16] docThamSo", () => {
  it("[WG-16a] dạng `--k v`, `--k=v`, cờ trần", () => {
    const m = docThamSo(["--a", "1", "--b=2", "--c"]);
    expect([m.get("a"), m.get("b"), m.get("c")]).toEqual(["1", "2", ""]);
  });
  it("[WG-16b] tham số lạ ⇒ ném", () => {
    expect(() => docThamSo(["lạ"])).toThrow();
  });
});
