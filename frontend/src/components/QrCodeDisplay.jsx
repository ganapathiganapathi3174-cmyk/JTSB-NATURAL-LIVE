import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';

export default function QrCodeDisplay({ value, size = 200, bgColor = '#ffffff', fgColor = '#000000' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      color: { dark: fgColor, light: bgColor },
      errorCorrectionLevel: 'M',
    }).catch(() => {});
  }, [value, size, bgColor, fgColor]);

  if (!value) return null;

  return (
    <div className="qr-code-display">
      <canvas ref={canvasRef} style={{ borderRadius: 8, border: '1px solid var(--border)' }} />
    </div>
  );
}
