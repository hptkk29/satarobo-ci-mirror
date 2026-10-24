// [WGB-U*] Lớp nối cổng GHI Wave 1 (`cong-ghi-wave1.ts`) — hàm KHÔNG cần Postgres thật: client giả chỉ có `$queryRaw` + `auditLog.findUnique`.
// Phần chạm DB thật (claim nguyên tử, ABORT trước phép ghi, đồng thời) nằm ở `tests/lead-intake/wg-cong-ghi.spec.ts` ([WGB-DB-*]) và `tests/finance/wg-cong-ghi-noi-don.test.ts`.
// Khoá sinh LÚC CHẠY (không PEM nào trong repo). Mọi mốc là ngày TUYỆT ĐỐI + `now` truyền vào (luật 19).
//
// Ánh xạ bảng ca WG-01..12 của đợt nối cổng → mã ca: xem tài liệu 15 §13 (bảng "WG ↔ ca test").
import { beforeAll, describe, expect, it } from "vitest";
import {
  CongGhiTuChoi,
  MOI_TRUONG_GHI,
  WORKFLOW_WAVE1,
  claimPheDuyet,
  docCongGhiTuMoiTruong,
  kiemCongGhiTruocGhi,
  kiemMoiTruongVoiDb,
  type DauVaoCongGhi,
  type KhachCongGhi,
} from "./cong-ghi-wave1";
import { kyPheDuyetGhi, kyThoPayload, taoCapKhoa, type ArtifactPheDuyet, type MaLoi } from "./phe-duyet-ghi";

const KY_LUC = new Date("2026-10-20T03:00:00Z");
const SAU_KY = new Date("2026-10-20T04:00:00Z");
const ROWS = ["wg|A|1", "wg|B|2", "wg|C|3"];
const NONCE = "0123456789abcdef0123456789abcdef";
const OWNER = "owner@satarobo.example";
const WF = WORKFLOW_WAVE1.diTru;

let khoaA: ReturnType<typeof taoCapKhoa>;
let khoaB: ReturnType<typeof taoCapKhoa>;
let artifact: ArtifactPheDuyet;

beforeAll(() => {
  khoaA = taoCapKhoa();
  khoaB = taoCapKhoa();
  artifact = ky({});
});

function ky(o: { rows?: readonly string[]; workflow?: string; moi?: string; hanGio?: number; khoa?: ReturnType<typeof taoCapKhoa>; nonce?: string }): ArtifactPheDuyet {
  const rows = o.rows ?? ROWS;
  return kyPheDuyetGhi({
    privateKeyPem: (o.khoa ?? khoaA).privateKeyPem,
    workflow: o.workflow ?? WF,
    targetEnvironment: o.moi ?? "test",
    rows,
    soDongOwnerKhai: rows.length,
    ownerIdentity: OWNER,
    now: KY_LUC,
    hanGio: o.hanGio,
    nonce: o.nonce ?? NONCE,
  });
}

/** Client giả: tên DB + tập nonce đã có trong AuditLog. */
function khach(o: { tenDb?: string; daDung?: readonly string[] } = {}): KhachCongGhi & { demHoi: { findUnique: number } } {
  const dem = { findUnique: 0 };
  return {
    demHoi: dem,
    $queryRaw: (async () => [{ db: o.tenDb ?? "satarobo_test_wgb" }]) as unknown as KhachCongGhi["$queryRaw"],
    auditLog: {
      findUnique: async (a) => {
        dem.findUnique++;
        return (o.daDung ?? []).includes(a.where.id) ? { id: a.where.id } : null;
      },
    },
  };
}

function cong(ghiDe: Partial<DauVaoCongGhi> = {}): DauVaoCongGhi {
  return {
    artifact,
    publicKeyPem: khoaA.publicKeyPem,
    keyIdTinCay: khoaA.keyId,
    moiTruong: "test",
    ownerIdentities: null,
    now: SAU_KY,
    runRef: "test:1",
    ...ghiDe,
  };
}

async function ma(c: DauVaoCongGhi, o: { rows?: readonly string[]; workflow?: (typeof WORKFLOW_WAVE1)[keyof typeof WORKFLOW_WAVE1]; client?: KhachCongGhi } = {}): Promise<MaLoi | "OK"> {
  try {
    await kiemCongGhiTruocGhi(o.client ?? khach(), c, o.workflow ?? WF, o.rows ?? ROWS);
    return "OK";
  } catch (e) {
    if (e instanceof CongGhiTuChoi) return e.ma;
    throw e;
  }
}

describe("[WGB-U01] hợp lệ", () => {
  it("[WGB-U01a] artifact đúng ⇒ qua cổng, trả payload để claim", async () => {
    const r = await kiemCongGhiTruocGhi(khach(), cong(), WF, ROWS);
    expect(r.nonce).toBe(NONCE);
    expect(r.payload.expectedRowCount).toBe(3);
  });
  it("[WGB-U01b] thứ tự dòng không đổi kết quả (cổng tự tính digest từ các dòng lõi dựng)", async () => {
    expect(await ma(cong(), { rows: [...ROWS].reverse() })).toBe("OK");
  });
});

describe("[WGB-U02..10] từ chối — mỗi ca đúng MỘT lý do, đúng mã cố định", () => {
  it("[WGB-U02] sai digest: lõi dựng dòng KHÁC bản owner ký (cùng số dòng) ⇒ LECH_DIGEST", async () => {
    expect(await ma(cong(), { rows: ["wg|A|1", "wg|B|2", "wg|C|KHAC"] })).toBe("LECH_DIGEST");
  });
  it("[WGB-U03] sai số dòng (digest ký ĐÚNG nhưng expectedRowCount ký khác) ⇒ LECH_SO_DONG", async () => {
    const payload = { ...artifact.payload, expectedRowCount: 4 };
    const a: ArtifactPheDuyet = { payload, signature: kyThoPayload(payload, khoaA.privateKeyPem) };
    expect(await ma(cong({ artifact: a }))).toBe("LECH_SO_DONG");
  });
  it("[WGB-U04] hết hạn (now > expiresAt) ⇒ HET_HAN; đúng expiresAt vẫn qua", async () => {
    expect(await ma(cong({ now: new Date("2026-10-21T03:00:00.001Z") }))).toBe("HET_HAN");
    expect(await ma(cong({ now: new Date("2026-10-21T03:00:00.000Z") }))).toBe("OK");
  });
  it("[WGB-U05] sai workflow: artifact ký cho việc khác ⇒ SAI_WORKFLOW (workflow là HẰNG của lõi, không do người gọi quyết)", async () => {
    expect(await ma(cong({ artifact: ky({ workflow: WORKFLOW_WAVE1.noiDon }) }))).toBe("SAI_WORKFLOW");
    // và ngược lại: lõi noi-don không nhận artifact của di-tru
    expect(await ma(cong(), { workflow: WORKFLOW_WAVE1.noiDon })).toBe("SAI_WORKFLOW");
  });
  it("[WGB-U06] sai môi trường: ký cho prod, áp ở test ⇒ SAI_MOI_TRUONG (và ngược lại)", async () => {
    expect(await ma(cong({ artifact: ky({ moi: "prod" }) }))).toBe("SAI_MOI_TRUONG");
    expect(await ma(cong({ artifact: ky({ moi: "test" }), moiTruong: "prod" }), { client: khach({ tenDb: "satarobo" }) })).toBe("SAI_MOI_TRUONG");
  });
  it("[WGB-U07] replay: nonce đã có trong AuditLog `wg:<nonce>` ⇒ DA_DUNG", async () => {
    expect(await ma(cong(), { client: khach({ daDung: [`wg:${NONCE}`] }) })).toBe("DA_DUNG");
  });
  it("[WGB-U08] artifact bị sửa một byte (kể cả khi bên kỳ vọng khớp theo bản sửa) ⇒ SAI_CHU_KY", async () => {
    const sua = { ...artifact, payload: { ...artifact.payload, expectedRowCount: 2 } };
    expect(await ma(cong({ artifact: sua }), { rows: ROWS.slice(0, 2) })).toBe("SAI_CHU_KY");
    const doiChuKy = { ...artifact, signature: Buffer.from(Buffer.from(artifact.signature, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") };
    expect(await ma(cong({ artifact: doiChuKy }))).toBe("SAI_CHU_KY");
  });
  it("[WGB-U09] sai khoá công khai: khoá B được đưa vào (dù ghim khớp khoá B) nhưng artifact do A ký ⇒ KHOA_KHONG_KHOP; ghim khoá A + đưa khoá B ⇒ KHOA_KHONG_KHOP", async () => {
    expect(await ma(cong({ publicKeyPem: khoaB.publicKeyPem, keyIdTinCay: khoaB.keyId }))).toBe("KHOA_KHONG_KHOP");
    expect(await ma(cong({ publicKeyPem: khoaB.publicKeyPem }))).toBe("KHOA_KHONG_KHOP");
  });
  it("[WGB-U10] thiếu artifact ⇒ THIEU_ARTIFACT (null · undefined · rỗng)", async () => {
    for (const a of [null, undefined, "", "  \n"]) expect(await ma(cong({ artifact: a }))).toBe("THIEU_ARTIFACT");
  });
});

describe("[WGB-U13] fail-closed của lớp nối (không có ở thư viện thuần)", () => {
  it("[WGB-U13a] chưa GHIM vân tay khoá (rỗng / sai khuôn) ⇒ từ chối, kể cả khi mọi thứ khác đúng", async () => {
    expect(await ma(cong({ keyIdTinCay: "" }))).toBe("KHOA_KHONG_KHOP");
    expect(await ma(cong({ keyIdTinCay: khoaA.keyId.toUpperCase() }))).toBe("KHOA_KHONG_KHOP");
    expect(await ma(cong({ keyIdTinCay: "abc" }))).toBe("KHOA_KHONG_KHOP");
  });
  it("[WGB-U13b] chưa có khoá công khai ⇒ KHOA_CONG_KHAI_SAI", async () => {
    expect(await ma(cong({ publicKeyPem: "" }))).toBe("KHOA_CONG_KHAI_SAI");
    expect(await ma(cong({ publicKeyPem: "   " }))).toBe("KHOA_CONG_KHAI_SAI");
  });
  it("[WGB-U13c] môi trường ngoài {test, prod} ⇒ SAI_MOI_TRUONG — kể cả khi artifact ký đúng tên đó", async () => {
    for (const m of ["", "staging", "PROD", "test "]) {
      expect(await ma(cong({ moiTruong: m, artifact: ky({ moi: m === "" ? "test" : m.trim().toLowerCase() || "test" }) }))).toBe("SAI_MOI_TRUONG");
    }
    expect([...MOI_TRUONG_GHI]).toEqual(["test", "prod"]);
  });
  it("[WGB-U13d] môi trường phải KHỚP TÊN DB: prod mà DB mang tên test/local/dev ⇒ từ chối; test mà DB không có 'test' ⇒ từ chối", async () => {
    const prod = ky({ moi: "prod" });
    for (const db of ["satarobo_test", "satarobo_local", "satarobo_dev", "satarobo_vitest", "lamviec"]) {
      expect(await ma(cong({ artifact: prod, moiTruong: "prod" }), { client: khach({ tenDb: db }) }), db).toBe("SAI_MOI_TRUONG");
    }
    expect(await ma(cong({ artifact: prod, moiTruong: "prod" }), { client: khach({ tenDb: "satarobo" }) })).toBe("OK");
    expect(await ma(cong(), { client: khach({ tenDb: "satarobo" }) })).toBe("SAI_MOI_TRUONG");
    expect(kiemMoiTruongVoiDb("test", "ci_test")).toBeNull();
    expect(kiemMoiTruongVoiDb("khac", "x")).not.toBeNull();
  });
  it("[WGB-U13e] ownerIdentities có khai mà owner không nằm trong đó ⇒ SAI_OWNER; nằm trong ⇒ OK", async () => {
    expect(await ma(cong({ ownerIdentities: ["khac@x"] }))).toBe("SAI_OWNER");
    expect(await ma(cong({ ownerIdentities: [OWNER] }))).toBe("OK");
  });
  it("[WGB-U13f] không có nonce đọc được (artifact rác) ⇒ KHÔNG tra AuditLog; vẫn từ chối bằng mã đúng", async () => {
    const k = khach();
    expect(await ma(cong({ artifact: "{khong phai json" }), { client: k })).toBe("SCHEMA_SAI");
    expect(k.demHoi.findUnique).toBe(0);
  });
});

describe("[WGB-U14] claimPheDuyet — INSERT AuditLog `wg:<nonce>`", () => {
  const ok = (): Promise<Awaited<ReturnType<typeof kiemCongGhiTruocGhi>>> => kiemCongGhiTruocGhi(khach(), cong(), WF, ROWS);
  const chiTiet = { appliedAt: SAU_KY, rowCount: 3, runRef: "test:1" };

  it("[WGB-U14a] ghi ĐÚNG MỘT hàng với id = wg:<nonce>, module write-gate, changedFields [] (không để NULL lọt vào TEXT[])", async () => {
    const goi: Array<{ data: Record<string, unknown> }> = [];
    const tx = { auditLog: { create: async (a: { data: Record<string, unknown> }) => void goi.push(a) } };
    await claimPheDuyet(tx as never, await ok(), chiTiet);
    expect(goi).toHaveLength(1);
    expect(goi[0]!.data).toMatchObject({ id: `wg:${NONCE}`, module: "write-gate", entityType: "WriteGateArtifact", entityId: NONCE, action: "APPLY", changedFields: [] });
  });
  it("[WGB-U14b] vỡ khoá chính (P2002) ⇒ CongGhiTuChoi(DA_DUNG); lỗi khác ném NGUYÊN (không bị nuốt thành DA_DUNG)", async () => {
    const tx = (code: string) => ({ auditLog: { create: async () => Promise.reject(Object.assign(new Error("boom"), { code })) } });
    await expect(claimPheDuyet(tx("P2002") as never, await ok(), chiTiet)).rejects.toMatchObject({ name: "CongGhiTuChoi", ma: "DA_DUNG" });
    await expect(claimPheDuyet(tx("P2003") as never, await ok(), chiTiet)).rejects.toThrow("boom");
  });
});

describe("[WGB-U15] docCongGhiTuMoiTruong — lớp mỏng đọc env", () => {
  const now = SAU_KY;
  it("[WGB-U15a] thiếu mọi biến ⇒ trường rỗng (để cổng từ chối), KHÔNG ném, KHÔNG có mặc định 'cho qua'", () => {
    const c = docCongGhiTuMoiTruong({}, now);
    expect(c).toMatchObject({ artifact: null, publicKeyPem: "", keyIdTinCay: "", moiTruong: "", ownerIdentities: null, runRef: "khong-co-run" });
    expect(c.now).toBe(now);
  });
  it("[WGB-U15b] đọc PHE_DUYET, khoá (có `\\n` chữ), vân tay (chuẩn hoá chữ thường), owner, run id", () => {
    const c = docCongGhiTuMoiTruong(
      { PHE_DUYET: "{}", OWNER_APPROVAL_PUBKEY: "-----BEGIN PUBLIC KEY-----\\nAAA\\n-----END PUBLIC KEY-----", OWNER_APPROVAL_KEY_ID: ` ${"AB".repeat(32)} `, WG_MOI_TRUONG: "prod", OWNER_APPROVAL_OWNERS: "a@x, b@x", GITHUB_RUN_ID: "77", GITHUB_RUN_ATTEMPT: "2" },
      now,
    );
    expect(c.artifact).toBe("{}");
    expect(c.publicKeyPem).toContain("\nAAA\n");
    expect(c.keyIdTinCay).toBe("ab".repeat(32));
    expect(c.moiTruong).toBe("prod");
    expect(c.ownerIdentities).toEqual(["a@x", "b@x"]);
    expect(c.runRef).toBe("77:2");
  });
  it("[WGB-U15c] PHE_DUYET_TEP trỏ tệp không tồn tại ⇒ artifact null (THIEU_ARTIFACT), không ném", () => {
    expect(docCongGhiTuMoiTruong({ PHE_DUYET_TEP: "khong/ton/tai.json", PHE_DUYET: "{}" }, now).artifact).toBeNull();
  });
});
