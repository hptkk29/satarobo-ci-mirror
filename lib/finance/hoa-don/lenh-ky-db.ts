import "server-only";
import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { baoNgoaiLeTucThoi } from "./ngoai-le-tuc-thoi-db";
import { passesScope } from "@/lib/db-scope";
import {
  chuanHoaKetQuaKy,
  duocPhepKy,
  laHashHopLe,
  lyDoLoiKy,
  MA_LOI_KY,
  type BoKy,
  type KetQuaKyDaChuanHoa,
  type MaLoiKy,
} from "./lenh-ky-bo-ky";
import {
  canDuyet,
  chuyenLenhKy,
  daHetHan,
  kiemTachNhiemVu,
  laPhuongThucKy,
  NGUOI_YEU_CAU_HE_THONG,
  TRANG_THAI_SONG,
  tinhHetHan,
  type ChinhSachDuyetKy,
  type TrangThaiLenhKy,
} from "./lenh-ky-trang-thai";
import { coQuyenKeToanTaiCoSo } from "./quyen";

// lib/finance/hoa-don/lenh-ky-db.ts — SIGNATURE ENGINE (Invoice Hub S9): LỆNH KÝ hoá đơn trên Postgres. KHÔNG ký thật, KHÔNG nhà cung cấp, KHÔNG PIN/khoá.
//
// Luật (luật thuần: lenh-ky-trang-thai.ts · giao diện bộ ký: lenh-ky-bo-ky.ts):
//  · Chỉ lưu HASH dữ liệu cần ký. Audit KHÔNG mang hash — chỉ id / trạng thái / phương thức / người.
//  · Quyền: `payments:confirm` TẠI cơ sở của hoá đơn (`coQuyenKeToanTaiCoSo`) ∧ `passesScope`. Cơ sở của lệnh lấy từ CHÍNH hoá đơn, không từ đầu vào.
//    Lệnh không tồn tại / cơ sở khác / ngoài tầm nhìn ⇒ MỘT câu "không tìm thấy" (không để dò id).
//  · MỌI chuyển trạng thái đi qua `chuyenCoDieuKien`: `updateMany` CÓ ĐIỀU KIỆN trạng thái cũ + cơ sở; đổi 0 dòng ⇒ báo "đã đổi", KHÔNG audit. Audit CÙNG giao dịch, sau khi ghi thành công.
//  · Trong `$transaction`: từ chối = `throw` (rollback), mọi cổng đứng TRƯỚC phép ghi đầu tiên; bắt và dịch ở NGOÀI giao dịch. P2002 của chỉ mục từng phần cũng bắt ở ngoài (giao dịch đã hỏng).
//  · Bộ ký KHÔNG bao giờ được gọi bên trong giao dịch DB (chậm / có thể treo). Ba bước: đọc + cổng → gọi bộ ký → giao dịch ngắn ghi kết quả.
//  · Lỗi bộ ký ⇒ LOI_KY với MÃ liệt kê sẵn + lý do CỐ ĐỊNH; thông điệp gốc (có thể mang PIN / tên người) không được lưu, không được trả ra.
//  · Chính sách duyệt là DỮ LIỆU người gọi truyền vào (BẮT BUỘC, không mặc định); tra theo cơ sở CỦA LỆNH, nên chính sách cơ sở A không giúp được cơ sở B.
//  · Hạn lệnh: không có hạn (hàng chèn tay) ⇒ coi như quá hạn. Đồng hồ là `now` do người gọi truyền vào.
//  · Không ghi gì ngoài `HoaDonLenhKy` (+ AuditLog): không hoá đơn, đơn, khoản thu.
//  · KHÔNG nối vào action / UI / route — việc nối dây là của lead.

const ENTITY = "HoaDonLenhKy";
const MODULE = "hoa-don";
const HE_THONG = { id: null, name: "Hệ thống" } as const;

export const TOI_DA_MOI_LAN_QUET = 200;
export const TOI_THIEU_LY_DO_HUY = 10;
export const TOI_DA_LY_DO_HUY = 500;

export type MaLoiLenhKy =
  | "KHONG_THAY"
  | "DU_LIEU"
  | "DA_CO_LENH_SONG"
  | "CHUYEN"
  | "DA_DOI"
  | "HET_HAN"
  | "TACH_NHIEM_VU"
  | "KHONG_PHAI_NGUOI_KY"
  | "CHUA_NOI_BO_KY"
  | "LY_DO"
  | "LOI_KY";

export type LoiLenhKy = {
  ok: false;
  ma: MaLoiLenhKy;
  error: string;
  /** Có khi bộ ký đã trả CHỮ KÝ nhưng sổ không ghi được (lệnh bị đổi trong lúc ký): người gọi phải ghi log để đối soát tay. */
  maGiaoDichMoCoi?: string;
  /** Trạng thái lệnh sau khi ghi (chỉ với `LOI_KY`). */
  trangThai?: TrangThaiLenhKy;
};

export type KetQuaTaoLenh = { ok: true; id: string; hetHanLuc: Date } | LoiLenhKy;
export type KetQuaDuyetKy = { ok: true; id: string; trangThai: "DANG_KY"; nguoiKyId: string } | LoiLenhKy;
export type KetQuaHoanTatKy = { ok: true; id: string; trangThai: "DA_KY"; maGiaoDich: string } | LoiLenhKy;
export type KetQuaGhiLoiKy = { ok: true; id: string; trangThai: "LOI_KY" } | LoiLenhKy;
export type KetQuaHuyLenh = { ok: true; id: string; trangThai: "HUY" } | LoiLenhKy;

/** Từ chối nghiệp vụ trong giao dịch ⇒ NÉM (rollback). Bắt ngoài `$transaction`. */
class TuChoiLenhKy extends Error {
  constructor(
    readonly ma: MaLoiLenhKy,
    thongDiep: string,
    readonly them: Partial<Pick<LoiLenhKy, "trangThai">> = {},
  ) {
    super(thongDiep);
  }
}

const loi = (e: TuChoiLenhKy): LoiLenhKy => ({ ok: false, ma: e.ma, error: e.message, ...e.them });
const KHONG_THAY = () => new TuChoiLenhKy("KHONG_THAY", "Không tìm thấy lệnh ký này trong phạm vi của bạn.");

type DongLenh = {
  id: string;
  hoaDonId: string;
  centerId: string;
  orgUnitId: string | null;
  phuongThuc: string;
  trangThai: string;
  nguoiYeuCauId: string;
  nguoiKyId: string | null;
  duLieuCanKyHash: string;
  hetHanLuc: Date | null;
};

/** Cổng cơ sở DUY NHẤT của file: kế toán TẠI cơ sở của lệnh ∧ trong tầm nhìn. Hàng không có ⇒ false. */
function duocThaoTac(actor: Actor, row: { centerId: string; orgUnitId?: string | null } | null | undefined): boolean {
  return row != null && coQuyenKeToanTaiCoSo(actor, row.centerId) && passesScope(ENTITY, row, actor);
}

function nguoiGhi(actor: Actor, ten: string) {
  return { id: actor.userId, name: ten };
}

/**
 * ĐIỂM CHUYỂN TRẠNG THÁI DUY NHẤT: `updateMany` có điều kiện (trạng thái cũ + cơ sở + điều kiện thêm) → audit cùng giao dịch CHỈ khi ghi đúng 1 dòng.
 * Trả `false` khi 0 dòng (người khác đã đổi) — người gọi quyết định ném hay bỏ qua. Không bao giờ ghi audit cho phép ghi không xảy ra.
 */
async function chuyenCoDieuKien(
  tx: Prisma.TransactionClient,
  i: {
    row: DongLenh;
    tu: TrangThaiLenhKy;
    den: TrangThaiLenhKy;
    data: Prisma.HoaDonLenhKyUncheckedUpdateManyInput;
    them?: Prisma.HoaDonLenhKyWhereInput;
    nguoi: { id: string | null; name: string };
    action: string;
    newValues: Record<string, unknown>;
    reason: string;
    now: Date;
  },
): Promise<boolean> {
  const upd = await tx.hoaDonLenhKy.updateMany({
    where: { AND: [{ id: i.row.id, trangThai: i.tu, centerId: i.row.centerId }, ...(i.them ? [i.them] : [])] },
    data: { ...i.data, trangThai: i.den, updatedAt: i.now },
  });
  if (upd.count !== 1) return false;
  await writeAudit({
    tx,
    actor: i.nguoi,
    module: MODULE,
    entityType: ENTITY,
    entityId: i.row.id,
    action: i.action,
    oldValues: { trangThai: i.tu },
    newValues: { ...i.newValues, trangThai: i.den, hoaDonId: i.row.hoaDonId, phuongThuc: i.row.phuongThuc },
    reason: i.reason,
    orgUnitId: i.row.orgUnitId ?? i.row.centerId,
  });
  return true;
}

const DA_DOI = () => new TuChoiLenhKy("DA_DOI", "Lệnh ký vừa được người khác xử lý — tải lại để xem trạng thái mới.");
const KHONG_CHUYEN_DUOC = (tu: string, den: string): TuChoiLenhKy => {
  const kq = chuyenLenhKy(tu, den);
  return new TuChoiLenhKy("CHUYEN", kq.ok ? "Không thể thực hiện thao tác này ở trạng thái hiện tại của lệnh ký." : kq.lyDo);
};
const HET_HAN = () => new TuChoiLenhKy("HET_HAN", "Lệnh ký đã quá hạn — tạo lệnh mới.");

// ── TẠO ───────────────────────────────────────────────────────────────────

/**
 * Tạo lệnh ký (CHO_KY) cho MỘT hoá đơn. Cơ sở của lệnh = cơ sở của hoá đơn (đọc từ DB, đầu vào không có chỗ để truyền). Đầu vào kiểm TRƯỚC mọi phép đọc.
 * Một lệnh sống mỗi hoá đơn: lệnh sống cũ còn hạn ⇒ DA_CO_LENH_SONG; đã quá hạn mà chưa ai quét ⇒ đóng nó (HET_HAN, có audit) rồi tạo lệnh mới.
 */
export async function taoLenhKy(i: {
  actor: Actor;
  ten: string;
  hoaDonId: string;
  phuongThuc: string;
  duLieuCanKyHash: string;
  ttlPhut: number;
  now: Date;
}): Promise<KetQuaTaoLenh> {
  return taoLenhCore({
    hoaDonId: i.hoaDonId,
    phuongThuc: i.phuongThuc,
    duLieuCanKyHash: i.duLieuCanKyHash,
    ttlPhut: i.ttlPhut,
    now: i.now,
    nguoiYeuCauId: i.actor.userId,
    nguoi: nguoiGhi(i.actor, i.ten),
    duocTao: (hd) => coQuyenKeToanTaiCoSo(i.actor, hd.centerId) && passesScope("HoaDonDienTu", hd, i.actor),
  });
}

/**
 * Tạo lệnh ký do HỆ THỐNG (người yêu cầu = `NGUOI_YEU_CAU_HE_THONG`) — CHỈ bước quét tạo lệnh ký (cron) gọi, và chỉ cho hoá đơn do Invoice Engine đã lập
 * (`batDauPhatHanh`). KHÔNG nhận actor, KHÔNG có đường nào từ action / API tới đây (lưới `[LK-W7]` ghim người gọi). Mọi cổng còn lại y hệt `taoLenhKy`:
 * một lệnh sống mỗi hoá đơn (lệnh sống còn hạn ⇒ `DA_CO_LENH_SONG`, người gọi coi là «đã có», idempotent), hash bắt buộc, hạn hợp lệ, audit cùng giao dịch.
 */
export async function taoLenhKyHeThong(i: { hoaDonId: string; phuongThuc: string; duLieuCanKyHash: string; ttlPhut: number; now: Date }): Promise<KetQuaTaoLenh> {
  return taoLenhCore({ ...i, nguoiYeuCauId: NGUOI_YEU_CAU_HE_THONG, nguoi: HE_THONG, duocTao: () => true });
}

async function taoLenhCore(i: {
  hoaDonId: string;
  phuongThuc: string;
  duLieuCanKyHash: string;
  ttlPhut: number;
  now: Date;
  nguoiYeuCauId: string;
  nguoi: { id: string | null; name: string };
  duocTao: (hd: { centerId: string; orgUnitId: string | null }) => boolean;
}): Promise<KetQuaTaoLenh> {
  if (!laPhuongThucKy(i.phuongThuc)) return { ok: false, ma: "DU_LIEU", error: "Phương thức ký không hợp lệ." };
  if (!laHashHopLe(i.duLieuCanKyHash)) return { ok: false, ma: "DU_LIEU", error: "Dữ liệu cần ký phải là mã băm SHA-256 — hệ thống không nhận dữ liệu thô." };
  let hetHanLuc: Date;
  try {
    hetHanLuc = tinhHetHan(i.now, i.ttlPhut);
  } catch {
    return { ok: false, ma: "DU_LIEU", error: "Hạn lệnh ký không hợp lệ." };
  }
  const phuongThuc = i.phuongThuc;

  const hd = await db.hoaDonDienTu.findUnique({ where: { id: i.hoaDonId }, select: { centerId: true, orgUnitId: true } });
  if (!hd || !i.duocTao(hd)) {
    return { ok: false, ma: "KHONG_THAY", error: "Không tìm thấy hoá đơn này trong phạm vi của bạn." };
  }

  try {
    return await db.$transaction(async (tx) => {
      const song = await tx.hoaDonLenhKy.findFirst({
        where: { hoaDonId: i.hoaDonId, trangThai: { in: [...TRANG_THAI_SONG] } },
        select: {
          id: true,
          hoaDonId: true,
          centerId: true,
          orgUnitId: true,
          phuongThuc: true,
          trangThai: true,
          nguoiYeuCauId: true,
          nguoiKyId: true,
          duLieuCanKyHash: true,
          hetHanLuc: true,
        },
      });
      if (song) {
        if (!daHetHan(song.hetHanLuc, i.now)) {
          throw new TuChoiLenhKy("DA_CO_LENH_SONG", "Hoá đơn này đang có một lệnh ký chưa kết thúc — xử lý hoặc huỷ lệnh đó trước.");
        }
        const dong = await chuyenCoDieuKien(tx, {
          row: song,
          tu: song.trangThai as TrangThaiLenhKy,
          den: "HET_HAN",
          data: {},
          nguoi: i.nguoi,
          action: "HET_HAN_LENH_KY_HOA_DON",
          newValues: {},
          reason: "Lệnh ký cũ quá hạn, đóng khi tạo lệnh mới",
          now: i.now,
        });
        if (!dong) throw new TuChoiLenhKy("DA_CO_LENH_SONG", "Hoá đơn này đang có một lệnh ký chưa kết thúc — xử lý hoặc huỷ lệnh đó trước.");
      }
      const moi = await tx.hoaDonLenhKy.create({
        data: {
          hoaDonId: i.hoaDonId,
          centerId: hd.centerId,
          orgUnitId: hd.orgUnitId,
          phuongThuc,
          trangThai: "CHO_KY",
          nguoiYeuCauId: i.nguoiYeuCauId,
          duLieuCanKyHash: i.duLieuCanKyHash,
          hetHanLuc,
          createdAt: i.now,
          updatedAt: i.now,
        },
        select: { id: true },
      });
      await writeAudit({
        tx,
        actor: i.nguoi,
        module: MODULE,
        entityType: ENTITY,
        entityId: moi.id,
        action: "TAO_LENH_KY_HOA_DON",
        newValues: { trangThai: "CHO_KY", hoaDonId: i.hoaDonId, phuongThuc, nguoiYeuCauId: i.nguoiYeuCauId },
        reason: "Tạo lệnh ký hoá đơn",
        orgUnitId: hd.orgUnitId ?? hd.centerId,
      });
      return { ok: true as const, id: moi.id, hetHanLuc };
    });
  } catch (e) {
    if (e instanceof TuChoiLenhKy) return loi(e);
    // Chỉ mục từng phần `HoaDonLenhKy_hoaDonId_song_key`: hai lượt tạo đồng thời — giao dịch đã hỏng nên bắt Ở NGOÀI.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, ma: "DA_CO_LENH_SONG", error: "Hoá đơn này vừa có một lệnh ký khác được tạo — tải lại để xem." };
    }
    throw e;
  }
}

// ── DUYỆT & BẮT ĐẦU KÝ ────────────────────────────────────────────────────

/**
 * CHO_KY → DANG_KY. Người bấm trở thành người ký (`nguoiKyId`). Cổng, theo thứ tự: quyền tại cơ sở → chuyển hợp lệ → còn hạn → tách nhiệm vụ theo
 * CHÍNH SÁCH CỦA CƠ SỞ LỆNH. Hai người cùng duyệt ⇒ đúng một thắng (ghi có điều kiện).
 */
export async function duyetVaBatDauKy(i: { actor: Actor; ten: string; lenhId: string; chinhSach: ChinhSachDuyetKy; now: Date }): Promise<KetQuaDuyetKy> {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.hoaDonLenhKy.findUnique({ where: { id: i.lenhId } });
      if (!row || !duocThaoTac(i.actor, row)) throw KHONG_THAY();
      if (!chuyenLenhKy(row.trangThai, "DANG_KY").ok) throw KHONG_CHUYEN_DUOC(row.trangThai, "DANG_KY");
      if (!laPhuongThucKy(row.phuongThuc)) throw new TuChoiLenhKy("DU_LIEU", "Phương thức ký của lệnh không hợp lệ.");
      if (daHetHan(row.hetHanLuc, i.now)) throw HET_HAN();
      const tach = kiemTachNhiemVu({
        chinhSach: i.chinhSach,
        centerId: row.centerId,
        phuongThuc: row.phuongThuc,
        nguoiYeuCau: row.nguoiYeuCauId,
        nguoiKy: i.actor.userId,
      });
      if (!tach.ok) throw new TuChoiLenhKy("TACH_NHIEM_VU", tach.lyDo);

      const dong = await chuyenCoDieuKien(tx, {
        row,
        tu: "CHO_KY",
        den: "DANG_KY",
        data: { nguoiKyId: i.actor.userId },
        nguoi: nguoiGhi(i.actor, i.ten),
        action: "DUYET_BAT_DAU_KY_HOA_DON",
        newValues: { nguoiKyId: i.actor.userId, canDuyet: canDuyet(i.chinhSach, row.centerId, row.phuongThuc) },
        reason: "Duyệt và bắt đầu ký",
        now: i.now,
      });
      if (!dong) throw DA_DOI();
      return { ok: true as const, id: row.id, trangThai: "DANG_KY" as const, nguoiKyId: i.actor.userId };
    });
  } catch (e) {
    if (e instanceof TuChoiLenhKy) return loi(e);
    throw e;
  }
}

// ── HOÀN TẤT / GHI LỖI KÝ ─────────────────────────────────────────────────

function logLoiBoKy(lenhId: string, e: unknown): void {
  // Chỉ TÊN lỗi: thông điệp của bộ ký có thể mang PIN / tên người / dữ liệu chứng thư.
  console.error(`[hoa-don-lenh-ky] bộ ký ném lỗi · lenhId=${lenhId} · ${e instanceof Error ? e.name : "NonError"}`);
}

/**
 * Giao dịch ngắn ghi KẾT QUẢ KÝ: DANG_KY → DA_KY (thành công) hoặc DANG_KY → LOI_KY (mã lỗi + lý do cố định). Đọc lại hàng và kiểm cổng cơ sở trong giao dịch.
 * Không trả đối tượng kết quả từ trong giao dịch (dựng ở ngoài); từ chối = ném.
 */
async function ghiKetQuaKy(i: { actor: Actor; ten: string; lenhId: string; ketQua: KetQuaKyDaChuanHoa; now: Date }): Promise<void> {
  return db.$transaction(async (tx) => {
    const row = await tx.hoaDonLenhKy.findUnique({ where: { id: i.lenhId } });
    if (!row || !duocThaoTac(i.actor, row)) throw KHONG_THAY();
    const kq = i.ketQua;
    const dong = kq.ok
      ? await chuyenCoDieuKien(tx, {
          row,
          tu: "DANG_KY",
          den: "DA_KY",
          data: {
            maGiaoDich: kq.maGiaoDich,
            chungThuHetHan: new Date(`${kq.chungThuHetHan}T00:00:00.000Z`),
            // Ai ký · lúc nào · bằng chứng thư nào: ghi cả trên lệnh lẫn nhật ký.
            kyLuc: i.now,
            ...(kq.chungThuSerial ? { chungThuSerial: kq.chungThuSerial } : {}),
          },
          nguoi: nguoiGhi(i.actor, i.ten),
          action: "HOAN_TAT_KY_HOA_DON",
          newValues: { nguoiKyId: row.nguoiKyId, kyLuc: i.now.toISOString(), ...(kq.chungThuSerial ? { chungThuSerial: kq.chungThuSerial } : {}) },
          reason: "Bộ ký hoàn tất",
          now: i.now,
        })
      : await chuyenCoDieuKien(tx, {
          row,
          tu: "DANG_KY",
          den: "LOI_KY",
          data: { lyDo: lyDoLoiKy(kq.ma) },
          nguoi: nguoiGhi(i.actor, i.ten),
          action: "LOI_KY_HOA_DON",
          newValues: { nguoiKyId: row.nguoiKyId, maLoi: kq.ma },
          reason: lyDoLoiKy(kq.ma),
          now: i.now,
        });
    if (!dong) throw DA_DOI();
  });
}

/** Cổng TRƯỚC khi gọi bộ ký / ghi lỗi: quyền tại cơ sở → đang DANG_KY → đúng người đã nhận ký. Trả hàng đã đọc. */
async function docLenhDangKy(actor: Actor, lenhId: string): Promise<DongLenh> {
  const row = await db.hoaDonLenhKy.findUnique({ where: { id: lenhId } });
  if (!row || !duocThaoTac(actor, row)) throw KHONG_THAY();
  if (!chuyenLenhKy(row.trangThai, "DA_KY").ok) throw KHONG_CHUYEN_DUOC(row.trangThai, "DA_KY");
  if (row.nguoiKyId !== actor.userId) throw new TuChoiLenhKy("KHONG_PHAI_NGUOI_KY", "Chỉ người đã nhận ký lệnh này mới hoàn tất được.");
  return row;
}

/**
 * Hoàn tất ký: DANG_KY → DA_KY qua `boKy`. Cổng (trước khi bộ ký được gọi): quyền tại cơ sở → đang DANG_KY → đúng người nhận ký → còn hạn → tách nhiệm vụ
 * (kiểm lại — chính sách có thể đã siết) → bộ ký đã nối. Bộ ký chạy NGOÀI giao dịch; ném / từ chối / trả sai khuôn ⇒ ghi LOI_KY với mã cố định.
 * Nếu lệnh bị đổi trong lúc ký (quét hết hạn…): KHÔNG ghi đè; trả `DA_DOI` kèm `maGiaoDichMoCoi` nếu bộ ký đã trả chữ ký.
 */
export async function hoanTatKy(i: { actor: Actor; ten: string; lenhId: string; boKy: BoKy; chinhSach: ChinhSachDuyetKy; now: Date }): Promise<KetQuaHoanTatKy> {
  // Mã giao dịch CHỮ KÝ ĐÃ CÓ nhưng chưa chắc ghi được: giữ ngoài `try` để nhánh lỗi còn đọc được.
  let maDaKy: string | null = null;
  try {
    const row = await docLenhDangKy(i.actor, i.lenhId);
    if (daHetHan(row.hetHanLuc, i.now)) throw HET_HAN();
    const tach = kiemTachNhiemVu({
      chinhSach: i.chinhSach,
      centerId: row.centerId,
      phuongThuc: row.phuongThuc,
      nguoiYeuCau: row.nguoiYeuCauId,
      nguoiKy: i.actor.userId,
    });
    if (!tach.ok) throw new TuChoiLenhKy("TACH_NHIEM_VU", tach.lyDo);
    if (!duocPhepKy(i.boKy)) throw new TuChoiLenhKy("CHUA_NOI_BO_KY", "Bộ ký này chưa được nối vào hệ thống — chưa thể ký.");

    let ketQua: KetQuaKyDaChuanHoa;
    try {
      ketQua = chuanHoaKetQuaKy(await i.boKy.ky(row.duLieuCanKyHash));
    } catch (e) {
      logLoiBoKy(row.id, e);
      ketQua = { ok: false, ma: "NEM_LOI" };
    }
    if (ketQua.ok) maDaKy = ketQua.maGiaoDich;
    await ghiKetQuaKy({ actor: i.actor, ten: i.ten, lenhId: row.id, ketQua, now: i.now });
    if (ketQua.ok) return { ok: true, id: row.id, trangThai: "DA_KY", maGiaoDich: ketQua.maGiaoDich };
    // Báo kế toán đúng cơ sở NGAY (hợp đồng đợt 2 §6) — sau khi giao dịch đã commit, không bao giờ ném, tắt khi cờ Hub / cơ sở thí điểm tắt.
    await baoNgoaiLeTucThoi({ hoaDonId: row.hoaDonId, loai: "LOI_KY", khoa: row.id, now: i.now });
    return { ok: false, ma: "LOI_KY", error: lyDoLoiKy(ketQua.ma), trangThai: "LOI_KY" };
  } catch (e) {
    if (e instanceof TuChoiLenhKy) return { ...loi(e), ...(maDaKy !== null ? { maGiaoDichMoCoi: maDaKy } : {}) };
    throw e;
  }
}

/** Ghi lỗi ký chủ động (vd bộ ký ngoài báo lỗi qua kênh khác): DANG_KY → LOI_KY với mã lỗi liệt kê sẵn; mã lạ ⇒ KHONG_RO. Cùng cổng với `hoanTatKy`. */
export async function ghiLoiKy(i: { actor: Actor; ten: string; lenhId: string; maLoi: MaLoiKy; now: Date }): Promise<KetQuaGhiLoiKy> {
  try {
    const row = await docLenhDangKy(i.actor, i.lenhId);
    const ma: MaLoiKy = (MA_LOI_KY as readonly string[]).includes(i.maLoi) ? i.maLoi : "KHONG_RO";
    await ghiKetQuaKy({ actor: i.actor, ten: i.ten, lenhId: row.id, ketQua: { ok: false, ma }, now: i.now });
    await baoNgoaiLeTucThoi({ hoaDonId: row.hoaDonId, loai: "LOI_KY", khoa: row.id, now: i.now });
    return { ok: true, id: row.id, trangThai: "LOI_KY" };
  } catch (e) {
    if (e instanceof TuChoiLenhKy) return loi(e);
    throw e;
  }
}

// ── HUỶ ───────────────────────────────────────────────────────────────────

/** Huỷ lệnh CHƯA bắt đầu ký (CHO_KY → HUY). Lý do 10–500 ký tự. DANG_KY không huỷ được (bộ ký có thể đang chạy) — lệnh kẹt thì chờ HET_HAN. */
export async function huyLenhKy(i: { actor: Actor; ten: string; lenhId: string; lyDo: string; now: Date }): Promise<KetQuaHuyLenh> {
  const lyDo = i.lyDo.trim();
  if (lyDo.length < TOI_THIEU_LY_DO_HUY) return { ok: false, ma: "LY_DO", error: `Ghi lý do ít nhất ${TOI_THIEU_LY_DO_HUY} ký tự (đang có ${lyDo.length}).` };
  if (lyDo.length > TOI_DA_LY_DO_HUY) return { ok: false, ma: "LY_DO", error: `Lý do tối đa ${TOI_DA_LY_DO_HUY} ký tự.` };
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.hoaDonLenhKy.findUnique({ where: { id: i.lenhId } });
      if (!row || !duocThaoTac(i.actor, row)) throw KHONG_THAY();
      if (!chuyenLenhKy(row.trangThai, "HUY").ok) throw KHONG_CHUYEN_DUOC(row.trangThai, "HUY");
      const dong = await chuyenCoDieuKien(tx, {
        row,
        tu: "CHO_KY",
        den: "HUY",
        data: { lyDo },
        nguoi: nguoiGhi(i.actor, i.ten),
        action: "HUY_LENH_KY_HOA_DON",
        newValues: {},
        reason: lyDo,
        now: i.now,
      });
      if (!dong) throw DA_DOI();
      return { ok: true as const, id: row.id, trangThai: "HUY" as const };
    });
  } catch (e) {
    if (e instanceof TuChoiLenhKy) return loi(e);
    throw e;
  }
}

// ── QUÉT HẾT HẠN ──────────────────────────────────────────────────────────

/**
 * Đóng các lệnh SỐNG (CHO_KY / DANG_KY) đã quá hạn → HET_HAN, kèm audit "Hệ thống". Lệnh không có hạn (hàng chèn tay) cũng bị đóng. `phamVi` BẮT BUỘC, không mặc định:
 * cron truyền "ALL", người dùng truyền `phamViKeToan(actor)`; danh sách rỗng ⇒ không đụng gì. Mỗi lệnh một giao dịch ngắn, có điều kiện — lệnh vừa được ký / huỷ giữa chừng bị bỏ qua.
 */
export async function quetHetHan(i: { now: Date; phamVi: "ALL" | readonly string[] }): Promise<{ soLenh: number }> {
  if (i.phamVi !== "ALL" && i.phamVi.length === 0) return { soLenh: 0 };
  const quaHan: Prisma.HoaDonLenhKyWhereInput = { OR: [{ hetHanLuc: null }, { hetHanLuc: { lte: i.now } }] };
  const ungVien = await db.hoaDonLenhKy.findMany({
    where: { ...(i.phamVi === "ALL" ? {} : { centerId: { in: [...i.phamVi] } }), trangThai: { in: [...TRANG_THAI_SONG] }, ...quaHan },
    orderBy: { id: "asc" },
    take: TOI_DA_MOI_LAN_QUET,
  });
  let soLenh = 0;
  for (const row of ungVien) {
    const dong = await db.$transaction((tx) =>
      chuyenCoDieuKien(tx, {
        row,
        tu: row.trangThai as TrangThaiLenhKy,
        den: "HET_HAN",
        data: {},
        them: quaHan,
        nguoi: HE_THONG,
        action: "HET_HAN_LENH_KY_HOA_DON",
        newValues: {},
        reason: "Lệnh ký quá hạn",
        now: i.now,
      }),
    );
    if (dong) soLenh += 1;
  }
  return { soLenh };
}
