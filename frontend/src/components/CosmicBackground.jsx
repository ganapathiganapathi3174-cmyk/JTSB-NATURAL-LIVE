import { useRef, useEffect, useMemo, useState } from 'react';

function CosmicBackground() {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  const config = useMemo(() => ({
    starCount: 200,
    shootingStarCount: 5,
    nebulaCount: 6,
    maxStarSize: 2.5,
    minStarSize: 0.3,
    twinkleSpeed: 0.008,
    parallaxFactor: 0.02,
    particleCount: 60,
    constellationCount: 3,
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animId;
    let stars = [];
    let shootingStars = [];
    let nebulae = [];
    let particles = [];
    let constellations = [];
    let mouseX = 0;
    let mouseY = 0;
    let time = 0;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initStars();
      initNebulae();
      initParticles();
      initConstellations();
      setReady(true);
    }

    function initStars() {
      stars = [];
      for (let i = 0; i < config.starCount; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: config.minStarSize + Math.random() * (config.maxStarSize - config.minStarSize),
          opacity: 0.3 + Math.random() * 0.7,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.7,
          layer: Math.random(),
          color: Math.random() > 0.7
            ? `hsl(${220 + Math.random() * 40}, 80%, ${70 + Math.random() * 30}%)`
            : null,
        });
      }
    }

    function initNebulae() {
      nebulae = [];
      const nebulaColors = [
        'rgba(91, 95, 255, {{a}})',
        'rgba(139, 92, 246, {{a}})',
        'rgba(56, 189, 248, {{a}})',
        'rgba(129, 140, 248, {{a}})',
        'rgba(167, 139, 250, {{a}})',
        'rgba(34, 211, 238, {{a}})',
      ];
      for (let i = 0; i < config.nebulaCount; i++) {
        nebulae.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 150 + Math.random() * 250,
          color: nebulaColors[i % nebulaColors.length],
          alpha: 0.015 + Math.random() * 0.025,
          phase: Math.random() * Math.PI * 2,
          speed: 0.05 + Math.random() * 0.15,
          dx: (Math.random() - 0.5) * 0.3,
          dy: (Math.random() - 0.5) * 0.3,
        });
      }
    }

    function initParticles() {
      particles = [];
      for (let i = 0; i < config.particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: 0.5 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2 - 0.1,
          opacity: 0.2 + Math.random() * 0.4,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 0.5 + Math.random() * 0.5,
        });
      }
    }

    function initConstellations() {
      constellations = [];
      for (let c = 0; c < config.constellationCount; c++) {
        const points = [];
        const count = 4 + Math.floor(Math.random() * 4);
        const cx = Math.random() * canvas.width;
        const cy = Math.random() * canvas.height;
        for (let i = 0; i < count; i++) {
          points.push({
            x: cx + (Math.random() - 0.5) * 200,
            y: cy + (Math.random() - 0.5) * 150,
          });
        }
        constellations.push({
          points,
          opacity: 0.08 + Math.random() * 0.1,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function createShootingStar() {
      const angle = Math.PI * 0.1 + Math.random() * Math.PI * 0.35;
      const speed = 6 + Math.random() * 10;
      shootingStars.push({
        x: Math.random() * canvas.width * 0.8 + canvas.width * 0.1,
        y: Math.random() * canvas.height * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.01 + Math.random() * 0.015,
        trail: [],
        maxTrail: 25,
      });
    }

    function drawStar(star, t) {
      const twinkle = Math.sin(t * config.twinkleSpeed * star.speed * 60 + star.phase);
      const alpha = star.opacity * (0.5 + twinkle * 0.5);
      const parallaxX = (mouseX - canvas.width / 2) * config.parallaxFactor * star.layer;
      const parallaxY = (mouseY - canvas.height / 2) * config.parallaxFactor * star.layer;

      const x = star.x + parallaxX;
      const y = star.y + parallaxY;

      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fillStyle = star.color || `rgba(226, 232, 240, ${alpha})`;
      ctx.fill();

      if (star.size > 1.5) {
        ctx.shadowBlur = star.size * 4;
        ctx.shadowColor = star.color
          ? star.color.replace(/[\d.]+(?=\))/, String(alpha * 0.4))
          : `rgba(91, 95, 255, ${alpha * 0.3})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    function drawNebula(nebula, t) {
      const pulse = Math.sin(t * nebula.speed + nebula.phase) * 0.3 + 0.7;
      const color = nebula.color.replace('{{a}}', (nebula.alpha * pulse).toFixed(4));
      const x = nebula.x + Math.sin(t * nebula.speed * 0.5) * 20;
      const y = nebula.y + Math.cos(t * nebula.speed * 0.3) * 15;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, nebula.radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.4, color.replace(/[\d.]+(?=\))/, (nebula.alpha * pulse * 0.5).toFixed(4)));
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - nebula.radius, y - nebula.radius, nebula.radius * 2, nebula.radius * 2);
    }

    function drawConstellation(cons, t) {
      const pulse = Math.sin(t * 0.0005 + cons.phase) * 0.3 + 0.7;
      const alpha = cons.opacity * pulse;
      ctx.strokeStyle = `rgba(91, 95, 255, ${alpha})`;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let i = 1; i < cons.points.length; i++) {
        ctx.moveTo(cons.points[i - 1].x, cons.points[i - 1].y);
        ctx.lineTo(cons.points[i].x, cons.points[i].y);
      }
      ctx.stroke();
      for (const p of cons.points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(226, 232, 240, ${alpha * 0.8})`;
        ctx.fill();
        ctx.shadowBlur = 4;
        ctx.shadowColor = `rgba(91, 95, 255, ${alpha * 0.3})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
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
          ctx.arc(t.x, t.y, 1.5 * (j / ss.trail.length), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(226, 232, 240, ${alpha})`;
          ctx.fill();
        }

        ctx.shadowBlur = 12;
        ctx.shadowColor = `rgba(91, 95, 255, ${ss.life * 0.5})`;
        ctx.beginPath();
        ctx.arc(ss.x, ss.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${ss.life})`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    function drawParticles() {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.002;

        if (p.life <= 0 || p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height) {
          particles.splice(i, 1);
          continue;
        }

        const alpha = (p.life / p.maxLife) * p.opacity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(139, 92, 246, ${alpha * 0.5})`;
        ctx.fill();
      }

      while (particles.length < config.particleCount) {
        particles.push({
          x: Math.random() * canvas.width,
          y: canvas.height + 10,
          size: 0.5 + Math.random() * 1.5,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -(0.1 + Math.random() * 0.3),
          opacity: 0.2 + Math.random() * 0.4,
          life: 0.5 + Math.random() * 0.5,
          maxLife: 0.5 + Math.random() * 0.5,
        });
      }
    }

    function drawMilkyWay() {
      const gradient = ctx.createRadialGradient(
        canvas.width * 0.5, canvas.height * 0.4, 0,
        canvas.width * 0.5, canvas.height * 0.4, canvas.width * 0.6
      );
      gradient.addColorStop(0, 'rgba(91, 95, 255, 0.02)');
      gradient.addColorStop(0.3, 'rgba(139, 92, 246, 0.015)');
      gradient.addColorStop(0.6, 'rgba(56, 189, 248, 0.008)');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const gradient2 = ctx.createRadialGradient(
        canvas.width * 0.7, canvas.height * 0.6, 0,
        canvas.width * 0.7, canvas.height * 0.6, canvas.width * 0.4
      );
      gradient2.addColorStop(0, 'rgba(139, 92, 246, 0.015)');
      gradient2.addColorStop(0.5, 'rgba(91, 95, 255, 0.008)');
      gradient2.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function animate(timestamp) {
      time = timestamp;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      drawMilkyWay();

      for (const cons of constellations) drawConstellation(cons, timestamp);
      for (const nebula of nebulae) drawNebula(nebula, timestamp);
      for (const star of stars) drawStar(star, timestamp);
      drawParticles();
      drawShootingStars();

      if (Math.random() < 0.005) createShootingStar();

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
    <>
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
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.5s ease',
        }}
        aria-hidden="true"
      />
      <div className="cosmic-overlay" aria-hidden="true">
        <div className="cosmic-stars" />
        <div className="cosmic-grid" />
        <div className="cosmic-aurora" />
        <div className="cosmic-nebula" />
        <div className="cosmic-nebula" />
        <div className="cosmic-nebula" />
        <div className="cosmic-nebula" />
      </div>
    </>
  );
}

export default CosmicBackground;
