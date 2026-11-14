import { FF } from "@/components/public/pub-fonts";
import { PubAnh } from "@/components/public/pub-design/pub-anh";

/**
 * Trạng thái rỗng dùng chung (tin tức, tuyển dụng) — khung nét đứt + linh vật, chép từ News.dc.html
 * (`noPosts`) và Careers.dc.html (`noJobs`). `card` = biến thể Careers (nền panel, xếp cột).
 */
export function TrangThaiRong({ tieuDe, children, card = false }: { tieuDe: string; children?: React.ReactNode; card?: boolean }) {
  const khung = card
    ? { padding: "36px", borderRadius: "22px", border: "2px dashed var(--line2)", background: "var(--panel)", display: "flex", flexDirection: "column" as const, alignItems: "center", textAlign: "center" as const, gap: "10px" }
    : { textAlign: "center" as const, padding: "40px", border: "2px dashed var(--line2)", borderRadius: "20px" };
  return (
    <div style={khung}>
      <PubAnh id="933e29639ed926731a405c5e0289c62d" className="float" alt="" aria-hidden="true" style={{ height: "auto", width: "110px" }} sizes="110px" />
      <p style={card ? { margin: "0", fontFamily: FF.unbounded, fontWeight: 600, fontSize: "20px" } : { margin: "10px 0 0", fontWeight: 700 }}>{tieuDe}</p>
      {children && <p style={{ margin: card ? "0" : "4px 0 0", color: "var(--muted)", maxWidth: card ? "440px" : undefined }}>{children}</p>}
    </div>
  );
}
