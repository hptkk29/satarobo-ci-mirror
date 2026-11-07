import { PubAnh } from "@/components/public/pub-design/pub-anh";

/** [04] Đấu trường 2026 — mosaic ảnh Cuộc thi Sáng tạo Robotics. */
export function DauTruongSection() {
  return (
      <section id="dau-truong" className="sec gridbg" style={{backgroundColor: "var(--bg2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)"}}>
        <div className="wrap">
          <div className="head2 sv a-mask">
            <div>
              <span className="label mono">
                <b>
                  [04]
                </b>
                {" "}
                Đấu trường 2026
              </span>
              <h2>
                Thi Robotics: con mang robot
                {" "}
                <span className="grad">
                  ra sân đấu
                </span>
              </h2>
            </div>
            <p>
              Sata Robo phối hợp tổ chức Cuộc thi Sáng tạo Robotics TP Đà Nẵng lần thứ II cùng Thành Đoàn.
            </p>
            <PubAnh id="be6126a13825da02eae4c3c2c235a399" className="sticker bob hide-sm" alt="" aria-hidden="true" style={{right: "0", top: "-150px", width: "140px"}} sizes="140px" />
          </div>
          <div className="mosaic">
            <figure className="zoom brk big sv a-tilt" style={{margin: "0", borderRadius: "16px", overflow: "hidden", position: "relative"}}>
              <PubAnh id="3baf3bfe1445c597a9ac1cf30f4ef9b3" alt="Lễ trao giải Cuộc thi Sáng tạo Robotics TP Đà Nẵng 2026" style={{width: "100%", height: "100%", objectFit: "cover"}} sizes="(max-width: 860px) 100vw, 590px" />
              <figcaption className="mono" style={{position: "absolute", left: "14px", bottom: "12px", fontSize: "11px", background: "#fe8f2d", color: "#241133", padding: "5px 10px", borderRadius: "6px"}}>
                Lễ trao giải · 2026
              </figcaption>
            </figure>
            <figure className="zoom sv d2 a-tilt" style={{margin: "0", borderRadius: "16px", overflow: "hidden"}}>
              <PubAnh id="0adb05dbf41a4b9e492350b8a32cbf8a" alt="Hai học viên vui mừng nhận chứng nhận" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 30%"}} sizes="(max-width: 860px) 50vw, 290px" />
            </figure>
            <figure className="zoom sv d3 a-tilt" style={{margin: "0", borderRadius: "16px", overflow: "hidden"}}>
              <PubAnh id="8688393802f9254473968dfd4a65ba7f" alt="Học viên nhận chứng nhận cùng ban tổ chức" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 40%"}} sizes="(max-width: 860px) 50vw, 290px" />
            </figure>
            <figure className="zoom brk wide sv d4 a-tilt" style={{margin: "0", borderRadius: "16px", overflow: "hidden", position: "relative"}}>
              <PubAnh id="4e64fe8d1416507464a6f0265d287e76" alt="Vòng chung kết Cuộc thi Sáng tạo Robotics" style={{width: "100%", height: "100%", objectFit: "cover", objectPosition: "center 75%"}} sizes="(max-width: 860px) 100vw, 590px" />
              <figcaption className="mono" style={{position: "absolute", left: "14px", bottom: "12px", fontSize: "11px", background: "#fe8f2d", color: "#241133", padding: "5px 10px", borderRadius: "6px"}}>
                Vòng chung kết
              </figcaption>
            </figure>
          </div>
        </div>
      </section>
  );
}
