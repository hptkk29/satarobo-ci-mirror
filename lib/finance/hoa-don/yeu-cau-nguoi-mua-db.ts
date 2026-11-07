import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { TOI_THIEU_LY_DO_HOA_DON } from "./trang-thai-hoa-don";
import {
  O_NGUOI_MUA,
  chuanHoaO,
  docDuLieuLuu,
  duocXuLyYeuCau,
  dungDuLieuLuu,
  hopNhatTheoO,
  kiemBoDayDu,
  kiemGioiHan,
  kiemODon,
  phamViXuLyYeuCau,
  quyetDinhMo,
  sauTokenSai,
  tinhHetHan,
  type BangO,
  type DauVaoO,
  type GioiHanChongDoan,
  type NguoiMuaToiGian,
  type NguonO,
  type OKhoa,
} from "./yeu-cau-nguoi-mua";
import { MAU_ID_YEU_CAU, bamToken, ghepMaLienKet, giaTriGocHash, sinhToken, soKhopHash } from "./yeu-cau-nguoi-mua-token";
import { cotDonTuPhuHuynh, dienSanTuForm } from "./yeu-cau-nguoi-mua-ghi-don";
import { CHON_DON_CHO_FORM, docHieuLucNguoiMuaTuDb } from "./ghi-nguoi-mua";

// lib/finance/hoa-don/yeu-cau-nguoi-mua-db.ts — DỊCH VỤ "YÊU CẦU THU THẬP THÔNG TIN NGƯỜI MUA" (Invoice Hub đợt 2, S11 phần độc lập). Luật nằm ở
// `yeu-cau-nguoi-mua.ts` (thuần, có test); tệp này nối với Postgres. KHÔNG có route công khai / UI ở đây — nối dây là việc của lead, còn chặn bởi OD-11 (pháp lý).
//
// Vòng đời (CHECK của bảng chỉ cho: DANG_MO · DA_GUI · DA_AP_DUNG · TU_CHOI · HET_HAN · THU_HOI):
//   DANG_MO ──xacNhanYeuCau──▶ DA_AP_DUNG        (dữ liệu đã hợp nhất nằm trong CHÍNH yêu cầu; việc chép sang `Order.invoice*` là của lead)
//           ──huyYeuCau──────▶ THU_HOI
//           ──quetHetHan─────▶ HET_HAN           (CHỈ khi phụ huynh CHƯA gửi — xem dưới)
// ⚠️ Phụ huynh gửi dữ liệu KHÔNG đổi trạng thái (vẫn DANG_MO, chỉ ghi `guiLuc`): chỉ mục từng phần UNIQUE(orderId) WHERE trangThai = 'DANG_MO' là thứ bảo đảm
//    "mỗi đơn tối đa MỘT yêu cầu mở" — chuyển sang DA_GUI sẽ NHẢ khoá đó khi nhân viên chưa xác nhận. `DA_GUI` / `TU_CHOI` không dùng ở dịch vụ này.
// ⚠️ TTL là hạn của LIÊN KẾT CÔNG KHAI (mở / gửi), không phải hạn của nhân viên: nhân viên nhập thay / xác nhận / huỷ khi yêu cầu còn DANG_MO kể cả đã quá hạn.
//    `quetHetHan` chỉ đóng yêu cầu quá hạn mà phụ huynh CHƯA GỬI gì — nếu đã gửi thì dữ liệu của họ đang chờ xử lý, không được lặng lẽ biến thành HET_HAN (rồi bị xoá).
// ⚠️ XÁC NHẬN VÀ GHI VÀO ĐƠN LÀ HAI VIỆC: `xacNhanYeuCau` tự bọc giao dịch, KHÔNG ghi `Order`. Đường gọi muốn chép `Order.invoice*` phải dùng `xacNhanYeuCauTrongTx(tx, …)` và ghi đơn
//    TRONG CÙNG giao dịch — nếu không, sập giữa hai bước để lại "yêu cầu đã áp dụng mà đơn chưa đổi" và không còn đường xác nhận lại (trạng thái đã đóng).
// ✅ [ĐÃ QUYẾT 03/11/2026 — chủ dự án: «ai ghi sau thì thắng, lỡ PH ghi sai và nhờ Sale sửa thì sửa được»] Trước đây PH luôn thắng và dữ liệu PH chỉ vào đơn khi nhân viên bấm «Áp dụng».
//    NAY phụ huynh gửi xong là dữ liệu vào ĐƠN ngay, trong CÙNG giao dịch (`cotDonTuPhuHuynh`), và CHỈ các ô PH thật sự ĐỔI so với bản điền sẵn (`banDau`, client gửi lên) — nên PH gửi lại nguyên
//    giá trị điền sẵn cũ không đè lên chỉnh sửa của Sale làm giữa chừng. ĐƠN là kho dữ liệu duy nhất; `duLieuGui` chỉ còn là bản ghi «PH đã gửi gì, lúc nào». Bước «Áp dụng vào đơn»
//    (`yeu-cau-nguoi-mua-ap-dung-db.ts`) không còn nút nào gọi; yêu cầu vẫn DANG_MO sau khi PH gửi để PH gửi lại được (ghi đè lần trước) tới hết hạn liên kết.
//    Đơn đang có hoá đơn DANG_PHAT_HANH ⇒ KHÔNG ghi vào đơn (đổi người mua giữa lúc nhà cung cấp phát hành là tạo bản lệch); dữ liệu PH vẫn nằm trên yêu cầu và nhật ký nói rõ.
// ⚠️ Thời hạn giữ dữ liệu (OD-11) còn mở: `quetHetHan` nhận `choXuLyToiDaNgay` (số ngày yêu cầu ĐÃ GỬI mà không ai xử lý thì tự đóng; `null` = không bao giờ) và `giuDuLieuNgay` (xoá
//    `duLieuGui` của yêu cầu đã đóng) — cả hai BẮT BUỘC, không mặc định.
//
// Quyết định thiết kế — CHỐNG ĐOÁN:
//   Đường công khai không có actor và token thô không tra được yêu cầu (DB chỉ có hash) ⇒ không biết "token sai này thuộc yêu cầu nào" nếu chỉ nhận token.
//   Nên liên kết = `<id yêu cầu>.<token>` (`ghepMaLienKet`). Id không phải bí mật; token 256 bit mới là bí mật. Token sai ⇒ đếm trên yêu cầu mang id đó, quá N ⇒ KHOÁ cứng ở DB
//   (`khoaDen`). Id lạ ⇒ không có gì để đếm: kẻ dò id ngẫu nhiên bị chặn ở tầng route (rate-limit theo IP — việc của lead), còn mỗi yêu cầu thật thì không dò được token.
//   Mọi lý do từ chối trước khi token ĐÚNG (id lạ, token sai, đang khoá) đều trả MỘT mã `KHONG_HOP_LE` — không lộ yêu cầu có tồn tại / đang khoá hay không.
//   Đang khoá thì token ĐÚNG cũng bị chặn tới `khoaDen` (nếu không, khoá không có nghĩa); nhân viên huỷ + cấp lại nếu phụ huynh bị khoá oan.
//
// Luật bất di bất dịch:
//  · Mọi thao tác của NHÂN VIÊN nhận `actor` BẮT BUỘC (luật 7) và tự kiểm trên dòng ĐỌC LẠI TỪ DB: `phamViXuLyYeuCau` (kế toán `payments:confirm` HOẶC sale `payments:record` ∧ `orders:view-pii`).
//    Yêu cầu của cơ sở khác ⇒ "không có quyền" (không phân biệt với "không tìm thấy" — cô lập cơ sở tuyệt đối). Mọi `updateMany` mang `centerId` của chính dòng.
//  · `scopedDb` KHÔNG che ghi; đường đọc của nhân viên lọc `centerId ∈ phạm vi` ngay trong `where`.
//  · Từ chối trong `$transaction` = `throw`, cổng đứng TRƯỚC phép ghi đầu tiên. NGOẠI LỆ CÓ CHỦ ĐÍCH duy nhất: token SAI ghi bộ đếm rồi COMMIT (phải sống sót — nếu ném thì rollback và
//    kẻ đoán được thử vô hạn). Nhánh đó trả `{ sai: true }`, không ném.
//  · Mọi chuyển trạng thái là `updateMany` CÓ ĐIỀU KIỆN (`trangThai`), ghi `updatedAt = now` (đồng hồ truyền vào), kèm AuditLog TRONG CÙNG giao dịch. Khoá tư vấn theo id yêu cầu
//    tuần tự hoá đọc-sửa-ghi của ô dữ liệu (Sale nhập thay ∥ phụ huynh gửi); điều kiện `trangThai` là lớp thứ hai.
//  · AuditLog KHÔNG chứa token, hash token, hay GIÁ TRỊ của ô — chỉ id, trạng thái, TÊN các ô đã đổi / xung đột. Không có `console.*` nào trong tệp này.
//  · Không ghi `Order` / `HoaDonDienTu` / `Payment`. Duy nhất bảng `HoaDonYeuCauNguoiMua` (+ AuditLog).

const ENTITY = "HoaDonYeuCauNguoiMua";
const MODULE = "hoa-don";
const NGUOI_PH = { id: null, name: "Phụ huynh (liên kết QR)" } as const;
const NGUOI_HE_THONG = { id: null, name: "Hệ thống" } as const;
type Tx = Prisma.TransactionClient;

export type MaLoi =
  | "KHONG_CO_QUYEN"
  | "DA_CO_YEU_CAU_MO"
  | "KHONG_HOP_LE"
  | "HET_HAN"
  | "DA_DONG"
  | "KHOA"
  | "VUOT_SO_LAN_MO"
  | "DU_LIEU_SAI"
  | "KHONG_CO_DU_LIEU"
  | "THIEU_THONG_TIN"
  | "LY_DO_NGAN"
  /** Bước áp dụng vào đơn (`yeu-cau-nguoi-mua-ap-dung-db.ts`): đơn bị sửa sau khi tạo yêu cầu / hoá đơn đang phát hành. */
  | "DON_DA_DOI"
  | "HOA_DON_DANG_PHAT_HANH";
export type Loi = { ok: false; ma: MaLoi; error: string; /** Chỉ có ở `DU_LIEU_SAI`: lý do theo ô. */ loiTheoO?: Partial<Record<OKhoa, string>> };

/** Từ chối nghiệp vụ trong transaction ⇒ NÉM (return không rollback — CLAUDE.md "Luật rollback"). Bắt ngoài `$transaction`. */
export class TuChoi extends Error {
  constructor(
    readonly ma: MaLoi,
    thongDiep: string,
    readonly loiTheoO?: Partial<Record<OKhoa, string>>,
  ) {
    super(thongDiep);
  }
}
/** Dịch một `TuChoi` bắt được NGOÀI `$transaction` thành kết quả `Loi` (cho đường gọi tự bọc giao dịch quanh `xacNhanYeuCauTrongTx`). */
export const sangLoi = (e: TuChoi): Loi => ({ ok: false, ma: e.ma, error: e.message, ...(e.loiTheoO ? { loiTheoO: e.loiTheoO } : {}) });

const CHON_NHAN_VIEN = {
  id: true,
  centerId: true,
  orderId: true,
  phamVi: true,
  trangThai: true,
  hetHanLuc: true,
  soLanMo: true,
  soLanSai: true,
  khoaDen: true,
  duLieuGui: true,
  guiLuc: true,
} as const;
/** Chỉ đường CÔNG KHAI mới đọc `tokenHash` — nhân viên không bao giờ cần. */
const CHON_CONG_KHAI = { ...CHON_NHAN_VIEN, tokenHash: true } as const;

const khoaTuVan = (tx: Tx, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`hoa-don-yeu-cau-nguoi-mua:${id}`}))`;

/** Đọc yêu cầu trong tầm quyền của nhân viên: `centerId ∈ phạm vi` nằm NGAY trong `where`. Ngoài tầm ⇒ `null` (cùng kết quả với không tồn tại). */
async function timChoNhanVien(tx: Tx, actor: Actor, id: string) {
  const pv = phamViXuLyYeuCau(actor);
  if (pv !== "ALL" && pv.length === 0) return null;
  const row = await tx.hoaDonYeuCauNguoiMua.findFirst({ where: { id, ...(pv === "ALL" ? {} : { centerId: { in: pv } }) }, select: CHON_NHAN_VIEN });
  return row !== null && duocXuLyYeuCau(actor, row.centerId) ? row : null;
}
const KHONG_QUYEN = () => new TuChoi("KHONG_CO_QUYEN", "Không có quyền với yêu cầu này (hoặc không tìm thấy).");

/** Ô đầu vào → bộ ô đã chuẩn hoá, hoặc `TuChoi`. Chạy TRƯỚC mọi truy cập DB. */
function kiemDauVao(du: DauVaoO): DauVaoO {
  const ra: DauVaoO = {};
  const loi: Partial<Record<OKhoa, string>> = {};
  for (const o of O_NGUOI_MUA) {
    if (chuanHoaO(o, du[o]) === "") continue;
    const r = kiemODon(o, du[o]);
    if (r.ok) ra[o] = r.giaTri;
    else loi[o] = r.loi;
  }
  if (Object.keys(loi).length > 0) throw new TuChoi("DU_LIEU_SAI", "Có ô chưa hợp lệ.", loi);
  if (Object.keys(ra).length === 0) throw new TuChoi("KHONG_CO_DU_LIEU", "Chưa có ô nào được điền.");
  return ra;
}

const luuJson = (b: BangO) => dungDuLieuLuu(b) as unknown as Prisma.InputJsonValue;
const tenOXungDot = (x: readonly { o: OKhoa }[]) => x.map((y) => y.o);

// ── TẠO ──────────────────────────────────────────────────────────────────────

export type KetQuaTao = { ok: true; id: string; /** Token THÔ — trả đúng MỘT lần, không lưu ở đâu. */ token: string; maLienKet: string; hetHanLuc: Date } | Loi;

/**
 * Nhân viên tạo yêu cầu cho một đơn. `ttlPhut` BẮT BUỘC (cấu hình, mặc định 4 giờ nằm ở `TTL_MAC_DINH_PHUT`); sai ⇒ ném RangeError trước mọi truy vấn.
 * Cơ sở = cơ sở của ĐƠN đọc từ DB. Mỗi đơn tối đa một yêu cầu mở: chỉ mục từng phần ở DB là trọng tài (P2002 ⇒ `DA_CO_YEU_CAU_MO`) — không có "kiểm trước rồi ghi" để đua.
 */
export async function taoYeuCau(input: {
  actor: Actor;
  nguoi: { id: string; name: string };
  orderId: string;
  phamVi: "DON" | "HOA_DON";
  ttlPhut: number;
  now: Date;
}): Promise<KetQuaTao> {
  const hetHanLuc = tinhHetHan(input.now, input.ttlPhut);
  const pv = phamViXuLyYeuCau(input.actor);
  if (pv !== "ALL" && pv.length === 0) return sangLoi(KHONG_QUYEN());
  const don = await db.order.findFirst({
    where: { id: input.orderId, ...(pv === "ALL" ? {} : { centerId: { in: pv } }) },
    // Đủ MỌI cột trong `COT_GOC` (băm lúc tạo, so lúc áp dụng) — thiếu cột nào là cột đó không bao giờ báo «đơn đã được sửa».
    select: {
      id: true,
      centerId: true,
      invoiceBuyerName: true,
      invoiceCompanyName: true,
      invoiceTaxCode: true,
      invoiceEmail: true,
      customerCccd: true,
      invoiceParentPhone: true,
      invoiceStudentName: true,
      invoiceStudentCccd: true,
    },
  });
  if (!don || !duocXuLyYeuCau(input.actor, don.centerId)) return sangLoi(KHONG_QUYEN());
  const centerId = don.centerId as string; // `duocXuLyYeuCau` đã bảo đảm khác null

  const id = randomUUID();
  const token = sinhToken();
  try {
    await db.$transaction(async (tx) => {
      await tx.hoaDonYeuCauNguoiMua.create({
        data: {
          id,
          centerId,
          orderId: don.id,
          phamVi: input.phamVi,
          tokenHash: bamToken(token),
          trangThai: "DANG_MO",
          hetHanLuc,
          soLanMo: 0,
          soLanSai: 0,
          giaTriGocHash: giaTriGocHash(id, don),
          taoBoiId: input.nguoi.id,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      await writeAudit({
        tx,
        actor: input.nguoi,
        module: MODULE,
        entityType: ENTITY,
        entityId: id,
        action: "TAO_YEU_CAU_NGUOI_MUA",
        oldValues: null,
        newValues: { trangThai: "DANG_MO", phamVi: input.phamVi, orderId: don.id, hetHanLuc: hetHanLuc.toISOString() },
        orgUnitId: centerId,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && /orderId|_mo_key/.test(JSON.stringify(e.meta ?? {}))) {
      return { ok: false, ma: "DA_CO_YEU_CAU_MO", error: "Đơn này đã có một yêu cầu đang mở — huỷ yêu cầu cũ trước khi cấp mới." };
    }
    throw e;
  }
  return { ok: true, id, token, maLienKet: ghepMaLienKet(id, token), hetHanLuc };
}

// ── ĐƯỜNG CÔNG KHAI (không actor) ────────────────────────────────────────────

type HangCongKhai = Prisma.HoaDonYeuCauNguoiMuaGetPayload<{ select: typeof CHON_CONG_KHAI }>;

/**
 * Xác thực token trong transaction (đã giữ khoá tư vấn). Token SAI ⇒ ghi bộ đếm (+ khoá nếu tới ngưỡng) rồi trả `{ sai: true }` — KHÔNG ném, để phép ghi commit.
 * Token ĐÚNG ⇒ qua `quyetDinhMo`; không cho phép ⇒ ném (TRƯỚC mọi phép ghi của đường chính).
 */
async function xacThuc(
  tx: Tx,
  row: HangCongKhai,
  token: string,
  g: GioiHanChongDoan,
  now: Date,
  dem: "MO" | "GUI",
): Promise<{ sai: true } | { sai: false }> {
  if (!soKhopHash(row.tokenHash, token)) {
    if (row.trangThai === "DANG_MO") {
      const kq = sauTokenSai(row, now, g);
      if (kq.tang) {
        const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
          where: { id: row.id, centerId: row.centerId, trangThai: "DANG_MO", soLanSai: row.soLanSai },
          data: { soLanSai: kq.soLanSaiMoi, khoaDen: kq.khoaDenMoi, updatedAt: now },
        });
        if (upd.count === 1 && kq.khoaDenMoi !== null) {
          await writeAudit({
            tx,
            actor: NGUOI_PH,
            module: MODULE,
            entityType: ENTITY,
            entityId: row.id,
            action: "KHOA_YEU_CAU_NGUOI_MUA",
            oldValues: { trangThai: row.trangThai },
            newValues: { trangThai: row.trangThai, soLanSai: kq.soLanSaiMoi, khoaDen: kq.khoaDenMoi.toISOString() },
            changedFields: ["soLanSai", "khoaDen"],
            orgUnitId: row.centerId,
          });
        }
      }
    }
    return { sai: true };
  }
  const qd = quyetDinhMo(row, now, g, dem);
  if (qd === "DA_DONG") throw new TuChoi("DA_DONG", "Liên kết này đã được đóng.");
  if (qd === "HET_HAN") throw new TuChoi("HET_HAN", "Liên kết đã hết hạn.");
  if (qd === "KHOA") throw new TuChoi("KHOA", "Liên kết đang tạm khoá.");
  if (qd === "VUOT_SO_LAN_MO") throw new TuChoi("VUOT_SO_LAN_MO", "Liên kết đã được mở quá số lần cho phép.");
  return { sai: false };
}

const KHONG_HOP_LE = (): Loi => ({ ok: false, ma: "KHONG_HOP_LE", error: "Liên kết không hợp lệ." });

/** Tìm tay cầm (id → centerId) ngoài giao dịch: không có ⇒ không có gì để đếm, và không tốn khoá. Id sai hình dạng ⇒ coi như lạ. */
async function timTayCam(id: string): Promise<{ id: string; centerId: string } | null> {
  if (typeof id !== "string" || !MAU_ID_YEU_CAU.test(id)) return null;
  return db.hoaDonYeuCauNguoiMua.findUnique({ where: { id }, select: { id: true, centerId: true } });
}

/** Bản điền sẵn của một đơn. Lỗi đọc ⇒ `{}`: trang vẫn mở, phụ huynh tự điền — điền sẵn là tiện ích, không phải cổng. Không log (lỗi Prisma có thể chứa giá trị). */
async function docDienSan(orderId: string, centerId: string): Promise<DauVaoO> {
  try {
    const don = await db.order.findFirst({
      where: { id: orderId, centerId },
      select: CHON_DON_CHO_FORM,
    });
    if (!don) return {};
    return dienSanTuForm((await docHieuLucNguoiMuaTuDb(don)).hieuLuc.form);
  } catch {
    return {};
  }
}

export type KetQuaMo = {
  ok: true;
  yeuCau: {
    id: string;
    phamVi: string;
    hetHanLuc: Date;
    /** Những gì PH đã gửi trước đó (bản ghi của yêu cầu). KHÔNG dùng để điền sẵn — xem `dienSan`. */
    o: BangO;
    /** Bản ĐIỀN SẴN cho trang công khai: giá trị hiệu lực của đơn → hồ sơ học viên → phiếu lead, không có hai ô CCCD (`dienSanTuForm`). Đọc lỗi ⇒ `{}` (form vẫn mở, PH tự điền). */
    dienSan: DauVaoO;
  };
} | Loi;

/**
 * Phụ huynh mở liên kết. Token sai / id lạ / đang khoá ⇒ MỘT mã `KHONG_HOP_LE`. Token đúng ⇒ tăng `soLanMo`, xoá bộ đếm sai, trả bản điền sẵn từ đơn / hồ sơ (để PH chỉ sửa chỗ sai).
 * Điền sẵn đọc SAU khi giao dịch xác thực commit và CHỈ khi token đúng — token sai không bao giờ chạm tới dữ liệu đơn.
 */
export async function moBangToken(input: { id: string; token: string; gioiHan: GioiHanChongDoan; now: Date }): Promise<KetQuaMo> {
  kiemGioiHan(input.gioiHan);
  const tayCam = await timTayCam(input.id);
  if (!tayCam) return KHONG_HOP_LE();
  try {
    const kq = await db.$transaction(async (tx) => {
      await khoaTuVan(tx, tayCam.id);
      const row = await tx.hoaDonYeuCauNguoiMua.findFirst({ where: { id: tayCam.id, centerId: tayCam.centerId }, select: CHON_CONG_KHAI });
      if (!row) throw new TuChoi("KHONG_HOP_LE", "Liên kết không hợp lệ.");
      const xt = await xacThuc(tx, row, input.token, input.gioiHan, input.now, "MO");
      if (xt.sai) return { sai: true } as const;
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: {
          id: row.id,
          centerId: row.centerId,
          trangThai: "DANG_MO",
          hetHanLuc: { gt: input.now },
          soLanMo: { lt: input.gioiHan.toiDaLanMo },
          OR: [{ khoaDen: null }, { khoaDen: { lte: input.now } }],
        },
        data: { soLanMo: { increment: 1 }, soLanSai: 0, khoaDen: null, updatedAt: input.now },
      });
      if (upd.count !== 1) throw new TuChoi("DA_DONG", "Liên kết này không còn mở được.");
      return { sai: false, orderId: row.orderId, centerId: row.centerId, yeuCau: { id: row.id, phamVi: row.phamVi, hetHanLuc: row.hetHanLuc, o: docDuLieuLuu(row.duLieuGui) } } as const;
    });
    if (kq.sai) return KHONG_HOP_LE();
    return { ok: true, yeuCau: { ...kq.yeuCau, dienSan: await docDienSan(kq.orderId, kq.centerId) } };
  } catch (e) {
    if (e instanceof TuChoi) return e.ma === "KHONG_HOP_LE" ? KHONG_HOP_LE() : sangLoi(e);
    throw e;
  }
}

/**
 * `ghiVaoDon` (chỉ đường PH gửi): `DA_GHI` = có cột của đơn được ghi · `KHONG_DOI` = PH không đổi ô nào so với bản điền sẵn nên đơn không bị đụng ·
 * `HOA_DON_DANG_PHAT_HANH` = đơn đang phát hành hoá đơn nên KHÔNG ghi (dữ liệu PH vẫn nằm trên yêu cầu).
 */
/**
 * Ghi các ô PH đã ĐỔI vào đơn (xem đầu tệp). Chạy TRONG giao dịch của lượt gửi, SAU các cổng và SAU phép ghi yêu cầu: từ chối = NÉM (rollback cả lượt gửi), không `return` từ chối sau phép ghi.
 * Mọi cột đứng cạnh `centerId` của chính yêu cầu. Nhật ký của đơn chỉ nêu TÊN cột (không giá trị — tên, SĐT, CCCD là PII).
 */
async function ghiVaoDonTrongTx(tx: Tx, row: { id: string; orderId: string; centerId: string }, du: DauVaoO, banDau: DauVaoO): Promise<"DA_GHI" | "KHONG_DOI" | "HOA_DON_DANG_PHAT_HANH"> {
  const cot = cotDonTuPhuHuynh(du, banDau);
  const tenCot = Object.keys(cot);
  if (tenCot.length === 0) return "KHONG_DOI";
  const don = await tx.order.findFirst({
    where: { id: row.orderId, centerId: row.centerId },
    select: { id: true, hoaDonDienTu: { where: { trangThai: "DANG_PHAT_HANH" }, select: { id: true }, take: 1 } },
  });
  if (!don) throw new TuChoi("KHONG_HOP_LE", "Liên kết không hợp lệ.");
  if (don.hoaDonDienTu.length > 0) return "HOA_DON_DANG_PHAT_HANH";
  const upd = await tx.order.updateMany({ where: { id: don.id, centerId: row.centerId }, data: cot });
  if (upd.count !== 1) throw new TuChoi("KHONG_HOP_LE", "Liên kết không hợp lệ.");
  await writeAudit({
    tx,
    actor: NGUOI_PH,
    module: "orders",
    entityType: "Order",
    entityId: don.id,
    action: "PHU_HUYNH_GHI_THONG_TIN_NGUOI_MUA",
    oldValues: { yeuCauId: row.id },
    newValues: { yeuCauId: row.id, cotDaGhi: tenCot },
    changedFields: tenCot,
    orgUnitId: row.centerId,
  });
  return "DA_GHI";
}

export type KetQuaGhiO = { ok: true; oDaDoi: OKhoa[]; oXungDot: OKhoa[]; ghiVaoDon?: "DA_GHI" | "KHONG_DOI" | "HOA_DON_DANG_PHAT_HANH" } | Loi;

/**
 * Phụ huynh gửi dữ liệu. Kiểm từng ô TRƯỚC khi chạm DB; xác thực token như `moBangToken` (không tính vào số lần mở); ghi bản ghi `duLieuGui` (ai ghi sau thắng) VÀ — cùng giao dịch —
 * GHI THẲNG vào đơn các ô PH đã đổi so với `banDau` (xem đầu tệp). `banDau` BẮT BUỘC (luật 7): `{}` = «không có bản điền sẵn», mọi ô PH gửi đều tính là đổi.
 * Trạng thái vẫn `DANG_MO` (xem đầu tệp); ghi `guiLuc`. `donY` = phiên bản điều khoản + giờ máy chủ (`null` ⇒ không ghi đồng ý).
 */
export async function guiThongTinPhuHuynh(input: {
  id: string;
  token: string;
  gioiHan: GioiHanChongDoan;
  du: DauVaoO;
  banDau: DauVaoO;
  donY: { phienBanDieuKhoan: string } | null;
  now: Date;
}): Promise<KetQuaGhiO> {
  kiemGioiHan(input.gioiHan);
  try {
    const du = kiemDauVao(input.du);
    const tayCam = await timTayCam(input.id);
    if (!tayCam) return KHONG_HOP_LE();
    const kq = await db.$transaction(async (tx) => {
      await khoaTuVan(tx, tayCam.id);
      const row = await tx.hoaDonYeuCauNguoiMua.findFirst({ where: { id: tayCam.id, centerId: tayCam.centerId }, select: CHON_CONG_KHAI });
      if (!row) throw new TuChoi("KHONG_HOP_LE", "Liên kết không hợp lệ.");
      const xt = await xacThuc(tx, row, input.token, input.gioiHan, input.now, "GUI");
      if (xt.sai) return { sai: true } as const;
      const hn = hopNhatTheoO(docDuLieuLuu(row.duLieuGui), du, "PHU_HUYNH", input.now);
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: { id: row.id, centerId: row.centerId, trangThai: "DANG_MO", hetHanLuc: { gt: input.now }, OR: [{ khoaDen: null }, { khoaDen: { lte: input.now } }] },
        data: {
          duLieuGui: luuJson(hn.ketQua),
          guiLuc: input.now,
          soLanSai: 0,
          khoaDen: null,
          updatedAt: input.now,
          ...(input.donY ? { donY: { phienBanDieuKhoan: input.donY.phienBanDieuKhoan, luc: input.now.toISOString() } } : {}),
        },
      });
      if (upd.count !== 1) throw new TuChoi("DA_DONG", "Liên kết này không còn nhận dữ liệu.");
      await writeAudit({
        tx,
        actor: NGUOI_PH,
        module: MODULE,
        entityType: ENTITY,
        entityId: row.id,
        action: "PHU_HUYNH_GUI_THONG_TIN_NGUOI_MUA",
        oldValues: { trangThai: row.trangThai },
        newValues: { trangThai: "DANG_MO", oDaDoi: hn.oDaDoi, oXungDot: tenOXungDot(hn.oXungDot) },
        changedFields: ["duLieuGui"],
        orgUnitId: row.centerId,
      });
      const ghiVaoDon = await ghiVaoDonTrongTx(tx, row, input.du, input.banDau);
      return { sai: false, oDaDoi: hn.oDaDoi, oXungDot: tenOXungDot(hn.oXungDot), ghiVaoDon } as const;
    });
    return kq.sai ? KHONG_HOP_LE() : { ok: true, oDaDoi: kq.oDaDoi, oXungDot: kq.oXungDot, ghiVaoDon: kq.ghiVaoDon };
  } catch (e) {
    if (e instanceof TuChoi) return e.ma === "KHONG_HOP_LE" ? KHONG_HOP_LE() : sangLoi(e);
    throw e;
  }
}

// ── NHÂN VIÊN ────────────────────────────────────────────────────────────────

/**
 * Sale / kế toán NHẬP THAY phụ huynh. Hợp nhất THEO Ô: chỉ ghi ô phụ huynh chưa điền (ô PH đã điền được giữ, ghi nhận ở `oXungDot`). Không bị TTL ràng buộc
 * (TTL là của liên kết công khai); yêu cầu phải còn `DANG_MO`.
 */
export async function nhapThayBoiSale(input: { actor: Actor; nguoi: { id: string; name: string }; id: string; du: DauVaoO; now: Date }): Promise<KetQuaGhiO> {
  try {
    const du = kiemDauVao(input.du);
    return await db.$transaction(async (tx): Promise<KetQuaGhiO> => {
      await khoaTuVan(tx, input.id);
      const row = await timChoNhanVien(tx, input.actor, input.id);
      if (!row) throw KHONG_QUYEN();
      if (row.trangThai !== "DANG_MO") throw new TuChoi("DA_DONG", "Yêu cầu đã đóng — không nhập thêm được.");
      const hn = hopNhatTheoO(docDuLieuLuu(row.duLieuGui), du, "SALE_NHAP_THAY" satisfies NguonO, input.now);
      if (hn.oDaDoi.length === 0) return { ok: true, oDaDoi: [], oXungDot: tenOXungDot(hn.oXungDot) };
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: { id: row.id, centerId: row.centerId, trangThai: "DANG_MO" },
        data: { duLieuGui: luuJson(hn.ketQua), updatedAt: input.now },
      });
      if (upd.count !== 1) throw new TuChoi("DA_DONG", "Yêu cầu đã đóng — không nhập thêm được.");
      await writeAudit({
        tx,
        actor: input.nguoi,
        module: MODULE,
        entityType: ENTITY,
        entityId: row.id,
        action: "SALE_NHAP_THAY_THONG_TIN_NGUOI_MUA",
        oldValues: { trangThai: row.trangThai },
        newValues: { trangThai: "DANG_MO", oDaDoi: hn.oDaDoi, oXungDot: tenOXungDot(hn.oXungDot) },
        changedFields: ["duLieuGui"],
        orgUnitId: row.centerId,
      });
      return { ok: true, oDaDoi: hn.oDaDoi, oXungDot: tenOXungDot(hn.oXungDot) };
    });
  } catch (e) {
    if (e instanceof TuChoi) return sangLoi(e);
    throw e;
  }
}

export type KetQuaXacNhan = { ok: true; id: string; orderId: string; centerId: string; nguoiMua: NguoiMuaToiGian; nguonTheoO: Partial<Record<OKhoa, NguonO>> } | Loi;

export type XacNhanThanhCong = Extract<KetQuaXacNhan, { ok: true }>;

/**
 * Nhân viên xác nhận: DANG_MO → DA_AP_DUNG, khi bộ ô hợp nhất ĐỦ và hợp lệ. Hai người cùng xác nhận ⇒ đúng một thắng (khoá tư vấn + `updateMany` có điều kiện `trangThai`).
 * Trả `nguoiMua` đã chuẩn hoá để đường gọi chép sang `Order.invoice*` — dịch vụ này KHÔNG ghi `Order`. Muốn chép sang đơn CÙNG MỘT giao dịch (để sập giữa chừng không để lại
 * "yêu cầu đã áp dụng mà đơn chưa đổi") thì dùng `xacNhanYeuCauTrongTx` bên dưới và tự bọc `db.$transaction`.
 */
export async function xacNhanYeuCau(input: { actor: Actor; nguoi: { id: string; name: string }; id: string; now: Date }): Promise<KetQuaXacNhan> {
  try {
    return await db.$transaction((tx) => xacNhanYeuCauTrongTx(tx, input));
  } catch (e) {
    if (e instanceof TuChoi) return sangLoi(e);
    throw e;
  }
}

/**
 * LÕI của `xacNhanYeuCau`, chạy TRONG giao dịch của đường gọi — để lead ghép với phép ghi `Order.invoice*` thành MỘT giao dịch. TỪ CHỐI = NÉM `TuChoi` (đường gọi bắt NGOÀI
 * `$transaction` bằng `sangLoi`; nếu để lọt ra ngoài thì giao dịch rollback cả phần ghi đơn của đường gọi). Giữ khoá tư vấn theo id yêu cầu tới hết giao dịch.
 * ⚠️ `tx` phải KHÔNG scope (`db.$transaction`); quyền + phạm vi cơ sở được kiểm lại ở đây từ `actor`.
 */
export async function xacNhanYeuCauTrongTx(tx: Tx, input: { actor: Actor; nguoi: { id: string; name: string }; id: string; now: Date }): Promise<XacNhanThanhCong> {
  await khoaTuVan(tx, input.id);
  const row = await timChoNhanVien(tx, input.actor, input.id);
  if (!row) throw KHONG_QUYEN();
  if (row.trangThai !== "DANG_MO") throw new TuChoi("DA_DONG", "Yêu cầu đã được xử lý.");
  const bang = docDuLieuLuu(row.duLieuGui);
  const kiem = kiemBoDayDu(bang);
  if (!kiem.ok) {
    throw new TuChoi("THIEU_THONG_TIN", `Chưa đủ thông tin người mua — thiếu: ${kiem.thieu.join(", ") || "(không)"}; chưa hợp lệ: ${kiem.sai.join(", ") || "(không)"}.`);
  }
  const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
    where: { id: row.id, centerId: row.centerId, trangThai: "DANG_MO" },
    data: { trangThai: "DA_AP_DUNG", updatedAt: input.now },
  });
  if (upd.count !== 1) throw new TuChoi("DA_DONG", "Yêu cầu đã được xử lý.");
  await writeAudit({
    tx,
    actor: input.nguoi,
    module: MODULE,
    entityType: ENTITY,
    entityId: row.id,
    action: "XAC_NHAN_YEU_CAU_NGUOI_MUA",
    oldValues: { trangThai: "DANG_MO" },
    newValues: { trangThai: "DA_AP_DUNG" },
    changedFields: ["trangThai"],
    orgUnitId: row.centerId,
  });
  const nguonTheoO: Partial<Record<OKhoa, NguonO>> = {};
  for (const o of O_NGUOI_MUA) if (bang[o]) nguonTheoO[o] = bang[o]!.nguon;
  return { ok: true, id: row.id, orderId: row.orderId, centerId: row.centerId, nguoiMua: kiem.nguoiMua, nguonTheoO };
}

export type KetQuaDong = { ok: true } | Loi;

/** Nhân viên huỷ: DANG_MO → THU_HOI. Lý do bắt buộc (≥ `TOI_THIEU_LY_DO_HOA_DON` ký tự) vào AuditLog. Sau khi huỷ, đơn tạo được yêu cầu mới. */
export async function huyYeuCau(input: { actor: Actor; nguoi: { id: string; name: string }; id: string; lyDo: string; now: Date }): Promise<KetQuaDong> {
  const lyDo = (input.lyDo ?? "").trim();
  if (lyDo.length < TOI_THIEU_LY_DO_HOA_DON) return { ok: false, ma: "LY_DO_NGAN", error: `Ghi lý do huỷ (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự).` };
  try {
    return await db.$transaction(async (tx): Promise<KetQuaDong> => {
      await khoaTuVan(tx, input.id);
      const row = await timChoNhanVien(tx, input.actor, input.id);
      if (!row) throw KHONG_QUYEN();
      if (row.trangThai !== "DANG_MO") throw new TuChoi("DA_DONG", "Yêu cầu đã được xử lý.");
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: { id: row.id, centerId: row.centerId, trangThai: "DANG_MO" },
        data: { trangThai: "THU_HOI", updatedAt: input.now },
      });
      if (upd.count !== 1) throw new TuChoi("DA_DONG", "Yêu cầu đã được xử lý.");
      await writeAudit({
        tx,
        actor: input.nguoi,
        module: MODULE,
        entityType: ENTITY,
        entityId: row.id,
        action: "HUY_YEU_CAU_NGUOI_MUA",
        oldValues: { trangThai: "DANG_MO" },
        newValues: { trangThai: "THU_HOI" },
        changedFields: ["trangThai"],
        reason: lyDo,
        orgUnitId: row.centerId,
      });
      return { ok: true };
    });
  } catch (e) {
    if (e instanceof TuChoi) return sangLoi(e);
    throw e;
  }
}

// ── QUÉT (cron / hệ thống, không actor) ──────────────────────────────────────

export type KetQuaQuet = { hetHan: number; daXoaDuLieu: number; choXuLyQuaHan: number };
/** Phạm vi của lượt quét: `"TAT_CA"` (cron toàn hệ thống — nói RÕ, không phải mặc định) hoặc danh sách cơ sở. Danh sách RỖNG ⇒ không quét gì (fail-closed). */
export type PhamViQuet = "TAT_CA" | readonly string[];

/**
 * (1) DANG_MO quá `hetHanLuc` mà phụ huynh CHƯA gửi (`guiLuc` rỗng) → HET_HAN. Quá hạn mà ĐÃ gửi thì giữ nguyên (đang chờ nhân viên) và chỉ ĐẾM vào `choXuLyQuaHan` để nhắc —
 *     TRỪ khi `choXuLyToiDaNgay` là số: yêu cầu đã gửi mà nhân viên bỏ mặc quá ngần ấy ngày kể từ `guiLuc` thì cũng → HET_HAN (để bước (2) xoá dữ liệu về sau). `null` = KHÔNG BAO GIỜ tự đóng
 *     (dữ liệu của phụ huynh nằm chờ vô hạn và đơn bị giữ chỗ — một lựa chọn CÓ CHỦ ĐÍCH của đường gọi, vì thời hạn giữ dữ liệu còn chờ pháp lý OD-11; không có mặc định).
 * (2) Yêu cầu đã đóng (DA_GUI · DA_AP_DUNG · TU_CHOI · HET_HAN · THU_HOI) quá `giuDuLieuNgay` ngày kể từ lần đổi cuối (`updatedAt`) → `duLieuGui` = NULL.
 * `giuDuLieuNgay`, `choXuLyToiDaNgay`, `phamVi`, `lo` BẮT BUỘC. `lo` = số dòng tối đa mỗi bước mỗi lượt. Cron không có người dùng; `phamVi` cho phép chạy theo cơ sở,
 * và mỗi `updateMany` vẫn mang `centerId` của chính dòng.
 */
export async function quetHetHan(input: { now: Date; giuDuLieuNgay: number; choXuLyToiDaNgay: number | null; phamVi: PhamViQuet; lo: number }): Promise<KetQuaQuet> {
  if (!Number.isInteger(input.giuDuLieuNgay) || input.giuDuLieuNgay < 1) throw new RangeError("giuDuLieuNgay phải là số nguyên dương");
  if (input.choXuLyToiDaNgay !== null && (!Number.isInteger(input.choXuLyToiDaNgay) || input.choXuLyToiDaNgay < 1)) throw new RangeError("choXuLyToiDaNgay phải là null hoặc số nguyên dương");
  if (!Number.isInteger(input.lo) || input.lo < 1) throw new RangeError("lo phải là số nguyên dương");
  const { now } = input;
  if (input.phamVi !== "TAT_CA" && input.phamVi.length === 0) return { hetHan: 0, daXoaDuLieu: 0, choXuLyQuaHan: 0 };
  const coSo = input.phamVi === "TAT_CA" ? {} : { centerId: { in: [...input.phamVi] } };

  const catGui = input.choXuLyToiDaNgay === null ? null : new Date(now.getTime() - input.choXuLyToiDaNgay * 86_400_000);
  const chuaGuiHoacBoRoi = [{ guiLuc: null }, ...(catGui === null ? [] : [{ guiLuc: { lte: catGui } }])];
  const quaHan = await db.hoaDonYeuCauNguoiMua.findMany({
    where: { trangThai: "DANG_MO", hetHanLuc: { lte: now }, ...coSo, OR: chuaGuiHoacBoRoi },
    select: { id: true, centerId: true },
    orderBy: { hetHanLuc: "asc" },
    take: input.lo,
  });
  let hetHan = 0;
  for (const r of quaHan) {
    const ghi = await db.$transaction(async (tx) => {
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: { id: r.id, centerId: r.centerId, trangThai: "DANG_MO", hetHanLuc: { lte: now }, OR: chuaGuiHoacBoRoi },
        data: { trangThai: "HET_HAN", updatedAt: now },
      });
      if (upd.count !== 1) return false;
      await writeAudit({
        tx,
        actor: NGUOI_HE_THONG,
        module: MODULE,
        entityType: ENTITY,
        entityId: r.id,
        action: "HET_HAN_YEU_CAU_NGUOI_MUA",
        oldValues: { trangThai: "DANG_MO" },
        newValues: { trangThai: "HET_HAN" },
        changedFields: ["trangThai"],
        orgUnitId: r.centerId,
      });
      return true;
    });
    if (ghi) hetHan += 1;
  }

  const choXuLyQuaHan = await db.hoaDonYeuCauNguoiMua.count({ where: { trangThai: "DANG_MO", hetHanLuc: { lte: now }, guiLuc: { not: null }, ...coSo } });

  const catTruoc = new Date(now.getTime() - input.giuDuLieuNgay * 86_400_000);
  const TRANG_THAI_DONG = ["DA_GUI", "DA_AP_DUNG", "TU_CHOI", "HET_HAN", "THU_HOI"];
  const quaThoiHan = await db.hoaDonYeuCauNguoiMua.findMany({
    where: { trangThai: { in: TRANG_THAI_DONG }, duLieuGui: { not: Prisma.DbNull }, updatedAt: { lte: catTruoc }, ...coSo },
    select: { id: true, centerId: true },
    orderBy: { updatedAt: "asc" },
    take: input.lo,
  });
  let daXoaDuLieu = 0;
  for (const r of quaThoiHan) {
    const ghi = await db.$transaction(async (tx) => {
      const upd = await tx.hoaDonYeuCauNguoiMua.updateMany({
        where: { id: r.id, centerId: r.centerId, trangThai: { in: TRANG_THAI_DONG }, duLieuGui: { not: Prisma.DbNull }, updatedAt: { lte: catTruoc } },
        data: { duLieuGui: Prisma.DbNull, updatedAt: now },
      });
      if (upd.count !== 1) return false;
      await writeAudit({
        tx,
        actor: NGUOI_HE_THONG,
        module: MODULE,
        entityType: ENTITY,
        entityId: r.id,
        action: "XOA_DU_LIEU_QUA_HAN_YEU_CAU_NGUOI_MUA",
        oldValues: null,
        newValues: { daXoaDuLieu: true },
        changedFields: ["duLieuGui"],
        orgUnitId: r.centerId,
      });
      return true;
    });
    if (ghi) daXoaDuLieu += 1;
  }
  return { hetHan, daXoaDuLieu, choXuLyQuaHan };
}
