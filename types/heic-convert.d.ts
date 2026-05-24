declare module "heic-convert" {
  type HeicConvertInput = {
    buffer: ArrayBuffer | Buffer;
    format: "JPEG" | "PNG";
    quality?: number;
  };

  export default function heicConvert(input: HeicConvertInput): Promise<ArrayBuffer>;
}
