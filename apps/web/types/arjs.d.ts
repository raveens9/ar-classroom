declare module "@ar-js-org/ar.js/three.js/build/ar-threex.mjs" {
  import type { Matrix4, Object3D } from "three";

  export class ArToolkitSource {
    domElement: HTMLVideoElement | HTMLCanvasElement;
    ready: boolean;
    constructor(parameters: {
      sourceType: "webcam" | "image" | "video";
      sourceUrl?: string;
      sourceElement?: HTMLElement;
    });
    init(onReady?: () => void, onError?: (error: Error) => void): void;
    onResizeElement(): void;
    copyElementSizeTo(element: HTMLElement): void;
  }

  export class ArToolkitContext {
    arController: { canvas: HTMLCanvasElement } | null;
    static baseURL: string;
    constructor(parameters: {
      cameraParametersUrl: string;
      detectionMode: "mono" | "color" | "color_and_matrix";
      maxDetectionRate?: number;
      canvasWidth?: number;
      canvasHeight?: number;
    });
    init(onCompleted?: () => void): void;
    update(srcElement: HTMLElement | HTMLVideoElement | HTMLCanvasElement): void;
    getProjectionMatrix(): Matrix4;
  }

  export class ArMarkerControls {
    constructor(
      arToolkitContext: ArToolkitContext,
      object3d: Object3D,
      parameters: {
        type: "pattern" | "barcode" | "unknown";
        patternUrl?: string;
        barcodeValue?: number;
        size?: number;
        smooth?: boolean;
        smoothCount?: number;
        smoothTolerance?: number;
        smoothThreshold?: number;
      }
    );
  }
}
