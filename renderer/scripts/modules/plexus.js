/**
 * Plexus Effect - Canvas animation with connected particles
 */

export class PlexusEffect {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Options
    this.particleCount = options.particleCount || 80;
    this.particleColor = options.particleColor || 'rgba(255, 208, 0, 0.6)';
    this.lineColor = options.lineColor || 'rgba(255, 208, 0, 0.15)';
    this.particleRadius = options.particleRadius || 2;
    this.lineDistance = options.lineDistance || 150;
    this.speed = options.speed || 0.5;

    this.particles = [];
    this.animationId = null;
    this.isRunning = false;

    this._handleResize = this._handleResize.bind(this);
    this._animate = this._animate.bind(this);
  }

  /**
   * Initialize and start the effect
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this._resize();
    this._createParticles();

    window.addEventListener('resize', this._handleResize);
    this._animate();
  }

  /**
   * Stop the effect
   */
  stop() {
    this.isRunning = false;

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    window.removeEventListener('resize', this._handleResize);
    this.particles = [];

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Handle window resize
   */
  _handleResize() {
    this._resize();
    this._createParticles();
  }

  /**
   * Resize canvas to fill container
   */
  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  /**
   * Create particles
   */
  _createParticles() {
    this.particles = [];

    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        vx: (Math.random() - 0.5) * this.speed,
        vy: (Math.random() - 0.5) * this.speed,
        radius: Math.random() * this.particleRadius + 1
      });
    }
  }

  /**
   * Animation loop
   */
  _animate() {
    if (!this.isRunning) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Update and draw particles
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Update position
      p.x += p.vx;
      p.y += p.vy;

      // Bounce off edges
      if (p.x < 0 || p.x > this.canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > this.canvas.height) p.vy *= -1;

      // Keep in bounds
      p.x = Math.max(0, Math.min(this.canvas.width, p.x));
      p.y = Math.max(0, Math.min(this.canvas.height, p.y));

      // Draw particle
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = this.particleColor;
      this.ctx.fill();

      // Draw lines to nearby particles
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.lineDistance) {
          const opacity = 1 - (distance / this.lineDistance);
          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = this.lineColor.replace('0.15', (0.15 * opacity).toFixed(2));
          this.ctx.lineWidth = 1;
          this.ctx.stroke();
        }
      }
    }

    this.animationId = requestAnimationFrame(this._animate);
  }
}
