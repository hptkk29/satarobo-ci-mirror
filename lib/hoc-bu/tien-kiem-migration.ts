// lib/hoc-bu/tien-kiem-migration.ts — TIỀN KIỂM TRƯỚC MIGRATION của đợt phát hành Học bù (11/10/2026). THUẦN: không DB, không `server-only`.
//
// Vì sao có: checker T01 (`kiem-hoc-bu.ts`) đọc các cột MỚI (`MakeupNeed.sourceType`, `courseId`…) nên trên prod CHƯA áp 7 migration nó sẽ lỗi
// "cột không tồn tại" — không thể làm "ảnh trước". Tiền kiểm này chỉ dùng cột/bảng CŨ và trả lời hai câu: (1) migration nào sẽ DỪNG hoặc BỎ QUA
// một bước vì dữ liệu hiện có; (2) mỗi câu UPDATE backfill trong migration sẽ chạm bao nhiêu dòng. Script DB: `scripts/hoc-bu-tien-kiem-migration.ts`.

export type PhanLoai = "SAFE" | "AUTO_FIXABLE" | "NEEDS_MANUAL_REVIEW" | "INVALID";

export type MucKiem = {
  ma: string;
  ten: string;
  /** Phân loại KHI dem > 0 (dem = 0 ⇒ luôn SAFE). `SAFE` = mục chỉ để ghi số. */
  loaiNeuCo: PhanLoai;
  lyDo: string;
  hanhDong: string;
  /** Migration bị ảnh hưởng (tên thư mục) nếu dem > 0. */
  migration?: string;
  /** `thongTin` = chỉ đếm để biết trước số dòng bị chạm (không phải lỗi dữ liệu). */
  loai: "chan" | "du-lieu" | "thong-tin";
};

export const MIGRATION_RELEASE = [
  "20261007200000_lich_lop_chong_trung_buoi",
  "20261007210000_hoc_bu_chuan_hoa_dong",
  "20261007220000_hoc_bu_so_luot",
  "20261008100000_hoc_bu_case_nhieu_bai",
  "20261008120000_hoc_bu_yeu_cau_phu_huynh_gan_dong",
  "20261008150000_bao_luu_nen_du_lieu",
  "20261009020000_hoc_bu_phieu_nhan_xet_muc",
] as const;

export const MUC_KIEM: readonly MucKiem[] = [
  { ma: "MG-01", loai: "chan", ten: "MakeupNeed không suy được courseId (lớp mất hoặc lớp không có khoá)", loaiNeuCo: "INVALID", migration: "20261007210000_hoc_bu_chuan_hoa_dong",
    lyDo: "migration …210000 RAISE EXCEPTION khi còn dòng không suy được courseId — cả đợt deploy DỪNG (transaction cuộn ngược, không mất gì)",
    hanhDong: "Xử từng dòng bằng tay TRƯỚC khi deploy (huỷ dòng hoặc gắn lại lớp); không có công cụ tự sửa" },
  { ma: "MG-02", loai: "chan", ten: "Nhóm buổi lớp TRÙNG (classId, date) còn sống", loaiNeuCo: "NEEDS_MANUAL_REVIEW", migration: "20261007200000_lich_lop_chong_trung_buoi",
    lyDo: "migration …200000 BỎ QUA tạo ClassSession_class_date_active_key (kèm NOTICE) khi còn nhóm trùng — deploy vẫn chạy nhưng chưa có hàng rào cuối",
    hanhDong: "hoc-bu-van-hanh `don-buoi-lop-trung` (dry-run → nhóm tự sửa được ghi với expect=N; nhóm XEM TAY người xử) rồi `tao_chi_muc=true`" },
  { ma: "MG-03", loai: "chan", ten: "Ghi danh có >1 hồ sơ bảo lưu đang MỞ", loaiNeuCo: "NEEDS_MANUAL_REVIEW", migration: "20261008150000_bao_luu_nen_du_lieu",
    lyDo: "migration …150000 BỎ QUA tạo StudentReserve_enrollment_open_key (RAISE WARNING) khi còn ghi danh có hai hồ sơ mở",
    hanhDong: "Người vận hành đóng bớt hồ sơ trùng (giữ hồ sơ đúng) rồi tạo chỉ mục bằng tay; không ảnh hưởng chạy Học bù" },
  { ma: "MG-20", loai: "du-lieu", ten: "Điểm danh gốc PRESENT/LATE nhưng makeupStatus = MADE_UP (luồng cũ ghi đè trạng thái gốc khi bù)", loaiNeuCo: "NEEDS_MANUAL_REVIEW",
    lyDo: "luồng học bù cũ đổi điểm danh gốc từ vắng sang có mặt; luật mới giữ nguyên VẮNG và chỉ gắn nhãn đã bù (HB-13)",
    hanhDong: "Sau migration: checker TV-20 + `sua-du-lieu luat=TV-20` chỉ khôi phục khi nhật ký audit chứng minh MỘT trạng thái vắng duy nhất; còn lại người duyệt" },
  { ma: "MG-21", loai: "du-lieu", ten: "MakeupNeed trỏ buổi vắng không còn tồn tại", loaiNeuCo: "INVALID",
    lyDo: "không có khoá ngoại missedSessionId — dòng mồ côi (checker TV-01 sau migration)", hanhDong: "Người duyệt: huỷ dòng; không tự xoá" },
  { ma: "MG-22", loai: "du-lieu", ten: "MakeupNeed.feeOrderItemId trỏ dòng đơn không còn tồn tại", loaiNeuCo: "INVALID",
    lyDo: "cột không có khoá ngoại; xoá đơn để lại con trỏ phí mồ côi (TV-04)", hanhDong: "Người duyệt; không sửa tiền bằng SQL tay" },
  { ma: "MG-23", loai: "du-lieu", ten: "MỘT dòng đơn phí được >1 MakeupNeed dùng chung", loaiNeuCo: "NEEDS_MANUAL_REVIEW",
    lyDo: "nguy cơ thu/hoàn phí hai lần cho hai buổi bù", hanhDong: "Kế toán + người duyệt đối chiếu; không tự sửa" },
  { ma: "MG-24", loai: "du-lieu", ten: "MakeupNeed SCHEDULED nhưng không có buổi bù nào (không MakeupCaseStudent PLACED, không makeupSessionId)", loaiNeuCo: "NEEDS_MANUAL_REVIEW",
    lyDo: "trạng thái hẹn lịch không có lịch thật (TV-15/TV-11 sau migration)", hanhDong: "Xem tay: trả về PENDING nếu đúng là không còn lịch" },
  { ma: "MG-25", loai: "du-lieu", ten: "MakeupCaseStudent PLACED nhưng MakeupNeed không SCHEDULED", loaiNeuCo: "NEEDS_MANUAL_REVIEW",
    lyDo: "bản ghi trong case lệch trạng thái dòng cần bù (TV-15)", hanhDong: "Checker TV-15 phân loại AUTO_FIXABLE khi đủ bằng chứng; chưa quyết khi chưa có số prod" },
  { ma: "MG-26", loai: "du-lieu", ten: "MakeupCase SCHEDULED không còn học viên PLACED (case rỗng)", loaiNeuCo: "NEEDS_MANUAL_REVIEW",
    lyDo: "case 'sắp dạy' không ai học (TV-10)", hanhDong: "Huỷ case rỗng qua giao diện/ hoặc để TV-10 đề xuất" },
  { ma: "MG-10", loai: "thong-tin", ten: "StudentReserve: tổng số hồ sơ (UPDATE backfill của …150000 chạy trên các dòng này)", loaiNeuCo: "SAFE",
    lyDo: "backfill: type=LEGACY (enrollmentId NULL) · status=ENDED (đã đóng) · centerId/orgUnitId từ học viên · requestedAt/standardEndDate; KHÔNG điền approvedAt", hanhDong: "Ghi số vào ghi chú deploy" },
  { ma: "MG-11", loai: "thong-tin", ten: "StudentReserve đã đóng (sẽ được đặt status=ENDED)", loaiNeuCo: "SAFE", lyDo: "UPDATE số 2 của …150000", hanhDong: "Ghi số" },
  { ma: "MG-12", loai: "thong-tin", ten: "StudentReserve không có enrollmentId (sẽ được đặt type=LEGACY)", loaiNeuCo: "SAFE", lyDo: "UPDATE số 1 của …150000", hanhDong: "Ghi số" },
  { ma: "MG-13", loai: "thong-tin", ten: "MakeupCaseStudent PRESENT/ABSENT (sẽ được đặt result COMPLETED/RELEASED)", loaiNeuCo: "SAFE", lyDo: "UPDATE của …100000", hanhDong: "Ghi số" },
  { ma: "MG-14", loai: "thong-tin", ten: "ParentRequest MAKEUP nối được tới MakeupNeed (sẽ được gán makeupNeedId)", loaiNeuCo: "SAFE", lyDo: "UPDATE của …120000; đơn không nối được giữ NULL", hanhDong: "Ghi số" },
  { ma: "MG-15", loai: "thong-tin", ten: "MakeupNeed tổng số (sẽ được backfill courseId, nhãn nguồn SYSTEM_MIGRATION)", loaiNeuCo: "SAFE", lyDo: "UPDATE của …210000", hanhDong: "Ghi số" },
  { ma: "MG-16", loai: "thong-tin", ten: "MakeupCase đời cũ (sẽ cần `case-v2-backfill`; mọi đường GHI tự nâng nên chưa backfill vẫn chạy)", loaiNeuCo: "SAFE", lyDo: "đầu vào --expect của case-v2-backfill (dry-run SAU migration cho số chính thức)", hanhDong: "Ghi số" },
  { ma: "MG-17", loai: "thong-tin", ten: "MakeupNeed usedQuota = true (nguồn nhập sổ lượt bằng `so-luot-khoi-tao`)", loaiNeuCo: "SAFE", lyDo: "đầu vào --expect của so-luot-khoi-tao (dry-run SAU migration cho số chính thức)", hanhDong: "Ghi số" },
] as const;

export type KetQuaMuc = { dem: number; mau: string[] };

export type DongBaoCao = MucKiem & KetQuaMuc & { phanLoai: PhanLoai };

export function phanLoai(m: MucKiem, dem: number): PhanLoai {
  return dem > 0 ? m.loaiNeuCo : "SAFE";
}

export function ghep(ketQua: ReadonlyMap<string, KetQuaMuc>): DongBaoCao[] {
  return MUC_KIEM.map((m) => {
    const r = ketQua.get(m.ma);
    if (!r) throw new Error(`Thiếu kết quả cho ${m.ma}`);
    return { ...m, ...r, mau: r.mau.slice(0, 10), phanLoai: phanLoai(m, r.dem) };
  });
}

/** Các migration sẽ DỪNG (chặn thật) hoặc BỎ QUA một bước. `chan` = mục loai "chan" có dem > 0. */
export function chanMigration(d: readonly DongBaoCao[]): { dung: DongBaoCao[]; boQua: DongBaoCao[] } {
  const co = d.filter((x) => x.loai === "chan" && x.dem > 0);
  return { dung: co.filter((x) => x.phanLoai === "INVALID"), boQua: co.filter((x) => x.phanLoai !== "INVALID") };
}

export function demTheoPhanLoai(d: readonly DongBaoCao[]): Record<PhanLoai, number> {
  const r: Record<PhanLoai, number> = { SAFE: 0, AUTO_FIXABLE: 0, NEEDS_MANUAL_REVIEW: 0, INVALID: 0 };
  for (const x of d) if (x.loai !== "thong-tin") r[x.phanLoai]++;
  return r;
}

export function dungBaoCao(p: {
  d: readonly DongBaoCao[];
  csdl: string;
  nguoiDung: string;
  nhanh: string;
  daAp: readonly string[];
  chua: readonly string[];
}): string {
  const { dung, boQua } = chanMigration(p.d);
  const tong = demTheoPhanLoai(p.d);
  const L: string[] = [];
  L.push("# Học bù — TIỀN KIỂM TRƯỚC MIGRATION (chỉ đọc)");
  L.push("");
  L.push(`DB \`${p.csdl}\` · user \`${p.nguoiDung}\` · nhánh \`${p.nhanh}\` · ghi được: KHÔNG`);
  L.push("");
  L.push(`**Migration release đã áp:** ${p.daAp.length ? p.daAp.map((x) => `\`${x}\``).join(", ") : "(chưa cái nào)"}`);
  L.push(`**Còn chờ áp:** ${p.chua.length}/${MIGRATION_RELEASE.length}${p.daAp.length ? " — một số mục bên dưới không còn ý nghĩa với migration đã áp" : ""}`);
  L.push("");
  L.push("## Kết luận");
  L.push(dung.length ? `- 🔴 **${dung.length} điều kiện sẽ DỪNG migration**: ${dung.map((x) => x.ma).join(", ")} — KHÔNG deploy khi chưa xử.` : "- ✅ Không có điều kiện nào làm migration DỪNG.");
  L.push(boQua.length ? `- 🟡 ${boQua.length} bước sẽ bị BỎ QUA (deploy vẫn chạy): ${boQua.map((x) => x.ma).join(", ")}.` : "- ✅ Không bước nào bị bỏ qua.");
  L.push(`- Dữ liệu (không tính mục thông tin): SAFE ${tong.SAFE} · AUTO_FIXABLE ${tong.AUTO_FIXABLE} · NEEDS_MANUAL_REVIEW ${tong.NEEDS_MANUAL_REVIEW} · INVALID ${tong.INVALID}`);
  L.push("");
  L.push("| Mã | Nội dung | Số | Phân loại | Migration |");
  L.push("|---|---|---:|---|---|");
  for (const x of p.d) L.push(`| ${x.ma} | ${x.ten} | ${x.dem} | ${x.loai === "thong-tin" ? "(thông tin)" : x.phanLoai} | ${x.dem > 0 && x.migration ? x.migration : ""} |`);
  const co = p.d.filter((x) => x.loai !== "thong-tin" && x.dem > 0);
  if (co.length) {
    L.push("");
    L.push("## Chi tiết các mục có dữ liệu");
    for (const x of co) {
      L.push(`### ${x.ma} — ${x.ten}`);
      L.push(`- số: **${x.dem}** · ${x.phanLoai}`);
      L.push(`- vì sao: ${x.lyDo}`);
      L.push(`- đề xuất: ${x.hanhDong}`);
      if (x.mau.length) L.push(`- mẫu id (≤10): ${x.mau.map((i) => `\`${i}\``).join(", ")}`);
    }
  }
  L.push("");
  L.push("*Chỉ đề xuất — không có gì được áp dụng.*");
  return L.join("\n") + "\n";
}
