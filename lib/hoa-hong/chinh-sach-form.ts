// lib/hoa-hong/chinh-sach-form.ts — MÔ HÌNH FORM của builder chính sách (06 §5.2): kiểu dây (zod), kiểm theo bước, dựng
// payload cho service, đảo ngược từ version đã lưu, map lỗi máy chủ về đúng ô. THUẦN — không DB, không đồng hồ.
//
// Vì sao tách khỏi component: đây là nơi quyết định tiền nào được LƯU. Component chỉ vẽ và gọi các hàm này; client và
// Server Action dùng CHUNG một bộ kiểm (client để chỉ lỗi cạnh ô, server để không tin client) — hai bộ kiểm riêng là
// hai luật, và luật nào lệch thì một bên cho qua thứ bên kia chặn.
//
// Phạm vi cố ý HẸP so với service (đã quyết, ghi ở docs/source-commission/06):
//   · kiểu tính: chỉ PERCENT và EXCLUDE — guardrail chặn FIXED/TIER (`KIEU_TINH_CHUA_HO_TRO`) nên offer chúng là lời hứa suông;
//   · phạm vi: GLOBAL · SOURCE_GROUP · ORG_UNIT — PERSON/AFFILIATE/ROLE không có đường chọn người ở màn này; SOURCE/CAMPAIGN/EVENT
//     chưa dùng được (cột scopeSourceId chưa có). Version đã lưu mang phạm vi/kiểu ngoài tập này thì `formTuPhienBan` NÓI RÕ
//     là không soạn được ở đây (không lặng lẽ biến thành GLOBAL);
//   · thành phần doanh thu: chỉ TUITION (D17).
import { z } from "zod";

import type { PhamViInput, RuleInput } from "./chinh-sach-dau-vao";
import { dauNgayVN, ngayHopLe, ngayVN } from "./ngay-lam-viec";
import { dinhDangPhanTram, docPhanTram } from "./phan-tram";
import { MASTER_VAI_HUONG } from "./vai-huong";

// ── Bước ────────────────────────────────────────────────────────────────────

export const BUOC = ["boi-canh", "nguoi-huong", "cach-tinh", "van-ban", "hieu-luc", "thu-tinh", "kich-hoat"] as const;
export type BuocKey = (typeof BUOC)[number];

export const NHAN_BUOC: Record<BuocKey, string> = {
  "boi-canh": "Bối cảnh",
  "nguoi-huong": "Người hưởng",
  "cach-tinh": "Cách tính",
  "van-ban": "Văn bản",
  "hieu-luc": "Hiệu lực",
  "thu-tinh": "Thử tính",
  "kich-hoat": "Kích hoạt",
};

/** Loại giao dịch soạn được (bộ phân loại chỉ ra được hai loại này — `loai-giao-dich.ts`). */
export const LOAI_GD_SOAN = ["NEW", "RENEWAL"] as const;
export type LoaiGdSoan = (typeof LOAI_GD_SOAN)[number];

export const NHAN_LOAI_GD: Record<LoaiGdSoan, string> = { NEW: "Khách hàng mới", RENEWAL: "Tái tục" };

// ── Kiểu dây (zod là nguồn của kiểu) ────────────────────────────────────────

const oSchema = z.object({
  kieu: z.enum(["PERCENT", "EXCLUDE"]),
  /** Chữ người dùng gõ ("3", "3,5"). Rỗng = không có rule ở ô này. */
  phanTram: z.string().max(20),
});

const ngaySchema = z.string().max(10);

const vanBanSchema = z.discriminatedUnion("kieu", [
  z.object({ kieu: z.literal("chua") }),
  z.object({ kieu: z.literal("co-san"), id: z.string().max(64) }),
  z.object({
    kieu: z.literal("moi"),
    documentCode: z.string().max(80),
    title: z.string().max(300),
    issuedOn: ngaySchema,
    publishedOn: ngaySchema,
    effectiveOn: ngaySchema,
    approvedByName: z.string().max(120),
    tep: z.object({ key: z.string().max(300), ten: z.string().max(300), url: z.string().max(1000) }).nullable(),
  }),
]);

export const formChinhSachSchema = z.object({
  policyCode: z.string().max(80),
  name: z.string().max(200),
  description: z.string().max(2000),
  /** `null` = Hội sở / toàn hệ. */
  chuSoHuuOrgUnitId: z.string().max(64).nullable(),
  phamVi: z.discriminatedUnion("loai", [
    z.object({ loai: z.literal("GLOBAL") }),
    z.object({ loai: z.literal("SOURCE_GROUP"), sourceGroupId: z.string().max(64) }),
    z.object({ loai: z.literal("ORG_UNIT"), orgUnitId: z.string().max(64) }),
  ]),
  loaiGd: z.array(z.enum(LOAI_GD_SOAN)).max(2),
  vai: z.array(z.string().max(40)).max(40),
  /** Khoá `"<LOẠI>|<VAI>"`. */
  o: z.record(z.string().max(80), oSchema),
  vanBan: vanBanSchema,
  hieuLucTu: ngaySchema,
  /** Ngày CUỐI còn áp dụng (gồm cả). Rỗng = không kết thúc. */
  hieuLucDen: ngaySchema,
  lyDo: z.string().max(2000),
});
export type FormChinhSach = z.infer<typeof formChinhSachSchema>;
export type OTinh = z.infer<typeof oSchema>;
export type VanBanForm = z.infer<typeof vanBanSchema>;

export function formRong(): FormChinhSach {
  return {
    policyCode: "",
    name: "",
    description: "",
    chuSoHuuOrgUnitId: null,
    phamVi: { loai: "GLOBAL" },
    loaiGd: [],
    vai: [],
    o: {},
    vanBan: { kieu: "chua" },
    hieuLucTu: "",
    hieuLucDen: "",
    lyDo: "",
  };
}

export const khoaO = (loai: string, vai: string): string => `${loai}|${vai}`;

// ── Trường → bước ───────────────────────────────────────────────────────────

export function buocCuaTruong(truong: string): BuocKey {
  if (truong === "vai") return "nguoi-huong";
  if (truong.startsWith("o.")) return "cach-tinh";
  if (truong.startsWith("vanBan")) return "van-ban";
  if (truong === "hieuLucTu" || truong === "hieuLucDen" || truong === "lyDo") return "hieu-luc";
  return "boi-canh";
}

export type LoiO = { truong: string; thongBao: string; buoc: BuocKey };
const loi = (truong: string, thongBao: string): LoiO => ({ truong, thongBao, buoc: buocCuaTruong(truong) });

const MA_CHINH_SACH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,79}$/;

const tenVai = (code: string): string => MASTER_VAI_HUONG.find((v) => v.code === code)?.name ?? code;

// ── Kiểm ────────────────────────────────────────────────────────────────────

/** Phần form mà SERVICE đòi để LƯU NHÁP (mã, tên, phạm vi, ngày, lý do) + ô gõ dở không đọc được. KHÔNG đòi văn bản/tỉ lệ đủ. */
export function loiLuuNhap(f: FormChinhSach): LoiO[] {
  const ra: LoiO[] = [];

  if (!MA_CHINH_SACH_RE.test(f.policyCode.trim())) {
    ra.push(loi("policyCode", f.policyCode.trim() === "" ? "Nhập mã chính sách." : "Mã gồm chữ, số, dấu chấm, gạch hoặc gạch chéo (tối thiểu 2 ký tự), vd SR.QD.300/HV_MOI."));
  }
  if (f.name.trim() === "") ra.push(loi("name", "Nhập tên chính sách."));
  if (f.phamVi.loai === "SOURCE_GROUP" && f.phamVi.sourceGroupId === "") ra.push(loi("phamVi.sourceGroupId", "Chọn nhóm nguồn mà chính sách này áp dụng."));
  if (f.phamVi.loai === "ORG_UNIT" && f.phamVi.orgUnitId === "") ra.push(loi("phamVi.orgUnitId", "Chọn cơ sở mà chính sách này áp dụng."));

  // Ô tỉ lệ đang gõ dở: chỉ xét ô thuộc vai × loại ĐANG chọn (ô của vai đã bỏ chọn không còn nghĩa).
  for (const l of f.loaiGd) {
    for (const v of f.vai) {
      const o = f.o[khoaO(l, v)];
      if (!o || o.kieu !== "PERCENT") continue;
      const r = docPhanTram(o.phanTram);
      if (r.kieu === "loi") ra.push(loi(`o.${khoaO(l, v)}`, r.loi));
    }
  }

  const vb = f.vanBan;
  if (vb.kieu === "co-san" && vb.id === "") ra.push(loi("vanBan.id", "Chọn một văn bản đã có, hoặc tạo văn bản mới."));
  if (vb.kieu === "moi") {
    if (vb.documentCode.trim() === "") ra.push(loi("vanBan.documentCode", "Nhập số hiệu văn bản, vd SR.QD.300."));
    if (vb.title.trim() === "") ra.push(loi("vanBan.title", "Nhập tiêu đề văn bản."));
    if (vb.approvedByName.trim() === "") ra.push(loi("vanBan.approvedByName", "Nhập người duyệt văn bản."));
    for (const [k, nhan] of [["issuedOn", "ngày ban hành"], ["publishedOn", "ngày công bố"], ["effectiveOn", "ngày hiệu lực ghi trong văn bản"]] as const) {
      if (vb[k] === "") ra.push(loi(`vanBan.${k}`, `Nhập ${nhan}.`));
      else if (!ngayHopLe(vb[k])) ra.push(loi(`vanBan.${k}`, `Ngày không có thật (dạng năm-tháng-ngày).`));
    }
  }

  if (f.hieuLucTu === "") ra.push(loi("hieuLucTu", "Chọn ngày bắt đầu hiệu lực."));
  else if (!ngayHopLe(f.hieuLucTu)) ra.push(loi("hieuLucTu", "Ngày không có thật (dạng năm-tháng-ngày)."));
  if (f.hieuLucDen !== "") {
    if (!ngayHopLe(f.hieuLucDen)) ra.push(loi("hieuLucDen", "Ngày không có thật (dạng năm-tháng-ngày)."));
    else if (ngayHopLe(f.hieuLucTu) && f.hieuLucDen < f.hieuLucTu) ra.push(loi("hieuLucDen", "Ngày kết thúc phải từ ngày bắt đầu trở đi."));
  }
  if (f.lyDo.trim() === "") ra.push(loi("lyDo", "Ghi lý do / căn cứ của phiên bản này."));

  return ra;
}

/** Kiểm ĐẦY ĐỦ mọi bước (cho nút Tiếp/Đi tới Kích hoạt). Gồm cả phần của `loiLuuNhap`. */
export function kiemForm(f: FormChinhSach): LoiO[] {
  const ra = loiLuuNhap(f);
  if (f.loaiGd.length === 0) ra.push(loi("loaiGd", "Chọn ít nhất một loại giao dịch."));
  if (f.vai.length === 0) ra.push(loi("vai", "Chọn ít nhất một vai được hưởng."));

  const daBao = new Set(ra.map((x) => x.truong));
  for (const v of f.vai) {
    if (f.loaiGd.length === 0) break;
    const coO = f.loaiGd.some((l) => {
      const o = f.o[khoaO(l, v)];
      return !!o && (o.kieu === "EXCLUDE" || docPhanTram(o.phanTram).kieu === "ok");
    });
    const oDau = `o.${khoaO(f.loaiGd[0]!, v)}`;
    if (!coO && !daBao.has(oDau)) ra.push(loi(oDau, `Vai "${tenVai(v)}" chưa có tỉ lệ nào — nhập ít nhất một ô, hoặc bỏ vai này ở bước Người hưởng.`));
  }
  return ra;
}

export function loiTheoBuoc(f: FormChinhSach, buoc: BuocKey): LoiO[] {
  return kiemForm(f).filter((l) => l.buoc === buoc);
}

// ── Tệp đính kèm văn bản ────────────────────────────────────────────────────

const KEY_TEP_RE = /^uploads\/(documents|images)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Tệp đính kèm do CLIENT khai (`key` + `url`) — máy chủ không được tin nguyên văn: guardrail kích hoạt chỉ hỏi "có chuỗi nào không",
 * nên một chuỗi bất kỳ (`javascript:…`, trang ngoài) sẽ qua điều kiện "văn bản phải kèm tệp" và còn được vẽ thành liên kết ở trang duyệt.
 * Hợp lệ khi: `key` nằm dưới thư mục upload của tài liệu/ảnh (đúng thứ `/api/admin/upload-url` cấp cho `commission_policies:manage`),
 * không đi ngược `..`; và `url` đúng bằng `<gốc công khai>/<key>` (https). Trả thông báo lỗi, hoặc `null` khi hợp lệ.
 * `gocCongKhai = null` (chưa cấu hình kho R2 — chỉ xảy ra ngoài prod): vẫn đòi https và đuôi đường dẫn = key.
 */
export function loiTepVanBan(tep: { key: string; url: string }, gocCongKhai: string | null): string | null {
  const KHONG = "Tệp đính kèm không hợp lệ — hãy chọn lại tệp từ máy của bạn.";
  if (!KEY_TEP_RE.test(tep.key) || tep.key.split("/").includes("..")) return KHONG;
  let u: URL;
  try {
    u = new URL(tep.url);
  } catch {
    return KHONG;
  }
  if (u.protocol !== "https:" || u.search !== "" || u.hash !== "") return KHONG;
  if (gocCongKhai === null) return u.pathname.endsWith(`/${tep.key}`) ? null : KHONG;
  return tep.url === `${gocCongKhai.replace(/\/$/, "")}/${tep.key}` ? null : KHONG;
}

/** Lỗi tệp đính kèm → ô `vanBan.tep` (bước Văn bản). */
export const loiOTepVanBan = (thongBao: string): LoiO => loi("vanBan.tep", thongBao);

// ── Payload cho tầng ghi ────────────────────────────────────────────────────

export type PayloadVanBan =
  | { kieu: "chua" }
  | { kieu: "co-san"; id: string }
  | {
      kieu: "moi";
      documentCode: string;
      title: string;
      issuedOn: string;
      publishedOn: string;
      effectiveOn: string;
      approvedByName: string;
      fileKey: string | null;
      fileName: string | null;
      fileUrl: string | null;
    };

export type PayloadChinhSach = {
  policyCode: string;
  name: string;
  description: string | null;
  ownerOrgUnitId: string | null;
  phamVi: PhamViInput;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  vanBan: PayloadVanBan;
  rules: RuleInput[];
};

const MS_NGAY = 86_400_000;

function ruleTuForm(f: FormChinhSach): RuleInput[] {
  const ra: RuleInput[] = [];
  for (const l of LOAI_GD_SOAN) {
    if (!f.loaiGd.includes(l)) continue;
    for (const v of f.vai) {
      const o = f.o[khoaO(l, v)];
      if (!o) continue;
      const base = { transactionTypeCode: l, roleCode: v, revenueComponent: "TUITION" as const, fixedAmount: null, tierTable: null, note: null };
      if (o.kieu === "EXCLUDE") {
        ra.push({ ...base, calcKind: "EXCLUDE", rate: null });
        continue;
      }
      const r = docPhanTram(o.phanTram);
      if (r.kieu === "ok") ra.push({ ...base, calcKind: "PERCENT", rate: r.tiLe });
    }
  }
  return ra;
}

/** Form → payload. Chỉ đòi phần của `loiLuuNhap`: đủ để LƯU NHÁP; việc "đủ để kích hoạt" là của guardrail máy chủ. */
export function dungPayload(f: FormChinhSach): { ok: true; payload: PayloadChinhSach } | { ok: false; loi: LoiO[] } {
  const l = loiLuuNhap(f);
  if (l.length > 0) return { ok: false, loi: l };
  const vb = f.vanBan;
  const vanBan: PayloadVanBan =
    vb.kieu === "moi"
      ? {
          kieu: "moi",
          documentCode: vb.documentCode.trim(),
          title: vb.title.trim(),
          issuedOn: vb.issuedOn,
          publishedOn: vb.publishedOn,
          effectiveOn: vb.effectiveOn,
          approvedByName: vb.approvedByName.trim(),
          fileKey: vb.tep?.key ?? null,
          fileName: vb.tep?.ten ?? null,
          fileUrl: vb.tep?.url ?? null,
        }
      : vb;
  const phamVi: PhamViInput =
    f.phamVi.loai === "GLOBAL"
      ? { loai: "GLOBAL" }
      : f.phamVi.loai === "SOURCE_GROUP"
        ? { loai: "SOURCE_GROUP", sourceGroupId: f.phamVi.sourceGroupId }
        : { loai: "ORG_UNIT", orgUnitId: f.phamVi.orgUnitId };
  return {
    ok: true,
    payload: {
      policyCode: f.policyCode.trim(),
      name: f.name.trim(),
      description: f.description.trim() === "" ? null : f.description.trim(),
      ownerOrgUnitId: f.chuSoHuuOrgUnitId,
      phamVi,
      effectiveFrom: dauNgayVN(f.hieuLucTu),
      // "đến hết ngày D" ⇒ biên MỞ tại 00:00 VN của D+1. Giờ VN không có giờ mùa hè nên cộng đúng 24 giờ.
      effectiveTo: f.hieuLucDen === "" ? null : new Date(dauNgayVN(f.hieuLucDen).getTime() + MS_NGAY),
      reason: f.lyDo.trim(),
      vanBan,
      rules: ruleTuForm(f),
    },
  };
}

// ── Đảo ngược: version đã lưu → form ────────────────────────────────────────

export type PhienBanChoForm = {
  policyCode: string;
  name: string;
  description: string | null;
  ownerOrgUnitId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  reason: string;
  documentId: string | null;
  scope: { scopeType: string; scopeSourceGroupId: string | null; scopeOrgUnitId: string | null };
  rules: readonly {
    transactionTypeCode: string;
    roleCode: string;
    calcKind: "PERCENT" | "FIXED_PER_PURCHASE" | "TIER_PERIOD_BONUS" | "EXCLUDE";
    rate: string | null;
    revenueComponent?: string;
  }[];
};

export function formTuPhienBan(p: PhienBanChoForm): { form: FormChinhSach; khongBieuDienDuoc: string[] } {
  const khong: string[] = [];
  let phamVi: FormChinhSach["phamVi"] = { loai: "GLOBAL" };
  if (p.scope.scopeType === "SOURCE_GROUP" && p.scope.scopeSourceGroupId) phamVi = { loai: "SOURCE_GROUP", sourceGroupId: p.scope.scopeSourceGroupId };
  else if (p.scope.scopeType === "ORG_UNIT" && p.scope.scopeOrgUnitId) phamVi = { loai: "ORG_UNIT", orgUnitId: p.scope.scopeOrgUnitId };
  else if (p.scope.scopeType !== "GLOBAL") khong.push(`Phạm vi ${p.scope.scopeType} chưa soạn được ở màn này.`);

  const loaiCo = new Set<string>();
  const vai: string[] = [];
  const o: Record<string, OTinh> = {};
  for (const r of p.rules) {
    if (!(LOAI_GD_SOAN as readonly string[]).includes(r.transactionTypeCode) || (r.revenueComponent ?? "TUITION") !== "TUITION") {
      khong.push(`Rule ${r.roleCode} · ${r.transactionTypeCode}${r.revenueComponent && r.revenueComponent !== "TUITION" ? ` · ${r.revenueComponent}` : ""} chưa soạn được ở màn này.`);
      continue;
    }
    if (r.calcKind !== "PERCENT" && r.calcKind !== "EXCLUDE") {
      khong.push(`Rule ${r.roleCode} · ${r.transactionTypeCode} kiểu ${r.calcKind}${r.calcKind === "TIER_PERIOD_BONUS" ? " (thưởng theo bậc)" : ""} chưa soạn được ở màn này.`);
      continue;
    }
    loaiCo.add(r.transactionTypeCode);
    if (!vai.includes(r.roleCode)) vai.push(r.roleCode);
    o[khoaO(r.transactionTypeCode, r.roleCode)] =
      r.calcKind === "EXCLUDE" ? { kieu: "EXCLUDE", phanTram: "" } : { kieu: "PERCENT", phanTram: dinhDangPhanTram(r.rate ?? "0") };
  }

  const form: FormChinhSach = {
    policyCode: p.policyCode,
    name: p.name,
    description: p.description ?? "",
    chuSoHuuOrgUnitId: p.ownerOrgUnitId,
    phamVi,
    loaiGd: LOAI_GD_SOAN.filter((l) => loaiCo.has(l)),
    vai,
    o,
    vanBan: p.documentId ? { kieu: "co-san", id: p.documentId } : { kieu: "chua" },
    hieuLucTu: ngayVN(p.effectiveFrom),
    // effectiveTo là biên MỞ ⇒ ngày CUỐI còn áp dụng là ngày trước đó.
    hieuLucDen: p.effectiveTo ? ngayVN(new Date(p.effectiveTo.getTime() - MS_NGAY)) : "",
    lyDo: p.reason,
  };
  return { form, khongBieuDienDuoc: khong };
}

// ── Lỗi máy chủ → ô ─────────────────────────────────────────────────────────

export type LoiMayChu =
  | { kieu: "hoa-hong"; ma: string; message: string; chiTiet?: unknown }
  | { kieu: "trung-khoa"; cot: readonly string[] };

const RE_RULE = /^Rule #\d+ \(([A-Z_]+) · ([A-Z_]+)\): (.+)$/;

/**
 * Lỗi service ném → các ô cần tô đỏ + (nếu không biết ô nào) một câu CHUNG. Không bịa ô: lỗi lạ đi vào `chung`, để form
 * hiện nó ở đầu thay vì gắn vào một ô vô tội.
 */
export function anhXaLoiMayChu(e: LoiMayChu): { loi: LoiO[]; chung: string | null } {
  if (e.kieu === "trung-khoa") {
    if (e.cot.includes("policyCode")) return { loi: [loi("policyCode", "Mã này đã có chính sách khác dùng — đổi mã.")], chung: null };
    if (e.cot.includes("documentCode")) return { loi: [loi("vanBan.documentCode", "Số hiệu văn bản này đã có — chọn văn bản đã có thay vì tạo lại.")], chung: null };
    return { loi: [], chung: "Dữ liệu trùng với bản đã có." };
  }

  if (e.ma === "VAN_BAN_KHONG_TON_TAI") return { loi: [loi("vanBan.id", "Văn bản này không còn tồn tại — chọn văn bản khác.")], chung: null };
  if (e.ma === "DON_VI_KHONG_HOP_LE") return { loi: [loi("chuSoHuu", e.message)], chung: null };

  if (e.ma === "DU_LIEU_KHONG_HOP_LE") {
    const dong = Array.isArray(e.chiTiet) ? (e.chiTiet as unknown[]).filter((x): x is string => typeof x === "string") : [];
    const theoRule = dong.map((d) => RE_RULE.exec(d)).filter((m): m is RegExpExecArray => m !== null);
    if (theoRule.length > 0) {
      return { loi: theoRule.map((m) => loi(`o.${khoaO(m[2]!, m[1]!)}`, m[3]!)), chung: null };
    }
    const m = e.message;
    if (/lý do/i.test(m)) return { loi: [loi("lyDo", m)], chung: null };
    if (/Hiệu lực kết thúc/.test(m)) return { loi: [loi("hieuLucDen", m)], chung: null };
    if (/mã và tên/.test(m)) return { loi: [loi("policyCode", m)], chung: null };
    if (/Văn bản cần/.test(m)) return { loi: [loi("vanBan.documentCode", m)], chung: null };
    if (/Đơn vị .*không tồn tại/.test(m)) return { loi: [loi("phamVi.orgUnitId", m)], chung: null };
    if (/Nhóm nguồn .*không tồn tại/.test(m)) return { loi: [loi("phamVi.sourceGroupId", m)], chung: null };
    if (/không tồn tại/.test(m)) return { loi: [loi("phamVi", m)], chung: null };
  }
  return { loi: [], chung: e.message };
}
