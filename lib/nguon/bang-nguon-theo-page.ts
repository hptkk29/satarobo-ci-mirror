/**
 * lib/nguon/bang-nguon-theo-page.ts — BẢNG "Page → nhóm nguồn" của tab Nguồn (06 §5.1 "Page Mapping"): ĐỌC dòng + GHI một dòng.
 *
 * Nguồn của Page tạm thời nằm trong setting `nguon.bangNguonTheoPage` (cột `FacebookPageMapping.sourceId` thuộc đợt có schema).
 * Hai nửa của tệp này:
 *
 * ── ĐỌC (`docBangPageMapping`) ────────────────────────────────────────────────────────────────────────
 *  Danh sách Page lấy từ `FacebookPageMapping`, cộng các Page đã có trong bảng nguồn mà không còn trong danh mục (mồ côi — chỉ gỡ được).
 *
 *  ⚠️ CÁCH LY CƠ SỞ LÀM TAY, và đây là lý do: `FacebookPageMapping` nằm trong `SCOPE_EXEMPT` (bảng tra cứu hạ tầng cho webhook — HO
 *  phải thấy mọi Page), nên `scopedDb(actor).facebookPageMapping` KHÔNG lọc gì (đo thật: QLCS CS1 đọc được Page CS2, ca `[NHH-UI-PMD-03]`).
 *  Giao diện thì phải giữ lời "CS1 không xem CS2": một Page là CỦA ĐÚNG MỘT cơ sở hoặc của toàn hệ (`centerId` null). Quy tắc ở
 *  `pageTrongTamNhin` — tầm nhìn của người xem trên Lead (`getModelVisibleCenterIds("Lead", actor)`, cùng nguồn với chip cơ sở của tab).
 *  Page mồ côi (không có trong danh mục) không mang cơ sở nào nên ai thấy bảng cũng thấy. **Page chưa map đứng đầu**, rồi theo tên. Không đếm Page "đã thấy trên
 *  webhook mà chưa vào danh mục": `LeadAttribution` không có cột Page để đếm, và quét JSON là nói số không đo được.
 *
 * ── GHI (`luuNguonCuaPage`) ───────────────────────────────────────────────────────────────────────────
 *  Setting là MỘT bản ghi JSON cho mọi Page. Hai người sửa hai Page khác nhau cùng lúc mà ghi cả bản ghi thì người sau ĐÈ mất dòng
 *  của người trước, không lỗi nào báo. Nên ghi theo khoá lạc quan trên `SystemSetting.updatedAt` (đọc → sửa đúng MỘT Page → ghi
 *  CÓ ĐIỀU KIỆN); lệch ⇒ "vừa được người khác đổi", KHÔNG ghi gì, KHÔNG audit.
 *  Mọi cổng (Page có thật · nhóm chọn được · mã chiến dịch) đứng TRƯỚC phép ghi đầu tiên. AuditLog cùng transaction.
 *
 *  Không dùng `setGlobalSetting`: nó đòi SUPER_ADMIN, trong khi người quản lý Page là Marketing (`sources:manage`). Quyền do
 *  nơi gọi kiểm bằng `can()`; hàm này chỉ kiểm CƠ SỞ (Page phải nằm trong tầm nhìn của người sửa).
 */
import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { getModelVisibleCenterIds } from "@/lib/db-scope";
import { khoaChinhSach } from "@/lib/hoa-hong/chinh-sach-service";
import { validateSettingValue } from "@/lib/settings/registry";
import { clearSettingsCache } from "@/lib/settings/service";
import { CAU_THIEU_QUYEN_GAN_PAGE, canQuyenKichHoatGanPage, loiLyDoGanPage, nguonDangDinhTienTheoRule } from "./danh-muc-ghi-dau-vao";
import { dinhTienCuaNguon, docDinhTienNguon, ruleChuChayChoNguon } from "./dinh-tien-nguon";
import { KHOA_NGUON, laPageMappingBat, layBangNguonTheoPage } from "./feature";
import { nguonChonDuoc } from "./hieu-luc-nguon";

/**
 * Page này có nằm trong tầm nhìn của người xem không. THUẦN. `centerId` null ⇒ Page toàn hệ (Hội sở) — ai cũng thấy;
 * có cơ sở ⇒ chỉ khi cơ sở đó nằm trong tầm nhìn (`"ALL"` ⇒ mọi cơ sở).
 */
export function pageTrongTamNhin(centerId: string | null, tamNhin: "ALL" | readonly string[]): boolean {
  if (centerId === null) return true;
  return tamNhin === "ALL" || tamNhin.includes(centerId);
}

/**
 * Nhóm này có gán được cho CẢ MỘT PAGE không. Nhóm BẮT người giới thiệu (nhân sự · phụ huynh · đối tác) thì không: luật
 * PAGE_MAPPING của resolver không mang người và không đặt `thieuNguoi`, nên mỗi lead vào từ Page đó sẽ ở nhóm cần người
 * mà KHÔNG có người, `referrerMissing = false` (không vào hàng chờ) và bị khoá — engine hoa hồng không có người hưởng để tính.
 * "Người" là thứ của TỪNG lead, không thể là thuộc tính của Page. THUẦN.
 */
export function nhomGanDuocChoPage(n: { referrerRequirement: string }): boolean {
  return n.referrerRequirement === "NONE" || n.referrerRequirement === "EVENT";
}

export type MaPageMap = { groupCode: string; campaignCode?: string };

export type DongPage = {
  pageId: string;
  /** Tên Page trong danh mục; null với Page mồ côi (có trong bảng nguồn, không có trong danh mục). */
  tenPage: string | null;
  coSo: { code: string | null; name: string } | null;
  /** Page đang tắt trong danh mục — webhook bỏ qua nó. */
  dangTat: boolean;
  /** Có trong danh mục `FacebookPageMapping` không. false ⇒ mồ côi: chỉ gỡ được. */
  trongDanhMuc: boolean;
  map: { groupCode: string; campaignCode: string | null } | null;
};

export type BangPageMapping = {
  dong: DongPage[];
  /** Nhóm CHỌN ĐƯỢC cho một Page (ACTIVE ∧ selectable ∧ không bắt người giới thiệu — `nhomGanDuocChoPage`). */
  nhom: { code: string; name: string }[];
  /** Page đang bật mà chưa gán nguồn — những Page mà lead vào sẽ rơi vào hàng chờ xem tay. */
  soChuaMap: number;
  /** Cờ `nguon.pageMapping` ∧ master. Tắt ⇒ bảng này CHƯA có tác dụng với lead mới. */
  runtimeBat: boolean;
  /**
   * Nguồn (theo MÃ) nào «đang dính tiền theo rule» (`nguonDangDinhTienTheoRule`) — cho mọi nhóm trong ô chọn VÀ mọi nhóm mà một Page đang trỏ vào. Dời Page khỏi/vào nguồn dính tiền đòi
   * `commission_policies:activate` (`canQuyenKichHoatGanPage`): bảng dùng map này để hộp thoại xác nhận nói trước, thay vì để máy chủ từ chối sau khi người dùng đã gõ lý do.
   */
  dinhTienTheoMa: Record<string, boolean>;
};

/** Page "chưa map" = đang bật mà chưa có dòng trong bảng nguồn. MỘT định nghĩa cho cả bảng lẫn con số trên công tắc (luật 12b). */
export function laPageChuaMap(d: { dangTat: boolean; map: unknown }): boolean {
  return d.map === null && !d.dangTat;
}

/** Số Page chưa map trong tầm nhìn của người xem (con số trên công tắc "Page mapping") — hai truy vấn, không dựng cả bảng. */
export async function demPageChuaMap(actor: Actor): Promise<number> {
  const tamNhin = getModelVisibleCenterIds("Lead", actor);
  const [bang, pages] = await Promise.all([
    layBangNguonTheoPage(),
    db.facebookPageMapping.findMany({ where: { isActive: true }, select: { pageId: true, centerId: true } }),
  ]);
  return pages
    .filter((p) => pageTrongTamNhin(p.centerId, tamNhin))
    .filter((p) => laPageChuaMap({ dangTat: false, map: Object.prototype.hasOwnProperty.call(bang, p.pageId) ? bang[p.pageId] : null })).length;
}

export async function docBangPageMapping(actor: Actor, now: Date): Promise<BangPageMapping> {
  const tamNhin = getModelVisibleCenterIds("Lead", actor);
  const [bang, tatCaPage, trungTam, nhomRows, runtimeBat] = await Promise.all([
    layBangNguonTheoPage(),
    db.facebookPageMapping.findMany({
      select: { pageId: true, pageName: true, isActive: true, centerId: true },
      orderBy: { pageName: "asc" },
    }),
    db.center.findMany({ select: { id: true, code: true, name: true } }),
    db.leadSourceGroup.findMany({
      where: { status: "ACTIVE", selectable: true },
      select: { id: true, code: true, name: true, sortOrder: true, referrerRequirement: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true, ownerEmployeeId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    laPageMappingBat(),
  ]);

  const pages = tatCaPage.filter((p) => pageTrongTamNhin(p.centerId, tamNhin));
  const coSoTheoId = new Map(trungTam.map((c) => [c.id, c]));
  const map1 = (id: string): DongPage["map"] => {
    const m = Object.prototype.hasOwnProperty.call(bang, id) ? bang[id] : undefined;
    return m ? { groupCode: m.groupCode, campaignCode: m.campaignCode ?? null } : null;
  };

  const trongDanhMuc: DongPage[] = pages.map((p) => {
    const c = p.centerId ? coSoTheoId.get(p.centerId) : undefined;
    return {
      pageId: p.pageId,
      tenPage: p.pageName,
      coSo: c ? { code: c.code, name: c.name } : null,
      dangTat: !p.isActive,
      trongDanhMuc: true,
      map: map1(p.pageId),
    };
  });
  // "Có trong danh mục" tính trên TOÀN danh mục, không chỉ phần người xem thấy: Page của cơ sở khác KHÔNG phải mồ côi.
  const co = new Set(tatCaPage.map((p) => p.pageId));
  // Page mồ côi: bảng nguồn nhắc tới mà danh mục không có (bị xoá / gõ sai khi sửa tay setting). Chỉ gỡ được.
  const moCoi: DongPage[] = Object.keys(bang)
    .filter((id) => !co.has(id))
    .map((id) => ({ pageId: id, tenPage: null, coSo: null, dangTat: false, trongDanhMuc: false, map: map1(id) }));

  const chuaMap = laPageChuaMap;
  const dong = [...trongDanhMuc, ...moCoi].sort((a, b) => {
    const ka = chuaMap(a) ? 0 : 1;
    const kb = chuaMap(b) ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return (a.tenPage ?? a.pageId).localeCompare(b.tenPage ?? b.pageId, "vi");
  });

  // «Dính tiền» của mọi nhóm xuất hiện trong bảng (ô chọn + nhóm mà Page đang trỏ vào, kể cả nhóm đã ngừng): MỘT lượt đọc (`docDinhTienNguon`), cùng hàm với cổng ghi.
  const daCo = new Set(nhomRows.map((n) => n.code));
  const thieuMa = [...new Set(dong.flatMap((d) => (d.map && !daCo.has(d.map.groupCode) ? [d.map.groupCode] : [])))];
  const them = thieuMa.length === 0 ? [] : await db.leadSourceGroup.findMany({ where: { code: { in: thieuMa } }, select: { id: true, code: true, ownerEmployeeId: true } });
  const moiNhom = [...nhomRows.map((n) => ({ id: n.id, code: n.code, ownerEmployeeId: n.ownerEmployeeId })), ...them];
  const dt = await docDinhTienNguon(db, moiNhom.map((n) => n.id));
  const dinhTienTheoMa = Object.fromEntries(
    moiNhom.map((n) => [n.code, nguonDangDinhTienTheoRule({ chinhSachRieng: dinhTienCuaNguon(dt, n.id).chinhSachRieng, coChu: n.ownerEmployeeId !== null, ruleChuChay: ruleChuChayChoNguon(dt, n.id) })]),
  );

  return {
    dong,
    nhom: nhomRows.filter((n) => nguonChonDuoc(n, now) && nhomGanDuocChoPage(n)).map((n) => ({ code: n.code, name: n.name })),
    soChuaMap: dong.filter(chuaMap).length,
    runtimeBat,
    dinhTienTheoMa,
  };
}

export type KetQuaLuuPage =
  | { ok: true; doi: boolean }
  | { ok: false; loi: string; truong: "page" | "nguon" | "chienDich" | "vuaDoi" | "lyDo" | "quyen" };

const DO_DAI_MA_CHIEN_DICH_TOI_DA = 64;

/**
 * Gán / dời / gỡ nguồn của MỘT Page.
 *
 * ── Cổng «đụng tiền» (W2, 10/10/2026 — res3 R3-M2) ───────────────────────────────────────────────────────────────
 * Đổi nguồn của Page là đổi người nhận hoa hồng của MỌI lead TƯƠNG LAI vào từ Page đó. Bản cũ chỉ cần `sources:manage` (HO_MARKETING — vai thụ hưởng của dòng Marketing 1% — dời được Page sang
 * nguồn quảng cáo mà không qua cổng nào) và audit chỉ ghi câu tự sinh. Nay CÙNG luật với `suaNguon` (một hàm, không bản chép): khi nguồn CŨ hoặc MỚI «dính tiền theo rule»
 * (`nguonDangDinhTienTheoRule`) phải có `commission_policies:activate` (`canQuyenKichHoatGanPage`), và mọi lượt ĐỔI NGUỒN (không phải chỉ đổi mã chiến dịch) phải có lý do ≥ 10 ký tự, ghi vào audit
 * cùng giá trị cũ → mới. «Không đổi gì» trả `ok` TRƯỚC khi hỏi lý do (bấm Lưu hai lần).
 *
 * ── Khoá (R3-M5) ─────────────────────────────────────────────────────────────────────────────────────────────────
 * Thứ tự toàn module: advisory chính sách → hàng nguồn (`FOR SHARE`, theo id) → cài đặt. Nhóm đích được ĐỌC LẠI và kiểm (chọn được · gán được) TRONG transaction, sau khoá: đọc trước khoá cho phép
 * `suaNguon` / `doiTrangThaiNguon` ngừng hoặc đổi mã nguồn ấy ngay lúc ta gán Page vào đó ⇒ Page mồ côi, lead rơi UNKNOWN, không lỗi nào báo.
 */
export async function luuNguonCuaPage(p: {
  actor: Actor;
  actorName: string;
  pageId: string;
  /** null ⇒ gỡ Page khỏi bảng nguồn. */
  groupCode: string | null;
  campaignCode: string | null;
  /** Lý do đổi nguồn (≥ 10 ký tự khi nguồn đổi). BẮT BUỘC khai (luật 7) — `null` là «không có lý do», không phải «bỏ qua cổng». */
  lyDo: string | null;
  /** Người lưu có `commission_policies:activate` không (action hỏi `checkPermission`, KHÔNG phải hàm này). BẮT BUỘC, không mặc định (luật 7). */
  coQuyenKichHoat: boolean;
  /** Đồng hồ — BẮT BUỘC (luật 19): nguồn ngoài khoảng hiệu lực không gán được cho Page. */
  now: Date;
}): Promise<KetQuaLuuPage> {
  const pageId = p.pageId.trim();
  if (pageId === "") return { ok: false, loi: "Thiếu mã Page.", truong: "page" };
  const campaign = (p.campaignCode ?? "").trim();
  if (campaign.length > DO_DAI_MA_CHIEN_DICH_TOI_DA) {
    return { ok: false, loi: `Mã chiến dịch tối đa ${DO_DAI_MA_CHIEN_DICH_TOI_DA} ký tự.`, truong: "chienDich" };
  }

  // 1. CƠ SỞ — Page phải nằm trong tầm nhìn của người sửa (làm tay, xem đầu tệp). Page mồ côi (chỉ có trong bảng nguồn) chỉ được GỠ.
  const dong = await db.facebookPageMapping.findUnique({ where: { pageId }, select: { centerId: true } });
  // Page CÓ trong danh mục mà ngoài tầm nhìn ⇒ từ chối cả gán lẫn gỡ (gỡ nguồn của Page cơ sở khác cũng là sửa cấu hình của họ).
  const ngoaiTamNhin = dong !== null && !pageTrongTamNhin(dong.centerId, getModelVisibleCenterIds("Lead", p.actor));
  if (ngoaiTamNhin) return { ok: false, loi: "Page không có trong danh mục Page của bạn.", truong: "page" };
  const trongDanhMuc = dong !== null;

  const KEY = KHOA_NGUON.bangNguonTheoPage;
  const ket = await db.$transaction(async (tx): Promise<KetQuaLuuPage> => {
    await khoaChinhSach(tx); // advisory TRƯỚC mọi khoá hàng — cùng thứ tự với `taoNguon` / `suaNguon` / `doiTrangThaiNguon` / `kichHoat`
    const hang = await tx.systemSetting.findUnique({ where: { key: KEY } });
    const hienTai = validateSettingValue(KEY, hang?.valueJson ?? {});
    // Bản ghi hiện có sai hình dạng: KHÔNG ghi đè (sẽ xoá mất thứ chưa hiểu) — báo để người vận hành xem tay.
    if (!hienTai.ok) return { ok: false, loi: "Bảng nguồn theo Page đang sai định dạng — báo quản trị viên hệ thống.", truong: "vuaDoi" };
    const cu = hienTai.value as Record<string, MaPageMap>;
    const coDong = Object.prototype.hasOwnProperty.call(cu, pageId);
    const maCu = coDong ? (cu[pageId]?.groupCode ?? null) : null;

    // 2. Khoá hàng nhóm CŨ và MỚI (FOR SHARE, theo id) rồi ĐỌC LẠI trong transaction: nhóm đích phải chọn được (UNKNOWN / nhóm ngừng không được gán cho một Page).
    const maCan = [...new Set([p.groupCode, maCu].filter((m): m is string => m !== null))];
    let nhomRows: { id: string; code: string; name: string; status: string; selectable: boolean; effectiveFrom: Date | null; effectiveTo: Date | null; referrerRequirement: string; ownerEmployeeId: string | null }[] = [];
    if (maCan.length > 0) {
      await tx.$queryRaw`SELECT "id" FROM "LeadSourceGroup" WHERE "code" IN (${Prisma.join(maCan)}) ORDER BY "id" FOR SHARE`;
      nhomRows = await tx.leadSourceGroup.findMany({
        where: { code: { in: maCan } },
        select: { id: true, code: true, name: true, status: true, selectable: true, effectiveFrom: true, effectiveTo: true, referrerRequirement: true, ownerEmployeeId: true },
      });
    }
    const nhomMoi = p.groupCode === null ? null : (nhomRows.find((n) => n.code === p.groupCode) ?? null);
    const nhomCu = maCu === null ? null : (nhomRows.find((n) => n.code === maCu) ?? null);
    if (p.groupCode !== null && (!nhomMoi || !nguonChonDuoc(nhomMoi, p.now))) {
      return { ok: false, loi: "Nguồn này không còn dùng được — chọn nguồn khác.", truong: "nguon" };
    }
    if (nhomMoi && !nhomGanDuocChoPage(nhomMoi)) {
      return { ok: false, loi: "Nguồn này cần người giới thiệu của TỪNG lead nên không gán cho cả một Page được — chọn nguồn khác.", truong: "nguon" };
    }

    if (!trongDanhMuc && !(p.groupCode === null && coDong)) {
      return { ok: false, loi: "Page không có trong danh mục Page của bạn.", truong: "page" };
    }

    const moi: Record<string, MaPageMap> = { ...cu };
    if (p.groupCode === null) delete moi[pageId];
    else moi[pageId] = campaign === "" ? { groupCode: p.groupCode } : { groupCode: p.groupCode, campaignCode: campaign };

    const sau = validateSettingValue(KEY, moi);
    if (!sau.ok) return { ok: false, loi: sau.error, truong: "nguon" };
    // Không đổi gì ⇒ không ghi, không audit, không hỏi lý do / quyền (bấm Lưu hai lần).
    if (JSON.stringify(cu[pageId] ?? null) === JSON.stringify(moi[pageId] ?? null)) return { ok: true, doi: false };

    // 3. Cổng «đụng tiền». Chỉ khi NGUỒN đổi (gán · dời · gỡ); đổi riêng mã chiến dịch không đổi người nhận tiền.
    const doiNguon = maCu !== p.groupCode;
    if (doiNguon) {
      const loiLyDo = loiLyDoGanPage(p.lyDo);
      if (loiLyDo) return { ok: false, loi: loiLyDo, truong: "lyDo" };
      const dt = await docDinhTienNguon(tx, [nhomCu?.id, nhomMoi?.id].filter((id): id is string => id !== undefined));
      const dinhTien = (n: (typeof nhomRows)[number] | null): boolean =>
        n !== null && nguonDangDinhTienTheoRule({ chinhSachRieng: dinhTienCuaNguon(dt, n.id).chinhSachRieng, coChu: n.ownerEmployeeId !== null, ruleChuChay: ruleChuChayChoNguon(dt, n.id) });
      if (canQuyenKichHoatGanPage({ nguonCu: dinhTien(nhomCu), nguonMoi: dinhTien(nhomMoi) }) && !p.coQuyenKichHoat) {
        return { ok: false, loi: CAU_THIEU_QUYEN_GAN_PAGE, truong: "quyen" };
      }
    }

    // Phép ghi DUY NHẤT có điều kiện (khoá lạc quan): lệch `updatedAt` ⇒ 0 dòng đổi, commit vô hại.
    if (hang) {
      const r = await tx.systemSetting.updateMany({
        where: { key: KEY, updatedAt: hang.updatedAt },
        data: { valueJson: sau.value as never, updatedById: p.actor.userId, updatedByName: p.actorName },
      });
      if (r.count === 0) return { ok: false, loi: "Bảng vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" };
    } else {
      // Chưa có bản ghi: hai người tạo cùng lúc ⇒ người sau nhận P2002 (khoá chính). Cũng là "vừa được đổi", không phải lỗi 500.
      // Postgres hỏng giao dịch sau lỗi nên phải thoát ở đây (return), không tiếp tục ghi audit.
      try {
        await tx.systemSetting.create({
          data: { key: KEY, valueJson: sau.value as never, updatedById: p.actor.userId, updatedByName: p.actorName },
        });
      } catch (err) {
        if ((err as { code?: string }).code === "P2002") {
          return { ok: false, loi: "Bảng vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" };
        }
        throw err;
      }
    }
    const lyDoGhi = (p.lyDo ?? "").trim();
    await writeAudit({
      tx,
      actor: { id: p.actor.userId, name: p.actorName },
      module: "nguon-hoa-hong",
      entityType: "SystemSetting",
      entityId: KEY,
      action: "PAGE_MAPPING",
      oldValues: { pageId, nguon: cu[pageId] ?? null },
      newValues: { pageId, nguon: moi[pageId] ?? null },
      reason: doiNguon ? lyDoGhi : `Đổi mã chiến dịch của Page ${pageId}`,
    });
    return { ok: true, doi: true };
  });
  if (ket.ok && ket.doi) clearSettingsCache();
  return ket;
}
