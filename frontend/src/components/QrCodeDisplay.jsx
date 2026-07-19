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
    <div className="glass premium-qr" style={{ padding: '0.75rem', borderRadius: 'var(--radius-lg)', display: 'inline-block' }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
