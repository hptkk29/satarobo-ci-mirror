/**
 * lib/nguon/di-tru-ke-hoach.ts — KẾ HOẠCH BACKFILL nguồn cho lead cũ (hướng E, 11/10/2026). THUẦN: không DB, không đồng hồ, không đọc tham số dòng lệnh.
 *
 * ── MỘT NGUỒN CHO SỐ ──────────────────────────────────────────────────────────────────────────────────────
 * Báo cáo chỉ-đọc (`scripts/nguon/di-tru-nguon-cu.ts`) và lệnh GHI (`di-tru-nguon-cu-ghi.ts`) cùng gọi `dungKeHoachDiTru`: số in ra để DUYỆT và số lệnh ghi SO LẠI lúc chạy là
 * cùng một phép tính. Hai chỗ tính hai kiểu là cách một số duyệt đúng trên giấy mà ghi ra khác.
 *
 * ── Vì sao backfill phải GHI cả dòng xem tay lẫn UNKNOWN ────────────────────────────────────────────────
 * Lead không có `LeadAttribution` thì `doiNguonLead` từ chối («Lead chưa có quy nguồn») và engine coi nó là UNKNOWN: người duyệt không có đường sửa. Nên «không auto-map» nghĩa là ghi
 * dòng ở trạng thái XEM TAY (OTHER + giải trình + `coXemTay`, hoặc nhóm cần người + `referrerMissing`), KHÔNG phải «không ghi». Chỉ INVALID (nhãn ngoài 28 dòng đã chốt) là KHÔNG được ghi —
 * và vì vậy `INVALID > 0` chặn cả lệnh (cổng «Invalid = 0 trước khi bật nguon.enabled» đặt ở chính lệnh ghi, không ở tài liệu).
 *
 * ── Bốn loại, RỜI NHAU, mô tả điều được GHI (không phải phân hoạch sáu nhóm của `tomTatDiTru`) ───────────
 * `tomTatDiTru` cho Duplicate đứng trước hầu hết lý do xem tay nên dòng «trùng SĐT + thiếu người» KHÔNG được đếm là ManualReview ở báo cáo sáu nhóm — nhưng nó vẫn được ghi với `coXemTay`.
 * Dùng số ấy làm `--expect-review` là để người duyệt ký một con số NHỎ HƠN số dòng thật vào review. Nên loại ở đây chỉ nhìn kết quả ánh xạ của CHÍNH dòng đó:
 *   INVALID → MANUAL_REVIEW (có lý do xem tay) → UNKNOWN (nhãn rỗng, không lý do) → AUTO.   N = AUTO + REVIEW + UNKNOWN.
 *
 * ── Tiền phải tất định, kiểm toán được, phê duyệt được ───────────────────────────────────────────────────
 * Ảnh chụp nguồn (`signals.nguon`: chủ + cửa sổ) CHỤP LÚC GHI: thiếu nó engine rơi về chủ/cửa sổ SỐNG (`nguon-chup.ts` `CHUA_CO`) — đúng lỗi «cron timing / owner hiện tại làm đổi lịch sử tiền». Nhóm chưa có
 * chủ lúc ghi thì `chuNhanVienId = null` («không có chủ lúc ghi»). Từ hướng B+C (chủ nguồn theo LỊCH SỬ, `chu-nguon-lich-su.ts`, 08 §16.4) bản chụp đó KHÔNG còn «vĩnh viễn» tuyệt đối: nó chỉ quyết khoản có ngày thu đầu TRƯỚC
 * ngày chủ nguồn có hiệu lực (treo `NGUON_CHUA_CO_NGUOI_PHU_TRACH`, không trả lùi); khoản SAU ngày đó theo lịch sử. Kế hoạch liệt kê nhóm đó (`nhomChuNull`); lệnh ghi TỪ CHỐI trừ khi người chạy chấp nhận ĐÚNG danh sách (`kiemCongGhi`).
 * Digest SHA-256 phủ: từng dòng (lead · nhóm · người · vai · loại) + thuộc tính CHỤP của từng nhóm được dùng (chủ · cửa sổ riêng) + cửa sổ mặc định. Đổi bất kỳ thứ gì giữa lúc duyệt và lúc ghi ⇒ ABORT.
 *
 * Tệp này nằm trong đồ thị import của script CHỈ-ĐỌC (lưới `[QN-DT-01]`): chỉ kiểu + hàm thuần, không lệnh ghi, không import ngoài danh sách cho phép.
 */
import { createHash } from "node:crypto";
import type { HangDiTru, KetQuaAnhXa, LyDoXemTay } from "./anh-xa-nhan-cu";
import type { MaVaiNguon } from "./danh-muc-goc";

export type PhanLoaiGhi = "AUTO" | "MANUAL_REVIEW" | "UNKNOWN" | "INVALID";

/** Loại của MỘT kết quả ánh xạ — chỉ nhìn chính nó (không nhìn trùng SĐT). Xem đầu tệp. */
export function phanLoaiGhi(kq: KetQuaAnhXa): PhanLoaiGhi {
  if (kq.loai === "INVALID") return "INVALID";
  if (kq.xemTay.length > 0) return "MANUAL_REVIEW";
  if (kq.loai === "UNKNOWN") return "UNKNOWN";
  return "AUTO";
}

/** Một dòng `LeadSourceGroup` — chỉ phần kế hoạch cần. `code` là khoá; `id` để ghi. */
export type NhomDiTru = { id: string; code: string; ownerEmployeeId: string | null; attributionWindowDays: number | null };

/** Chi tiết MỖI lead mà `HangDiTru` không mang (tầng đọc điền): đường vào gốc + dấu vết người nhập. KHÔNG PII (mã nhân viên, vai, đơn vị). */
export type ChiTietLeadDiTru = {
  /** `Lead.source` nguyên văn (ảnh chụp đường vào) — không phải PII. */
  conversionEntry: string | null;
  nguoiGioiThieu: { employeeCode: string | null; roleCodes: string[]; orgUnitId: string | null } | null;
};

export type DongKeHoach = {
  leadId: string;
  createdAt: Date;
  nhanChuan: string | null;
  /** Dòng bảng 06/10; null với nhãn rỗng. */
  stt: number | null;
  loai: Exclude<PhanLoaiGhi, "INVALID">;
  /** "" khi nhóm thiếu trong danh mục (`thieuNhom`) — kế hoạch KHÔNG ghi được. */
  groupId: string;
  groupCode: string;
  referrerEmployeeId: string | null;
  referrerRoleCode: MaVaiNguon | null;
  referrerMissing: boolean;
  otherSourceNote: string | null;
  xemTay: LyDoXemTay[];
  conversionEntry: string | null;
  nguoiGioiThieu: ChiTietLeadDiTru["nguoiGioiThieu"];
};

export type NhomDuocDung = { code: string; chuNhanVienId: string | null; cuaSoRiengNgay: number | null; soLead: number };

export type KeHoachDiTru = {
  /** Sắp theo `leadId` — tất định. */
  dong: DongKeHoach[];
  invalid: { leadId: string; nhanChuan: string | null }[];
  /** Mã nhóm mà kế hoạch cần nhưng danh mục (`LeadSourceGroup`) không có ⇒ không ghi được. */
  thieuNhom: string[];
  tong: { auto: number; review: number; unknown: number; invalid: number; ghi: number };
  /** Các nhóm ĐƯỢC DÙNG (có ≥ 1 dòng), kèm thuộc tính sẽ được CHỤP — sắp theo mã. */
  theoNhom: NhomDuocDung[];
  /**
   * Nhóm được dùng mà CHƯA có chủ: bản chụp `chuNhanVienId = null`. THÔNG TIN (báo cáo · audit) — KHÔNG phải cổng: chủ nguồn chỉ là metadata quản trị trừ khi chính sách trả tiền cho `SOURCE_OWNER`
   * (`nhom-can-chu.ts`). Cổng đọc `nhomPhaiCoChu` bên dưới.
   */
  nhomChuNull: NhomDuocDung[];
  /**
   * Tập con của `nhomChuNull`: nguồn mà một chính sách ĐANG HIỆU LỰC trả tiền cho `SOURCE_OWNER` ⇒ thiếu chủ là thiếu DỮ LIỆU NGHIỆP VỤ. Lệnh ghi TỪ CHỐI trừ khi người duyệt chấp nhận đúng danh sách này
   * (`SoDuyet.chapNhanNguonChuaCoChu`) — hoặc khai chủ trước. Không tự chọn người thay owner.
   */
  nhomPhaiCoChu: NhomDuocDung[];
  /** Setting chung lúc ghi (chụp khi nhóm không có cửa sổ riêng); null = chưa biết (báo cáo chỉ-đọc) — digest ghi rõ để khác với bản có số. */
  cuaSoMacDinhNgay: number | null;
  sha: string;
  /**
   * ĐẦU RA CHO OWNER KÝ (cổng ghi Wave 1, `lib/security/cong-ghi-wave1.ts`): MỘT dòng cho MỖI lead sẽ ghi (`dong`), đã NHÚNG bản chụp nguồn (chủ · cửa sổ riêng · cửa sổ mặc định) vào chính dòng đó.
   * Vì sao nhúng: bản chụp quyết tiền hoa hồng về sau; để nó ở dòng riêng thì `expectedRowCount` ≠ số lead và đổi chủ nguồn giữa lúc ký và lúc ghi chỉ bị `--ke-hoach-sha` bắt, không bị chữ ký bắt.
   * Số dòng = `tong.ghi`. Chỉ có phân loại + định danh, không tên/SĐT/email.
   */
  dongDauRa: string[];
};

/** Tất cả tham số BẮT BUỘC (luật 7). */
export function dungKeHoachDiTru(i: {
  hang: readonly HangDiTru[];
  chiTiet: ReadonlyMap<string, ChiTietLeadDiTru>;
  nhom: readonly NhomDiTru[];
  /** Mã nguồn mà chính sách đang hiệu lực cần chủ (`nhomNguonCanChu`, đọc bằng `docNhomCanChuNguon`). BẮT BUỘC (luật 7): quên truyền = cổng chủ nguồn không bao giờ chặn. */
  nhomCanChu: ReadonlySet<string>;
  cuaSoMacDinhNgay: number | null;
}): KeHoachDiTru {
  const nhomTheoMa = new Map(i.nhom.map((g) => [g.code, g]));
  const dong: DongKeHoach[] = [];
  const invalid: KeHoachDiTru["invalid"] = [];
  const thieu = new Set<string>();
  const tong = { auto: 0, review: 0, unknown: 0, invalid: 0, ghi: 0 };

  for (const h of i.hang) {
    const k = h.kq;
    if (k.loai === "INVALID") {
      tong.invalid += 1;
      invalid.push({ leadId: h.leadId, nhanChuan: h.nhanChuan });
      continue;
    }
    const loai = phanLoaiGhi(k) as Exclude<PhanLoaiGhi, "INVALID">;
    const g = nhomTheoMa.get(k.nhom);
    if (!g) thieu.add(k.nhom);
    const ct = i.chiTiet.get(h.leadId);
    if (loai === "AUTO") tong.auto += 1;
    else if (loai === "MANUAL_REVIEW") tong.review += 1;
    else tong.unknown += 1;
    dong.push({
      leadId: h.leadId,
      createdAt: h.createdAt,
      nhanChuan: h.nhanChuan,
      stt: k.stt,
      loai,
      groupId: g?.id ?? "",
      groupCode: k.nhom,
      referrerEmployeeId: k.nguoi?.employeeId ?? null,
      referrerRoleCode: k.vaiNguon,
      referrerMissing: k.referrerMissing,
      otherSourceNote: k.giaiTrinh,
      xemTay: [...k.xemTay],
      conversionEntry: ct?.conversionEntry ?? null,
      nguoiGioiThieu: ct?.nguoiGioiThieu ?? null,
    });
  }
  tong.ghi = tong.auto + tong.review + tong.unknown;
  dong.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));
  invalid.sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0));

  const dem = new Map<string, number>();
  for (const d of dong) dem.set(d.groupCode, (dem.get(d.groupCode) ?? 0) + 1);
  const theoNhom: NhomDuocDung[] = [...dem.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, soLead]) => {
      const g = nhomTheoMa.get(code);
      return { code, chuNhanVienId: g?.ownerEmployeeId ?? null, cuaSoRiengNgay: g?.attributionWindowDays ?? null, soLead };
    });
  const nhomChuNull = theoNhom.filter((g) => g.chuNhanVienId === null && !thieu.has(g.code));
  const nhomPhaiCoChu = nhomChuNull.filter((g) => i.nhomCanChu.has(g.code));

  const dongSha = [
    "di-tru-ke-hoach/v1",
    `cuaSoMacDinhNgay=${i.cuaSoMacDinhNgay ?? "null"}`,
    `N=${tong.ghi} AUTO=${tong.auto} REVIEW=${tong.review} UNKNOWN=${tong.unknown}`,
    ...theoNhom.map((g) => `G|${g.code}|${g.chuNhanVienId ?? ""}|${g.cuaSoRiengNgay ?? ""}`),
    ...dong.map((d) => `L|${d.leadId}|${d.groupCode}|${d.referrerEmployeeId ?? ""}|${d.referrerRoleCode ?? ""}|${d.loai}`),
  ];
  const sha = createHash("sha256").update(dongSha.join("\n"), "utf8").digest("hex");
  const dongDauRa = dong.map((d) => {
    const g = nhomTheoMa.get(d.groupCode);
    return dongDauRaDiTru(d, { chuNhanVienId: g?.ownerEmployeeId ?? null, cuaSoRiengNgay: g?.attributionWindowDays ?? null, cuaSoMacDinhNgay: i.cuaSoMacDinhNgay });
  });

  return {
    dong,
    invalid,
    thieuNhom: [...thieu].sort(),
    tong,
    theoNhom,
    nhomChuNull,
    nhomPhaiCoChu,
    cuaSoMacDinhNgay: i.cuaSoMacDinhNgay,
    sha,
    dongDauRa,
  };
}

/** MỘT dòng đầu ra để ký — định dạng cố định; không trường nào chứa `|` hay xuống dòng (id/mã/số). Đổi định dạng = đổi digest của mọi artifact đã ký. */
export function dongDauRaDiTru(d: DongKeHoach, snap: { chuNhanVienId: string | null; cuaSoRiengNgay: number | null; cuaSoMacDinhNgay: number | null }): string {
  return [
    "di-tru/v1",
    d.leadId,
    d.groupCode,
    d.referrerEmployeeId ?? "",
    d.referrerRoleCode ?? "",
    d.loai,
    snap.chuNhanVienId ?? "",
    snap.cuaSoRiengNgay === null ? "" : String(snap.cuaSoRiengNgay),
    snap.cuaSoMacDinhNgay === null ? "" : String(snap.cuaSoMacDinhNgay),
  ].join("|");
}

/**
 * Bốn số đã duyệt ở lượt chạy thử + sự CHẤP NHẬN các nguồn chưa có chủ.
 * `chapNhanNguonChuaCoChu` BẮT BUỘC (luật 7 — `tsc` liệt kê mọi chỗ gọi): danh sách MÃ nguồn người duyệt đã đọc và chấp nhận là «chưa có chủ lúc ghi». Phải KHỚP CHÍNH XÁC tập `nhomChuNull`
 * của kế hoạch lúc ghi (rỗng khi kế hoạch không có nguồn nào thiếu chủ). Nó ràng vào digest theo cách này: «nguồn nào chưa có chủ» nằm TRONG digest (dòng `G|mã|chủ|…`), nên đổi chủ giữa
 * lúc duyệt và lúc ghi làm đổi digest (LECH_SHA) trước khi tới cổng này; còn cổng này đòi người chạy GÕ TÊN từng nguồn đã đọc — không có cờ «đồng ý hết».
 */
export type SoDuyet = { soDuyet: number; soDuyetReview: number; sha: string; chapNhanNguonChuaCoChu: readonly string[] };

export type KetQuaCongGhi =
  | { ok: true }
  | { ok: false; ma: "INVALID" | "THIEU_NHOM" | "LECH_TONG" | "LECH_REVIEW" | "LECH_SHA" | "NGUON_CHUA_CO_CHU"; lyDo: string };

/**
 * Cổng của lệnh ghi — chạy TRƯỚC phép ghi đầu tiên (luật rollback: từ chối đứng trước mọi phép ghi). Thứ tự: INVALID → nhóm thiếu → tổng → review → digest → nguồn chưa có chủ.
 * Số/Digest do người chạy truyền vào là số ĐÃ DUYỆT ở lượt chạy thử; kế hoạch dựng LẠI lúc chạy.
 */
export function kiemCongGhi(kh: KeHoachDiTru, duyet: SoDuyet): KetQuaCongGhi {
  if (kh.tong.invalid > 0) {
    return {
      ok: false,
      ma: "INVALID",
      lyDo: `Còn ${kh.tong.invalid} lead có nhãn ngoài 28 dòng đã chốt (INVALID) — KHÔNG ghi gì. Chốt đích cho nhãn mới (PR riêng) rồi chạy lại.`,
    };
  }
  if (kh.thieuNhom.length > 0) {
    return { ok: false, ma: "THIEU_NHOM", lyDo: `Danh mục nguồn thiếu mã ${kh.thieuNhom.join(", ")} — migration chưa seed hoặc bảng bị xoá. KHÔNG ghi gì.` };
  }
  if (duyet.soDuyet !== kh.tong.ghi) {
    return { ok: false, ma: "LECH_TONG", lyDo: `Số đã duyệt (--expect=${duyet.soDuyet}) KHÁC số sẽ ghi lúc này (${kh.tong.ghi}) — dữ liệu đã đổi sau lượt chạy thử. KHÔNG ghi gì.` };
  }
  if (duyet.soDuyetReview !== kh.tong.review) {
    return {
      ok: false,
      ma: "LECH_REVIEW",
      lyDo: `Số xem tay đã duyệt (--expect-review=${duyet.soDuyetReview}) KHÁC số sẽ vào review lúc này (${kh.tong.review}). KHÔNG ghi gì.`,
    };
  }
  if (duyet.sha !== kh.sha) {
    return { ok: false, ma: "LECH_SHA", lyDo: `Digest kế hoạch (--ke-hoach-sha) KHÁC kế hoạch lúc này (${kh.sha.slice(0, 12)}…) — nhóm/người/chủ nguồn/cửa sổ đã đổi sau lượt chạy thử. KHÔNG ghi gì.` };
  }
  const can = kh.nhomPhaiCoChu.map((g) => g.code).sort();
  const co = [...new Set(duyet.chapNhanNguonChuaCoChu)].sort();
  if (can.length !== co.length || can.some((c, i) => c !== co[i])) {
    return {
      ok: false,
      ma: "NGUON_CHUA_CO_CHU",
      lyDo:
        can.length > 0
          ? `Kế hoạch ghi bản chụp «chưa có chủ» cho ${can.length} nguồn đang được dùng: ${can.join(", ")}. Khoản hoa hồng theo chủ nguồn của lead cũ có ngày thu đầu TRƯỚC khi nguồn có chủ sẽ TREO (không trả lùi) — ` +
            `khai chủ nguồn trước khi ghi, hoặc chấp nhận tường minh bằng --chap-nhan-nguon-chua-co-chu=${can.join(",")} (phải KHỚP ĐÚNG danh sách; đã chấp nhận: ${co.length > 0 ? co.join(",") : "không có"}). KHÔNG ghi gì.`
          : `--chap-nhan-nguon-chua-co-chu=${co.join(",")} nhưng kế hoạch lúc này KHÔNG có nguồn nào thiếu chủ (chủ đã được khai sau lượt chạy thử, hoặc gõ sai mã) — bỏ cờ này hoặc chạy thử lại. KHÔNG ghi gì.`,
    };
  }
  return { ok: true };
}
