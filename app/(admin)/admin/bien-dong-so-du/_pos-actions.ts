"use server";

// IMPORT GIAO DỊCH THẺ SmartPOS lên `/admin/bien-dong-so-du` (docs/pos-the-smartpos.md).
//
// Màn đọc file ở CLIENT (`docFilePos`), rồi gửi lên theo lô ≤ 300 dòng:
//   1. `batDauNhapPosAction`   ⇒ tạo `PosImportBatch` (khai `soLoTong`) VÀ ghi lô 1 trong cùng
//      action, trả `batchId`. Lô 1 ném lỗi ⇒ xoá lượt vừa tạo: không bao giờ để lại lượt 0 dòng
//      (nợ 4, 30/09/2026 — bản cũ tạo lượt ở action riêng, mỗi lần thử lại thêm một lượt rỗng);
//   2. `nhapLoPosAction` × n   ⇒ lô 2..n (hoặc gửi lại lô bất kỳ khi THỬ LẠI), cùng `batchId`;
//      `soLoXong` đặt theo CHỈ SỐ lô — GĐ3 (06/10/2026): `nhapLoPos` nhận chỉ số lô và ghi số đếm +
//      `soLoXong` trong MỘT câu có điều kiện, nên lô gửi lại không đếm hai lần (bản trước action đặt
//      `soLoXong` ở câu riêng, còn số đếm vẫn cộng không điều kiện);
//   3. `ketThucNhapPosAction`  ⇒ XONG (đủ lô) hoặc DUNG_GIUA_CHUNG (client dừng vì lỗi); làm mới
//      trang ĐÚNG MỘT lần ở đây, không mỗi lô. Lượt bỏ dở không kịp báo ⇒ màn SUY "Dừng giữa
//      chừng" khi đọc (`lib/payments/pos/trang-thai-lo.ts`), không cron nào ghi;
//   4. `dongCanhBaoHuyPosAction` ⇒ kế toán đóng cảnh báo "hủy sau khi đã ghi nhận" SAU khi đã
//      gỡ gắn / hoàn bằng luồng hiện có (tầng này KHÔNG BAO GIỜ tự đảo bút toán).
//
// ⚠️ KHÔNG viết phép ghi tiền ở đây — mọi thứ ở `lib/payments/pos/nhap-lo-pos.ts` (qua
// `BankTransaction` + `thuTheoPhieuGop`). Tệp này chỉ: kiểm quyền, kiểm đầu vào, gọi lib.
//
// Quyền `payments:import-pos` (Q-D: chỉ Kế toán HO + Quản trị tối cao) hỏi NGAY ĐẦU mỗi action,
// viết thẳng trong thân — luật lint `authz/require-can-in-write-action` chỉ nhận ra
// `checkPermission()` ở thân action hoặc wrapper MỘT cấp.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb, passesScope } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { dongHuyPosSchema, dongPosNhapSchema } from "@/lib/payments/pos/kieu";
import { nhapLoPos, type KetQuaNhapLo } from "@/lib/payments/pos/nhap-lo-pos";
import { LOI_PHAM_VI_NHAP_POS, nhapPosDuocMoiCoSo } from "@/lib/payments/pos/pham-vi-nhap";
import { dongCanhBaoHuyPos } from "@/lib/payments/pos/dong-canh-bao-pos";
import { dongBoPhieuPosSauNhap } from "@/lib/payments/pos/dong-bo-sau-nhap";

const QUYEN = "payments:import-pos";

/** Trần một lượt gửi — màn cắt file theo đúng số này. */
const TRAN_DONG_MOT_LO = 300;

function lamMoi() {
  revalidatePath("/admin/bien-dong-so-du");
  revalidatePath("/bien-dong-so-du");
}

const TRAN_DONG_FILE = 20_000;

/**
 * Phần "một lô dữ liệu" — dùng chung cho lô 1 (trong `batDau`) và lô 2..n.
 *
 * Dòng parse bằng `dongPosNhapSchema` (GĐ3, V1–V4): payload là của CLIENT. Server không nhận file —
 * "thiếu cột" ở đây là thiếu KHOÁ (zod từ chối TRƯỚC khi mở lượt); `thoiGian` phải có múi giờ tường
 * minh (chuỗi không múi được đọc theo giờ MÁY CHỦ ⇒ lệch ngày thu); mọi chuỗi có trần độ dài.
 */
const loDuLieu = {
  dong: z
    .array(dongPosNhapSchema)
    .min(1, "Lô rỗng")
    .max(TRAN_DONG_MOT_LO, `Mỗi lượt tối đa ${TRAN_DONG_MOT_LO} dòng`),
  // Dòng Hủy/Hoàn của CẢ FILE trỏ vào dòng trong lô (màn import đã lọc theo lô). Server tự
  // phân loại từng dòng — KHÔNG nhận "danh sách mã gốc bị hủy" do client tính.
  dongHuyCuaFile: z.array(dongHuyPosSchema).max(3_000),
};

const batDauSchema = z
  .object({
    tenFile: z.string().trim().min(1, "Thiếu tên file").max(255, "Tên file quá dài"),
    soDong: z.number().int().min(1, "File không có dòng nào").max(TRAN_DONG_FILE, "File quá 20.000 dòng"),
    // Mỗi lô ≥ 1 dòng ⇒ số lô không vượt số dòng.
    soLo: z.number().int().min(1, "Thiếu số lô"),
    ...loDuLieu,
  })
  .refine((v) => v.soLo <= v.soDong, { message: "Số lô vượt số dòng của file", path: ["soLo"] });

export async function batDauNhapPosAction(
  input: unknown,
): Promise<{ ok: true; batchId: string; ketQua: KetQuaNhapLo } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) {
    return { ok: false, error: "Chỉ Kế toán Hội sở mới import được giao dịch thẻ" };
  }

  const parsed = batDauSchema.safeParse(input);
  if (!parsed.success) {
    const loi = parsed.error.issues[0];
    return { ok: false, error: loi ? `${loi.path.join(".") || "file"}: ${loi.message}` : "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  // Quyền KHÔNG đủ: phải nhìn được MỌI cơ sở (Q-D) — xem `lib/payments/pos/pham-vi-nhap.ts`.
  if (!nhapPosDuocMoiCoSo(actor)) return { ok: false, error: LOI_PHAM_VI_NHAP_POS };
  const sdb = scopedDb(actor);
  // `PosImportBatch` không thuộc SCOPED_MODELS (một file chứa giao dịch mọi máy) — không
  // có cột cơ sở để gác, và người tạo chính là người đang đăng nhập.
  const batch = await sdb.posImportBatch.create({
    data: { tenFile: parsed.data.tenFile, importedById: session.user.id, soLoTong: parsed.data.soLo },
    select: { id: true },
  });

  let ketQua: KetQuaNhapLo;
  try {
    // `lo: 1` — `nhapLoPos` ghi số đếm + `soLoXong` trong MỘT câu có điều kiện (GĐ3, V11).
    ketQua = await nhapLoPos({
      batchId: batch.id,
      lo: 1,
      dong: parsed.data.dong,
      dongHuyCuaFile: parsed.data.dongHuyCuaFile,
      nguoiNhapId: session.user.id,
    });
  } catch (err) {
    // Lô 1 hỏng cả lượt ⇒ gỡ lượt vừa tạo để lịch sử không có lượt 0 dòng. Có dòng POS đã trỏ
    // vào (khoá ngoại RESTRICT) thì lượt KHÔNG rỗng ⇒ để nguyên, và KHÔNG để lỗi xoá che lỗi gốc.
    await sdb.posImportBatch.deleteMany({ where: { id: batch.id, soLoXong: 0 } }).catch(() => undefined);
    throw err;
  }
  // GĐ3 (V6): dòng ĐÃ GHI NHẬN mà file ghi khác ⇒ sổ không đổi, giữ dấu vết sau khi panel đóng. Ghi SAU
  // lô, ngoài mọi transaction; lỗi ghi nhật ký KHÔNG làm hỏng kết quả của lô đã ghi xong.
  if (ketQua.lech.length > 0) {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId ?? "", name: actorName },
      module: "finance",
      entityType: "PosImportBatch",
      entityId: batch.id,
      action: "POS_IMPORT_LECH_DA_GHI_NHAN",
      newValues: { lo: 1, lech: ketQua.lech },
      orgUnitId: null,
    }).catch((err) => console.error("[pos] ghi nhật ký lệch lô 1 lỗi:", err));
  }
  return { ok: true, batchId: batch.id, ketQua };
}

const nhapLoSchema = z.object({
  batchId: z.string().min(1).max(64),
  /** Chỉ số lô, tính từ 1. Lô 1 thường đi cùng `batDau`; THỬ LẠI có thể gửi lại bất kỳ lô nào. */
  lo: z.number().int().min(1).max(TRAN_DONG_FILE),
  ...loDuLieu,
});

export async function nhapLoPosAction(
  input: unknown,
): Promise<{ ok: true; ketQua: KetQuaNhapLo } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) {
    return { ok: false, error: "Chỉ Kế toán Hội sở mới import được giao dịch thẻ" };
  }

  const parsed = nhapLoSchema.safeParse(input);
  if (!parsed.success) {
    const loi = parsed.error.issues[0];
    return { ok: false, error: loi ? `${loi.path.join(".")}: ${loi.message}` : "Dữ liệu không hợp lệ" };
  }

  const actor = await resolveActor(session.user.id);
  if (!nhapPosDuocMoiCoSo(actor)) return { ok: false, error: LOI_PHAM_VI_NHAP_POS };
  const sdb = scopedDb(actor);
  // Lô phải do CHÍNH người này mở — không cho ghi số vào lượt import của người khác.
  const batch = await sdb.posImportBatch.findUnique({
    where: { id: parsed.data.batchId },
    select: { id: true, importedById: true, trangThai: true, soLoTong: true },
  });
  if (!batch || batch.importedById !== session.user.id) {
    return { ok: false, error: "Không tìm thấy lượt import" };
  }
  // Mọi cổng đứng TRƯỚC phép ghi đầu tiên.
  if (batch.trangThai === "XONG") {
    return { ok: false, error: "Lượt import này đã kết thúc — chọn lại file để mở lượt mới" };
  }
  if (parsed.data.lo > batch.soLoTong) {
    return { ok: false, error: `Lô ${parsed.data.lo} vượt số lô của lượt import (${batch.soLoTong})` };
  }

  // THỬ LẠI một lượt client đã báo dừng ⇒ về "Đang nhập" trước khi ghi lô (có điều kiện: lượt
  // vừa bị đổi trạng thái ở nơi khác thì phép này đổi 0 dòng, vô hại).
  if (batch.trangThai === "DUNG_GIUA_CHUNG") {
    await sdb.posImportBatch.updateMany({
      where: { id: batch.id, trangThai: "DUNG_GIUA_CHUNG" },
      data: { trangThai: "DANG_NHAP" },
    });
  }

  // Chỉ số lô vào `nhapLoPos`: lô GỬI LẠI (trả lời bị mất) vẫn xử lý + trả kết quả cho màn, nhưng câu
  // đếm có điều kiện `soLoXong < lo` đổi 0 dòng ⇒ không cộng vào lượt lần hai (GĐ3, V11).
  const ketQua = await nhapLoPos({
    batchId: batch.id,
    lo: parsed.data.lo,
    dong: parsed.data.dong,
    dongHuyCuaFile: parsed.data.dongHuyCuaFile,
    nguoiNhapId: session.user.id,
  });
  if (ketQua.lech.length > 0) {
    const { actorId, actorName } = getAuditActor(session);
    await writeAudit({
      actor: { id: actorId ?? "", name: actorName },
      module: "finance",
      entityType: "PosImportBatch",
      entityId: batch.id,
      action: "POS_IMPORT_LECH_DA_GHI_NHAN",
      newValues: { lo: parsed.data.lo, lech: ketQua.lech },
      orgUnitId: null,
    }).catch((err) => console.error(`[pos] ghi nhật ký lệch lô ${parsed.data.lo} lỗi:`, err));
  }

  // KHÔNG `lamMoi()` ở đây: action có revalidate thì Next dựng lại CẢ trang (~12 câu tra) để trả
  // kèm MỖI lô — file 20.000 dòng là ~67 lượt dựng trang thừa. Trang làm mới MỘT lần ở
  // `ketThucNhapPosAction`; lối ra không tới được action đó thì màn tự `router.refresh()`.
  // Ca `[POS-UI-06]`.
  return { ok: true, ketQua };
}

const ketThucSchema = z.object({
  batchId: z.string().min(1).max(64),
  /** XONG sau lô cuối; DUNG_GIUA_CHUNG khi client dừng vì lỗi (thử lại sẽ đưa về DANG_NHAP). */
  ketQua: z.enum(["XONG", "DUNG_GIUA_CHUNG"]),
});

export async function ketThucNhapPosAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) {
    return { ok: false, error: "Chỉ Kế toán Hội sở mới import được giao dịch thẻ" };
  }

  const parsed = ketThucSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { batchId, ketQua } = parsed.data;

  // KHÔNG hỏi lại cổng phạm vi mọi cơ sở ở đây: action đổi NHÃN trạng thái của lượt do CHÍNH người
  // này mở (kiểm `importedById` dưới) và — từ GĐ1 POS — đồng bộ TRẠNG THÁI phiếu thu thẻ theo dữ liệu
  // vừa nhập (không ghi tiền thứ hai: tiền đã ghi ở `nhapLo`, dưới cổng phạm vi). Cổng phạm vi gác hai
  // action GHI DỮ LIỆU (`batDau` + `nhapLo`), đúng hai chỗ `[POS-UI-02]` đếm.
  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const batch = await sdb.posImportBatch.findUnique({
    where: { id: batchId },
    select: { id: true, importedById: true, trangThai: true, soLoTong: true, soLoXong: true },
  });
  if (!batch || batch.importedById !== session.user.id) {
    return { ok: false, error: "Không tìm thấy lượt import" };
  }

  // Cả hai nhánh là `updateMany` CÓ ĐIỀU KIỆN (chống đua): điều kiện nằm trong `where`, không
  // chỉ ở phép đọc phía trên.
  if (ketQua === "XONG") {
    const upd = await sdb.posImportBatch.updateMany({
      where: {
        id: batch.id,
        importedById: session.user.id,
        trangThai: { not: "XONG" },
        soLoXong: { gte: batch.soLoTong },
      },
      data: { trangThai: "XONG", xongLuc: new Date() },
    });
    if (upd.count === 0 && batch.trangThai !== "XONG") {
      return {
        ok: false,
        error: `Lượt import mới ghi ${batch.soLoXong}/${batch.soLoTong} lô — chưa đánh dấu xong`,
      };
    }
  } else {
    await sdb.posImportBatch.updateMany({
      where: { id: batch.id, importedById: session.user.id, trangThai: "DANG_NHAP" },
      data: { trangThai: "DUNG_GIUA_CHUNG" },
    });
  }

  // GĐ1 POS (06/10/2026, T11) — dữ liệu thẻ vừa đổi ⇒ đưa các PHIẾU THU THẺ đang mở (sale tạo trên màn
  // đơn) về đúng trạng thái, qua CHÍNH `kiemTraPhieuPos` (triggeredBy IMPORT). Tiền đã ghi lúc import —
  // lượt này không ghi tiền thứ hai. Lỗi đồng bộ KHÔNG làm hỏng lượt import đã xong (ghi nhật ký).
  //
  // CHỈ khi lượt XONG (rà đối kháng 06/10/2026): lượt DỪNG GIỮA CHỪNG để lại dữ liệu DỞ — dòng Hủy của
  // một cặp Thanh toán + Hủy có thể còn nằm ở lô chưa vào. Đồng bộ trên dữ liệu dở là kết luận phiếu
  // theo nửa sự thật (`[POSA-VA-01]`, `[POS1-VA-DB-05]`); phiếu chờ lượt XONG / sale bấm Kiểm tra.
  if (ketQua === "XONG") {
    const { actorId, actorName } = getAuditActor(session);
    // GĐ2: người nhập file ghi vào nhật ký kiểm (`PosCheckLog.createdById`, nguồn IMPORT).
    await dongBoPhieuPosSauNhap({
      now: new Date(),
      nguoiKiemId: session.user.id,
      nguoiBam: { id: actorId, name: actorName },
    }).catch((err) => console.error("[pos] đồng bộ phiếu thu thẻ sau import lỗi:", err));
  }

  lamMoi();
  return { ok: true };
}

const dongCanhBaoSchema = z.object({
  id: z.string().min(1).max(64),
  ghiChu: z.string().trim().min(5, "Ghi rõ đã xử lý thế nào (ít nhất 5 ký tự)").max(2000),
});

export async function dongCanhBaoHuyPosAction(
  input: unknown,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) {
    return { ok: false, error: "Chỉ Kế toán Hội sở mới đóng được cảnh báo này" };
  }

  const parsed = dongCanhBaoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { id, ghiChu } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const row = await sdb.posCardTransaction.findUnique({
    where: { id },
    select: { id: true, maGiaoDich: true, centerId: true, orgUnitId: true, canhBaoHuy: true, canhBaoDaXuLyLuc: true },
  });
  // `scopedDb` KHÔNG che write ⇒ kiểm phạm vi trên chính bản ghi trước khi ghi.
  if (!row || !passesScope("PosCardTransaction", row, actor)) {
    return { ok: false, error: "Không tìm thấy giao dịch thẻ" };
  }
  if (!row.canhBaoHuy) return { ok: false, error: "Giao dịch này không có cảnh báo hủy" };
  if (row.canhBaoDaXuLyLuc) return { ok: false, error: "Cảnh báo đã được đóng trước đó" };

  const luc = new Date();
  // Đóng cảnh báo trên GỐC + kết luận các dòng hủy/hoàn đang chờ của nó (một transaction) —
  // `lib/payments/pos/dong-canh-bao-pos.ts`.
  const soDongHuy = await dongCanhBaoHuyPos({
    id: row.id,
    maGiaoDich: row.maGiaoDich,
    nguoiDongId: session.user.id,
    ghiChu,
    luc,
  });
  if (soDongHuy === null) return { ok: false, error: "Cảnh báo đã được đóng trước đó" };

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId ?? "", name: actorName },
    module: "finance",
    entityType: "PosCardTransaction",
    entityId: row.id,
    action: "POS_CANH_BAO_HUY_DONG",
    oldValues: { canhBaoDaXuLyLuc: null },
    newValues: { canhBaoDaXuLyLuc: luc.toISOString(), maGiaoDich: row.maGiaoDich, soDongHuyDaKetLuan: soDongHuy },
    reason: ghiChu,
    orgUnitId: row.orgUnitId ?? row.centerId,
  });

  lamMoi();
  return { ok: true, message: `Đã đóng cảnh báo hủy của giao dịch ${row.maGiaoDich}.` };
}
