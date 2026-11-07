// lib/ai-lead/dich-vu/ket-noi-thuan.ts — LUẬT TRẠNG THÁI KẾT NỐI của Trung tâm kết nối AI (lát K). THUẦN: không DB, không env, không đồng hồ thật.
//
// Nguồn: test-environment-guide.md §5 (bốn tầng L1–L4, quy tắc 1–5) + §6.4 (heartbeat 200 KHÔNG chứng minh webhook/E2E) + §7 (bảng trạng thái).
// Triết lý: KHÔNG CÓ BADGE XANH MẶC ĐỊNH. Xanh (CONNECTED / E2E_VERIFIED / PROD_LIVE_VERIFIED) chỉ sinh ra từ BẰNG CHỨNG CÒN HẠN; thiếu bằng chứng,
// hết hạn, hoặc chỉ có giả lập ⇒ KHÔNG BAO GIỜ xanh. Mọi tham số vận hành (`now`, ngưỡng mất kết nối, TTL bằng chứng…) là THAM SỐ BẮT BUỘC, không mặc định
// (luật 7) — để `tsc` liệt kê chỗ gọi, và test không đọc đồng hồ thật (luật 19).
//
// ─── BẢNG ƯU TIÊN của nhãn tổng hợp `nhan` (đứng trước thắng) ──────────────────────────────────────────────────────────────
//  1. agent PROD mà cổng PROD đóng                  → BLOCKED   (BLOCKED_BY_OWNER: thiếu `ai.prodEnabled` / `ai.consentPolicyStatus`)
//  2. agent bị TẮT (kill switch, `active=false`)    → BLOCKED   (không phải DISCONNECTED: DISCONNECTED là mất liên lạc ngoài ý muốn, còn đây là Admin CHỦ ĐỘNG chặn)
//  3. `contractStatus = INCOMPATIBLE` (công tắc tay) → INCOMPATIBLE
//  4. Page đang PAUSED (chỉ khi tính theo Page)      → PAUSED
//  5. CHƯA TỪNG có heartbeat                         → UNVERIFIED  (khác STALE: "chưa từng" ≠ "đã từng rồi im")
//  6. im lặng quá `nguongNgatKetNoiMs`               → DISCONNECTED
//  7. im lặng quá `nguongMatKetNoiMs`                → STALE
//  8. còn nhịp mà có cảnh báo nặng                   → DEGRADED   (hash hợp đồng LẠ · contractStatus DEPRECATED · sự cố HIGH/CRITICAL đang mở)
//  9. L4 đạt (PASS còn hạn + chủ dự án ký)           → PROD_LIVE_VERIFIED
// 10. L3 đạt (PASS còn hạn)                          → E2E_VERIFIED
// 11. L2 đạt (PASS còn hạn)                          → CONNECTED
// 12. còn lại (có nhịp nhưng thiếu bằng chứng)       → UNVERIFIED
//
// Hash LẠ không bao giờ thành INCOMPATIBLE (P7: hash chỉ là lời khai chẩn đoán; INCOMPATIBLE là công tắc TAY) — nó chỉ chặn không cho xanh (bậc 8).
// ─── "PASS CÒN HẠN" (`kiemHanPass`) ────────────────────────────────────────────────────────────────────────────────────────
//  L1: contractHash của lần chạy = hash hiện hành · chưa quá TTL.
//  L2/L3/L4: build (`buildSha`) = build agent đang khai · contractHash lần chạy = hash agent đang khai · môi trường = môi trường agent · TẬP Page lần chạy =
//  tập Page agent đang được cấp · chưa quá TTL. Thiếu bất kỳ trường nào để so ⇒ HẾT HẠN (không chứng minh được thì không đạt).
//  Chỉ `status = PASS` mới có thể đạt. MOCK_ONLY / NOT_RUN / BLOCKED / FAIL / STALE KHÔNG BAO GIỜ đạt — kể cả L1 (chặt hơn test-environment-guide.md quy tắc 2).
import { z } from "zod";
import { RE } from "../hop-dong";
import type { MoiTruong, Severity, TrangThaiContract } from "../kieu";

/**
 * Hash SHA-256 (LF-chuẩn hoá) của `api-contract-v1.yaml` hiện hành — bản bàn giao 07/11/2026. Hằng này nằm ở ĐÂY (không đọc tệp lúc chạy: `docs/` và
 * `tests/fixtures/` không đi theo bản build). Ca `[AIK-HASH-01]` băm bản sao ở `tests/fixtures/ai-lead/` rồi so với hằng này — hợp đồng đổi mà quên đổi hằng ⇒ đỏ.
 */
export const HASH_HOP_DONG_HIEN_HANH = "4ef577350f70ea54c9eaa19bc2d49c0ba0577595bbd517f83b0914aed3bccaa5";

export type MucKiemChung = "L1" | "L2" | "L3" | "L4";
export const CAC_TANG: readonly MucKiemChung[] = ["L1", "L2", "L3", "L4"];
export type TrangThaiLanChay = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "MOCK_ONLY" | "STALE";
export type LoaiLanChay = "CONTRACT" | "PROBE" | "E2E" | "PILOT";

export type LanChay = {
  id: string;
  agentId: string | null;
  level: MucKiemChung;
  status: TrangThaiLanChay;
  kind: LoaiLanChay;
  createdAt: Date;
  buildSha: string | null;
  contractHash: string | null;
  correlationId: string | null;
  evidence: unknown;
};

/** Phần của `evidence` mà luật hết hạn cần. Không strict: phần còn lại (counts, testRunId, note…) để hiển thị. */
const evidenceDocDuoc = z.looseObject({
  environment: z.enum(["TEST", "PROD"]).optional(),
  pageIds: z.array(z.string()).optional(),
  signoffBy: z.string().optional(),
});

export function docEvidence(e: unknown): { environment?: MoiTruong; pageIds?: string[]; signoffBy?: string } {
  const r = evidenceDocDuoc.safeParse(e);
  return r.success ? r.data : {};
}

export type MucTang =
  | "DAT"
  | "HET_HAN"
  | "CHUA_CHAY"
  | "CHI_GIA_LAP"
  | "THAT_BAI"
  | "BI_CHAN"
  | "BLOCKED_BY_AGENT_TEAM"
  | "BLOCKED_BY_OWNER"
  | "CHO_CHU_KY"
  | "KHONG_AP_DUNG";

export type TangKiemChung = {
  tang: MucKiemChung;
  muc: MucTang;
  /** `true` CHỈ khi `muc === "DAT"`. Mọi giao diện chọn màu xanh PHẢI hỏi trường này, không tự suy từ `status`. */
  dat: boolean;
  lyDo: string;
  /** Lần kiểm gần nhất tính ra mức này (thời điểm lần chạy), hoặc `null` khi chưa từng chạy thật. */
  lanKiemCuoi: Date | null;
  /** Nguồn của mức này — chữ người đọc thấy ("Lần chạy PROBE #…", "Chưa có lần chạy nào"). */
  nguon: string;
  runId: string | null;
  correlationId: string | null;
  /** Có lần chạy giả lập (MOCK_ONLY) nào không — để giao diện nói rõ "chỉ giả lập" thay vì làm nó biến mất. */
  coGiaLap: boolean;
};

export type NhanKetNoi =
  | "UNVERIFIED"
  | "CONNECTED"
  | "E2E_VERIFIED"
  | "PROD_LIVE_VERIFIED"
  | "STALE"
  | "DEGRADED"
  | "DISCONNECTED"
  | "INCOMPATIBLE"
  | "PAUSED"
  | "BLOCKED";

/** Nhãn nào được phép vẽ màu xanh. Danh sách ĐÓNG, một chỗ. */
export const NHAN_XANH: ReadonlySet<NhanKetNoi> = new Set<NhanKetNoi>(["CONNECTED", "E2E_VERIFIED", "PROD_LIVE_VERIFIED"]);

export type CongProdTomTat = { allowed: boolean; thieu: readonly string[] };

export type DauVaoTinhTrang = {
  /** epoch ms — BẮT BUỘC, không `Date.now()` ở trong. */
  now: number;
  nguongMatKetNoiMs: number;
  /** Quá chừng này không có heartbeat ⇒ DISCONNECTED (lớn hơn `nguongMatKetNoiMs`). */
  nguongNgatKetNoiMs: number;
  /** Bằng chứng PASS quá tuổi này ⇒ hết hạn. */
  ttlKiemChungMs: number;
  hashHopDongHienHanh: string;
  congProd: CongProdTomTat;
  agent: {
    active: boolean;
    environment: MoiTruong;
    /** FIX-03: false ⇔ Agent TEST đang ở máy chủ PROD. BẮT BUỘC khai (tsc liệt kê chỗ gọi) — quên nó là một Agent TEST trên PROD hiện xanh. */
    moiTruongHopLe: boolean;
    contractStatus: TrangThaiContract;
    lastHeartbeatAt: Date | null;
    lastBuildSha: string | null;
    lastContractHash: string | null;
  };
  /** Tập Page đang được cấp cho agent (kể cả PAUSED). */
  pageIdsHienTai: readonly string[];
  /** Tính theo Page: trạng thái Page đó. Bỏ trống = nhãn cấp agent. */
  page?: { pageId: string; state: "ENABLED" | "PAUSED" };
  /** Mọi lần chạy liên quan: L1 (agentId null hoặc của agent) + L2–L4 của agent. Thứ tự tuỳ ý. */
  lanChay: readonly LanChay[];
  suCoMo: { tong: number; nghiemTrongNhat: Severity | null };
};

export type TrangThaiNhip = "CHUA_TUNG" | "CON_MOI" | "STALE" | "NGAT";

export type KetQuaTinhTrang = {
  nhan: NhanKetNoi;
  /** `true` ⇔ nhan ∈ NHAN_XANH. Lưới bất biến: xanh thì tầng tương ứng ĐẠT và nhịp CÒN MỚI. */
  xanh: boolean;
  lyDo: string;
  canhBao: readonly string[];
  nhip: { trangThai: TrangThaiNhip; tuoiMs: number | null; lanCuoi: Date | null };
  hopDong: { contractStatus: TrangThaiContract; hash: "KHOP" | "LA" | "CHUA_BIET" };
  tang: Record<MucKiemChung, TangKiemChung>;
};

// ─── PASS còn hạn ────────────────────────────────────────────────────────────────────────────────────────────────────────

function sapXepPage(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/** `{ conHan: true }` hoặc `{ conHan: false, lyDo }` — lý do nói ĐÚNG thứ đã đổi. THUẦN. */
export function kiemHanPass(
  run: Pick<LanChay, "level" | "createdAt" | "buildSha" | "contractHash" | "evidence">,
  ctx: Pick<DauVaoTinhTrang, "now" | "ttlKiemChungMs" | "hashHopDongHienHanh" | "pageIdsHienTai"> & {
    agent: Pick<DauVaoTinhTrang["agent"], "environment" | "lastBuildSha" | "lastContractHash">;
  },
): { conHan: true } | { conHan: false; lyDo: string } {
  const tuoi = ctx.now - run.createdAt.getTime();
  if (tuoi > ctx.ttlKiemChungMs) return { conHan: false, lyDo: "Bằng chứng đã quá hạn hiệu lực — cần chạy lại." };
  if (run.level === "L1") {
    if (run.contractHash !== ctx.hashHopDongHienHanh) return { conHan: false, lyDo: "Hợp đồng đã đổi so với lúc chạy L1 — chạy lại." };
    return { conHan: true };
  }
  const ev = docEvidence(run.evidence);
  if (ctx.agent.lastBuildSha === null || run.buildSha === null || run.buildSha !== ctx.agent.lastBuildSha) {
    return { conHan: false, lyDo: "Bản build của Agent đã đổi (hoặc không đối chiếu được) so với lúc chạy — chạy lại." };
  }
  if (ctx.agent.lastContractHash === null || run.contractHash === null || run.contractHash !== ctx.agent.lastContractHash) {
    return { conHan: false, lyDo: "Hash hợp đồng Agent khai đã đổi (hoặc không đối chiếu được) so với lúc chạy — chạy lại." };
  }
  if (ev.environment === undefined || ev.pageIds === undefined) {
    return {
      conHan: false,
      lyDo: "Bằng chứng của lần chạy thiếu môi trường / danh sách Page nên không đối chiếu được (do nơi ghi cũ) — bấm “Kiểm tra kết nối” để Agent xác nhận lại.",
    };
  }
  if (ev.environment !== ctx.agent.environment) {
    return { conHan: false, lyDo: "Môi trường của lần chạy không khớp môi trường của Agent." };
  }
  if (sapXepPage(ev.pageIds) !== sapXepPage(ctx.pageIdsHienTai)) {
    return { conHan: false, lyDo: "Tập Page được cấp cho Agent đã đổi so với lúc chạy — chạy lại." };
  }
  return { conHan: true };
}

const NHAN_TANG: Record<MucKiemChung, string> = {
  L1: "L1 Hợp đồng",
  L2: "L2 Kết nối",
  L3: "L3 Nghiệp vụ đầu-cuối",
  L4: "L4 Thử thật trên PROD",
};
export function nhanTang(t: MucKiemChung): string {
  return NHAN_TANG[t];
}

function tomTatNguon(r: LanChay): string {
  return `Lần chạy ${r.kind} (${r.status})${r.correlationId ? ` · ${r.correlationId}` : ""}`;
}

/** Tính MỘT tầng từ các lần chạy. THUẦN. `lanChay` chỉ cần chứa đúng tầng đó nhưng hàm tự lọc. */
export function tinhTang(tang: MucKiemChung, d: DauVaoTinhTrang): TangKiemChung {
  const cua = d.lanChay.filter((r) => r.level === tang);
  const coGiaLap = cua.some((r) => r.status === "MOCK_ONLY");
  // Lần chạy THẬT gần nhất. MOCK_ONLY và NOT_RUN bị loại khỏi phép chọn: một lần giả lập/chưa chạy đến sau KHÔNG được xoá một PASS thật.
  const that = cua
    .filter((r) => r.status !== "MOCK_ONLY" && r.status !== "NOT_RUN")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const co = (muc: MucTang, lyDo: string, extra?: Partial<TangKiemChung>): TangKiemChung => ({
    tang,
    muc,
    dat: muc === "DAT",
    lyDo,
    lanKiemCuoi: null,
    nguon: "Chưa có lần chạy nào",
    runId: null,
    correlationId: null,
    coGiaLap,
    ...extra,
  });

  if (tang === "L4" && d.agent.environment !== "PROD") {
    return co("KHONG_AP_DUNG", "L4 chỉ áp dụng cho Agent môi trường PROD.");
  }

  if (!that) {
    if (tang === "L1") {
      return coGiaLap
        ? co("CHI_GIA_LAP", "Mới chỉ có lần chạy giả lập (MOCK_ONLY) — không tính là đạt.")
        : co("CHUA_CHAY", "Chưa có lần chạy kiểm tra hợp đồng nào.");
    }
    if (tang === "L4") {
      const thieu = d.congProd.allowed ? "" : ` Cổng PROD đang đóng (thiếu ${d.congProd.thieu.join(", ")}).`;
      return co("BLOCKED_BY_OWNER", `Chờ chủ dự án duyệt pilot PROD.${thieu}`);
    }
    return co(
      "BLOCKED_BY_AGENT_TEAM",
      coGiaLap
        ? "Chờ đội Agent cung cấp Page thử và runtime thật (OD-06). Mới có lần chạy giả lập — không tính."
        : "Chờ đội Agent cung cấp Page thử và runtime thật (OD-06).",
    );
  }

  const baseExtra = { lanKiemCuoi: that.createdAt, nguon: tomTatNguon(that), runId: that.id, correlationId: that.correlationId };
  if (that.status === "FAIL") return co("THAT_BAI", "Lần chạy gần nhất THẤT BẠI.", baseExtra);
  if (that.status === "BLOCKED") return co("BI_CHAN", "Lần chạy gần nhất bị chặn.", baseExtra);
  if (that.status === "STALE") return co("HET_HAN", "Lần chạy được đánh dấu hết hạn.", baseExtra);

  // PASS
  const han = kiemHanPass(that, d);
  if (!han.conHan) return co("HET_HAN", han.lyDo, baseExtra);
  if (tang === "L4") {
    const ky = docEvidence(that.evidence).signoffBy;
    if (typeof ky !== "string" || ky.trim() === "") {
      return co("CHO_CHU_KY", "Pilot đã đạt nhưng CHƯA có chữ ký chủ dự án.", baseExtra);
    }
  }
  return co("DAT", "Bằng chứng PASS còn hạn.", baseExtra);
}

function tinhNhip(d: DauVaoTinhTrang): KetQuaTinhTrang["nhip"] {
  const lanCuoi = d.agent.lastHeartbeatAt;
  if (lanCuoi === null) return { trangThai: "CHUA_TUNG", tuoiMs: null, lanCuoi: null };
  const tuoi = Math.max(0, d.now - lanCuoi.getTime());
  if (tuoi > d.nguongNgatKetNoiMs) return { trangThai: "NGAT", tuoiMs: tuoi, lanCuoi };
  if (tuoi > d.nguongMatKetNoiMs) return { trangThai: "STALE", tuoiMs: tuoi, lanCuoi };
  return { trangThai: "CON_MOI", tuoiMs: tuoi, lanCuoi };
}

/** Hàm CHÍNH. THUẦN. Xem bảng ưu tiên ở đầu tệp. */
export function tinhTrangKetNoi(d: DauVaoTinhTrang): KetQuaTinhTrang {
  const tang: Record<MucKiemChung, TangKiemChung> = {
    L1: tinhTang("L1", d),
    L2: tinhTang("L2", d),
    L3: tinhTang("L3", d),
    L4: tinhTang("L4", d),
  };
  const nhip = tinhNhip(d);
  const hash: KetQuaTinhTrang["hopDong"]["hash"] =
    d.agent.lastContractHash === null ? "CHUA_BIET" : d.agent.lastContractHash === d.hashHopDongHienHanh ? "KHOP" : "LA";
  const hopDong = { contractStatus: d.agent.contractStatus, hash };

  const canhBao: string[] = [];
  if (hash === "LA") canhBao.push("Hash hợp đồng Agent khai KHÁC hash hiện hành (vẫn COMPATIBLE nhưng cần đối chiếu bản build).");
  if (d.agent.contractStatus === "DEPRECATED") canhBao.push("Hợp đồng được đặt ở trạng thái DEPRECATED.");
  const suCoNang = d.suCoMo.nghiemTrongNhat === "HIGH" || d.suCoMo.nghiemTrongNhat === "CRITICAL";
  if (suCoNang) canhBao.push(`Có sự cố mức ${d.suCoMo.nghiemTrongNhat} đang mở.`);

  const ra = (nhan: NhanKetNoi, lyDo: string): KetQuaTinhTrang => ({
    nhan,
    xanh: NHAN_XANH.has(nhan),
    lyDo,
    canhBao,
    nhip,
    hopDong,
    tang,
  });

  if (!d.agent.moiTruongHopLe) {
    return ra("BLOCKED", "Agent TEST nằm trên hệ thống PROD — Gateway chặn mọi yêu cầu của nó. Vô hiệu hoá ở màn Cấu hình (hoặc tạo Agent PROD qua cổng PROD).");
  }
  if (d.agent.environment === "PROD" && !d.congProd.allowed) {
    return ra("BLOCKED", `Chờ chủ dự án: cổng PROD đóng (thiếu ${d.congProd.thieu.join(", ") || "điều kiện"}).`);
  }
  if (!d.agent.active) return ra("BLOCKED", "Agent đã bị TẮT bằng công tắc khẩn — mọi yêu cầu của nó bị từ chối.");
  if (d.agent.contractStatus === "INCOMPATIBLE") {
    return ra("INCOMPATIBLE", "Admin đã đặt tay INCOMPATIBLE: /lead-intakes của agent này bị từ chối.");
  }
  if (d.page && d.page.state === "PAUSED") return ra("PAUSED", "Page đang được tạm dừng nhận hồ sơ.");
  if (nhip.trangThai === "CHUA_TUNG") return ra("UNVERIFIED", "Chưa từng nhận nhịp sống nào từ Agent này.");
  if (nhip.trangThai === "NGAT") return ra("DISCONNECTED", "Agent im lặng quá lâu — coi như đã ngắt kết nối.");
  if (nhip.trangThai === "STALE") return ra("STALE", "Agent im lặng quá ngưỡng mất kết nối.");
  if (hash === "LA" || d.agent.contractStatus === "DEPRECATED" || suCoNang) {
    return ra("DEGRADED", "Còn nhịp sống nhưng có cảnh báo nặng — xem chi tiết.");
  }
  if (tang.L4.dat) return ra("PROD_LIVE_VERIFIED", "Pilot PROD đạt, có chữ ký chủ dự án (người ghi tay xác nhận — Admin không quan sát được luồng này).");
  if (tang.L3.dat) return ra("E2E_VERIFIED", "Nghiệp vụ đầu-cuối đạt (L3 còn hạn) — do người ghi tay xác nhận, Admin không quan sát được luồng này.");
  if (tang.L2.dat) return ra("CONNECTED", "Đã thăm dò hai chiều thành công (L2 còn hạn) và nhịp sống còn mới.");
  return ra("UNVERIFIED", "Có nhịp sống nhưng CHƯA có bằng chứng kết nối (L2). Nhịp sống một mình không chứng minh gì thêm.");
}

// ─── NGUỒN của bằng chứng: hệ thống TỰ ĐO hay người GHI TAY ──────────────────────────────────────────────────────────────

export type NguonBangChung = "HE_THONG" | "THU_CONG";

/**
 * Bằng chứng này do ai sinh ra? THUẦN. `HE_THONG` = chính Gateway quan sát được (L2: Agent xác nhận một lần thăm dò hai chiều — chỉ sinh ra từ nhịp sống có `probeAck`, không nhập tay được).
 * `THU_CONG` = một NGƯỜI gõ vào («Ghi nhận lần kiểm chứng») — L1/L3/L4 hôm nay: Admin KHÔNG quan sát được luồng Messenger → Agent → Admin nên đó là lời xác nhận có chữ ký người, không phải số đo.
 * Nguồn do MÁY CHỦ gắn (`evidence.nguon`) — `bangChungSchema` là strict nên người dùng không tự khai được. Dòng cũ chưa có dấu: L2 ⇒ HE_THONG (kiểu duy nhất của nó), còn lại ⇒ THU_CONG.
 */
export function nguonBangChung(level: MucKiemChung, evidence: unknown): NguonBangChung {
  if (level === "L2") return "HE_THONG";
  const n = (evidence as { nguon?: unknown } | null)?.nguon;
  return n === "HE_THONG" ? "HE_THONG" : "THU_CONG";
}

export const CHU_NGUON_BANG_CHUNG: Record<NguonBangChung, string> = {
  HE_THONG: "Hệ thống đo",
  THU_CONG: "Người ghi tay — Admin không quan sát được",
};

// ─── Phép ghi nhận lần chạy thủ công (zod dùng chung cho action và test) ─────────────────────────────────────────────────

export const LY_DO_TOI_THIEU = 10;

export const bangChungSchema = z.strictObject({
  environment: z.enum(["TEST", "PROD"]),
  pageIds: z.array(z.string().regex(RE.pageId)).max(50),
  testRunId: z.string().regex(RE.testRunId).optional(),
  counts: z
    .strictObject({
      total: z.number().int().min(0).max(100_000),
      passed: z.number().int().min(0).max(100_000),
      failed: z.number().int().min(0).max(100_000),
    })
    .optional(),
  signoffBy: z.string().trim().min(3).max(100).optional(),
});
export type BangChungNhap = z.infer<typeof bangChungSchema>;

/** Cắt khoảng trắng rồi đo độ dài lý do (thao tác nguy hiểm). Trả câu lỗi hoặc `null`. */
export function kiemLyDo(lyDo: unknown): string | null {
  if (typeof lyDo !== "string" || lyDo.trim().length < LY_DO_TOI_THIEU) {
    return `Nhập lý do (ít nhất ${LY_DO_TOI_THIEU} ký tự) — lý do được ghi vào nhật ký.`;
  }
  if (lyDo.trim().length > 500) return "Lý do tối đa 500 ký tự.";
  return null;
}

// ─── Kiểm lần chạy nhập tay (THUẦN — phần cần DB ở ket-noi.ts) ─────────────────────────────────────────────────────────────

export const LOAI_THEO_TANG: Record<MucKiemChung, LoaiLanChay> = { L1: "CONTRACT", L2: "PROBE", L3: "E2E", L4: "PILOT" };

export type LanChayNhap = {
  agentId: string | null;
  level: MucKiemChung;
  status: TrangThaiLanChay;
  kind: LoaiLanChay;
  contractHash?: string | undefined;
  buildSha?: string | undefined;
  correlationId?: string | undefined;
  bangChung: BangChungNhap;
  lyDo: string;
};

/**
 * Luật nhập tay một lần chạy. Trả câu lỗi tiếng Việt hoặc `null`. THUẦN.
 *  · L2 KHÔNG nhập tay được: nó chỉ sinh ra từ thăm dò hai chiều (probe/probeAck) — gõ tay một "L2 đạt" là bịa bằng chứng kết nối.
 *  · `STALE` không nhập tay: hết hạn do HỆ THỐNG tính (`kiemHanPass`), không ai tuyên bố.
 *  · PASS của L3/L4 PHẢI có `correlationId` + `buildSha` + `contractHash` hợp lệ; L4 PASS còn cần `signoffBy` và môi trường PROD.
 */
export function kiemLanChayNhap(x: LanChayNhap): string | null {
  const lyDo = kiemLyDo(x.lyDo);
  if (lyDo) return lyDo;
  if (LOAI_THEO_TANG[x.level] !== x.kind) return `Tầng ${x.level} chỉ ghi nhận loại ${LOAI_THEO_TANG[x.level]}.`;
  if (x.level === "L2") return "L2 chỉ do thăm dò hai chiều tạo ra — bấm “Kiểm tra kết nối” và chờ Agent xác nhận, không nhập tay.";
  if (x.status === "STALE") return "Không nhập tay trạng thái STALE — hết hạn do hệ thống tự tính.";
  if (x.level !== "L1" && x.agentId === null) return "Chọn Agent cho lần chạy này.";
  if (x.buildSha !== undefined && !RE.buildSha.test(x.buildSha)) return "buildSha không hợp lệ (7–40 ký tự hex thường).";
  if (x.contractHash !== undefined && !RE.contractHash.test(x.contractHash)) return "contractHash không hợp lệ (64 ký tự hex thường).";
  if (x.correlationId !== undefined && !RE.correlationId.test(x.correlationId)) return "correlationId phải là UUID.";
  if (x.status !== "PASS") return null;
  if (x.level === "L1") {
    if (x.contractHash === undefined) return "L1 PASS cần contractHash của bản hợp đồng đã chạy.";
    return null;
  }
  if (x.correlationId === undefined) return "PASS của L3/L4 cần correlationId (UUID) làm bằng chứng.";
  if (x.buildSha === undefined) return "PASS của L3/L4 cần buildSha của bản build đã chạy.";
  if (x.contractHash === undefined) return "PASS của L3/L4 cần contractHash Agent đã khai.";
  if (x.level === "L4") {
    if (x.bangChung.environment !== "PROD") return "L4 chỉ ghi nhận cho môi trường PROD.";
    if (!x.bangChung.signoffBy) return "L4 PASS cần tên người ký của chủ dự án (signoffBy).";
  }
  return null;
}
