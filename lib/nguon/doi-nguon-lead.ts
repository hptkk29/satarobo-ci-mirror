/**
 * lib/nguon/doi-nguon-lead.ts — ĐỔI NGUỒN có kiểm soát cho MỘT lead (03 §3). Phần GHI của `doi-nguon.ts` (quyết định thuần).
 *
 * ── Thứ tự không đảo được ────────────────────────────────────────────────────────────────────────────────
 *  1. LEAD qua `scopedDb(actor)` + `passesScope` TRƯỚC mọi thứ khác. `taoNguonBanDau`/`doiNguon` nhận `leadId` TRẦN + `tx`
 *     KHÔNG scope và không kiểm cơ sở (ghi không tự scope) — nên cổng cơ sở đứng NGOÀI chúng, ở đây (05 SRC-24 vế c).
 *     Lead của cơ sở khác ⇒ trả y hệt "không tồn tại": 0 dòng đổi, 0 AuditLog, câu lỗi không lộ nhóm/người.
 *  2. Quyền hỏi qua `kiemQuyen` (đường thật là `checkPermission` → `can()`): KHÔNG so vai/centerId tại chỗ (luật Nền #1).
 *  3. Mọi quyết định (đã thu tiền chưa, có khoá không, gian lận) đọc LẠI TRONG transaction, TRƯỚC phép ghi đầu tiên; từ
 *     chối = `return` khi CHƯA ghi gì (luật rollback). Phép ghi duy nhất có điều kiện là `doiNguon` (khoá lạc quan theo
 *     `updatedAt`): hai lượt song song ⇒ đúng một thắng, lượt kia nhận `nguonVuaDoi`.
 *  4. Đổi SAU thực thu ⇒ phát DomainEvent `nguon.da-doi-sau-thanh-toan` CÙNG transaction. **KHÔNG tạo Adjustment, KHÔNG đụng sổ
 *     hoa hồng** — engine (PR5) nghe sự kiện này. Sổ hoa hồng mới chưa tồn tại ở PR2 nên `daCoDongSo` luôn false.
 *
 * "Đã thanh toán" TÍNH tại lúc đổi từ `WHERE_THUC_THU` (không cắm cờ vào `lib/payments`, không chạm R7).
 */
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { publishEvent } from "@/lib/events/publish";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";
import { canonicalPhone } from "@/lib/phone";
import { docAnhChupNhanSu, docSaleCuaPhuHuynh } from "./anh-chup-db";
import { ANH_CHUP_TRONG, type AnhChupNguon } from "./tin-hieu";
import { quyenDoiNguon, quyetDinhDoiNguon, type TruongLoi } from "./doi-nguon";
import { danhTinhNguoiNhan, danhTinhTu, phatHienGianLan, type CoGianLan } from "./gian-lan";
import { chupNguon } from "./nguon-chup";
import { layCuaSoGhiCongNgay } from "./feature";
import { doiNguon, ghiTouchpoint, NguonError, type DuLieuDoiNguon } from "./ghi-nguon";
import { trongKhoangHieuLuc } from "./hieu-luc-nguon";
import { thamChieuSangNguoi, type ThamChieuNguon } from "./kiem-nguon";

/** Hỏi quyền theo khoá + đối tượng. Đường thật: `(a, t) => checkPermission(a, t)`. */
export type KiemQuyen = (action: string, target: { centerId: string | null; orgUnitId: string | null }) => Promise<boolean>;

export type KetQuaDoiNguonLead =
  | { ok: true; canDieuChinh: boolean; action: "DOI_NGUON" | "DOI_NGUON_SAU_THU" | "BO_SUNG_NGUOI" }
  | { ok: false; loi: string; truong: TruongLoi | "lead" | "nguonVuaDoi" };

/** Lead không thấy được / không tồn tại — MỘT câu duy nhất cho cả hai ca (không lộ tồn tại, không lộ nhóm/người). */
const KHONG_THAY: KetQuaDoiNguonLead = { ok: false, loi: "Lead không tồn tại.", truong: "lead" };

const NGUON_VUA_DOI: KetQuaDoiNguonLead = {
  ok: false,
  loi: "Nguồn của lead vừa được người khác thay đổi — hãy tải lại rồi thử lại.",
  truong: "nguonVuaDoi",
};

type DoiTuongJson = Record<string, unknown>;
const laDoiTuong = (v: unknown): v is DoiTuongJson => typeof v === "object" && v !== null && !Array.isArray(v);

/** Người giới thiệu phải TỒN TẠI và còn được claim MỚI (D13: nhân viên đã nghỉ thì không). */
async function kiemNguoiTonTai(t: ThamChieuNguon | null): Promise<string | null> {
  if (!t) return null;
  if (t.employeeId) {
    const e = await db.employee.findUnique({ where: { id: t.employeeId }, select: { status: true } });
    return e && (e.status === "ACTIVE" || e.status === "ON_LEAVE") ? null : "Nhân sự giới thiệu không còn làm việc hoặc không tồn tại.";
  }
  if (t.parentUserId || t.studentId) {
    const [u, s] = await Promise.all([
      t.parentUserId ? db.user.findFirst({ where: { id: t.parentUserId, deletedAt: null }, select: { id: true } }) : Promise.resolve(true),
      t.studentId ? db.student.findFirst({ where: { id: t.studentId, deletedAt: null }, select: { id: true } }) : Promise.resolve(true),
    ]);
    return u && s ? null : "Phụ huynh giới thiệu không tồn tại.";
  }
  if (t.affiliateId) {
    const a = await db.affiliate.findFirst({ where: { id: t.affiliateId, isActive: true }, select: { id: true } });
    return a ? null : "Đối tác giới thiệu không tồn tại hoặc đã tắt.";
  }
  return null;
}

type NhomDich = {
  id: string;
  code: string;
  status: string;
  selectable: boolean;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  requiresNote: boolean;
  referrerRequirement: "NONE" | "PARENT" | "EMPLOYEE" | "AFFILIATE_ORG" | "EVENT";
  /** Thuộc tính đi vào BẢN CHỤP `signals.nguon` — đọc LẠI trong transaction sau khi khoá nhóm (FOR SHARE), không tin bản đọc trước transaction. */
  attributionWindowDays: number | null;
  ownerEmployeeId: string | null;
};

const CHON_NHOM_DICH = { id: true, code: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true, requiresNote: true, referrerRequirement: true, attributionWindowDays: true, ownerEmployeeId: true } as const;

/** SĐT nhân viên (mọi cơ sở, mọi `status`) → employeeId — tra bằng `db` KHÔNG scope (T11). */
async function sdtNhanVien(): Promise<Map<string, string>> {
  const [emp, usr] = await Promise.all([
    db.employee.findMany({ where: { phone: { not: null } }, select: { id: true, phone: true } }),
    db.user.findMany({ where: { employeeId: { not: null }, phone: { not: null } }, select: { employeeId: true, phone: true } }),
  ]);
  const m = new Map<string, string>();
  for (const e of emp) {
    const c = canonicalPhone(e.phone);
    if (c !== null) m.set(c, e.id);
  }
  for (const u of usr) {
    const c = canonicalPhone(u.phone);
    if (c !== null && u.employeeId) m.set(c, u.employeeId);
  }
  return m;
}

export async function doiNguonLead(p: {
  actor: Actor;
  /** Tên hiển thị của người đổi (vào AuditLog). */
  actorName: string;
  kiemQuyen: KiemQuyen;
  leadId: string;
  groupId: string;
  thamChieu: ThamChieuNguon | null;
  giaiTrinh: string | null;
  lyDo: string | null;
  /**
   * Mốc `LeadAttribution.updatedAt` mà NGƯỜI DÙNG ĐÃ NHÌN THẤY khi mở Sheet (ISO từ `docChoGanNguon.nguon.capNhatLuc`).
   * Khác khoá lạc quan của `doiNguon` (đọc LẠI trong transaction — chỉ chặn hai lượt ghi đua nhau): cái này chặn quyết định
   * dựa trên MÀN HÌNH CŨ ("tôi đổi từ A sang B" trong khi người khác vừa đổi A sang C). Có mặt mà lệch ⇒ `nguonVuaDoi`.
   * Đường gọi không có màn hình (script, test) truyền `undefined`.
   */
  daThayCapNhatLuc?: Date;
  /**
   * Sale phụ trách phụ huynh do NGƯỜI CHỌN TAY (đường thoát của hold `THIEU_SALE_PHU_HUYNH`, res3 MEDIUM-6): thay cho phép tra tự động (`docSaleCuaPhuHuynh`) vốn đã trả null. Chỉ ĐIỀN CHỖ TRỐNG — first-claim:
   * dòng quy nguồn phải đang là PHỤ HUYNH giới thiệu, cùng nguồn, cùng phụ huynh, và `referrerSaleUserId IS NULL`; Sale đã ghi nhận không bao giờ bị thay bằng đường này. Sale được chọn đi qua
   * ĐÚNG các cổng của người giới thiệu: phải là nhân sự còn làm việc (D13) và không trùng chủ lead (TU_CLAIM). Vắng = tra tự động như cũ.
   */
  saleTay?: { userId: string } | null;
  /** Thời điểm tính vai hiệu lực của người giới thiệu (D5). BẮT BUỘC — hàm không đọc đồng hồ (luật 19). */
  bayGio: Date;
}): Promise<KetQuaDoiNguonLead> {
  // 1. CƠ SỞ — lead qua scopedDb + passesScope, TRƯỚC mọi thứ.
  const lead = await scopedDb(p.actor).lead.findUnique({
    where: { id: p.leadId },
    select: { id: true, centerId: true, orgUnitId: true, phone: true, assignedToId: true, convertedById: true, adminId: true },
  });
  if (!lead || !passesScope("Lead", lead, p.actor)) return KHONG_THAY;

  // 2. QUYỀN qua can() (kiemQuyen) — ba khoá, một lượt.
  const target = { centerId: lead.centerId, orgUnitId: lead.orgUnitId };
  const [overwrite, overrideSauThanhToan, quanLyNguon] = await Promise.all([
    p.kiemQuyen("leads:overwrite", target),
    p.kiemQuyen("sources:override-after-payment", target),
    p.kiemQuyen("sources:manage", target),
  ]);

  // 2b. Người KHÔNG có khoá nguồn nào thì dừng NGAY — trước mọi tra cứu theo id họ gửi. Không thì câu lỗi đổi theo id
  // ("Nguồn mới không tồn tại." / "Nhân sự giới thiệu …") và người xem lead nhưng không có quyền dò được id nào có thật.
  // Câu từ chối lấy từ CHÍNH `quyenDoiNguon` (đã thu ⇒ nói "đã có khoản thu"), nên không đổi lời với ai. Không để dấu vết
  // `DOI_NGUON_BI_CHAN` (cổng đó vốn chỉ dành cho người có ít nhất một khoá — xem bên dưới).
  if (!overwrite && !overrideSauThanhToan && !quanLyNguon) {
    const daThu = (await db.payment.count({ where: { ...WHERE_THUC_THU, order: { leadId: p.leadId, deletedAt: null } } })) > 0;
    const q = quyenDoiNguon({ daCoThucThu: daThu, nguonDangKhoa: false, quyen: { overwrite, overrideSauThanhToan, quanLyNguon } });
    if (!q.ok) return { ok: false, loi: q.loi, truong: "quyen" };
  }

  // 3. Dữ liệu tra (đọc, không scope): nhóm mới, người, SĐT nhân viên, hồ sơ nhân viên của actor.
  const nhomGui = await db.leadSourceGroup.findUnique({ where: { id: p.groupId }, select: CHON_NHOM_DICH });
  if (!nhomGui) return { ok: false, loi: "Nguồn mới không tồn tại.", truong: "nguon" };
  const loiNguoi = await kiemNguoiTonTai(p.thamChieu);
  if (loiNguoi) return { ok: false, loi: loiNguoi, truong: "thamChieu" };
  // Nhóm GHI = nhóm đã chọn (SPEC nguồn động §2 V1) — KHÔNG ghi đè theo vai nhân sự. Vai chỉ là ảnh chụp (bên dưới).
  const groupIdGhi = nhomGui.id;
  // ẢNH CHỤP người giới thiệu MỚI tại `bayGio`: nhân sự ⇒ vai + dấu vết; phụ huynh ⇒ Sale phụ trách PH lúc này. Đọc TRƯỚC transaction (không scope).
  let anhChupMoi: AnhChupNguon = p.thamChieu?.employeeId
    ? await docAnhChupNhanSu(db, p.thamChieu.employeeId, p.bayGio)
    : p.thamChieu && (p.thamChieu.parentUserId || p.thamChieu.studentId)
      ? { ...ANH_CHUP_TRONG, referrerSaleUserId: await docSaleCuaPhuHuynh(db, { studentId: p.thamChieu.studentId, parentUserId: p.thamChieu.parentUserId }, p.bayGio) }
      : ANH_CHUP_TRONG;
  if (p.saleTay) {
    if (!p.thamChieu || p.thamChieu.employeeId || p.thamChieu.affiliateId || !(p.thamChieu.parentUserId || p.thamChieu.studentId)) {
      return { ok: false, loi: "Chỉ bổ sung Sale phụ trách cho lead do PHỤ HUYNH giới thiệu.", truong: "thamChieu" };
    }
    // Sale chọn tay đi qua cổng D13 như nhân sự giới thiệu: phải có hồ sơ nhân sự còn làm việc (người nghỉ không nhận hoa hồng MỚI).
    const u = await db.user.findFirst({ where: { id: p.saleTay.userId, deletedAt: null }, select: { employee: { select: { status: true } } } });
    if (!u?.employee || (u.employee.status !== "ACTIVE" && u.employee.status !== "ON_LEAVE")) {
      return { ok: false, loi: "Sale được chọn không còn làm việc hoặc không có hồ sơ nhân sự.", truong: "thamChieu" };
    }
    anhChupMoi = { ...anhChupMoi, referrerSaleUserId: p.saleTay.userId };
  }
  const thieuSalePh = !!p.thamChieu && !p.thamChieu.employeeId && !p.thamChieu.affiliateId && (!!p.thamChieu.parentUserId || !!p.thamChieu.studentId) && anhChupMoi.referrerSaleUserId === null;
  // CHỦ CỦA LEAD (res3-1): người bấm · người chăm · người chốt đơn · Sale Admin — engine trả tiền Sale theo `convertedById`/`adminId`, không theo `assignedToId`.
  const idChuLead = [...new Set([p.actor.userId, lead.assignedToId, lead.convertedById, lead.adminId].filter((x): x is string => !!x))];
  const [mapSdt, chuLeadUsers, nguoiMoiEmp, cuaSoMacDinhNgay] = await Promise.all([
    sdtNhanVien(),
    db.user.findMany({ where: { id: { in: idChuLead } }, select: { id: true, employeeId: true } }),
    p.thamChieu?.employeeId
      ? db.employee.findUnique({ where: { id: p.thamChieu.employeeId }, select: { phone: true } })
      : Promise.resolve(null),
    layCuaSoGhiCongNgay(),
  ]);
  const chuLead = danhTinhTu({ userIds: idChuLead, employeeIds: chuLeadUsers.map((u) => u.employeeId) });
  const nguoiMoi = p.thamChieu ? thamChieuSangNguoi(p.thamChieu) : null;

  try {
    return await db.$transaction(async (tx): Promise<KetQuaDoiNguonLead> => {
      // 4. Đọc LẠI trong transaction — mọi quyết định đứng TRƯỚC phép ghi đầu tiên.
      const cu = await tx.leadAttribution.findUnique({
        where: { leadId: p.leadId },
        include: { group: { select: { code: true } } },
      });
      if (!cu) return { ok: false, loi: "Lead chưa có quy nguồn — chưa đổi được.", truong: "lead" };
      if (p.daThayCapNhatLuc && p.daThayCapNhatLuc.getTime() !== cu.updatedAt.getTime()) return NGUON_VUA_DOI;
      // Bổ sung Sale chỉ ĐIỀN CHỖ TRỐNG của đúng dòng này (first-claim): sai nguồn / sai phụ huynh / đã có Sale ⇒ từ chối, KHÔNG ghi gì.
      if (
        p.saleTay &&
        !(cu.groupId === groupIdGhi && cu.referrerKind === "PARENT" && cu.referrerSaleUserId === null && cu.referrerParentUserId === (p.thamChieu?.parentUserId ?? null) && cu.referrerStudentId === (p.thamChieu?.studentId ?? null))
      ) {
        return { ok: false, loi: "Chỉ bổ sung được Sale cho phụ huynh giới thiệu đang THIẾU Sale (đúng nguồn, đúng phụ huynh). Sale đã ghi nhận không bị thay bằng đường này.", truong: "thamChieu" };
      }
      const daCoThucThu =
        (await tx.payment.count({ where: { ...WHERE_THUC_THU, order: { leadId: p.leadId, deletedAt: null } } })) > 0;
      const signalsCu: DoiTuongJson = laDoiTuong(cu.signals) ? cu.signals : {};

      // Nhóm đích ĐỌC LẠI trong transaction sau khi KHOÁ hàng nhóm (`FOR SHARE`): một lệnh ngừng/ARCHIVE nhóm giữa hai bước không lọt được, và bản chụp
      // `signals.nguon` chụp đúng người phụ trách/cửa sổ lúc này (res3 LOW-9). `FOR SHARE` chặn UPDATE nhóm tới khi ta xong; UPDATE trạng thái thì không
      // xung đột với KEY SHARE của FK nên phải khoá hàng chứ không dựa vào FK.
      await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "id" = ${groupIdGhi} FOR SHARE`;
      const nhomMoi: NhomDich | null = await tx.leadSourceGroup.findUnique({ where: { id: groupIdGhi }, select: CHON_NHOM_DICH });
      if (!nhomMoi) return { ok: false, loi: "Nguồn mới không tồn tại.", truong: "nguon" };

      const gianLan: CoGianLan[] = phatHienGianLan({
        chuLead,
        nguoiNhan: danhTinhNguoiNhan({
          referrerEmployeeId: nguoiMoi?.referrerKind === "EMPLOYEE" ? nguoiMoi.referrerEmployeeId : null,
          referrerSaleUserId: anhChupMoi.referrerSaleUserId,
          chuNguonEmployeeId: nhomMoi.ownerEmployeeId,
        }),
        sdtKhach: lead.phone,
        sdtNhanVien: mapSdt,
        sdtNguoiGioiThieu: nguoiMoiEmp?.phone ?? null,
      });

      const qd = quyetDinhDoiNguon({
        daCoThucThu,
        daCoDongSo: false, // sổ hoa hồng mới chưa tồn tại ở PR2 — engine (PR5) nghe sự kiện
        quyen: { overwrite, overrideSauThanhToan, quanLyNguon },
        nguonDangKhoa: signalsCu.khoaNguon === true,
        lyDo: p.lyDo,
        nguonMoi: { trangThai: nhomMoi.status, selectable: nhomMoi.selectable && trongKhoangHieuLuc(nhomMoi, p.bayGio), requiresNote: nhomMoi.requiresNote, referrerRequirement: nhomMoi.referrerRequirement },
        thamChieu: p.thamChieu,
        giaiTrinh: p.giaiTrinh,
        gianLan,
      });
      if (!qd.ok) {
        // Hai ca CHẶN đáng nhớ (03 §4: TU_CLAIM, DOI_SAU_TT) để lại MỘT touchpoint `DOI_NGUON_BI_CHAN` — sổ GHI THÊM, không đổi
        // attribution, không AuditLog. Các lỗi còn lại (thiếu lý do, sai người…) là lỗi nhập liệu, không phải dấu hiệu gian lận.
        // Chỉ người CÓ ÍT NHẤT MỘT quyền nguồn mới để lại dấu: người thấy lead mà không có quyền nào chỉ nhận lời từ chối, nếu không
        // action này là đường ghi LeadTouchpoint không giới hạn cho bất kỳ ai thấy lead ([NHH-SRC-17e]).
        if (qd.maChan && (overwrite || overrideSauThanhToan || quanLyNguon)) {
          await ghiTouchpoint(
            tx,
            p.leadId,
            { kind: "DOI_NGUON_BI_CHAN", conversionEntry: cu.conversionEntry, claimedGroupId: p.groupId, signals: { maChan: qd.maChan } },
            p.actor.userId,
          );
        }
        return { ok: false, loi: qd.loi, truong: qd.truong };
      }

      // Bổ sung người cho attribution THIEU_NGUOI (cùng nhóm) là một lượt đổi riêng — sau thực thu vẫn là đổi sau thực thu.
      const action = qd.action === "DOI_NGUON" && ((cu.referrerMissing && cu.groupId === groupIdGhi) || p.saleTay) ? "BO_SUNG_NGUOI" : qd.action;

      // Người ĐÃ QUYẾT ⇒ cờ xem tay được gỡ; vết gốc (nhanGoc, pageId, quangCao…) GIỮ NGUYÊN.
      // `nguoiGioiThieu` cũ cũng gỡ: ảnh chụp thuộc NGƯỜI giới thiệu, người đổi thì dấu vết đổi theo.
      const { coXemTay: _a, xemTay: _b, nguoiGioiThieu: _c, ...conLai } = signalsCu;
      void _a;
      void _b;
      void _c;
      const moi: DuLieuDoiNguon = {
        groupId: groupIdGhi,
        otherSourceNote: nhomMoi.requiresNote ? (p.giaiTrinh ?? "").trim() : null,
        ...thamChieuSangNguoi(p.thamChieu),
        referrerMissing: false,
        referrerRoleCode: anhChupMoi.referrerRoleCode,
        referrerSaleUserId: anhChupMoi.referrerSaleUserId,
        identificationMethod: "MANUAL",
        matchedRule: "DOI_NGUON",
        reasonText: "Đổi nguồn thủ công bởi người có quyền — lý do ở nhật ký đổi nguồn",
        // SĐT nhân viên là cảnh báo về KHÁCH, không phải về nguồn cũ ⇒ giữ; thêm cảnh báo của lượt này.
        canhBao: [...new Set([...cu.canhBao.filter((c) => c === "SDT_NHAN_VIEN"), ...gianLan.map((g) => g.ma)])],
        conversionEntry: cu.conversionEntry,
        // Người ĐÃ QUYẾT nên gỡ cờ xem tay — TRỪ khi PH giới thiệu mà vẫn không tìm được Sale phụ trách: việc ấy chưa ai quyết được ở đây ⇒ GIỮ cờ.
        signals: {
          ...conLai,
          ...(anhChupMoi.nguoiGioiThieu ? { nguoiGioiThieu: { ...anhChupMoi.nguoiGioiThieu, roleCodes: [...anhChupMoi.nguoiGioiThieu.roleCodes] } } : {}),
          // BẢN CHỤP thuộc tính nguồn đích LÚC NÀY (đọc sau khoá hàng): ghi đè bản chụp cũ — đổi nguồn có kiểm soát là điểm duy nhất được chụp lại.
          nguon: chupNguon({ cuaSoRiengNgay: nhomMoi.attributionWindowDays, cuaSoMacDinhNgay, chuNhanVienId: nhomMoi.ownerEmployeeId }),
          ...(thieuSalePh ? { coXemTay: true, xemTay: ["THIEU_SALE_PH"] } : {}),
          daXemTay: true,
        } as DuLieuDoiNguon["signals"],
      };

      const r = await doiNguon(tx, {
        leadId: p.leadId,
        daDocUpdatedAt: cu.updatedAt,
        moi,
        action,
        lyDo: (p.lyDo ?? "").trim(),
        actor: { id: p.actor.userId, name: p.actorName },
      });
      // FIX-H9: ghi CÓ ĐIỀU KIỆN đổi 0 dòng ⇒ commit vô hại, không có gì để lùi.
      if (!r.ok) {
        return NGUON_VUA_DOI;
      }

      // Đổi SAU thực thu ⇒ báo engine hoa hồng (CÙNG transaction; KHÔNG tự tạo Adjustment). `dedupeKey` theo PHIÊN BẢN
      // attribution vừa thay (`cu.updatedAt`) ⇒ một lượt đổi = đúng một sự kiện, kể cả khi đường gọi retry.
      if (daCoThucThu) {
        // Tên sự kiện là HẰNG CHUỖI NGUYÊN VĂN: lưới `khop-phat-nghe.test.ts` quét `publishEvent("…"` để đối chiếu hai đầu.
        await publishEvent(
          "nguon.da-doi-sau-thanh-toan",
          {
            leadId: p.leadId,
            tuNhom: cu.group.code,
            denNhom: nhomMoi.code,
            tuNguoi: { kind: cu.referrerKind, employeeId: cu.referrerEmployeeId, parentUserId: cu.referrerParentUserId, studentId: cu.referrerStudentId, affiliateId: cu.referrerAffiliateId },
            denNguoi: { kind: moi.referrerKind, employeeId: moi.referrerEmployeeId, parentUserId: moi.referrerParentUserId, studentId: moi.referrerStudentId, affiliateId: moi.referrerAffiliateId },
            lyDo: (p.lyDo ?? "").trim(),
            actorId: p.actor.userId,
            canDieuChinh: qd.canDieuChinh,
          },
          { tx, dedupeKey: `nguon.da-doi-sau-thanh-toan:${p.leadId}:${cu.updatedAt.toISOString()}` },
        );
      }
      return { ok: true, canDieuChinh: qd.canDieuChinh, action };
    });
  } catch (err) {
    // `doiNguon` có cổng cuối (lý do/người/giải trình) — đã được `quyetDinhDoiNguon` chặn trước, đây chỉ là lưới.
    if (err instanceof NguonError) {
      const truong: TruongLoi = err.ma === "LY_DO_NGAN" ? "lyDo" : err.ma === "GIAI_TRINH_NGAN" ? "giaiTrinh" : "thamChieu";
      return { ok: false, loi: err.message, truong };
    }
    throw err;
  }
}

/**
 * BỔ SUNG SALE PHỤ TRÁCH PHỤ HUYNH cho lead do phụ huynh giới thiệu mà lúc ghi nhận không tìm được Sale (hold `THIEU_SALE_PHU_HUYNH` / cờ `THIEU_SALE_PH`) — đường thoát duy nhất của hold ấy
 * (res3 MEDIUM-6, 09/10/2026): bản chụp KHÔNG tính lại và `doiNguonLead` tra lại bằng cùng câu hỏi nên vẫn null, nên nếu không có đường này hold là vĩnh viễn.
 *
 * Không có luật riêng: đọc dòng quy nguồn hiện hành rồi gọi `doiNguonLead` với ĐÚNG nguồn + ĐÚNG phụ huynh + `saleTay` ⇒ cùng cổng cơ sở · quyền · lý do ≥ 10 ký tự · TU_CLAIM · audit
 * `BO_SUNG_NGUOI` · khoá lạc quan như mọi lượt đổi nguồn. Cổng cơ sở đứng TRƯỚC khi đọc dòng quy nguồn (lead cơ sở khác ⇒ "không tồn tại", không lộ nhóm/phụ huynh).
 */
export async function boSungSalePhuHuynh(p: {
  actor: Actor;
  actorName: string;
  kiemQuyen: KiemQuyen;
  leadId: string;
  /** `User.id` của Sale phụ trách phụ huynh — người chọn tay. */
  saleUserId: string;
  lyDo: string | null;
  daThayCapNhatLuc?: Date;
  bayGio: Date;
}): Promise<KetQuaDoiNguonLead> {
  const lead = await scopedDb(p.actor).lead.findUnique({ where: { id: p.leadId }, select: { id: true, centerId: true, orgUnitId: true } });
  if (!lead || !passesScope("Lead", lead, p.actor)) return KHONG_THAY;
  const cu = await db.leadAttribution.findUnique({
    where: { leadId: p.leadId },
    select: { groupId: true, referrerKind: true, referrerParentUserId: true, referrerStudentId: true, otherSourceNote: true },
  });
  if (!cu) return { ok: false, loi: "Lead chưa có quy nguồn — chưa bổ sung được.", truong: "lead" };
  if (cu.referrerKind !== "PARENT") return { ok: false, loi: "Chỉ bổ sung Sale phụ trách cho lead do PHỤ HUYNH giới thiệu.", truong: "thamChieu" };
  return doiNguonLead({
    actor: p.actor,
    actorName: p.actorName,
    kiemQuyen: p.kiemQuyen,
    leadId: p.leadId,
    groupId: cu.groupId,
    thamChieu: { employeeId: null, parentUserId: cu.referrerParentUserId, studentId: cu.referrerStudentId, affiliateId: null },
    giaiTrinh: cu.otherSourceNote,
    lyDo: p.lyDo,
    daThayCapNhatLuc: p.daThayCapNhatLuc,
    saleTay: { userId: p.saleUserId },
    bayGio: p.bayGio,
  });
}
