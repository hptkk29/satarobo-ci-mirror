// @types/three@0.149.0 không có khai báo cho thư viện giải nén meshopt của three/examples. Chỉ khai phần dùng ở `use-pub-3d.ts`.
declare module "three/examples/jsm/libs/meshopt_decoder.module.js" {
  export const MeshoptDecoder: {
    supported: boolean;
    ready: Promise<void>;
    decodeVertexBuffer: (...args: unknown[]) => void;
    decodeIndexBuffer: (...args: unknown[]) => void;
    decodeIndexSequence: (...args: unknown[]) => void;
    decodeGltfBuffer: (...args: unknown[]) => void;
  };
}
