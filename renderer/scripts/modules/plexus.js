/**
 * Plexus Effect - Canvas animation with connected particles
 * Color shifting from warm to cool hues
 * With triangle fill between connected particles
 */

export class PlexusEffect {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Options
    this.particleCount = options.particleCount || 80;
    this.particleRadius = options.particleRadius || 2;
    this.lineDistance = options.lineDistance || 150;
    this.speed = options.speed || 0.5;
    this.baseOpacity = options.baseOpacity || 0.8;
    this.lineOpacity = options.lineOpacity || 0.4;
    this.fillOpacity = options.fillOpacity || 0.08;
    this.lineWidth = options.lineWidth || 1.5;

    // Color shifting
    this.hue = 0;
    this.hueSpeed = options.hueSpeed || 0.3;
    this.hueRange = options.hueRange || 60;

    this.particles = [];
    this.animationId = null;
    this.isRunning = false;
    this.time = 0;

    this._handleResize = this._handleResize.bind(this);
    this._animate = this._animate.bind(this);
  }

  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.time = 0;
    this._resize();
    this._createParticles();

    window.addEventListener('resize', this._handleResize);
    this._animate();
  }

  stop() {
    this.isRunning = false;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener('resize', this._handleResize);
    this.particles = [];
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _handleResize() {
    this._resize();
    this._createParticles();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  _createParticles() {
    this.particles = [];

    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * this.speed,
        vy: (Math.random() - 0.5) * this.speed,
        radius: Math.random() * this.particleRadius + 1,
        hueOffset: Math.random() * 30 - 15
      });
    }
  }

  _getColor(hueOffset = 0, opacity = 1) {
    const baseHue = (Math.sin(this.time * this.hueSpeed * 0.01) + 1) * 0.5 * this.hueRange;
    const hue = baseHue + hueOffset;
    const saturation = 90;
    const lightness = 55;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${opacity})`;
  }

  _getDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  _animate() {
    if (!this.isRunning) return;

    this.time++;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Update positions
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

      p.x = Math.max(0, Math.min(this.canvas.width, p.x));
      p.y = Math.max(0, Math.min(this.canvas.height, p.y));
    }

    // Find and draw triangles (filled polygons)
    const drawnTriangles = new Set();

    for (let i = 0; i < this.particles.length; i++) {
      const p1 = this.particles[i];

      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dist12 = this._getDistance(p1, p2);

        if (dist12 < this.lineDistance) {
          // Look for a third particle to form a triangle
          for (let k = j + 1; k < this.particles.length; k++) {
            const p3 = this.particles[k];
            const dist13 = this._getDistance(p1, p3);
            const dist23 = this._getDistance(p2, p3);

            if (dist13 < this.lineDistance && dist23 < this.lineDistance) {
              const triangleKey = `${i}-${j}-${k}`;
              if (!drawnTriangles.has(triangleKey)) {
                drawnTriangles.add(triangleKey);

                // Calculate average opacity based on distances
                const avgDist = (dist12 + dist13 + dist23) / 3;
                const distanceOpacity = 1 - (avgDist / this.lineDistance);
                const avgHueOffset = (p1.hueOffset + p2.hueOffset + p3.hueOffset) / 3;

                // Draw filled triangle
                this.ctx.beginPath();
                this.ctx.moveTo(p1.x, p1.y);
                this.ctx.lineTo(p2.x, p2.y);
                this.ctx.lineTo(p3.x, p3.y);
                this.ctx.closePath();
                this.ctx.fillStyle = this._getColor(avgHueOffset, this.fillOpacity * distanceOpacity);
                this.ctx.fill();
              }
            }
          }
        }
      }
    }

    // Draw lines
    for (let i = 0; i < this.particles.length; i++) {
      const p1 = this.particles[i];

      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const distance = this._getDistance(p1, p2);

        if (distance < this.lineDistance) {
          const distanceOpacity = 1 - (distance / this.lineDistance);
          const avgHueOffset = (p1.hueOffset + p2.hueOffset) / 2;

          this.ctx.beginPath();
          this.ctx.moveTo(p1.x, p1.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = this._getColor(avgHueOffset, this.lineOpacity * distanceOpacity);
          this.ctx.lineWidth = this.lineWidth;
          this.ctx.stroke();
        }
      }
    }

    // Draw particles on top
    for (const p of this.particles) {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = this._getColor(p.hueOffset, this.baseOpacity);
      this.ctx.fill();
    }

    this.animationId = requestAnimationFrame(this._animate);
  }
}
