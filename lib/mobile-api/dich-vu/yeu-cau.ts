import type { ParentRequestStatus, ParentRequestType } from "@prisma/client";

import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { formatDateVN } from "@/lib/format/date";
import { rutDonXinNghiDaTiepNhan } from "@/lib/hoc-bu/rut-don-nghi";
import { lyDoBaoNghi, noiDungBaoNghi } from "@/lib/portal/hoc-bu-thuan";
import { portalDb, portalTx } from "@/lib/portal/db";
import { getStudentUpcomingSessions } from "@/lib/portal/learning";
import { getStudentMakeup } from "@/lib/portal/makeup";
import { REQUEST_TYPE_LABEL, nhanTrangThaiYeuCau } from "@/lib/portal/request-labels";
import { kiemDongChoYeuCau } from "@/lib/portal/yeu-cau-bu";
import { nhanGio, nhanMocDeXuat, nhanNgayDayDu } from "@/lib/portal/yeu-cau-hien-thi";
import { docCoSoCoTheChuyen, docLuotBuChoCon } from "@/lib/portal/yeu-cau-hub";
import {
  CHU_DE_KHAC,
  KHUNG_GIO_MONG_MUON,
  LY_DO_BAO_LUU,
  ghepNgayGio,
  loiDeXuatBu,
  noiDungYeuCau,
  type SlugYeuCau,
} from "@/lib/portal/yeu-cau-loai";
import { rateLimit } from "@/lib/rate-limit";
import { parseVnDateTimeLocal, parseVnYmd, vnYmd } from "@/lib/time/vn";

import { NGAY_TRONG_TUAN_MONG_MUON, type GuiYeuCauInput } from "../schema/yeu-cau";
import { ghepDoiCoSo, ghepDoiLop } from "../yeu-cau-d01";
import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile } from "../xac-thuc/dich-vu";

/**
 * B4.8 — «Gửi yêu cầu đến trung tâm» cho app (sáu loại: học bù · xin nghỉ · bảo lưu · chuyển lớp · chuyển cơ sở · khác).
 *
 * DÙNG LẠI nghiệp vụ của web, không đặt luật mới: cùng bảng `ParentRequest`, cùng cổng dòng cần bù (`kiemDongChoYeuCau`), cùng đường rút đơn đã tiếp nhận
 * (`rutDonXinNghiDaTiepNhan`), cùng sự kiện `parent_request.created` (Sale + quản lý cơ sở nhận thông báo như đơn gửi từ web), cùng trần 10 đơn đang chờ + 5 đơn / 10 phút.
 * Phụ huynh chỉ GỬI YÊU CẦU — không có đường nào ở đây tự đổi lịch, tự bảo lưu hay tự chuyển lớp (đúng web).
 *
 * ⚠️ Vì sao phần điều phối KHÔNG gọi thẳng Server Action của web: `createParentRequest` đọc «con đang chọn» từ cookie và trả chuỗi lỗi; lưới `[PHW-02]` / `[YCL-*]` ghim
 * VĂN BẢN của tệp đó nên rút lõi ra khỏi tệp là phải viết lại lưới. Ba cổng giữ ở đây GIỐNG HỆT web và có lưới ghim hai bên bằng nhau (`[YCM-W1]`): trần đang chờ, rate-limit,
 * cổng buổi / dòng cần bù. Nợ kỹ thuật (không phải quyết định của chủ dự án): hợp nhất hai bản về một lõi ở `lib/portal/` khi sửa lưới cùng lúc.
 *
 * KHÔNG idempotency theo khoá client (cần cột mới ⇒ migration): thay bằng khử trùng theo NỘI DUNG — cùng phụ huynh + con + loại + nội dung + buổi/dòng đang CHỜ, gửi lại trong 5 phút ⇒ trả đơn đã có
 * (`trungLap: true`) thay vì tạo đơn thứ hai (app gửi lại sau khi mất mạng không nhân đôi đơn).
 */
export const TRAN_DON_DANG_CHO = 10; // ⚠️ bằng MAX_PENDING_REQUESTS ở app/(portal)/portal/yeu-cau/actions.ts — [YCM-W1]
const GIOI_HAN_GUI = { max: 5, windowMs: 10 * 60_000 } as const; // ⚠️ bằng cấu hình rateLimit ở cùng tệp — [YCM-W1]
const CUA_SO_TRUNG_LAP_MS = 5 * 60_000;

export const SLUG_THEO_LOAI: Record<ParentRequestType, SlugYeuCau> = {
  MAKEUP: "hoc-bu",
  ABSENCE: "nghi",
  RESERVE: "bao-luu",
  TRANSFER_CLASS: "doi-lop",
  TRANSFER_CENTER: "doi-co-so",
  OTHER: "khac",
  CONSENT_CHANGE: "khac",
};

/** Mã lỗi: từ chối nghiệp vụ ⇒ `VALIDATION` (app in nguyên câu của máy chủ; 409 = trạng thái hiện tại không cho phép, 400 = dữ liệu sai); chạm trần tần suất ⇒ `RATE_LIMITED`. */
const LOI_YEU_CAU = (code: "VALIDATION" | "RATE_LIMITED" | "NOT_FOUND", status: number, msg: string, maChiTiet?: string) => new LoiApiMobile(code, status, msg, undefined, maChiTiet);

// ─── Đọc ─────────────────────────────────────────────────────────────────────

export type DongDaGuiDto = {
  id: string;
  loai: SlugYeuCau;
  nhanLoai: string;
  trangThai: ParentRequestStatus;
  nhanTrangThai: string;
  noiDung: string;
  phanHoi: string | null;
  ngayGui: string;
  chiTiet: Array<{ nhan: string; giaTri: string }>;
  /** Hành động phụ huynh được làm trên đơn này (máy chủ kiểm lại khi bấm). `null` = không có. */
  hanhDong: { kieu: "huy" | "rut"; nhan: string } | null;
};

export type BuoiCanBuDto = {
  id: string;
  tenBuoi: string;
  ngayVang: string | null;
  lyDo: string;
  lop: string | null;
  /** CAN_BU = được gửi yêu cầu · CHO_XEP = đã gửi, chờ trung tâm xếp · DA_XEP = đã có giờ bù. */
  trangThai: "CAN_BU" | "CHO_XEP" | "DA_XEP";
  lichBu: string | null;
};

export type YeuCauDto = {
  tenCon: string;
  daGui: DongDaGuiDto[];
  tuyChon: {
    homNay: string;
    buoiSapToi: Array<{ id: string; nhan: string }>;
    buoiCanBu: BuoiCanBuDto[];
    coSoDich: Array<{ id: string; ten: string; diaChi: string }>;
    luotBu: { tong: number; dung: number; giu: number; con: number } | null;
    lyDoNghi: readonly string[];
    lyDoBaoLuu: readonly string[];
    khungGio: readonly string[];
    /** D01-CL/CCS: các ngày trong tuần phụ huynh được chọn (nhiều ngày); trung tâm nghỉ Thứ Hai. */
    ngayTrongTuan: readonly string[];
    chuDe: readonly string[];
  };
};

const nhanNgayDM = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return nhanNgayDayDu(d).split(", ")[1]!.slice(0, 5);
};

/** Con của phụ huynh ⇒ `portalDb` (cách ly sở hữu ở tầng truy vấn). `hs` đã qua `kiemHocVienCuaPhuHuynh`. */
async function nguCanhPhuHuynh(parentUserId: string, hs: MaHocVienDaKiem) {
  const con = await db.student.findMany({ where: { parentUserId, deletedAt: null }, select: { id: true, name: true, centerId: true } });
  const ten = con.find((c) => c.id === hs);
  if (!ten) throw LOI_YEU_CAU("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");
  return { pdb: portalDb({ parentUserId, childIds: con.map((c) => c.id) }), tenCon: ten.name, centerId: ten.centerId ?? null };
}

export async function layYeuCau(hs: MaHocVienDaKiem, parentUserId: string, now: Date = new Date()): Promise<YeuCauDto> {
  const { pdb, tenCon, centerId } = await nguCanhPhuHuynh(parentUserId, hs);
  const [requests, makeup, luot, buoiSapToi, coSoDich] = await Promise.all([
    pdb.parentRequest.findMany({
      where: { studentId: hs },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, type: true, status: true, content: true, preferredDate: true, sessionId: true, response: true, reserveId: true, createdAt: true },
    }),
    getStudentMakeup(hs),
    docLuotBuChoCon(hs),
    getStudentUpcomingSessions(hs),
    docCoSoCoTheChuyen(centerId),
  ]);

  const maBuoi = [...new Set(requests.map((x) => x.sessionId).filter((x): x is string => !!x))];
  const buoi = maBuoi.length ? await pdb.classSession.findMany({ where: { id: { in: maBuoi } }, select: { id: true, date: true } }) : [];
  const ngayBuoi = new Map(buoi.map((b) => [b.id, b.date]));

  const daGui: DongDaGuiDto[] = requests.map((r) => {
    const ngay = r.sessionId ? ngayBuoi.get(r.sessionId) : undefined;
    const chiTiet: Array<{ nhan: string; giaTri: string }> = [];
    if (r.type === "ABSENCE" && ngay) chiTiet.push({ nhan: "Buổi con nghỉ", giaTri: `${nhanNgayDayDu(ngay)} · ${nhanGio(ngay)}` });
    // D01: chuyển lớp / chuyển cơ sở / bảo lưu — `preferredDate` là NGÀY MUỐN BẮT ĐẦU (đầu ngày VN), hiện cạnh trạng thái để phụ huynh thấy mình đã đề xuất gì.
    if ((r.type === "TRANSFER_CLASS" || r.type === "TRANSFER_CENTER" || r.type === "RESERVE") && r.preferredDate) {
      chiTiet.push({ nhan: r.type === "RESERVE" ? "Dự kiến bắt đầu bảo lưu" : "Muốn chuyển từ ngày", giaTri: nhanNgayDayDu(r.preferredDate) });
    }
    if (r.type === "MAKEUP") {
      if (ngay) chiTiet.push({ nhan: "Buổi con đã vắng", giaTri: nhanNgayDayDu(ngay) });
      const dx = nhanMocDeXuat(r.preferredDate);
      if (dx) chiTiet.push({ nhan: "Ba mẹ đề xuất bù", giaTri: dx });
    }
    // Giống web: rút đơn xin nghỉ khi đơn đang chờ HOẶC đã được tiếp nhận và buổi còn ở tương lai; các loại khác chỉ huỷ khi còn chờ. Máy chủ kiểm lại khi bấm.
    const conRut = r.type === "ABSENCE" && (r.status === "PENDING" || r.status === "APPROVED") && !!ngay && ngay.getTime() > now.getTime();
    const hanhDong: DongDaGuiDto["hanhDong"] =
      conRut && r.status === "APPROVED"
        ? { kieu: "rut", nhan: "Rút đơn xin nghỉ" }
        : r.status === "PENDING"
          ? r.type === "ABSENCE"
            ? { kieu: "rut", nhan: "Rút đơn" }
            : { kieu: "huy", nhan: "Huỷ yêu cầu" }
          : null;
    return {
      id: r.id,
      loai: SLUG_THEO_LOAI[r.type],
      nhanLoai: REQUEST_TYPE_LABEL[r.type],
      trangThai: r.status,
      nhanTrangThai: r.type === "ABSENCE" && r.status === "APPROVED" ? "Đã tiếp nhận" : nhanTrangThaiYeuCau(r),
      noiDung: r.content,
      phanHoi: r.response,
      ngayGui: formatDateVN(r.createdAt),
      chiTiet,
      hanhDong,
    };
  });

  const dong = [...makeup.needList, ...makeup.history.filter((h) => h.status === "SCHEDULED")];
  const buoiCanBu: BuoiCanBuDto[] = dong.map((n) => ({
    id: n.id,
    tenBuoi: n.lessonTitle,
    ngayVang: nhanNgayDM(n.missedDate),
    lyDo: n.reason,
    lop: n.className || null,
    trangThai: n.status === "SCHEDULED" ? (n.buoiBu ? "DA_XEP" : "CHO_XEP") : n.yeuCauMo ? "CHO_XEP" : "CAN_BU",
    lichBu: n.buoiBu?.nhanNgay ?? null,
  }));

  return {
    tenCon,
    daGui,
    tuyChon: {
      homNay: vnYmd(now),
      buoiSapToi: buoiSapToi.map((s) => ({ id: s.id, nhan: `${s.nhanNgay} · ${s.className} — ${s.nhan}` })),
      buoiCanBu,
      coSoDich: coSoDich.map((c) => ({ id: c.id, ten: c.ten, diaChi: c.diaChi })),
      luotBu: luot,
      lyDoNghi: lyDoBaoNghi,
      lyDoBaoLuu: LY_DO_BAO_LUU,
      khungGio: KHUNG_GIO_MONG_MUON,
      ngayTrongTuan: NGAY_TRONG_TUAN_MONG_MUON,
      chuDe: CHU_DE_KHAC,
    },
  };
}

// ─── Gửi ─────────────────────────────────────────────────────────────────────

export type KetQuaGuiDto = { id: string; trungLap: boolean };

type DonDaChuan = {
  type: ParentRequestType;
  content: string;
  preferredDate: Date | null;
  sessionId: string | null;
  makeupNeedId: string | null;
};

export async function guiYeuCau(hs: MaHocVienDaKiem, parentUserId: string, input: GuiYeuCauInput, now: Date = new Date()): Promise<KetQuaGuiDto> {
  const { pdb, centerId } = await nguCanhPhuHuynh(parentUserId, hs);

  // ⚠️ NGUYÊN TỬ THEO PHỤ HUYNH (BR-REQ-01): «đếm trần → khử trùng → tạo» là kiểm-rồi-ghi. Không khoá thì N lượt gửi cùng lúc cùng thấy «còn chỗ» / «chưa có đơn trùng» rồi cùng tạo
  // (vượt trần 10 đơn; nhân đôi đơn khi app gửi lại đua với lượt đầu). Khoá tư vấn mức GIAO DỊCH theo phụ huynh làm các lượt của CÙNG một phụ huynh xếp hàng; không cần migration.
  // Thứ tự lỗi giữ nguyên: trần (409) → dữ liệu sai (400) → trùng (trungLap) → tần suất (429).
  // ⚠️ Trong giao dịch CHỈ dùng `tx` (không gọi `pdb` / `db`): kết nối của app có trần nhỏ (`connection_limit`); giữ một kết nối giao dịch rồi xin thêm kết nối thứ hai là cạn pool khi nhiều phụ huynh gửi cùng lúc.
  // Vì vậy trần được kiểm HAI lần: lần ngoài (nhanh, giữ đúng thứ tự lỗi) và lần TRONG khoá (quyết định thật, nguyên tử).
  await kiemTranDonCho(() => pdb.parentRequest.count({ where: { parentUserId, status: "PENDING" } }));
  const don = await chuanHoaDon(pdb, hs, centerId, input, now);

  return portalTx(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`parent-request:${parentUserId}`}, 0))`;
    await kiemTranDonCho(() => tx.parentRequest.count({ where: { parentUserId, status: "PENDING" } }));

    // Khử trùng theo nội dung (thay idempotency-key): gửi lại y hệt trong 5 phút ⇒ trả đơn đã có, KHÔNG đếm rate-limit, KHÔNG tạo đơn thứ hai.
    const trung = await tx.parentRequest.findFirst({
      where: {
        studentId: hs,
        parentUserId,
        type: don.type,
        status: "PENDING",
        content: don.content,
        sessionId: don.sessionId,
        makeupNeedId: don.makeupNeedId,
        createdAt: { gte: new Date(now.getTime() - CUA_SO_TRUNG_LAP_MS) },
      },
      select: { id: true },
    });
    if (trung) return { id: trung.id, trungLap: true };

    // Cổng 2 — rate limit theo phụ huynh (cùng khoá với web: gửi từ web lẫn app cộng chung một hạn mức).
    const rl = await rateLimit({ key: `parent-request:${parentUserId}`, max: GIOI_HAN_GUI.max, windowMs: GIOI_HAN_GUI.windowMs });
    if (!rl.success) throw LOI_YEU_CAU("RATE_LIMITED", 429, "Bạn gửi yêu cầu quá nhanh. Vui lòng thử lại sau ít phút.");

    // Tạo đơn + phát sự kiện CÙNG giao dịch (outbox): rollback ⇒ không có sự kiện; commit ⇒ Sale/quản lý cơ sở nhận thông báo.
    const req = await tx.parentRequest.create({
      data: { studentId: hs, parentUserId, type: don.type, content: don.content, preferredDate: don.preferredDate, sessionId: don.sessionId, makeupNeedId: don.makeupNeedId, status: "PENDING" },
      select: { id: true },
    });
    await publishEvent(
      "parent_request.created",
      { requestId: req.id, studentId: hs, centerId, type: don.type, parentUserId },
      { tx, dedupeKey: `parent_request.created:${req.id}` },
    );
    return { id: req.id, trungLap: false };
  });
}

type Pdb = ReturnType<typeof portalDb>;

/** Cổng 1 — trần đơn đang chờ (chỉ đếm PENDING). Hàm đếm do nơi gọi truyền: `pdb` (kiểm nhanh ngoài giao dịch) hoặc `tx` (kiểm nguyên tử trong khoá). */
async function kiemTranDonCho(demDon: () => Promise<number>): Promise<void> {
  const dangCho = await demDon();
  if (dangCho >= TRAN_DON_DANG_CHO) {
    throw LOI_YEU_CAU("VALIDATION", 409, "Bạn đang có quá nhiều yêu cầu chờ xử lý. Vui lòng đợi trung tâm phản hồi hoặc huỷ bớt yêu cầu cũ trước khi gửi thêm.", "QUA_NHIEU_YEU_CAU_CHO");
  }
}

async function chuanHoaDon(pdb: Pdb, hs: MaHocVienDaKiem, centerId: string | null, input: GuiYeuCauInput, now: Date): Promise<DonDaChuan> {
  const sai = (m: string) => LOI_YEU_CAU("VALIDATION", 400, m);
  const ghiChu = ("ghiChu" in input ? input.ghiChu : undefined) ?? "";

  switch (input.loai) {
    case "nghi": {
      // Cổng buổi (FIX-C3 của web): buổi phải SẮP TỚI, chưa huỷ, thuộc lớp con đang học (ghi danh còn sống).
      const sess = await pdb.classSession.findFirst({
        where: {
          id: input.buoiId,
          date: { gte: now },
          status: { not: "CANCELLED" },
          class: { enrollments: { some: { studentId: hs, status: { in: ["CONFIRMED", "STUDYING", "ACTIVE"] }, deletedAt: null } } },
        },
        select: { id: true, date: true },
      });
      if (!sess) throw sai("Buổi học không hợp lệ");
      return {
        type: "ABSENCE",
        sessionId: sess.id,
        makeupNeedId: null,
        preferredDate: sess.date,
        content: noiDungBaoNghi({ lyDo: input.lyDo ?? lyDoBaoNghi[0], ghiChu, muonBu: input.muonBu ?? true }),
      };
    }
    case "hoc-bu": {
      const kiem = await kiemDongChoYeuCau(pdb, { studentId: hs, needId: input.nhuCauBuId });
      if (!kiem.ok) throw LOI_YEU_CAU("VALIDATION", 409, kiem.error, "YEU_CAU_KHONG_HOP_LE");
      const loi = loiDeXuatBu(input.ngay, input.gio, vnYmd(now));
      const dx = ghepNgayGio(input.ngay, input.gio);
      const ngayGio = dx ? parseVnDateTimeLocal(dx) : null;
      if (loi || !ngayGio) throw sai(loi ?? "Ba mẹ chọn ngày và giờ giúp nhé.");
      if (ngayGio.getTime() < now.getTime() - 60_000) throw sai("Thời gian đề xuất đã qua — ba mẹ chọn một thời điểm sắp tới nhé.");
      const makeup = await getStudentMakeup(hs);
      const tenBuoi = [...makeup.needList, ...makeup.history].find((n) => n.id === input.nhuCauBuId)?.lessonTitle ?? "buổi vắng";
      return {
        type: "MAKEUP",
        sessionId: kiem.sessionId,
        makeupNeedId: input.nhuCauBuId,
        preferredDate: ngayGio,
        content: ghiChu.length >= 5 ? ghiChu : `Xin học bù ${tenBuoi}`,
      };
    }
    case "bao-luu": {
      if (input.ngay && input.ngay < vnYmd(now)) throw sai("Ngày bảo lưu đã qua — ba mẹ chọn một ngày sắp tới nhé.");
      const ngay = input.ngay ? parseVnYmd(input.ngay) : null;
      if (input.ngay && (!ngay || vnYmd(ngay) !== input.ngay)) throw sai("Ngày chưa đúng dạng"); // `parseVnYmd` để tràn ngày không có thật (2026-13-45) — kiểm vòng tròn
      return {
        type: "RESERVE",
        sessionId: null,
        makeupNeedId: null,
        preferredDate: ngay,
        content: noiDungYeuCau([`Xin bảo lưu. Lý do: ${input.lyDo}.`, input.ngay && `Dự kiến từ ${input.ngay.split("-").reverse().join("/")}.`, ghiChu && `Ghi chú: ${ghiChu}`]),
      };
    }
    case "doi-lop": {
      // D01-CL: nhiều ngày + khung giờ + ngày muốn bắt đầu + ghi chú. CHỈ tạo yêu cầu — trung tâm kiểm lớp/lịch/sĩ số rồi mới đổi.
      const g = ghepDoiLop(input, vnYmd(now));
      if (!g.ok) throw sai(g.loi);
      return { type: "TRANSFER_CLASS", sessionId: null, makeupNeedId: null, preferredDate: g.preferredDate, content: g.content };
    }
    case "doi-co-so": {
      // Web chỉ kiểm ở trình duyệt (danh sách có sẵn); ở đây kiểm lại ở máy chủ: chỉ cơ sở CÓ THỂ chuyển tới (đang có lớp, khác cơ sở hiện tại).
      const cs = (await docCoSoCoTheChuyen(centerId)).find((c) => c.id === input.coSoId);
      if (!cs) throw sai("Ba mẹ chọn cơ sở muốn chuyển đến nhé.");
      // D01-CCS: cơ sở đích + ngày + khung giờ + ghi chú. CHỈ tạo yêu cầu — không tự chuyển cơ sở.
      const g = ghepDoiCoSo({ ...input, tenCoSo: cs.ten, diaChiCoSo: cs.diaChi }, vnYmd(now));
      if (!g.ok) throw sai(g.loi);
      return { type: "TRANSFER_CENTER", sessionId: null, makeupNeedId: null, preferredDate: g.preferredDate, content: g.content };
    }
    case "khac":
      return {
        type: "OTHER",
        sessionId: null,
        makeupNeedId: null,
        preferredDate: null,
        content: noiDungYeuCau([`Chủ đề: ${input.chuDe ?? CHU_DE_KHAC[CHU_DE_KHAC.length - 1]}.`, input.ghiChu]),
      };
  }
}

// ─── Huỷ / rút ───────────────────────────────────────────────────────────────

export async function huyYeuCau(hs: MaHocVienDaKiem, parentUserId: string, requestId: string): Promise<{ daXong: true }> {
  const { pdb } = await nguCanhPhuHuynh(parentUserId, hs);
  const req = await pdb.parentRequest.findUnique({ where: { id: requestId }, select: { studentId: true, type: true, status: true } });
  // Đơn của con KHÁC (kể cả con khác của cùng phụ huynh) hay đơn không tồn tại ⇒ cùng 404: endpoint theo MỘT con, không dò được đơn ngoài con đó.
  if (!req || req.studentId !== hs) throw LOI_YEU_CAU("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

  if (req.type === "ABSENCE" && req.status === "APPROVED") {
    const kq = await rutDonXinNghiDaTiepNhan({ requestId, studentId: hs });
    if (!kq.ok) throw LOI_YEU_CAU("VALIDATION", 409, kq.error, "YEU_CAU_KHONG_HOP_LE");
    return { daXong: true };
  }
  // Nguyên tử: chỉ huỷ khi CÒN PENDING (tránh ghi đè APPROVED/REJECTED do nhân viên vừa xử lý).
  const u = await pdb.parentRequest.updateMany({ where: { id: requestId, status: "PENDING" }, data: { status: "CANCELLED" } });
  if (u.count === 0) throw LOI_YEU_CAU("VALIDATION", 409, "Chỉ huỷ được yêu cầu đang chờ xử lý", "YEU_CAU_KHONG_CON_CHO");
  return { daXong: true };
}
