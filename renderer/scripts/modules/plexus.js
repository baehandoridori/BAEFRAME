/**
 * Plexus Effect - Canvas animation with connected particles
 * Color shifting from warm to cool hues
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
    this.lineOpacity = options.lineOpacity || 0.25;

    // Color shifting
    this.hue = 0; // Start with red (0)
    this.hueSpeed = options.hueSpeed || 0.3; // How fast colors change
    this.hueRange = options.hueRange || 60; // Range of hue variation (0-360)

    this.particles = [];
    this.animationId = null;
    this.isRunning = false;
    this.time = 0;

    this._handleResize = this._handleResize.bind(this);
    this._animate = this._animate.bind(this);
  }

  /**
   * Initialize and start the effect
   */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.time = 0;
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
        radius: Math.random() * this.particleRadius + 1,
        hueOffset: Math.random() * 30 - 15 // Individual particle hue variation
      });
    }
  }

  /**
   * Get current color based on time
   */
  _getColor(hueOffset = 0, opacity = 1) {
    // Oscillate hue: red (0) -> orange (30) -> yellow (50) -> back
    const baseHue = (Math.sin(this.time * this.hueSpeed * 0.01) + 1) * 0.5 * this.hueRange;
    const hue = baseHue + hueOffset;
    const saturation = 90;
    const lightness = 55;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${opacity})`;
  }

  /**
   * Animation loop
   */
  _animate() {
    if (!this.isRunning) return;

    this.time++;
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

      // Draw particle with color shift
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fillStyle = this._getColor(p.hueOffset, this.baseOpacity);
      this.ctx.fill();

      // Draw lines to nearby particles
      for (let j = i + 1; j < this.particles.length; j++) {
        const p2 = this.particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.lineDistance) {
          const distanceOpacity = 1 - (distance / this.lineDistance);
          const avgHueOffset = (p.hueOffset + p2.hueOffset) / 2;

          this.ctx.beginPath();
          this.ctx.moveTo(p.x, p.y);
          this.ctx.lineTo(p2.x, p2.y);
          this.ctx.strokeStyle = this._getColor(avgHueOffset, this.lineOpacity * distanceOpacity);
          this.ctx.lineWidth = 1;
          this.ctx.stroke();
        }
      }
    }

    this.animationId = requestAnimationFrame(this._animate);
  }
}
