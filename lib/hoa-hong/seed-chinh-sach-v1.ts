// lib/hoa-hong/seed-chinh-sach-v1.ts — GHI kế hoạch seed chính sách v1 (SR.QD.208) vào DB. Idempotent.
//
// Phần THUẦN (kế hoạch) ở `ke-hoach-seed-v1.ts`; script chạy tay `scripts/hoa-hong/seed-chinh-sach-v1.ts` bọc hàm này
// (DRY-RUN mặc định, `--apply` mới ghi). Seed KHÔNG nằm trong migration (02 §12.1): nó cần văn bản + người kích hoạt.
//
// Idempotent theo MÃ: văn bản theo `documentCode`, chính sách theo `policyCode`. Chạy lại ⇒ không tạo thêm gì, không
// sửa gì đã có (kể cả khi người dùng đã sửa nháp) — chỉ báo "đã có". Muốn đổi seed ⇒ tạo version mới, không chạy đè.
//
// KÍCH HOẠT HV_MOI chỉ khi đủ: có tệp văn bản (`tep`), `kichHoat = true`, và guardrail cho qua (người phụ trách QC/QL_TT
// ở mọi cơ sở, hiệu lực ≥ công bố + 15 ngày làm việc…). Không đủ ⇒ để DRAFT và NÓI RÕ vì sao — không nới guardrail.
import { db } from "@/lib/db";

import type { PhamViInput } from "./chinh-sach-dau-vao";
import { HoaHongError } from "./kieu";
import { HIEU_LUC_MAC_DINH_SR208, lapKeHoachSeedV1, type KeHoachSeedV1 } from "./ke-hoach-seed-v1";
import { kichHoat, taoChinhSach, taoVanBan, type NguoiThaoTac } from "./chinh-sach-service";

export type TepVanBan = { fileKey: string | null; fileName: string | null; fileUrl: string | null };

/** Ngày 01 của THÁNG SAU `now` (UTC) — hiệu lực mặc định của nháp chưa có văn bản; admin chỉnh theo văn bản trước khi kích hoạt. Không bao giờ là ngày quá khứ. */
function dauThangSau(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type KetQuaSeedV1 = {
  vanBan: { id: string | null; trangThai: "TAO_MOI" | "DA_CO" | "SE_TAO" };
  chinhSach: {
    policyCode: string;
    /** `THIEU_NGUON` = chính sách theo nguồn mà nguồn (mã) chưa có trong danh mục — KHÔNG tạo, nói rõ vì sao. */
    trangThai: "TAO_MOI" | "DA_CO" | "SE_TAO" | "THIEU_NGUON";
    kichHoat: "DA_KICH_HOAT" | "DRAFT" | "KHONG_DUOC_KICH_HOAT" | "SE_KICH_HOAT" | "BO_QUA";
    ghiChu: string | null;
  }[];
  khongChuyen: KeHoachSeedV1["khongChuyen"];
};

export async function gieoChinhSachV1(input: {
  /** `false` = DRY-RUN: chỉ trả kế hoạch + trạng thái hiện có, không ghi gì. */
  apply: boolean;
  kichHoat: boolean;
  tep: TepVanBan;
  approvedByName: string;
  hieuLuc: Date | null;
  /**
   * Lý do xác nhận cảnh báo của guardrail (vd UNKNOWN tăng) do NGƯỜI CHẠY gõ; `null` = chưa xác nhận ⇒ có cảnh báo thì HV_MOI nằm
   * DRAFT và ghi chú nêu cảnh báo. BẮT BUỘC khai (luật 7) — seed không được tự nghĩ ra lý do thay người chạy.
   */
  xacNhanCanhBao: string | null;
  actor: NguoiThaoTac;
  now: Date;
}): Promise<KetQuaSeedV1> {
  const kh = lapKeHoachSeedV1();
  const hieuLuc = input.hieuLuc ?? HIEU_LUC_MAC_DINH_SR208;

  // ── Văn bản ──
  const vbCo = await db.regulationDocument.findUnique({ where: { documentCode: kh.vanBan.documentCode }, select: { id: true } });
  let vanBanId = vbCo?.id ?? null;
  let vanBanTt: KetQuaSeedV1["vanBan"]["trangThai"] = vbCo ? "DA_CO" : "SE_TAO";
  if (!vbCo && input.apply) {
    if (!input.approvedByName.trim()) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Thiếu người duyệt văn bản (--nguoi-duyet).");
    vanBanId = (
      await taoVanBan({
        ...kh.vanBan,
        kind: "COMMISSION_POLICY",
        approvedByName: input.approvedByName,
        approvedById: null,
        ...input.tep,
        ownerOrgUnitId: null,
        actor: input.actor,
        now: input.now,
      })
    ).id;
    vanBanTt = "TAO_MOI";
  }

  // ── Chính sách ──
  const ketQua: KetQuaSeedV1["chinhSach"] = [];
  for (const m of kh.chinhSach) {
    const co = await db.commissionPolicy.findUnique({ where: { policyCode: m.policyCode }, select: { id: true } });
    if (co) {
      ketQua.push({ policyCode: m.policyCode, trangThai: "DA_CO", kichHoat: "BO_QUA", ghiChu: "đã có — không đụng" });
      continue;
    }
    // Chính sách theo nguồn: tra id nguồn theo MÃ (đọc, không ghi). Chưa có nguồn ⇒ báo, không đoán, không tạo.
    let phamVi: PhamViInput = { loai: "GLOBAL" };
    if (m.maNhom !== null) {
      const nhom = await db.leadSourceGroup.findUnique({ where: { code: m.maNhom }, select: { id: true } });
      if (!nhom) {
        ketQua.push({ policyCode: m.policyCode, trangThai: "THIEU_NGUON", kichHoat: "BO_QUA", ghiChu: `nguồn ${m.maNhom} chưa có trong danh mục — chưa tạo` });
        continue;
      }
      phamVi = { loai: "SOURCE_GROUP", sourceGroupId: nhom.id };
    }
    if (!input.apply) {
      ketQua.push({ policyCode: m.policyCode, trangThai: "SE_TAO", kichHoat: m.kichHoat && input.kichHoat ? "SE_KICH_HOAT" : "DRAFT", ghiChu: m.lyDoDraft });
      continue;
    }
    const r = await taoChinhSach({
      policyCode: m.policyCode,
      name: m.name,
      description: m.chuaCoVanBan
        ? `Chính sách mặc định theo nguồn ${m.maNhom} — NHÁP theo quyết định của chủ dự án 09/10/2026, chưa có văn bản ban hành.`
        : `Seed v1 từ chính sách cũ "${m.maCu}" (${kh.vanBan.documentCode}).`,
      ownerOrgUnitId: null,
      phamVi,
      // Nháp chưa có văn bản: hiệu lực KHÔNG kế thừa mốc SR.QD.208 (quá khứ) — một nháp EXCLUDE kích hoạt với hiệu lực lùi sẽ gỡ Marketing khỏi kỳ chưa khoá.
      effectiveFrom: m.chuaCoVanBan ? (input.hieuLuc ?? dauThangSau(input.now)) : hieuLuc,
      effectiveTo: null,
      reason: m.chuaCoVanBan ? `Seed nguồn động 09/10/2026 — theo nguồn ${m.maNhom} (nháp, chờ văn bản)` : `Seed v1 ${kh.vanBan.documentCode} — ${m.maCu}`,
      // Cố ý KHÔNG gắn SR.QD.208: quyết định 09/10 chưa có văn bản, guardrail đòi admin gắn văn bản + tệp trước khi kích hoạt (không lấy văn bản khác làm chỗ giữ).
      documentId: m.chuaCoVanBan ? null : vanBanId,
      rules: m.rules,
      actor: input.actor,
      now: input.now,
    });
    if (!m.kichHoat || !input.kichHoat) {
      ketQua.push({ policyCode: m.policyCode, trangThai: "TAO_MOI", kichHoat: "DRAFT", ghiChu: m.lyDoDraft ?? (input.kichHoat ? null : "chưa yêu cầu kích hoạt (--kich-hoat)") });
      continue;
    }
    try {
      const { canhBao } = await kichHoat({
        versionId: r.versionId,
        actor: input.actor,
        now: input.now,
        xacNhanCanhBao: input.xacNhanCanhBao === null ? null : { lyDo: input.xacNhanCanhBao },
      });
      ketQua.push({
        policyCode: m.policyCode,
        trangThai: "TAO_MOI",
        kichHoat: "DA_KICH_HOAT",
        ghiChu: canhBao.length > 0 ? `cảnh báo đã xác nhận: ${canhBao.map((c) => `${c.ma}: ${c.thongBao}`).join(" | ")}` : null,
      });
    } catch (e) {
      if (!(e instanceof HoaHongError) || e.ma !== "KICH_HOAT_BI_CHAN") throw e;
      const loi = (e.chiTiet as { ma: string; thongBao: string }[]).map((l) => `${l.ma}: ${l.thongBao}`).join(" | ");
      ketQua.push({ policyCode: m.policyCode, trangThai: "TAO_MOI", kichHoat: "KHONG_DUOC_KICH_HOAT", ghiChu: loi });
    }
  }

  return { vanBan: { id: vanBanId, trangThai: vanBanTt }, chinhSach: ketQua, khongChuyen: kh.khongChuyen };
}
