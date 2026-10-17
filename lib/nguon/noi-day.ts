/**
 * lib/nguon/noi-day.ts — ĐIỂM NỐI DUY NHẤT giữa các đường tạo/nhập lead và module nguồn (PR2). Đặc tả `03 §5`, `07 §2.8`.
 *
 * Mọi đường (A–E, `docs/source-commission/03 §5.1`) đi qua đúng HAI bước, cả hai CHỈ ở tệp này:
 *
 *   1. `chuanBiQuyNguon(db, rows)`  — TRƯỚC transaction. Đọc cờ; cờ master TẮT ⇒ `{ bat: false }`, KHÔNG chạm DB, KHÔNG
 *      tạo bản ghi nào (hành vi như hôm nay). Cờ BẬT ⇒ thu thập tín hiệu bằng `db` KHÔNG scope (T11), chạy `quyNguon`,
 *      dựng sẵn `DuLieuNguon` + touchpoint. Mọi lỗi ở bước này được NUỐT có ghi log và trả `{ bat: false, loi }` — quy
 *      nguồn không bao giờ chặn lead của đường MÁY (T4); lead vẫn tạo, script di trú sẽ vét.
 *   2. `ghiQuyNguonLeadMoi(tx, leadId, chuanBi, actorId)` / `ghiQuyNguonTheoLo(tx, ds, actorId)` — TRONG transaction của
 *      đường gọi, ngay sau `lead.create` (T5). Chỉ GHI, không tra thêm gì, không ném vì luật nguồn.
 *
 * Nhánh TRÙNG SĐT (lead còn sống ⇒ không tạo lead, D3): `ghiTinHieuDenSau` — chỉ ghi TOUCHPOINT trên lead cũ, KHÔNG BAO GIỜ
 * đổi attribution (ref đến sau KHÔNG chiếm nguồn).
 *
 * Quy ước client: `db` của `chuanBiQuyNguon` là client KHÔNG scope; `tx` là transaction của đường gọi (có thể đã bọc phạm
 * vi — attribution/touchpoint không có cột đơn vị nên không bị lọc, xem ngoại lệ luật Nền #3, 02 §2.5).
 */
import type { Prisma } from "@prisma/client";
import { normalizeAffiliateCode } from "@/lib/affiliate";
import { chuanHoaNhanNguon, laNhanTheoNguoiNhap } from "./anh-xa-nhan-cu";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { cachXuLyNhanLa, laEpChonNguon, laQuanLyNguonBat } from "./feature";
import {
  ghiTouchpoint,
  ghiTouchpointTheoLo,
  taoNguonBanDau,
  taoNguonTheoLo,
  type DuLieuNguon,
  type TouchpointMoi,
} from "./ghi-nguon";
import { thamChieuSangNguoi } from "./kiem-nguon";
import { quyNguon } from "./quy-nguon";
import { thuThapTinHieuTheoLo, type DauVaoTinHieu, type DbKhongScope } from "./thu-thap-tin-hieu";
import type { KetQuaQuyNguon, QuangCaoTin, UtmTin } from "./tin-hieu";

type Tx = Prisma.TransactionClient;

/** Đầu vào của MỘT dòng: tín hiệu thô + cơ sở (`OrgUnit.id`) của DÒNG để áp cờ ép chọn theo cơ sở. BẮT BUỘC khai (luật 7). */
/**
 * `orgUnitId` (nếu đường gọi đã biết) HOẶC `centerId` (nếu chỉ biết cơ sở cũ) — cả hai BẮT BUỘC khai. `centerId` chỉ được đổi sang
 * `OrgUnit.id` KHI CỜ BẬT: cờ TẮT ⇒ không một truy vấn nào ngoài việc đọc cờ (đừng `await orgUnitIdForCenter` ở chỗ gọi).
 */
export type DauVaoNoiDay = DauVaoTinHieu & { orgUnitId: string | null; centerId: string | null };

export type NguonDaChuanBi =
  | { bat: false; loi?: string }
  | {
      bat: true;
      ketQua: KetQuaQuyNguon;
      duLieu: DuLieuNguon;
      touchpoints: TouchpointMoi[];
      /** Cơ sở này ÉP CHỌN nguồn mà nhãn lạ ⇒ đường NGƯỜI NHẬP phải bị chặn TRƯỚC transaction (T4). null = không chặn. */
      chanNhap: string | null;
    };

const KHONG_CHUAN_BI: NguonDaChuanBi = { bat: false };

/**
 * Nhãn nguồn đưa vào resolver: chữ NGƯỜI GÕ nếu có; không thì CHÍNH nhãn máy của đường vào khi đó là loại "người nhập
 * quyết nhóm" (`sale-form`, `sale-form-app` — D12). Đường vào khác (facebook, zalo, google-form, quatang, web) KHÔNG phải
 * nhãn: chúng đi luật `DUONG_VAO_MAC_DINH`, đừng ép chúng qua bảng 28 nhãn cũ (sẽ ra INVALID oan).
 */
export function nhanKhaiCuaDuongVao(duongVao: string, nhanNguoiGo: string | null | undefined): string | null {
  const go = (nhanNguoiGo ?? "").trim();
  if (go !== "") return go;
  return laNhanTheoNguoiNhap(chuanHoaNhanNguon(duongVao)) ? duongVao : null;
}

function nguoiSangCot(k: KetQuaQuyNguon) {
  const n = k.nguoi;
  if (n === null) return thamChieuSangNguoi(null);
  if (n.kind === "EMPLOYEE") {
    return thamChieuSangNguoi({ employeeId: n.employeeId, parentUserId: null, studentId: null, affiliateId: null });
  }
  if (n.kind === "PARENT") {
    return thamChieuSangNguoi({ employeeId: null, parentUserId: n.parentUserId, studentId: n.studentId, affiliateId: null });
  }
  return thamChieuSangNguoi({ employeeId: null, parentUserId: null, studentId: null, affiliateId: n.affiliateId });
}

/** `KetQuaQuyNguon` (mã nhóm) → `DuLieuNguon` (id nhóm) + touchpoint thua. Ném nếu danh mục thiếu UNKNOWN (lỗi triển khai). */
export function dungDuLieuTuKetQua(
  k: KetQuaQuyNguon,
  nhomId: ReadonlyMap<string, string>,
  macDinhUnknown = "UNKNOWN",
): { duLieu: DuLieuNguon; touchpoints: TouchpointMoi[] } {
  const unknown = nhomId.get(macDinhUnknown);
  if (unknown === undefined) throw new Error("Danh mục nguồn thiếu nhóm UNKNOWN — chưa seed migration PR1?");
  const idNhom = (code: string): string => nhomId.get(code) ?? unknown;
  const groupId = idNhom(k.groupCode);
  const duLieu: DuLieuNguon = {
    groupId,
    otherSourceNote: k.otherSourceNote,
    ...nguoiSangCot(k),
    referrerMissing: k.referrerMissing,
    referrerRoleCode: k.anhChup.referrerRoleCode,
    referrerSaleUserId: k.anhChup.referrerSaleUserId,
    identificationMethod: k.identificationMethod,
    matchedRule: k.luat,
    reasonText: k.reasonText,
    canhBao: [...k.canhBao],
    originalGroupId: idNhom(k.originalGroupCode),
    inheritedFromLeadId: k.inheritedFromLeadId,
    conversionEntry: k.conversionEntry,
    signals: k.signals as Prisma.InputJsonObject,
    attributedAt: k.attributedAt,
  };
  const touchpoints: TouchpointMoi[] = k.touchpointThua.map((t) => ({
    kind: t.kind,
    conversionEntry: k.conversionEntry,
    claimedGroupId: t.claimedGroupCode === null ? null : (nhomId.get(t.claimedGroupCode) ?? null),
    signals: t.signals as Prisma.InputJsonObject,
  }));
  return { duLieu, touchpoints };
}

/**
 * Mô tả lỗi để GHI LOG: tên + mã + thông điệp đã che SĐT (chuỗi ≥ 9 chữ số) và email, cắt 300 ký tự. Lỗi Prisma có thể chèn nguyên giá trị
 * truy vấn (`phone: { in: [...] }`) vào `message` — log/Sentry là nơi khách không được phép nằm.
 */
export function moTaLoiAnToan(err: unknown): string {
  if (!(err instanceof Error)) return "lỗi không rõ";
  const ma = (err as { code?: unknown }).code;
  const msg = err.message
    .replace(/\+?\d[\d\s.-]{7,}\d/g, "[SDT]")
    .replace(/[^\s"',]+@[^\s"',]+/g, "[EMAIL]")
    .slice(0, 300);
  return `${err.name}${typeof ma === "string" ? ` (${ma})` : ""}: ${msg}`;
}

/**
 * BƯỚC 1 — chạy TRƯỚC transaction. Kết quả cùng thứ tự `rows`. Cờ master TẮT ⇒ mọi phần tử `{ bat: false }`.
 * `dbKhongScope` BẮT BUỘC, kiểu `typeof db` (lưới `[QN-W7]`).
 */
export async function chuanBiQuyNguon(
  dbKhongScope: DbKhongScope,
  rows: readonly DauVaoNoiDay[],
): Promise<NguonDaChuanBi[]> {
  if (rows.length === 0) return [];
  try {
    if (!(await laQuanLyNguonBat())) return rows.map(() => KHONG_CHUAN_BI);

    const thu = await thuThapTinHieuTheoLo(dbKhongScope, rows);

    // Cờ ép chọn theo CƠ SỞ của dòng — mỗi cơ sở một lần (getSetting có cache). `centerId` ⇒ `OrgUnit.id` chỉ ở đây (cờ đã BẬT).
    const donViCuaDong: (string | null)[] = [];
    const donViTheoCenter = new Map<string, string | null>();
    for (const r of rows) {
      let id = r.orgUnitId;
      if (id === null && r.centerId !== null) {
        if (!donViTheoCenter.has(r.centerId)) donViTheoCenter.set(r.centerId, await orgUnitIdForCenter(r.centerId));
        id = donViTheoCenter.get(r.centerId) ?? null;
      }
      donViCuaDong.push(id);
    }
    const epTheoCoSo = new Map<string | null, boolean>();
    for (const id of donViCuaDong) {
      if (!epTheoCoSo.has(id)) epTheoCoSo.set(id, await laEpChonNguon(id));
    }

    return rows.map((r, i) => {
      const ketQua = quyNguon(thu.tin[i]!, thu.cauHinh);
      const { duLieu, touchpoints } = dungDuLieuTuKetQua(ketQua, thu.nhomId, thu.cauHinh.dich.unknown);
      const cach = cachXuLyNhanLa({ nguonBat: true, epChonNguon: epTheoCoSo.get(donViCuaDong[i]!) === true });
      // Lựa chọn tường minh ở ô chọn nguồn mà KHÔNG hợp lệ (thiếu người, người đã nghỉ, giải trình ngắn, nhóm đã ngừng…) ⇒ CHẶN, bất kể
      // cờ ép chọn: người nhập đã nói rõ ý mà ta không ghi được thì phải nói lại họ, không âm thầm rơi UNKNOWN (PR7).
      const loiChon = thu.tin[i]!.nguonChon?.loi ?? null;
      const chanNhap =
        loiChon ??
        (cach === "CHAN_NHAP" && ketQua.xemTay.includes("NHAN_NGUON_LA")
          ? `Nguồn "${(r.nhanKhai ?? "").trim()}" không có trong danh sách nguồn — hãy chọn đúng một nguồn.`
          : null);
      return { bat: true as const, ketQua, duLieu, touchpoints, chanNhap };
    });
  } catch (err) {
    // T4 — đường máy không bao giờ bị chặn vì quy nguồn. Ghi log, để lead đi tiếp; di trú vét sau.
    const moTa = moTaLoiAnToan(err);
    console.error(`[nguon] chuẩn bị quy nguồn lỗi — lead vẫn được tạo, chưa có quy nguồn: ${moTa}`);
    return rows.map(() => ({ bat: false as const, loi: moTa }));
  }
}

/**
 * BƯỚC 2 (một lead) — TRONG transaction, ngay sau `lead.create`. `bat: false` ⇒ KHÔNG ghi gì.
 * Lượt TẠO bị đua (lead đã có dòng quy nguồn) ⇒ `taoNguonBanDau` tự ghi touchpoint thua; touchpoint tín hiệu thua của
 * chính lượt này vẫn được ghi.
 */
export async function ghiQuyNguonLeadMoi(
  tx: Tx,
  leadId: string,
  chuanBi: NguonDaChuanBi,
  actorId: string | null,
): Promise<void> {
  if (!chuanBi.bat) return;
  await taoNguonBanDau(tx, leadId, chuanBi.duLieu, actorId);
  for (const tp of chuanBi.touchpoints) await ghiTouchpoint(tx, leadId, tp, actorId);
}

/** BƯỚC 2 (cả lô) — số câu GHI cố định (`createMany`): một cho quy nguồn, một cho touchpoint. */
export async function ghiQuyNguonTheoLo(
  tx: Tx,
  ds: readonly { leadId: string; chuanBi: NguonDaChuanBi }[],
  actorId: string | null,
): Promise<void> {
  const bat = ds.filter((d): d is { leadId: string; chuanBi: Extract<NguonDaChuanBi, { bat: true }> } => d.chuanBi.bat);
  if (bat.length === 0) return;
  await taoNguonTheoLo(
    tx,
    bat.map((d) => ({ leadId: d.leadId, d: d.chuanBi.duLieu })),
  );
  await ghiTouchpointTheoLo(
    tx,
    bat.flatMap((d) => d.chuanBi.touchpoints.map((tp) => ({ leadId: d.leadId, tp }))),
    actorId,
  );
}

// ── Tín hiệu ĐẾN SAU trên lead ĐÃ CÓ ─────────────────────────────────────────────────────────────────────

export type TinHieuDenSau = {
  /** `THEM_CON`: phụ huynh CŨ gửi phiếu cho con KHÁC (không tạo lead — gắn thêm LeadChild); `NHAP_LAI`: phiếu lại không có con mới. */
  kind: "NHAP_LAI" | "THEM_CON" | "NHAP_EXCEL";
  conversionEntry: string | null;
  /** Nhãn nguồn người nhập/file khai (nếu có) — CHỈ ghi lại, không đổi nguồn. */
  nhanKhai: string | null;
  ref: string | null;
  quangCao: QuangCaoTin;
  utm: UtmTin;
  pageId: string | null;
  /** Người giới thiệu ĐẾN SAU (picker) — chỉ GHI LẠI, không đổi nguồn gốc (D3). Chỉ id, không PII. */
  nguoiGioiThieu: { employeeId: string | null; parentUserId: string | null; studentId: string | null } | null;
  /**
   * `LeadSourceGroup.id` người nhập bấm ở ô chọn nguồn (PR7) — chỉ GHI LẠI trong `signals` của touchpoint, không đổi nguồn gốc (D3).
   * TUỲ CHỌN: vắng = đường không có ô chọn.
   */
  nhomChonId?: string | null;
};

const coGiaTri = (v: string | null | undefined): v is string => v != null && v.trim() !== "";
const khongNull = (o: Record<string, string | null | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => coGiaTri(v))) as Record<string, string>;

/** Touchpoint dựng từ tín hiệu đến sau (THUẦN, test được). `ref` ⇒ thêm một `REF_SAU` riêng. */
export function dungTouchpointDenSau(t: TinHieuDenSau): TouchpointMoi[] {
  const signals: Record<string, unknown> = {};
  if (coGiaTri(t.nhanKhai)) signals.nhanGoc = t.nhanKhai.trim();
  const qc = khongNull({ ...t.quangCao });
  if (Object.keys(qc).length > 0) signals.quangCao = qc;
  const utm = khongNull({ ...t.utm });
  if (Object.keys(utm).length > 0) signals.utm = utm;
  if (coGiaTri(t.pageId)) signals.pageId = t.pageId;
  // Id THÔ người nhập bấm — KHÔNG đưa vào `claimedGroupId` (FK Restrict): trên đường lead-cũ không ai kiểm id này tồn tại, và một id
  // lạ làm cả touchpoint không ghi được. Nhóm thật sự đã quyết ở lead gốc; đây chỉ là vết "người nhập khai nhóm nào".
  if (coGiaTri(t.nhomChonId ?? null)) signals.nhomChonId = t.nhomChonId;
  if (t.nguoiGioiThieu) signals.nguoiGioiThieu = khongNull({ ...t.nguoiGioiThieu });

  const ra: TouchpointMoi[] = [
    { kind: t.kind, conversionEntry: t.conversionEntry, claimedGroupId: null, signals: signals as Prisma.InputJsonObject },
  ];
  const ma = normalizeAffiliateCode(t.ref);
  if (coGiaTri(t.ref)) {
    ra.push({
      kind: "REF_SAU",
      conversionEntry: t.conversionEntry,
      claimedGroupId: null,
      signals: { ref: ma ?? t.ref.trim() },
    });
  }
  return ra;
}

/**
 * Ghi tín hiệu đến sau lên lead CŨ (nhánh trùng SĐT). `bat` BẮT BUỘC (luật 7): đường gọi đọc `laQuanLyNguonBat()` rồi
 * truyền vào — cờ TẮT ⇒ 0 bản ghi mới. KHÔNG BAO GIỜ đổi attribution (ref đến sau KHÔNG chiếm nguồn, D3).
 */
export async function ghiTinHieuDenSau(
  tx: Tx,
  leadId: string,
  t: TinHieuDenSau,
  actorId: string | null,
  bat: boolean,
): Promise<number> {
  if (!bat) return 0;
  const tps = dungTouchpointDenSau(t);
  for (const tp of tps) await ghiTouchpoint(tx, leadId, tp, actorId);
  return tps.length;
}

/**
 * Nhánh TRÙNG SĐT với lead CÒN SỐNG, dành cho đường gọi KHÔNG có transaction sẵn (`ingestIntakeLead`, `/api/leads`):
 * đọc cờ master, mở MỘT transaction, ghi touchpoint. Cờ TẮT ⇒ không mở transaction, không ghi gì. NUỐT lỗi có log —
 * ghi dấu vết nguồn không được làm hỏng lượt gộp phiếu (T4). `nhan` chỉ để log biết đường nào.
 */
export async function ghiNguonDenSauChoLeadCu(
  dbClient: DbKhongScope,
  leadId: string,
  t: TinHieuDenSau,
  actorId: string | null,
  nhan: string,
): Promise<void> {
  try {
    const bat = await laQuanLyNguonBat();
    if (!bat) return;
    await dbClient.$transaction(async (tx) => {
      await ghiTinHieuDenSau(tx, leadId, t, actorId, bat);
    });
  } catch (err) {
    console.error(`[nguon:${nhan}] ghi tín hiệu nguồn đến sau: ${moTaLoiAnToan(err)}`);
  }
}

/** Như `ghiTinHieuDenSau` cho nhiều lead (đường Excel) — một câu `createMany`. */
export async function ghiTinHieuDenSauTheoLo(
  tx: Tx,
  ds: readonly { leadId: string; t: TinHieuDenSau }[],
  actorId: string | null,
  bat: boolean,
): Promise<number> {
  if (!bat || ds.length === 0) return 0;
  return ghiTouchpointTheoLo(
    tx,
    ds.flatMap(({ leadId, t }) => dungTouchpointDenSau(t).map((tp) => ({ leadId, tp }))),
    actorId,
  );
}
