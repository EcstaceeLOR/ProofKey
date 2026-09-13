declare module 'qrcode' {
  function toDataURL(
    text: string,
    options?: {
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
  const QRCode: { toDataURL: typeof toDataURL };
  export default QRCode;
}
