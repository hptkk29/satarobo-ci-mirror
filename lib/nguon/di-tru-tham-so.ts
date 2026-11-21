/**
 * lib/nguon/di-tru-tham-so.ts — ĐỌC THAM SỐ DÒNG LỆNH của lệnh GHI backfill (hướng E). THUẦN: nhận `argv` làm tham số (KHÔNG đọc `process.argv` ở đây).
 *
 * Luật cứng (08 §14, hướng E; bổ sung vá sau gộp 11/10/2026):
 *  · MẶC ĐỊNH là chạy thử (dry-run). GHI chỉ khi có `--apply`.
 *  · `--apply` BẮT BUỘC đi cùng đủ BỐN số đã duyệt: `--expect=<N>` · `--expect-review=<M>` · `--den=<ISO có múi giờ>` · `--ke-hoach-sha=<64 hex>`. Thiếu một ⇒ từ chối TRƯỚC khi mở kết nối.
 *  · `--expect*` / `--ke-hoach-sha` mà KHÔNG `--apply` ⇒ lỗi (người chạy tưởng đã ghi, thật ra chỉ chạy thử).
 *  · Cờ lạ / trùng / sai hình ⇒ lỗi. KHÔNG bỏ qua im lặng: một tham số gõ sai chính tả mà bị nuốt là một lượt ghi chạy với ít cổng hơn người chạy tưởng.
 *  · `--den` BẮT BUỘC có múi giờ (`Z` hoặc `±hh:mm`): «2026-10-11T00:00:00» không múi giờ đọc theo giờ máy ⇒ cùng một lệnh ra hai tập lead ở hai máy.
 *  · `--cho-phep-engine-bat`: chỉ khi chủ dự án đã duyệt hệ quả «đầu vào của kỳ hoa hồng đổi» (engine đang BẬT) — xem `di-tru-ghi.ts`.
 *  · `--chap-nhan-nguon-chua-co-chu=<MÃ,MÃ,…>`: danh sách MÃ nguồn người duyệt đã đọc và chấp nhận là «chưa có chủ lúc ghi». Mặc định (không khai) = KHÔNG chấp nhận nguồn nào ⇒ kế hoạch còn nguồn thiếu chủ thì lệnh ghi TỪ CHỐI
 *    (`kiemCongGhi`: phải khớp CHÍNH XÁC tập nguồn thiếu chủ của kế hoạch). Chỉ có nghĩa khi có `--apply`.
 */
export type ThamSoDiTru =
  | { cheDo: "CHAY_THU"; den: Date | null }
  | {
      cheDo: "GHI";
      den: Date;
      soDuyet: number;
      soDuyetReview: number;
      sha: string;
      choPhepEngineBat: boolean;
      /** Đã sắp, không trùng. [] = không chấp nhận nguồn thiếu chủ nào. */
      chapNhanNguonChuaCoChu: string[];
    };

export type KetQuaThamSo = { ok: true; thamSo: ThamSoDiTru } | { ok: false; loi: string };

const SO_NGUYEN = /^(0|[1-9]\d{0,9})$/;
const SHA = /^[0-9a-f]{64}$/;
// Rộng BẰNG (hoặc hơn) bộ kiểm mã nguồn của màn tạo nguồn (`kiemCode`: A–Z, 0–9, _; 3–40 ký tự) — mã bắt đầu bằng chữ số hay gạch dưới vẫn là mã hợp lệ.
const MA_NGUON = /^[A-Z0-9_]{1,64}$/;
const ISO_CO_MUI_GIO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function docThamSoDiTru(argv: readonly string[]): KetQuaThamSo {
  const co = new Map<string, string | true>();
  for (const a of argv) {
    const m = /^(--[a-z][a-z-]*)(?:=(.*))?$/.exec(a);
    if (!m) return { ok: false, loi: `Tham số lạ: «${a}». Chỉ nhận --apply · --expect=N · --expect-review=M · --den=ISO · --ke-hoach-sha=HEX · --cho-phep-engine-bat · --chap-nhan-nguon-chua-co-chu=MÃ,MÃ.` };
    const ten = m[1]!;
    if (!["--apply", "--expect", "--expect-review", "--den", "--ke-hoach-sha", "--cho-phep-engine-bat", "--chap-nhan-nguon-chua-co-chu"].includes(ten)) {
      return { ok: false, loi: `Tham số lạ: «${ten}». Chỉ nhận --apply · --expect=N · --expect-review=M · --den=ISO · --ke-hoach-sha=HEX · --cho-phep-engine-bat · --chap-nhan-nguon-chua-co-chu=MÃ,MÃ.` };
    }
    if (co.has(ten)) return { ok: false, loi: `Tham số «${ten}» khai hai lần.` };
    const laCo = ten === "--apply" || ten === "--cho-phep-engine-bat";
    if (laCo && m[2] !== undefined) return { ok: false, loi: `«${ten}» là cờ, không nhận giá trị.` };
    if (!laCo && (m[2] === undefined || m[2] === "")) return { ok: false, loi: `«${ten}» cần giá trị: ${ten}=…` };
    co.set(ten, laCo ? true : m[2]!);
  }

  const apply = co.has("--apply");
  const choPhepEngineBat = co.has("--cho-phep-engine-bat");

  let den: Date | null = null;
  if (co.has("--den")) {
    const v = co.get("--den") as string;
    if (!ISO_CO_MUI_GIO.test(v) || Number.isNaN(new Date(v).getTime())) {
      return { ok: false, loi: `--den phải là mốc ISO CÓ múi giờ (vd 2026-10-11T00:00:00+07:00 hoặc …Z), nhận «${v}».` };
    }
    den = new Date(v);
  }

  if (!apply) {
    for (const c of ["--expect", "--expect-review", "--ke-hoach-sha", "--cho-phep-engine-bat", "--chap-nhan-nguon-chua-co-chu"]) {
      if (co.has(c)) return { ok: false, loi: `«${c}» chỉ có nghĩa khi có --apply. Không có --apply thì lệnh CHỈ chạy thử và không ghi gì.` };
    }
    return { ok: true, thamSo: { cheDo: "CHAY_THU", den } };
  }

  const thieu = ["--expect", "--expect-review", "--den", "--ke-hoach-sha"].filter((c) => !co.has(c));
  if (thieu.length > 0) {
    return { ok: false, loi: `--apply bắt buộc đủ bốn số đã duyệt ở lượt chạy thử; thiếu: ${thieu.join(", ")}. KHÔNG ghi gì.` };
  }
  const soDuyet = co.get("--expect") as string;
  const soReview = co.get("--expect-review") as string;
  const sha = co.get("--ke-hoach-sha") as string;
  if (!SO_NGUYEN.test(soDuyet)) return { ok: false, loi: `--expect phải là số nguyên không âm, nhận «${soDuyet}».` };
  if (!SO_NGUYEN.test(soReview)) return { ok: false, loi: `--expect-review phải là số nguyên không âm, nhận «${soReview}».` };
  if (!SHA.test(sha)) return { ok: false, loi: "--ke-hoach-sha phải là SHA-256 dạng hex thường 64 ký tự (lấy từ lượt chạy thử)." };
  if (den === null) return { ok: false, loi: "--den bắt buộc khi --apply." };
  let chapNhan: string[] = [];
  if (co.has("--chap-nhan-nguon-chua-co-chu")) {
    const ds = (co.get("--chap-nhan-nguon-chua-co-chu") as string).split(",");
    if (ds.some((m) => !MA_NGUON.test(m))) {
      return { ok: false, loi: `--chap-nhan-nguon-chua-co-chu phải là danh sách MÃ nguồn (chữ HOA/số/_), ngăn bằng dấu phẩy, không khoảng trắng, không phần tử rỗng; nhận «${ds.join(",")}».` };
    }
    if (new Set(ds).size !== ds.length) return { ok: false, loi: `--chap-nhan-nguon-chua-co-chu có mã khai hai lần: «${ds.join(",")}».` };
    chapNhan = [...ds].sort();
  }
  return { ok: true, thamSo: { cheDo: "GHI", den, soDuyet: Number(soDuyet), soDuyetReview: Number(soReview), sha, choPhepEngineBat, chapNhanNguonChuaCoChu: chapNhan } };
}

/**
 * LỆNH GHI mà báo cáo chạy thử in ra cho người duyệt (§18): dựng từ CÙNG bộ cờ mà `docThamSoDiTru` đọc, nên lệnh in ra luôn là lệnh parse được (ca `[DTG-T6]` khoá bằng phép parse ngược).
 * Báo cáo trước đây chỉ in tên Ô của workflow (`so_duyet`…) — người chạy tay bằng dòng lệnh phải tự dịch sang cờ và runbook dặn «báo cáo in sẵn dòng --chap-nhan…» là SAI.
 * `den` BẮT BUỘC (lệnh GHI luôn đòi) — chạy thử không có `--den` thì nơi gọi không dựng lệnh. KHÔNG bao giờ thêm `--cho-phep-engine-bat`: đó là quyết định của chủ dự án, không phải thứ báo cáo gợi ý.
 */
export function dungLenhGhiDiTru(i: {
  soDuyet: number;
  soDuyetReview: number;
  sha: string;
  den: Date;
  chapNhanNguonChuaCoChu: readonly string[];
}): { argv: string[]; lenh: string } {
  const argv = ["--apply", `--expect=${i.soDuyet}`, `--expect-review=${i.soDuyetReview}`, `--den=${i.den.toISOString()}`, `--ke-hoach-sha=${i.sha}`];
  if (i.chapNhanNguonChuaCoChu.length > 0) argv.push(`--chap-nhan-nguon-chua-co-chu=${[...i.chapNhanNguonChuaCoChu].sort().join(",")}`);
  return { argv, lenh: `pnpm exec tsx scripts/nguon/di-tru-nguon-cu-ghi.ts ${argv.join(" ")}` };
}
