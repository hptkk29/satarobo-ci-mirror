// tests/_helpers/cong-ghi-wave1.ts — dựng `DauVaoCongGhi` HỢP LỆ (khoá EPHEMERAL sinh lúc chạy, KHÔNG có PEM nào nằm trong repo) cho các test DB gọi lõi ghi đã gắn cổng Wave 1.
//
// Mặc định tạo artifact ĐÚNG cho `rows` + `workflow` + môi trường `test` + `now`, nonce MỚI mỗi lần gọi (mỗi lượt ghi dùng một artifact — đúng luật dùng-một-lần).
// Ca nào muốn kiểm từ chối thì ghi đè đúng MỘT thứ (digest/đếm/hạn/workflow/môi trường/khoá/nonce) qua `o` — để ca đỏ vì ĐÚNG lý do đó.
import { randomBytes } from "node:crypto";
import { kyPheDuyetGhi, taoCapKhoa, type ArtifactPheDuyet } from "../../lib/security/phe-duyet-ghi";
import { WORKFLOW_WAVE1, type DauVaoCongGhi, type TenWorkflowWave1 } from "../../lib/security/cong-ghi-wave1";

type CapKhoa = ReturnType<typeof taoCapKhoa>;
let khoaChung: CapKhoa | null = null;
/** Một cặp khoá cho cả tiến trình test (sinh lười, ephemeral). */
export function khoaThu(): CapKhoa {
  khoaChung ??= taoCapKhoa();
  return khoaChung;
}

export const OWNER_THU = "owner-thu@satarobo.test";

export type TuyChinhCongGhi = {
  /** Mốc ký VÀ mốc `now` của cổng (mặc định cùng một giá trị). Bắt buộc (luật 19: test không đọc đồng hồ thật). */
  now: Date;
  /** Mốc `now` của CỔNG nếu khác lúc ký (ca hết hạn / chưa tới hạn). */
  nowCong?: Date;
  moiTruongKy?: string;
  moiTruongCong?: string;
  /** Dòng owner "đã xem" khi ký — khác `rows` thật ⇒ lệch digest/đếm. */
  rowsKy?: readonly string[];
  hanGio?: number;
  nonce?: string;
  /** Khoá ký (mặc định khoá chung) và khoá công khai/ghim mà workflow tin (mặc định cùng khoá chung). */
  khoaKy?: CapKhoa;
  khoaTin?: CapKhoa;
  /** Ghim vân tay: mặc định = vân tay khoá tin; `""` = chưa ghim. */
  ghim?: string;
  ownerIdentities?: readonly string[] | null;
  /** Workflow ghi trong artifact (mặc định = `workflow`). */
  workflowKy?: string;
};

export function dungCongGhiThu(workflow: TenWorkflowWave1, rows: readonly string[], o: TuyChinhCongGhi): { cong: DauVaoCongGhi; artifact: ArtifactPheDuyet } {
  const khoaKy = o.khoaKy ?? khoaThu();
  const khoaTin = o.khoaTin ?? khoaThu();
  const rowsKy = o.rowsKy ?? rows;
  const artifact = kyPheDuyetGhi({
    privateKeyPem: khoaKy.privateKeyPem,
    workflow: o.workflowKy ?? workflow,
    targetEnvironment: o.moiTruongKy ?? "test",
    rows: rowsKy,
    soDongOwnerKhai: rowsKy.length,
    ownerIdentity: OWNER_THU,
    now: o.now,
    hanGio: o.hanGio,
    nonce: o.nonce ?? randomBytes(16).toString("hex"),
  });
  return {
    artifact,
    cong: {
      artifact,
      publicKeyPem: khoaTin.publicKeyPem,
      keyIdTinCay: o.ghim ?? khoaTin.keyId,
      moiTruong: o.moiTruongCong ?? "test",
      ownerIdentities: o.ownerIdentities ?? null,
      now: o.nowCong ?? o.now,
      runRef: "test:1",
    },
  };
}

/**
 * `DauVaoCongGhi` cho một kế hoạch backfill nguồn (`kh.dongDauRa`). Kế hoạch RỖNG (đã backfill xong): lõi trả sớm, không cần artifact — nên trả artifact `null` thay vì ký 0 dòng (cổng không ký "ghi 0 dòng").
 * Mỗi lần gọi một artifact MỚI (nonce mới).
 */
export function congChoKeHoach(kh: { dongDauRa: readonly string[] }, now: Date): DauVaoCongGhi {
  if (kh.dongDauRa.length === 0) return { ...dungCongGhiThu(WORKFLOW_WAVE1.diTru, ["x"], { now }).cong, artifact: null };
  return dungCongGhiThu(WORKFLOW_WAVE1.diTru, kh.dongDauRa, { now }).cong;
}
