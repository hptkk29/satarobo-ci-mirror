/**
 * lib/nguon/chup-lai-chu-nguon.ts — «CHỤP LẠI CHỦ NGUỒN» cho các lead ĐÃ ghi nhận (W3 · gt2 R1-H1, 10/10/2026). Luật chọn lead ở `chup-lai-chu-nguon-luat.ts`; mảnh SQL ở
 * `chup-lai-chu-nguon-sql.ts`; phép GHI duy nhất ở `ghi-nguon.ts` (`ghiChuNguonChupLo`). Tệp này điều phối MỘT LÔ.
 *
 * ── Vì sao theo lô, có con trỏ ─────────────────────────────────────────────────────────────────────────────
 * Nguồn quảng cáo có hàng nghìn lead. Một transaction chụp lại tất cả sẽ giữ khoá nguồn quá trần 5 giây của Prisma (`P2028`) và chặn mọi người sửa nguồn trong lúc đó. Nên MỖI LÔ là một
 * transaction ngắn (≤ `CO_LO_TOI_DA` dòng), người gọi lặp theo `conTro` cho tới `hetLead`. Idempotent hai tầng: dòng đã chụp lại không còn nằm trong diện (chủ đã chụp = chủ hiện tại), và con trỏ
 * chỉ để không quét lại phần đã qua.
 *
 * ── Trong MỖI lô (thứ tự không đảo được) ──────────────────────────────────────────────────────────────────
 *  1. cổng KHÔNG cần DB: lý do ≥ 10 ký tự, cỡ lô hợp lệ;
 *  2. `pg_advisory_xact_lock` theo nguồn — hai người bấm cùng lúc xếp hàng thay vì giẫm nhau;
 *  3. khoá hàng nguồn `FOR SHARE` (chặn `suaNguon` đổi chủ giữa chừng — nó khoá `FOR UPDATE`), đọc LẠI chủ hiện tại;
 *  4. chủ hiện tại phải KHỚP `chuDuKien` (người bấm đã THẤY chủ nào trong hộp thoại) — lệch ⇒ `throw`, KHÔNG BAO GIỜ trộn hai chủ trong một lượt chụp lại;
 *  5. chủ hiện tại phải còn làm việc và có tài khoản (`kiemChuHienTai`), nếu không chụp xong vẫn treo;
 *  6. chọn lô `FOR UPDATE` theo con trỏ → ghi MỘT câu lệnh → `writeAudit` CÙNG transaction (chỉ khi thật sự ghi ≥ 1 dòng: chạy lại không để lại dấu giả).
 * Từ chối trong transaction là `throw` (luật rollback). Không phát DomainEvent `nguon.da-doi-sau-thanh-toan`: đây không phải đổi nguồn của lead, và tự điều chỉnh sổ là đường SAI —
 * kỳ đã tính thấy `INPUT_DRIFT` (nhờ `updatedAt` nhích) và người duyệt quyết áp dụng hay giữ nguyên.
 *
 * Quyền do NƠI GỌI kiểm (`sources:manage` ∧ `commission_policies:activate`, Server Action). Danh mục nguồn là dữ liệu CHUNG nên không có phạm vi cơ sở.
 */
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { docChuHienTai, docNhomCanChup } from "./chup-lai-chu-nguon-doc";
import { CO_LO_TOI_DA, HAU_QUA_CHUP_LAI, khoaChupLaiTheoNguon, kiemChuHienTai, kiemLyDoChupLai, type LyDoChupLai } from "./chup-lai-chu-nguon-luat";
import { BAN_CHUP_HOP_LE, dieuKienTheoChu } from "./chup-lai-chu-nguon-sql";
import { docNguonChup } from "./nguon-chup";
import { ghiChuNguonChupLo } from "./ghi-nguon";

export type NguoiChupLai = { userId: string; ten: string };

export type OLoiChupLai = "lyDo" | "khongTimThay" | "chuDoi" | "chuKhongHopLe" | "coLo" | "chung";

export class LoiChupLai extends Error {
  constructor(
    readonly truong: OLoiChupLai,
    message: string,
  ) {
    super(message);
    this.name = "LoiChupLai";
  }
}

export type KetQuaChupLaiLo =
  | {
      ok: true;
      /** Số dòng ĐÃ ghi trong lô này. */
      daChup: number;
      /** Số dòng của lô thuộc diện chụp lại nhưng không ghi (bản chụp hỏng · vừa bị người khác đổi). */
      boQua: number;
      /** Truyền lại ở lượt sau. `null` khi không còn gì để quét. */
      conTro: string | null;
      hetLead: boolean;
      /** Số dòng đã chụp lại theo lý do (chỉ lô này). */
      theoLyDo: Record<LyDoChupLai, number>;
    }
  | { ok: false; loi: string; truong: OLoiChupLai };

const KHONG_CO: Record<LyDoChupLai, number> = { THIEU_CHU: 0, CHU_NGHI_VIEC: 0, CHU_KHONG_CON_HO_SO: 0 };

export async function chupLaiChuNguonMotLo(p: {
  nguoi: NguoiChupLai;
  nguonId: string;
  /** `Employee.id` chủ nguồn mà người bấm đã thấy trong hộp thoại. BẮT BUỘC (luật 7). */
  chuDuKien: string;
  lyDo: string | null;
  /** `id` dòng cuối của lô trước; `null` = lô đầu. BẮT BUỘC: quên truyền = quét lại từ đầu mãi. */
  conTro: string | null;
  coLo: number;
  /** Đồng hồ — BẮT BUỘC (luật 19): thành `updatedAt` của dòng được ghi. */
  now: Date;
}): Promise<KetQuaChupLaiLo> {
  const loiLyDo = kiemLyDoChupLai(p.lyDo);
  if (loiLyDo) return { ok: false, loi: loiLyDo, truong: "lyDo" };
  if (!Number.isInteger(p.coLo) || p.coLo < 1 || p.coLo > CO_LO_TOI_DA) {
    return { ok: false, loi: `Cỡ lô phải từ 1 đến ${CO_LO_TOI_DA}.`, truong: "coLo" };
  }
  const lyDo = (p.lyDo ?? "").trim();
  try {
    return await db.$transaction(async (tx): Promise<KetQuaChupLaiLo> => {
      // 2. Xếp hàng theo nguồn. Khoá advisory theo giao dịch ⇒ tự nhả khi commit/rollback.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${khoaChupLaiTheoNguon(p.nguonId)}, 0))`;
      // 3. Khoá hàng nguồn rồi đọc LẠI chủ (không tin bản đọc trước giao dịch).
      await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "id" = ${p.nguonId} FOR SHARE`;
      const { tonTai, chu } = await docChuHienTai(tx, p.nguonId);
      if (!tonTai) throw new LoiChupLai("khongTimThay", "Không tìm thấy nguồn này.");
      // 4. Chủ phải đúng cái người bấm đã thấy.
      if (chu !== null && chu.employeeId !== p.chuDuKien) {
        throw new LoiChupLai("chuDoi", "Người phụ trách nguồn vừa được đổi — tải lại trang rồi chụp lại, để chọn đúng người.");
      }
      // 5. Chủ phải chi tiền được (chưa khai · đã nghỉ · chưa có tài khoản đều dừng ở đây).
      const loiChu = kiemChuHienTai(chu ? { status: chu.status, coTaiKhoan: chu.coTaiKhoan } : null);
      if (loiChu || !chu) throw new LoiChupLai("chuKhongHopLe", loiChu ?? "Nguồn chưa khai người phụ trách.");

      // 6. Diện cần chụp lại (theo con trỏ) → chọn lô → ghi → audit.
      const nhom = await docNhomCanChup(tx, { nguonId: p.nguonId, chuHienTai: chu.employeeId, sauId: p.conTro });
      if (nhom.length === 0) return { ok: true, daChup: 0, boQua: 0, conTro: null, hetLead: true, theoLyDo: { ...KHONG_CO } };
      const thieuChu = nhom.some((n) => n.chu === null);
      const chuKhongConHieuLuc = nhom.flatMap((n) => (n.chu === null ? [] : [n.chu]));
      const lyDoCua = new Map(nhom.map((n) => [n.chu, n.lyDo]));

      const sau = p.conTro === null ? Prisma.sql`true` : Prisma.sql`"id" > ${p.conTro}`;
      const lo = await tx.$queryRaw<{ id: string; leadId: string; nguon: unknown }[]>(Prisma.sql`
        SELECT "id", "leadId", ("signals"->'nguon') AS "nguon" FROM "LeadAttribution"
        WHERE "groupId" = ${p.nguonId} AND ${sau} AND ${BAN_CHUP_HOP_LE}
          AND ${dieuKienTheoChu({ thieuChu, chuKhongConHieuLuc, chuHienTai: chu.employeeId })}
        ORDER BY "id"
        LIMIT ${p.coLo}
        FOR UPDATE`);
      const conTro = lo.length > 0 ? lo[lo.length - 1]!.id : p.conTro;
      const hetLead = lo.length < p.coLo;
      // Phòng thủ: SQL đã lọc theo hình dạng; Zod là thước CHÍNH — dòng mà Zod không nhận thì không ghi.
      const duocGhi = lo.filter((d) => docNguonChup({ nguon: d.nguon }).trangThai === "HOP_LE");

      const ids = await ghiChuNguonChupLo(tx, { nguonId: p.nguonId, ids: duocGhi.map((d) => d.id), chuMoi: chu.employeeId, thieuChu, chuKhongConHieuLuc, now: p.now });
      const theoLyDo = { ...KHONG_CO };
      const chuCuDem = new Map<string, number>();
      // Chủ cũ THEO TỪNG LEAD (≤ cỡ lô mục): để đối soát / hoàn tác theo lead được — đếm gộp theo chủ cũ không trả lời «lead nào từng thuộc ai».
      const chuCuTheoLead: Record<string, string | null> = {};
      const daGhi = new Set(ids);
      for (const d of duocGhi) {
        if (!daGhi.has(d.id)) continue;
        const chuCu = chuCuTuNguon(d.nguon);
        const ly = lyDoCua.get(chuCu);
        if (ly) theoLyDo[ly] += 1;
        const khoa = chuCu ?? "(chưa có chủ)";
        chuCuDem.set(khoa, (chuCuDem.get(khoa) ?? 0) + 1);
        chuCuTheoLead[d.leadId] = chuCu;
      }

      if (ids.length > 0) {
        await writeAudit({
          tx,
          actor: { id: p.nguoi.userId, name: p.nguoi.ten },
          module: "nguon-hoa-hong",
          entityType: "LeadSourceGroup",
          entityId: p.nguonId,
          action: "NGUON_CHUP_LAI_CHU",
          oldValues: { chuDaChup: Object.fromEntries(chuCuDem), chuCuTheoLead },
          newValues: { chuNhanVienId: chu.employeeId, soLead: ids.length, theoLyDo, conTro, leadAttributionIds: ids, hauQua: HAU_QUA_CHUP_LAI },
          changedFields: ["signals.nguon.chuNhanVienId"],
          reason: lyDo,
        });
      }
      return { ok: true, daChup: ids.length, boQua: lo.length - ids.length, conTro, hetLead, theoLyDo };
    });
  } catch (e) {
    if (e instanceof LoiChupLai) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}

const laDoiTuong = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Chủ đã chụp của một dòng (chỉ gọi cho dòng đã qua `docNguonChup` HOP_LE). */
function chuCuTuNguon(nguon: unknown): string | null {
  return laDoiTuong(nguon) && typeof nguon.chuNhanVienId === "string" ? nguon.chuNhanVienId : null;
}
