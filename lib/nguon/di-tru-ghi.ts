/**
 * lib/nguon/di-tru-ghi.ts — LỆNH GHI backfill quy nguồn cho lead cũ (hướng E, 11/10/2026). Điều phối: cổng số duyệt → chia lô → audit mức lượt chạy.
 * PHÉP GHI nằm ở `ghi-nguon.ts` (`taoNguonDiTruTheoLo`, lưới `[QN-W11]`); tệp này không gọi bảng nguồn trực tiếp.
 *
 * ⚠️ KHÔNG nằm trong đồ thị import của script CHỈ-ĐỌC (`scripts/nguon/di-tru-nguon-cu.ts`, lưới `[QN-DT-01]`): nó kéo `ghi-nguon.ts` + `writeAudit`. Báo cáo và lệnh ghi cùng dùng
 * `di-tru-ke-hoach.ts` (thuần) nên số in để duyệt và số ghi là MỘT phép tính.
 *
 * ── Thứ tự đúng luật rollback («từ chối = throw, mọi cổng đứng TRƯỚC phép ghi đầu tiên») ─────────────────────
 *  1. `kiemCongGhi` (INVALID · nhóm thiếu · tổng · review · digest) — thất bại ⇒ trả `{ ok: false }`, CHƯA ghi gì.
 *  2. Dựng dữ liệu ghi cho TOÀN BỘ kế hoạch (`dungDuLieuGhiDiTru`: validate hình dạng) TRƯỚC lô đầu.
 *  3. Chia lô ~200 lead; MỖI lô một transaction ngắn (trần mặc định 5 giây của Prisma KHÔNG đủ cho vòng ghi dài, nhưng một lô 200 dòng là 4–5 câu cố định — đủ).
 *  4. AuditLog BẮT ĐẦU (`DI_TRU_NGUON`) được ghi TRONG transaction của lô ĐẦU TIÊN THẬT SỰ GHI ĐƯỢC dòng (sau phép ghi, cùng transaction): không có chuyện đã ghi mà thiếu dấu vết kiểm toán,
 *     và một lượt chạy lại «ghi 0» không để lại audit giả. Số THỰC GHI chỉ biết sau vòng lô nên nằm ở bản ghi THỨ HAI (`DI_TRU_NGUON_KET_THUC`, giao dịch riêng, ghi khi lượt này đã có bản ghi bắt đầu —
 *     cả khi hoàn tất lẫn khi dừng giữa chừng). Nội dung hai bản ghi dựng ở `di-tru-audit.ts` (thuần): batDauLuc · cheDo APPLY · dryRun false · expectedCount · actualCount · nguonChay.
 *  Lô giữa chừng lỗi ⇒ các lô trước ĐÃ commit (idempotent: chạy lại sẽ bỏ qua dòng đã có, ghi tiếp phần còn thiếu — kế hoạch tính lại nên digest sẽ KHÁC ⇒ phải đo lại + duyệt lại).
 *  Trước lô đầu chỉ có các cổng TOÀN KẾ HOẠCH: số duyệt + nguồn chưa chủ (`kiemCongGhi`) và dựng dữ liệu ghi (hình dạng). Còn khoá ngoại (nhân viên chủ nguồn / người giới thiệu bị xoá giữa lúc lập kế hoạch và lúc ghi)
 *  và `kiemDuLieu` chạy THEO LÔ — chúng KHÔNG thể kiểm trước cho cả kế hoạch mà không đọc lại toàn bộ DB một lần nữa. Lỗi đó nổi lên thành `DiTruDungGiuaChungError` mang số lô ĐÃ commit; đây là giới hạn đã biết, không đổi kiến trúc lô.
 *
 * ── Tiền ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Ghi `LeadAttribution` mới làm `updatedAt` của nó = bây giờ; `quet-ky.ts`/`ky-service.ts` coi `updatedAt` của nguồn là đầu vào của kỳ hoa hồng (chân thứ bảy / `INPUT_DRIFT`). Nên lệnh ghi
 * TỪ CHỐI chạy khi `hoaHong.engineBat` đang BẬT, trừ khi người chạy khai tường minh `--cho-phep-engine-bat` (đã duyệt hệ quả). Thứ tự an toàn của runbook: backfill XONG trước khi bật engine.
 */
import type { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { HANH_DONG_DI_TRU_BAT_DAU, HANH_DONG_DI_TRU_KET_THUC, dungKetThucDiTru, dungLuotChayDiTru, saoNguonChay, type LuotChayDiTru, type TrangThaiKetThucDiTru } from "./di-tru-audit";
import { dungDuLieuGhiDiTru } from "./di-tru-du-lieu";
import { kiemCongGhi, type KeHoachDiTru, type KetQuaCongGhi, type NhomDiTru, type SoDuyet } from "./di-tru-ke-hoach";
import type { NguonChayDiTru } from "./di-tru-nguon-chay";
import { taoNguonDiTruTheoLo } from "./ghi-nguon";
import { chupNguon } from "./nguon-chup";
import { moTaLoiAnToan } from "./noi-day";

type Db = typeof db;

export const KICH_THUOC_LO_DI_TRU = 200;

/**
 * Trần thời gian của MỘT transaction ghi một lô. Mặc định của Prisma là 5 giây — đo 12/10/2026 trên DB test qua SSH tunnel: lô 200 lead (createManyAndReturn + touchpoint + audit)
 * vượt 5 giây ⇒ P2028 ⇒ 0/2 lô commit. Cùng giá trị với transaction ĐỌC kế hoạch ở `scripts/nguon/di-tru-nguon-cu-ghi.ts`. Nâng trần KHÔNG đổi ngữ nghĩa: vẫn một transaction mỗi lô, lỗi thì lô lùi nguyên vẹn.
 */
export const TRAN_THOI_GIAN_MOT_LO_DI_TRU = { timeout: 120_000, maxWait: 15_000 } as const;

export type KetQuaGhiDiTru =
  | { ok: false; cong: Extract<KetQuaCongGhi, { ok: false }> }
  | { ok: true; ghi: number; daCo: number; daXoa: number; soLo: number };

// Kiểu «ai bấm» nằm ở tệp thuần riêng (cùng hàm dựng từ env) — re-export để nơi gọi cũ vẫn import từ đây. BẮT BUỘC khai ở `thucHienDiTru` (luật 7).
export type { NguonChayDiTru };

/** Tiến độ tại lúc lỗi: các lô trước ĐÃ commit (mỗi lô một transaction), lô đang chạy đã lùi nguyên vẹn. */
export type TienDoDiTru = { soLoKeHoach: number; soLoDaCommit: number; ghi: number; daCo: number; daXoa: number };

/**
 * Một lô lỗi GIỮA CHỪNG (FK nhân viên bị xoá giữa lúc lập kế hoạch và lúc ghi · mất kết nối · timeout): các lô trước ĐÃ commit — đó là thiết kế (một transaction cho cả hàng chục nghìn dòng vượt trần 5 giây).
 * Lỗi mang `tienDo` để người chạy BIẾT đã ghi được bao nhiêu, thay vì chỉ thấy một dòng lỗi Prisma. Chạy lại an toàn (`skipDuplicates` bỏ qua dòng đã có), nhưng kế hoạch tính lại nên digest KHÁC ⇒ chạy thử lại và duyệt lại.
 * `nguyenNhan` đã che SĐT/email (`moTaLoiAnToan`).
 */
export class DiTruDungGiuaChungError extends Error {
  constructor(
    readonly tienDo: TienDoDiTru,
    readonly nguyenNhan: string,
  ) {
    super(
      `Dừng ở lô ${tienDo.soLoDaCommit + 1}/${tienDo.soLoKeHoach}: ĐÃ commit ${tienDo.soLoDaCommit} lô trước đó (ghi ${tienDo.ghi} dòng · đã có ${tienDo.daCo} · đã xoá ${tienDo.daXoa}); lô đang chạy đã lùi. Nguyên nhân: ${nguyenNhan}`,
    );
    this.name = "DiTruDungGiuaChungError";
  }
}

export async function thucHienDiTru(p: {
  db: Db;
  kh: KeHoachDiTru;
  nhom: readonly NhomDiTru[];
  /** Setting chung lúc ghi — BẮT BUỘC số (digest đã tính với đúng số này). */
  cuaSoMacDinhNgay: number;
  duyet: SoDuyet & { den: Date };
  actor: AuditActor;
  /** Cỡ lô; BẮT BUỘC (luật 7). Production truyền `KICH_THUOC_LO_DI_TRU`; test truyền số nhỏ để có nhiều lô. */
  kichThuocLo: number;
  /** Ai kích hoạt (GitHub actor + run id) — vào audit; BẮT BUỘC khai, `null` từng trường khi không chạy trong Actions. */
  nguonChay: NguonChayDiTru;
  /** Lúc lượt chạy BẮT ĐẦU — vào audit. BẮT BUỘC khai (luật 7): lõi không đọc đồng hồ, nơi gọi (script) truyền vào. */
  batDauLuc: Date;
}): Promise<KetQuaGhiDiTru> {
  const { kh } = p;
  if (kh.cuaSoMacDinhNgay !== p.cuaSoMacDinhNgay) {
    throw new Error("thucHienDiTru: kế hoạch dựng với cửa sổ mặc định khác số đang ghi — dựng lại kế hoạch với cùng số.");
  }
  if (!Number.isInteger(p.kichThuocLo) || p.kichThuocLo < 1) throw new Error("thucHienDiTru: kichThuocLo phải là số nguyên ≥ 1.");
  // Dấu vết lượt chạy dựng TRƯỚC mọi phép ghi: mốc rác ⇒ ném ở đây, chưa ghi gì.
  const luot = dungLuotChayDiTru({ batDauLuc: p.batDauLuc, soDuyet: p.duyet.soDuyet, soDuyetReview: p.duyet.soDuyetReview, nguonChay: p.nguonChay });

  // 1. Cổng — TRƯỚC mọi phép ghi.
  const cong = kiemCongGhi(kh, p.duyet);
  if (!cong.ok) return { ok: false, cong };

  // 2. Dựng dữ liệu cho TOÀN BỘ kế hoạch trước lô đầu (hình dạng sai ⇒ ném ở đây, chưa ghi gì).
  const nhomTheoMa = new Map(p.nhom.map((g) => [g.code, g]));
  const ds = kh.dong.map((d) => {
    const g = nhomTheoMa.get(d.groupCode);
    if (!g) throw new Error(`thucHienDiTru: nhóm ${d.groupCode} không có trong danh mục (kiemCongGhi lẽ ra đã chặn).`);
    const nguon = chupNguon({ cuaSoRiengNgay: g.attributionWindowDays, cuaSoMacDinhNgay: p.cuaSoMacDinhNgay, chuNhanVienId: g.ownerEmployeeId });
    const w = dungDuLieuGhiDiTru(d, nguon);
    return { leadId: d.leadId, d: w.duLieu, tp: w.touchpoint };
  });

  // Không có gì để ghi (chạy lại sau khi đã ghi xong): KHÔNG ghi gì kể cả audit — «chạy lại ghi 0» là 0 phép ghi thật.
  if (ds.length === 0) return { ok: true, ghi: 0, daCo: 0, daXoa: 0, soLo: 0 };

  // 3-4. Lô; audit nằm trong lô ĐẦU.
  let ghi = 0;
  let daCo = 0;
  let daXoa = 0;
  let soLo = 0;
  const runId = `ke-hoach:${kh.sha.slice(0, 16)}`;
  let daAudit = false;
  const soLoKeHoach = Math.ceil(ds.length / p.kichThuocLo);
  for (let i = 0; i < ds.length; i += p.kichThuocLo) {
    const lo = ds.slice(i, i + p.kichThuocLo);
    let r: Awaited<ReturnType<typeof taoNguonDiTruTheoLo>>;
    try {
      r = await p.db.$transaction(async (tx) => {
        const kq = await taoNguonDiTruTheoLo(tx, lo);
        if (!daAudit && kq.ghi > 0) {
          await writeAudit({
            tx,
            actor: p.actor,
            module: "nguon-hoa-hong",
            entityType: "NguonDiTru",
            entityId: runId,
            action: HANH_DONG_DI_TRU_BAT_DAU,
            oldValues: null,
            newValues: {
              soDuyet: p.duyet.soDuyet,
              soDuyetReview: p.duyet.soDuyetReview,
              sha: kh.sha,
              den: p.duyet.den.toISOString(),
              cuaSoMacDinhNgay: p.cuaSoMacDinhNgay,
              tong: kh.tong,
              theoNhom: kh.theoNhom.map((g) => ({ code: g.code, soLead: g.soLead, chuNhanVienId: g.chuNhanVienId, cuaSoRiengNgay: g.cuaSoRiengNgay })),
              nhomChuNull: kh.nhomChuNull.map((g) => g.code),
              // Danh sách nguồn «chưa có chủ lúc ghi» mà người chạy ĐÃ CHẤP NHẬN bằng tay (cổng `NGUON_CHUA_CO_CHU` buộc nó khớp `nhomChuNull`) — bằng chứng kiểm toán của sự chấp nhận.
              chapNhanNguonChuaCoChu: [...new Set(p.duyet.chapNhanNguonChuaCoChu)].sort(),
              // Ai bấm: người dispatch lần đầu + người bấm lượt NÀY (khác nhau khi Re-run) + id lượt chạy + lần chạy thứ mấy (truy được trong Actions). Không phải «người duyệt thứ hai» — chuỗi xác nhận và các số do CÙNG một người tự khai (giới hạn đã biết, 08 §11).
              nguonChay: saoNguonChay(p.nguonChay),
              // §20: lượt chạy NÀY bắt đầu lúc nào · APPLY (dry-run không bao giờ ghi DB) · số kỳ vọng (--expect). Số THỰC GHI ở bản ghi kết thúc.
              luotChay: luot,
            },
            changedFields: ["soDuyet", "soDuyetReview", "sha", "den"],
            reason: "Backfill quy nguồn cho lead cũ chưa có LeadAttribution (di trú nhãn cũ → nguồn mới)",
          });
        }
        return kq;
      }, TRAN_THOI_GIAN_MOT_LO_DI_TRU);
    } catch (e) {
      // Các lô trước ĐÃ commit, lô này đã lùi: nói THẬT đã ghi bao nhiêu (kể cả khi lỗi ở lô đầu: 0 lô).
      const nguyenNhan = moTaLoiAnToan(e);
      // Có bản ghi BẮT ĐẦU rồi (lô trước commit) ⇒ để bản ghi KẾT THÚC «dừng giữa chừng». Best-effort: lỗi ghi audit KHÔNG được che lỗi gốc.
      if (daAudit) await ghiKetThuc(p.db, p, runId, luot, { trangThai: "DUNG_GIUA_CHUNG", ghi, daCo, daXoa, soLo, soLoKeHoach, nguyenNhan }).catch(() => undefined);
      throw new DiTruDungGiuaChungError({ soLoKeHoach, soLoDaCommit: soLo, ghi, daCo, daXoa }, nguyenNhan);
    }
    if (r.ghi > 0) daAudit = true; // đặt SAU khi transaction commit: nếu nó lùi thì lô sau vẫn phải mang audit
    ghi += r.ghi;
    daCo += r.daCo;
    daXoa += r.daXoa;
    soLo += 1;
  }
  // Vòng lô xong: bản ghi KẾT THÚC (số THỰC GHI) — chỉ khi lượt này đã có bản ghi bắt đầu (`daAudit`), tức là ĐÃ GHI ≥ 1 dòng. Lỗi ở đây nổi lên: dữ liệu đã commit, thiếu dấu vết kết thúc là việc phải biết.
  if (daAudit) await ghiKetThuc(p.db, p, runId, luot, { trangThai: "HOAN_TAT", ghi, daCo, daXoa, soLo, soLoKeHoach, nguyenNhan: null });
  return { ok: true, ghi, daCo, daXoa, soLo };
}

/** Bản ghi KẾT THÚC của lượt chạy — giao dịch riêng (sau vòng lô). Nội dung dựng ở `di-tru-audit.ts`. */
async function ghiKetThuc(
  d: Db,
  p: { actor: AuditActor; nguonChay: NguonChayDiTru },
  runId: string,
  luot: LuotChayDiTru,
  kq: { trangThai: TrangThaiKetThucDiTru; ghi: number; daCo: number; daXoa: number; soLo: number; soLoKeHoach: number; nguyenNhan: string | null },
): Promise<void> {
  await d.$transaction(async (tx) => {
    await writeAudit({
      tx,
      actor: p.actor,
      module: "nguon-hoa-hong",
      entityType: "NguonDiTru",
      entityId: runId,
      action: HANH_DONG_DI_TRU_KET_THUC,
      oldValues: null,
      newValues: dungKetThucDiTru({ luot, nguonChay: p.nguonChay, ...kq }),
      changedFields: ["trangThai", "actualCount"],
      reason: kq.trangThai === "HOAN_TAT" ? "Kết thúc lượt backfill quy nguồn: số thực ghi" : "Lượt backfill quy nguồn DỪNG GIỮA CHỪNG: số đã ghi tới lúc dừng",
    });
  });
}
