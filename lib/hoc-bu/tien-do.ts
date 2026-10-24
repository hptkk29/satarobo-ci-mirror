// Tiến độ một case dạy bù — để Sale NHẮC điểm danh / nhận xét (chốt 30/09/2026). Thuần.

export type TienDoCase = { daDiemDanh: number; coMat: number; daNhanXet: number };

/** Thuần: đếm tiến độ từ trạng thái từng bé + bé nào đã có phiếu nhận xét. */
export function demTienDo(be: readonly { status: "PLACED" | "PRESENT" | "ABSENT"; coNhanXet: boolean }[]): TienDoCase {
  return {
    daDiemDanh: be.filter((b) => b.status !== "PLACED").length,
    coMat: be.filter((b) => b.status === "PRESENT").length,
    // Nhận xét chỉ có nghĩa với bé CÓ MẶT (bé vắng quay lại danh sách cần bù).
    daNhanXet: be.filter((b) => b.status === "PRESENT" && b.coNhanXet).length,
  };
}
