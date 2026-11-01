import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { LoiXacNhanKhoan } from "@/lib/finance/payment";
import type { ActionScopeActor } from "@/lib/lms/report-card-core";
import type { CongHoaDon, KetQuaPhatHanh, KetQuaTraCuu, LoaiTep, PhieuPhatHanh } from "@/lib/misa/meinvoice/cong";
import { kiemPhieu } from "@/lib/misa/meinvoice/anh-xa";
import { hoanTatChotTrongTx, kiemCongChotTrongTx, LoiChotHoaDon, type KetQuaChot } from "./chot-hoa-don";
import { COT_NGUOI_MUA } from "./ghi-hoa-don";
import { nguoiMuaChoDon, thieuChoHoaDon } from "./nguoi-mua";
import { bamNguoiMua } from "./bam-nguoi-mua";
import { khoanDaKhoaHoaDon, thongDiepKhoaHoaDon } from "./khoa-khoan";
import { chonHoaDonDuocThay } from "./thay-the";
import { laPhapNhanMisa, type PhapNhan } from "./phap-nhan";
import { dungPhieuPhatHanh, LoiDungPhieu, phieuTuJson } from "./phieu-phat-hanh";
import { khoaTepHoaDon, luuTepHoaDon, xoaTepHoaDon } from "./kho-tep";
import { soTienRong } from "./nguon-khoan";
import type { DongHoaDon } from "./tinh-hoa-don";

// lib/finance/hoa-don/phat-hanh-misa.ts — MÁY TRẠNG THÁI "Phát hành qua MISA" (bước 1 bán tự động,
// chủ dự án duyệt 30/09/2026; docs/ke-toan-hoa-don/PLAN.md mục "Bước 1 — Phát hành qua MISA").
//
//   (cho/lệch) ──batDauPhatHanh──▶ DANG_PHAT_HANH ──guiPhatHanh──▶ MISA
//                                     │  DA_PHAT_HANH ⇒ ghi số NGAY → tải PDF+XML vào kho → DA_XAC_NHAN
//                                     │                 (hệ quả sau-xác-nhận DÙNG CHUNG với `chotHoaDon`)
//                                     │  TU_CHOI      ⇒ LOI_PHAT_HANH ──phatHanhLai──▶ DANG_PHAT_HANH (refId MỚI)
//                                     │                               ──boPhatHanhLamTay──▶ (xoá, nhả khoản)
//                                     └  KHONG_RO     ⇒ giữ nguyên; `kiemTraLai` / cron `traCuu(refId)`:
//                                                       DA_PHAT_HANH ⇒ đi tiếp · CHUA_CO ⇒ gửi lại CÙNG refId
//
// ⚠️ BA KẾT QUẢ, KHÔNG PHẢI HAI (hợp đồng `lib/misa/meinvoice/cong.ts`): lỗi mạng / timeout / ném bất kỳ
// ⇒ KHONG_RO, KHÔNG BAO GIỜ coi là "chưa phát hành". refId sinh MỘT LẦN lúc tạo bản ghi; mọi lượt gửi lại
// đọc refId + phiếu ĐÃ LƯU (`misaRefId`, `misaPhieu`). refId MỚI chỉ ở `phatHanhLai` — sau TU_CHOI, khi
// MISA đã nói chắc chưa có hoá đơn nào.
// ⚠️ Gọi MISA NGOÀI transaction (một lượt HTTP chậm không được giữ khoá đơn). Mọi phép ghi trạng thái là
// `updateMany` CÓ ĐIỀU KIỆN theo trạng thái — hai lượt (người bấm "Kiểm tra lại" + cron) chạy chồng thì một
// lượt đổi 0 dòng và dừng.
// ⚠️ Cổng là THAM SỐ — người gọi lấy bằng `layCongHoaDon()` (`cong-phat-hanh.ts`), không tự dựng.
// ⚠️ Thông điệp lưu lên `misaLoiThongDiep` là thứ KẾ TOÁN đọc trên màn. Lỗi KỸ THUẬT (mạng, kho tệp, DB, bug)
// ⇒ câu NGHIỆP VỤ nói việc gì chưa xong + hệ thống sẽ làm gì; chi tiết ("connect ECONNREFUSED 127.0.0.1:9",
// stack) CHỈ vào log server (`loiKyThuat`). Thông điệp TU_CHOI / KHONG_RO do cổng MISA TRẢ VỀ (lỗi dữ liệu có
// nghĩa với kế toán, đã viết bằng lời) giữ nguyên.

export type MaLoiPhatHanh =
  | "DA_CO_HOA_DON"
  | "PHAP_NHAN_KHONG_MISA"
  | "THAY_THE"
  | "NGUOI_MUA_THIEU"
  | "PHIEU_KHONG_HOP_LE"
  | "DA_DOI";

const CAU_LOI: Record<MaLoiPhatHanh, string> = {
  DA_CO_HOA_DON: "Lần thu này vừa được người khác phát hành, tải hoá đơn hoặc đánh dấu — tải lại màn",
  PHAP_NHAN_KHONG_MISA:
    "Pháp nhân phát hành của cơ sở này không dùng MISA meInvoice — làm hoá đơn ở phần mềm của pháp nhân rồi tải lên",
  THAY_THE: "Lần thu có hoá đơn cũ đã huỷ — hoá đơn thay thế làm tại MISA rồi tải lên",
  NGUOI_MUA_THIEU: "Thông tin người mua trên đơn còn thiếu",
  PHIEU_KHONG_HOP_LE: "Chưa gửi MISA — sửa trên đơn rồi phát hành",
  DA_DOI: "Hoá đơn vừa đổi trạng thái — tải lại màn",
};

export class LoiPhatHanh extends Error {
  constructor(
    readonly ma: MaLoiPhatHanh,
    chiTiet?: string,
  ) {
    super(chiTiet ? `${CAU_LOI[ma]}: ${chiTiet}` : CAU_LOI[ma]);
    this.name = "LoiPhatHanh";
  }
}

/** Câu cho người dùng nếu `e` là lỗi nghiệp vụ đã biết (phát hành / cổng chốt / dựng phiếu); `null` ⇒ lỗi lạ. */
export function thongDiepLoiPhatHanh(e: unknown): string | null {
  return e instanceof LoiPhatHanh || e instanceof LoiChotHoaDon || e instanceof LoiDungPhieu || e instanceof LoiXacNhanKhoan
    ? e.message
    : null;
}

type NguoiBam = { id: string; name: string };

/** Kết quả một bước của máy — thứ action trả cho màn và cron đếm. */
export type SauBuoc =
  | { trangThai: "DA_XAC_NHAN"; ketQua: KetQuaChot | null }
  | { trangThai: "DANG_PHAT_HANH"; thongDiep: string }
  | { trangThai: "LOI_PHAT_HANH"; ma: string; thongDiep: string }
  | { trangThai: "KHONG_CON" };

const PHUT = 60_000;

/** Ngày lịch VN (nửa đêm UTC) của một mốc giờ — cột `ngayPhatHanh` là `@db.Date`. */
export function ngayLichVn(d: Date): Date {
  return new Date(`${new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10)}T00:00:00Z`);
}

/**
 * Lỗi KỸ THUẬT của một bước: chi tiết vào log server (tên + thông điệp lỗi, KHÔNG in cả đối tượng — có thể mang
 * header/cấu hình), trả câu nghiệp vụ cho màn. Không bao giờ đưa `e.message` thẳng lên `misaLoiThongDiep`.
 */
function loiKyThuat(viec: string, hoaDonId: string, e: unknown, cauNghiepVu: string): string {
  const chiTiet = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`[hoa-don-misa] ${viec} · hoaDonId=${hoaDonId} · ${chiTiet.slice(0, 500)}`);
  return cauNghiepVu;
}

/** Luật MISA trên CHÍNH phiếu sắp lưu (`kiemPhieu` — cùng hàm nút + cổng gọi). Ném TRƯỚC phép ghi đầu tiên. */
function chanPhieuKhongHopLe(phieu: PhieuPhatHanh): void {
  const loi = kiemPhieu(phieu);
  if (loi) throw new LoiPhatHanh("PHIEU_KHONG_HOP_LE", loi);
}

/** Dữ liệu phiếu dựng NGOÀI transaction (trang phiếu chờ + phương thức) — phần người mua đọc lại dưới khoá. */
export type NguonPhieu = {
  phapNhan: PhapNhan;
  trang: readonly { dong: readonly DongHoaDon[] }[];
  phuongThuc: readonly { ma: string; nhan: string }[];
};

type TxCongChot = Parameters<typeof kiemCongChotTrongTx>[0];

/**
 * Cổng RIÊNG của phát hành qua API, chạy SAU các cổng dùng chung với `chotHoaDon` (người gọi đã gọi
 * `kiemCongChotTrongTx`): người mua đủ để dựng tờ · pháp nhân dùng MISA · không phải hoá đơn THAY THẾ.
 */
async function kiemCongRiengMisa(
  tx: TxCongChot,
  input: { orderId: string; khoanIds: readonly string[]; don: Parameters<typeof nguoiMuaChoDon>[0]; phapNhan: PhapNhan },
) {
  const nm = nguoiMuaChoDon(input.don);
  const thieu = thieuChoHoaDon(nm).chan;
  if (thieu.length > 0) throw new LoiPhatHanh("NGUOI_MUA_THIEU", thieu.join(", "));
  if (!laPhapNhanMisa(input.phapNhan)) throw new LoiPhatHanh("PHAP_NHAN_KHONG_MISA");
  // Bước 1 KHÔNG phát hành hoá đơn THAY THẾ qua API (hợp đồng chưa có "thay thế cho số X") — cùng luật nối
  // `chonHoaDonDuocThay` mà luồng tải lên dùng, đọc TỪ DB trong transaction.
  const daHuy = await tx.hoaDonDienTu.findMany({
    where: { orderId: input.orderId, trangThai: "THAY_THE", khoan: { some: { paymentId: { in: [...input.khoanIds] } } } },
    select: { id: true, huyLuc: true, khoan: { select: { paymentId: true } } },
  });
  const thay = chonHoaDonDuocThay(
    daHuy.map((h) => ({ id: h.id, huyLuc: h.huyLuc, paymentIds: h.khoan.map((k) => k.paymentId) })),
    input.khoanIds,
  );
  if (thay) throw new LoiPhatHanh("THAY_THE");
  return nm;
}

/** Cột bản chụp người mua + pháp nhân + phiếu — dùng chung cho tạo mới và phát hành lại. */
function banChup(input: {
  nm: ReturnType<typeof nguoiMuaChoDon>;
  phapNhan: PhapNhan;
  phieu: PhieuPhatHanh;
  cheDo: CongHoaDon["cheDo"];
  tienTha: number;
}) {
  const { nm, phapNhan, phieu } = input;
  const moPhong = input.cheDo === "GIA_LAP";
  return {
    nguonPhatHanh: moPhong ? ("MISA_GIA_LAP" as const) : ("MISA_API" as const),
    misaRefId: phieu.refId,
    misaPhieu: JSON.parse(JSON.stringify(phieu)) as Prisma.InputJsonValue,
    kyHieu: phieu.kyHieu,
    phapNhanMa: phapNhan.ma,
    phapNhanTen: phapNhan.ten,
    phapNhanMst: phieu.mstNguoiBan,
    nguoiMuaTen: nm.hoTen || null,
    nguoiMuaDonVi: nm.tenDonVi,
    nguoiMuaMst: nm.maSoThue,
    nguoiMuaDiaChi: nm.diaChi,
    emailNhan: nm.email,
    nguoiMuaHashLucIn: bamNguoiMua(nm),
    // Bản MÔ PHỎNG không bao giờ email khách — ép ở đây VÀ ép lại lúc hoàn tất.
    guiEmailKhach: !moPhong,
    tienThaLamTron: input.tienTha,
  };
}

/**
 * (a) Bắt đầu: MỘT transaction, khoá đơn → khoản chưa bị hoá đơn nào giữ → MỌI cổng của `chotHoaDon`
 * (`kiemCongChotTrongTx`) → cổng riêng API → tạo bản DANG_PHAT_HANH + khoá khoản + bản chụp + refId.
 * Hai lượt bấm song song ⇒ xếp hàng ở khoá đơn; lượt sau thấy khoản đã khoá ⇒ DA_CO_HOA_DON (khoá thật
 * vẫn là chỉ mục từng phần `HoaDonKhoan_paymentId_hieuLuc_key` — P2002 dịch cùng câu).
 */
export async function batDauPhatHanh(input: {
  nguoiBam: NguoiBam;
  actor: ActionScopeActor;
  orderId: string;
  centerId: string;
  lanThuKey: string;
  /** Khoản + số RÒNG từ DÒNG loader dựng lại — không từ client. */
  khoan: readonly { id: string; soTien: number }[];
  nguon: NguonPhieu;
  cheDo: CongHoaDon["cheDo"];
  now: Date;
}): Promise<{ hoaDonId: string; refId: string }> {
  const khoanIds = input.khoan.map((k) => k.id);
  try {
    return await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, input.orderId);
      const khoa = await khoanDaKhoaHoaDon(tx, khoanIds);
      if (khoa.length > 0) throw new LoiPhatHanh("DA_CO_HOA_DON", thongDiepKhoaHoaDon(khoa));

      const cong = await kiemCongChotTrongTx(tx, {
        actor: input.actor,
        orderId: input.orderId,
        centerId: input.centerId,
        khoan: input.khoan.map((k) => ({ paymentId: k.id, soTien: k.soTien })),
        // Nút API chỉ mở cho lần thu ĐỦ, không nghi trùng — hai lối ra có lý do là việc của luồng tải lên.
        khongTrungLyDo: null,
        xuatTheoSoDaThu: false,
        xuatTheoSoDaThuLyDo: null,
      });
      const nm = await kiemCongRiengMisa(tx, {
        orderId: input.orderId,
        khoanIds,
        don: cong.don,
        phapNhan: input.nguon.phapNhan,
      });

      const tongTien = input.khoan.reduce((s, k) => s + k.soTien, 0);
      const refId = randomUUID();
      const phieu = dungPhieuPhatHanh({
        refId,
        phapNhan: input.nguon.phapNhan,
        ngayHoaDon: ngayLichVn(input.now),
        nguoiMua: nm,
        trang: input.nguon.trang,
        phuongThuc: input.nguon.phuongThuc,
        tongTien,
      });
      // Tờ MISA sẽ từ chối (email / MST sai luật MISA…) ⇒ từ chối NGAY: không tạo bản DANG_PHAT_HANH, không đốt
      // một lượt gửi. Ném trong transaction ⇒ rollback (khoá đơn ở trên không ghi gì).
      chanPhieuKhongHopLe(phieu);

      const hd = await tx.hoaDonDienTu.create({
        data: {
          ...banChup({ nm, phapNhan: input.nguon.phapNhan, phieu, cheDo: input.cheDo, tienTha: cong.lanThu.tienTha }),
          orderId: input.orderId,
          centerId: input.centerId,
          trangThai: "DANG_PHAT_HANH",
          tongTien,
          taoBoiId: input.nguoiBam.id,
          khoan: { create: input.khoan.map((k) => ({ paymentId: k.id, soTien: k.soTien })) },
        },
        select: { id: true },
      });
      await writeAudit({
        tx,
        actor: input.nguoiBam,
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: hd.id,
        action: "BAT_DAU_PHAT_HANH_MISA",
        newValues: {
          orderId: input.orderId,
          lanThuKey: input.lanThuKey,
          khoanIds,
          tongTien,
          misaRefId: refId,
          kyHieu: phieu.kyHieu,
          cheDo: input.cheDo,
        },
        orgUnitId: input.centerId,
      });
      return { hoaDonId: hd.id, refId };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new LoiPhatHanh("DA_CO_HOA_DON");
    throw e;
  }
}

/** Gọi cổng — MỌI thứ ném ra (mạng, JSON hỏng, bug phía cổng) đọc thành KHONG_RO, không bao giờ "chưa phát hành". */
async function goiAnToan<T extends KetQuaPhatHanh | KetQuaTraCuu>(
  hoaDonId: string,
  viec: string,
  f: () => Promise<T>,
): Promise<T | { loai: "KHONG_RO"; thongDiep: string }> {
  try {
    return await f();
  } catch (e) {
    return {
      loai: "KHONG_RO",
      thongDiep: loiKyThuat(viec, hoaDonId, e, "Chưa nhận được trả lời rõ từ MISA — hệ thống sẽ tự tra cứu lại, không phát hành lần hai"),
    };
  }
}

async function ghiThongDiep(hoaDonId: string, thongDiep: string): Promise<void> {
  await db.hoaDonDienTu.updateMany({ where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH" }, data: { misaLoiThongDiep: thongDiep.slice(0, 500) } });
}

/**
 * (b) Gửi phiếu ĐÃ LƯU với refId ĐÃ LƯU. Giành lượt có điều kiện (DANG_PHAT_HANH, chưa có số) + tăng đếm
 * lượt gửi + mốc gửi, rồi gọi MISA NGOÀI transaction, rồi áp kết quả.
 */
export async function guiPhatHanh(input: { hoaDonId: string; cong: CongHoaDon; now: Date }): Promise<SauBuoc> {
  const { hoaDonId, cong, now } = input;
  const gianh = await db.hoaDonDienTu.updateMany({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null, misaRefId: { not: null } },
    data: { misaSoLanGui: { increment: 1 }, misaGuiLuc: now },
  });
  if (gianh.count !== 1) return docSauBuoc(hoaDonId);
  const hd = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { misaRefId: true, misaPhieu: true } });
  if (!hd?.misaRefId) return docSauBuoc(hoaDonId);
  let phieu: PhieuPhatHanh;
  try {
    phieu = phieuTuJson(hd.misaPhieu);
  } catch (e) {
    await ghiThongDiep(hoaDonId, e instanceof Error ? e.message : "Phiếu đã lưu hỏng");
    return docSauBuoc(hoaDonId);
  }
  // refId của lượt gửi LUÔN là refId đã lưu trên bản ghi — phiếu JSON không được tự mang refId khác.
  const kq = await goiAnToan(hoaDonId, "gửi phát hành", () => cong.phatHanh({ ...phieu, refId: hd.misaRefId! }));
  return apDungKetQua(hoaDonId, hd.misaRefId, kq, cong, now);
}

async function apDungKetQua(
  hoaDonId: string,
  refId: string,
  kq: KetQuaPhatHanh | KetQuaTraCuu,
  cong: CongHoaDon,
  now: Date,
): Promise<SauBuoc> {
  if (kq.loai === "DA_PHAT_HANH") {
    if (kq.refId !== refId) {
      await ghiThongDiep(hoaDonId, `MISA trả số cho refId khác (${kq.refId}) — chờ đối soát`);
      return docSauBuoc(hoaDonId);
    }
    // Có số là ghi NGAY (trước khi tải tệp): tờ đã phát hành thật, không được để lượt tải tệp hỏng làm mất số.
    await db.hoaDonDienTu.updateMany({
      where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null },
      data: {
        kyHieu: kq.kyHieu,
        soHoaDon: kq.soHoaDon,
        ngayPhatHanh: ngayLichVn(kq.ngayPhatHanh),
        maTraCuu: kq.maTraCuu,
        misaLoiMa: null,
        misaLoiThongDiep: null,
      },
    });
    return taiVaHoanTat(hoaDonId, cong, now);
  }
  if (kq.loai === "TU_CHOI") {
    await db.$transaction(async (tx) => {
      const upd = await tx.hoaDonDienTu.updateMany({
        where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: null },
        data: { trangThai: "LOI_PHAT_HANH", misaLoiMa: kq.ma.slice(0, 100), misaLoiThongDiep: kq.thongDiep.slice(0, 500) },
      });
      // Ghi có điều kiện đổi 0 dòng ⇒ commit vô hại (người khác đã đi tiếp) — không ghi nhật ký.
      if (upd.count !== 1) return;
      const hd = await tx.hoaDonDienTu.findUniqueOrThrow({ where: { id: hoaDonId }, select: { centerId: true, taoBoiId: true } });
      await writeAudit({
        tx,
        actor: { id: hd.taoBoiId, name: "MISA meInvoice" },
        module: "finance",
        entityType: "HoaDonDienTu",
        entityId: hoaDonId,
        action: "MISA_TU_CHOI_PHAT_HANH",
        oldValues: { trangThai: "DANG_PHAT_HANH" },
        newValues: { trangThai: "LOI_PHAT_HANH", misaRefId: refId, ma: kq.ma, thongDiep: kq.thongDiep },
        orgUnitId: hd.centerId,
      });
    });
    return docSauBuoc(hoaDonId);
  }
  if (kq.loai === "KHONG_RO") {
    await ghiThongDiep(hoaDonId, kq.thongDiep || "MISA chưa trả lời rõ");
    return docSauBuoc(hoaDonId);
  }
  // CHUA_CO chỉ đến từ tra cứu — người gọi (`kiemTraMotBan`) quyết gửi lại hay chờ.
  return docSauBuoc(hoaDonId);
}

/**
 * Bản đã CÓ SỐ: tải PDF + XML còn thiếu từ MISA → ghi vào kho hoá đơn (cùng quy ước khoá + sha256 + cỡ như
 * luồng tải lên) → hoàn tất. Tải/ghi hỏng ⇒ GIỮ DANG_PHAT_HANH (đã có số), lượt đối soát sau tải lại.
 */
async function taiVaHoanTat(hoaDonId: string, cong: CongHoaDon, now: Date): Promise<SauBuoc> {
  const hd = await db.hoaDonDienTu.findFirst({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: { not: null } },
    select: {
      orderId: true,
      maTraCuu: true,
      phapNhanMst: true,
      tepPdfKey: true,
      tepXmlKey: true,
      kyHieu: true,
      soHoaDon: true,
      order: { select: { center: { select: { code: true } } } },
    },
  });
  if (!hd) return docSauBuoc(hoaDonId);
  const centerCode = hd.order.center?.code?.trim();
  if (!hd.maTraCuu || !hd.phapNhanMst || !centerCode) {
    await ghiThongDiep(hoaDonId, "Đã có số nhưng thiếu mã tra cứu / MST / mã cơ sở — không tải được tệp");
    return docSauBuoc(hoaDonId);
  }
  const so = `${hd.kyHieu ?? ""}-${hd.soHoaDon ?? ""}`;
  for (const loai of ["pdf", "xml"] as const satisfies readonly LoaiTep[]) {
    if ((loai === "pdf" ? hd.tepPdfKey : hd.tepXmlKey) != null) continue;
    let than: Uint8Array;
    try {
      than = await cong.taiTep(hd.maTraCuu, loai, hd.phapNhanMst);
    } catch (e) {
      const cau = `Đã có số hoá đơn ${so} nhưng chưa tải được tệp ${loai.toUpperCase()} từ MISA — hệ thống sẽ tự thử lại`;
      await ghiThongDiep(hoaDonId, loiKyThuat(`tải tệp ${loai} từ MISA`, hoaDonId, e, cau));
      return docSauBuoc(hoaDonId);
    }
    const khoa = khoaTepHoaDon({ centerCode, orderId: hd.orderId, loai, nam: now.getUTCFullYear(), uuid: randomUUID() });
    let luu: Awaited<ReturnType<typeof luuTepHoaDon>>;
    try {
      luu = await luuTepHoaDon({ khoa, loai, than });
    } catch (e) {
      const cau = `Đã có số hoá đơn ${so} nhưng chưa lưu được tệp ${loai.toUpperCase()} vào kho — hệ thống sẽ tự thử lại`;
      await ghiThongDiep(hoaDonId, loiKyThuat(`ghi tệp ${loai} vào kho`, hoaDonId, e, cau));
      return docSauBuoc(hoaDonId);
    }
    if (!luu.ok) {
      await ghiThongDiep(hoaDonId, `Đã có số hoá đơn ${so} nhưng ${luu.thongDiep} — hệ thống sẽ tự thử lại`);
      return docSauBuoc(hoaDonId);
    }
    const tenTep = `HoaDon-${so}.${loai}`;
    const upd = await db.hoaDonDienTu.updateMany({
      where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", ...(loai === "pdf" ? { tepPdfKey: null } : { tepXmlKey: null }) },
      data:
        loai === "pdf"
          ? { tepPdfKey: khoa, tepPdfTen: tenTep, tepPdfCo: luu.co, tepPdfSha256: luu.sha256 }
          : { tepXmlKey: khoa, tepXmlTen: tenTep, tepXmlCo: luu.co },
    });
    // Lượt khác đã ghi tệp trước ⇒ tệp vừa đặt là mồ côi: dọn ngay (cron mồ côi cũng sẽ dọn nếu lỗi).
    if (upd.count !== 1) await xoaTepHoaDon(khoa).catch(() => undefined);
  }
  return hoanTatPhatHanh(hoaDonId, now);
}

/**
 * DANG_PHAT_HANH (đủ số + tệp) → DA_XAC_NHAN, với ĐÚNG các hệ quả sau-xác-nhận của `chotHoaDon`
 * (`hoanTatChotTrongTx`: email khách qua `HoaDonGuiEmail` + sự kiện, xác nhận khoản còn chờ + RCP, nhật ký).
 * KHÔNG chạy lại các cổng: hoá đơn đã phát hành thật ở MISA — việc ở đây là GHI NHẬN nó, không phải quyết
 * có cho phát hành không (cổng đã chạy dưới khoá lúc bắt đầu; khoản bị khoá suốt từ đó — `khoa-khoan.ts`).
 */
async function hoanTatPhatHanh(hoaDonId: string, now: Date): Promise<SauBuoc> {
  const dau = await db.hoaDonDienTu.findUnique({ where: { id: hoaDonId }, select: { orderId: true } });
  if (!dau) return { trangThai: "KHONG_CON" };
  try {
    const kq = await db.$transaction(async (tx) => {
      await khoaDonTrongTx(tx, dau.orderId);
      const hd = await tx.hoaDonDienTu.findFirst({
        where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH", soHoaDon: { not: null }, tepPdfKey: { not: null }, tepXmlKey: { not: null } },
        select: {
          orderId: true,
          centerId: true,
          updatedAt: true,
          taoBoiId: true,
          kyHieu: true,
          soHoaDon: true,
          maTraCuu: true,
          tongTien: true,
          tienThaLamTron: true,
          guiEmailKhach: true,
          nguonPhatHanh: true,
          misaRefId: true,
          khoan: { where: { hieuLuc: true }, select: { paymentId: true } },
        },
      });
      if (!hd) return null;
      const [don, cacDong, nguoi] = await Promise.all([
        tx.order.findUniqueOrThrow({
          where: { id: hd.orderId },
          select: { status: true, deletedAt: true, centerId: true, type: true, ...COT_NGUOI_MUA },
        }),
        tx.payment.findMany({
          where: { orderId: hd.orderId, deletedAt: null },
          select: { id: true, amount: true, adjustmentOfId: true, deletedAt: true, accountantStatus: true, enrollmentId: true, recordedById: true },
        }),
        tx.user.findUnique({ where: { id: hd.taoBoiId }, select: { name: true } }),
      ]);
      return hoanTatChotTrongTx(tx, {
        // Người BẤM phát hành là người xác nhận (cron chỉ hoàn tất thay họ).
        nguoiChot: { id: hd.taoBoiId, name: nguoi?.name ?? hd.taoBoiId },
        orderId: hd.orderId,
        hoaDonId,
        tu: "DANG_PHAT_HANH",
        updatedAt: hd.updatedAt,
        now,
        don,
        theoIdDong: new Map(cacDong.map((p) => [p.id, p])),
        rong: soTienRong(cacDong),
        paymentIds: hd.khoan.map((k) => k.paymentId),
        // Bản MÔ PHỎNG không bao giờ email khách — ép lại lần nữa, không tin cột.
        guiEmailKhach: hd.nguonPhatHanh === "MISA_GIA_LAP" ? false : hd.guiEmailKhach,
        tienTha: hd.tienThaLamTron,
        centerId: hd.centerId,
        nhatKy: {
          kyHieu: hd.kyHieu,
          soHoaDon: hd.soHoaDon,
          tongTien: hd.tongTien,
          nguonPhatHanh: hd.nguonPhatHanh,
          misaRefId: hd.misaRefId,
          maTraCuu: hd.maTraCuu,
        },
      });
    });
    return kq ? { trangThai: "DA_XAC_NHAN", ketQua: kq } : docSauBuoc(hoaDonId);
  } catch (e) {
    // Hoá đơn ĐÃ phát hành thật — không nuốt, không vứt: ghi lý do lên bản ghi để màn nói ra; thử lại được.
    // Lỗi nghiệp vụ đã biết ⇒ nói nguyên câu; lỗi lạ (DB, bug) ⇒ log + câu nghiệp vụ.
    const tb = thongDiepLoiPhatHanh(e);
    await ghiThongDiep(
      hoaDonId,
      tb
        ? `Đã có số và tệp nhưng chưa ghi nhận xong: ${tb.slice(0, 300)}`
        : loiKyThuat("hoàn tất", hoaDonId, e, "Đã có số và tệp nhưng chưa ghi nhận xong vào sổ — hệ thống sẽ tự thử lại"),
    );
    return docSauBuoc(hoaDonId);
  }
}

async function docSauBuoc(hoaDonId: string): Promise<SauBuoc> {
  const hd = await db.hoaDonDienTu.findUnique({
    where: { id: hoaDonId },
    select: { trangThai: true, misaLoiMa: true, misaLoiThongDiep: true, soHoaDon: true },
  });
  if (!hd) return { trangThai: "KHONG_CON" };
  if (hd.trangThai === "DA_XAC_NHAN") return { trangThai: "DA_XAC_NHAN", ketQua: null };
  if (hd.trangThai === "LOI_PHAT_HANH") return { trangThai: "LOI_PHAT_HANH", ma: hd.misaLoiMa ?? "", thongDiep: hd.misaLoiThongDiep ?? "" };
  if (hd.trangThai === "DANG_PHAT_HANH") {
    return { trangThai: "DANG_PHAT_HANH", thongDiep: hd.misaLoiThongDiep ?? (hd.soHoaDon ? "Đã có số — đang tải tệp" : "Đang chờ MISA xác nhận") };
  }
  return { trangThai: "KHONG_CON" };
}

/**
 * "Kiểm tra lại" (nút trên màn) và một lượt của cron: bản đã có số ⇒ tải tệp / hoàn tất; chưa có số ⇒
 * `traCuu(refId)`: DA_PHAT_HANH ⇒ đi tiếp · CHUA_CO ⇒ gửi lại CÙNG refId khi `choGuiLai` · KHONG_RO ⇒ giữ.
 */
export async function kiemTraMotBan(input: {
  hoaDonId: string;
  cong: CongHoaDon;
  now: Date;
  /** Được phép gửi lại khi MISA nói CHUA_CO. Nút: luôn; cron: chỉ khi lượt gửi trước đã > 10 phút. */
  choGuiLai: (hd: { misaGuiLuc: Date | null }) => boolean;
}): Promise<SauBuoc> {
  const { hoaDonId, cong, now } = input;
  const hd = await db.hoaDonDienTu.findFirst({
    where: { id: hoaDonId, trangThai: "DANG_PHAT_HANH" },
    select: { soHoaDon: true, misaRefId: true, phapNhanMst: true, misaGuiLuc: true },
  });
  if (!hd) return docSauBuoc(hoaDonId);
  if (hd.soHoaDon) return taiVaHoanTat(hoaDonId, cong, now);
  if (!hd.misaRefId || !hd.phapNhanMst) {
    await ghiThongDiep(hoaDonId, "Bản ghi thiếu refId / MST — không tra được MISA");
    return docSauBuoc(hoaDonId);
  }
  const refId = hd.misaRefId;
  const mst = hd.phapNhanMst;
  const kq = await goiAnToan(hoaDonId, "tra cứu", () => cong.traCuu(refId, mst));
  if (kq.loai === "CHUA_CO") {
    if (input.choGuiLai(hd)) return guiPhatHanh({ hoaDonId, cong, now });
    await ghiThongDiep(hoaDonId, "MISA chưa có hoá đơn này — sẽ gửi lại cùng mã tham chiếu");
    return docSauBuoc(hoaDonId);
  }
  return apDungKetQua(hoaDonId, refId, kq, cong, now);
}

export const TRAN_DOI_SOAT = 50;

/**
 * (c) Cron đối soát (`/api/cron/hoa-don-misa-doi-soat`, 10 phút): quét DANG_PHAT_HANH đã gửi > 2 phút (hoặc
 * chưa gửi lần nào mà tạo > 2 phút — máy chủ chết giữa bước tạo và bước gửi), trần 50/lượt, cũ nhất trước.
 * CHUA_CO chỉ gửi lại khi lượt trước đã > 10 phút. Không cổng ⇒ bỏ qua (không ném).
 */
export async function doiSoatPhatHanhTreo(input: { cong: CongHoaDon | null; now: Date }): Promise<{
  boQua?: string;
  quet: number;
  daXacNhan: number;
  loi: number;
  conCho: number;
  hong: number;
}> {
  const { cong, now } = input;
  if (!cong) return { boQua: "Chưa cấu hình cổng MISA meInvoice", quet: 0, daXacNhan: 0, loi: 0, conCho: 0, hong: 0 };
  const moc = new Date(now.getTime() - 2 * PHUT);
  const ds = await db.hoaDonDienTu.findMany({
    where: {
      trangThai: "DANG_PHAT_HANH",
      OR: [{ misaGuiLuc: { lt: moc } }, { misaGuiLuc: null, createdAt: { lt: moc } }],
    },
    orderBy: [{ misaGuiLuc: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: TRAN_DOI_SOAT,
    select: { id: true },
  });
  const dem = { quet: ds.length, daXacNhan: 0, loi: 0, conCho: 0, hong: 0 };
  const guiLaiDuoc = (hd: { misaGuiLuc: Date | null }) => hd.misaGuiLuc == null || hd.misaGuiLuc.getTime() < now.getTime() - 10 * PHUT;
  for (const { id } of ds) {
    try {
      const r = await kiemTraMotBan({ hoaDonId: id, cong, now, choGuiLai: guiLaiDuoc });
      if (r.trangThai === "DA_XAC_NHAN") dem.daXacNhan += 1;
      else if (r.trangThai === "LOI_PHAT_HANH") dem.loi += 1;
      else if (r.trangThai === "DANG_PHAT_HANH") dem.conCho += 1;
    } catch (e) {
      // Một bản hỏng không được chặn cả lượt — ghi lên chính bản đó rồi đi tiếp.
      dem.hong += 1;
      const cau = "Lượt kiểm tra tự động gặp lỗi hệ thống — hệ thống sẽ tự thử lại ở lượt sau";
      await ghiThongDiep(id, loiKyThuat("đối soát", id, e, cau)).catch(() => undefined);
    }
  }
  return dem;
}

/**
 * "Phát hành lại" sau LOI_PHAT_HANH (kế toán đã sửa người mua trên đơn): chạy LẠI mọi cổng dưới khoá, chụp
 * LẠI người mua, sinh refId MỚI — được phép DUY NHẤT ở đây vì TU_CHOI chắc chắn chưa có hoá đơn nào — rồi về
 * DANG_PHAT_HANH. Người gọi gửi ngay bằng `guiPhatHanh`.
 */
export async function phatHanhLai(input: {
  nguoiBam: NguoiBam;
  actor: ActionScopeActor;
  orderId: string;
  hoaDonId: string;
  /** Phiên bản bản LỖI người bấm đã thấy — ai vừa bỏ / phát hành lại trước ⇒ DA_DOI. */
  phienBan: Date;
  nguon: NguonPhieu;
  cheDo: CongHoaDon["cheDo"];
  now: Date;
}): Promise<{ refId: string }> {
  return db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, input.orderId);
    const hd = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
      select: { centerId: true, updatedAt: true, misaRefId: true, tongTien: true, khoan: { where: { hieuLuc: true }, select: { paymentId: true, soTien: true } } },
    });
    if (!hd || hd.khoan.length === 0) throw new LoiPhatHanh("DA_DOI");
    const cong = await kiemCongChotTrongTx(tx, {
      actor: input.actor,
      orderId: input.orderId,
      centerId: hd.centerId,
      khoan: hd.khoan,
      khongTrungLyDo: null,
      xuatTheoSoDaThu: false,
      xuatTheoSoDaThuLyDo: null,
    });
    const khoanIds = hd.khoan.map((k) => k.paymentId);
    const nm = await kiemCongRiengMisa(tx, { orderId: input.orderId, khoanIds, don: cong.don, phapNhan: input.nguon.phapNhan });
    const refId = randomUUID();
    const phieu = dungPhieuPhatHanh({
      refId,
      phapNhan: input.nguon.phapNhan,
      ngayHoaDon: ngayLichVn(input.now),
      nguoiMua: nm,
      trang: input.nguon.trang,
      phuongThuc: input.nguon.phuongThuc,
      tongTien: hd.tongTien,
    });
    chanPhieuKhongHopLe(phieu);
    const upd = await tx.hoaDonDienTu.updateMany({
      where: { id: input.hoaDonId, trangThai: "LOI_PHAT_HANH", updatedAt: hd.updatedAt },
      data: {
        ...banChup({ nm, phapNhan: input.nguon.phapNhan, phieu, cheDo: input.cheDo, tienTha: cong.lanThu.tienTha }),
        trangThai: "DANG_PHAT_HANH",
        misaLoiMa: null,
        misaLoiThongDiep: null,
        misaSoLanGui: 0,
        misaGuiLuc: null,
      },
    });
    if (upd.count !== 1) throw new LoiPhatHanh("DA_DOI");
    await writeAudit({
      tx,
      actor: input.nguoiBam,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "PHAT_HANH_LAI_MISA",
      oldValues: { trangThai: "LOI_PHAT_HANH", misaRefId: hd.misaRefId },
      newValues: { trangThai: "DANG_PHAT_HANH", misaRefId: refId },
      orgUnitId: hd.centerId,
    });
    return { refId };
  });
}

/** "Bỏ, làm tay" sau LOI_PHAT_HANH: gỡ bản lỗi (dòng nối xoá theo — Cascade) ⇒ khoản về hàng chờ để tải tay. */
export async function boPhatHanhLamTay(input: {
  nguoiBam: NguoiBam;
  orderId: string;
  hoaDonId: string;
  phienBan: Date;
}): Promise<void> {
  await db.$transaction(async (tx) => {
    await khoaDonTrongTx(tx, input.orderId);
    const hd = await tx.hoaDonDienTu.findFirst({
      where: { id: input.hoaDonId, orderId: input.orderId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
      select: { centerId: true, misaRefId: true, misaLoiMa: true, misaLoiThongDiep: true, khoan: { select: { paymentId: true } } },
    });
    if (!hd) throw new LoiPhatHanh("DA_DOI");
    // Nhật ký trước: sau khi xoá, `writeAudit` không còn suy được đơn vị từ thực thể.
    await writeAudit({
      tx,
      actor: input.nguoiBam,
      module: "finance",
      entityType: "HoaDonDienTu",
      entityId: input.hoaDonId,
      action: "BO_PHAT_HANH_MISA",
      oldValues: {
        orderId: input.orderId,
        trangThai: "LOI_PHAT_HANH",
        misaRefId: hd.misaRefId,
        misaLoiMa: hd.misaLoiMa,
        misaLoiThongDiep: hd.misaLoiThongDiep,
        khoanIds: hd.khoan.map((k) => k.paymentId),
      },
      orgUnitId: hd.centerId,
    });
    const del = await tx.hoaDonDienTu.deleteMany({
      where: { id: input.hoaDonId, trangThai: "LOI_PHAT_HANH", updatedAt: input.phienBan },
    });
    if (del.count !== 1) throw new LoiPhatHanh("DA_DOI");
  });
}
