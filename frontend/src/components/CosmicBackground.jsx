import { useRef, useEffect, useMemo } from 'react';

function CosmicBackground() {
  const canvasRef = useRef(null);

  const config = useMemo(() => ({
    starCount: 120,
    shootingStarCount: 3,
    nebulaCount: 4,
    maxStarSize: 2.5,
    minStarSize: 0.3,
    twinkleSpeed: 0.008,
    parallaxFactor: 0.02,
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animId;
    let stars = [];
    let shootingStars = [];
    let nebulae = [];
    let mouseX = 0;
    let mouseY = 0;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initStars();
      initNebulae();
    }

    function initStars() {
      stars = [];
      for (let i = 0; i < config.starCount; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: config.minStarSize + Math.random() * (config.maxStarSize - config.minStarSize),
          opacity: 0.2 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.7,
          layer: Math.random(),
        });
      }
    }

    function initNebulae() {
      nebulae = [];
      for (let i = 0; i < config.nebulaCount; i++) {
        const colors = [
          'rgba(96, 165, 250, {{a}})',
          'rgba(167, 139, 250, {{a}})',
          'rgba(34, 211, 238, {{a}})',
          'rgba(129, 140, 248, {{a}})',
        ];
        nebulae.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 100 + Math.random() * 200,
          color: colors[i % colors.length],
          alpha: 0.015 + Math.random() * 0.02,
          phase: Math.random() * Math.PI * 2,
          speed: 0.1 + Math.random() * 0.2,
        });
      }
    }

    function createShootingStar() {
      const angle = Math.PI * 0.15 + Math.random() * Math.PI * 0.35;
      const speed = 4 + Math.random() * 6;
      shootingStars.push({
        x: Math.random() * canvas.width * 0.8 + canvas.width * 0.1,
        y: Math.random() * canvas.height * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
        trail: [],
        maxTrail: 20,
      });
    }

    function drawStar(star, time) {
      const twinkle = Math.sin(time * config.twinkleSpeed * star.speed * 60 + star.phase);
      const alpha = star.opacity * (0.5 + twinkle * 0.5);
      const parallaxX = (mouseX - canvas.width / 2) * config.parallaxFactor * star.layer;
      const parallaxY = (mouseY - canvas.height / 2) * config.parallaxFactor * star.layer;

      ctx.beginPath();
      ctx.arc(star.x + parallaxX, star.y + parallaxY, star.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
      ctx.fill();

      if (star.size > 1.5) {
        ctx.shadowBlur = star.size * 3;
        ctx.shadowColor = `rgba(96, 165, 250, ${alpha * 0.3})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    function drawNebula(nebula, time) {
      const pulse = Math.sin(time * nebula.speed + nebula.phase) * 0.3 + 0.7;
      const color = nebula.color.replace('{{a}}', (nebula.alpha * pulse).toFixed(4));
      const gradient = ctx.createRadialGradient(nebula.x, nebula.y, 0, nebula.x, nebula.y, nebula.radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.4, color.replace(/[\d.]+(?=\))/, (nebula.alpha * pulse * 0.5).toFixed(4)));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(nebula.x - nebula.radius, nebula.y - nebula.radius, nebula.radius * 2, nebula.radius * 2);
    }

    function drawShootingStars() {
      for (let i = shootingStars.length - 1; i >= 0; i--) {
        const ss = shootingStars[i];
        ss.x += ss.vx;
        ss.y += ss.vy;
        ss.life -= ss.decay;

        ss.trail.push({ x: ss.x, y: ss.y });
        if (ss.trail.length > ss.maxTrail) ss.trail.shift();

        if (ss.life <= 0) {
          shootingStars.splice(i, 1);
          continue;
        }

        for (let j = 0; j < ss.trail.length; j++) {
          const t = ss.trail[j];
          const alpha = (j / ss.trail.length) * ss.life * 0.8;
          ctx.beginPath();
          ctx.arc(t.x, t.y, 1.2 * (j / ss.trail.length), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${ss.life})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(96, 165, 250, ${ss.life * 0.5})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    function animate(time) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const nebula of nebulae) drawNebula(nebula, time);
      for (const star of stars) drawStar(star, time);
      drawShootingStars();

      if (Math.random() < 0.003) createShootingStar();

      animId = requestAnimationFrame(animate);
    }

    function handleMouseMove(e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', handleMouseMove);
    animId = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(animId);
    };
  }, [config]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
        willChange: 'transform',
      }}
      aria-hidden="true"
    />
  );
}

export default CosmicBackground;
