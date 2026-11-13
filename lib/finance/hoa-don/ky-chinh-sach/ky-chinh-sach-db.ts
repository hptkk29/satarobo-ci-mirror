import "server-only";
import { randomUUID } from "node:crypto";
import type { Actor } from "@/lib/auth/actor";
import { Prisma, type HoaDonTrangThai } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth/system-actor";
import { ngayVN } from "@/lib/format/thoi-gian-vn";
import { cauHinhHoaDonChoMoiTruong } from "../phap-nhan-theo-moi-truong";
import { kiemBatLai, kiemChinhSach, kiemHanMuc, kiemTamDung, phanTichThayDoiHanMuc, type HanMucKy, type SuDungHanMuc } from "./luat";

// lib/finance/hoa-don/ky-chinh-sach/ky-chinh-sach-db.ts — đọc / ghi bảng `HoaDonKyChinhSach` (BGĐ 04/11/2026): TẠM DỪNG KÝ + HẠN MỨC theo pháp nhân.
//
// ⚠️ QUYỀN GHI KHÔNG NẰM Ở ĐÂY: các hàm ghi nhận `nguoi` đã được action kiểm là Quản trị tối cao (`checkPermission("settings:edit")`, cùng tệp action — lint
//    `require-can-in-write-action` không tính wrapper import). Lưới `[KCS-W*]` ghim: mọi action ghi của tệp đó phải có cổng ấy.
// ⚠️ Bảng KHÔNG có centerId/orgUnitId (cấp pháp nhân). Đọc TRẠNG THÁI tạm dừng thì ai làm hoá đơn cũng cần thấy (để nút nói đúng) — đó không phải bí mật.
// ⚠️ Mọi ghi LUÔN kèm lý do + nhật ký trước/sau (AuditLog module "hoa-don"), cùng giao dịch với phép ghi.

const ENTITY = "HoaDonKyChinhSach";

export type ChinhSachKyDaDoc = HanMucKy & {
  phapNhanMa: string;
  tamDung: boolean;
  tamDungLuc: string | null;
  tamDungBoiId: string | null;
  tamDungLyDo: string | null;
  tamDungSuCo: boolean;
  capNhatBoiId: string;
  capNhatLuc: string;
};

const CHON = {
  phapNhanMa: true,
  tamDung: true,
  tamDungLuc: true,
  tamDungBoiId: true,
  tamDungLyDo: true,
  tamDungSuCo: true,
  hanMucMoiHoaDon: true,
  hanMucMoiNgay: true,
  soToiDa: true,
  cuaSoPhut: true,
  nguongTanSuat: true,
  capNhatBoiId: true,
  updatedAt: true,
} as const;

type Hang = {
  phapNhanMa: string;
  tamDung: boolean;
  tamDungLuc: Date | null;
  tamDungBoiId: string | null;
  tamDungLyDo: string | null;
  tamDungSuCo: boolean;
  hanMucMoiHoaDon: number | null;
  hanMucMoiNgay: number | null;
  soToiDa: number | null;
  cuaSoPhut: number | null;
  nguongTanSuat: number | null;
  capNhatBoiId: string;
  updatedAt: Date;
};

const sangDoc = (h: Hang): ChinhSachKyDaDoc => ({
  phapNhanMa: h.phapNhanMa,
  tamDung: h.tamDung,
  tamDungLuc: h.tamDungLuc?.toISOString() ?? null,
  tamDungBoiId: h.tamDungBoiId,
  tamDungLyDo: h.tamDungLyDo,
  tamDungSuCo: h.tamDungSuCo,
  hanMucMoiHoaDon: h.hanMucMoiHoaDon,
  hanMucMoiNgay: h.hanMucMoiNgay,
  soToiDa: h.soToiDa,
  cuaSoPhut: h.cuaSoPhut,
  nguongTanSuat: h.nguongTanSuat,
  capNhatBoiId: h.capNhatBoiId,
  capNhatLuc: h.updatedAt.toISOString(),
});

export async function docChinhSachKy(phapNhanMa: string): Promise<ChinhSachKyDaDoc | null> {
  const h = await db.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa }, select: CHON });
  return h ? sangDoc(h) : null;
}

export async function docCacChinhSachKy(): Promise<ChinhSachKyDaDoc[]> {
  const ds = await db.hoaDonKyChinhSach.findMany({ select: CHON, orderBy: { phapNhanMa: "asc" } });
  return ds.map(sangDoc);
}

/** Pháp nhân này đang bị tạm dừng ký không. KHÔNG có dòng ⇒ không dừng. Lỗi đọc DB ⇒ NÉM (không nuốt: dừng khẩn cấp không được fail-open vì lỗi mạng). */
export async function kyDangTamDung(phapNhanMa: string): Promise<{ tamDung: false } | { tamDung: true; lyDo: string; suCo: boolean }> {
  const h = await db.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa }, select: { tamDung: true, tamDungLyDo: true, tamDungSuCo: true } });
  if (!h?.tamDung) return { tamDung: false };
  return { tamDung: true, lyDo: h.tamDungLyDo ?? "", suCo: h.tamDungSuCo };
}

/** Câu nói với người dùng khi bị chặn vì tạm dừng. MỘT chỗ — mọi cổng dùng chung để thông điệp không lệch nhau. */
export const CAU_TAM_DUNG_KY = "Việc ký / phát hành của pháp nhân này đang được Quản trị tối cao tạm dừng. Hoá đơn vẫn được giữ nguyên; liên hệ Quản trị tối cao để biết khi nào ký lại.";

type Nguoi = { id: string; name: string };
type KetQuaGhi = { ok: true } | { ok: false; error: string };

const CHI_QUAN_TRI = "Chỉ Quản trị tối cao được thay đổi chính sách ký, hạn mức hoặc tạm dừng / bật lại ký.";

function pnHopLe(phapNhanMa: string): boolean {
  return cauHinhHoaDonChoMoiTruong().phapNhan.some((p) => p.ma === phapNhanMa && p.bat);
}

const TRUONG_HAN_MUC = ["hanMucMoiHoaDon", "hanMucMoiNgay", "soToiDa", "cuaSoPhut", "nguongTanSuat"] as const;

/**
 * Lưu hạn mức (không đụng trạng thái tạm dừng). Nhật ký ghi giá trị cũ → mới của các trường hạn mức.
 * ⚠️ NỚI LỎNG (tăng hạn mức · bật tự ký lần đầu · rút ngắn cửa sổ — `phanTichThayDoiHanMuc`) cần `xacNhanNoiLong === true` — ÉP Ở ĐÂY, không chỉ ở màn:
 *    màn cũng hiện bảng cũ → mới và ô xác nhận, nhưng một lời gọi trực tiếp tới action không qua màn vẫn bị chặn.
 * `maChiDao` (tuỳ chọn): mã/ghi chú chỉ đạo của Ban Giám đốc, ghi vào nhật ký cùng lý do — không là điều kiện bắt buộc.
 * Hiệu lực ngay khi giao dịch xong: cổng hạn mức (`giuChoHanMucTrongTx`) khoá CHÍNH dòng này nên đọc giá trị mới nhất, không cache, không cần deploy/khởi động lại.
 */
export async function luuHanMucKy(i: { actor: Actor; nguoi: Nguoi; phapNhanMa: string; han: HanMucKy; lyDo: string | null; xacNhanNoiLong?: unknown; maChiDao?: string | null }): Promise<KetQuaGhi> {
  if (!i.actor.isSuperAdmin) return { ok: false, error: CHI_QUAN_TRI };
  if (!pnHopLe(i.phapNhanMa)) return { ok: false, error: "Pháp nhân không tồn tại hoặc đang tắt." };
  const loi = kiemChinhSach({ ...i.han, lyDo: i.lyDo });
  if (loi.length > 0) return { ok: false, error: loi[0]! };
  const lyDo = (i.lyDo ?? "").trim();
  const maChiDao = (i.maChiDao ?? "").trim().slice(0, 120) || null;
  try {
    return await db.$transaction(async (tx): Promise<KetQuaGhi> => {
      const cu = await tx.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa: i.phapNhanMa }, select: { id: true, ...Object.fromEntries(TRUONG_HAN_MUC.map((k) => [k, true])) } });
      const cuHan = cu ? Object.fromEntries(TRUONG_HAN_MUC.map((k) => [k, (cu as Record<string, unknown>)[k] ?? null])) : null;
      const moiHan = Object.fromEntries(TRUONG_HAN_MUC.map((k) => [k, i.han[k]]));
      const pt = phanTichThayDoiHanMuc(cuHan ? (cuHan as HanMucKy) : null, i.han);
      // Cổng ĐỨNG TRƯỚC phép ghi đầu tiên: `return` ở đây không để lại gì.
      if (pt.noiLong && i.xacNhanNoiLong !== true) {
        return { ok: false, error: `Thay đổi này NỚI hạn mức ký tự động — cần tick xác nhận riêng. ${pt.lyDoNoiLong.join(" ")}` };
      }
      const du = { ...moiHan, capNhatBoiId: i.nguoi.id, lyDoCapNhat: lyDo };
      const id = cu?.id ?? randomUUID();
      if (cu) await tx.hoaDonKyChinhSach.update({ where: { id }, data: du });
      else await tx.hoaDonKyChinhSach.create({ data: { id, phapNhanMa: i.phapNhanMa, ...du } });
      await writeAudit({
        tx,
        actor: i.nguoi,
        module: "hoa-don",
        entityType: ENTITY,
        entityId: id,
        action: cu ? "SUA_HAN_MUC_KY" : "TAO_HAN_MUC_KY",
        oldValues: cuHan ? { ...cuHan, phapNhanMa: i.phapNhanMa } : null,
        newValues: { ...moiHan, phapNhanMa: i.phapNhanMa, ...(pt.noiLong ? { xacNhanNoiLong: true } : {}), ...(maChiDao ? { maChiDao } : {}) },
        reason: lyDo,
      });
      return { ok: true };
    });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === "P2002") return { ok: false, error: "Có người vừa lưu chính sách này — tải lại trang rồi thử lại." };
    throw e;
  }
}

/**
 * TẠM DỪNG KÝ pháp nhân. Chỉ chặn việc GỬI mới (xem `cong-theo-phap-nhan.ts`); tra cứu / đối soát vẫn chạy để biết kết quả của thứ đã gửi.
 * Đã dừng rồi ⇒ từ chối (không ghi nhật ký trùng, không ghi đè lý do/thời điểm gốc). `suCo` = sự cố bảo mật ⇒ bật lại cần xác nhận riêng.
 */
export async function tamDungKy(i: { actor: Actor; nguoi: Nguoi; phapNhanMa: string; lyDo: string | null; suCo: boolean; now: Date }): Promise<KetQuaGhi> {
  if (!i.actor.isSuperAdmin) return { ok: false, error: CHI_QUAN_TRI };
  if (!pnHopLe(i.phapNhanMa)) return { ok: false, error: "Pháp nhân không tồn tại hoặc đang tắt." };
  const loi = kiemTamDung(i.lyDo);
  if (loi.length > 0) return { ok: false, error: loi[0]! };
  const lyDo = (i.lyDo ?? "").trim();
  try {
    return await db.$transaction(async (tx) => {
      const cu = await tx.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa: i.phapNhanMa }, select: { id: true, tamDung: true } });
      if (cu?.tamDung) return { ok: false as const, error: "Pháp nhân này đã đang tạm dừng ký." };
      const id = cu?.id ?? randomUUID();
      const du = { tamDung: true, tamDungLuc: i.now, tamDungBoiId: i.nguoi.id, tamDungLyDo: lyDo, tamDungSuCo: i.suCo, capNhatBoiId: i.nguoi.id, lyDoCapNhat: lyDo };
      if (cu) await tx.hoaDonKyChinhSach.update({ where: { id }, data: du });
      else await tx.hoaDonKyChinhSach.create({ data: { id, phapNhanMa: i.phapNhanMa, ...du } });
      await writeAudit({
        tx,
        actor: i.nguoi,
        module: "hoa-don",
        entityType: ENTITY,
        entityId: id,
        action: "TAM_DUNG_KY",
        oldValues: { tamDung: false, phapNhanMa: i.phapNhanMa },
        newValues: { tamDung: true, suCo: i.suCo, phapNhanMa: i.phapNhanMa },
        reason: lyDo,
      });
      return { ok: true as const };
    });
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === "P2002") return { ok: false, error: "Có người vừa lưu chính sách này — tải lại trang rồi thử lại." };
    throw e;
  }
}

class BatLaiDaDoi extends Error {}

/** BẬT LẠI ký: bước RIÊNG (lý do + với dừng vì sự cố thì xác nhận riêng), có nhật ký. Ghi có điều kiện `tamDung = true` — hai người bật cùng lúc, đúng một ghi. */
export async function batLaiKy(i: { actor: Actor; nguoi: Nguoi; phapNhanMa: string; lyDo: string | null; xacNhanSuCo: unknown }): Promise<KetQuaGhi> {
  if (!i.actor.isSuperAdmin) return { ok: false, error: CHI_QUAN_TRI };
  const lyDo = (i.lyDo ?? "").trim();
  return db.$transaction(async (tx) => {
    const cu = await tx.hoaDonKyChinhSach.findUnique({ where: { phapNhanMa: i.phapNhanMa }, select: { id: true, tamDung: true, tamDungSuCo: true } });
    const loi = kiemBatLai({ hienTai: cu ? { tamDung: cu.tamDung, tamDungSuCo: cu.tamDungSuCo } : null, xacNhanSuCo: i.xacNhanSuCo, lyDo });
    if (loi.length > 0 || !cu) return { ok: false as const, error: loi[0] ?? "Pháp nhân này không đang tạm dừng ký." };
    const upd = await tx.hoaDonKyChinhSach.updateMany({
      where: { id: cu.id, tamDung: true },
      data: { tamDung: false, tamDungLuc: null, tamDungBoiId: null, tamDungLyDo: null, tamDungSuCo: false, capNhatBoiId: i.nguoi.id, lyDoCapNhat: lyDo },
    });
    // Từ chối SAU phép ghi trong giao dịch = NÉM (rollback), bắt ở ngoài — `return` không rollback.
    if (upd.count !== 1) throw new BatLaiDaDoi();
    await writeAudit({
      tx,
      actor: i.nguoi,
      module: "hoa-don",
      entityType: ENTITY,
      entityId: cu.id,
      action: "BAT_LAI_KY",
      oldValues: { tamDung: true, suCo: cu.tamDungSuCo, phapNhanMa: i.phapNhanMa },
      newValues: { tamDung: false, xacNhanSuCo: cu.tamDungSuCo ? true : null, phapNhanMa: i.phapNhanMa },
      reason: lyDo,
    });
    return { ok: true as const };
  }).catch((e: unknown) => {
    if (e instanceof BatLaiDaDoi) return { ok: false as const, error: "Có người vừa bật lại — tải lại trang." };
    throw e;
  });
}

type MayDoc = Pick<Prisma.TransactionClient, "hoaDonDienTu">;

// Hoá đơn tính vào hạn mức: ĐÃ/ĐANG ký bằng HSM. DANG_PHAT_HANH (đang gửi/chưa rõ — chưa thu hồi được) · DA_XAC_NHAN · THAY_THE (đã phát hành rồi mới huỷ — HSM vẫn đã ký).
// LOI_PHAT_HANH KHÔNG tính: nhà cung cấp đã TỪ CHỐI chắc chắn, chưa có hoá đơn nào. Gửi lại / timeout / callback lặp cùng cập nhật MỘT dòng nên không bao giờ tính hai lần.
const TRANG_THAI_TINH_HAN_MUC: HoaDonTrangThai[] = ["DANG_PHAT_HANH", "DA_XAC_NHAN", "THAY_THE"];

/**
 * Đã dùng bao nhiêu hạn mức: tổng VND hoá đơn của pháp nhân từ 00:00 hôm nay (GIỜ VIỆT NAM, +07:00) và số hoá đơn trong `cuaSoPhut` phút gần nhất.
 * CHỈ đếm hoá đơn do HỆ THỐNG tạo (`taoBoiId = SYSTEM_USER_ID`: lô 23h · tự xuất) — hạn mức này là của việc KÝ TỰ ĐỘNG; hoá đơn kế toán bấm tay hoặc tải lên
 * (TAI_LEN, đã phát hành ở nơi khác) không ăn vào đó. `boQuaHoaDonId`: loại chính hoá đơn đang xét (kiểm lại bản đã tạo mà không tính nó hai lần).
 * `may`: truyền `tx` khi gọi TRONG giao dịch giữ chỗ — đếm trên chính giao dịch đó, sau khi đã khoá chính sách.
 */
export async function docSuDungHanMuc(phapNhanMa: string, cuaSoPhut: number, now: Date, may: MayDoc = db, boQuaHoaDonId?: string): Promise<SuDungHanMuc> {
  const dauNgay = new Date(`${ngayVN(now)}T00:00:00+07:00`);
  const dauCuaSo = new Date(now.getTime() - cuaSoPhut * 60_000);
  const chung = { phapNhanMa, taoBoiId: SYSTEM_USER_ID, trangThai: { in: TRANG_THAI_TINH_HAN_MUC }, ...(boQuaHoaDonId ? { id: { not: boQuaHoaDonId } } : {}) };
  const [ngay, cuaSo] = await Promise.all([
    may.hoaDonDienTu.aggregate({ where: { ...chung, createdAt: { gte: dauNgay } }, _sum: { tongTien: true } }),
    may.hoaDonDienTu.count({ where: { ...chung, createdAt: { gte: dauCuaSo } } }),
  ]);
  return { tongNgay: ngay._sum?.tongTien ?? 0, soTrongCuaSo: cuaSo };
}

export type KetQuaGiuCho = { ok: true; canhBao: string | null } | { ok: false; ma: "TAM_DUNG" | "CHUA_KHAI_HAN_MUC" | "VUOT_MOI_HOA_DON" | "VUOT_NGAY" | "VUOT_SO_LUONG"; lyDo: string };

type HangChinhSachKhoa = { tamDung: boolean; hanMucMoiHoaDon: number | null; hanMucMoiNgay: number | null; soToiDa: number | null; cuaSoPhut: number | null; nguongTanSuat: number | null };

/**
 * CỔNG HẠN MỨC NGUYÊN TỬ cho đường KÝ TỰ ĐỘNG bằng HSM — gọi TRONG giao dịch tạo hoá đơn (`batDauPhatHanh`), TRƯỚC `hoaDonDienTu.create`.
 *
 *   1. `SELECT … FOR UPDATE` dòng chính sách của pháp nhân: hai worker (lô 23h + tự xuất, hoặc hai lượt cron chồng nhau) vào đây TUẦN TỰ. Người sau chỉ chạy tiếp khi người
 *      trước đã commit — và khi đó câu đếm bên dưới đã THẤY hoá đơn của người trước.
 *   2. Đọc LẠI tạm dừng + hạn mức dưới khoá (không dùng bản đọc trước đó): Quản trị tối cao đổi chính sách ở `luuHanMucKy` / `tamDungKy` cũng ghi đúng dòng này, nên
 *      thay đổi hạn mức/tạm dừng được áp ngay ở lượt giữ chỗ KẾ TIẾP, không cache, không cần deploy.
 *   3. Hoá đơn được tạo ngay sau đó TRONG CÙNG giao dịch chính là «chỗ đã giữ» (`docSuDungHanMuc` đếm nó) — không có bảng giữ chỗ riêng để lệch với sổ hoá đơn.
 *
 * FAIL-CLOSED: KHÔNG có dòng chính sách ⇒ không có gì để khoá và không có hạn mức ⇒ `CHUA_KHAI_HAN_MUC`. Lỗi DB ⇒ NÉM (giao dịch rollback, không tạo hoá đơn).
 * `phapNhanMa` PHẢI là mã đã dùng để đóng dấu hoá đơn (cùng giá trị ghi vào cột `phapNhanMa`), không phải mã runner dò trước đó.
 */
export async function giuChoHanMucTrongTx(tx: Prisma.TransactionClient, i: { phapNhanMa: string; soTien: number; now: Date }): Promise<KetQuaGiuCho> {
  const hang = await tx.$queryRaw<HangChinhSachKhoa[]>(
    Prisma.sql`SELECT "tamDung", "hanMucMoiHoaDon", "hanMucMoiNgay", "soToiDa", "cuaSoPhut", "nguongTanSuat" FROM "HoaDonKyChinhSach" WHERE "phapNhanMa" = ${i.phapNhanMa} FOR UPDATE`,
  );
  const cs = hang[0] ?? null;
  if (cs?.tamDung) return { ok: false, ma: "TAM_DUNG", lyDo: CAU_TAM_DUNG_KY };
  const suDung = cs && cs.cuaSoPhut !== null ? await docSuDungHanMuc(i.phapNhanMa, cs.cuaSoPhut, i.now, tx) : { tongNgay: 0, soTrongCuaSo: 0 };
  const kq = kiemHanMuc({ chinhSach: cs, soTien: i.soTien, suDung });
  return kq.ok ? { ok: true, canhBao: kq.canhBao } : { ok: false, ma: kq.ma, lyDo: kq.lyDo };
}

/**
 * Kiểm lại một hoá đơn HỆ THỐNG đã tạo mà CHƯA GỬI tới nhà cung cấp (mất điện / crash giữa «lập» và «gửi»; cron đối soát sắp gửi nó): chính sách HIỆN HÀNH còn cho phép không?
 * Chỉ xét phần KHÔNG đổi theo việc nó đã được đếm — khai đủ hạn mức + mỗi hoá đơn + tạm dừng; tổng ngày/số lượng đã gồm chính nó nên không đếm lại.
 * Hoá đơn của người (bấm tay) không bị xét ở đây. Trả `null` = được gửi; chuỗi = lý do giữ lại. Lỗi DB ⇒ NÉM (người gọi coi là «không gửi»).
 */
export async function lyDoKhongGuiDuocHoaDonHeThong(hoaDonId: string): Promise<string | null> {
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { phapNhanMa: true, tongTien: true, taoBoiId: true } });
  if (!hd || hd.taoBoiId !== SYSTEM_USER_ID) return null;
  if (!hd.phapNhanMa) return "Hoá đơn không có mã pháp nhân nên không kiểm được hạn mức ký tự động.";
  const cs = await docChinhSachKy(hd.phapNhanMa);
  if (cs?.tamDung) return CAU_TAM_DUNG_KY;
  const kq = kiemHanMuc({ chinhSach: cs, soTien: hd.tongTien, suDung: { tongNgay: 0, soTrongCuaSo: 0 } });
  return kq.ok ? null : kq.lyDo;
}

export type DongLichSuChinhSach = { id: string; phapNhanMa: string; action: string; luc: string; nguoi: string; lyDo: string | null; maChiDao: string | null; truocSau: { truong: string; truoc: unknown; sau: unknown }[] };

/** Lịch sử chính sách ký (tạm dừng · bật lại · hạn mức) — trước/sau, người, lúc, lý do. Đọc qua AuditLog module "hoa-don"; không cần nới `audit-logs:view`. */
export async function docLichSuChinhSachKy(): Promise<DongLichSuChinhSach[]> {
  const ds = await db.auditLog.findMany({
    where: { entityType: ENTITY },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, action: true, createdAt: true, actorName: true, reason: true, oldValues: true, newValues: true },
  });
  return ds.map((d) => {
    const cu = (d.oldValues ?? {}) as Record<string, unknown>;
    const moi = (d.newValues ?? {}) as Record<string, unknown>;
    // `phapNhanMa` là khoá dòng; `xacNhanNoiLong` / `maChiDao` là dấu vết của CHÍNH lần lưu (không phải giá trị chính sách) nên không vào bảng trước → sau.
    const truongs = [...new Set([...Object.keys(cu), ...Object.keys(moi)])].filter((k) => k !== "phapNhanMa" && k !== "xacNhanNoiLong" && k !== "maChiDao");
    return {
      id: d.id,
      phapNhanMa: typeof moi["phapNhanMa"] === "string" ? (moi["phapNhanMa"] as string) : "",
      action: d.action,
      luc: d.createdAt.toISOString(),
      nguoi: d.actorName ?? "",
      lyDo: d.reason ?? null,
      maChiDao: typeof moi["maChiDao"] === "string" ? (moi["maChiDao"] as string) : null,
      truocSau: truongs.filter((k) => cu[k] !== moi[k]).map((k) => ({ truong: k, truoc: cu[k] ?? null, sau: moi[k] ?? null })),
    };
  });
}
