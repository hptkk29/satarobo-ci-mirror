/**
 * lib/nguon/di-tru-bao-cao.ts — PHẦN IN của báo cáo di trú/backfill: bảng «nhãn cũ × nguồn đích» bốn cột + tóm tắt kế hoạch GHI. THUẦN: không DB, không đồng hồ, không tệp.
 *
 * Dùng chung cho báo cáo CHỈ-ĐỌC (`scripts/nguon/di-tru-nguon-cu.ts`) và lệnh GHI (`di-tru-nguon-cu-ghi.ts`) — người duyệt đọc MỘT bảng, lệnh ghi in ĐÚNG bảng đó trước khi ghi.
 *
 * Bảng: Nhãn cũ · dòng bảng 06/10 · Nguồn đích · AUTO · MANUAL_REVIEW · UNKNOWN · INVALID · Count · Baseline · Delta.
 *  · Bốn cột loại là loại của điều được GHI (`phanLoaiGhi`) — cộng bốn cột = Count của dòng. Cột «Count» KHÔNG đổi nghĩa so với báo cáo cũ (để Baseline/Delta của lượt trước còn so được).
 *  · KHÔNG in dữ liệu cá nhân: chỉ nhãn hệ thống, mã nguồn, số đếm, mã nhân viên của chủ nguồn (id), digest.
 */
import { tomTatDiTru, type HangDiTru } from "./anh-xa-nhan-cu";
import { nhomGocHoacNem } from "./danh-muc-goc";
import { dungBangNhan, khoaBaseline, type DongBangNhan } from "./di-tru-bang";
import { phanLoaiGhi, type KeHoachDiTru } from "./di-tru-ke-hoach";

export type DongBangDiTru = DongBangNhan & { soAuto: number; soReview: number; soUnknown: number; soInvalid: number };

/**
 * Dựng bảng từ các dòng ánh xạ. Thứ tự + Count + Baseline + Delta lấy từ `tomTatDiTru`/`dungBangNhan` (một nguồn); bốn cột loại đếm thêm từ CHÍNH các dòng đó theo cùng khoá (nhãn × đích).
 * Dòng chỉ có trong baseline mà nay không còn (`KHONG_CON`) có cả bốn cột = 0.
 */
export function dungBangDiTru(hang: readonly HangDiTru[], baseline: ReadonlyMap<string, number> | null): DongBangDiTru[] {
  const theoNhan = tomTatDiTru(hang, new Set()).theoNhan;
  const dem = new Map<string, { auto: number; review: number; unknown: number; invalid: number }>();
  for (const h of hang) {
    // Cùng khoá với `tomTatDiTru`: nhóm đi qua `nhomGocHoacNem` (ném nếu ngoài 9 mã gốc — di trú chỉ ghi mã gốc).
    const nhom = h.kq.loai === "INVALID" ? "INVALID" : nhomGocHoacNem(h.kq.nhom);
    const khoa = `${h.nhanChuan ?? ""}\u0000${nhom}`;
    const d = dem.get(khoa) ?? { auto: 0, review: 0, unknown: 0, invalid: 0 };
    const loai = phanLoaiGhi(h.kq);
    if (loai === "AUTO") d.auto += 1;
    else if (loai === "MANUAL_REVIEW") d.review += 1;
    else if (loai === "UNKNOWN") d.unknown += 1;
    else d.invalid += 1;
    dem.set(khoa, d);
  }
  return dungBangNhan(theoNhan, baseline).map((r) => {
    const d = dem.get(khoaBaseline(r.nhanChuan, r.nhom)) ?? { auto: 0, review: 0, unknown: 0, invalid: 0 };
    return { ...r, soAuto: d.auto, soReview: d.review, soUnknown: d.unknown, soInvalid: d.invalid };
  });
}

/** Công cụ định dạng do nơi gọi truyền vào (tên nhóm đầy đủ · khung mã · số có dấu phân cách) — tệp này không biết danh mục. */
export type DinhDang = {
  tenNhom: (code: string) => string;
  ma: (s: string) => string;
  so: (n: number) => string;
};

/** Các dòng markdown của bảng. */
export function inBangDiTru(bang: readonly DongBangDiTru[], f: DinhDang): string[] {
  const ra: string[] = [];
  ra.push("| Nhãn cũ (đã chuẩn hoá) | dòng bảng 06/10 | Nguồn đích | AUTO | MANUAL_REVIEW | UNKNOWN | INVALID | Count | Baseline | Delta |");
  ra.push("|---|---:|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of bang) {
    const delta = r.delta === null ? "—" : (r.delta > 0 ? "+" : "") + f.so(r.delta);
    ra.push(
      `| ${r.nhanChuan === null ? "_(trống)_" : f.ma(r.nhanChuan)} | ${r.stt ?? "—"} | ` +
        `${r.nhom === "INVALID" ? "🔴 INVALID" : f.tenNhom(r.nhom)}${r.loai === "KHONG_CON" ? " _(không còn)_" : ""} | ` +
        `${f.so(r.soAuto)} | ${f.so(r.soReview)} | ${f.so(r.soUnknown)} | ${r.soInvalid > 0 ? "🔴 " : ""}${f.so(r.soInvalid)} | ` +
        `${f.so(r.soLead)} | ${r.baseline === null ? "—" : f.so(r.baseline)} | ${delta} |`,
    );
  }
  return ra;
}

/**
 * Tóm tắt kế hoạch GHI để người duyệt ký số: N = AUTO + REVIEW + UNKNOWN, INVALID riêng, bản chụp theo từng nhóm được dùng, nhóm chưa có chủ, digest.
 * `chiDocKhongSha`: báo cáo chỉ-đọc không biết setting chung nên KHÔNG in digest (digest của lượt chạy thử của lệnh GHI mới là số duyệt).
 */
export function inTomTatKeHoach(kh: KeHoachDiTru, f: DinhDang, o: { inSha: boolean }): string[] {
  const ra: string[] = [];
  ra.push(`**SẼ GHI (N) = AUTO + MANUAL_REVIEW + UNKNOWN = ${f.so(kh.tong.auto)} + ${f.so(kh.tong.review)} + ${f.so(kh.tong.unknown)} = ${f.so(kh.tong.ghi)}** · INVALID (không ghi): ${f.so(kh.tong.invalid)}`);
  ra.push("");
  ra.push(
    "> Backfill GHI cả dòng MANUAL_REVIEW lẫn UNKNOWN: lead không có quy nguồn thì màn «Đổi nguồn» từ chối (người duyệt không có đường sửa). «Không auto-map» nghĩa là ghi ở trạng thái xem tay " +
      `(${f.ma("OTHER")} + giải trình + ${f.ma("coXemTay")}, hoặc nhóm cần người + ${f.ma("referrerMissing")}), KHÔNG phải bỏ qua. ${f.ma("Lead.source")} không bị chạm.`,
  );
  ra.push("");
  if (kh.tong.invalid > 0) {
    ra.push(`🔴 **INVALID = ${f.so(kh.tong.invalid)} > 0 ⇒ lệnh GHI từ chối chạy** (chốt đích cho nhãn mới trước; cổng «Invalid = 0 trước khi bật quản lý nguồn lead»).`);
    ra.push("");
  }
  if (kh.thieuNhom.length > 0) {
    ra.push(`🔴 Danh mục thiếu mã ${kh.thieuNhom.map((c) => f.ma(c)).join(", ")} — lệnh GHI từ chối chạy.`);
    ra.push("");
  }
  ra.push("**Bản chụp nguồn sẽ ghi vào mỗi lead (theo nhóm)** — `signals.nguon`: chủ + cửa sổ ghi công LÚC GHI, KHÔNG đổi lại khi chủ/cửa sổ đổi sau này:");
  ra.push("");
  ra.push("| Nguồn | Số lead | Chủ nguồn (Employee.id) | Cửa sổ ghi công |");
  ra.push("|---|---:|---|---|");
  for (const g of kh.theoNhom) {
    const cuaSo = g.cuaSoRiengNgay !== null ? `${f.so(g.cuaSoRiengNgay)} ngày (riêng)` : kh.cuaSoMacDinhNgay !== null ? `${f.so(kh.cuaSoMacDinhNgay)} ngày (chung lúc ghi)` : "_setting chung lúc ghi_";
    ra.push(`| ${f.tenNhom(g.code)} | ${f.so(g.soLead)} | ${g.chuNhanVienId === null ? "🔴 _chưa có chủ_" : f.ma(g.chuNhanVienId)} | ${cuaSo} |`);
  }
  ra.push("");
  // [21/10/2026] Chủ nguồn chỉ là METADATA quản trị, trừ khi một chính sách ĐANG HIỆU LỰC trả tiền cho vai `SOURCE_OWNER` (`nhom-can-chu.ts`). Nguồn chưa chủ mà không ai cần chủ ⇒ chỉ báo, không chặn;
  // nguồn chưa chủ mà có chính sách cần chủ ⇒ đỏ + chặn lệnh ghi. Không bao giờ gán chủ giả để qua cổng.
  const chuNullKhongCan = kh.nhomChuNull.filter((g) => !kh.nhomPhaiCoChu.some((x) => x.code === g.code));
  if (chuNullKhongCan.length > 0) {
    ra.push(
      `ℹ️ **${f.so(chuNullKhongCan.length)} nguồn chưa có chủ nhưng KHÔNG cần**: ${chuNullKhongCan.map((g) => `${f.ma(g.code)} (${f.so(g.soLead)} lead)`).join(", ")}. ` +
        "Không chính sách nào đang hiệu lực trả tiền cho chủ nguồn, nên chủ chỉ là metadata quản trị — KHÔNG chặn lệnh ghi và KHÔNG đổi người hưởng của bất kỳ khoản nào (nhân sự giới thiệu → người giới thiệu · " +
        "phụ huynh giới thiệu → Sale phụ trách phụ huynh theo ảnh chụp · quảng cáo / khách tự đến → theo chính sách). Khi sau này kích hoạt chính sách dùng vai chủ nguồn, cổng kích hoạt sẽ đòi khai chủ.",
    );
    ra.push("");
  }
  if (kh.nhomPhaiCoChu.length > 0) {
    const maDs = kh.nhomPhaiCoChu.map((g) => g.code).sort().join(",");
    ra.push(
      `🔴 **${f.so(kh.nhomPhaiCoChu.length)} nguồn CẦN chủ (chính sách đang hiệu lực trả tiền cho chủ nguồn) mà CHƯA có chủ**: ${kh.nhomPhaiCoChu.map((g) => `${f.ma(g.code)} (${f.so(g.soLead)} lead)`).join(", ")}. ` +
        `Bản chụp sẽ ghi ${f.ma("chuNhanVienId = null")} (nguồn «không có chủ lúc ghi»). Theo luật chủ nguồn theo LỊCH SỬ (08 §16.4) bản chụp này chỉ quyết các khoản có ngày thu đầu TRƯỚC ngày chủ nguồn có hiệu lực ` +
        "(khoản treo `NGUON_CHUA_CO_NGUOI_PHU_TRACH`, KHÔNG trả lùi cho chủ nguồn — lead cũ đã thu tiền trước ngày đó sẽ không bao giờ được trả phần chủ nguồn); khoản có ngày thu đầu SAU ngày đó thì theo lịch sử chủ nguồn. " +
        `Nút «Chụp lại chủ nguồn» bị từ chối khi nguồn đã có lịch sử. **Khai chủ nguồn TRƯỚC khi ghi** nếu muốn khác; nếu CHẤP NHẬN, lệnh ghi bắt buộc khai đúng danh sách này: ${f.ma("--chap-nhan-nguon-chua-co-chu=" + maDs)} ` +
        "(workflow: ô `chap_nhan_nguon_chua_chu`). Thiếu hoặc lệch danh sách ⇒ lệnh ghi TỪ CHỐI, không ghi gì.",
    );
    ra.push("");
  }
  if (o.inSha) {
    ra.push(`**Digest kế hoạch (--ke-hoach-sha)**: ${f.ma(kh.sha)}`);
    ra.push("");
  }
  return ra;
}
