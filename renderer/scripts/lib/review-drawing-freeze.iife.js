(() => {
  // node_modules/fabric/dist/index.min.mjs
  var e = Object.defineProperty;
  var t = (t2, n2) => {
    let r2 = {};
    for (var i2 in t2) e(r2, i2, { get: t2[i2], enumerable: true });
    return n2 || e(r2, Symbol.toStringTag, { value: `Module` }), r2;
  };
  function n(e24) {
    return n = typeof Symbol == `function` && typeof Symbol.iterator == `symbol` ? function(e25) {
      return typeof e25;
    } : function(e25) {
      return e25 && typeof Symbol == `function` && e25.constructor === Symbol && e25 !== Symbol.prototype ? `symbol` : typeof e25;
    }, n(e24);
  }
  function r(e24) {
    var t2 = function(e25, t3) {
      if (n(e25) != `object` || !e25) return e25;
      var r2 = e25[Symbol.toPrimitive];
      if (r2 !== void 0) {
        var i2 = r2.call(e25, t3 || `default`);
        if (n(i2) != `object`) return i2;
        throw TypeError(`@@toPrimitive must return a primitive value.`);
      }
      return (t3 === `string` ? String : Number)(e25);
    }(e24, `string`);
    return n(t2) == `symbol` ? t2 : t2 + ``;
  }
  function i(e24, t2, n2) {
    return (t2 = r(t2)) in e24 ? Object.defineProperty(e24, t2, { value: n2, enumerable: true, configurable: true, writable: true }) : e24[t2] = n2, e24;
  }
  var a = class {
    constructor() {
      i(this, `browserShadowBlurConstant`, 1), i(this, `DPI`, 96), i(this, `devicePixelRatio`, typeof window < `u` ? window.devicePixelRatio : 1), i(this, `perfLimitSizeTotal`, 2097152), i(this, `maxCacheSideLimit`, 4096), i(this, `minCacheSideLimit`, 256), i(this, `disableStyleCopyPaste`, false), i(this, `enableGLFiltering`, true), i(this, `textureSize`, 4096), i(this, `forceGLPutImageData`, false), i(this, `cachesBoundsOfCurve`, false), i(this, `fontPaths`, {}), i(this, `NUM_FRACTION_DIGITS`, 4);
    }
  };
  var o = new class extends a {
    constructor(e24) {
      super(), this.configure(e24);
    }
    configure(e24 = {}) {
      Object.assign(this, e24);
    }
    addFonts(e24 = {}) {
      this.fontPaths = { ...this.fontPaths, ...e24 };
    }
    removeFonts(e24 = []) {
      e24.forEach((e25) => {
        delete this.fontPaths[e25];
      });
    }
    clearFonts() {
      this.fontPaths = {};
    }
    restoreDefaults(e24) {
      let t2 = new a(), n2 = (e24 == null ? void 0 : e24.reduce((e25, n3) => (e25[n3] = t2[n3], e25), {})) || t2;
      this.configure(n2);
    }
  }();
  var s = (e24, ...t2) => console[e24](`fabric`, ...t2);
  var c = class extends Error {
    constructor(e24, t2) {
      super(`fabric: ${e24}`, t2);
    }
  };
  var l = class extends c {
    constructor(e24) {
      super(`${e24} 'options.signal' is in 'aborted' state`);
    }
  };
  var u = class {
  };
  var d = class extends u {
    testPrecision(e24, t2) {
      let n2 = `precision ${t2} float;
void main(){}`, r2 = e24.createShader(e24.FRAGMENT_SHADER);
      return !!r2 && (e24.shaderSource(r2, n2), e24.compileShader(r2), !!e24.getShaderParameter(r2, e24.COMPILE_STATUS));
    }
    queryWebGL(e24) {
      let t2 = e24.getContext(`webgl`);
      t2 && (this.maxTextureSize = t2.getParameter(t2.MAX_TEXTURE_SIZE), this.GLPrecision = [`highp`, `mediump`, `lowp`].find((e25) => this.testPrecision(t2, e25)), t2.getExtension(`WEBGL_lose_context`).loseContext(), s(`log`, `WebGL: max texture size ${this.maxTextureSize}`));
    }
    isSupported(e24) {
      return !!this.maxTextureSize && this.maxTextureSize >= e24;
    }
  };
  var f = {};
  var p;
  var h = () => p || (p = { document, window, isTouchSupported: `ontouchstart` in window || `ontouchstart` in document || window && window.navigator && window.navigator.maxTouchPoints > 0, WebGLProbe: new d(), dispose() {
  }, copyPasteData: f });
  var g = () => h().document;
  var _ = () => h().window;
  var v = () => {
    var e24;
    return Math.max((e24 = o.devicePixelRatio) == null ? _().devicePixelRatio : e24, 1);
  };
  var y = new class {
    constructor() {
      i(this, `boundsOfCurveCache`, {}), this.charWidthsCache = /* @__PURE__ */ new Map();
    }
    getFontCache({ fontFamily: e24, fontStyle: t2, fontWeight: n2 }) {
      e24 = e24.toLowerCase();
      let r2 = this.charWidthsCache;
      r2.has(e24) || r2.set(e24, /* @__PURE__ */ new Map());
      let i2 = r2.get(e24), a2 = `${t2.toLowerCase()}_${(n2 + ``).toLowerCase()}`;
      return i2.has(a2) || i2.set(a2, /* @__PURE__ */ new Map()), i2.get(a2);
    }
    clearFontCache(e24) {
      e24 ? this.charWidthsCache.delete((e24 || ``).toLowerCase()) : this.charWidthsCache = /* @__PURE__ */ new Map();
    }
    limitDimsByArea(e24) {
      let { perfLimitSizeTotal: t2 } = o, n2 = Math.sqrt(t2 * e24);
      return [Math.floor(n2), Math.floor(t2 / n2)];
    }
  }();
  var b = `7.4.0`;
  function x() {
  }
  var S = Math.PI / 2;
  var C = Math.PI / 4;
  var w = 2 * Math.PI;
  var ee = Math.PI / 180;
  var T = Object.freeze([1, 0, 0, 1, 0, 0]);
  var E = `center`;
  var D = `left`;
  var O = `bottom`;
  var k = `right`;
  var te = `none`;
  var ne = /\r?\n/;
  var re = `moving`;
  var ie = `scaling`;
  var ae = `rotating`;
  var oe = `rotate`;
  var A = `skewing`;
  var se = `resizing`;
  var ce = `modifyPoly`;
  var le = `changed`;
  var ue = `scale`;
  var de = `scaleX`;
  var fe = `scaleY`;
  var pe = `skewX`;
  var me = `skewY`;
  var j = `fill`;
  var he = `stroke`;
  var ge = `modified`;
  var _e = `normal`;
  var ve = `json`;
  var M = new class {
    constructor() {
      this[ve] = /* @__PURE__ */ new Map(), this.svg = /* @__PURE__ */ new Map();
    }
    has(e24) {
      return this[ve].has(e24);
    }
    getClass(e24) {
      let t2 = this[ve].get(e24);
      if (!t2) throw new c(`No class registered for ${e24}`);
      return t2;
    }
    setClass(e24, t2) {
      t2 ? this[ve].set(t2, e24) : (this[ve].set(e24.type, e24), this[ve].set(e24.type.toLowerCase(), e24));
    }
    getSVGClass(e24) {
      return this.svg.get(e24);
    }
    setSVGClass(e24, t2) {
      this.svg.set(t2 == null ? e24.type.toLowerCase() : t2, e24);
    }
  }();
  var ye = new class extends Array {
    remove(e24) {
      let t2 = this.indexOf(e24);
      t2 > -1 && this.splice(t2, 1);
    }
    cancelAll() {
      let e24 = this.splice(0);
      return e24.forEach((e25) => e25.abort()), e24;
    }
    cancelByCanvas(e24) {
      if (!e24) return [];
      let t2 = this.filter((t3) => {
        var n2;
        return t3.target === e24 || typeof t3.target == `object` && ((n2 = t3.target) == null ? void 0 : n2.canvas) === e24;
      });
      return t2.forEach((e25) => e25.abort()), t2;
    }
    cancelByTarget(e24) {
      if (!e24) return [];
      let t2 = this.filter((t3) => t3.target === e24);
      return t2.forEach((e25) => e25.abort()), t2;
    }
  }();
  var be = class {
    constructor() {
      i(this, `__eventListeners`, {});
    }
    on(e24, t2) {
      if (this.__eventListeners || (this.__eventListeners = {}), typeof e24 == `object`) return Object.entries(e24).forEach(([e25, t3]) => {
        this.on(e25, t3);
      }), () => this.off(e24);
      if (t2) {
        let n2 = e24;
        return this.__eventListeners[n2] || (this.__eventListeners[n2] = []), this.__eventListeners[n2].push(t2), () => this.off(n2, t2);
      }
      return () => false;
    }
    once(e24, t2) {
      if (typeof e24 == `object`) {
        let t3 = [];
        return Object.entries(e24).forEach(([e25, n2]) => {
          t3.push(this.once(e25, n2));
        }), () => t3.forEach((e25) => e25());
      }
      if (t2) {
        let n2 = this.on(e24, function(...e25) {
          t2.call(this, ...e25), n2();
        });
        return n2;
      }
      return () => false;
    }
    _removeEventListener(e24, t2) {
      if (this.__eventListeners[e24]) if (t2) {
        let n2 = this.__eventListeners[e24], r2 = n2.indexOf(t2);
        r2 > -1 && n2.splice(r2, 1);
      } else this.__eventListeners[e24] = [];
    }
    off(e24, t2) {
      if (this.__eventListeners) if (e24 === void 0) for (let e25 in this.__eventListeners) this._removeEventListener(e25);
      else typeof e24 == `object` ? Object.entries(e24).forEach(([e25, t3]) => {
        this._removeEventListener(e25, t3);
      }) : this._removeEventListener(e24, t2);
    }
    fire(e24, t2) {
      var n2;
      if (!this.__eventListeners) return;
      let r2 = (n2 = this.__eventListeners[e24]) == null ? void 0 : n2.concat();
      if (r2) for (let e25 = 0; e25 < r2.length; e25++) r2[e25].call(this, t2 || {});
    }
  };
  var xe = (e24, t2) => {
    let n2 = e24.indexOf(t2);
    return n2 !== -1 && e24.splice(n2, 1), e24;
  };
  var Se = (e24) => {
    if (e24 === 0) return 1;
    switch (Math.abs(e24) / S) {
      case 1:
      case 3:
        return 0;
      case 2:
        return -1;
    }
    return Math.cos(e24);
  };
  var Ce = (e24) => {
    if (e24 === 0) return 0;
    let t2 = e24 / S, n2 = Math.sign(e24);
    switch (t2) {
      case 1:
        return n2;
      case 2:
        return 0;
      case 3:
        return -n2;
    }
    return Math.sin(e24);
  };
  var N = class e2 {
    constructor(e24 = 0, t2 = 0) {
      typeof e24 == `object` ? (this.x = e24.x, this.y = e24.y) : (this.x = e24, this.y = t2);
    }
    add(t2) {
      return new e2(this.x + t2.x, this.y + t2.y);
    }
    addEquals(e24) {
      return this.x += e24.x, this.y += e24.y, this;
    }
    scalarAdd(t2) {
      return new e2(this.x + t2, this.y + t2);
    }
    scalarAddEquals(e24) {
      return this.x += e24, this.y += e24, this;
    }
    subtract(t2) {
      return new e2(this.x - t2.x, this.y - t2.y);
    }
    subtractEquals(e24) {
      return this.x -= e24.x, this.y -= e24.y, this;
    }
    scalarSubtract(t2) {
      return new e2(this.x - t2, this.y - t2);
    }
    scalarSubtractEquals(e24) {
      return this.x -= e24, this.y -= e24, this;
    }
    multiply(t2) {
      return new e2(this.x * t2.x, this.y * t2.y);
    }
    scalarMultiply(t2) {
      return new e2(this.x * t2, this.y * t2);
    }
    scalarMultiplyEquals(e24) {
      return this.x *= e24, this.y *= e24, this;
    }
    divide(t2) {
      return new e2(this.x / t2.x, this.y / t2.y);
    }
    scalarDivide(t2) {
      return new e2(this.x / t2, this.y / t2);
    }
    scalarDivideEquals(e24) {
      return this.x /= e24, this.y /= e24, this;
    }
    eq(e24) {
      return this.x === e24.x && this.y === e24.y;
    }
    lt(e24) {
      return this.x < e24.x && this.y < e24.y;
    }
    lte(e24) {
      return this.x <= e24.x && this.y <= e24.y;
    }
    gt(e24) {
      return this.x > e24.x && this.y > e24.y;
    }
    gte(e24) {
      return this.x >= e24.x && this.y >= e24.y;
    }
    lerp(t2, n2 = 0.5) {
      return n2 = Math.max(Math.min(1, n2), 0), new e2(this.x + (t2.x - this.x) * n2, this.y + (t2.y - this.y) * n2);
    }
    distanceFrom(e24) {
      let t2 = this.x - e24.x, n2 = this.y - e24.y;
      return Math.sqrt(t2 * t2 + n2 * n2);
    }
    midPointFrom(e24) {
      return this.lerp(e24);
    }
    min(t2) {
      return new e2(Math.min(this.x, t2.x), Math.min(this.y, t2.y));
    }
    max(t2) {
      return new e2(Math.max(this.x, t2.x), Math.max(this.y, t2.y));
    }
    toString() {
      return `${this.x},${this.y}`;
    }
    setXY(e24, t2) {
      return this.x = e24, this.y = t2, this;
    }
    setX(e24) {
      return this.x = e24, this;
    }
    setY(e24) {
      return this.y = e24, this;
    }
    setFromPoint(e24) {
      return this.x = e24.x, this.y = e24.y, this;
    }
    swap(e24) {
      let t2 = this.x, n2 = this.y;
      this.x = e24.x, this.y = e24.y, e24.x = t2, e24.y = n2;
    }
    clone() {
      return new e2(this.x, this.y);
    }
    rotate(t2, n2 = we) {
      let r2 = Ce(t2), i2 = Se(t2), a2 = this.subtract(n2);
      return new e2(a2.x * i2 - a2.y * r2, a2.x * r2 + a2.y * i2).add(n2);
    }
    transform(t2, n2 = false) {
      return new e2(t2[0] * this.x + t2[2] * this.y + (n2 ? 0 : t2[4]), t2[1] * this.x + t2[3] * this.y + (n2 ? 0 : t2[5]));
    }
  };
  var we = new N(0, 0);
  var Te = (e24) => !!e24 && Array.isArray(e24._objects);
  function Ee(e24) {
    class t2 extends e24 {
      constructor(...e25) {
        super(...e25), i(this, `_objects`, []);
      }
      _onObjectAdded(e25) {
      }
      _onObjectRemoved(e25) {
      }
      _onStackOrderChanged(e25) {
      }
      add(...e25) {
        let t3 = this._objects.push(...e25);
        return e25.forEach((e26) => this._onObjectAdded(e26)), t3;
      }
      insertAt(e25, ...t3) {
        return this._objects.splice(e25, 0, ...t3), t3.forEach((e26) => this._onObjectAdded(e26)), this._objects.length;
      }
      remove(...e25) {
        let t3 = this._objects, n2 = [];
        return e25.forEach((e26) => {
          let r2 = t3.indexOf(e26);
          r2 !== -1 && (t3.splice(r2, 1), n2.push(e26), this._onObjectRemoved(e26));
        }), n2;
      }
      forEachObject(e25) {
        this.getObjects().forEach((t3, n2, r2) => e25(t3, n2, r2));
      }
      getObjects(...e25) {
        return e25.length === 0 ? [...this._objects] : this._objects.filter((t3) => t3.isType(...e25));
      }
      item(e25) {
        return this._objects[e25];
      }
      isEmpty() {
        return this._objects.length === 0;
      }
      size() {
        return this._objects.length;
      }
      contains(e25, n2) {
        return !!this._objects.includes(e25) || !!n2 && this._objects.some((n3) => n3 instanceof t2 && n3.contains(e25, true));
      }
      complexity() {
        return this._objects.reduce((e25, t3) => e25 += t3.complexity ? t3.complexity() : 0, 0);
      }
      sendObjectToBack(e25) {
        return !(!e25 || e25 === this._objects[0]) && (xe(this._objects, e25), this._objects.unshift(e25), this._onStackOrderChanged(e25), true);
      }
      bringObjectToFront(e25) {
        return !(!e25 || e25 === this._objects[this._objects.length - 1]) && (xe(this._objects, e25), this._objects.push(e25), this._onStackOrderChanged(e25), true);
      }
      sendObjectBackwards(e25, t3) {
        if (!e25) return false;
        let n2 = this._objects.indexOf(e25);
        if (n2 !== 0) {
          let r2 = this.findNewLowerIndex(e25, n2, t3);
          return xe(this._objects, e25), this._objects.splice(r2, 0, e25), this._onStackOrderChanged(e25), true;
        }
        return false;
      }
      bringObjectForward(e25, t3) {
        if (!e25) return false;
        let n2 = this._objects.indexOf(e25);
        if (n2 !== this._objects.length - 1) {
          let r2 = this.findNewUpperIndex(e25, n2, t3);
          return xe(this._objects, e25), this._objects.splice(r2, 0, e25), this._onStackOrderChanged(e25), true;
        }
        return false;
      }
      moveObjectTo(e25, t3) {
        return e25 !== this._objects[t3] && (xe(this._objects, e25), this._objects.splice(t3, 0, e25), this._onStackOrderChanged(e25), true);
      }
      findNewLowerIndex(e25, t3, n2) {
        let r2;
        if (n2) {
          r2 = t3;
          for (let n3 = t3 - 1; n3 >= 0; --n3) if (e25.isOverlapping(this._objects[n3])) {
            r2 = n3;
            break;
          }
        } else r2 = t3 - 1;
        return r2;
      }
      findNewUpperIndex(e25, t3, n2) {
        let r2;
        if (n2) {
          r2 = t3;
          for (let n3 = t3 + 1; n3 < this._objects.length; ++n3) if (e25.isOverlapping(this._objects[n3])) {
            r2 = n3;
            break;
          }
        } else r2 = t3 + 1;
        return r2;
      }
      collectObjects({ left: e25, top: t3, width: n2, height: r2 }, { includeIntersecting: i2 = true } = {}) {
        let a2 = [], o2 = new N(e25, t3), s2 = o2.add(new N(n2, r2));
        for (let e26 = this._objects.length - 1; e26 >= 0; e26--) {
          let t4 = this._objects[e26];
          t4.selectable && t4.visible && (i2 && t4.intersectsWithRect(o2, s2) || t4.isContainedWithinRect(o2, s2) || i2 && t4.containsPoint(o2) || i2 && t4.containsPoint(s2)) && a2.push(t4);
        }
        return a2;
      }
    }
    return t2;
  }
  var De = class extends be {
    _setOptions(e24 = {}) {
      for (let t2 in e24) this.set(t2, e24[t2]);
    }
    _setObject(e24) {
      for (let t2 in e24) this._set(t2, e24[t2]);
    }
    set(e24, t2) {
      return typeof e24 == `object` ? this._setObject(e24) : this._set(e24, t2), this;
    }
    _set(e24, t2) {
      this[e24] = t2;
    }
    toggle(e24) {
      let t2 = this.get(e24);
      return typeof t2 == `boolean` && this.set(e24, !t2), this;
    }
    get(e24) {
      return this[e24];
    }
  };
  function Oe(e24) {
    return _().requestAnimationFrame(e24);
  }
  function ke(e24) {
    return _().cancelAnimationFrame(e24);
  }
  var Ae = 0;
  var je = () => Ae++;
  var P = () => {
    let e24 = g().createElement(`canvas`);
    if (!e24 || e24.getContext === void 0) throw new c("Failed to create `canvas` element");
    return e24;
  };
  var Me = () => g().createElement(`img`);
  var Ne = (e24) => {
    var t2;
    let n2 = F(e24);
    return (t2 = n2.getContext(`2d`)) == null || t2.drawImage(e24, 0, 0), n2;
  };
  var F = (e24) => {
    let t2 = P();
    return t2.width = e24.width, t2.height = e24.height, t2;
  };
  var Pe = (e24, t2, n2) => e24.toDataURL(`image/${t2}`, n2);
  var Fe = (e24, t2, n2) => new Promise((r2, i2) => {
    e24.toBlob(r2, `image/${t2}`, n2);
  });
  var I = (e24) => e24 * ee;
  var Ie = (e24) => e24 / ee;
  var Le = (e24) => e24.every((e25, t2) => e25 === T[t2]);
  var L = (e24, t2, n2) => new N(e24).transform(t2, n2);
  var R = (e24) => {
    let t2 = 1 / (e24[0] * e24[3] - e24[1] * e24[2]), n2 = [t2 * e24[3], -t2 * e24[1], -t2 * e24[2], t2 * e24[0], 0, 0], { x: r2, y: i2 } = new N(e24[4], e24[5]).transform(n2, true);
    return n2[4] = -r2, n2[5] = -i2, n2;
  };
  var z = (e24, t2, n2) => [e24[0] * t2[0] + e24[2] * t2[1], e24[1] * t2[0] + e24[3] * t2[1], e24[0] * t2[2] + e24[2] * t2[3], e24[1] * t2[2] + e24[3] * t2[3], n2 ? 0 : e24[0] * t2[4] + e24[2] * t2[5] + e24[4], n2 ? 0 : e24[1] * t2[4] + e24[3] * t2[5] + e24[5]];
  var Re = (e24, t2) => e24.reduceRight((e25, n2) => n2 && e25 ? z(n2, e25, t2) : n2 || e25, void 0) || T.concat();
  var ze = ([e24, t2]) => Math.atan2(t2, e24);
  var Be = ([e24, t2]) => Math.sqrt(e24 * e24 + t2 * t2);
  var Ve = ([, , e24, t2]) => Math.sqrt(e24 * e24 + t2 * t2);
  var He = (e24) => {
    let t2 = ze(e24), n2 = e24[0] ** 2 + e24[1] ** 2, r2 = Math.sqrt(n2), i2 = (e24[0] * e24[3] - e24[2] * e24[1]) / r2, a2 = Math.atan2(e24[0] * e24[2] + e24[1] * e24[3], n2);
    return { angle: Ie(t2), scaleX: r2, scaleY: i2, skewX: Ie(a2), skewY: 0, translateX: e24[4] || 0, translateY: e24[5] || 0 };
  };
  var Ue = (e24, t2 = 0) => [1, 0, 0, 1, e24, t2];
  function We({ angle: e24 = 0 } = {}, { x: t2 = 0, y: n2 = 0 } = {}) {
    let r2 = I(e24), i2 = Se(r2), a2 = Ce(r2);
    return [i2, a2, -a2, i2, t2 ? t2 - (i2 * t2 - a2 * n2) : 0, n2 ? n2 - (a2 * t2 + i2 * n2) : 0];
  }
  var Ge = (e24, t2 = e24) => [e24, 0, 0, t2, 0, 0];
  var Ke = (e24) => Math.tan(I(e24));
  var qe = (e24) => [1, 0, Ke(e24), 1, 0, 0];
  var Je = (e24) => [1, Ke(e24), 0, 1, 0, 0];
  var Ye = ({ scaleX: e24 = 1, scaleY: t2 = 1, flipX: n2 = false, flipY: r2 = false, skewX: i2 = 0, skewY: a2 = 0 }) => {
    let o2 = Ge(n2 ? -e24 : e24, r2 ? -t2 : t2);
    return i2 && (o2 = z(o2, qe(i2), true)), a2 && (o2 = z(o2, Je(a2), true)), o2;
  };
  var Xe = (e24) => {
    let { translateX: t2 = 0, translateY: n2 = 0, angle: r2 = 0 } = e24, i2 = Ue(t2, n2);
    r2 && (i2 = z(i2, We({ angle: r2 })));
    let a2 = Ye(e24);
    return Le(a2) || (i2 = z(i2, a2)), i2;
  };
  var Ze = (e24, { signal: t2, crossOrigin: n2 = null } = {}) => new Promise(function(r2, i2) {
    if (t2 && t2.aborted) return i2(new l(`loadImage`));
    let a2 = Me(), o2;
    t2 && (o2 = function(e25) {
      a2.src = ``, i2(e25);
    }, t2.addEventListener(`abort`, o2, { once: true }));
    let s2 = function() {
      a2.onload = a2.onerror = null, o2 && (t2 == null || t2.removeEventListener(`abort`, o2)), r2(a2);
    };
    e24 ? (a2.onload = s2, a2.onerror = function() {
      o2 && (t2 == null || t2.removeEventListener(`abort`, o2)), i2(new c(`Error loading ${a2.src}`));
    }, n2 && (a2.crossOrigin = n2), a2.src = e24) : s2();
  });
  var Qe = (e24, { signal: t2, reviver: n2 = x } = {}) => new Promise((r2, i2) => {
    let a2 = [];
    t2 && t2.addEventListener(`abort`, i2, { once: true }), Promise.allSettled(e24.map((e25) => M.getClass(e25.type).fromObject(e25, { signal: t2 }))).then(async (t3) => {
      for (let [r3, i3] of t3.entries()) if (i3.status === `fulfilled` && (await n2(e24[r3], i3.value), a2.push(i3.value)), i3.status === `rejected`) {
        let t4 = await n2(e24[r3], void 0, i3.reason);
        t4 && a2.push(t4);
      }
      r2(a2);
    }).catch((e25) => {
      a2.forEach((e26) => {
        e26.dispose && e26.dispose();
      }), i2(e25);
    }).finally(() => {
      t2 && t2.removeEventListener(`abort`, i2);
    });
  });
  var $e = (e24, { signal: t2 } = {}) => new Promise((n2, r2) => {
    let i2 = [];
    t2 && t2.addEventListener(`abort`, r2, { once: true });
    let a2 = Object.values(e24).map((e25) => e25 && e25.type && M.has(e25.type) ? Qe([e25], { signal: t2 }).then(([e26]) => (i2.push(e26), e26)) : e25), o2 = Object.keys(e24);
    Promise.all(a2).then((e25) => e25.reduce((e26, t3, n3) => (e26[o2[n3]] = t3, e26), {})).then(n2).catch((e25) => {
      i2.forEach((e26) => {
        e26.dispose && e26.dispose();
      }), r2(e25);
    }).finally(() => {
      t2 && t2.removeEventListener(`abort`, r2);
    });
  });
  var et = (e24, t2 = []) => t2.reduce((t3, n2) => (n2 in e24 && (t3[n2] = e24[n2]), t3), {});
  var tt = (e24, t2) => Object.keys(e24).reduce((n2, r2) => (t2(e24[r2], r2, e24) && (n2[r2] = e24[r2]), n2), {});
  var B = (e24, t2) => parseFloat(Number(e24).toFixed(t2));
  var nt = (e24) => `matrix(` + e24.map((e25) => B(e25, o.NUM_FRACTION_DIGITS)).join(` `) + `)`;
  var V = (e24) => !!e24 && e24.toLive !== void 0;
  var rt = (e24) => !!e24 && typeof e24.toObject == `function`;
  var it = (e24) => !!e24 && e24.offsetX !== void 0 && `source` in e24;
  var at = (e24) => !!e24 && `multiSelectionStacking` in e24;
  function ot(e24) {
    let t2 = e24 && H(e24), n2 = 0, r2 = 0;
    if (!e24 || !t2) return { left: n2, top: r2 };
    let i2 = e24, a2 = t2.documentElement, o2 = t2.body || { scrollLeft: 0, scrollTop: 0 };
    for (; i2 && (i2.parentNode || i2.host) && (i2 = i2.parentNode || i2.host, i2 === t2 ? (n2 = o2.scrollLeft || a2.scrollLeft || 0, r2 = o2.scrollTop || a2.scrollTop || 0) : (n2 += i2.scrollLeft || 0, r2 += i2.scrollTop || 0), i2.nodeType !== 1 || i2.style.position !== `fixed`); ) ;
    return { left: n2, top: r2 };
  }
  var H = (e24) => e24.ownerDocument || null;
  var st = (e24) => {
    var t2;
    return ((t2 = e24.ownerDocument) == null ? void 0 : t2.defaultView) || null;
  };
  var ct = (e24, t2, { width: n2, height: r2 }, i2 = 1) => {
    e24.width = n2, e24.height = r2, i2 > 1 && (e24.setAttribute(`width`, (n2 * i2).toString()), e24.setAttribute(`height`, (r2 * i2).toString()), t2.scale(i2, i2));
  };
  var lt = (e24, { width: t2, height: n2 }) => {
    t2 && (e24.style.width = typeof t2 == `number` ? `${t2}px` : t2), n2 && (e24.style.height = typeof n2 == `number` ? `${n2}px` : n2);
  };
  function ut(e24) {
    return e24.onselectstart !== void 0 && (e24.onselectstart = () => false), e24.style.userSelect = te, e24;
  }
  var dt = class {
    constructor(e24) {
      i(this, `_originalCanvasStyle`, void 0), i(this, `lower`, void 0);
      let t2 = this.createLowerCanvas(e24);
      this.lower = { el: t2, ctx: t2.getContext(`2d`) };
    }
    createLowerCanvas(e24) {
      let t2 = (n2 = e24) && n2.getContext !== void 0 ? e24 : e24 && g().getElementById(e24) || P();
      var n2;
      if (t2.hasAttribute(`data-fabric`)) throw new c(`Trying to initialize a canvas that has already been initialized. Did you forget to dispose the canvas?`);
      return this._originalCanvasStyle = t2.style.cssText, t2.setAttribute(`data-fabric`, `main`), t2.classList.add(`lower-canvas`), t2;
    }
    cleanupDOM({ width: e24, height: t2 }) {
      let { el: n2 } = this.lower;
      n2.classList.remove(`lower-canvas`), n2.removeAttribute(`data-fabric`), n2.setAttribute(`width`, `${e24}`), n2.setAttribute(`height`, `${t2}`), n2.style.cssText = this._originalCanvasStyle || ``, this._originalCanvasStyle = void 0;
    }
    setDimensions(e24, t2) {
      let { el: n2, ctx: r2 } = this.lower;
      ct(n2, r2, e24, t2);
    }
    setCSSDimensions(e24) {
      lt(this.lower.el, e24);
    }
    calcOffset() {
      return function(e24) {
        var t2;
        let n2 = e24 && H(e24), r2 = { left: 0, top: 0 };
        if (!n2) return r2;
        let i2 = ((t2 = st(e24)) == null ? void 0 : t2.getComputedStyle(e24, null)) || {};
        r2.left += parseInt(i2.borderLeftWidth, 10) || 0, r2.top += parseInt(i2.borderTopWidth, 10) || 0, r2.left += parseInt(i2.paddingLeft, 10) || 0, r2.top += parseInt(i2.paddingTop, 10) || 0;
        let a2 = { left: 0, top: 0 }, o2 = n2.documentElement;
        e24.getBoundingClientRect !== void 0 && (a2 = e24.getBoundingClientRect());
        let s2 = ot(e24);
        return { left: a2.left + s2.left - (o2.clientLeft || 0) + r2.left, top: a2.top + s2.top - (o2.clientTop || 0) + r2.top };
      }(this.lower.el);
    }
    dispose() {
      h().dispose(this.lower.el), delete this.lower;
    }
  };
  var ft = { backgroundVpt: true, backgroundColor: ``, overlayVpt: true, overlayColor: ``, includeDefaultValues: true, svgViewportTransformation: true, renderOnAddRemove: true, skipOffscreen: true, enableRetinaScaling: true, imageSmoothingEnabled: true, controlsAboveOverlay: false, allowTouchScrolling: false, viewportTransform: [...T], patternQuality: `best` };
  var pt = t({ capitalize: () => mt, escapeXml: () => U, graphemeSplit: () => gt });
  var mt = (e24, t2 = false) => `${e24.charAt(0).toUpperCase()}${t2 ? e24.slice(1) : e24.slice(1).toLowerCase()}`;
  var U = (e24) => e24.toString().replace(/&/g, `&amp;`).replace(/"/g, `&quot;`).replace(/'/g, `&apos;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`);
  var ht;
  var gt = (e24) => {
    if (ht || ht || (ht = `Intl` in _() && `Segmenter` in Intl && new Intl.Segmenter(void 0, { granularity: `grapheme` })), ht) {
      let t2 = ht.segment(e24);
      return Array.from(t2).map(({ segment: e25 }) => e25);
    }
    return _t(e24);
  };
  var _t = (e24) => {
    let t2 = [];
    for (let n2, r2 = 0; r2 < e24.length; r2++) false !== (n2 = vt(e24, r2)) && t2.push(n2);
    return t2;
  };
  var vt = (e24, t2) => {
    let n2 = e24.charCodeAt(t2);
    if (isNaN(n2)) return ``;
    if (n2 < 55296 || n2 > 57343) return e24.charAt(t2);
    if (55296 <= n2 && n2 <= 56319) {
      if (e24.length <= t2 + 1) throw `High surrogate without following low surrogate`;
      let n3 = e24.charCodeAt(t2 + 1);
      if (56320 > n3 || n3 > 57343) throw `High surrogate without following low surrogate`;
      return e24.charAt(t2) + e24.charAt(t2 + 1);
    }
    if (t2 === 0) throw `Low surrogate without preceding high surrogate`;
    let r2 = e24.charCodeAt(t2 - 1);
    if (55296 > r2 || r2 > 56319) throw `Low surrogate without preceding high surrogate`;
    return false;
  };
  var yt = class e3 extends Ee(De) {
    get lowerCanvasEl() {
      var e24;
      return (e24 = this.elements.lower) == null ? void 0 : e24.el;
    }
    get contextContainer() {
      var e24;
      return (e24 = this.elements.lower) == null ? void 0 : e24.ctx;
    }
    static getDefaults() {
      return e3.ownDefaults;
    }
    constructor(e24, t2 = {}) {
      super(), Object.assign(this, this.constructor.getDefaults()), this.set(t2), this.initElements(e24), this._setDimensionsImpl({ width: this.width || this.elements.lower.el.width || 0, height: this.height || this.elements.lower.el.height || 0 }), this.skipControlsDrawing = false, this.viewportTransform = [...this.viewportTransform], this.calcViewportBoundaries();
    }
    initElements(e24) {
      this.elements = new dt(e24);
    }
    add(...e24) {
      let t2 = super.add(...e24);
      return e24.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), t2;
    }
    insertAt(e24, ...t2) {
      let n2 = super.insertAt(e24, ...t2);
      return t2.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), n2;
    }
    remove(...e24) {
      let t2 = super.remove(...e24);
      return t2.length > 0 && this.renderOnAddRemove && this.requestRenderAll(), t2;
    }
    _onObjectAdded(e24) {
      e24.canvas && e24.canvas !== this && (s(`warn`, `Canvas is trying to add an object that belongs to a different canvas.
Resulting to default behavior: removing object from previous canvas and adding to new canvas`), e24.canvas.remove(e24)), e24._set(`canvas`, this), e24.setCoords(), this.fire(`object:added`, { target: e24 }), e24.fire(`added`, { target: this });
    }
    _onObjectRemoved(e24) {
      e24._set(`canvas`, void 0), this.fire(`object:removed`, { target: e24 }), e24.fire(`removed`, { target: this });
    }
    _onStackOrderChanged() {
      this.renderOnAddRemove && this.requestRenderAll();
    }
    getRetinaScaling() {
      return this.enableRetinaScaling ? v() : 1;
    }
    calcOffset() {
      return this._offset = this.elements.calcOffset();
    }
    getWidth() {
      return this.width;
    }
    getHeight() {
      return this.height;
    }
    _setDimensionsImpl(e24, { cssOnly: t2 = false, backstoreOnly: n2 = false } = {}) {
      if (!t2) {
        let t3 = { width: this.width, height: this.height, ...e24 };
        this.elements.setDimensions(t3, this.getRetinaScaling()), this.hasLostContext = true, this.width = t3.width, this.height = t3.height;
      }
      n2 || this.elements.setCSSDimensions(e24), this.calcOffset();
    }
    setDimensions(e24, t2) {
      this._setDimensionsImpl(e24, t2), t2 && t2.cssOnly || this.requestRenderAll();
    }
    getZoom() {
      return Be(this.viewportTransform);
    }
    setViewportTransform(e24) {
      this.viewportTransform = e24, this.calcViewportBoundaries(), this.renderOnAddRemove && this.requestRenderAll();
    }
    zoomToPoint(e24, t2) {
      let n2 = e24, r2 = [...this.viewportTransform], i2 = L(e24, R(r2));
      r2[0] = t2, r2[3] = t2;
      let a2 = L(i2, r2);
      r2[4] += n2.x - a2.x, r2[5] += n2.y - a2.y, this.setViewportTransform(r2);
    }
    setZoom(e24) {
      this.zoomToPoint(new N(0, 0), e24);
    }
    absolutePan(e24) {
      let t2 = [...this.viewportTransform];
      return t2[4] = -e24.x, t2[5] = -e24.y, this.setViewportTransform(t2);
    }
    relativePan(e24) {
      return this.absolutePan(new N(-e24.x - this.viewportTransform[4], -e24.y - this.viewportTransform[5]));
    }
    getElement() {
      return this.elements.lower.el;
    }
    clearContext(e24) {
      e24.clearRect(0, 0, this.width, this.height);
    }
    getContext() {
      return this.elements.lower.ctx;
    }
    clear() {
      this.remove(...this.getObjects()), this.backgroundImage = void 0, this.overlayImage = void 0, this.backgroundColor = ``, this.overlayColor = ``, this.clearContext(this.getContext()), this.fire(`canvas:cleared`), this.renderOnAddRemove && this.requestRenderAll();
    }
    renderAll() {
      this.cancelRequestedRender(), this.destroyed || this.renderCanvas(this.getContext(), this._objects);
    }
    renderAndReset() {
      this.nextRenderHandle = 0, this.renderAll();
    }
    requestRenderAll() {
      this.nextRenderHandle || this.disposed || this.destroyed || (this.nextRenderHandle = Oe(() => this.renderAndReset()));
    }
    calcViewportBoundaries() {
      let e24 = this.width, t2 = this.height, n2 = R(this.viewportTransform), r2 = L({ x: 0, y: 0 }, n2), i2 = L({ x: e24, y: t2 }, n2), a2 = r2.min(i2), o2 = r2.max(i2);
      return this.vptCoords = { tl: a2, tr: new N(o2.x, a2.y), bl: new N(a2.x, o2.y), br: o2 };
    }
    cancelRequestedRender() {
      this.nextRenderHandle && (ke(this.nextRenderHandle), this.nextRenderHandle = 0);
    }
    drawControls(e24) {
    }
    renderCanvas(e24, t2) {
      if (this.destroyed) return;
      let n2 = this.viewportTransform, r2 = this.clipPath;
      this.calcViewportBoundaries(), this.clearContext(e24), e24.imageSmoothingEnabled = this.imageSmoothingEnabled, e24.patternQuality = this.patternQuality, this.fire(`before:render`, { ctx: e24 }), this._renderBackground(e24), e24.save(), e24.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), this._renderObjects(e24, t2), e24.restore(), this.controlsAboveOverlay || this.skipControlsDrawing || this.drawControls(e24), r2 && (r2._set(`canvas`, this), r2.shouldCache(), r2._transformDone = true, r2.renderCache({ forClipping: true }), this.drawClipPathOnCanvas(e24, r2)), this._renderOverlay(e24), this.controlsAboveOverlay && !this.skipControlsDrawing && this.drawControls(e24), this.fire(`after:render`, { ctx: e24 }), this.__cleanupTask && (this.__cleanupTask(), this.__cleanupTask = void 0);
    }
    drawClipPathOnCanvas(e24, t2) {
      let n2 = this.viewportTransform;
      e24.save(), e24.transform(...n2), e24.globalCompositeOperation = `destination-in`, t2.transform(e24), e24.scale(1 / t2.zoomX, 1 / t2.zoomY), e24.drawImage(t2._cacheCanvas, -t2.cacheTranslationX, -t2.cacheTranslationY), e24.restore();
    }
    _renderObjects(e24, t2) {
      for (let n2 = 0, r2 = t2.length; n2 < r2; ++n2) t2[n2] && t2[n2].render(e24);
    }
    _renderBackgroundOrOverlay(e24, t2) {
      let n2 = this[`${t2}Color`], r2 = this[`${t2}Image`], i2 = this.viewportTransform, a2 = this[`${t2}Vpt`];
      if (!n2 && !r2) return;
      let o2 = V(n2);
      if (n2) {
        if (e24.save(), e24.beginPath(), e24.moveTo(0, 0), e24.lineTo(this.width, 0), e24.lineTo(this.width, this.height), e24.lineTo(0, this.height), e24.closePath(), e24.fillStyle = o2 ? n2.toLive(e24) : n2, a2 && e24.transform(...i2), o2) {
          e24.transform(1, 0, 0, 1, n2.offsetX || 0, n2.offsetY || 0);
          let t3 = n2.gradientTransform || n2.patternTransform;
          t3 && e24.transform(...t3);
        }
        e24.fill(), e24.restore();
      }
      if (r2) {
        e24.save();
        let { skipOffscreen: t3 } = this;
        this.skipOffscreen = a2, a2 && e24.transform(...i2), r2.render(e24), this.skipOffscreen = t3, e24.restore();
      }
    }
    _renderBackground(e24) {
      this._renderBackgroundOrOverlay(e24, `background`);
    }
    _renderOverlay(e24) {
      this._renderBackgroundOrOverlay(e24, `overlay`);
    }
    getCenterPoint() {
      return new N(this.width / 2, this.height / 2);
    }
    centerObjectH(e24) {
      return this._centerObject(e24, new N(this.getCenterPoint().x, e24.getCenterPoint().y));
    }
    centerObjectV(e24) {
      return this._centerObject(e24, new N(e24.getCenterPoint().x, this.getCenterPoint().y));
    }
    centerObject(e24) {
      return this._centerObject(e24, this.getCenterPoint());
    }
    viewportCenterObject(e24) {
      return this._centerObject(e24, this.getVpCenter());
    }
    viewportCenterObjectH(e24) {
      return this._centerObject(e24, new N(this.getVpCenter().x, e24.getCenterPoint().y));
    }
    viewportCenterObjectV(e24) {
      return this._centerObject(e24, new N(e24.getCenterPoint().x, this.getVpCenter().y));
    }
    getVpCenter() {
      return L(this.getCenterPoint(), R(this.viewportTransform));
    }
    _centerObject(e24, t2) {
      e24.setXY(t2, E, E), e24.setCoords(), this.renderOnAddRemove && this.requestRenderAll();
    }
    toDatalessJSON(e24) {
      return this.toDatalessObject(e24);
    }
    toObject(e24) {
      return this._toObjectMethod(`toObject`, e24);
    }
    toJSON() {
      return this.toObject();
    }
    toDatalessObject(e24) {
      return this._toObjectMethod(`toDatalessObject`, e24);
    }
    _toObjectMethod(e24, t2) {
      let n2 = this.clipPath, r2 = n2 && !n2.excludeFromExport ? this._toObject(n2, e24, t2) : null;
      return { version: b, ...et(this, t2), objects: this._objects.filter((e25) => !e25.excludeFromExport).map((n3) => this._toObject(n3, e24, t2)), ...this.__serializeBgOverlay(e24, t2), ...r2 ? { clipPath: r2 } : null };
    }
    _toObject(e24, t2, n2) {
      let r2;
      this.includeDefaultValues || (r2 = e24.includeDefaultValues, e24.includeDefaultValues = false);
      let i2 = e24[t2](n2);
      return this.includeDefaultValues || (e24.includeDefaultValues = !!r2), i2;
    }
    __serializeBgOverlay(e24, t2) {
      let n2 = {}, r2 = this.backgroundImage, i2 = this.overlayImage, a2 = this.backgroundColor, o2 = this.overlayColor;
      return V(a2) ? a2.excludeFromExport || (n2.background = a2.toObject(t2)) : a2 && (n2.background = a2), V(o2) ? o2.excludeFromExport || (n2.overlay = o2.toObject(t2)) : o2 && (n2.overlay = o2), r2 && !r2.excludeFromExport && (n2.backgroundImage = this._toObject(r2, e24, t2)), i2 && !i2.excludeFromExport && (n2.overlayImage = this._toObject(i2, e24, t2)), n2;
    }
    toSVG(e24 = {}, t2) {
      e24.reviver = t2;
      let n2 = [];
      var r2;
      return (this._setSVGPreamble(n2, e24), this._setSVGHeader(n2, e24), this.clipPath) && n2.push(`<g clip-path="url(#${U((r2 = this.clipPath.clipPathId) == null ? `` : r2)})" >
`), this._setSVGBgOverlayColor(n2, `background`), this._setSVGBgOverlayImage(n2, `backgroundImage`, t2), this._setSVGObjects(n2, t2), this.clipPath && n2.push(`</g>
`), this._setSVGBgOverlayColor(n2, `overlay`), this._setSVGBgOverlayImage(n2, `overlayImage`, t2), n2.push(`</svg>`), n2.join(``);
    }
    _setSVGPreamble(e24, t2) {
      t2.suppressPreamble || e24.push(`<?xml version="1.0" encoding="`, t2.encoding || `UTF-8`, `" standalone="no" ?>
`, `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" `, `"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
`);
    }
    _setSVGHeader(e24, t2) {
      let n2 = t2.width || `${this.width}`, r2 = t2.height || `${this.height}`, i2 = o.NUM_FRACTION_DIGITS, a2 = t2.viewBox, s2;
      if (a2) s2 = `viewBox="${a2.x} ${a2.y} ${a2.width} ${a2.height}" `;
      else if (this.svgViewportTransformation) {
        let e25 = this.viewportTransform;
        s2 = `viewBox="${B(-e25[4] / e25[0], i2)} ${B(-e25[5] / e25[3], i2)} ${B(this.width / e25[0], i2)} ${B(this.height / e25[3], i2)}" `;
      } else s2 = `viewBox="0 0 ${this.width} ${this.height}" `;
      e24.push(`<svg `, `xmlns="http://www.w3.org/2000/svg" `, `xmlns:xlink="http://www.w3.org/1999/xlink" `, `version="1.1" `, `width="`, n2, `" `, `height="`, r2, `" `, s2, `xml:space="preserve">
`, `<desc>Created with Fabric.js `, b, `</desc>
`, `<defs>
`, this.createSVGFontFacesMarkup(), this.createSVGRefElementsMarkup(), this.createSVGClipPathMarkup(t2), `</defs>
`);
    }
    createSVGClipPathMarkup(e24) {
      let t2 = this.clipPath;
      return t2 ? (t2.clipPathId = `CLIPPATH_${je()}`, `<clipPath id="${t2.clipPathId}" >
${t2.toClipPathSVG(e24.reviver)}</clipPath>
`) : ``;
    }
    createSVGRefElementsMarkup() {
      return [`background`, `overlay`].map((e24) => {
        let t2 = this[`${e24}Color`];
        if (V(t2)) {
          let n2 = this[`${e24}Vpt`], r2 = this.viewportTransform, i2 = { isType: () => false, width: this.width / (n2 ? r2[0] : 1), height: this.height / (n2 ? r2[3] : 1) };
          return t2.toSVG(i2, { additionalTransform: n2 ? nt(r2) : `` });
        }
      }).join(``);
    }
    createSVGFontFacesMarkup() {
      let e24 = [], t2 = {}, n2 = o.fontPaths;
      this._objects.forEach(function t3(n3) {
        e24.push(n3), Te(n3) && n3._objects.forEach(t3);
      }), e24.forEach((e25) => {
        if (!(r3 = e25) || typeof r3._renderText != `function`) return;
        var r3;
        let { styles: i2, fontFamily: a2 } = e25;
        !t2[a2] && n2[a2] && (t2[a2] = true, i2 && Object.values(i2).forEach((e26) => {
          Object.values(e26).forEach(({ fontFamily: e27 = `` }) => {
            !t2[e27] && n2[e27] && (t2[e27] = true);
          });
        }));
      });
      let r2 = Object.keys(t2).map((e25) => `		@font-face {
			font-family: '${e25}';
			src: url('${n2[e25]}');
		}
`).join(``);
      return r2 ? `	<style type="text/css"><![CDATA[
${r2}]]></style>
` : ``;
    }
    _setSVGObjects(e24, t2) {
      this.forEachObject((n2) => {
        n2.excludeFromExport || this._setSVGObject(e24, n2, t2);
      });
    }
    _setSVGObject(e24, t2, n2) {
      e24.push(t2.toSVG(n2));
    }
    _setSVGBgOverlayImage(e24, t2, n2) {
      let r2 = this[t2];
      r2 && !r2.excludeFromExport && r2.toSVG && e24.push(r2.toSVG(n2));
    }
    _setSVGBgOverlayColor(e24, t2) {
      let n2 = this[`${t2}Color`];
      if (n2) if (V(n2)) {
        let r2 = n2.repeat || ``, i2 = this.width, a2 = this.height, o2 = this[`${t2}Vpt`] ? nt(R(this.viewportTransform)) : ``;
        e24.push(`<rect transform="${o2} translate(${i2 / 2},${a2 / 2})" x="${n2.offsetX - i2 / 2}" y="${n2.offsetY - a2 / 2}" width="${r2 !== `repeat-y` && r2 !== `no-repeat` || !it(n2) ? i2 : n2.source.width}" height="${r2 !== `repeat-x` && r2 !== `no-repeat` || !it(n2) ? a2 : n2.source.height}" fill="url(#SVGID_${n2.id})"></rect>
`);
      } else e24.push(`<rect x="0" y="0" width="100%" height="100%" `, `fill="`, n2, `"`, `></rect>
`);
    }
    loadFromJSON(e24, t2, { signal: n2 } = {}) {
      if (!e24) return Promise.reject(new c("`json` is undefined"));
      let { objects: r2 = [], ...i2 } = typeof e24 == `string` ? JSON.parse(e24) : e24, { backgroundImage: a2, background: o2, overlayImage: s2, overlay: l2, clipPath: u2 } = i2, d2 = this.renderOnAddRemove;
      return this.renderOnAddRemove = false, Promise.all([Qe(r2, { reviver: t2, signal: n2 }), $e({ backgroundImage: a2, backgroundColor: o2, overlayImage: s2, overlayColor: l2, clipPath: u2 }, { signal: n2 })]).then(([e25, t3]) => (this.clear(), this.add(...e25), this.set(i2), this.set(t3), this.renderOnAddRemove = d2, this));
    }
    clone(e24) {
      let t2 = this.toObject(e24);
      return this.cloneWithoutData().loadFromJSON(t2);
    }
    cloneWithoutData() {
      let e24 = F(this);
      return new this.constructor(e24);
    }
    toDataURL(e24 = {}) {
      let { format: t2 = `png`, quality: n2 = 1, multiplier: r2 = 1, enableRetinaScaling: i2 = false } = e24, a2 = r2 * (i2 ? this.getRetinaScaling() : 1);
      return Pe(this.toCanvasElement(a2, e24), t2, n2);
    }
    toBlob(e24 = {}) {
      let { format: t2 = `png`, quality: n2 = 1, multiplier: r2 = 1, enableRetinaScaling: i2 = false } = e24, a2 = r2 * (i2 ? this.getRetinaScaling() : 1);
      return Fe(this.toCanvasElement(a2, e24), t2, n2);
    }
    toCanvasElement(e24 = 1, { width: t2, height: n2, left: r2, top: i2, filter: a2 } = {}) {
      let o2 = (t2 || this.width) * e24, s2 = (n2 || this.height) * e24, c2 = this.getZoom(), l2 = this.width, u2 = this.height, d2 = this.skipControlsDrawing, f2 = c2 * e24, p2 = this.viewportTransform, m = [f2, 0, 0, f2, (p2[4] - (r2 || 0)) * e24, (p2[5] - (i2 || 0)) * e24], h2 = this.enableRetinaScaling, g2 = F({ width: o2, height: s2 }), _2 = a2 ? this._objects.filter((e25) => a2(e25)) : this._objects;
      return this.enableRetinaScaling = false, this.viewportTransform = m, this.width = o2, this.height = s2, this.skipControlsDrawing = true, this.calcViewportBoundaries(), this.renderCanvas(g2.getContext(`2d`), _2), this.viewportTransform = p2, this.width = l2, this.height = u2, this.calcViewportBoundaries(), this.enableRetinaScaling = h2, this.skipControlsDrawing = d2, g2;
    }
    dispose() {
      return !this.disposed && this.elements.cleanupDOM({ width: this.width, height: this.height }), ye.cancelByCanvas(this), this.disposed = true, new Promise((e24, t2) => {
        let n2 = () => {
          this.destroy(), e24(true);
        };
        n2.kill = t2, this.__cleanupTask && this.__cleanupTask.kill(`aborted`), this.destroyed ? e24(false) : this.nextRenderHandle ? this.__cleanupTask = n2 : n2();
      });
    }
    destroy() {
      this.destroyed = true, this.cancelRequestedRender(), this.forEachObject((e24) => e24.dispose()), this._objects = [], this.backgroundImage && this.backgroundImage.dispose(), this.backgroundImage = void 0, this.overlayImage && this.overlayImage.dispose(), this.overlayImage = void 0, this.elements.dispose();
    }
    toString() {
      return `#<Canvas (${this.complexity()}): { objects: ${this._objects.length} }>`;
    }
  };
  i(yt, `ownDefaults`, ft);
  var bt = [`touchstart`, `touchmove`, `touchend`];
  var xt = (e24) => {
    let t2 = ot(e24.target), n2 = function(e25) {
      let t3 = e25.changedTouches;
      return t3 && t3[0] ? t3[0] : e25;
    }(e24);
    return new N(n2.clientX + t2.left, n2.clientY + t2.top);
  };
  var St = (e24) => bt.includes(e24.type) || e24.pointerType === `touch`;
  var Ct = (e24) => {
    e24.preventDefault(), e24.stopPropagation();
  };
  var wt = (e24) => {
    let t2 = 0, n2 = 0, r2 = 0, i2 = 0;
    for (let a2 = 0, o2 = e24.length; a2 < o2; a2++) {
      let { x: o3, y: s2 } = e24[a2];
      (o3 > r2 || !a2) && (r2 = o3), (o3 < t2 || !a2) && (t2 = o3), (s2 > i2 || !a2) && (i2 = s2), (s2 < n2 || !a2) && (n2 = s2);
    }
    return { left: t2, top: n2, width: r2 - t2, height: i2 - n2 };
  };
  var Tt = (e24, t2) => {
    Dt(e24, z(R(t2), e24.calcOwnMatrix()));
  };
  var Et = (e24, t2) => Dt(e24, z(t2, e24.calcOwnMatrix()));
  var Dt = (e24, t2) => {
    let { translateX: n2, translateY: r2, scaleX: i2, scaleY: a2, ...o2 } = He(t2), s2 = new N(n2, r2);
    e24.flipX = false, e24.flipY = false, Object.assign(e24, o2), e24.set({ scaleX: i2, scaleY: a2 }), e24.setPositionByOrigin(s2, E, E);
  };
  var Ot = (e24) => {
    e24.scaleX = 1, e24.scaleY = 1, e24.skewX = 0, e24.skewY = 0, e24.flipX = false, e24.flipY = false, e24.rotate(0);
  };
  var kt = (e24) => ({ scaleX: e24.scaleX, scaleY: e24.scaleY, skewX: e24.skewX, skewY: e24.skewY, angle: e24.angle, left: e24.left, flipX: e24.flipX, flipY: e24.flipY, top: e24.top });
  var At = (e24, t2, n2) => {
    let r2 = e24 / 2, i2 = t2 / 2, a2 = wt([new N(-r2, -i2), new N(r2, -i2), new N(-r2, i2), new N(r2, i2)].map((e25) => e25.transform(n2)));
    return new N(a2.width, a2.height);
  };
  var jt = (e24 = T, t2 = T) => z(R(t2), e24);
  var Mt = (e24, t2 = T, n2 = T) => e24.transform(jt(t2, n2));
  var Nt = (e24, t2 = T, n2 = T) => e24.transform(jt(t2, n2), true);
  var Pt = (e24, t2, n2) => {
    let r2 = jt(t2, n2);
    return Dt(e24, z(r2, e24.calcOwnMatrix())), r2;
  };
  var Ft = { left: -0.5, top: -0.5, center: 0, bottom: 0.5, right: 0.5 };
  var W = (e24) => typeof e24 == `string` ? Ft[e24] : e24 - 0.5;
  var It = new N(1, 0);
  var Lt = new N();
  var Rt = (e24, t2) => e24.rotate(t2);
  var zt = (e24, t2) => new N(t2).subtract(e24);
  var Bt = (e24) => e24.distanceFrom(Lt);
  var Vt = (e24, t2) => Math.atan2(Gt(e24, t2), Kt(e24, t2));
  var Ht = (e24) => Vt(It, e24);
  var Ut = (e24) => e24.eq(Lt) ? e24 : e24.scalarDivide(Bt(e24));
  var Wt = (e24, t2 = true) => Ut(new N(-e24.y, e24.x).scalarMultiply(t2 ? 1 : -1));
  var Gt = (e24, t2) => e24.x * t2.y - e24.y * t2.x;
  var Kt = (e24, t2) => e24.x * t2.x + e24.y * t2.y;
  var qt = (e24, t2, n2) => {
    if (e24.eq(t2) || e24.eq(n2)) return true;
    let r2 = Gt(t2, n2), i2 = Gt(t2, e24), a2 = Gt(n2, e24);
    return r2 >= 0 ? i2 >= 0 && a2 <= 0 : !(i2 <= 0 && a2 >= 0);
  };
  var Jt = `not-allowed`;
  function Yt(e24) {
    return W(e24.originX) === W(`center`) && W(e24.originY) === W(`center`);
  }
  function Xt(e24) {
    return 0.5 - W(e24);
  }
  var Zt = (e24, t2) => e24[t2];
  var Qt = (e24, t2, n2, r2) => ({ e: e24, transform: t2, pointer: new N(n2, r2) });
  function $t(e24, t2, n2) {
    let r2 = n2, i2 = Ht(zt(Mt(e24.getCenterPoint(), e24.canvas.viewportTransform, void 0), r2)) + w;
    return Math.round(i2 % w / C);
  }
  function en({ target: e24, corner: t2 }, n2, r2, i2, a2) {
    var o2;
    let s2 = e24.controls[t2], c2 = ((o2 = e24.canvas) == null ? void 0 : o2.getZoom()) || 1, l2 = e24.padding / c2, u2 = function(e25, t3, n3, r3) {
      let i3 = e25.getRelativeCenterPoint(), a3 = n3 !== void 0 && r3 !== void 0 ? e25.translateToGivenOrigin(i3, E, E, n3, r3) : new N(e25.left, e25.top);
      return (e25.angle ? t3.rotate(-I(e25.angle), i3) : t3).subtract(a3);
    }(e24, new N(i2, a2), n2, r2);
    return u2.x >= l2 && (u2.x -= l2), u2.x <= -l2 && (u2.x += l2), u2.y >= l2 && (u2.y -= l2), u2.y <= l2 && (u2.y += l2), u2.x -= s2.offsetX, u2.y -= s2.offsetY, u2;
  }
  var tn = new RegExp(String.raw`[\0-\x1F\x7F;<>\\]|\/\*|\*\/|url\s*\(|expression\s*\(|(?:java|vb)script\s*:|data\s*:|@import\b`, `iu`);
  var nn = (e24) => typeof e24 == `string` && e24.trim().length > 0 && !tn.test(e24);
  var rn = (e24, t2 = ``) => {
    let n2 = Number(e24);
    return Number.isFinite(n2) ? `${n2}` : t2;
  };
  var an = (e24, t2 = ``) => typeof e24 == `string` && nn(e24) ? e24 : t2;
  var on = (e24) => e24.replace(/\s+/g, ` `);
  var sn = { aliceblue: `#F0F8FF`, antiquewhite: `#FAEBD7`, aqua: `#0FF`, aquamarine: `#7FFFD4`, azure: `#F0FFFF`, beige: `#F5F5DC`, bisque: `#FFE4C4`, black: `#000`, blanchedalmond: `#FFEBCD`, blue: `#00F`, blueviolet: `#8A2BE2`, brown: `#A52A2A`, burlywood: `#DEB887`, cadetblue: `#5F9EA0`, chartreuse: `#7FFF00`, chocolate: `#D2691E`, coral: `#FF7F50`, cornflowerblue: `#6495ED`, cornsilk: `#FFF8DC`, crimson: `#DC143C`, cyan: `#0FF`, darkblue: `#00008B`, darkcyan: `#008B8B`, darkgoldenrod: `#B8860B`, darkgray: `#A9A9A9`, darkgrey: `#A9A9A9`, darkgreen: `#006400`, darkkhaki: `#BDB76B`, darkmagenta: `#8B008B`, darkolivegreen: `#556B2F`, darkorange: `#FF8C00`, darkorchid: `#9932CC`, darkred: `#8B0000`, darksalmon: `#E9967A`, darkseagreen: `#8FBC8F`, darkslateblue: `#483D8B`, darkslategray: `#2F4F4F`, darkslategrey: `#2F4F4F`, darkturquoise: `#00CED1`, darkviolet: `#9400D3`, deeppink: `#FF1493`, deepskyblue: `#00BFFF`, dimgray: `#696969`, dimgrey: `#696969`, dodgerblue: `#1E90FF`, firebrick: `#B22222`, floralwhite: `#FFFAF0`, forestgreen: `#228B22`, fuchsia: `#F0F`, gainsboro: `#DCDCDC`, ghostwhite: `#F8F8FF`, gold: `#FFD700`, goldenrod: `#DAA520`, gray: `#808080`, grey: `#808080`, green: `#008000`, greenyellow: `#ADFF2F`, honeydew: `#F0FFF0`, hotpink: `#FF69B4`, indianred: `#CD5C5C`, indigo: `#4B0082`, ivory: `#FFFFF0`, khaki: `#F0E68C`, lavender: `#E6E6FA`, lavenderblush: `#FFF0F5`, lawngreen: `#7CFC00`, lemonchiffon: `#FFFACD`, lightblue: `#ADD8E6`, lightcoral: `#F08080`, lightcyan: `#E0FFFF`, lightgoldenrodyellow: `#FAFAD2`, lightgray: `#D3D3D3`, lightgrey: `#D3D3D3`, lightgreen: `#90EE90`, lightpink: `#FFB6C1`, lightsalmon: `#FFA07A`, lightseagreen: `#20B2AA`, lightskyblue: `#87CEFA`, lightslategray: `#789`, lightslategrey: `#789`, lightsteelblue: `#B0C4DE`, lightyellow: `#FFFFE0`, lime: `#0F0`, limegreen: `#32CD32`, linen: `#FAF0E6`, magenta: `#F0F`, maroon: `#800000`, mediumaquamarine: `#66CDAA`, mediumblue: `#0000CD`, mediumorchid: `#BA55D3`, mediumpurple: `#9370DB`, mediumseagreen: `#3CB371`, mediumslateblue: `#7B68EE`, mediumspringgreen: `#00FA9A`, mediumturquoise: `#48D1CC`, mediumvioletred: `#C71585`, midnightblue: `#191970`, mintcream: `#F5FFFA`, mistyrose: `#FFE4E1`, moccasin: `#FFE4B5`, navajowhite: `#FFDEAD`, navy: `#000080`, oldlace: `#FDF5E6`, olive: `#808000`, olivedrab: `#6B8E23`, orange: `#FFA500`, orangered: `#FF4500`, orchid: `#DA70D6`, palegoldenrod: `#EEE8AA`, palegreen: `#98FB98`, paleturquoise: `#AFEEEE`, palevioletred: `#DB7093`, papayawhip: `#FFEFD5`, peachpuff: `#FFDAB9`, peru: `#CD853F`, pink: `#FFC0CB`, plum: `#DDA0DD`, powderblue: `#B0E0E6`, purple: `#800080`, rebeccapurple: `#639`, red: `#F00`, rosybrown: `#BC8F8F`, royalblue: `#4169E1`, saddlebrown: `#8B4513`, salmon: `#FA8072`, sandybrown: `#F4A460`, seagreen: `#2E8B57`, seashell: `#FFF5EE`, sienna: `#A0522D`, silver: `#C0C0C0`, skyblue: `#87CEEB`, slateblue: `#6A5ACD`, slategray: `#708090`, slategrey: `#708090`, snow: `#FFFAFA`, springgreen: `#00FF7F`, steelblue: `#4682B4`, tan: `#D2B48C`, teal: `#008080`, thistle: `#D8BFD8`, tomato: `#FF6347`, turquoise: `#40E0D0`, violet: `#EE82EE`, wheat: `#F5DEB3`, white: `#FFF`, whitesmoke: `#F5F5F5`, yellow: `#FF0`, yellowgreen: `#9ACD32` };
  var cn = (e24, t2, n2) => (n2 < 0 && (n2 += 1), n2 > 1 && --n2, n2 < 1 / 6 ? e24 + 6 * (t2 - e24) * n2 : n2 < 0.5 ? t2 : n2 < 2 / 3 ? e24 + (t2 - e24) * (2 / 3 - n2) * 6 : e24);
  var ln = (e24, t2, n2, r2) => {
    e24 /= 255, t2 /= 255, n2 /= 255;
    let i2 = Math.max(e24, t2, n2), a2 = Math.min(e24, t2, n2), o2, s2, c2 = (i2 + a2) / 2;
    if (i2 === a2) o2 = s2 = 0;
    else {
      let r3 = i2 - a2;
      switch (s2 = c2 > 0.5 ? r3 / (2 - i2 - a2) : r3 / (i2 + a2), i2) {
        case e24:
          o2 = (t2 - n2) / r3 + (t2 < n2 ? 6 : 0);
          break;
        case t2:
          o2 = (n2 - e24) / r3 + 2;
          break;
        case n2:
          o2 = (e24 - t2) / r3 + 4;
      }
      o2 /= 6;
    }
    return [Math.round(360 * o2), Math.round(100 * s2), Math.round(100 * c2), r2];
  };
  var un = (e24 = `1`) => parseFloat(e24) / (e24.endsWith(`%`) ? 100 : 1);
  var dn = (e24) => Math.min(Math.round(e24), 255).toString(16).toUpperCase().padStart(2, `0`);
  var fn = ([e24, t2, n2, r2 = 1]) => {
    let i2 = Math.round(0.3 * e24 + 0.59 * t2 + 0.11 * n2);
    return [i2, i2, i2, r2];
  };
  var G = class e4 {
    constructor(t2) {
      if (i(this, `isUnrecognised`, false), t2) if (t2 instanceof e4) this.setSource([...t2._source]);
      else if (Array.isArray(t2)) {
        let [e24, n2, r2, i2 = 1] = t2;
        this.setSource([e24, n2, r2, i2]);
      } else this.setSource(this._tryParsingColor(t2));
      else this.setSource([0, 0, 0, 1]);
    }
    _tryParsingColor(t2) {
      return (t2 = t2.toLowerCase()) in sn && (t2 = sn[t2]), t2 === `transparent` ? [255, 255, 255, 0] : e4.sourceFromHex(t2) || e4.sourceFromRgb(t2) || e4.sourceFromHsl(t2) || (this.isUnrecognised = true) && [0, 0, 0, 1];
    }
    getSource() {
      return this._source;
    }
    setSource(e24) {
      this._source = e24;
    }
    toRgb() {
      let [e24, t2, n2] = this.getSource();
      return `rgb(${e24},${t2},${n2})`;
    }
    toRgba() {
      return `rgba(${this.getSource().join(`,`)})`;
    }
    toHsl() {
      let [e24, t2, n2] = ln(...this.getSource());
      return `hsl(${e24},${t2}%,${n2}%)`;
    }
    toHsla() {
      let [e24, t2, n2, r2] = ln(...this.getSource());
      return `hsla(${e24},${t2}%,${n2}%,${r2})`;
    }
    toHex() {
      return this.toHexa().slice(0, 6);
    }
    toHexa() {
      let [e24, t2, n2, r2] = this.getSource();
      return `${dn(e24)}${dn(t2)}${dn(n2)}${dn(Math.round(255 * r2))}`;
    }
    getAlpha() {
      return this.getSource()[3];
    }
    setAlpha(e24) {
      return this._source[3] = e24, this;
    }
    toGrayscale() {
      return this.setSource(fn(this.getSource())), this;
    }
    toBlackWhite(e24) {
      let [t2, , , n2] = fn(this.getSource()), r2 = t2 < (e24 || 127) ? 0 : 255;
      return this.setSource([r2, r2, r2, n2]), this;
    }
    overlayWith(t2) {
      t2 instanceof e4 || (t2 = new e4(t2));
      let n2 = this.getSource(), r2 = t2.getSource(), [i2, a2, o2] = n2.map((e24, t3) => Math.round(0.5 * e24 + 0.5 * r2[t3]));
      return this.setSource([i2, a2, o2, n2[3]]), this;
    }
    static fromRgb(t2) {
      return e4.fromRgba(t2);
    }
    static fromRgba(t2) {
      return new e4(e4.sourceFromRgb(t2));
    }
    static sourceFromRgb(e24) {
      let t2 = on(e24).match(/^rgba?\(\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?(?:\s?[,/]\s?(\d{0,3}(?:\.\d+)?%?)\s?)?\)$/i);
      if (t2) {
        let [e25, n2, r2] = t2.slice(1, 4).map((e26) => {
          let t3 = parseFloat(e26);
          return e26.endsWith(`%`) ? Math.round(2.55 * t3) : t3;
        });
        return [e25, n2, r2, un(t2[4])];
      }
    }
    static fromHsl(t2) {
      return e4.fromHsla(t2);
    }
    static fromHsla(t2) {
      return new e4(e4.sourceFromHsl(t2));
    }
    static sourceFromHsl(t2) {
      let n2 = on(t2).match(/^hsla?\(\s?([+-]?\d{0,3}(?:\.\d+)?(?:deg|turn|rad)?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?[\s|,]\s?(\d{0,3}(?:\.\d+)?%?)\s?(?:\s?[,/]\s?(\d*(?:\.\d+)?%?)\s?)?\)$/i);
      if (!n2) return;
      let r2 = (e4.parseAngletoDegrees(n2[1]) % 360 + 360) % 360 / 360, i2 = parseFloat(n2[2]) / 100, a2 = parseFloat(n2[3]) / 100, o2, s2, c2;
      if (i2 === 0) o2 = s2 = c2 = a2;
      else {
        let e24 = a2 <= 0.5 ? a2 * (i2 + 1) : a2 + i2 - a2 * i2, t3 = 2 * a2 - e24;
        o2 = cn(t3, e24, r2 + 1 / 3), s2 = cn(t3, e24, r2), c2 = cn(t3, e24, r2 - 1 / 3);
      }
      return [Math.round(255 * o2), Math.round(255 * s2), Math.round(255 * c2), un(n2[4])];
    }
    static fromHex(t2) {
      return new e4(e4.sourceFromHex(t2));
    }
    static sourceFromHex(e24) {
      if (e24.match(/^#?(([0-9a-f]){3,4}|([0-9a-f]{2}){3,4})$/i)) {
        let t2 = e24.slice(e24.indexOf(`#`) + 1), n2;
        n2 = t2.length <= 4 ? t2.split(``).map((e25) => e25 + e25) : t2.match(/.{2}/g);
        let [r2, i2, a2, o2 = 255] = n2.map((e25) => parseInt(e25, 16));
        return [r2, i2, a2, o2 / 255];
      }
    }
    static parseAngletoDegrees(e24) {
      let t2 = e24.toLowerCase(), n2 = parseFloat(t2);
      return t2.includes(`rad`) ? Ie(n2) : t2.includes(`turn`) ? 360 * n2 : n2;
    }
  };
  var pn = (e24) => {
    let t2 = [`instantiated_by_use`, `style`, `id`, `class`];
    switch (e24) {
      case `linearGradient`:
        return t2.concat([`x1`, `y1`, `x2`, `y2`, `gradientUnits`, `gradientTransform`]);
      case `radialGradient`:
        return t2.concat([`gradientUnits`, `gradientTransform`, `cx`, `cy`, `r`, `fx`, `fy`, `fr`]);
      case `stop`:
        return t2.concat([`offset`, `stop-color`, `stop-opacity`]);
    }
    return t2;
  };
  var K = (e24, t2 = 16) => {
    let n2 = /\D{0,2}$/.exec(e24), r2 = parseFloat(e24), i2 = o.DPI;
    switch (n2 == null ? void 0 : n2[0]) {
      case `mm`:
        return r2 * i2 / 25.4;
      case `cm`:
        return r2 * i2 / 2.54;
      case `in`:
        return r2 * i2;
      case `pt`:
        return r2 * i2 / 72;
      case `pc`:
        return r2 * i2 / 72 * 12;
      case `em`:
        return r2 * t2;
      default:
        return r2;
    }
  };
  var mn = (e24) => {
    let [t2, n2] = e24.trim().split(` `), [r2, i2] = (a2 = t2) && a2 !== `none` ? [a2.slice(1, 4), a2.slice(5, 8)] : a2 === `none` ? [a2, a2] : [`Mid`, `Mid`];
    var a2;
    return { meetOrSlice: n2 || `meet`, alignX: r2, alignY: i2 };
  };
  var hn = (e24, t2, n2 = true) => {
    let r2, i2;
    if (t2) if (t2.toLive) r2 = `url(#SVGID_${U(t2.id)})`;
    else {
      let e25 = String(t2);
      if (nn(e25)) {
        let t3 = new G(e25), n3 = t3.getAlpha();
        r2 = t3.toRgb(), n3 !== 1 && (i2 = n3.toString());
      } else r2 = new G(`black`).toRgb();
    }
    else r2 = `none`;
    return n2 ? `${e24}: ${r2}; ${i2 ? `${e24}-opacity: ${i2}; ` : ``}` : `${e24}="${r2}" ${i2 ? `${e24}-opacity="${i2}" ` : ``}`;
  };
  var gn = class {
    getSvgStyles(e24) {
      let t2 = this.fillRule == null ? `nonzero` : an(this.fillRule), n2 = this.strokeWidth == null ? `0` : rn(this.strokeWidth), r2 = this.strokeDashArray == null ? te : this.strokeDashArray.every((e25) => Number.isFinite(Number(e25))) ? this.strokeDashArray.join(` `) : ``, i2 = this.strokeDashOffset == null ? `0` : rn(this.strokeDashOffset), a2 = this.strokeLineCap == null ? `butt` : an(this.strokeLineCap), o2 = this.strokeLineJoin == null ? `miter` : an(this.strokeLineJoin), s2 = this.strokeMiterLimit == null ? `4` : rn(this.strokeMiterLimit), c2 = this.opacity == null ? `1` : rn(this.opacity), l2 = this.visible ? `` : ` visibility: hidden;`, u2 = e24 ? `` : this.getSvgFilter(), d2 = hn(j, this.fill);
      return [hn(he, this.stroke), n2 ? `stroke-width: ${n2}; ` : ``, r2 ? `stroke-dasharray: ${r2}; ` : ``, a2 ? `stroke-linecap: ${a2}; ` : ``, i2 ? `stroke-dashoffset: ${i2}; ` : ``, o2 ? `stroke-linejoin: ${o2}; ` : ``, s2 ? `stroke-miterlimit: ${s2}; ` : ``, d2, t2 ? `fill-rule: ${t2}; ` : ``, c2 ? `opacity: ${c2};` : ``, u2, l2].map((e25) => U(e25)).join(``);
    }
    getSvgFilter() {
      return this.shadow ? `filter: url(#SVGID_${U(this.shadow.id)});` : ``;
    }
    getSvgCommons() {
      return [this.id ? `id="${U(String(this.id))}" ` : ``, this.clipPath ? `clip-path="url(#${U(this.clipPath.clipPathId)})" ` : ``].join(``);
    }
    getSvgTransform(e24, t2 = ``) {
      return `transform="${nt(e24 ? this.calcTransformMatrix() : this.calcOwnMatrix())}${t2}" `;
    }
    _toSVG(e24) {
      return [``];
    }
    toSVG(e24) {
      return this._createBaseSVGMarkup(this._toSVG(e24), { reviver: e24 });
    }
    toClipPathSVG(e24) {
      return `	` + this._createBaseClipPathSVGMarkup(this._toSVG(e24), { reviver: e24 });
    }
    _createBaseClipPathSVGMarkup(e24, { reviver: t2, additionalTransform: n2 = `` } = {}) {
      let r2 = [this.getSvgTransform(true, n2), this.getSvgCommons()].join(``), i2 = e24.indexOf(`COMMON_PARTS`);
      return e24[i2] = r2, t2 ? t2(e24.join(``)) : e24.join(``);
    }
    _createBaseSVGMarkup(e24, { noStyle: t2, reviver: n2, withShadow: r2, additionalTransform: i2 } = {}) {
      let a2 = t2 ? `` : `style="${this.getSvgStyles()}" `, o2 = r2 ? `style="${this.getSvgFilter()}" ` : ``, s2 = this.clipPath, c2 = this.strokeUniform ? `vector-effect="non-scaling-stroke" ` : ``, l2 = s2 && s2.absolutePositioned, u2 = this.stroke, d2 = this.fill, f2 = this.shadow, p2 = [], m = e24.indexOf(`COMMON_PARTS`), h2;
      return s2 && (s2.clipPathId = `CLIPPATH_${je()}`, h2 = `<clipPath id="${s2.clipPathId}" >
${s2.toClipPathSVG(n2)}</clipPath>
`), l2 && p2.push(`<g `, o2, this.getSvgCommons(), ` >
`), p2.push(`<g `, this.getSvgTransform(false), l2 ? `` : o2 + this.getSvgCommons(), ` >
`), e24[m] = [a2, c2, t2 ? `` : this.addPaintOrder(), ` `, i2 ? `transform="${i2}" ` : ``].join(``), V(d2) && p2.push(d2.toSVG(this)), V(u2) && p2.push(u2.toSVG(this)), f2 && p2.push(f2.toSVG(this)), s2 && p2.push(h2), p2.push(e24.join(``)), p2.push(`</g>
`), l2 && p2.push(`</g>
`), n2 ? n2(p2.join(``)) : p2.join(``);
    }
    addPaintOrder() {
      return this.paintFirst === `fill` ? `` : ` paint-order="${U(this.paintFirst)}" `;
    }
  };
  function _n(e24) {
    return RegExp(`^(` + e24.join(`|`) + `)\\b`, `i`);
  }
  var vn = `textDecorationThickness`;
  var yn = `textDecorationColor`;
  var bn = [`fontSize`, `fontWeight`, `fontFamily`, `fontStyle`];
  var xn = [`underline`, `overline`, `linethrough`];
  var Sn = [...bn, `lineHeight`, `text`, `charSpacing`, `textAlign`, `styles`, `path`, `pathStartOffset`, `pathSide`, `pathAlign`];
  var Cn = [...Sn, ...xn, `textBackgroundColor`, `direction`, vn, yn];
  var wn = [...bn, ...xn, he, `strokeWidth`, j, `deltaY`, `textBackgroundColor`, vn, yn];
  var Tn = { _reNewline: ne, _reSpacesAndTabs: /[ \t\r]/g, _reSpaceAndTab: /[ \t\r]/, _reWords: /\S+/g, fontSize: 40, fontWeight: _e, fontFamily: `Times New Roman`, underline: false, overline: false, linethrough: false, textAlign: D, fontStyle: _e, lineHeight: 1.16, textBackgroundColor: ``, stroke: null, shadow: null, path: void 0, pathStartOffset: 0, pathSide: D, pathAlign: `baseline`, charSpacing: 0, deltaY: 0, direction: `ltr`, CACHE_FONT_SIZE: 400, MIN_TEXT_WIDTH: 2, superscript: { size: 0.6, baseline: -0.35 }, subscript: { size: 0.6, baseline: 0.11 }, _fontSizeFraction: 0.222, offsets: { underline: 0.1, linethrough: -0.28167, overline: -0.81333 }, _fontSizeMult: 1.13, [vn]: 66.667 };
  var En = `justify`;
  var Dn = String.raw`[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?`;
  var On = String.raw`(?:\s*,?\s+|\s*,\s*)`;
  var An = RegExp(`(normal|italic)?\\s*(normal|small-caps)?\\s*(normal|bold|bolder|lighter|100|200|300|400|500|600|700|800|900)?\\s*(` + Dn + `(?:px|cm|mm|em|pt|pc|in)*)(?:\\/(normal|` + Dn + `))?\\s+(.*)`);
  var jn = { cx: D, x: D, r: `radius`, cy: `top`, y: `top`, display: `visible`, visibility: `visible`, transform: `transformMatrix`, "fill-opacity": `fillOpacity`, "fill-rule": `fillRule`, "font-family": `fontFamily`, "font-size": `fontSize`, "font-style": `fontStyle`, "font-weight": `fontWeight`, "letter-spacing": `charSpacing`, "paint-order": `paintFirst`, "stroke-dasharray": `strokeDashArray`, "stroke-dashoffset": `strokeDashOffset`, "stroke-linecap": `strokeLineCap`, "stroke-linejoin": `strokeLineJoin`, "stroke-miterlimit": `strokeMiterLimit`, "stroke-opacity": `strokeOpacity`, "stroke-width": `strokeWidth`, "text-decoration": `textDecoration`, "text-anchor": `textAnchor`, opacity: `opacity`, "clip-path": `clipPath`, "clip-rule": `clipRule`, "vector-effect": `strokeUniform`, "image-rendering": `imageSmoothing`, "text-decoration-thickness": vn, "text-decoration-color": yn };
  var Mn = `font-size`;
  var Nn = `clip-path`;
  var Pn = _n([`path`, `circle`, `polygon`, `polyline`, `ellipse`, `rect`, `line`, `image`, `text`]);
  var Fn = _n([`symbol`, `image`, `marker`, `pattern`, `view`, `svg`]);
  var In = _n([`symbol`, `g`, `a`, `svg`, `clipPath`, `defs`]);
  var Ln = new RegExp(String.raw`^\s*(${Dn})${On}(${Dn})${On}(${Dn})${On}(${Dn})\s*$`);
  var Rn = `(-?\\d+(?:\\.\\d*)?(?:px)?(?:\\s?|$))?`;
  var zn = RegExp(`(?:\\s|^)` + Rn + Rn + `(` + Dn + `?(?:px)?)?(?:\\s?|$)(?:$|\\s)`);
  var Bn = class e5 {
    constructor(t2 = {}) {
      let n2 = typeof t2 == `string` ? e5.parseShadow(t2) : t2;
      Object.assign(this, e5.ownDefaults, n2), this.id = je();
    }
    static parseShadow(e24) {
      let t2 = e24.trim(), [, n2 = 0, r2 = 0, i2 = 0] = (zn.exec(t2) || []).map((e25) => parseFloat(e25) || 0);
      return { color: (t2.replace(zn, ``) || `rgb(0,0,0)`).trim(), offsetX: n2, offsetY: r2, blur: i2 };
    }
    toString() {
      return [this.offsetX, this.offsetY, this.blur, this.color].join(`px `);
    }
    toSVG(e24) {
      let t2 = Rt(new N(this.offsetX, this.offsetY), I(-e24.angle)), n2 = o.NUM_FRACTION_DIGITS, r2 = new G(this.color), i2 = 40, a2 = 40;
      return e24.width && e24.height && (i2 = 100 * B((Math.abs(t2.x) + this.blur) / e24.width, n2) + 20, a2 = 100 * B((Math.abs(t2.y) + this.blur) / e24.height, n2) + 20), e24.flipX && (t2.x *= -1), e24.flipY && (t2.y *= -1), `<filter id="SVGID_${U(this.id)}" y="-${a2}%" height="${100 + 2 * a2}%" x="-${i2}%" width="${100 + 2 * i2}%" >
	<feGaussianBlur in="SourceAlpha" stdDeviation="${B(this.blur ? this.blur / 2 : 0, n2)}"></feGaussianBlur>
	<feOffset dx="${B(t2.x, n2)}" dy="${B(t2.y, n2)}" result="oBlur" ></feOffset>
	<feFlood flood-color="${r2.toRgb()}" flood-opacity="${r2.getAlpha()}"/>
	<feComposite in2="oBlur" operator="in" />
	<feMerge>
		<feMergeNode></feMergeNode>
		<feMergeNode in="SourceGraphic"></feMergeNode>
	</feMerge>
</filter>
`;
    }
    toObject() {
      let t2 = { color: this.color, blur: this.blur, offsetX: this.offsetX, offsetY: this.offsetY, affectStroke: this.affectStroke, nonScaling: this.nonScaling, type: this.constructor.type }, n2 = e5.ownDefaults;
      return this.includeDefaultValues ? t2 : tt(t2, (e24, t3) => e24 !== n2[t3]);
    }
    static async fromObject(e24) {
      return new this(e24);
    }
  };
  i(Bn, `ownDefaults`, { color: `rgb(0,0,0)`, blur: 0, offsetX: 0, offsetY: 0, affectStroke: false, includeDefaultValues: true, nonScaling: false }), i(Bn, `type`, `shadow`), M.setClass(Bn, `shadow`);
  var Vn = (e24, t2, n2) => Math.max(e24, Math.min(t2, n2));
  var Hn = [`top`, D, de, fe, `flipX`, `flipY`, `originX`, `originY`, `angle`, `opacity`, `globalCompositeOperation`, `shadow`, `visible`, pe, me];
  var Un = [j, he, `strokeWidth`, `strokeDashArray`, `width`, `height`, `paintFirst`, `strokeUniform`, `strokeLineCap`, `strokeDashOffset`, `strokeLineJoin`, `strokeMiterLimit`, `backgroundColor`, `clipPath`];
  var Wn = { top: 0, left: 0, width: 0, height: 0, angle: 0, flipX: false, flipY: false, scaleX: 1, scaleY: 1, minScaleLimit: 0, skewX: 0, skewY: 0, originX: E, originY: E, strokeWidth: 1, strokeUniform: false, padding: 0, opacity: 1, paintFirst: j, fill: `rgb(0,0,0)`, fillRule: `nonzero`, stroke: null, strokeDashArray: null, strokeDashOffset: 0, strokeLineCap: `butt`, strokeLineJoin: `miter`, strokeMiterLimit: 4, globalCompositeOperation: `source-over`, backgroundColor: ``, shadow: null, visible: true, includeDefaultValues: true, excludeFromExport: false, objectCaching: true, clipPath: void 0, inverted: false, absolutePositioned: false, centeredRotation: true, centeredScaling: false, dirty: true };
  var Gn = t({ defaultEasing: () => Jn, easeInBack: () => gr, easeInBounce: () => br, easeInCirc: () => ur, easeInCubic: () => Yn, easeInElastic: () => pr, easeInExpo: () => sr, easeInOutBack: () => vr, easeInOutBounce: () => xr, easeInOutCirc: () => fr, easeInOutCubic: () => Zn, easeInOutElastic: () => hr, easeInOutExpo: () => lr, easeInOutQuad: () => wr, easeInOutQuart: () => er, easeInOutQuint: () => rr, easeInOutSine: () => or, easeInQuad: () => Sr, easeInQuart: () => Qn, easeInQuint: () => tr, easeInSine: () => ir, easeOutBack: () => _r, easeOutBounce: () => yr, easeOutCirc: () => dr, easeOutCubic: () => Xn, easeOutElastic: () => mr, easeOutExpo: () => cr, easeOutQuad: () => Cr, easeOutQuart: () => $n, easeOutQuint: () => nr, easeOutSine: () => ar });
  var Kn = (e24, t2, n2, r2) => (e24 < Math.abs(t2) ? (e24 = t2, r2 = n2 / 4) : r2 = t2 === 0 && e24 === 0 ? n2 / w * Math.asin(1) : n2 / w * Math.asin(t2 / e24), { a: e24, c: t2, p: n2, s: r2 });
  var qn = (e24, t2, n2, r2, i2) => e24 * 2 ** (10 * --r2) * Math.sin((r2 * i2 - t2) * w / n2);
  var Jn = (e24, t2, n2, r2) => -n2 * Math.cos(e24 / r2 * S) + n2 + t2;
  var Yn = (e24, t2, n2, r2) => n2 * (e24 / r2) ** 3 + t2;
  var Xn = (e24, t2, n2, r2) => n2 * ((e24 / r2 - 1) ** 3 + 1) + t2;
  var Zn = (e24, t2, n2, r2) => (e24 /= r2 / 2) < 1 ? n2 / 2 * e24 ** 3 + t2 : n2 / 2 * ((e24 - 2) ** 3 + 2) + t2;
  var Qn = (e24, t2, n2, r2) => n2 * (e24 /= r2) * e24 ** 3 + t2;
  var $n = (e24, t2, n2, r2) => -n2 * ((e24 = e24 / r2 - 1) * e24 ** 3 - 1) + t2;
  var er = (e24, t2, n2, r2) => (e24 /= r2 / 2) < 1 ? n2 / 2 * e24 ** 4 + t2 : -n2 / 2 * ((e24 -= 2) * e24 ** 3 - 2) + t2;
  var tr = (e24, t2, n2, r2) => n2 * (e24 / r2) ** 5 + t2;
  var nr = (e24, t2, n2, r2) => n2 * ((e24 / r2 - 1) ** 5 + 1) + t2;
  var rr = (e24, t2, n2, r2) => (e24 /= r2 / 2) < 1 ? n2 / 2 * e24 ** 5 + t2 : n2 / 2 * ((e24 - 2) ** 5 + 2) + t2;
  var ir = (e24, t2, n2, r2) => -n2 * Math.cos(e24 / r2 * S) + n2 + t2;
  var ar = (e24, t2, n2, r2) => n2 * Math.sin(e24 / r2 * S) + t2;
  var or = (e24, t2, n2, r2) => -n2 / 2 * (Math.cos(Math.PI * e24 / r2) - 1) + t2;
  var sr = (e24, t2, n2, r2) => e24 === 0 ? t2 : n2 * 2 ** (10 * (e24 / r2 - 1)) + t2;
  var cr = (e24, t2, n2, r2) => e24 === r2 ? t2 + n2 : n2 * -(2 ** (-10 * e24 / r2) + 1) + t2;
  var lr = (e24, t2, n2, r2) => e24 === 0 ? t2 : e24 === r2 ? t2 + n2 : (e24 /= r2 / 2) < 1 ? n2 / 2 * 2 ** (10 * (e24 - 1)) + t2 : n2 / 2 * -(2 ** (-10 * (e24 - 1)) + 2) + t2;
  var ur = (e24, t2, n2, r2) => -n2 * (Math.sqrt(1 - (e24 /= r2) * e24) - 1) + t2;
  var dr = (e24, t2, n2, r2) => n2 * Math.sqrt(1 - (e24 = e24 / r2 - 1) * e24) + t2;
  var fr = (e24, t2, n2, r2) => (e24 /= r2 / 2) < 1 ? -n2 / 2 * (Math.sqrt(1 - e24 ** 2) - 1) + t2 : n2 / 2 * (Math.sqrt(1 - (e24 -= 2) * e24) + 1) + t2;
  var pr = (e24, t2, n2, r2) => {
    let i2 = n2, a2 = 0;
    if (e24 === 0) return t2;
    if ((e24 /= r2) === 1) return t2 + n2;
    a2 || (a2 = 0.3 * r2);
    let { a: o2, s: s2, p: c2 } = Kn(i2, n2, a2, 1.70158);
    return -qn(o2, s2, c2, e24, r2) + t2;
  };
  var mr = (e24, t2, n2, r2) => {
    let i2 = n2, a2 = 0;
    if (e24 === 0) return t2;
    if ((e24 /= r2) === 1) return t2 + n2;
    a2 || (a2 = 0.3 * r2);
    let { a: o2, s: s2, p: c2, c: l2 } = Kn(i2, n2, a2, 1.70158);
    return o2 * 2 ** (-10 * e24) * Math.sin((e24 * r2 - s2) * w / c2) + l2 + t2;
  };
  var hr = (e24, t2, n2, r2) => {
    let i2 = n2, a2 = 0;
    if (e24 === 0) return t2;
    if ((e24 /= r2 / 2) == 2) return t2 + n2;
    a2 || (a2 = 0.3 * 1.5 * r2);
    let { a: o2, s: s2, p: c2, c: l2 } = Kn(i2, n2, a2, 1.70158);
    return e24 < 1 ? -0.5 * qn(o2, s2, c2, e24, r2) + t2 : o2 * 2 ** (-10 * --e24) * Math.sin((e24 * r2 - s2) * w / c2) * 0.5 + l2 + t2;
  };
  var gr = (e24, t2, n2, r2, i2 = 1.70158) => n2 * (e24 /= r2) * e24 * ((i2 + 1) * e24 - i2) + t2;
  var _r = (e24, t2, n2, r2, i2 = 1.70158) => n2 * ((e24 = e24 / r2 - 1) * e24 * ((i2 + 1) * e24 + i2) + 1) + t2;
  var vr = (e24, t2, n2, r2, i2 = 1.70158) => (e24 /= r2 / 2) < 1 ? n2 / 2 * (e24 * e24 * ((1 + (i2 *= 1.525)) * e24 - i2)) + t2 : n2 / 2 * ((e24 -= 2) * e24 * ((1 + (i2 *= 1.525)) * e24 + i2) + 2) + t2;
  var yr = (e24, t2, n2, r2) => (e24 /= r2) < 1 / 2.75 ? n2 * (7.5625 * e24 * e24) + t2 : e24 < 2 / 2.75 ? n2 * (7.5625 * (e24 -= 1.5 / 2.75) * e24 + 0.75) + t2 : e24 < 2.5 / 2.75 ? n2 * (7.5625 * (e24 -= 2.25 / 2.75) * e24 + 0.9375) + t2 : n2 * (7.5625 * (e24 -= 2.625 / 2.75) * e24 + 0.984375) + t2;
  var br = (e24, t2, n2, r2) => n2 - yr(r2 - e24, 0, n2, r2) + t2;
  var xr = (e24, t2, n2, r2) => e24 < r2 / 2 ? 0.5 * br(2 * e24, 0, n2, r2) + t2 : 0.5 * yr(2 * e24 - r2, 0, n2, r2) + 0.5 * n2 + t2;
  var Sr = (e24, t2, n2, r2) => n2 * (e24 /= r2) * e24 + t2;
  var Cr = (e24, t2, n2, r2) => -n2 * (e24 /= r2) * (e24 - 2) + t2;
  var wr = (e24, t2, n2, r2) => (e24 /= r2 / 2) < 1 ? n2 / 2 * e24 ** 2 + t2 : -n2 / 2 * (--e24 * (e24 - 2) - 1) + t2;
  var Tr = () => false;
  var Er = class {
    constructor({ startValue: e24, byValue: t2, duration: n2 = 500, delay: r2 = 0, easing: a2 = Jn, onStart: o2 = x, onChange: s2 = x, onComplete: c2 = x, abort: l2 = Tr, target: u2 }) {
      i(this, `_state`, `pending`), i(this, `durationProgress`, 0), i(this, `valueProgress`, 0), this.tick = this.tick.bind(this), this.duration = n2, this.delay = r2, this.easing = a2, this._onStart = o2, this._onChange = s2, this._onComplete = c2, this._abort = l2, this.target = u2, this.startValue = e24, this.byValue = t2, this.value = this.startValue, this.endValue = Object.freeze(this.calculate(this.duration).value);
    }
    get state() {
      return this._state;
    }
    isDone() {
      return this._state === `aborted` || this._state === `completed`;
    }
    start() {
      let e24 = (e25) => {
        this._state === `pending` && (this.startTime = e25 || +/* @__PURE__ */ new Date(), this._state = `running`, this._onStart(), this.tick(this.startTime));
      };
      this.register(), this.delay > 0 ? this.timeout = _().setTimeout(() => Oe(e24), this.delay) : Oe(e24);
    }
    tick(e24) {
      let t2 = (e24 || +/* @__PURE__ */ new Date()) - this.startTime, n2 = Math.min(t2, this.duration);
      this.durationProgress = n2 / this.duration;
      let { value: r2, valueProgress: i2 } = this.calculate(n2);
      this.value = Object.freeze(r2), this.valueProgress = i2, this._state !== `aborted` && (this._abort(this.value, this.valueProgress, this.durationProgress) ? (this._state = `aborted`, this.unregister()) : t2 >= this.duration ? (this.durationProgress = this.valueProgress = 1, this._onChange(this.endValue, this.valueProgress, this.durationProgress), this._state = `completed`, this._onComplete(this.endValue, this.valueProgress, this.durationProgress), this.unregister(), this.timeout = null) : (this._onChange(this.value, this.valueProgress, this.durationProgress), Oe(this.tick)));
    }
    register() {
      ye.push(this);
    }
    unregister() {
      ye.remove(this);
    }
    abort() {
      this._state = `aborted`, this.unregister(), this.timeout && _().clearTimeout(this.timeout);
    }
  };
  var Dr = class extends Er {
    constructor({ startValue: e24 = 0, endValue: t2 = 100, ...n2 }) {
      super({ ...n2, startValue: e24, byValue: t2 - e24 });
    }
    calculate(e24) {
      let t2 = this.easing(e24, this.startValue, this.byValue, this.duration);
      return { value: t2, valueProgress: Math.abs((t2 - this.startValue) / this.byValue) };
    }
  };
  var Or = class extends Er {
    constructor({ startValue: e24 = [0], endValue: t2 = [100], ...n2 }) {
      super({ ...n2, startValue: e24, byValue: t2.map((t3, n3) => t3 - e24[n3]) });
    }
    calculate(e24) {
      let t2 = this.startValue.map((t3, n2) => this.easing(e24, t3, this.byValue[n2], this.duration, n2));
      return { value: t2, valueProgress: Math.abs((t2[0] - this.startValue[0]) / this.byValue[0]) };
    }
  };
  var kr = (e24, t2, n2, r2) => t2 + n2 * (1 - Math.cos(e24 / r2 * S));
  var Ar = (e24) => e24 && ((t2, n2, r2) => e24(new G(t2).toRgba(), n2, r2));
  var jr = class extends Er {
    constructor({ startValue: e24, endValue: t2, easing: n2 = kr, onChange: r2, onComplete: i2, abort: a2, ...o2 }) {
      let s2 = new G(e24).getSource(), c2 = new G(t2).getSource();
      super({ ...o2, startValue: s2, byValue: c2.map((e25, t3) => e25 - s2[t3]), easing: n2, onChange: Ar(r2), onComplete: Ar(i2), abort: Ar(a2) });
    }
    calculate(e24) {
      let [t2, n2, r2, i2] = this.startValue.map((t3, n3) => this.easing(e24, t3, this.byValue[n3], this.duration, n3)), a2 = [...[t2, n2, r2].map(Math.round), Vn(0, i2, 1)];
      return { value: a2, valueProgress: a2.map((e25, t3) => this.byValue[t3] === 0 ? 0 : Math.abs((e25 - this.startValue[t3]) / this.byValue[t3])).find((e25) => e25 !== 0) || 0 };
    }
  };
  function Mr(e24) {
    let t2 = ((e25) => Array.isArray(e25.startValue) || Array.isArray(e25.endValue))(e24) ? new Or(e24) : new Dr(e24);
    return t2.start(), t2;
  }
  function Nr(e24) {
    let t2 = new jr(e24);
    return t2.start(), t2;
  }
  var Pr = class e6 {
    constructor(e24) {
      this.status = e24, this.points = [];
    }
    includes(e24) {
      return this.points.some((t2) => t2.eq(e24));
    }
    append(...e24) {
      return this.points = this.points.concat(e24.filter((e25) => !this.includes(e25))), this;
    }
    static isPointContained(e24, t2, n2, r2 = false) {
      if (t2.eq(n2)) return e24.eq(t2);
      if (t2.x === n2.x) return e24.x === t2.x && (r2 || e24.y >= Math.min(t2.y, n2.y) && e24.y <= Math.max(t2.y, n2.y));
      if (t2.y === n2.y) return e24.y === t2.y && (r2 || e24.x >= Math.min(t2.x, n2.x) && e24.x <= Math.max(t2.x, n2.x));
      {
        let i2 = zt(t2, n2), a2 = zt(t2, e24).divide(i2);
        return r2 ? Math.abs(a2.x) === Math.abs(a2.y) : a2.x === a2.y && a2.x >= 0 && a2.x <= 1;
      }
    }
    static isPointInPolygon(e24, t2) {
      let n2 = new N(e24).setX(Math.min(e24.x - 1, ...t2.map((e25) => e25.x))), r2 = 0;
      for (let i2 = 0; i2 < t2.length; i2++) {
        let a2 = this.intersectSegmentSegment(t2[i2], t2[(i2 + 1) % t2.length], e24, n2);
        if (a2.includes(e24)) return true;
        r2 += Number(a2.status === `Intersection`);
      }
      return r2 % 2 == 1;
    }
    static intersectLineLine(t2, n2, r2, i2, a2 = true, o2 = true) {
      let s2 = n2.x - t2.x, c2 = n2.y - t2.y, l2 = i2.x - r2.x, u2 = i2.y - r2.y, d2 = t2.x - r2.x, f2 = t2.y - r2.y, p2 = l2 * f2 - u2 * d2, m = s2 * f2 - c2 * d2, h2 = u2 * s2 - l2 * c2;
      if (h2 !== 0) {
        let n3 = p2 / h2, r3 = m / h2;
        return (a2 || 0 <= n3 && n3 <= 1) && (o2 || 0 <= r3 && r3 <= 1) ? new e6(`Intersection`).append(new N(t2.x + n3 * s2, t2.y + n3 * c2)) : new e6();
      }
      return new e6(p2 === 0 || m === 0 ? a2 || o2 || e6.isPointContained(t2, r2, i2) || e6.isPointContained(n2, r2, i2) || e6.isPointContained(r2, t2, n2) || e6.isPointContained(i2, t2, n2) ? `Coincident` : void 0 : `Parallel`);
    }
    static intersectSegmentLine(t2, n2, r2, i2) {
      return e6.intersectLineLine(t2, n2, r2, i2, false, true);
    }
    static intersectSegmentSegment(t2, n2, r2, i2) {
      return e6.intersectLineLine(t2, n2, r2, i2, false, false);
    }
    static intersectLinePolygon(t2, n2, r2, i2 = true) {
      let a2 = new e6(), o2 = r2.length;
      for (let s2, c2, l2, u2 = 0; u2 < o2; u2++) {
        if (s2 = r2[u2], c2 = r2[(u2 + 1) % o2], l2 = e6.intersectLineLine(t2, n2, s2, c2, i2, false), l2.status === `Coincident`) return l2;
        a2.append(...l2.points);
      }
      return a2.points.length > 0 && (a2.status = `Intersection`), a2;
    }
    static intersectSegmentPolygon(t2, n2, r2) {
      return e6.intersectLinePolygon(t2, n2, r2, false);
    }
    static intersectPolygonPolygon(t2, n2) {
      let r2 = new e6(), i2 = t2.length, a2 = [];
      for (let o2 = 0; o2 < i2; o2++) {
        let s2 = t2[o2], c2 = t2[(o2 + 1) % i2], l2 = e6.intersectSegmentPolygon(s2, c2, n2);
        l2.status === `Coincident` ? (a2.push(l2), r2.append(s2, c2)) : r2.append(...l2.points);
      }
      return a2.length > 0 && a2.length === t2.length ? new e6(`Coincident`) : (r2.points.length > 0 && (r2.status = `Intersection`), r2);
    }
    static intersectPolygonRectangle(t2, n2, r2) {
      let i2 = n2.min(r2), a2 = n2.max(r2), o2 = new N(a2.x, i2.y), s2 = new N(i2.x, a2.y);
      return e6.intersectPolygonPolygon(t2, [i2, o2, a2, s2]);
    }
  };
  var Fr = class extends De {
    getX() {
      return this.getXY().x;
    }
    setX(e24) {
      this.setXY(this.getXY().setX(e24));
    }
    getY() {
      return this.getXY().y;
    }
    setY(e24) {
      this.setXY(this.getXY().setY(e24));
    }
    getRelativeX() {
      return this.left;
    }
    setRelativeX(e24) {
      this.left = e24;
    }
    getRelativeY() {
      return this.top;
    }
    setRelativeY(e24) {
      this.top = e24;
    }
    getXY() {
      let e24 = this.getRelativeXY();
      return this.group ? L(e24, this.group.calcTransformMatrix()) : e24;
    }
    setXY(e24, t2, n2) {
      this.group && (e24 = L(e24, R(this.group.calcTransformMatrix()))), this.setRelativeXY(e24, t2, n2);
    }
    getRelativeXY() {
      return new N(this.left, this.top);
    }
    setRelativeXY(e24, t2 = this.originX, n2 = this.originY) {
      this.setPositionByOrigin(e24, t2, n2);
    }
    isStrokeAccountedForInDimensions() {
      return false;
    }
    getCoords() {
      let { tl: e24, tr: t2, br: n2, bl: r2 } = this.aCoords || (this.aCoords = this.calcACoords()), i2 = [e24, t2, n2, r2];
      if (this.group) {
        let e25 = this.group.calcTransformMatrix();
        return i2.map((t3) => L(t3, e25));
      }
      return i2;
    }
    intersectsWithRect(e24, t2) {
      return Pr.intersectPolygonRectangle(this.getCoords(), e24, t2).status === `Intersection`;
    }
    intersectsWithObject(e24) {
      let t2 = Pr.intersectPolygonPolygon(this.getCoords(), e24.getCoords());
      return t2.status === `Intersection` || t2.status === `Coincident` || e24.isContainedWithinObject(this) || this.isContainedWithinObject(e24);
    }
    isContainedWithinObject(e24) {
      return this.getCoords().every((t2) => e24.containsPoint(t2));
    }
    isContainedWithinRect(e24, t2) {
      let { left: n2, top: r2, width: i2, height: a2 } = this.getBoundingRect();
      return n2 >= e24.x && n2 + i2 <= t2.x && r2 >= e24.y && r2 + a2 <= t2.y;
    }
    isOverlapping(e24) {
      return this.intersectsWithObject(e24) || this.isContainedWithinObject(e24) || e24.isContainedWithinObject(this);
    }
    containsPoint(e24) {
      return Pr.isPointInPolygon(e24, this.getCoords());
    }
    isOnScreen() {
      if (!this.canvas) return false;
      let { tl: e24, br: t2 } = this.canvas.vptCoords;
      return !!this.getCoords().some((n2) => n2.x <= t2.x && n2.x >= e24.x && n2.y <= t2.y && n2.y >= e24.y) || !!this.intersectsWithRect(e24, t2) || this.containsPoint(e24.midPointFrom(t2));
    }
    isPartiallyOnScreen() {
      if (!this.canvas) return false;
      let { tl: e24, br: t2 } = this.canvas.vptCoords;
      return !!this.intersectsWithRect(e24, t2) || this.getCoords().every((n2) => (n2.x >= t2.x || n2.x <= e24.x) && (n2.y >= t2.y || n2.y <= e24.y)) && this.containsPoint(e24.midPointFrom(t2));
    }
    getBoundingRect() {
      return wt(this.getCoords());
    }
    getScaledWidth() {
      return this._getTransformedDimensions().x;
    }
    getScaledHeight() {
      return this._getTransformedDimensions().y;
    }
    scale(e24) {
      this._set(de, e24), this._set(fe, e24), this.setCoords();
    }
    scaleToWidth(e24) {
      let t2 = this.getBoundingRect().width / this.getScaledWidth();
      return this.scale(e24 / this.width / t2);
    }
    scaleToHeight(e24) {
      let t2 = this.getBoundingRect().height / this.getScaledHeight();
      return this.scale(e24 / this.height / t2);
    }
    getCanvasRetinaScaling() {
      var e24;
      return ((e24 = this.canvas) == null ? void 0 : e24.getRetinaScaling()) || 1;
    }
    getTotalAngle() {
      return this.group ? Ie(ze(this.calcTransformMatrix())) : this.angle;
    }
    getViewportTransform() {
      var e24;
      return ((e24 = this.canvas) == null ? void 0 : e24.viewportTransform) || T.concat();
    }
    calcACoords() {
      let e24 = We({ angle: this.angle }), { x: t2, y: n2 } = this.getRelativeCenterPoint(), r2 = z(Ue(t2, n2), e24), i2 = this._getTransformedDimensions(), a2 = i2.x / 2, o2 = i2.y / 2;
      return { tl: L({ x: -a2, y: -o2 }, r2), tr: L({ x: a2, y: -o2 }, r2), bl: L({ x: -a2, y: o2 }, r2), br: L({ x: a2, y: o2 }, r2) };
    }
    setCoords() {
      this.aCoords = this.calcACoords();
    }
    transformMatrixKey(e24 = false) {
      let t2 = [];
      return !e24 && this.group && (t2 = this.group.transformMatrixKey(e24)), t2.push(this.top, this.left, this.width, this.height, this.scaleX, this.scaleY, this.angle, this.strokeWidth, this.skewX, this.skewY, +this.flipX, +this.flipY, W(this.originX), W(this.originY)), t2;
    }
    calcTransformMatrix(e24 = false) {
      let t2 = this.calcOwnMatrix();
      if (e24 || !this.group) return t2;
      let n2 = this.transformMatrixKey(e24), r2 = this.matrixCache;
      return r2 && r2.key.every((e25, t3) => e25 === n2[t3]) ? r2.value : (this.group && (t2 = z(this.group.calcTransformMatrix(false), t2)), this.matrixCache = { key: n2, value: t2 }, t2);
    }
    calcOwnMatrix() {
      let e24 = this.transformMatrixKey(true), t2 = this.ownMatrixCache;
      if (t2 && t2.key.every((t3, n3) => t3 === e24[n3])) return t2.value;
      let n2 = this.getRelativeCenterPoint(), r2 = Xe({ angle: this.angle, translateX: n2.x, translateY: n2.y, scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, flipX: this.flipX, flipY: this.flipY });
      return this.ownMatrixCache = { key: e24, value: r2 }, r2;
    }
    _getNonTransformedDimensions() {
      return new N(this.width, this.height).scalarAdd(this.strokeWidth);
    }
    _calculateCurrentDimensions(e24) {
      var t2;
      let n2 = (t2 = this.canvas) == null ? void 0 : t2.viewportTransform, r2 = this._getTransformedDimensions(e24);
      return n2 ? r2.multiply(new N(Be(n2), Ve(n2))).scalarAdd(2 * this.padding) : r2.scalarAdd(2 * this.padding);
    }
    _getTransformedDimensions(e24 = {}) {
      let t2 = { scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, width: this.width, height: this.height, strokeWidth: this.strokeWidth, ...e24 }, n2 = t2.strokeWidth, r2 = n2, i2 = 0;
      this.strokeUniform && (r2 = 0, i2 = n2);
      let a2 = t2.width + r2, o2 = t2.height + r2, s2;
      return s2 = t2.skewX === 0 && t2.skewY === 0 ? new N(a2 * t2.scaleX, o2 * t2.scaleY) : At(a2, o2, Ye(t2)), s2.scalarAdd(i2);
    }
    translateToGivenOrigin(e24, t2, n2, r2, i2) {
      let a2 = e24.x, o2 = e24.y, s2 = W(r2) - W(t2), c2 = W(i2) - W(n2);
      if (s2 || c2) {
        let e25 = this._getTransformedDimensions();
        a2 += s2 * e25.x, o2 += c2 * e25.y;
      }
      return new N(a2, o2);
    }
    translateToCenterPoint(e24, t2, n2) {
      if (t2 === `center` && n2 === `center`) return e24;
      let r2 = this.translateToGivenOrigin(e24, t2, n2, E, E);
      return this.angle ? r2.rotate(I(this.angle), e24) : r2;
    }
    translateToOriginPoint(e24, t2, n2) {
      let r2 = this.translateToGivenOrigin(e24, E, E, t2, n2);
      return this.angle ? r2.rotate(I(this.angle), e24) : r2;
    }
    getCenterPoint() {
      let e24 = this.getRelativeCenterPoint();
      return this.group ? L(e24, this.group.calcTransformMatrix()) : e24;
    }
    getRelativeCenterPoint() {
      return this.translateToCenterPoint(new N(this.left, this.top), this.originX, this.originY);
    }
    getPointByOrigin(e24, t2) {
      return this.getPositionByOrigin(e24, t2);
    }
    getPositionByOrigin(e24, t2) {
      return this.translateToOriginPoint(this.getRelativeCenterPoint(), e24, t2);
    }
    setPositionByOrigin(e24, t2, n2) {
      let r2 = this.translateToCenterPoint(e24, t2, n2), i2 = this.translateToOriginPoint(r2, this.originX, this.originY);
      this.set({ left: i2.x, top: i2.y });
    }
    _getLeftTopCoords() {
      return this.getPositionByOrigin(D, `top`);
    }
    positionByLeftTop(e24) {
      return this.setPositionByOrigin(e24, D, `top`);
    }
  };
  var Ir = class e7 extends Fr {
    static getDefaults() {
      return e7.ownDefaults;
    }
    get type() {
      let e24 = this.constructor.type;
      return e24 === `FabricObject` ? `object` : e24.toLowerCase();
    }
    set type(e24) {
      s(`warn`, `Setting type has no effect`, e24);
    }
    constructor(t2) {
      super(), i(this, `_cacheContext`, null), Object.assign(this, e7.ownDefaults), this.setOptions(t2);
    }
    _createCacheCanvas() {
      this._cacheCanvas = P(), this._cacheContext = this._cacheCanvas.getContext(`2d`), this._updateCacheCanvas(), this.dirty = true;
    }
    _limitCacheSize(e24) {
      let t2 = e24.width, n2 = e24.height, r2 = o.maxCacheSideLimit, i2 = o.minCacheSideLimit;
      if (t2 <= r2 && n2 <= r2 && t2 * n2 <= o.perfLimitSizeTotal) return t2 < i2 && (e24.width = i2), n2 < i2 && (e24.height = i2), e24;
      let a2 = t2 / n2, [s2, c2] = y.limitDimsByArea(a2), l2 = Vn(i2, s2, r2), u2 = Vn(i2, c2, r2);
      return t2 > l2 && (e24.zoomX /= t2 / l2, e24.width = l2, e24.capped = true), n2 > u2 && (e24.zoomY /= n2 / u2, e24.height = u2, e24.capped = true), e24;
    }
    _getCacheCanvasDimensions() {
      let e24 = this.getTotalObjectScaling(), t2 = this._getTransformedDimensions({ skewX: 0, skewY: 0 }), n2 = t2.x * e24.x / this.scaleX, r2 = t2.y * e24.y / this.scaleY;
      return { width: Math.ceil(n2 + 2), height: Math.ceil(r2 + 2), zoomX: e24.x, zoomY: e24.y, x: n2, y: r2 };
    }
    _updateCacheCanvas() {
      let e24 = this._cacheCanvas, t2 = this._cacheContext, { width: n2, height: r2, zoomX: i2, zoomY: a2, x: o2, y: s2 } = this._limitCacheSize(this._getCacheCanvasDimensions()), c2 = n2 !== e24.width || r2 !== e24.height, l2 = this.zoomX !== i2 || this.zoomY !== a2;
      if (!e24 || !t2) return false;
      if (c2 || l2) {
        n2 !== e24.width || r2 !== e24.height ? (e24.width = n2, e24.height = r2) : (t2.setTransform(1, 0, 0, 1, 0, 0), t2.clearRect(0, 0, e24.width, e24.height));
        let c3 = o2 / 2, l3 = s2 / 2;
        return this.cacheTranslationX = Math.round(e24.width / 2 - c3) + c3, this.cacheTranslationY = Math.round(e24.height / 2 - l3) + l3, t2.translate(this.cacheTranslationX, this.cacheTranslationY), t2.scale(i2, a2), this.zoomX = i2, this.zoomY = a2, true;
      }
      return false;
    }
    setOptions(e24 = {}) {
      this._setOptions(e24);
    }
    transform(e24) {
      let t2 = this.group && !this.group._transformDone || this.group && this.canvas && e24 === this.canvas.contextTop, n2 = this.calcTransformMatrix(!t2);
      e24.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]);
    }
    getObjectScaling() {
      if (!this.group) return new N(Math.abs(this.scaleX), Math.abs(this.scaleY));
      let e24 = He(this.calcTransformMatrix());
      return new N(Math.abs(e24.scaleX), Math.abs(e24.scaleY));
    }
    getTotalObjectScaling() {
      let e24 = this.getObjectScaling();
      if (this.canvas) {
        let t2 = this.canvas.getZoom(), n2 = this.getCanvasRetinaScaling();
        return e24.scalarMultiply(t2 * n2);
      }
      return e24;
    }
    getObjectOpacity() {
      let e24 = this.opacity;
      return this.group && (e24 *= this.group.getObjectOpacity()), e24;
    }
    _constrainScale(e24) {
      return Math.abs(e24) < this.minScaleLimit ? e24 < 0 ? -this.minScaleLimit : this.minScaleLimit : e24 === 0 ? 1e-4 : e24;
    }
    _set(e24, t2) {
      e24 !== `scaleX` && e24 !== `scaleY` || (t2 = this._constrainScale(t2)), e24 === `scaleX` && t2 < 0 ? (this.flipX = !this.flipX, t2 *= -1) : e24 === `scaleY` && t2 < 0 ? (this.flipY = !this.flipY, t2 *= -1) : e24 !== `shadow` || !t2 || t2 instanceof Bn || (t2 = new Bn(t2));
      let n2 = this[e24] !== t2;
      return this[e24] = t2, n2 && this.constructor.cacheProperties.includes(e24) && (this.dirty = true), this.parent && (this.dirty || n2 && this.constructor.stateProperties.includes(e24)) && this.parent._set(`dirty`, true), this;
    }
    isNotVisible() {
      return this.opacity === 0 || !this.width && !this.height && this.strokeWidth === 0 || !this.visible;
    }
    render(e24) {
      this.isNotVisible() || this.canvas && this.canvas.skipOffscreen && !this.group && !this.isOnScreen() || (e24.save(), this._setupCompositeOperation(e24), this.drawSelectionBackground(e24), this.transform(e24), this._setOpacity(e24), this._setShadow(e24), this.shouldCache() ? (this.renderCache(), this.drawCacheOnCanvas(e24)) : (this._removeCacheCanvas(), this.drawObject(e24, false, {}), this.dirty = false), e24.restore());
    }
    drawSelectionBackground(e24) {
    }
    renderCache(e24) {
      if (e24 = e24 || {}, this._cacheCanvas && this._cacheContext || this._createCacheCanvas(), this.isCacheDirty() && this._cacheContext) {
        let { zoomX: t2, zoomY: n2, cacheTranslationX: r2, cacheTranslationY: i2 } = this, { width: a2, height: o2 } = this._cacheCanvas;
        this.drawObject(this._cacheContext, e24.forClipping, { zoomX: t2, zoomY: n2, cacheTranslationX: r2, cacheTranslationY: i2, width: a2, height: o2, parentClipPaths: [] }), this.dirty = false;
      }
    }
    _removeCacheCanvas() {
      this._cacheCanvas = void 0, this._cacheContext = null;
    }
    hasStroke() {
      return !!this.stroke && this.stroke !== `transparent` && this.strokeWidth !== 0;
    }
    hasFill() {
      return !!this.fill && this.fill !== `transparent`;
    }
    needsItsOwnCache() {
      return !!(this.paintFirst === `stroke` && this.hasFill() && this.hasStroke() && this.shadow) || !!this.clipPath;
    }
    shouldCache() {
      return this.ownCaching = this.objectCaching && (!this.parent || !this.parent.isOnACache()) || this.needsItsOwnCache(), this.ownCaching;
    }
    willDrawShadow() {
      return !!this.shadow && (this.shadow.offsetX !== 0 || this.shadow.offsetY !== 0);
    }
    drawClipPathOnCache(e24, t2, n2) {
      e24.save(), t2.inverted ? e24.globalCompositeOperation = `destination-out` : e24.globalCompositeOperation = `destination-in`, e24.setTransform(1, 0, 0, 1, 0, 0), e24.drawImage(n2, 0, 0), e24.restore();
    }
    drawObject(e24, t2, n2) {
      let r2 = this.fill, i2 = this.stroke;
      t2 ? (this.fill = `black`, this.stroke = ``, this._setClippingProperties(e24)) : this._renderBackground(e24), this.fire(`before:render`, { ctx: e24 }), this._render(e24), this._drawClipPath(e24, this.clipPath, n2), this.fill = r2, this.stroke = i2;
    }
    createClipPathLayer(e24, t2) {
      let n2 = F(t2), r2 = n2.getContext(`2d`);
      if (r2.translate(t2.cacheTranslationX, t2.cacheTranslationY), r2.scale(t2.zoomX, t2.zoomY), e24._cacheCanvas = n2, t2.parentClipPaths.forEach((e25) => {
        e25.transform(r2);
      }), t2.parentClipPaths.push(e24), e24.absolutePositioned) {
        let e25 = R(this.calcTransformMatrix());
        r2.transform(e25[0], e25[1], e25[2], e25[3], e25[4], e25[5]);
      }
      return e24.transform(r2), e24.drawObject(r2, true, t2), n2;
    }
    _drawClipPath(e24, t2, n2) {
      if (!t2) return;
      t2._transformDone = true;
      let r2 = this.createClipPathLayer(t2, n2);
      this.drawClipPathOnCache(e24, t2, r2);
    }
    drawCacheOnCanvas(e24) {
      e24.scale(1 / this.zoomX, 1 / this.zoomY), e24.drawImage(this._cacheCanvas, -this.cacheTranslationX, -this.cacheTranslationY);
    }
    isCacheDirty(e24 = false) {
      if (this.isNotVisible()) return false;
      let t2 = this._cacheCanvas, n2 = this._cacheContext;
      return !(!t2 || !n2 || e24 || !this._updateCacheCanvas()) || !!(this.dirty || this.clipPath && this.clipPath.absolutePositioned) && (t2 && n2 && !e24 && (n2.save(), n2.setTransform(1, 0, 0, 1, 0, 0), n2.clearRect(0, 0, t2.width, t2.height), n2.restore()), true);
    }
    _renderBackground(e24) {
      if (!this.backgroundColor) return;
      let t2 = this._getNonTransformedDimensions();
      e24.fillStyle = this.backgroundColor, e24.fillRect(-t2.x / 2, -t2.y / 2, t2.x, t2.y), this._removeShadow(e24);
    }
    _setOpacity(e24) {
      this.group && !this.group._transformDone ? e24.globalAlpha = this.getObjectOpacity() : e24.globalAlpha *= this.opacity;
    }
    _setStrokeStyles(e24, t2) {
      let n2 = t2.stroke;
      n2 && (e24.lineWidth = t2.strokeWidth, e24.lineCap = t2.strokeLineCap, e24.lineDashOffset = t2.strokeDashOffset, e24.lineJoin = t2.strokeLineJoin, e24.miterLimit = t2.strokeMiterLimit, V(n2) ? n2.gradientUnits === `percentage` || n2.gradientTransform || n2.patternTransform ? this._applyPatternForTransformedGradient(e24, n2) : (e24.strokeStyle = n2.toLive(e24), this._applyPatternGradientTransform(e24, n2)) : e24.strokeStyle = t2.stroke);
    }
    _setFillStyles(e24, { fill: t2 }) {
      t2 && (V(t2) ? (e24.fillStyle = t2.toLive(e24), this._applyPatternGradientTransform(e24, t2)) : e24.fillStyle = t2);
    }
    _setClippingProperties(e24) {
      e24.globalAlpha = 1, e24.strokeStyle = `transparent`, e24.fillStyle = `#000000`;
    }
    _setLineDash(e24, t2) {
      t2 && t2.length !== 0 && e24.setLineDash(t2);
    }
    _setShadow(e24) {
      if (!this.shadow) return;
      let t2 = this.shadow, n2 = this.canvas, r2 = this.getCanvasRetinaScaling(), [i2, , , a2] = (n2 == null ? void 0 : n2.viewportTransform) || T, s2 = i2 * r2, c2 = a2 * r2, l2 = t2.nonScaling ? new N(1, 1) : this.getObjectScaling();
      e24.shadowColor = t2.color, e24.shadowBlur = t2.blur * o.browserShadowBlurConstant * (s2 + c2) * (l2.x + l2.y) / 4, e24.shadowOffsetX = t2.offsetX * s2 * l2.x, e24.shadowOffsetY = t2.offsetY * c2 * l2.y;
    }
    _removeShadow(e24) {
      this.shadow && (e24.shadowColor = ``, e24.shadowBlur = e24.shadowOffsetX = e24.shadowOffsetY = 0);
    }
    _applyPatternGradientTransform(e24, t2) {
      if (!V(t2)) return { offsetX: 0, offsetY: 0 };
      let n2 = t2.gradientTransform || t2.patternTransform, r2 = -this.width / 2 + t2.offsetX || 0, i2 = -this.height / 2 + t2.offsetY || 0;
      return t2.gradientUnits === `percentage` ? e24.transform(this.width, 0, 0, this.height, r2, i2) : e24.transform(1, 0, 0, 1, r2, i2), n2 && e24.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), { offsetX: r2, offsetY: i2 };
    }
    _renderPaintInOrder(e24) {
      this.paintFirst === `stroke` ? (this._renderStroke(e24), this._renderFill(e24)) : (this._renderFill(e24), this._renderStroke(e24));
    }
    _render(e24) {
    }
    _renderFill(e24) {
      this.fill && (e24.save(), this._setFillStyles(e24, this), this.fillRule === `evenodd` ? e24.fill(`evenodd`) : e24.fill(), e24.restore());
    }
    _renderStroke(e24) {
      if (this.stroke && this.strokeWidth !== 0) {
        if (this.shadow && !this.shadow.affectStroke && this._removeShadow(e24), e24.save(), this.strokeUniform) {
          let t2 = this.getObjectScaling();
          e24.scale(1 / t2.x, 1 / t2.y);
        }
        this._setLineDash(e24, this.strokeDashArray), this._setStrokeStyles(e24, this), e24.stroke(), e24.restore();
      }
    }
    _applyPatternForTransformedGradient(e24, t2) {
      var n2;
      let r2 = this._limitCacheSize(this._getCacheCanvasDimensions()), i2 = this.getCanvasRetinaScaling(), a2 = r2.x / this.scaleX / i2, o2 = r2.y / this.scaleY / i2, s2 = F({ width: Math.ceil(a2), height: Math.ceil(o2) }), c2 = s2.getContext(`2d`);
      c2 && (c2.beginPath(), c2.moveTo(0, 0), c2.lineTo(a2, 0), c2.lineTo(a2, o2), c2.lineTo(0, o2), c2.closePath(), c2.translate(a2 / 2, o2 / 2), c2.scale(r2.zoomX / this.scaleX / i2, r2.zoomY / this.scaleY / i2), this._applyPatternGradientTransform(c2, t2), c2.fillStyle = t2.toLive(e24), c2.fill(), e24.translate(-this.width / 2 - this.strokeWidth / 2, -this.height / 2 - this.strokeWidth / 2), e24.scale(i2 * this.scaleX / r2.zoomX, i2 * this.scaleY / r2.zoomY), e24.strokeStyle = (n2 = c2.createPattern(s2, `no-repeat`)) == null ? `` : n2);
    }
    _findCenterFromElement() {
      return new N(this.left + this.width / 2, this.top + this.height / 2);
    }
    clone(e24) {
      let t2 = this.toObject(e24);
      return this.constructor.fromObject(t2);
    }
    cloneAsImage(e24) {
      let t2 = this.toCanvasElement(e24);
      return new (M.getClass(`image`))(t2);
    }
    toCanvasElement(e24 = {}) {
      let t2 = kt(this), n2 = this.group, r2 = this.shadow, i2 = Math.abs, a2 = e24.enableRetinaScaling ? v() : 1, o2 = (e24.multiplier || 1) * a2, s2 = e24.canvasProvider || ((e25) => new yt(e25, { enableRetinaScaling: false, renderOnAddRemove: false, skipOffscreen: false }));
      delete this.group, e24.withoutTransform && Ot(this), e24.withoutShadow && (this.shadow = null), e24.viewportTransform && Pt(this, this.getViewportTransform()), this.setCoords();
      let c2 = P(), l2 = this.getBoundingRect(), u2 = this.shadow, d2 = new N();
      if (u2) {
        let e25 = u2.blur, t3 = u2.nonScaling ? new N(1, 1) : this.getObjectScaling();
        d2.x = 2 * Math.round(i2(u2.offsetX) + e25) * i2(t3.x), d2.y = 2 * Math.round(i2(u2.offsetY) + e25) * i2(t3.y);
      }
      let f2 = l2.width + d2.x, p2 = l2.height + d2.y;
      c2.width = Math.ceil(f2), c2.height = Math.ceil(p2);
      let m = s2(c2);
      e24.format === `jpeg` && (m.backgroundColor = `#fff`), this.setPositionByOrigin(new N(m.width / 2, m.height / 2), E, E);
      let h2 = this.canvas;
      m._objects = [this], this.set(`canvas`, m), this.setCoords();
      let g2 = m.toCanvasElement(o2 || 1, e24);
      return this.set(`canvas`, h2), this.shadow = r2, n2 && (this.group = n2), this.set(t2), this.setCoords(), m._objects = [], m.destroy(), g2;
    }
    toDataURL(e24 = {}) {
      return Pe(this.toCanvasElement(e24), e24.format || `png`, e24.quality || 1);
    }
    toBlob(e24 = {}) {
      return Fe(this.toCanvasElement(e24), e24.format || `png`, e24.quality || 1);
    }
    isType(...e24) {
      return e24.includes(this.constructor.type) || e24.includes(this.type);
    }
    complexity() {
      return 1;
    }
    toJSON() {
      return this.toObject();
    }
    rotate(e24) {
      let { centeredRotation: t2, originX: n2, originY: r2 } = this;
      if (t2) {
        let { x: e25, y: t3 } = this.getRelativeCenterPoint();
        this.originX = E, this.originY = E, this.left = e25, this.top = t3;
      }
      if (this.set(`angle`, e24), t2) {
        let { x: e25, y: t3 } = this.getPositionByOrigin(n2, r2);
        this.left = e25, this.top = t3, this.originX = n2, this.originY = r2;
      }
    }
    setOnGroup() {
    }
    _setupCompositeOperation(e24) {
      this.globalCompositeOperation && (e24.globalCompositeOperation = this.globalCompositeOperation);
    }
    dispose() {
      ye.cancelByTarget(this), this.off(), this._set(`canvas`, void 0), this._cacheCanvas && h().dispose(this._cacheCanvas), this._cacheCanvas = void 0, this._cacheContext = null;
    }
    animate(e24, t2) {
      return Object.entries(e24).reduce((e25, [n2, r2]) => (e25[n2] = this._animate(n2, r2, t2), e25), {});
    }
    _animate(e24, t2, n2 = {}) {
      let r2 = e24.split(`.`), i2 = this.constructor.colorProperties.includes(r2[r2.length - 1]), { abort: a2, startValue: o2, onChange: s2, onComplete: c2 } = n2, l2 = { ...n2, target: this, startValue: o2 == null ? r2.reduce((e25, t3) => e25[t3], this) : o2, endValue: t2, abort: a2 == null ? void 0 : a2.bind(this), onChange: (e25, t3, n3) => {
        r2.reduce((t4, n4, i3) => (i3 === r2.length - 1 && (t4[n4] = e25), t4[n4]), this), s2 && s2(e25, t3, n3);
      }, onComplete: (e25, t3, n3) => {
        this.setCoords(), c2 && c2(e25, t3, n3);
      } };
      return i2 ? Nr(l2) : Mr(l2);
    }
    isDescendantOf(e24) {
      let { parent: t2, group: n2 } = this;
      return t2 === e24 || n2 === e24 || !!t2 && t2.isDescendantOf(e24) || !!n2 && n2 !== t2 && n2.isDescendantOf(e24);
    }
    getAncestors() {
      let e24 = [], t2 = this;
      do
        t2 = t2.parent, t2 && e24.push(t2);
      while (t2);
      return e24;
    }
    findCommonAncestors(e24) {
      if (this === e24) return { fork: [], otherFork: [], common: [this, ...this.getAncestors()] };
      let t2 = this.getAncestors(), n2 = e24.getAncestors();
      if (t2.length === 0 && n2.length > 0 && this === n2[n2.length - 1]) return { fork: [], otherFork: [e24, ...n2.slice(0, n2.length - 1)], common: [this] };
      for (let r2, i2 = 0; i2 < t2.length; i2++) {
        if (r2 = t2[i2], r2 === e24) return { fork: [this, ...t2.slice(0, i2)], otherFork: [], common: t2.slice(i2) };
        for (let a2 = 0; a2 < n2.length; a2++) {
          if (this === n2[a2]) return { fork: [], otherFork: [e24, ...n2.slice(0, a2)], common: [this, ...t2] };
          if (r2 === n2[a2]) return { fork: [this, ...t2.slice(0, i2)], otherFork: [e24, ...n2.slice(0, a2)], common: t2.slice(i2) };
        }
      }
      return { fork: [this, ...t2], otherFork: [e24, ...n2], common: [] };
    }
    hasCommonAncestors(e24) {
      let t2 = this.findCommonAncestors(e24);
      return t2 && !!t2.common.length;
    }
    isInFrontOf(e24) {
      if (this === e24) return;
      let t2 = this.findCommonAncestors(e24);
      if (t2.fork.includes(e24)) return true;
      if (t2.otherFork.includes(this)) return false;
      let n2 = t2.common[0] || this.canvas;
      if (!n2) return;
      let r2 = t2.fork.pop(), i2 = t2.otherFork.pop(), a2 = n2._objects.indexOf(r2), o2 = n2._objects.indexOf(i2);
      return a2 > -1 && a2 > o2;
    }
    toObject(t2 = []) {
      let n2 = t2.concat(e7.customProperties, this.constructor.customProperties || []), r2, i2 = o.NUM_FRACTION_DIGITS, { clipPath: a2, fill: s2, stroke: c2, shadow: l2, strokeDashArray: u2, left: d2, top: f2, originX: p2, originY: m, width: h2, height: g2, strokeWidth: _2, strokeLineCap: v2, strokeDashOffset: y2, strokeLineJoin: x2, strokeUniform: S2, strokeMiterLimit: C2, scaleX: w2, scaleY: ee2, angle: T2, flipX: E2, flipY: D2, opacity: O2, visible: k2, backgroundColor: te2, fillRule: ne2, paintFirst: re2, globalCompositeOperation: ie2, skewX: ae2, skewY: oe2 } = this;
      a2 && !a2.excludeFromExport && (r2 = a2.toObject(n2.concat(`inverted`, `absolutePositioned`)));
      let A2 = (e24) => B(e24, i2), se2 = { ...et(this, n2), type: this.constructor.type, version: b, originX: p2, originY: m, left: A2(d2), top: A2(f2), width: A2(h2), height: A2(g2), fill: rt(s2) ? s2.toObject() : s2, stroke: rt(c2) ? c2.toObject() : c2, strokeWidth: A2(_2), strokeDashArray: u2 && u2.concat(), strokeLineCap: v2, strokeDashOffset: y2, strokeLineJoin: x2, strokeUniform: S2, strokeMiterLimit: A2(C2), scaleX: A2(w2), scaleY: A2(ee2), angle: A2(T2), flipX: E2, flipY: D2, opacity: A2(O2), shadow: l2 && l2.toObject(), visible: k2, backgroundColor: te2, fillRule: ne2, paintFirst: re2, globalCompositeOperation: ie2, skewX: A2(ae2), skewY: A2(oe2), ...r2 ? { clipPath: r2 } : null };
      return this.includeDefaultValues ? se2 : this._removeDefaultValues(se2);
    }
    toDatalessObject(e24) {
      return this.toObject(e24);
    }
    _removeDefaultValues(e24) {
      let t2 = this.constructor.getDefaults(), n2 = Object.keys(t2).length > 0 ? t2 : Object.getPrototypeOf(this);
      return tt(e24, (e25, t3) => {
        if (t3 === `left` || t3 === `top` || t3 === `type`) return true;
        let r2 = n2[t3];
        return e25 !== r2 && !(Array.isArray(e25) && Array.isArray(r2) && e25.length === 0 && r2.length === 0);
      });
    }
    toString() {
      return `#<${this.constructor.type}>`;
    }
    static _fromObject({ type: e24, ...t2 }, { extraParam: n2, ...r2 } = {}) {
      return $e(t2, r2).then((e25) => n2 ? (delete e25[n2], new this(t2[n2], e25)) : new this(e25));
    }
    static fromObject(e24, t2) {
      return this._fromObject(e24, t2);
    }
  };
  i(Ir, `stateProperties`, Hn), i(Ir, `cacheProperties`, Un), i(Ir, `ownDefaults`, Wn), i(Ir, `type`, `FabricObject`), i(Ir, `colorProperties`, [j, he, `backgroundColor`]), i(Ir, `customProperties`, []), M.setClass(Ir), M.setClass(Ir, `object`);
  var Lr = (e24, t2) => {
    var n2;
    let { transform: { target: r2 } } = t2;
    (n2 = r2.canvas) == null || n2.fire(`object:${e24}`, { ...t2, target: r2 }), r2.fire(e24, t2);
  };
  var Rr = (e24, t2, n2) => (r2, i2, a2, o2) => {
    let s2 = t2(r2, i2, a2, o2);
    return s2 && Lr(e24, { ...Qt(r2, i2, a2, o2), ...n2 }), s2;
  };
  function zr(e24) {
    return (t2, n2, r2, i2) => {
      let { target: a2, originX: o2, originY: s2 } = n2, c2 = a2.getPositionByOrigin(o2, s2), l2 = e24(t2, n2, r2, i2);
      return a2.setPositionByOrigin(c2, n2.originX, n2.originY), l2;
    };
  }
  var Br = (e24, t2, n2, r2) => (i2, a2, o2, s2) => {
    let c2 = en(a2, a2.originX, a2.originY, o2, s2)[n2], l2 = W(a2[t2]);
    if (l2 === 0 || l2 > 0 && c2 < 0 || l2 < 0 && c2 > 0) {
      let { target: t3 } = a2, n3 = t3.strokeWidth / (t3.strokeUniform ? t3[r2] : 1), i3 = Yt(a2) ? 2 : 1, o3 = t3[e24], s3 = Math.abs(c2 * i3 / t3[r2]) - n3;
      return t3.set(e24, Math.max(s3, 1)), o3 !== t3[e24];
    }
    return false;
  };
  var Vr = Br(`width`, `originX`, `x`, `scaleX`);
  var Hr = Br(`height`, `originY`, `y`, `scaleY`);
  var Ur = Rr(se, zr(Vr));
  var Wr = Rr(se, zr(Hr));
  function Gr(e24, t2, n2, r2, i2) {
    e24.save();
    let { stroke: a2, xSize: o2, ySize: s2, opName: c2 } = this.commonRenderProps(e24, t2, n2, i2, r2), l2 = o2;
    o2 > s2 ? e24.scale(1, s2 / o2) : s2 > o2 && (l2 = s2, e24.scale(o2 / s2, 1)), e24.beginPath(), e24.arc(0, 0, l2 / 2, 0, w, false), e24[c2](), a2 && e24.stroke(), e24.restore();
  }
  function Kr(e24, t2, n2, r2, i2) {
    e24.save();
    let { stroke: a2, xSize: o2, ySize: s2, opName: c2 } = this.commonRenderProps(e24, t2, n2, i2, r2), l2 = o2 / 2, u2 = s2 / 2;
    e24[`${c2}Rect`](-l2, -u2, o2, s2), a2 && e24.strokeRect(-l2, -u2, o2, s2), e24.restore();
  }
  var q = class {
    constructor(e24) {
      i(this, `visible`, true), i(this, `actionName`, ue), i(this, `angle`, 0), i(this, `x`, 0), i(this, `y`, 0), i(this, `offsetX`, 0), i(this, `offsetY`, 0), i(this, `sizeX`, 0), i(this, `sizeY`, 0), i(this, `touchSizeX`, 0), i(this, `touchSizeY`, 0), i(this, `cursorStyle`, `crosshair`), i(this, `withConnection`, false), Object.assign(this, e24);
    }
    getTransformAnchorPoint() {
      var e24;
      return (e24 = this.transformAnchorPoint) == null ? new N(0.5 - this.x, 0.5 - this.y) : e24;
    }
    shouldActivate(e24, t2, n2, { tl: r2, tr: i2, br: a2, bl: o2 }) {
      var s2;
      return ((s2 = t2.canvas) == null ? void 0 : s2.getActiveObject()) === t2 && t2.isControlVisible(e24) && Pr.isPointInPolygon(n2, [r2, i2, a2, o2]);
    }
    getActionHandler(e24, t2, n2) {
      return this.actionHandler;
    }
    getMouseDownHandler(e24, t2, n2) {
      return this.mouseDownHandler;
    }
    getMouseUpHandler(e24, t2, n2) {
      return this.mouseUpHandler;
    }
    cursorStyleHandler(e24, t2, n2, r2) {
      return t2.cursorStyle;
    }
    getActionName(e24, t2, n2) {
      return t2.actionName;
    }
    getVisibility(e24, t2) {
      var n2, r2;
      return (n2 = (r2 = e24._controlsVisibility) == null ? void 0 : r2[t2]) == null ? this.visible : n2;
    }
    setVisibility(e24, t2, n2) {
      this.visible = e24;
    }
    positionHandler(e24, t2, n2, r2) {
      return new N(this.x * e24.x + this.offsetX, this.y * e24.y + this.offsetY).transform(t2);
    }
    calcCornerCoords(e24, t2, n2, r2, i2, a2) {
      let o2 = Re([Ue(n2, r2), We({ angle: e24 }), Ge((i2 ? this.touchSizeX : this.sizeX) || t2, (i2 ? this.touchSizeY : this.sizeY) || t2)]);
      return { tl: new N(-0.5, -0.5).transform(o2), tr: new N(0.5, -0.5).transform(o2), br: new N(0.5, 0.5).transform(o2), bl: new N(-0.5, 0.5).transform(o2) };
    }
    commonRenderProps(e24, t2, n2, r2, i2 = {}) {
      let { cornerSize: a2, cornerColor: o2, transparentCorners: s2, cornerStrokeColor: c2 } = i2, l2 = a2 || r2.cornerSize, u2 = this.sizeX || l2, d2 = this.sizeY || l2, f2 = s2 === void 0 ? r2.transparentCorners : s2, p2 = f2 ? he : j, m = c2 || r2.cornerStrokeColor, h2 = !f2 && !!m;
      return e24.fillStyle = o2 || r2.cornerColor || ``, e24.strokeStyle = m || ``, e24.translate(t2, n2), e24.rotate(I(r2.getTotalAngle())), { stroke: h2, xSize: u2, ySize: d2, transparentCorners: f2, opName: p2 };
    }
    render(e24, t2, n2, r2, i2) {
      ((r2 = r2 || {}).cornerStyle || i2.cornerStyle) === `circle` ? Gr.call(this, e24, t2, n2, r2, i2) : Kr.call(this, e24, t2, n2, r2, i2);
    }
  };
  var qr = (e24, t2, n2) => n2.lockRotation ? Jt : t2.cursorStyle;
  var Jr = Rr(ae, zr((e24, { target: t2, ex: n2, ey: r2, theta: i2, originX: a2, originY: o2 }, s2, c2) => {
    let l2 = t2.getPositionByOrigin(a2, o2);
    if (Zt(t2, `lockRotation`)) return false;
    let u2 = Math.atan2(r2 - l2.y, n2 - l2.x), d2 = Ie(Math.atan2(c2 - l2.y, s2 - l2.x) - u2 + i2);
    if (t2.snapAngle && t2.snapAngle > 0) {
      let e25 = t2.snapAngle, n3 = t2.snapThreshold || e25, r3 = Math.ceil(d2 / e25) * e25, i3 = Math.floor(d2 / e25) * e25;
      Math.abs(d2 - i3) < n3 ? d2 = i3 : Math.abs(d2 - r3) < n3 && (d2 = r3);
    }
    d2 < 0 && (d2 = 360 + d2), d2 %= 360;
    let f2 = t2.angle !== d2;
    return t2.angle = d2, f2;
  }));
  function Yr(e24, t2) {
    let n2 = t2.canvas, r2 = e24[n2.uniScaleKey];
    return n2.uniformScaling && !r2 || !n2.uniformScaling && r2;
  }
  function Xr(e24, t2, n2) {
    let r2 = Zt(e24, `lockScalingX`), i2 = Zt(e24, `lockScalingY`);
    if (r2 && i2 || !t2 && (r2 || i2) && n2 || r2 && t2 === `x` || i2 && t2 === `y`) return true;
    let { width: a2, height: o2, strokeWidth: s2 } = e24;
    return a2 === 0 && s2 === 0 && t2 !== `y` || o2 === 0 && s2 === 0 && t2 !== `x`;
  }
  var Zr = [`e`, `se`, `s`, `sw`, `w`, `nw`, `n`, `ne`, `e`];
  var Qr = (e24, t2, n2, r2) => {
    let i2 = Yr(e24, n2);
    return Xr(n2, t2.x !== 0 && t2.y === 0 ? `x` : t2.x === 0 && t2.y !== 0 ? `y` : ``, i2) ? Jt : `${Zr[$t(n2, 0, r2)]}-resize`;
  };
  function $r(e24, t2, n2, r2, i2 = {}) {
    let a2 = t2.target, o2 = i2.by, s2 = Yr(e24, a2), c2, l2, u2, d2, f2, p2;
    if (Xr(a2, o2, s2)) return false;
    if (t2.gestureScale) l2 = t2.scaleX * t2.gestureScale, u2 = t2.scaleY * t2.gestureScale;
    else {
      if (c2 = en(t2, t2.originX, t2.originY, n2, r2), f2 = o2 === `y` ? 1 : Math.sign(c2.x || t2.signX || 1), p2 = o2 === `x` ? 1 : Math.sign(c2.y || t2.signY || 1), t2.signX || (t2.signX = f2), t2.signY || (t2.signY = p2), Zt(a2, `lockScalingFlip`) && (t2.signX !== f2 || t2.signY !== p2)) return false;
      if (d2 = a2._getTransformedDimensions(), s2 && !o2) {
        let e25 = Math.abs(c2.x) + Math.abs(c2.y), { original: n3 } = t2, r3 = e25 / (Math.abs(d2.x * n3.scaleX / a2.scaleX) + Math.abs(d2.y * n3.scaleY / a2.scaleY));
        l2 = n3.scaleX * r3, u2 = n3.scaleY * r3;
      } else l2 = Math.abs(c2.x * a2.scaleX / d2.x), u2 = Math.abs(c2.y * a2.scaleY / d2.y);
      Yt(t2) && (l2 *= 2, u2 *= 2), t2.signX !== f2 && o2 !== `y` && (t2.originX = Xt(t2.originX), l2 *= -1, t2.signX = f2), t2.signY !== p2 && o2 !== `x` && (t2.originY = Xt(t2.originY), u2 *= -1, t2.signY = p2);
    }
    let m = a2.scaleX, h2 = a2.scaleY;
    return o2 ? (o2 === `x` && a2.set(`scaleX`, l2), o2 === `y` && a2.set(`scaleY`, u2)) : (!Zt(a2, `lockScalingX`) && a2.set(`scaleX`, l2), !Zt(a2, `lockScalingY`) && a2.set(`scaleY`, u2)), m !== a2.scaleX || h2 !== a2.scaleY;
  }
  var ei = Rr(ie, zr((e24, t2, n2, r2) => $r(e24, t2, n2, r2)));
  var ti = Rr(ie, zr((e24, t2, n2, r2) => $r(e24, t2, n2, r2, { by: `x` })));
  var ni = Rr(ie, zr((e24, t2, n2, r2) => $r(e24, t2, n2, r2, { by: `y` })));
  var ri = { x: { counterAxis: `y`, scale: de, skew: pe, lockSkewing: `lockSkewingX`, origin: `originX`, flip: `flipX` }, y: { counterAxis: `x`, scale: fe, skew: me, lockSkewing: `lockSkewingY`, origin: `originY`, flip: `flipY` } };
  var ii = [`ns`, `nesw`, `ew`, `nwse`];
  var ai = (e24, t2, n2, r2) => t2.x !== 0 && Zt(n2, `lockSkewingY`) || t2.y !== 0 && Zt(n2, `lockSkewingX`) ? Jt : `${ii[$t(n2, 0, r2) % 4]}-resize`;
  function oi(e24, t2, n2, r2, i2) {
    let { target: a2 } = n2, { counterAxis: o2, origin: s2, lockSkewing: c2, skew: l2, flip: u2 } = ri[e24];
    if (Zt(a2, c2)) return false;
    let { origin: d2, flip: f2 } = ri[o2], p2 = W(n2[d2]) * (a2[f2] ? -1 : 1), m = -Math.sign(p2) * (a2[u2] ? -1 : 1), h2 = -(a2[l2] === 0 && en(n2, `center`, `center`, r2, i2)[e24] > 0 || a2[l2] > 0 ? 1 : -1) * m * 0.5 + 0.5;
    return Rr(A, zr((t3, n3, r3, i3) => function(e25, { target: t4, ex: n4, ey: r4, skewingSide: i4, ...a3 }, o3) {
      let { skew: s3 } = ri[e25], c3 = o3.subtract(new N(n4, r4)).divide(new N(t4.scaleX, t4.scaleY))[e25], l3 = t4[s3], u3 = a3[s3], d3 = Math.tan(I(u3)), f3 = e25 === `y` ? t4._getTransformedDimensions({ scaleX: 1, scaleY: 1, skewX: 0 }).x : t4._getTransformedDimensions({ scaleX: 1, scaleY: 1 }).y, p3 = 2 * c3 * i4 / Math.max(f3, 1) + d3, m2 = Ie(Math.atan(p3));
      t4.set(s3, m2);
      let h3 = l3 !== t4[s3];
      if (h3 && e25 === `y`) {
        let { skewX: e26, scaleX: n5 } = t4, r5 = t4._getTransformedDimensions({ skewY: l3 }), i5 = t4._getTransformedDimensions(), a4 = e26 === 0 ? 1 : r5.x / i5.x;
        a4 !== 1 && t4.set(`scaleX`, a4 * n5);
      }
      return h3;
    }(e24, n3, new N(r3, i3))))(t2, { ...n2, [s2]: h2, skewingSide: m }, r2, i2);
  }
  var si = (e24, t2, n2, r2) => oi(`x`, e24, t2, n2, r2);
  var ci = (e24, t2, n2, r2) => oi(`y`, e24, t2, n2, r2);
  function li(e24, t2) {
    return e24[t2.canvas.altActionKey];
  }
  var ui = (e24, t2, n2) => {
    let r2 = li(e24, n2);
    return t2.x === 0 ? r2 ? pe : fe : t2.y === 0 ? r2 ? me : de : ``;
  };
  var di = (e24, t2, n2, r2) => li(e24, n2) ? ai(0, t2, n2, r2) : Qr(e24, t2, n2, r2);
  var fi = (e24, t2, n2, r2) => li(e24, t2.target) ? ci(e24, t2, n2, r2) : ti(e24, t2, n2, r2);
  var pi = (e24, t2, n2, r2) => li(e24, t2.target) ? si(e24, t2, n2, r2) : ni(e24, t2, n2, r2);
  var mi = () => ({ ml: new q({ x: -0.5, y: 0, cursorStyleHandler: di, actionHandler: fi, getActionName: ui }), mr: new q({ x: 0.5, y: 0, cursorStyleHandler: di, actionHandler: fi, getActionName: ui }), mb: new q({ x: 0, y: 0.5, cursorStyleHandler: di, actionHandler: pi, getActionName: ui }), mt: new q({ x: 0, y: -0.5, cursorStyleHandler: di, actionHandler: pi, getActionName: ui }), tl: new q({ x: -0.5, y: -0.5, cursorStyleHandler: Qr, actionHandler: ei }), tr: new q({ x: 0.5, y: -0.5, cursorStyleHandler: Qr, actionHandler: ei }), bl: new q({ x: -0.5, y: 0.5, cursorStyleHandler: Qr, actionHandler: ei }), br: new q({ x: 0.5, y: 0.5, cursorStyleHandler: Qr, actionHandler: ei }), mtr: new q({ x: 0, y: -0.5, actionHandler: Jr, cursorStyleHandler: qr, offsetY: -40, withConnection: true, actionName: oe }) });
  var hi = () => ({ mr: new q({ x: 0.5, y: 0, actionHandler: Ur, cursorStyleHandler: di, actionName: se }), ml: new q({ x: -0.5, y: 0, actionHandler: Ur, cursorStyleHandler: di, actionName: se }) });
  var gi = () => ({ ...mi(), ...hi() });
  var _i = class e8 extends Ir {
    static getDefaults() {
      return { ...super.getDefaults(), ...e8.ownDefaults };
    }
    constructor(t2) {
      super(), Object.assign(this, this.constructor.createControls(), e8.ownDefaults), this.setOptions(t2);
    }
    static createControls() {
      return { controls: mi() };
    }
    _updateCacheCanvas() {
      let e24 = this.canvas;
      if (this.noScaleCache && e24 && e24._currentTransform) {
        let t2 = e24._currentTransform, n2 = t2.target, r2 = t2.action;
        if (this === n2 && r2 && r2.startsWith(`scale`)) return false;
      }
      return super._updateCacheCanvas();
    }
    getActiveControl() {
      let e24 = this.__corner;
      return e24 ? { key: e24, control: this.controls[e24], coord: this.oCoords[e24] } : void 0;
    }
    findControl(e24, t2 = false) {
      if (!this.hasControls || !this.canvas) return;
      this.__corner = void 0;
      let n2 = Object.entries(this.oCoords);
      for (let r2 = n2.length - 1; r2 >= 0; r2--) {
        let [i2, a2] = n2[r2], o2 = this.controls[i2];
        if (o2.shouldActivate(i2, this, e24, t2 ? a2.touchCorner : a2.corner)) return this.__corner = i2, { key: i2, control: o2, coord: this.oCoords[i2] };
      }
    }
    calcOCoords() {
      let e24 = this.getViewportTransform(), t2 = Be(e24), n2 = Ve(e24), r2 = this.getCenterPoint(), i2 = z(z(e24, z(Ue(r2.x, r2.y), We({ angle: this.getTotalAngle() - (this.group && this.flipX ? 180 : 0) }))), [1 / t2, 0, 0, 1 / n2, 0, 0]), a2 = this.group ? He(this.calcTransformMatrix()) : void 0;
      a2 && (a2.scaleX = Math.abs(a2.scaleX), a2.scaleY = Math.abs(a2.scaleY));
      let o2 = this._calculateCurrentDimensions(a2), s2 = {};
      return this.forEachControl((e25, t3) => {
        let n3 = e25.positionHandler(o2, i2, this, e25);
        s2[t3] = Object.assign(n3, this._calcCornerCoords(e25, n3));
      }), s2;
    }
    _calcCornerCoords(e24, t2) {
      let n2 = this.getTotalAngle();
      return { corner: e24.calcCornerCoords(n2, this.cornerSize, t2.x, t2.y, false, this), touchCorner: e24.calcCornerCoords(n2, this.touchCornerSize, t2.x, t2.y, true, this) };
    }
    setCoords() {
      super.setCoords(), this.canvas && (this.oCoords = this.calcOCoords());
    }
    forEachControl(e24) {
      for (let t2 in this.controls) e24(this.controls[t2], t2, this);
    }
    drawSelectionBackground(e24) {
      if (!this.selectionBackgroundColor || this.canvas && this.canvas._activeObject !== this) return;
      e24.save();
      let t2 = this.getRelativeCenterPoint(), n2 = this._calculateCurrentDimensions(), r2 = this.getViewportTransform();
      e24.translate(t2.x, t2.y), e24.scale(1 / r2[0], 1 / r2[3]), e24.rotate(I(this.angle)), e24.fillStyle = this.selectionBackgroundColor, e24.fillRect(-n2.x / 2, -n2.y / 2, n2.x, n2.y), e24.restore();
    }
    strokeBorders(e24, t2) {
      e24.strokeRect(-t2.x / 2, -t2.y / 2, t2.x, t2.y);
    }
    _drawBorders(e24, t2, n2 = {}) {
      let r2 = { hasControls: this.hasControls, borderColor: this.borderColor, borderDashArray: this.borderDashArray, ...n2 };
      e24.save(), e24.strokeStyle = r2.borderColor, this._setLineDash(e24, r2.borderDashArray), this.strokeBorders(e24, t2), r2.hasControls && this.drawControlsConnectingLines(e24, t2), e24.restore();
    }
    _renderControls(e24, t2 = {}) {
      let { hasBorders: n2, hasControls: r2 } = this, i2 = { hasBorders: n2, hasControls: r2, ...t2 }, a2 = this.getViewportTransform(), o2 = i2.hasBorders, s2 = i2.hasControls, c2 = He(z(a2, this.calcTransformMatrix()));
      e24.save(), e24.translate(c2.translateX, c2.translateY), e24.lineWidth = this.borderScaleFactor, this.group === this.parent && (e24.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1), this.flipX && (c2.angle -= 180);
      let l2 = ze(a2);
      e24.rotate(this.group ? I(c2.angle) : I(this.angle) + l2), o2 && this.drawBorders(e24, c2, t2), s2 && this.drawControls(e24, t2), e24.restore();
    }
    drawBorders(e24, t2, n2) {
      let r2;
      if (n2 && n2.forActiveSelection || this.group) {
        let e25 = At(this.width, this.height, Ye(t2)), n3 = this.isStrokeAccountedForInDimensions() ? we : (this.strokeUniform ? new N().scalarAdd(this.canvas ? this.canvas.getZoom() : 1) : new N(t2.scaleX, t2.scaleY)).scalarMultiply(this.strokeWidth);
        r2 = e25.add(n3).scalarAdd(this.borderScaleFactor).scalarAdd(2 * this.padding);
      } else r2 = this._calculateCurrentDimensions().scalarAdd(this.borderScaleFactor);
      this._drawBorders(e24, r2, n2);
    }
    drawControlsConnectingLines(e24, t2) {
      let n2 = false;
      e24.beginPath(), this.forEachControl((r2, i2) => {
        r2.withConnection && r2.getVisibility(this, i2) && (n2 = true, e24.moveTo(r2.x * t2.x, r2.y * t2.y), e24.lineTo(r2.x * t2.x + r2.offsetX, r2.y * t2.y + r2.offsetY));
      }), n2 && e24.stroke();
    }
    drawControls(e24, t2 = {}) {
      e24.save();
      let n2 = this.getCanvasRetinaScaling(), { cornerStrokeColor: r2, cornerDashArray: i2, cornerColor: a2 } = this, o2 = { cornerStrokeColor: r2, cornerDashArray: i2, cornerColor: a2, ...t2 };
      e24.setTransform(n2, 0, 0, n2, 0, 0), e24.strokeStyle = e24.fillStyle = o2.cornerColor, this.transparentCorners || (e24.strokeStyle = o2.cornerStrokeColor), this._setLineDash(e24, o2.cornerDashArray), this.forEachControl((t3, n3) => {
        if (t3.getVisibility(this, n3)) {
          let r3 = this.oCoords[n3];
          t3.render(e24, r3.x, r3.y, o2, this);
        }
      }), e24.restore();
    }
    isControlVisible(e24) {
      return this.controls[e24] && this.controls[e24].getVisibility(this, e24);
    }
    setControlVisible(e24, t2) {
      this._controlsVisibility || (this._controlsVisibility = {}), this._controlsVisibility[e24] = t2;
    }
    setControlsVisibility(e24 = {}) {
      Object.entries(e24).forEach(([e25, t2]) => this.setControlVisible(e25, t2));
    }
    clearContextTop(e24) {
      if (!this.canvas) return;
      let t2 = this.canvas.contextTop;
      if (!t2) return;
      let n2 = this.canvas.viewportTransform;
      t2.save(), t2.transform(n2[0], n2[1], n2[2], n2[3], n2[4], n2[5]), this.transform(t2);
      let r2 = this.width + 4, i2 = this.height + 4;
      return t2.clearRect(-r2 / 2, -i2 / 2, r2, i2), e24 || t2.restore(), t2;
    }
    onDeselect(e24) {
      return false;
    }
    onSelect(e24) {
      return false;
    }
    shouldStartDragging(e24) {
      return false;
    }
    onDragStart(e24) {
      return false;
    }
    canDrop(e24) {
      return false;
    }
    renderDragSourceEffect(e24) {
    }
    renderDropTargetEffect(e24) {
    }
  };
  function vi(e24, t2) {
    return t2.forEach((t3) => {
      Object.getOwnPropertyNames(t3.prototype).forEach((n2) => {
        n2 !== `constructor` && Object.defineProperty(e24.prototype, n2, Object.getOwnPropertyDescriptor(t3.prototype, n2) || /* @__PURE__ */ Object.create(null));
      });
    }), e24;
  }
  i(_i, `ownDefaults`, { noScaleCache: true, lockMovementX: false, lockMovementY: false, lockRotation: false, lockScalingX: false, lockScalingY: false, lockSkewingX: false, lockSkewingY: false, lockScalingFlip: false, cornerSize: 13, touchCornerSize: 24, transparentCorners: true, cornerColor: `rgb(178,204,255)`, cornerStrokeColor: ``, cornerStyle: `rect`, cornerDashArray: null, hasControls: true, borderColor: `rgb(178,204,255)`, borderDashArray: null, borderOpacityWhenMoving: 0.4, borderScaleFactor: 1, hasBorders: true, selectionBackgroundColor: ``, selectable: true, evented: true, perPixelTargetFind: false, activeOn: `down`, hoverCursor: null, moveCursor: null });
  var J = class extends _i {
  };
  vi(J, [gn]), M.setClass(J), M.setClass(J, `object`);
  var yi = (e24, t2, n2, r2) => {
    let i2 = 2 * (r2 = Math.round(r2)) + 1, { data: a2 } = e24.getImageData(t2 - r2, n2 - r2, i2, i2);
    for (let e25 = 3; e25 < a2.length; e25 += 4) if (a2[e25] > 0) return false;
    return true;
  };
  var bi = class {
    constructor(e24) {
      this.options = e24, this.strokeProjectionMagnitude = this.options.strokeWidth / 2, this.scale = new N(this.options.scaleX, this.options.scaleY), this.strokeUniformScalar = this.options.strokeUniform ? new N(1 / this.options.scaleX, 1 / this.options.scaleY) : new N(1, 1);
    }
    createSideVector(e24, t2) {
      let n2 = zt(e24, t2);
      return this.options.strokeUniform ? n2.multiply(this.scale) : n2;
    }
    projectOrthogonally(e24, t2, n2) {
      return this.applySkew(e24.add(this.calcOrthogonalProjection(e24, t2, n2)));
    }
    isSkewed() {
      return this.options.skewX !== 0 || this.options.skewY !== 0;
    }
    applySkew(e24) {
      let t2 = new N(e24);
      return t2.y += t2.x * Math.tan(I(this.options.skewY)), t2.x += t2.y * Math.tan(I(this.options.skewX)), t2;
    }
    scaleUnitVector(e24, t2) {
      return e24.multiply(this.strokeUniformScalar).scalarMultiply(t2);
    }
  };
  var xi = new N();
  var Si = class e9 extends bi {
    static getOrthogonalRotationFactor(e24, t2) {
      let n2 = t2 ? Vt(e24, t2) : Ht(e24);
      return Math.abs(n2) < S ? -1 : 1;
    }
    constructor(e24, t2, n2, r2) {
      super(r2), i(this, `AB`, void 0), i(this, `AC`, void 0), i(this, `alpha`, void 0), i(this, `bisector`, void 0), this.A = new N(e24), this.B = new N(t2), this.C = new N(n2), this.AB = this.createSideVector(this.A, this.B), this.AC = this.createSideVector(this.A, this.C), this.alpha = Vt(this.AB, this.AC), this.bisector = Ut(Rt(this.AB.eq(xi) ? this.AC : this.AB, this.alpha / 2));
    }
    calcOrthogonalProjection(t2, n2, r2 = this.strokeProjectionMagnitude) {
      let i2 = Wt(this.createSideVector(t2, n2)), a2 = e9.getOrthogonalRotationFactor(i2, this.bisector);
      return this.scaleUnitVector(i2, r2 * a2);
    }
    projectBevel() {
      let e24 = [];
      return (this.alpha % w === 0 ? [this.B] : [this.B, this.C]).forEach((t2) => {
        e24.push(this.projectOrthogonally(this.A, t2)), e24.push(this.projectOrthogonally(this.A, t2, -this.strokeProjectionMagnitude));
      }), e24;
    }
    projectMiter() {
      let e24 = [], t2 = Math.abs(this.alpha), n2 = 1 / Math.sin(t2 / 2), r2 = this.scaleUnitVector(this.bisector, -this.strokeProjectionMagnitude * n2), i2 = this.options.strokeUniform ? Bt(this.scaleUnitVector(this.bisector, this.options.strokeMiterLimit)) : this.options.strokeMiterLimit;
      return Bt(r2) / this.strokeProjectionMagnitude <= i2 && e24.push(this.applySkew(this.A.add(r2))), e24.push(...this.projectBevel()), e24;
    }
    projectRoundNoSkew(t2, n2) {
      let r2 = [], i2 = new N(e9.getOrthogonalRotationFactor(this.bisector), e9.getOrthogonalRotationFactor(new N(this.bisector.y, this.bisector.x)));
      return [new N(1, 0).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar).multiply(i2), new N(0, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar).multiply(i2)].forEach((e24) => {
        qt(e24, t2, n2) && r2.push(this.A.add(e24));
      }), r2;
    }
    projectRoundWithSkew(e24, t2) {
      let n2 = [], { skewX: r2, skewY: i2, scaleX: a2, scaleY: o2, strokeUniform: s2 } = this.options, c2 = new N(Math.tan(I(r2)), Math.tan(I(i2))), l2 = this.strokeProjectionMagnitude, u2 = s2 ? l2 / o2 / Math.sqrt(1 / o2 ** 2 + 1 / a2 ** 2 * c2.y ** 2) : l2 / Math.sqrt(1 + c2.y ** 2), d2 = new N(Math.sqrt(Math.max(l2 ** 2 - u2 ** 2, 0)), u2), f2 = s2 ? l2 / Math.sqrt(1 + c2.x ** 2 * (1 / o2) ** 2 / (1 / a2 + 1 / a2 * c2.x * c2.y) ** 2) : l2 / Math.sqrt(1 + c2.x ** 2 / (1 + c2.x * c2.y) ** 2), p2 = new N(f2, Math.sqrt(Math.max(l2 ** 2 - f2 ** 2, 0)));
      return [p2, p2.scalarMultiply(-1), d2, d2.scalarMultiply(-1)].map((e25) => this.applySkew(s2 ? e25.multiply(this.strokeUniformScalar) : e25)).forEach((r3) => {
        qt(r3, e24, t2) && n2.push(this.applySkew(this.A).add(r3));
      }), n2;
    }
    projectRound() {
      let e24 = [];
      e24.push(...this.projectBevel());
      let t2 = this.alpha % w === 0, n2 = this.applySkew(this.A), r2 = e24[t2 ? 0 : 2].subtract(n2), i2 = e24[+!!t2].subtract(n2), a2 = Gt(r2, t2 ? this.applySkew(this.AB.scalarMultiply(-1)) : this.applySkew(this.bisector.multiply(this.strokeUniformScalar).scalarMultiply(-1))) > 0, o2 = a2 ? r2 : i2, s2 = a2 ? i2 : r2;
      return this.isSkewed() ? e24.push(...this.projectRoundWithSkew(o2, s2)) : e24.push(...this.projectRoundNoSkew(o2, s2)), e24;
    }
    projectPoints() {
      switch (this.options.strokeLineJoin) {
        case `miter`:
          return this.projectMiter();
        case `round`:
          return this.projectRound();
        default:
          return this.projectBevel();
      }
    }
    project() {
      return this.projectPoints().map((e24) => ({ originPoint: this.A, projectedPoint: e24, angle: this.alpha, bisector: this.bisector }));
    }
  };
  var Ci = class extends bi {
    constructor(e24, t2, n2) {
      super(n2), this.A = new N(e24), this.T = new N(t2);
    }
    calcOrthogonalProjection(e24, t2, n2 = this.strokeProjectionMagnitude) {
      let r2 = this.createSideVector(e24, t2);
      return this.scaleUnitVector(Wt(r2), n2);
    }
    projectButt() {
      return [this.projectOrthogonally(this.A, this.T, this.strokeProjectionMagnitude), this.projectOrthogonally(this.A, this.T, -this.strokeProjectionMagnitude)];
    }
    projectRound() {
      let e24 = [];
      if (!this.isSkewed() && this.A.eq(this.T)) {
        let t2 = new N(1, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar);
        e24.push(this.applySkew(this.A.add(t2)), this.applySkew(this.A.subtract(t2)));
      } else e24.push(...new Si(this.A, this.T, this.T, this.options).projectRound());
      return e24;
    }
    projectSquare() {
      let e24 = [];
      if (this.A.eq(this.T)) {
        let t2 = new N(1, 1).scalarMultiply(this.strokeProjectionMagnitude).multiply(this.strokeUniformScalar);
        e24.push(this.A.add(t2), this.A.subtract(t2));
      } else {
        let t2 = this.calcOrthogonalProjection(this.A, this.T, this.strokeProjectionMagnitude), n2 = this.scaleUnitVector(Ut(this.createSideVector(this.A, this.T)), -this.strokeProjectionMagnitude), r2 = this.A.add(n2);
        e24.push(r2.add(t2), r2.subtract(t2));
      }
      return e24.map((e25) => this.applySkew(e25));
    }
    projectPoints() {
      switch (this.options.strokeLineCap) {
        case `round`:
          return this.projectRound();
        case `square`:
          return this.projectSquare();
        default:
          return this.projectButt();
      }
    }
    project() {
      return this.projectPoints().map((e24) => ({ originPoint: this.A, projectedPoint: e24 }));
    }
  };
  var wi = (e24, t2, n2 = false) => {
    let r2 = [];
    if (e24.length === 0) return r2;
    let i2 = e24.reduce((e25, t3) => (e25[e25.length - 1].eq(t3) || e25.push(new N(t3)), e25), [new N(e24[0])]);
    if (i2.length === 1) n2 = true;
    else if (!n2) {
      let e25 = i2[0], t3 = ((e26, t4) => {
        for (let n3 = e26.length - 1; n3 >= 0; n3--) if (t4(e26[n3], n3, e26)) return n3;
        return -1;
      })(i2, (t4) => !t4.eq(e25));
      i2.splice(t3 + 1);
    }
    return i2.forEach((e25, i3, a2) => {
      let o2, s2;
      i3 === 0 ? (s2 = a2[1], o2 = n2 ? e25 : a2[a2.length - 1]) : i3 === a2.length - 1 ? (o2 = a2[i3 - 1], s2 = n2 ? e25 : a2[0]) : (o2 = a2[i3 - 1], s2 = a2[i3 + 1]), n2 && a2.length === 1 ? r2.push(...new Ci(e25, e25, t2).project()) : !n2 || i3 !== 0 && i3 !== a2.length - 1 ? r2.push(...new Si(e25, o2, s2, t2).project()) : r2.push(...new Ci(e25, i3 === 0 ? s2 : o2, t2).project());
    }), r2;
  };
  var Ti = (e24) => {
    let t2 = {};
    return Object.keys(e24).forEach((n2) => {
      t2[n2] = {}, Object.keys(e24[n2]).forEach((r2) => {
        t2[n2][r2] = { ...e24[n2][r2] };
      });
    }), t2;
  };
  var Ei = (e24, t2, n2 = false) => e24.fill !== t2.fill || e24.stroke !== t2.stroke || e24.strokeWidth !== t2.strokeWidth || e24.fontSize !== t2.fontSize || e24.fontFamily !== t2.fontFamily || e24.fontWeight !== t2.fontWeight || e24.fontStyle !== t2.fontStyle || e24.textDecorationThickness !== t2.textDecorationThickness || e24.textDecorationColor !== t2.textDecorationColor || e24.textBackgroundColor !== t2.textBackgroundColor || e24.deltaY !== t2.deltaY || n2 && (e24.overline !== t2.overline || e24.underline !== t2.underline || e24.linethrough !== t2.linethrough);
  var Di = (e24, t2) => {
    let n2 = t2.split(`
`), r2 = [], i2 = -1, a2 = {};
    e24 = Ti(e24);
    for (let t3 = 0; t3 < n2.length; t3++) {
      let o2 = gt(n2[t3]);
      if (e24[t3]) for (let n3 = 0; n3 < o2.length; n3++) {
        i2++;
        let o3 = e24[t3][n3];
        o3 && Object.keys(o3).length > 0 && (Ei(a2, o3, true) ? r2.push({ start: i2, end: i2 + 1, style: o3 }) : r2[r2.length - 1].end++), a2 = o3 || {};
      }
      else i2 += o2.length, a2 = {};
    }
    return r2;
  };
  var Oi = (e24, t2) => {
    if (!Array.isArray(e24)) return Ti(e24);
    let n2 = t2.split(ne), r2 = {}, i2 = -1, a2 = 0;
    for (let t3 = 0; t3 < n2.length; t3++) {
      let o2 = gt(n2[t3]);
      for (let n3 = 0; n3 < o2.length; n3++) i2++, e24[a2] && e24[a2].start <= i2 && i2 < e24[a2].end && (r2[t3] = r2[t3] || {}, r2[t3][n3] = { ...e24[a2].style }, i2 === e24[a2].end - 1 && a2++);
    }
    return r2;
  };
  var ki = [`display`, `transform`, j, `fill-opacity`, `fill-rule`, `opacity`, he, `stroke-dasharray`, `stroke-linecap`, `stroke-dashoffset`, `stroke-linejoin`, `stroke-miterlimit`, `stroke-opacity`, `stroke-width`, `id`, `paint-order`, `vector-effect`, `instantiated_by_use`, `clip-path`];
  function Ai(e24, t2) {
    let n2 = e24.nodeName, r2 = e24.getAttribute(`class`), i2 = e24.getAttribute(`id`), a2 = `(?![a-zA-Z\\-]+)`, o2;
    if (o2 = RegExp(`^` + n2, `i`), t2 = t2.replace(o2, ``), i2 && t2.length && (o2 = RegExp(`#` + i2 + a2, `i`), t2 = t2.replace(o2, ``)), r2 && t2.length) {
      let e25 = r2.split(` `);
      for (let n3 = e25.length; n3--; ) o2 = RegExp(`\\.` + e25[n3] + a2, `i`), t2 = t2.replace(o2, ``);
    }
    return t2.length === 0;
  }
  function ji(e24, t2) {
    let n2 = true, r2 = Ai(e24, t2.pop());
    return r2 && t2.length && (n2 = function(e25, t3) {
      let n3, r3 = true;
      for (; e25.parentElement && e25.parentElement.nodeType === 1 && t3.length; ) r3 && (n3 = t3.pop()), r3 = Ai(e25 = e25.parentElement, n3);
      return t3.length === 0;
    }(e24, t2)), r2 && n2 && t2.length === 0;
  }
  function Mi(e24, t2 = {}) {
    let n2 = {};
    for (let r2 in t2) ji(e24, r2.split(` `)) && (n2 = { ...n2, ...t2[r2] });
    return n2;
  }
  var Ni = (e24) => {
    var t2;
    return (t2 = jn[e24]) == null ? e24 : t2;
  };
  var Pi = RegExp(`(${Dn})`, `gi`);
  var Y = `(${Dn})`;
  var Fi = String.raw`(skewX)\(${Y}\)`;
  var Ii = String.raw`(skewY)\(${Y}\)`;
  var Li = String.raw`(rotate)\(${Y}(?: ${Y} ${Y})?\)`;
  var Ri = String.raw`(scale)\(${Y}(?: ${Y})?\)`;
  var zi = String.raw`(translate)\(${Y}(?: ${Y})?\)`;
  var Bi = `(?:${String.raw`(matrix)\(${Y} ${Y} ${Y} ${Y} ${Y} ${Y}\)`}|${zi}|${Li}|${Ri}|${Fi}|${Ii})`;
  var Vi = `(?:${Bi}*)`;
  var Hi = String.raw`^\s*(?:${Vi}?)\s*$`;
  var Ui = new RegExp(Hi);
  var Wi = new RegExp(Bi);
  var Gi = new RegExp(Bi, `g`);
  function Ki(e24) {
    let t2 = [];
    if (!(e24 = ((e25) => on(e25.replace(Pi, ` $1 `).replace(/,/gi, ` `)))(e24).replace(/\s*([()])\s*/gi, `$1`)) || e24 && !Ui.test(e24)) return [...T];
    for (let n2 of e24.matchAll(Gi)) {
      let e25 = Wi.exec(n2[0]);
      if (!e25) continue;
      let r2 = T, [, i2, ...a2] = e25.filter((e26) => !!e26), [o2, s2, c2, l2, u2, d2] = a2.map((e26) => parseFloat(e26));
      switch (i2) {
        case `translate`:
          r2 = Ue(o2, s2);
          break;
        case oe:
          r2 = We({ angle: o2 }, { x: s2, y: c2 });
          break;
        case ue:
          r2 = Ge(o2, s2);
          break;
        case pe:
          r2 = qe(o2);
          break;
        case me:
          r2 = Je(o2);
          break;
        case `matrix`:
          r2 = [o2, s2, c2, l2, u2, d2];
      }
      t2.push(r2);
    }
    return Re(t2);
  }
  function qi(e24, t2, n2, r2) {
    let i2 = Array.isArray(t2), a2, o2 = t2;
    if (e24 !== `fill` && e24 !== `stroke` || t2 !== `none`) {
      if (e24 === `strokeUniform`) return t2 === `non-scaling-stroke`;
      if (e24 === `strokeDashArray`) o2 = t2 === `none` ? null : t2.replace(/,/g, ` `).split(/\s+/).map(parseFloat);
      else if (e24 === `transformMatrix`) o2 = n2 && n2.transformMatrix ? z(n2.transformMatrix, Ki(t2)) : Ki(t2);
      else if (e24 === `visible`) o2 = t2 !== `none` && t2 !== `hidden`, n2 && false === n2.visible && (o2 = false);
      else if (e24 === `opacity`) o2 = parseFloat(t2), n2 && n2.opacity !== void 0 && (o2 *= n2.opacity);
      else if (e24 === `textAnchor`) o2 = t2 === `start` ? D : t2 === `end` ? k : E;
      else if (e24 === `charSpacing` || e24 === `textDecorationThickness`) a2 = K(t2, r2) / r2 * 1e3;
      else if (e24 === `paintFirst`) {
        let e25 = t2.indexOf(j), n3 = t2.indexOf(he);
        o2 = j, (e25 > -1 && n3 > -1 && n3 < e25 || e25 === -1 && n3 > -1) && (o2 = he);
      } else {
        if (e24 === `href` || e24 === `xlink:href` || e24 === `font` || e24 === `id`) return t2;
        if (e24 === `imageSmoothing`) return t2 === `optimizeQuality`;
        a2 = i2 ? t2.map(K) : K(t2, r2);
      }
    } else o2 = ``;
    return !i2 && isNaN(a2) ? o2 : a2;
  }
  function Ji(e24, t2) {
    e24.replace(/;\s*$/, ``).split(`;`).forEach((e25) => {
      if (!e25) return;
      let [n2, r2] = e25.split(`:`);
      t2[n2.trim().toLowerCase()] = r2.trim();
    });
  }
  function Yi(e24) {
    let t2 = {}, n2 = e24.getAttribute(`style`);
    return n2 && (typeof n2 == `string` ? Ji(n2, t2) : function(e25, t3) {
      Object.entries(e25).forEach(([e26, n3]) => {
        n3 !== void 0 && (t3[e26.toLowerCase()] = n3);
      });
    }(n2, t2)), t2;
  }
  var Xi = { stroke: `strokeOpacity`, fill: `fillOpacity` };
  function Zi(e24, t2, n2) {
    if (!e24) return {};
    let r2, i2 = {}, a2 = 16;
    e24.parentNode && In.test(e24.parentNode.nodeName) && (i2 = Zi(e24.parentElement, t2, n2), i2.fontSize && (r2 = a2 = K(i2.fontSize)));
    let o2 = { ...t2.reduce((t3, n3) => {
      let r3 = e24.getAttribute(n3);
      return r3 && (t3[n3] = r3), t3;
    }, {}), ...Mi(e24, n2), ...Yi(e24) };
    o2[`clip-path`] && e24.setAttribute(Nn, o2[Nn]), o2[`font-size`] && (r2 = K(o2[Mn], a2), o2[Mn] = `${r2}`);
    let s2 = {};
    for (let e25 in o2) {
      let t3 = Ni(e25);
      s2[t3] = qi(t3, o2[e25], i2, r2);
    }
    s2 && s2.font && function(e25, t3) {
      let n3 = e25.match(An);
      if (!n3) return;
      let r3 = n3[1], i3 = n3[3], a3 = n3[4], o3 = n3[5], s3 = n3[6];
      r3 && (t3.fontStyle = r3), i3 && (t3.fontWeight = isNaN(parseFloat(i3)) ? i3 : parseFloat(i3)), a3 && (t3.fontSize = K(a3)), s3 && (t3.fontFamily = s3), o3 && (t3.lineHeight = o3 === `normal` ? 1 : o3);
    }(s2.font, s2);
    let c2 = { ...i2, ...s2 };
    return In.test(e24.nodeName) ? c2 : function(e25) {
      let t3 = J.getDefaults();
      return Object.entries(Xi).forEach(([n3, r3]) => {
        if (e25[r3] === void 0 || e25[n3] === ``) return;
        if (e25[n3] === void 0) {
          if (!t3[n3]) return;
          e25[n3] = t3[n3];
        }
        if (e25[n3].indexOf(`url(`) === 0) return;
        let i3 = new G(e25[n3]);
        e25[n3] = i3.setAlpha(B(i3.getAlpha() * e25[r3], 2)).toRgba();
      }), e25;
    }(c2);
  }
  var Qi = [`rx`, `ry`];
  var $i = class e10 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e10.ownDefaults };
    }
    constructor(t2) {
      super(), Object.assign(this, e10.ownDefaults), this.setOptions(t2), this._initRxRy();
    }
    _initRxRy() {
      let { rx: e24, ry: t2 } = this;
      e24 && !t2 ? this.ry = e24 : t2 && !e24 && (this.rx = t2);
    }
    _render(e24) {
      let { width: t2, height: n2 } = this, r2 = -t2 / 2, i2 = -n2 / 2, a2 = this.rx ? Math.min(this.rx, t2 / 2) : 0, o2 = this.ry ? Math.min(this.ry, n2 / 2) : 0, s2 = a2 !== 0 || o2 !== 0;
      e24.beginPath(), e24.moveTo(r2 + a2, i2), e24.lineTo(r2 + t2 - a2, i2), s2 && e24.bezierCurveTo(r2 + t2 - 0.4477152502 * a2, i2, r2 + t2, i2 + 0.4477152502 * o2, r2 + t2, i2 + o2), e24.lineTo(r2 + t2, i2 + n2 - o2), s2 && e24.bezierCurveTo(r2 + t2, i2 + n2 - 0.4477152502 * o2, r2 + t2 - 0.4477152502 * a2, i2 + n2, r2 + t2 - a2, i2 + n2), e24.lineTo(r2 + a2, i2 + n2), s2 && e24.bezierCurveTo(r2 + 0.4477152502 * a2, i2 + n2, r2, i2 + n2 - 0.4477152502 * o2, r2, i2 + n2 - o2), e24.lineTo(r2, i2 + o2), s2 && e24.bezierCurveTo(r2, i2 + 0.4477152502 * o2, r2 + 0.4477152502 * a2, i2, r2 + a2, i2), e24.closePath(), this._renderPaintInOrder(e24);
    }
    toObject(e24 = []) {
      return super.toObject([...Qi, ...e24]);
    }
    _toSVG() {
      let { width: e24, height: t2, rx: n2, ry: r2 } = this;
      return [`<rect `, `COMMON_PARTS`, `x="${-e24 / 2}" y="${-t2 / 2}" rx="${U(n2)}" ry="${U(r2)}" width="${U(e24)}" height="${U(t2)}" />
`];
    }
    static async fromElement(e24, t2, n2) {
      let { left: r2 = 0, top: i2 = 0, width: a2 = 0, height: o2 = 0, visible: s2 = true, ...c2 } = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return new this({ ...t2, ...c2, left: r2, top: i2, width: a2, height: o2, visible: !!(s2 && a2 && o2) });
    }
  };
  i($i, `type`, `Rect`), i($i, `cacheProperties`, [...Un, ...Qi]), i($i, `ownDefaults`, { rx: 0, ry: 0 }), i($i, `ATTRIBUTE_NAMES`, [...ki, `x`, `y`, `rx`, `ry`, `width`, `height`]), M.setClass($i), M.setSVGClass($i);
  var ea = `initialization`;
  var ta = `added`;
  var na = (e24, t2) => {
    let { strokeUniform: n2, strokeWidth: r2, width: i2, height: a2, group: o2 } = t2, s2 = o2 && o2 !== e24 ? jt(o2.calcTransformMatrix(), e24.calcTransformMatrix()) : null, c2 = s2 ? t2.getRelativeCenterPoint().transform(s2) : t2.getRelativeCenterPoint(), l2 = !t2.isStrokeAccountedForInDimensions(), u2 = n2 && l2 ? Nt(new N(r2, r2), void 0, e24.calcTransformMatrix()) : we, d2 = !n2 && l2 ? r2 : 0, f2 = At(i2 + d2, a2 + d2, Re([s2, t2.calcOwnMatrix()], true)).add(u2).scalarDivide(2);
    return [c2.subtract(f2), c2.add(f2)];
  };
  var ra = class {
    calcLayoutResult(e24, t2) {
      if (this.shouldPerformLayout(e24)) return this.calcBoundingBox(t2, e24);
    }
    shouldPerformLayout({ type: e24, prevStrategy: t2, strategy: n2 }) {
      return e24 === `initialization` || e24 === `imperative` || !!t2 && n2 !== t2;
    }
    shouldLayoutClipPath({ type: e24, target: { clipPath: t2 } }) {
      return e24 !== `initialization` && t2 && !t2.absolutePositioned;
    }
    getInitialSize(e24, t2) {
      return t2.size;
    }
    calcBoundingBox(e24, t2) {
      let { type: n2, target: r2 } = t2;
      if (n2 === `imperative` && t2.overrides) return t2.overrides;
      if (e24.length === 0) return;
      let { left: i2, top: a2, width: o2, height: s2 } = wt(e24.map((e25) => na(r2, e25)).reduce((e25, t3) => e25.concat(t3), [])), c2 = new N(o2, s2), l2 = new N(i2, a2).add(c2.scalarDivide(2));
      if (n2 === `initialization`) {
        let e25 = this.getInitialSize(t2, { size: c2, center: l2 });
        return { center: l2, relativeCorrection: new N(0, 0), size: e25 };
      }
      return { center: l2.transform(r2.calcOwnMatrix()), size: c2 };
    }
  };
  i(ra, `type`, `strategy`);
  var ia = class extends ra {
    shouldPerformLayout(e24) {
      return true;
    }
  };
  i(ia, `type`, `fit-content`), M.setClass(ia);
  var aa = `layoutManager`;
  var oa = class {
    constructor(e24 = new ia()) {
      i(this, `strategy`, void 0), this.strategy = e24, this._subscriptions = /* @__PURE__ */ new Map();
    }
    performLayout(e24) {
      let t2 = { bubbles: true, strategy: this.strategy, ...e24, prevStrategy: this._prevLayoutStrategy, stopPropagation() {
        this.bubbles = false;
      } };
      this.onBeforeLayout(t2);
      let n2 = this.getLayoutResult(t2);
      n2 && this.commitLayout(t2, n2), this.onAfterLayout(t2, n2), this._prevLayoutStrategy = t2.strategy;
    }
    attachHandlers(e24, t2) {
      let { target: n2 } = t2;
      return [ge, re, se, ae, ie, A, le, ce, `modifyPath`].map((t3) => e24.on(t3, (e25) => this.performLayout(t3 === `modified` ? { type: `object_modified`, trigger: t3, e: e25, target: n2 } : { type: `object_modifying`, trigger: t3, e: e25, target: n2 })));
    }
    subscribe(e24, t2) {
      this.unsubscribe(e24, t2);
      let n2 = this.attachHandlers(e24, t2);
      this._subscriptions.set(e24, n2);
    }
    unsubscribe(e24, t2) {
      (this._subscriptions.get(e24) || []).forEach((e25) => e25()), this._subscriptions.delete(e24);
    }
    unsubscribeTargets(e24) {
      e24.targets.forEach((t2) => this.unsubscribe(t2, e24));
    }
    subscribeTargets(e24) {
      e24.targets.forEach((t2) => this.subscribe(t2, e24));
    }
    onBeforeLayout(e24) {
      let { target: t2, type: n2 } = e24, { canvas: r2 } = t2;
      if (n2 === `initialization` || n2 === `added` ? this.subscribeTargets(e24) : n2 === `removed` && this.unsubscribeTargets(e24), t2.fire(`layout:before`, { context: e24 }), r2 && r2.fire(`object:layout:before`, { target: t2, context: e24 }), n2 === `imperative` && e24.deep) {
        let { strategy: n3, ...r3 } = e24;
        t2.forEachObject((e25) => e25.layoutManager && e25.layoutManager.performLayout({ ...r3, bubbles: false, target: e25 }));
      }
    }
    getLayoutResult(e24) {
      let { target: t2, strategy: n2, type: r2 } = e24, i2 = n2.calcLayoutResult(e24, t2.getObjects());
      if (!i2) return;
      let a2 = r2 === `initialization` ? new N() : t2.getRelativeCenterPoint(), { center: o2, correction: s2 = new N(), relativeCorrection: c2 = new N() } = i2;
      return { result: i2, prevCenter: a2, nextCenter: o2, offset: a2.subtract(o2).add(s2).transform(r2 === `initialization` ? T : R(t2.calcOwnMatrix()), true).add(c2) };
    }
    commitLayout(e24, t2) {
      let { target: n2 } = e24, { result: { size: r2 }, nextCenter: i2 } = t2;
      var a2, o2;
      n2.set({ width: r2.x, height: r2.y }), this.layoutObjects(e24, t2), e24.type === `initialization` ? n2.set({ left: (a2 = e24.x) == null ? i2.x + r2.x * W(n2.originX) : a2, top: (o2 = e24.y) == null ? i2.y + r2.y * W(n2.originY) : o2 }) : (n2.setPositionByOrigin(i2, E, E), n2.setCoords(), n2.set(`dirty`, true));
    }
    layoutObjects(e24, t2) {
      let { target: n2 } = e24;
      n2.forEachObject((r2) => {
        r2.group === n2 && this.layoutObject(e24, t2, r2);
      }), e24.strategy.shouldLayoutClipPath(e24) && this.layoutObject(e24, t2, n2.clipPath);
    }
    layoutObject(e24, { offset: t2 }, n2) {
      n2.set({ left: n2.left + t2.x, top: n2.top + t2.y });
    }
    onAfterLayout(e24, t2) {
      let { target: n2, strategy: r2, bubbles: i2, prevStrategy: a2, ...o2 } = e24, { canvas: s2 } = n2;
      n2.fire(`layout:after`, { context: e24, result: t2 }), s2 && s2.fire(`object:layout:after`, { context: e24, result: t2, target: n2 });
      let c2 = n2.parent;
      i2 && c2 != null && c2.layoutManager && ((o2.path || (o2.path = [])).push(n2), c2.layoutManager.performLayout({ ...o2, target: c2 })), n2.set(`dirty`, true);
    }
    dispose() {
      let { _subscriptions: e24 } = this;
      e24.forEach((e25) => e25.forEach((e26) => e26())), e24.clear();
    }
    toObject() {
      return { type: aa, strategy: this.strategy.constructor.type };
    }
    toJSON() {
      return this.toObject();
    }
  };
  M.setClass(oa, aa);
  var sa = class extends oa {
    performLayout() {
    }
  };
  var ca = class e11 extends Ee(J) {
    static getDefaults() {
      return { ...super.getDefaults(), ...e11.ownDefaults };
    }
    constructor(t2 = [], n2 = {}) {
      super(), i(this, `_activeObjects`, []), i(this, `__objectSelectionTracker`, void 0), i(this, `__objectSelectionDisposer`, void 0), Object.assign(this, e11.ownDefaults), this.setOptions(n2), this.groupInit(t2, n2);
    }
    groupInit(e24, t2) {
      var n2;
      this._objects = [...e24], this.__objectSelectionTracker = this.__objectSelectionMonitor.bind(this, true), this.__objectSelectionDisposer = this.__objectSelectionMonitor.bind(this, false), this.forEachObject((e25) => {
        this.enterGroup(e25, false);
      }), this.layoutManager = (n2 = t2.layoutManager) == null ? new oa() : n2, this.layoutManager.performLayout({ type: ea, target: this, targets: [...e24], x: t2.left, y: t2.top });
    }
    canEnterGroup(e24) {
      return e24 === this || this.isDescendantOf(e24) ? (s(`error`, `Group: circular object trees are not supported, this call has no effect`), false) : this._objects.indexOf(e24) === -1 || (s(`error`, `Group: duplicate objects are not supported inside group, this call has no effect`), false);
    }
    _filterObjectsBeforeEnteringGroup(e24) {
      return e24.filter((e25, t2, n2) => this.canEnterGroup(e25) && n2.indexOf(e25) === t2);
    }
    add(...e24) {
      let t2 = this._filterObjectsBeforeEnteringGroup(e24), n2 = super.add(...t2);
      return this._onAfterObjectsChange(ta, t2), n2;
    }
    insertAt(e24, ...t2) {
      let n2 = this._filterObjectsBeforeEnteringGroup(t2), r2 = super.insertAt(e24, ...n2);
      return this._onAfterObjectsChange(ta, n2), r2;
    }
    remove(...e24) {
      let t2 = super.remove(...e24);
      return this._onAfterObjectsChange(`removed`, t2), t2;
    }
    _onObjectAdded(e24) {
      this.enterGroup(e24, true), this.fire(`object:added`, { target: e24 }), e24.fire(`added`, { target: this });
    }
    _onObjectRemoved(e24, t2) {
      this.exitGroup(e24, t2), this.fire(`object:removed`, { target: e24 }), e24.fire(`removed`, { target: this });
    }
    _onAfterObjectsChange(e24, t2) {
      this.layoutManager.performLayout({ type: e24, targets: t2, target: this });
    }
    _onStackOrderChanged() {
      this._set(`dirty`, true);
    }
    _set(e24, t2) {
      let n2 = this[e24];
      return super._set(e24, t2), e24 === `canvas` && n2 !== t2 && (this._objects || []).forEach((n3) => {
        n3._set(e24, t2);
      }), this;
    }
    _shouldSetNestedCoords() {
      return this.subTargetCheck;
    }
    removeAll() {
      return this._activeObjects = [], this.remove(...this._objects);
    }
    __objectSelectionMonitor(e24, { target: t2 }) {
      let n2 = this._activeObjects;
      if (e24) n2.push(t2), this._set(`dirty`, true);
      else if (n2.length > 0) {
        let e25 = n2.indexOf(t2);
        e25 > -1 && (n2.splice(e25, 1), this._set(`dirty`, true));
      }
    }
    _watchObject(e24, t2) {
      e24 && this._watchObject(false, t2), e24 ? (t2.on(`selected`, this.__objectSelectionTracker), t2.on(`deselected`, this.__objectSelectionDisposer)) : (t2.off(`selected`, this.__objectSelectionTracker), t2.off(`deselected`, this.__objectSelectionDisposer));
    }
    enterGroup(e24, t2) {
      e24.group && e24.group.remove(e24), e24._set(`parent`, this), this._enterGroup(e24, t2);
    }
    _enterGroup(e24, t2) {
      t2 && Dt(e24, z(R(this.calcTransformMatrix()), e24.calcTransformMatrix())), this._shouldSetNestedCoords() && e24.setCoords(), e24._set(`group`, this), e24._set(`canvas`, this.canvas), this._watchObject(true, e24);
      let n2 = this.canvas && this.canvas.getActiveObject && this.canvas.getActiveObject();
      n2 && (n2 === e24 || e24.isDescendantOf(n2)) && this._activeObjects.push(e24);
    }
    exitGroup(e24, t2) {
      this._exitGroup(e24, t2), e24._set(`parent`, void 0), e24._set(`canvas`, void 0);
    }
    _exitGroup(e24, t2) {
      e24._set(`group`, void 0), t2 || (Dt(e24, z(this.calcTransformMatrix(), e24.calcTransformMatrix())), e24.setCoords()), this._watchObject(false, e24);
      let n2 = this._activeObjects.length > 0 ? this._activeObjects.indexOf(e24) : -1;
      n2 > -1 && this._activeObjects.splice(n2, 1);
    }
    shouldCache() {
      let e24 = J.prototype.shouldCache.call(this);
      if (e24) {
        for (let e25 = 0; e25 < this._objects.length; e25++) if (this._objects[e25].willDrawShadow()) return this.ownCaching = false, false;
      }
      return e24;
    }
    willDrawShadow() {
      if (super.willDrawShadow()) return true;
      for (let e24 = 0; e24 < this._objects.length; e24++) if (this._objects[e24].willDrawShadow()) return true;
      return false;
    }
    isOnACache() {
      return this.ownCaching || !!this.parent && this.parent.isOnACache();
    }
    drawObject(e24, t2, n2) {
      this._renderBackground(e24);
      for (let t3 = 0; t3 < this._objects.length; t3++) {
        var r2;
        let n3 = this._objects[t3];
        (r2 = this.canvas) != null && r2.preserveObjectStacking && n3.group !== this ? (e24.save(), e24.transform(...R(this.calcTransformMatrix())), n3.render(e24), e24.restore()) : n3.group === this && n3.render(e24);
      }
      this._drawClipPath(e24, this.clipPath, n2);
    }
    setCoords() {
      super.setCoords(), this._shouldSetNestedCoords() && this.forEachObject((e24) => e24.setCoords());
    }
    triggerLayout(e24 = {}) {
      this.layoutManager.performLayout({ target: this, type: `imperative`, ...e24 });
    }
    render(e24) {
      this._transformDone = true, super.render(e24), this._transformDone = false;
    }
    __serializeObjects(e24, t2) {
      let n2 = this.includeDefaultValues;
      return this._objects.filter(function(e25) {
        return !e25.excludeFromExport;
      }).map(function(r2) {
        let i2 = r2.includeDefaultValues;
        r2.includeDefaultValues = n2;
        let a2 = r2[e24 || `toObject`](t2);
        return r2.includeDefaultValues = i2, a2;
      });
    }
    toObject(e24 = []) {
      let t2 = this.layoutManager.toObject();
      return { ...super.toObject([`subTargetCheck`, `interactive`, ...e24]), ...t2.strategy !== `fit-content` || this.includeDefaultValues ? { layoutManager: t2 } : {}, objects: this.__serializeObjects(`toObject`, e24) };
    }
    toString() {
      return `#<Group: (${this.complexity()})>`;
    }
    dispose() {
      this.layoutManager.unsubscribeTargets({ targets: this.getObjects(), target: this }), this._activeObjects = [], this.forEachObject((e24) => {
        this._watchObject(false, e24), e24.dispose();
      }), super.dispose();
    }
    _createSVGBgRect(e24) {
      if (!this.backgroundColor) return ``;
      let t2 = $i.prototype._toSVG.call(this), n2 = t2.indexOf(`COMMON_PARTS`);
      t2[n2] = `for="group" `;
      let r2 = t2.join(``);
      return e24 ? e24(r2) : r2;
    }
    _toSVG(e24) {
      let t2 = [`<g `, `COMMON_PARTS`, ` >
`], n2 = this._createSVGBgRect(e24);
      n2 && t2.push(`		`, n2);
      for (let n3 = 0; n3 < this._objects.length; n3++) t2.push(`		`, this._objects[n3].toSVG(e24));
      return t2.push(`</g>
`), t2;
    }
    getSvgStyles() {
      let e24 = this.opacity !== void 0 && this.opacity !== 1 ? `opacity: ${U(this.opacity)};` : ``, t2 = this.visible ? `` : ` visibility: hidden;`;
      return [e24, this.getSvgFilter(), t2].join(``);
    }
    toClipPathSVG(e24) {
      let t2 = [], n2 = this._createSVGBgRect(e24);
      n2 && t2.push(`	`, n2);
      for (let n3 = 0; n3 < this._objects.length; n3++) t2.push(`	`, this._objects[n3].toClipPathSVG(e24));
      return this._createBaseClipPathSVGMarkup(t2, { reviver: e24 });
    }
    static fromObject({ type: e24, objects: t2 = [], layoutManager: n2, ...r2 }, i2) {
      return Promise.all([Qe(t2, i2), $e(r2, i2)]).then(([e25, t3]) => {
        let i3 = new this(e25, { ...r2, ...t3, layoutManager: new sa() });
        return i3.layoutManager = n2 ? new (M.getClass(n2.type))(new (M.getClass(n2.strategy))()) : new oa(), i3.layoutManager.subscribeTargets({ type: ea, target: i3, targets: i3.getObjects() }), i3.setCoords(), i3;
      });
    }
  };
  i(ca, `type`, `Group`), i(ca, `ownDefaults`, { strokeWidth: 0, subTargetCheck: false, interactive: false }), M.setClass(ca);
  var la = (e24, t2) => e24 && e24.length === 1 ? e24[0] : new ca(e24, t2);
  var ua = (e24, t2) => Math.min(t2.width / e24.width, t2.height / e24.height);
  var da = (e24, t2) => Math.max(t2.width / e24.width, t2.height / e24.height);
  var fa = `\\s*,?\\s*`;
  var pa = `${fa}(${Dn})`;
  var ma = `${pa}${pa}${pa}${fa}([01])${fa}([01])${pa}${pa}`;
  var ha = { m: `l`, M: `L` };
  var ga = (e24, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2) => {
    let d2 = Se(e24), f2 = Ce(e24), p2 = Se(t2), m = Ce(t2), h2 = n2 * i2 * p2 - r2 * a2 * m + o2, g2 = r2 * i2 * p2 + n2 * a2 * m + s2;
    return [`C`, l2 + c2 * (-n2 * i2 * f2 - r2 * a2 * d2), u2 + c2 * (-r2 * i2 * f2 + n2 * a2 * d2), h2 + c2 * (n2 * i2 * m + r2 * a2 * p2), g2 + c2 * (r2 * i2 * m - n2 * a2 * p2), h2, g2];
  };
  var _a = (e24, t2, n2, r2) => {
    let i2 = Math.atan2(t2, e24), a2 = Math.atan2(r2, n2);
    return a2 >= i2 ? a2 - i2 : 2 * Math.PI - (i2 - a2);
  };
  function va(e24, t2, n2, r2, i2, a2, s2, c2) {
    let l2;
    if (o.cachesBoundsOfCurve && (l2 = [...arguments].join(), y.boundsOfCurveCache[l2])) return y.boundsOfCurveCache[l2];
    let u2 = Math.sqrt, d2 = Math.abs, f2 = [], p2 = [[0, 0], [0, 0]], m = 6 * e24 - 12 * n2 + 6 * i2, h2 = -3 * e24 + 9 * n2 - 9 * i2 + 3 * s2, g2 = 3 * n2 - 3 * e24;
    for (let e25 = 0; e25 < 2; ++e25) {
      if (e25 > 0 && (m = 6 * t2 - 12 * r2 + 6 * a2, h2 = -3 * t2 + 9 * r2 - 9 * a2 + 3 * c2, g2 = 3 * r2 - 3 * t2), d2(h2) < 1e-12) {
        if (d2(m) < 1e-12) continue;
        let e26 = -g2 / m;
        0 < e26 && e26 < 1 && f2.push(e26);
        continue;
      }
      let n3 = m * m - 4 * g2 * h2;
      if (n3 < 0) continue;
      let i3 = u2(n3), o2 = (-m + i3) / (2 * h2);
      0 < o2 && o2 < 1 && f2.push(o2);
      let s3 = (-m - i3) / (2 * h2);
      0 < s3 && s3 < 1 && f2.push(s3);
    }
    let _2 = f2.length, v2 = _2, b2 = Sa(e24, t2, n2, r2, i2, a2, s2, c2);
    for (; _2--; ) {
      let { x: e25, y: t3 } = b2(f2[_2]);
      p2[0][_2] = e25, p2[1][_2] = t3;
    }
    p2[0][v2] = e24, p2[1][v2] = t2, p2[0][v2 + 1] = s2, p2[1][v2 + 1] = c2;
    let x2 = [new N(Math.min(...p2[0]), Math.min(...p2[1])), new N(Math.max(...p2[0]), Math.max(...p2[1]))];
    return o.cachesBoundsOfCurve && (y.boundsOfCurveCache[l2] = x2), x2;
  }
  var ya = (e24, t2, [n2, r2, i2, a2, o2, s2, c2, l2]) => {
    let u2 = ((e25, t3, n3, r3, i3, a3, o3) => {
      if (n3 === 0 || r3 === 0) return [];
      let s3 = 0, c3 = 0, l3 = 0, u3 = Math.PI, d2 = o3 * ee, f2 = Ce(d2), p2 = Se(d2), m = 0.5 * (-p2 * e25 - f2 * t3), h2 = 0.5 * (-p2 * t3 + f2 * e25), g2 = n3 ** 2, _2 = r3 ** 2, v2 = h2 ** 2, y2 = m ** 2, b2 = g2 * _2 - g2 * v2 - _2 * y2, x2 = Math.abs(n3), S2 = Math.abs(r3);
      if (b2 < 0) {
        let e26 = Math.sqrt(1 - b2 / (g2 * _2));
        x2 *= e26, S2 *= e26;
      } else l3 = (i3 === a3 ? -1 : 1) * Math.sqrt(b2 / (g2 * v2 + _2 * y2));
      let C2 = l3 * x2 * h2 / S2, w2 = -l3 * S2 * m / x2, T2 = p2 * C2 - f2 * w2 + 0.5 * e25, E2 = f2 * C2 + p2 * w2 + 0.5 * t3, D2 = _a(1, 0, (m - C2) / x2, (h2 - w2) / S2), O2 = _a((m - C2) / x2, (h2 - w2) / S2, (-m - C2) / x2, (-h2 - w2) / S2);
      a3 === 0 && O2 > 0 ? O2 -= 2 * u3 : a3 === 1 && O2 < 0 && (O2 += 2 * u3);
      let k2 = Math.ceil(Math.abs(O2 / u3 * 2)), te2 = [], ne2 = O2 / k2, re2 = 8 / 3 * Math.sin(ne2 / 4) * Math.sin(ne2 / 4) / Math.sin(ne2 / 2), ie2 = D2 + ne2;
      for (let e26 = 0; e26 < k2; e26++) te2[e26] = ga(D2, ie2, p2, f2, x2, S2, T2, E2, re2, s3, c3), s3 = te2[e26][5], c3 = te2[e26][6], D2 = ie2, ie2 += ne2;
      return te2;
    })(c2 - e24, l2 - t2, r2, i2, o2, s2, a2);
    for (let n3 = 0, r3 = u2.length; n3 < r3; n3++) u2[n3][1] += e24, u2[n3][2] += t2, u2[n3][3] += e24, u2[n3][4] += t2, u2[n3][5] += e24, u2[n3][6] += t2;
    return u2;
  };
  var ba = (e24) => {
    let t2 = 0, n2 = 0, r2 = 0, i2 = 0, a2 = [], o2, s2 = 0, c2 = 0;
    for (let l2 of e24) {
      let e25 = [...l2], u2;
      switch (e25[0]) {
        case `l`:
          e25[1] += t2, e25[2] += n2;
        case `L`:
          t2 = e25[1], n2 = e25[2], u2 = [`L`, t2, n2];
          break;
        case `h`:
          e25[1] += t2;
        case `H`:
          t2 = e25[1], u2 = [`L`, t2, n2];
          break;
        case `v`:
          e25[1] += n2;
        case `V`:
          n2 = e25[1], u2 = [`L`, t2, n2];
          break;
        case `m`:
          e25[1] += t2, e25[2] += n2;
        case `M`:
          t2 = e25[1], n2 = e25[2], r2 = e25[1], i2 = e25[2], u2 = [`M`, t2, n2];
          break;
        case `c`:
          e25[1] += t2, e25[2] += n2, e25[3] += t2, e25[4] += n2, e25[5] += t2, e25[6] += n2;
        case `C`:
          s2 = e25[3], c2 = e25[4], t2 = e25[5], n2 = e25[6], u2 = [`C`, e25[1], e25[2], s2, c2, t2, n2];
          break;
        case `s`:
          e25[1] += t2, e25[2] += n2, e25[3] += t2, e25[4] += n2;
        case `S`:
          o2 === `C` ? (s2 = 2 * t2 - s2, c2 = 2 * n2 - c2) : (s2 = t2, c2 = n2), t2 = e25[3], n2 = e25[4], u2 = [`C`, s2, c2, e25[1], e25[2], t2, n2], s2 = u2[3], c2 = u2[4];
          break;
        case `q`:
          e25[1] += t2, e25[2] += n2, e25[3] += t2, e25[4] += n2;
        case `Q`:
          s2 = e25[1], c2 = e25[2], t2 = e25[3], n2 = e25[4], u2 = [`Q`, s2, c2, t2, n2];
          break;
        case `t`:
          e25[1] += t2, e25[2] += n2;
        case `T`:
          o2 === `Q` ? (s2 = 2 * t2 - s2, c2 = 2 * n2 - c2) : (s2 = t2, c2 = n2), t2 = e25[1], n2 = e25[2], u2 = [`Q`, s2, c2, t2, n2];
          break;
        case `a`:
          e25[6] += t2, e25[7] += n2;
        case `A`:
          ya(t2, n2, e25).forEach((e26) => a2.push(e26)), t2 = e25[6], n2 = e25[7];
          break;
        case `z`:
        case `Z`:
          t2 = r2, n2 = i2, u2 = [`Z`];
      }
      u2 ? (a2.push(u2), o2 = u2[0]) : o2 = ``;
    }
    return a2;
  };
  var xa = (e24, t2, n2, r2) => Math.sqrt((n2 - e24) ** 2 + (r2 - t2) ** 2);
  var Sa = (e24, t2, n2, r2, i2, a2, o2, s2) => (c2) => {
    let l2 = c2 ** 3, u2 = ((e25) => 3 * e25 ** 2 * (1 - e25))(c2), d2 = ((e25) => 3 * e25 * (1 - e25) ** 2)(c2), f2 = ((e25) => (1 - e25) ** 3)(c2);
    return new N(o2 * l2 + i2 * u2 + n2 * d2 + e24 * f2, s2 * l2 + a2 * u2 + r2 * d2 + t2 * f2);
  };
  var Ca = (e24) => e24 ** 2;
  var wa = (e24) => 2 * e24 * (1 - e24);
  var Ta = (e24) => (1 - e24) ** 2;
  var Ea = (e24, t2, n2, r2, i2, a2, o2, s2) => (c2) => {
    let l2 = Ca(c2), u2 = wa(c2), d2 = Ta(c2), f2 = 3 * (d2 * (n2 - e24) + u2 * (i2 - n2) + l2 * (o2 - i2)), p2 = 3 * (d2 * (r2 - t2) + u2 * (a2 - r2) + l2 * (s2 - a2));
    return Math.atan2(p2, f2);
  };
  var Da = (e24, t2, n2, r2, i2, a2) => (o2) => {
    let s2 = Ca(o2), c2 = wa(o2), l2 = Ta(o2);
    return new N(i2 * s2 + n2 * c2 + e24 * l2, a2 * s2 + r2 * c2 + t2 * l2);
  };
  var Oa = (e24, t2, n2, r2, i2, a2) => (o2) => {
    let s2 = 1 - o2, c2 = 2 * (s2 * (n2 - e24) + o2 * (i2 - n2)), l2 = 2 * (s2 * (r2 - t2) + o2 * (a2 - r2));
    return Math.atan2(l2, c2);
  };
  var ka = (e24, t2, n2) => {
    let r2 = new N(t2, n2), i2 = 0;
    for (let t3 = 1; t3 <= 100; t3 += 1) {
      let n3 = e24(t3 / 100);
      i2 += xa(r2.x, r2.y, n3.x, n3.y), r2 = n3;
    }
    return i2;
  };
  var Aa = (e24, t2) => {
    let n2, r2 = 0, i2 = 0, a2 = { x: e24.x, y: e24.y }, o2 = { ...a2 }, s2 = 0.01, c2 = 0, l2 = e24.iterator, u2 = e24.angleFinder;
    for (; i2 < t2 && s2 > 1e-4; ) o2 = l2(r2), c2 = r2, n2 = xa(a2.x, a2.y, o2.x, o2.y), n2 + i2 > t2 ? (r2 -= s2, s2 /= 2) : (a2 = o2, r2 += s2, i2 += n2);
    return { ...o2, angle: u2(c2) };
  };
  var ja = (e24) => {
    let t2, n2, r2 = 0, i2 = 0, a2 = 0, o2 = 0, s2 = 0, c2 = [];
    for (let l2 of e24) {
      let e25 = { x: i2, y: a2, command: l2[0], length: 0 };
      switch (l2[0]) {
        case `M`:
          n2 = e25, n2.x = o2 = i2 = l2[1], n2.y = s2 = a2 = l2[2];
          break;
        case `L`:
          n2 = e25, n2.length = xa(i2, a2, l2[1], l2[2]), i2 = l2[1], a2 = l2[2];
          break;
        case `C`:
          t2 = Sa(i2, a2, l2[1], l2[2], l2[3], l2[4], l2[5], l2[6]), n2 = e25, n2.iterator = t2, n2.angleFinder = Ea(i2, a2, l2[1], l2[2], l2[3], l2[4], l2[5], l2[6]), n2.length = ka(t2, i2, a2), i2 = l2[5], a2 = l2[6];
          break;
        case `Q`:
          t2 = Da(i2, a2, l2[1], l2[2], l2[3], l2[4]), n2 = e25, n2.iterator = t2, n2.angleFinder = Oa(i2, a2, l2[1], l2[2], l2[3], l2[4]), n2.length = ka(t2, i2, a2), i2 = l2[3], a2 = l2[4];
          break;
        case `Z`:
          n2 = e25, n2.destX = o2, n2.destY = s2, n2.length = xa(i2, a2, o2, s2), i2 = o2, a2 = s2;
      }
      r2 += n2.length, c2.push(n2);
    }
    return c2.push({ length: r2, x: i2, y: a2 }), c2;
  };
  var Ma = (e24, t2, n2 = ja(e24)) => {
    let r2 = 0;
    for (; t2 - n2[r2].length > 0 && r2 < n2.length - 2; ) t2 -= n2[r2].length, r2++;
    let i2 = n2[r2], a2 = t2 / i2.length, o2 = e24[r2];
    switch (i2.command) {
      case `M`:
        return { x: i2.x, y: i2.y, angle: 0 };
      case `Z`:
        return { ...new N(i2.x, i2.y).lerp(new N(i2.destX, i2.destY), a2), angle: Math.atan2(i2.destY - i2.y, i2.destX - i2.x) };
      case `L`:
        return { ...new N(i2.x, i2.y).lerp(new N(o2[1], o2[2]), a2), angle: Math.atan2(o2[2] - i2.y, o2[1] - i2.x) };
      case `C`:
      case `Q`:
        return Aa(i2, t2);
    }
  };
  var Na = RegExp(`[mzlhvcsqta][^mzlhvcsqta]*`, `gi`);
  var Pa = new RegExp(ma, `g`);
  var Fa = new RegExp(Dn, `gi`);
  var Ia = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
  var La = (e24) => {
    var t2;
    let n2 = [], r2 = (t2 = e24.match(Na)) == null ? [] : t2;
    for (let e25 of r2) {
      let t3 = e25[0];
      if (t3 === `z` || t3 === `Z`) {
        n2.push([t3]);
        continue;
      }
      let r3 = Ia[t3.toLowerCase()], i2 = [];
      if (t3 === `a` || t3 === `A`) {
        let t4;
        for (Pa.lastIndex = 0; t4 = Pa.exec(e25); ) i2.push(...t4.slice(1));
      } else i2 = e25.match(Fa) || [];
      for (let e26 = 0; e26 < i2.length; e26 += r3) {
        let a2 = Array(r3), o2 = ha[t3];
        a2[0] = e26 > 0 && o2 ? o2 : t3;
        for (let t4 = 0; t4 < r3; t4++) a2[t4 + 1] = parseFloat(i2[e26 + t4]);
        n2.push(a2);
      }
    }
    return n2;
  };
  var Ra = (e24, t2 = 0) => {
    let n2 = new N(e24[0]), r2 = new N(e24[1]), i2 = 1, a2 = 0, o2 = [], s2 = e24.length, c2 = s2 > 2, l2;
    for (c2 && (i2 = e24[2].x < r2.x ? -1 : e24[2].x === r2.x ? 0 : 1, a2 = e24[2].y < r2.y ? -1 : e24[2].y === r2.y ? 0 : 1), o2.push([`M`, n2.x - i2 * t2, n2.y - a2 * t2]), l2 = 1; l2 < s2; l2++) {
      if (!n2.eq(r2)) {
        let e25 = n2.midPointFrom(r2);
        o2.push([`Q`, n2.x, n2.y, e25.x, e25.y]);
      }
      n2 = e24[l2], l2 + 1 < e24.length && (r2 = e24[l2 + 1]);
    }
    return c2 && (i2 = n2.x > e24[l2 - 2].x ? 1 : n2.x === e24[l2 - 2].x ? 0 : -1, a2 = n2.y > e24[l2 - 2].y ? 1 : n2.y === e24[l2 - 2].y ? 0 : -1), o2.push([`L`, n2.x + i2 * t2, n2.y + a2 * t2]), o2;
  };
  var za = (e24, t2, n2) => (n2 && (t2 = z(t2, [1, 0, 0, 1, -n2.x, -n2.y])), e24.map((e25) => {
    let n3 = [...e25];
    for (let r2 = 1; r2 < e25.length - 1; r2 += 2) {
      let { x: i2, y: a2 } = L({ x: e25[r2], y: e25[r2 + 1] }, t2);
      n3[r2] = i2, n3[r2 + 1] = a2;
    }
    return n3;
  }));
  var Ba = (e24, t2) => {
    let n2 = 2 * Math.PI / e24, r2 = -S;
    e24 % 2 == 0 && (r2 += n2 / 2);
    let i2 = Array(e24 + 1);
    for (let a2 = 0; a2 < e24; a2++) {
      let e25 = a2 * n2 + r2, { x: o2, y: s2 } = new N(Se(e25), Ce(e25)).scalarMultiply(t2);
      i2[a2] = [a2 === 0 ? `M` : `L`, o2, s2];
    }
    return i2[e24] = [`Z`], i2;
  };
  var Va = (e24, t2) => e24.map((e25) => e25.map((e26, n2) => n2 === 0 || t2 === void 0 ? e26 : B(e26, t2)).join(` `)).join(` `);
  var Ha = (e24, t2) => {
    var n2;
    let r2 = e24, i2 = t2;
    r2.inverted && !i2.inverted && (r2 = t2, i2 = e24), Pt(i2, (n2 = i2.group) == null ? void 0 : n2.calcTransformMatrix(), r2.calcTransformMatrix());
    let a2 = r2.inverted && i2.inverted;
    return a2 && (r2.inverted = i2.inverted = false), new ca([r2], { clipPath: i2, inverted: a2 });
  };
  var Ua = (e24, t2) => Math.floor(Math.random() * (t2 - e24 + 1)) + e24;
  var Wa = (e24, t2) => {
    let n2 = e24._findCenterFromElement();
    e24.transformMatrix && (((e25) => {
      if (e25.transformMatrix) {
        let { scaleX: t3, scaleY: n3, angle: r2, skewX: i2 } = He(e25.transformMatrix);
        e25.flipX = false, e25.flipY = false, e25.set(de, t3), e25.set(fe, n3), e25.angle = r2, e25.skewX = i2, e25.skewY = 0;
      }
    })(e24), n2 = n2.transform(e24.transformMatrix)), delete e24.transformMatrix, t2 && (e24.scaleX *= t2.scaleX, e24.scaleY *= t2.scaleY, e24.cropX = t2.cropX, e24.cropY = t2.cropY, n2.x += t2.offsetLeft, n2.y += t2.offsetTop, e24.width = t2.width, e24.height = t2.height), e24.setPositionByOrigin(n2, E, E);
  };
  var Ga = t({ addTransformToObject: () => Et, animate: () => Mr, animateColor: () => Nr, applyTransformToObject: () => Dt, calcAngleBetweenVectors: () => Vt, calcDimensionsMatrix: () => Ye, calcPlaneChangeMatrix: () => jt, calcVectorRotation: () => Ht, cancelAnimFrame: () => ke, capValue: () => Vn, composeMatrix: () => Xe, copyCanvasElement: () => Ne, cos: () => Se, createCanvasElement: () => P, createImage: () => Me, createRotateMatrix: () => We, createScaleMatrix: () => Ge, createSkewXMatrix: () => qe, createSkewYMatrix: () => Je, createTranslateMatrix: () => Ue, createVector: () => zt, crossProduct: () => Gt, degreesToRadians: () => I, dotProduct: () => Kt, ease: () => Gn, enlivenObjectEnlivables: () => $e, enlivenObjects: () => Qe, findScaleToCover: () => da, findScaleToFit: () => ua, getBoundsOfCurve: () => va, getOrthonormalVector: () => Wt, getPathSegmentsInfo: () => ja, getPointOnPath: () => Ma, getPointer: () => xt, getRandomInt: () => Ua, getRegularPolygonPath: () => Ba, getSmoothPathFromPoints: () => Ra, getSvgAttributes: () => pn, getUnitVector: () => Ut, groupSVGElements: () => la, hasStyleChanged: () => Ei, invertTransform: () => R, isBetweenVectors: () => qt, isIdentityMatrix: () => Le, isTouchEvent: () => St, isTransparent: () => yi, joinPath: () => Va, loadImage: () => Ze, magnitude: () => Bt, makeBoundingBoxFromPoints: () => wt, makePathSimpler: () => ba, matrixToSVG: () => nt, mergeClipPaths: () => Ha, multiplyTransformMatrices: () => z, multiplyTransformMatrixArray: () => Re, parsePath: () => La, parsePreserveAspectRatioAttribute: () => mn, parseUnit: () => K, pick: () => et, projectStrokeOnPoints: () => wi, qrDecompose: () => He, radiansToDegrees: () => Ie, removeFromArray: () => xe, removeTransformFromObject: () => Tt, removeTransformMatrixForSvgParsing: () => Wa, requestAnimFrame: () => Oe, resetObjectTransform: () => Ot, rotateVector: () => Rt, saveObjectTransform: () => kt, sendObjectToPlane: () => Pt, sendPointToPlane: () => Mt, sendVectorToPlane: () => Nt, sin: () => Ce, sizeAfterTransform: () => At, string: () => pt, stylesFromArray: () => Oi, stylesToArray: () => Di, toBlob: () => Fe, toDataURL: () => Pe, toFixed: () => B, transformPath: () => za, transformPoint: () => L });
  function Ka(e24, t2) {
    let n2 = e24.style;
    n2 && Object.entries(t2).forEach(([e25, t3]) => n2.setProperty(e25, t3));
  }
  var qa = class extends dt {
    constructor(e24, { allowTouchScrolling: t2 = false, containerClass: n2 = `` } = {}) {
      super(e24), i(this, `upper`, void 0), i(this, `container`, void 0);
      let { el: r2 } = this.lower, a2 = this.createUpperCanvas();
      this.upper = { el: a2, ctx: a2.getContext(`2d`) }, this.applyCanvasStyle(r2, { allowTouchScrolling: t2 }), this.applyCanvasStyle(a2, { allowTouchScrolling: t2, styles: { position: `absolute`, left: `0`, top: `0` } });
      let o2 = this.createContainerElement();
      o2.classList.add(n2), r2.parentNode && r2.parentNode.replaceChild(o2, r2), o2.append(r2, a2), this.container = o2;
    }
    createUpperCanvas() {
      let { el: e24 } = this.lower, t2 = P();
      return t2.className = e24.className, t2.classList.remove(`lower-canvas`), t2.classList.add(`upper-canvas`), t2.setAttribute(`data-fabric`, `top`), t2.style.cssText = e24.style.cssText, t2.setAttribute(`draggable`, `true`), t2;
    }
    createContainerElement() {
      let e24 = g().createElement(`div`);
      return e24.setAttribute(`data-fabric`, `wrapper`), Ka(e24, { position: `relative` }), ut(e24), e24;
    }
    applyCanvasStyle(e24, t2) {
      let { styles: n2, allowTouchScrolling: r2 } = t2;
      Ka(e24, { ...n2, "touch-action": r2 ? `manipulation` : te }), ut(e24);
    }
    setDimensions(e24, t2) {
      super.setDimensions(e24, t2);
      let { el: n2, ctx: r2 } = this.upper;
      ct(n2, r2, e24, t2);
    }
    setCSSDimensions(e24) {
      super.setCSSDimensions(e24), lt(this.upper.el, e24), lt(this.container, e24);
    }
    cleanupDOM(e24) {
      let t2 = this.container, { el: n2 } = this.lower, { el: r2 } = this.upper;
      super.cleanupDOM(e24), t2.removeChild(r2), t2.removeChild(n2), t2.parentNode && t2.parentNode.replaceChild(n2, t2);
    }
    dispose() {
      super.dispose(), h().dispose(this.upper.el), delete this.upper, delete this.container;
    }
  };
  var Ja = (e24, t2, n2, r2) => {
    let { target: i2, offsetX: a2, offsetY: o2 } = t2, s2 = n2 - a2, c2 = r2 - o2, l2 = !Zt(i2, `lockMovementX`) && i2.left !== s2, u2 = !Zt(i2, `lockMovementY`) && i2.top !== c2;
    return l2 && i2.set(`left`, s2), u2 && i2.set(`top`, c2), (l2 || u2) && Lr(re, Qt(e24, t2, n2, r2)), l2 || u2;
  };
  var Ya = ce;
  var Xa = (e24) => function(t2, n2, r2) {
    let { points: i2, pathOffset: a2 } = r2;
    return new N(i2[e24]).subtract(a2).transform(z(r2.getViewportTransform(), r2.calcTransformMatrix()));
  };
  var Za = (e24, t2, n2, r2) => {
    let { target: i2, pointIndex: a2 } = t2, o2 = i2, s2 = Mt(new N(n2, r2), void 0, o2.calcOwnMatrix());
    return o2.points[a2] = s2.add(o2.pathOffset), o2.setDimensions(), o2.set(`dirty`, true), true;
  };
  var Qa = (e24, t2) => function(n2, r2, i2, a2) {
    let o2 = r2.target, s2 = new N(o2.points[(e24 > 0 ? e24 : o2.points.length) - 1]), c2 = s2.subtract(o2.pathOffset).transform(o2.calcOwnMatrix()), l2 = t2(n2, { ...r2, pointIndex: e24 }, i2, a2), u2 = s2.subtract(o2.pathOffset).transform(o2.calcOwnMatrix()).subtract(c2);
    return o2.left -= u2.x, o2.top -= u2.y, l2;
  };
  var $a = (e24) => Rr(Ya, Qa(e24, Za));
  function eo(e24, t2 = {}) {
    let n2 = {};
    for (let r2 = 0; r2 < (typeof e24 == `number` ? e24 : e24.points.length); r2++) n2[`p${r2}`] = new q({ actionName: Ya, positionHandler: Xa(r2), actionHandler: $a(r2), ...t2 });
    return n2;
  }
  var to = (e24, t2, n2) => {
    let { path: r2, pathOffset: i2 } = e24, a2 = r2[t2];
    return new N(a2[n2] - i2.x, a2[n2 + 1] - i2.y).transform(z(e24.getViewportTransform(), e24.calcTransformMatrix()));
  };
  function no(e24, t2, n2) {
    let { commandIndex: r2, pointIndex: i2 } = this;
    return to(n2, r2, i2);
  }
  function ro(e24, t2, n2, r2) {
    let { target: i2 } = t2, { commandIndex: a2, pointIndex: o2 } = this, s2 = ((e25, t3, n3, r3, i3) => {
      let { path: a3, pathOffset: o3 } = e25, s3 = a3[(r3 > 0 ? r3 : a3.length) - 1], c2 = new N(s3[i3], s3[i3 + 1]), l2 = c2.subtract(o3).transform(e25.calcOwnMatrix()), u2 = Mt(new N(t3, n3), void 0, e25.calcOwnMatrix());
      a3[r3][i3] = u2.x + o3.x, a3[r3][i3 + 1] = u2.y + o3.y, e25.setDimensions();
      let d2 = c2.subtract(e25.pathOffset).transform(e25.calcOwnMatrix()).subtract(l2);
      return e25.left -= d2.x, e25.top -= d2.y, e25.set(`dirty`, true), true;
    })(i2, n2, r2, a2, o2);
    return s2 && Lr(this.actionName, { ...Qt(e24, t2, n2, r2), commandIndex: a2, pointIndex: o2 }), s2;
  }
  var io = class extends q {
    constructor(e24) {
      super(e24);
    }
    render(e24, t2, n2, r2, i2) {
      let a2 = { ...r2, cornerColor: this.controlFill, cornerStrokeColor: this.controlStroke, transparentCorners: !this.controlFill };
      super.render(e24, t2, n2, a2, i2);
    }
  };
  var ao = class extends io {
    constructor(e24) {
      super(e24);
    }
    render(e24, t2, n2, r2, i2) {
      let { path: a2 } = i2, { commandIndex: o2, pointIndex: s2, connectToCommandIndex: c2, connectToPointIndex: l2 } = this;
      e24.save(), e24.strokeStyle = this.controlStroke, this.connectionDashArray && e24.setLineDash(this.connectionDashArray);
      let [u2] = a2[o2], d2 = to(i2, c2, l2);
      if (u2 === `Q`) {
        let r3 = to(i2, o2, s2 + 2);
        e24.moveTo(r3.x, r3.y), e24.lineTo(t2, n2);
      } else e24.moveTo(t2, n2);
      e24.lineTo(d2.x, d2.y), e24.stroke(), e24.restore(), super.render(e24, t2, n2, r2, i2);
    }
  };
  var oo = (e24, t2, n2, r2, i2, a2) => new (n2 ? ao : io)({ commandIndex: e24, pointIndex: t2, actionName: `modifyPath`, positionHandler: no, actionHandler: ro, connectToCommandIndex: i2, connectToPointIndex: a2, ...r2, ...n2 ? r2.controlPointStyle : r2.pointStyle });
  function so(e24, t2 = {}) {
    let n2 = {}, r2 = `M`;
    return e24.path.forEach((e25, i2) => {
      let a2 = e25[0];
      switch (a2 !== `Z` && (n2[`c_${i2}_${a2}`] = oo(i2, e25.length - 2, false, t2)), a2) {
        case `C`:
          n2[`c_${i2}_C_CP_1`] = oo(i2, 1, true, t2, i2 - 1, /* @__PURE__ */ ((e26) => e26 === `C` ? 5 : e26 === `Q` ? 3 : 1)(r2)), n2[`c_${i2}_C_CP_2`] = oo(i2, 3, true, t2, i2, 5);
          break;
        case `Q`:
          n2[`c_${i2}_Q_CP_1`] = oo(i2, 1, true, t2, i2, 3);
      }
      r2 = a2;
    }), n2;
  }
  var co = t({ changeHeight: () => Wr, changeObjectHeight: () => Hr, changeObjectWidth: () => Vr, changeWidth: () => Ur, createObjectDefaultControls: () => mi, createPathControls: () => so, createPolyActionHandler: () => $a, createPolyControls: () => eo, createPolyPositionHandler: () => Xa, createResizeControls: () => hi, createTextboxDefaultControls: () => gi, dragHandler: () => Ja, factoryPolyActionHandler: () => Qa, getLocalPoint: () => en, polyActionHandler: () => Za, renderCircleControl: () => Gr, renderSquareControl: () => Kr, rotationStyleHandler: () => qr, rotationWithSnapping: () => Jr, scaleCursorStyleHandler: () => Qr, scaleOrSkewActionName: () => ui, scaleSkewCursorStyleHandler: () => di, scalingEqually: () => ei, scalingX: () => ti, scalingXOrSkewingY: () => fi, scalingY: () => ni, scalingYOrSkewingX: () => pi, skewCursorStyleHandler: () => ai, skewHandlerX: () => si, skewHandlerY: () => ci, wrapWithFireEvent: () => Rr, wrapWithFixedAnchor: () => zr });
  var lo = class e12 extends yt {
    constructor(...e24) {
      super(...e24), i(this, `_hoveredTargets`, []), i(this, `_currentTransform`, null), i(this, `_groupSelector`, null), i(this, `contextTopDirty`, false);
    }
    static getDefaults() {
      return { ...super.getDefaults(), ...e12.ownDefaults };
    }
    get upperCanvasEl() {
      var e24;
      return (e24 = this.elements.upper) == null ? void 0 : e24.el;
    }
    get contextTop() {
      var e24;
      return (e24 = this.elements.upper) == null ? void 0 : e24.ctx;
    }
    get wrapperEl() {
      return this.elements.container;
    }
    initElements(e24) {
      this.elements = new qa(e24, { allowTouchScrolling: this.allowTouchScrolling, containerClass: this.containerClass }), this._createCacheCanvas();
    }
    _onObjectAdded(e24) {
      this._objectsToRender = void 0, super._onObjectAdded(e24);
    }
    _onObjectRemoved(e24) {
      this._objectsToRender = void 0, e24 === this._activeObject && (this.fire(`before:selection:cleared`, { deselected: [e24] }), this._discardActiveObject(), this.fire(`selection:cleared`, { deselected: [e24] }), e24.fire(`deselected`, { target: e24 })), e24 === this._hoveredTarget && (this._hoveredTarget = void 0, this._hoveredTargets = []), super._onObjectRemoved(e24);
    }
    _onStackOrderChanged() {
      this._objectsToRender = void 0, super._onStackOrderChanged();
    }
    _chooseObjectsToRender() {
      let e24 = this._activeObject;
      return !this.preserveObjectStacking && e24 ? this._objects.filter((t2) => !t2.group && t2 !== e24).concat(e24) : this._objects;
    }
    renderAll() {
      this.cancelRequestedRender(), this.destroyed || (!this.contextTopDirty || this._groupSelector || this.isDrawingMode || (this.clearContext(this.contextTop), this.contextTopDirty = false), this.hasLostContext && (this.renderTopLayer(this.contextTop), this.hasLostContext = false), !this._objectsToRender && (this._objectsToRender = this._chooseObjectsToRender()), this.renderCanvas(this.getContext(), this._objectsToRender));
    }
    renderTopLayer(e24) {
      e24.save(), this.isDrawingMode && this._isCurrentlyDrawing && (this.freeDrawingBrush && this.freeDrawingBrush._render(), this.contextTopDirty = true), this.selection && this._groupSelector && (this._drawSelection(e24), this.contextTopDirty = true), e24.restore();
    }
    renderTop() {
      let e24 = this.contextTop;
      this.clearContext(e24), this.renderTopLayer(e24), this.fire(`after:render`, { ctx: e24 });
    }
    setTargetFindTolerance(e24) {
      e24 = Math.round(e24), this.targetFindTolerance = e24;
      let t2 = this.getRetinaScaling(), n2 = Math.ceil((2 * e24 + 1) * t2);
      this.pixelFindCanvasEl.width = this.pixelFindCanvasEl.height = n2, this.pixelFindContext.scale(t2, t2);
    }
    isTargetTransparent(e24, t2, n2) {
      let r2 = this.targetFindTolerance, i2 = this.pixelFindContext;
      this.clearContext(i2), i2.save(), i2.translate(-t2 + r2, -n2 + r2), i2.transform(...this.viewportTransform);
      let a2 = e24.selectionBackgroundColor;
      e24.selectionBackgroundColor = ``, e24.render(i2), e24.selectionBackgroundColor = a2, i2.restore();
      let o2 = Math.round(r2 * this.getRetinaScaling());
      return yi(i2, o2, o2, o2);
    }
    _isSelectionKeyPressed(e24) {
      let t2 = this.selectionKey;
      return !!t2 && (Array.isArray(t2) ? !!t2.find((t3) => !!t3 && true === e24[t3]) : e24[t2]);
    }
    _shouldClearSelection(e24, t2) {
      let n2 = this.getActiveObjects(), r2 = this._activeObject;
      return !!(!t2 || t2 && r2 && n2.length > 1 && n2.indexOf(t2) === -1 && r2 !== t2 && !this._isSelectionKeyPressed(e24) || t2 && !t2.evented || t2 && !t2.selectable && r2 && r2 !== t2);
    }
    _shouldCenterTransform(e24, t2, n2) {
      if (!e24) return;
      let r2;
      return t2 === `scale` || t2 === `scaleX` || t2 === `scaleY` || t2 === `resizing` ? r2 = this.centeredScaling || e24.centeredScaling : t2 === `rotate` && (r2 = this.centeredRotation || e24.centeredRotation), r2 ? !n2 : n2;
    }
    _getOriginFromCorner(e24, t2) {
      let n2 = t2 ? e24.controls[t2].getTransformAnchorPoint() : { x: e24.originX, y: e24.originY };
      return t2 ? ([`ml`, `tl`, `bl`].includes(t2) ? n2.x = k : [`mr`, `tr`, `br`].includes(t2) && (n2.x = D), [`tl`, `mt`, `tr`].includes(t2) ? n2.y = O : [`bl`, `mb`, `br`].includes(t2) && (n2.y = `top`), n2) : n2;
    }
    _setupCurrentTransform(e24, t2, n2) {
      var r2;
      let i2 = t2.group ? Mt(this.getScenePoint(e24), void 0, t2.group.calcTransformMatrix()) : this.getScenePoint(e24), { key: a2 = ``, control: o2 } = t2.getActiveControl() || {}, s2 = n2 && o2 ? (r2 = o2.getActionHandler(e24, t2, o2)) == null ? void 0 : r2.bind(o2) : Ja, c2 = ((e25, t3, n3, r3) => {
        if (!t3 || !e25) return `drag`;
        let i3 = r3.controls[t3];
        return i3.getActionName(n3, i3, r3);
      })(n2, a2, e24, t2), l2 = e24[this.centeredKey], u2 = this._shouldCenterTransform(t2, c2, l2) ? { x: E, y: E } : this._getOriginFromCorner(t2, a2), { scaleX: d2, scaleY: f2, skewX: p2, skewY: m, left: h2, top: g2, angle: _2, width: v2, height: y2, cropX: b2, cropY: x2 } = t2, S2 = { target: t2, action: c2, actionHandler: s2, actionPerformed: false, corner: a2, scaleX: d2, scaleY: f2, skewX: p2, skewY: m, offsetX: i2.x - h2, offsetY: i2.y - g2, originX: u2.x, originY: u2.y, ex: i2.x, ey: i2.y, lastX: i2.x, lastY: i2.y, theta: I(_2), width: v2, height: y2, shiftKey: e24.shiftKey, altKey: l2, original: { ...kt(t2), originX: u2.x, originY: u2.y, cropX: b2, cropY: x2 } };
      this._currentTransform = S2, this.fire(`before:transform`, { e: e24, transform: S2 });
    }
    setCursor(e24) {
      this.upperCanvasEl.style.cursor = e24;
    }
    _drawSelection(e24) {
      let { x: t2, y: n2, deltaX: r2, deltaY: i2 } = this._groupSelector, a2 = new N(t2, n2).transform(this.viewportTransform), o2 = new N(t2 + r2, n2 + i2).transform(this.viewportTransform), s2 = this.selectionLineWidth / 2, c2 = Math.min(a2.x, o2.x), l2 = Math.min(a2.y, o2.y), u2 = Math.max(a2.x, o2.x), d2 = Math.max(a2.y, o2.y);
      this.selectionColor && (e24.fillStyle = this.selectionColor, e24.fillRect(c2, l2, u2 - c2, d2 - l2)), this.selectionLineWidth && this.selectionBorderColor && (e24.lineWidth = this.selectionLineWidth, e24.strokeStyle = this.selectionBorderColor, c2 += s2, l2 += s2, u2 -= s2, d2 -= s2, J.prototype._setLineDash.call(this, e24, this.selectionDashArray), e24.strokeRect(c2, l2, u2 - c2, d2 - l2));
    }
    findTarget(e24) {
      if (this._targetInfo) return this._targetInfo;
      if (this.skipTargetFind) return { subTargets: [], currentSubTargets: [] };
      let t2 = this.getScenePoint(e24), n2 = this._activeObject, r2 = this.getActiveObjects(), i2 = this.searchPossibleTargets(this._objects, t2), { subTargets: a2, container: o2, target: s2 } = i2, c2 = { ...i2, currentSubTargets: a2, currentContainer: o2, currentTarget: s2 };
      if (!n2) return c2;
      let l2 = { ...this.searchPossibleTargets([n2], t2), currentSubTargets: a2, currentContainer: o2, currentTarget: s2 };
      return n2.findControl(this.getViewportPoint(e24), St(e24)) ? { ...l2, target: n2 } : l2.target && (r2.length > 1 || !this.preserveObjectStacking || this.preserveObjectStacking && e24[this.altSelectionKey]) ? l2 : c2;
    }
    _pointIsInObjectSelectionArea(e24, t2) {
      let n2 = e24.getCoords(), r2 = this.getZoom(), i2 = e24.padding / r2;
      if (i2) {
        let [e25, t3, r3, a2] = n2, o2 = Math.atan2(t3.y - e25.y, t3.x - e25.x), s2 = Se(o2) * i2, c2 = Ce(o2) * i2, l2 = s2 + c2, u2 = s2 - c2;
        n2 = [new N(e25.x - u2, e25.y - l2), new N(t3.x + l2, t3.y - u2), new N(r3.x + u2, r3.y + l2), new N(a2.x - l2, a2.y + u2)];
      }
      return Pr.isPointInPolygon(t2, n2);
    }
    _checkTarget(e24, t2) {
      if (e24 && e24.visible && e24.evented && this._pointIsInObjectSelectionArea(e24, t2)) {
        if (!this.perPixelTargetFind && !e24.perPixelTargetFind || e24.isEditing) return true;
        {
          let n2 = t2.transform(this.viewportTransform);
          if (!this.isTargetTransparent(e24, n2.x, n2.y)) return true;
        }
      }
      return false;
    }
    _searchPossibleTargets(e24, t2, n2) {
      let r2 = e24.length;
      for (; r2--; ) {
        let i2 = e24[r2];
        if (this._checkTarget(i2, t2)) {
          if (Te(i2) && i2.subTargetCheck) {
            let { target: e25 } = this._searchPossibleTargets(i2._objects, t2, n2);
            e25 && n2.push(e25);
          }
          return { target: i2, subTargets: n2 };
        }
      }
      return { subTargets: [] };
    }
    searchPossibleTargets(e24, t2) {
      let n2 = this._searchPossibleTargets(e24, t2, []);
      n2.container = n2.target;
      let { container: r2, subTargets: i2 } = n2;
      if (r2 && Te(r2) && r2.interactive && i2[0]) {
        for (let e25 = i2.length - 1; e25 > 0; e25--) {
          let t3 = i2[e25];
          if (!Te(t3) || !t3.interactive) return n2.target = t3, n2;
        }
        return n2.target = i2[0], n2;
      }
      return n2;
    }
    getViewportPoint(e24) {
      return this._viewportPoint ? this._viewportPoint : this._getPointerImpl(e24, true);
    }
    getScenePoint(e24) {
      return this._scenePoint ? this._scenePoint : this._getPointerImpl(e24);
    }
    _getPointerImpl(e24, t2 = false) {
      let n2 = this.upperCanvasEl, r2 = n2.getBoundingClientRect(), i2 = xt(e24), a2 = r2.width || 0, o2 = r2.height || 0;
      a2 && o2 || (`top` in r2 && `bottom` in r2 && (o2 = Math.abs(r2.top - r2.bottom)), `right` in r2 && `left` in r2 && (a2 = Math.abs(r2.right - r2.left))), this.calcOffset(), i2.x -= this._offset.left, i2.y -= this._offset.top, t2 || (i2 = Mt(i2, void 0, this.viewportTransform));
      let s2 = this.getRetinaScaling();
      s2 !== 1 && (i2.x /= s2, i2.y /= s2);
      let c2 = a2 === 0 || o2 === 0 ? new N(1, 1) : new N(n2.width / a2, n2.height / o2);
      return i2.multiply(c2);
    }
    _setDimensionsImpl(e24, t2) {
      this._resetTransformEventData(), super._setDimensionsImpl(e24, t2), this._isCurrentlyDrawing && this.freeDrawingBrush && this.freeDrawingBrush._setBrushStyles(this.contextTop);
    }
    _createCacheCanvas() {
      this.pixelFindCanvasEl = P(), this.pixelFindContext = this.pixelFindCanvasEl.getContext(`2d`, { willReadFrequently: true }), this.setTargetFindTolerance(this.targetFindTolerance);
    }
    getTopContext() {
      return this.elements.upper.ctx;
    }
    getSelectionContext() {
      return this.elements.upper.ctx;
    }
    getSelectionElement() {
      return this.elements.upper.el;
    }
    getActiveObject() {
      return this._activeObject;
    }
    getActiveObjects() {
      let e24 = this._activeObject;
      return at(e24) ? e24.getObjects() : e24 ? [e24] : [];
    }
    _fireSelectionEvents(e24, t2) {
      let n2 = false, r2 = false, i2 = this.getActiveObjects(), a2 = [], o2 = [];
      e24.forEach((e25) => {
        i2.includes(e25) || (n2 = true, e25.fire(`deselected`, { e: t2, target: e25 }), o2.push(e25));
      }), i2.forEach((r3) => {
        e24.includes(r3) || (n2 = true, r3.fire(`selected`, { e: t2, target: r3 }), a2.push(r3));
      }), e24.length > 0 && i2.length > 0 ? (r2 = true, n2 && this.fire(`selection:updated`, { e: t2, selected: a2, deselected: o2 })) : i2.length > 0 ? (r2 = true, this.fire(`selection:created`, { e: t2, selected: a2 })) : e24.length > 0 && (r2 = true, this.fire(`selection:cleared`, { e: t2, deselected: o2 })), r2 && (this._objectsToRender = void 0);
    }
    setActiveObject(e24, t2) {
      let n2 = this.getActiveObjects(), r2 = this._setActiveObject(e24, t2);
      return this._fireSelectionEvents(n2, t2), r2;
    }
    _setActiveObject(e24, t2) {
      let n2 = this._activeObject;
      return n2 !== e24 && !(!this._discardActiveObject(t2, e24) && this._activeObject) && !e24.onSelect({ e: t2 }) && (this._activeObject = e24, at(e24) && n2 !== e24 && e24.set(`canvas`, this), e24.setCoords(), true);
    }
    _discardActiveObject(e24, t2) {
      let n2 = this._activeObject;
      return !!n2 && !n2.onDeselect({ e: e24, object: t2 }) && (this._currentTransform && this._currentTransform.target === n2 && this.endCurrentTransform(e24), at(n2) && n2 === this._hoveredTarget && (this._hoveredTarget = void 0), this._activeObject = void 0, true);
    }
    discardActiveObject(e24) {
      let t2 = this.getActiveObjects(), n2 = this.getActiveObject();
      t2.length && this.fire(`before:selection:cleared`, { e: e24, deselected: [n2] });
      let r2 = this._discardActiveObject(e24);
      return this._fireSelectionEvents(t2, e24), r2;
    }
    endCurrentTransform(e24) {
      let t2 = this._currentTransform;
      this._finalizeCurrentTransform(e24), t2 && t2.target && (t2.target.isMoving = false), this._currentTransform = null;
    }
    _finalizeCurrentTransform(e24) {
      let t2 = this._currentTransform, n2 = t2.target, r2 = { e: e24, target: n2, transform: t2, action: t2.action };
      n2._scaling && (n2._scaling = false), n2.setCoords(), t2.actionPerformed && (this.fire(`object:modified`, r2), n2.fire(ge, r2));
    }
    setViewportTransform(e24) {
      super.setViewportTransform(e24);
      let t2 = this._activeObject;
      t2 && t2.setCoords();
    }
    destroy() {
      let e24 = this._activeObject;
      at(e24) && (e24.removeAll(), e24.dispose()), delete this._activeObject, super.destroy(), this.pixelFindContext = null, this.pixelFindCanvasEl = void 0;
    }
    clear() {
      this.discardActiveObject(), this._activeObject = void 0, this.clearContext(this.contextTop), super.clear();
    }
    drawControls(e24) {
      let t2 = this._activeObject;
      t2 && t2._renderControls(e24);
    }
    _toObject(e24, t2, n2) {
      let r2 = this._realizeGroupTransformOnObject(e24), i2 = super._toObject(e24, t2, n2);
      return e24.set(r2), i2;
    }
    _realizeGroupTransformOnObject(e24) {
      let { group: t2 } = e24;
      if (t2 && at(t2) && this._activeObject === t2) {
        let n2 = et(e24, [`angle`, `flipX`, `flipY`, D, de, fe, pe, me, `top`]);
        return Et(e24, t2.calcOwnMatrix()), n2;
      }
      return {};
    }
    _setSVGObject(e24, t2, n2) {
      let r2 = this._realizeGroupTransformOnObject(t2);
      super._setSVGObject(e24, t2, n2), t2.set(r2);
    }
  };
  i(lo, `ownDefaults`, { uniformScaling: true, uniScaleKey: `shiftKey`, centeredScaling: false, centeredRotation: false, centeredKey: `altKey`, altActionKey: `shiftKey`, selection: true, selectionKey: `shiftKey`, selectionColor: `rgba(100, 100, 255, 0.3)`, selectionDashArray: [], selectionBorderColor: `rgba(255, 255, 255, 0.3)`, selectionLineWidth: 1, selectionFullyContained: false, hoverCursor: `move`, moveCursor: `move`, defaultCursor: `default`, freeDrawingCursor: `crosshair`, notAllowedCursor: `not-allowed`, perPixelTargetFind: false, targetFindTolerance: 0, skipTargetFind: false, stopContextMenu: true, fireRightClick: true, fireMiddleClick: true, enablePointerEvents: false, containerClass: `canvas-container`, preserveObjectStacking: true });
  var uo = class {
    constructor(e24) {
      i(this, `targets`, []), i(this, `__disposer`, void 0);
      let t2 = () => {
        let { hiddenTextarea: t3 } = e24.getActiveObject() || {};
        t3 && t3.focus();
      }, n2 = e24.upperCanvasEl;
      n2.addEventListener(`click`, t2), this.__disposer = () => n2.removeEventListener(`click`, t2);
    }
    exitTextEditing() {
      this.target = void 0, this.targets.forEach((e24) => {
        e24.isEditing && e24.exitEditing();
      });
    }
    add(e24) {
      this.targets.push(e24);
    }
    remove(e24) {
      this.unregister(e24), xe(this.targets, e24);
    }
    register(e24) {
      this.target = e24;
    }
    unregister(e24) {
      e24 === this.target && (this.target = void 0);
    }
    onMouseMove(e24) {
      var t2;
      (t2 = this.target) != null && t2.isEditing && this.target.updateSelectionOnMouseMove(e24);
    }
    clear() {
      this.targets = [], this.target = void 0;
    }
    dispose() {
      this.clear(), this.__disposer(), delete this.__disposer;
    }
  };
  var X = { passive: false };
  var fo = (e24, t2) => ({ viewportPoint: e24.getViewportPoint(t2), scenePoint: e24.getScenePoint(t2) });
  var po = (e24, ...t2) => e24.addEventListener(...t2);
  var Z = (e24, ...t2) => e24.removeEventListener(...t2);
  var mo = { mouse: { in: `over`, out: `out`, targetIn: `mouseover`, targetOut: `mouseout`, canvasIn: `mouse:over`, canvasOut: `mouse:out` }, drag: { in: `enter`, out: `leave`, targetIn: `dragenter`, targetOut: `dragleave`, canvasIn: `drag:enter`, canvasOut: `drag:leave` } };
  var ho = class extends lo {
    constructor(e24, t2 = {}) {
      super(e24, t2), i(this, `_isClick`, void 0), i(this, `textEditingManager`, new uo(this)), [`_onMouseDown`, `_onTouchStart`, `_onMouseMove`, `_onMouseUp`, `_onTouchEnd`, `_onResize`, `_onMouseWheel`, `_onMouseOut`, `_onMouseEnter`, `_onContextMenu`, `_onClick`, `_onDragStart`, `_onDragEnd`, `_onDragProgress`, `_onDragOver`, `_onDragEnter`, `_onDragLeave`, `_onDrop`].forEach((e25) => {
        this[e25] = this[e25].bind(this);
      }), this.addOrRemove(po);
    }
    _getEventPrefix() {
      return this.enablePointerEvents ? `pointer` : `mouse`;
    }
    addOrRemove(e24, t2 = false) {
      let n2 = this.upperCanvasEl, r2 = this._getEventPrefix();
      e24(st(n2), `resize`, this._onResize), e24(n2, r2 + `down`, this._onMouseDown), e24(n2, `${r2}move`, this._onMouseMove, X), e24(n2, `${r2}out`, this._onMouseOut), e24(n2, `${r2}enter`, this._onMouseEnter), e24(n2, `wheel`, this._onMouseWheel, { passive: false }), e24(n2, `contextmenu`, this._onContextMenu), t2 || (e24(n2, `click`, this._onClick), e24(n2, `dblclick`, this._onClick)), e24(n2, `dragstart`, this._onDragStart), e24(n2, `dragend`, this._onDragEnd), e24(n2, `dragover`, this._onDragOver), e24(n2, `dragenter`, this._onDragEnter), e24(n2, `dragleave`, this._onDragLeave), e24(n2, `drop`, this._onDrop), this.enablePointerEvents || e24(n2, `touchstart`, this._onTouchStart, X);
    }
    removeListeners() {
      this.addOrRemove(Z);
      let e24 = this._getEventPrefix(), t2 = H(this.upperCanvasEl);
      Z(t2, `${e24}up`, this._onMouseUp), Z(t2, `touchend`, this._onTouchEnd, X), Z(t2, `${e24}move`, this._onMouseMove, X), Z(t2, `touchmove`, this._onMouseMove, X), clearTimeout(this._willAddMouseDown);
    }
    _onMouseWheel(e24) {
      this._cacheTransformEventData(e24), this._handleEvent(e24, `wheel`), this._resetTransformEventData();
    }
    _onMouseOut(e24) {
      let t2 = this._hoveredTarget, n2 = { e: e24, ...fo(this, e24) };
      this.fire(`mouse:out`, { ...n2, target: t2 }), this._hoveredTarget = void 0, t2 && t2.fire(`mouseout`, { ...n2 }), this._hoveredTargets.forEach((e25) => {
        this.fire(`mouse:out`, { ...n2, target: e25 }), e25 && e25.fire(`mouseout`, { ...n2 });
      }), this._hoveredTargets = [];
    }
    _onMouseEnter(e24) {
      let { target: t2 } = this.findTarget(e24);
      this._currentTransform || t2 || (this.fire(`mouse:over`, { e: e24, ...fo(this, e24) }), this._hoveredTarget = void 0, this._hoveredTargets = []);
    }
    _onDragStart(e24) {
      this._isClick = false;
      let t2 = this.getActiveObject();
      if (t2 && t2.onDragStart(e24)) {
        this._dragSource = t2;
        let n2 = { e: e24, target: t2 };
        this.fire(`dragstart`, n2), t2.fire(`dragstart`, n2), po(this.upperCanvasEl, `drag`, this._onDragProgress);
        return;
      }
      Ct(e24);
    }
    _renderDragEffects(e24, t2, n2) {
      let r2 = false, i2 = this._dropTarget;
      i2 && i2 !== t2 && i2 !== n2 && (i2.clearContextTop(), r2 = true), t2 == null || t2.clearContextTop(), n2 !== t2 && (n2 == null || n2.clearContextTop());
      let a2 = this.contextTop;
      a2.save(), a2.transform(...this.viewportTransform), t2 && (a2.save(), t2.transform(a2), t2.renderDragSourceEffect(e24), a2.restore(), r2 = true), n2 && (a2.save(), n2.transform(a2), n2.renderDropTargetEffect(e24), a2.restore(), r2 = true), a2.restore(), r2 && (this.contextTopDirty = true);
    }
    _onDragEnd(e24) {
      let { currentSubTargets: t2 } = this.findTarget(e24), n2 = !!e24.dataTransfer && e24.dataTransfer.dropEffect !== `none`, r2 = n2 ? this._activeObject : void 0, i2 = { e: e24, target: this._dragSource, subTargets: t2, dragSource: this._dragSource, didDrop: n2, dropTarget: r2 };
      Z(this.upperCanvasEl, `drag`, this._onDragProgress), this.fire(`dragend`, i2), this._dragSource && this._dragSource.fire(`dragend`, i2), delete this._dragSource, this._onMouseUp(e24);
    }
    _onDragProgress(e24) {
      let t2 = { e: e24, target: this._dragSource, dragSource: this._dragSource, dropTarget: this._draggedoverTarget };
      this.fire(`drag`, t2), this._dragSource && this._dragSource.fire(`drag`, t2);
    }
    _onDragOver(e24) {
      let t2 = `dragover`, { currentContainer: n2, currentSubTargets: r2 } = this.findTarget(e24), i2 = this._dragSource, a2 = { e: e24, target: n2, subTargets: r2, dragSource: i2, canDrop: false, dropTarget: void 0 }, o2;
      this.fire(t2, a2), this._fireEnterLeaveEvents(e24, n2, a2), n2 && (n2.canDrop(e24) && (o2 = n2), n2.fire(t2, a2));
      for (let n3 = 0; n3 < r2.length; n3++) {
        let i3 = r2[n3];
        i3.canDrop(e24) && (o2 = i3), i3.fire(t2, a2);
      }
      this._renderDragEffects(e24, i2, o2), this._dropTarget = o2;
    }
    _onDragEnter(e24) {
      let { currentContainer: t2, currentSubTargets: n2 } = this.findTarget(e24), r2 = { e: e24, target: t2, subTargets: n2, dragSource: this._dragSource };
      this.fire(`dragenter`, r2), this._fireEnterLeaveEvents(e24, t2, r2);
    }
    _onDragLeave(e24) {
      let { currentSubTargets: t2 } = this.findTarget(e24), n2 = { e: e24, target: this._draggedoverTarget, subTargets: t2, dragSource: this._dragSource };
      this.fire(`dragleave`, n2), this._fireEnterLeaveEvents(e24, void 0, n2), this._renderDragEffects(e24, this._dragSource), this._dropTarget = void 0, this._hoveredTargets = [];
    }
    _onDrop(e24) {
      let { currentContainer: t2, currentSubTargets: n2 } = this.findTarget(e24), r2 = this._basicEventHandler(`drop:before`, { e: e24, target: t2, subTargets: n2, dragSource: this._dragSource, ...fo(this, e24) });
      r2.didDrop = false, r2.dropTarget = void 0, this._basicEventHandler(`drop`, r2), this.fire(`drop:after`, r2);
    }
    _onContextMenu(e24) {
      let { target: t2, subTargets: n2 } = this.findTarget(e24), r2 = this._basicEventHandler(`contextmenu:before`, { e: e24, target: t2, subTargets: n2 });
      return this.stopContextMenu && Ct(e24), this._basicEventHandler(`contextmenu`, r2), false;
    }
    _onClick(e24) {
      let t2 = e24.detail;
      t2 > 3 || t2 < 2 || (this._cacheTransformEventData(e24), t2 == 2 && e24.type === `dblclick` && this._handleEvent(e24, `dblclick`), t2 == 3 && this._handleEvent(e24, `tripleclick`), this._resetTransformEventData());
    }
    fireEventFromPointerEvent(e24, t2, n2, r2 = {}) {
      this._cacheTransformEventData(e24);
      let { target: i2, subTargets: a2 } = this.findTarget(e24), o2 = { e: e24, target: i2, subTargets: a2, ...fo(this, e24), transform: this._currentTransform, ...r2 };
      this.fire(t2, o2), i2 && i2.fire(n2, o2);
      for (let e25 = 0; e25 < a2.length; e25++) a2[e25] !== i2 && a2[e25].fire(n2, o2);
      this._resetTransformEventData();
    }
    getPointerId(e24) {
      let t2 = e24.changedTouches;
      return t2 ? t2[0] && t2[0].identifier : this.enablePointerEvents ? e24.pointerId : -1;
    }
    _isMainEvent(e24) {
      return true === e24.isPrimary || false !== e24.isPrimary && (e24.type === `touchend` && e24.touches.length === 0 || !e24.changedTouches || e24.changedTouches[0].identifier === this.mainTouchId);
    }
    _onTouchStart(e24) {
      this._cacheTransformEventData(e24);
      let t2 = !this.allowTouchScrolling, n2 = this._activeObject;
      this.mainTouchId === void 0 && (this.mainTouchId = this.getPointerId(e24)), this.__onMouseDown(e24);
      let { target: r2 } = this.findTarget(e24);
      (this.isDrawingMode || n2 && r2 === n2) && (t2 = true), t2 && e24.preventDefault();
      let i2 = this.upperCanvasEl, a2 = this._getEventPrefix(), o2 = H(i2);
      po(o2, `touchend`, this._onTouchEnd, X), t2 && po(o2, `touchmove`, this._onMouseMove, X), Z(i2, `${a2}down`, this._onMouseDown), this._resetTransformEventData();
    }
    _onMouseDown(e24) {
      this._cacheTransformEventData(e24), this.__onMouseDown(e24);
      let t2 = this.upperCanvasEl, n2 = this._getEventPrefix();
      Z(t2, `${n2}move`, this._onMouseMove, X);
      let r2 = H(t2);
      po(r2, `${n2}up`, this._onMouseUp), po(r2, `${n2}move`, this._onMouseMove, X), this._resetTransformEventData();
    }
    _onTouchEnd(e24) {
      if (e24.touches.length > 0) return;
      this._cacheTransformEventData(e24), this.__onMouseUp(e24), this._resetTransformEventData(), delete this.mainTouchId;
      let t2 = this._getEventPrefix(), n2 = H(this.upperCanvasEl);
      Z(n2, `touchend`, this._onTouchEnd, X), Z(n2, `touchmove`, this._onMouseMove, X), this._willAddMouseDown && clearTimeout(this._willAddMouseDown), this._willAddMouseDown = setTimeout(() => {
        po(this.upperCanvasEl, `${t2}down`, this._onMouseDown), this._willAddMouseDown = 0;
      }, 400);
    }
    _onMouseUp(e24) {
      this._cacheTransformEventData(e24), this.__onMouseUp(e24);
      let t2 = this.upperCanvasEl, n2 = this._getEventPrefix();
      if (this._isMainEvent(e24)) {
        let e25 = H(this.upperCanvasEl);
        Z(e25, `${n2}up`, this._onMouseUp), Z(e25, `${n2}move`, this._onMouseMove, X), po(t2, `${n2}move`, this._onMouseMove, X);
      }
      this._resetTransformEventData();
    }
    _onMouseMove(e24) {
      this._cacheTransformEventData(e24);
      let t2 = this.getActiveObject();
      !this.allowTouchScrolling && (!t2 || !t2.shouldStartDragging(e24)) && e24.preventDefault && e24.preventDefault(), this.__onMouseMove(e24), this._resetTransformEventData();
    }
    _onResize() {
      this.calcOffset(), this._resetTransformEventData();
    }
    _shouldRender(e24) {
      let t2 = this.getActiveObject();
      return !!t2 != !!e24 || t2 && e24 && t2 !== e24;
    }
    __onMouseUp(e24) {
      var t2;
      this._handleEvent(e24, `up:before`);
      let n2 = this._currentTransform, r2 = this._isClick, { target: i2 } = this.findTarget(e24), { button: a2 } = e24;
      if (a2) return void ((this.fireMiddleClick && a2 === 1 || this.fireRightClick && a2 === 2) && this._handleEvent(e24, `up`));
      if (this.isDrawingMode && this._isCurrentlyDrawing) return void this._onMouseUpInDrawingMode(e24);
      if (!this._isMainEvent(e24)) return;
      let o2, s2, c2 = false;
      if (n2 && (this._finalizeCurrentTransform(e24), c2 = n2.actionPerformed), !r2) {
        let t3 = i2 === this._activeObject;
        this.handleSelection(e24), c2 || (c2 = this._shouldRender(i2) || !t3 && i2 === this._activeObject);
      }
      if (i2) {
        let { key: t3, control: r3 } = i2.findControl(this.getViewportPoint(e24), St(e24)) || {};
        if (s2 = t3, i2.selectable && i2 !== this._activeObject && i2.activeOn === `up`) this.setActiveObject(i2, e24), c2 = true;
        else if (r3) {
          let t4 = r3.getMouseUpHandler(e24, i2, r3);
          t4 && (o2 = this.getScenePoint(e24), t4.call(r3, e24, n2, o2.x, o2.y));
        }
        i2.isMoving = false;
      }
      if (n2 && (n2.target !== i2 || n2.corner !== s2)) {
        let t3 = n2.target && n2.target.controls[n2.corner], r3 = t3 && t3.getMouseUpHandler(e24, n2.target, t3);
        o2 = o2 || this.getScenePoint(e24), r3 && r3.call(t3, e24, n2, o2.x, o2.y);
      }
      this._setCursorFromEvent(e24, i2), this._handleEvent(e24, `up`), this._groupSelector = null, this._currentTransform = null, i2 && (i2.__corner = void 0), c2 ? this.requestRenderAll() : r2 || (t2 = this._activeObject) != null && t2.isEditing || this.renderTop();
    }
    _basicEventHandler(e24, t2) {
      let { target: n2, subTargets: r2 = [] } = t2;
      this.fire(e24, t2), n2 && n2.fire(e24, t2);
      for (let i2 = 0; i2 < r2.length; i2++) r2[i2] !== n2 && r2[i2].fire(e24, t2);
      return t2;
    }
    _handleEvent(e24, t2, n2) {
      let { target: r2, subTargets: i2 } = this.findTarget(e24), a2 = { e: e24, target: r2, subTargets: i2, ...fo(this, e24), transform: this._currentTransform, ...t2 === `down:before` || t2 === `down` ? n2 : {} };
      t2 !== `up:before` && t2 !== `up` || (a2.isClick = this._isClick), this.fire(`mouse:${t2}`, a2), r2 && r2.fire(`mouse${t2}`, a2);
      for (let e25 = 0; e25 < i2.length; e25++) i2[e25] !== r2 && i2[e25].fire(`mouse${t2}`, a2);
    }
    _onMouseDownInDrawingMode(e24) {
      this._isCurrentlyDrawing = true, this.getActiveObject() && (this.discardActiveObject(e24), this.requestRenderAll());
      let t2 = this.getScenePoint(e24);
      this.freeDrawingBrush && this.freeDrawingBrush.onMouseDown(t2, { e: e24, pointer: t2 }), this._handleEvent(e24, `down`, { alreadySelected: false });
    }
    _onMouseMoveInDrawingMode(e24) {
      if (this._isCurrentlyDrawing) {
        let t2 = this.getScenePoint(e24);
        this.freeDrawingBrush && this.freeDrawingBrush.onMouseMove(t2, { e: e24, pointer: t2 });
      }
      this.setCursor(this.freeDrawingCursor), this._handleEvent(e24, `move`);
    }
    _onMouseUpInDrawingMode(e24) {
      let t2 = this.getScenePoint(e24);
      this.freeDrawingBrush ? this._isCurrentlyDrawing = !!this.freeDrawingBrush.onMouseUp({ e: e24, pointer: t2 }) : this._isCurrentlyDrawing = false, this._handleEvent(e24, `up`);
    }
    __onMouseDown(e24) {
      this._isClick = true, this._handleEvent(e24, `down:before`);
      let { target: t2 } = this.findTarget(e24), n2 = !!t2 && t2 === this._activeObject, { button: r2 } = e24;
      if (r2) return void ((this.fireMiddleClick && r2 === 1 || this.fireRightClick && r2 === 2) && this._handleEvent(e24, `down`, { alreadySelected: n2 }));
      if (this.isDrawingMode) return void this._onMouseDownInDrawingMode(e24);
      if (!this._isMainEvent(e24) || this._currentTransform) return;
      let i2 = this._shouldRender(t2), a2 = false;
      if (this.handleMultiSelection(e24, t2) ? (t2 = this._activeObject, a2 = true, i2 = true) : this._shouldClearSelection(e24, t2) && this.discardActiveObject(e24), this.selection && (!t2 || !t2.selectable && !t2.isEditing && t2 !== this._activeObject)) {
        let t3 = this.getScenePoint(e24);
        this._groupSelector = { x: t3.x, y: t3.y, deltaY: 0, deltaX: 0 };
      }
      if (n2 = !!t2 && t2 === this._activeObject, t2) {
        t2.selectable && t2.activeOn === `down` && this.setActiveObject(t2, e24);
        let r3 = t2.findControl(this.getViewportPoint(e24), St(e24));
        if (t2 === this._activeObject && (r3 || !a2)) {
          this._setupCurrentTransform(e24, t2, n2);
          let i3 = r3 ? r3.control : void 0, a3 = this.getScenePoint(e24), o2 = i3 && i3.getMouseDownHandler(e24, t2, i3);
          o2 && o2.call(i3, e24, this._currentTransform, a3.x, a3.y);
        }
      }
      i2 && (this._objectsToRender = void 0), this._handleEvent(e24, `down`, { alreadySelected: n2 }), i2 && this.requestRenderAll();
    }
    _resetTransformEventData() {
      this._targetInfo = this._viewportPoint = this._scenePoint = void 0;
    }
    _cacheTransformEventData(e24) {
      this._resetTransformEventData(), this._viewportPoint = this.getViewportPoint(e24), this._scenePoint = Mt(this._viewportPoint, void 0, this.viewportTransform), this._targetInfo = this.findTarget(e24), this._currentTransform && (this._targetInfo.target = this._currentTransform.target);
    }
    __onMouseMove(e24) {
      if (this._isClick = false, this._handleEvent(e24, `move:before`), this.isDrawingMode) return void this._onMouseMoveInDrawingMode(e24);
      if (!this._isMainEvent(e24)) return;
      let t2 = this._groupSelector;
      if (t2) {
        let n2 = this.getScenePoint(e24);
        t2.deltaX = n2.x - t2.x, t2.deltaY = n2.y - t2.y, this.renderTop();
      } else if (this._currentTransform) this._transformObject(e24);
      else {
        let { target: t3 } = this.findTarget(e24);
        this._setCursorFromEvent(e24, t3), this._fireOverOutEvents(e24, t3);
      }
      this.textEditingManager.onMouseMove(e24), this._handleEvent(e24, `move`);
    }
    _fireOverOutEvents(e24, t2) {
      let { _hoveredTarget: n2, _hoveredTargets: r2 } = this, { subTargets: i2, currentTarget: a2 } = this.findTarget(e24), o2 = Math.max(r2.length, i2.length);
      this.fireSyntheticInOutEvents(`mouse`, { e: e24, target: t2, oldTarget: n2, actualTarget: a2, oldActualTarget: this._hoveredActualTarget, fireCanvas: true });
      for (let a3 = 0; a3 < o2; a3++) i2[a3] === t2 || r2[a3] && r2[a3] === n2 || this.fireSyntheticInOutEvents(`mouse`, { e: e24, target: i2[a3], oldTarget: r2[a3] });
      this._hoveredActualTarget = a2, this._hoveredTarget = t2, this._hoveredTargets = i2;
    }
    _fireEnterLeaveEvents(e24, t2, n2) {
      let r2 = this._draggedoverTarget, i2 = this._hoveredTargets, { subTargets: a2 } = this.findTarget(e24), o2 = Math.max(i2.length, a2.length);
      this.fireSyntheticInOutEvents(`drag`, { ...n2, target: t2, oldTarget: r2, fireCanvas: true });
      for (let e25 = 0; e25 < o2; e25++) this.fireSyntheticInOutEvents(`drag`, { ...n2, target: a2[e25], oldTarget: i2[e25] });
      this._draggedoverTarget = t2;
    }
    fireSyntheticInOutEvents(e24, { target: t2, oldTarget: n2, actualTarget: r2, oldActualTarget: i2, fireCanvas: a2, e: o2, ...s2 }) {
      let { targetIn: c2, targetOut: l2, canvasIn: u2, canvasOut: d2 } = mo[e24], f2 = n2 !== t2, p2 = i2 !== r2, m = t2 && f2, h2 = r2 && p2, g2 = n2 && f2, _2 = i2 && p2, v2 = { ...s2, e: o2, ...fo(this, o2) }, y2 = { ...v2, target: n2, nextTarget: t2, actualTarget: i2, nextActualTarget: r2 };
      (g2 || _2) && a2 && this.fire(d2, y2), g2 && n2.fire(l2, y2), _2 && n2 !== i2 && i2.fire(l2, y2);
      let b2 = { ...v2, target: t2, previousTarget: n2, actualTarget: r2, previousActualTarget: i2 };
      (m || h2) && a2 && this.fire(u2, b2), m && t2.fire(c2, b2), h2 && r2 !== t2 && r2.fire(c2, b2);
    }
    _transformObject(e24) {
      let t2 = this.getScenePoint(e24), n2 = this._currentTransform, r2 = n2.target, i2 = r2.group ? Mt(t2, void 0, r2.group.calcTransformMatrix()) : t2;
      n2.shiftKey = e24.shiftKey, n2.altKey = !!this.centeredKey && e24[this.centeredKey], this._performTransformAction(e24, n2, i2), n2.actionPerformed && this.requestRenderAll();
    }
    _performTransformAction(e24, t2, n2) {
      let { action: r2, actionHandler: i2, target: a2 } = t2, o2 = !!i2 && i2(e24, t2, n2.x, n2.y);
      o2 && a2.setCoords(), r2 === `drag` && o2 && (t2.target.isMoving = true, this.setCursor(t2.target.moveCursor || this.moveCursor)), t2.actionPerformed = t2.actionPerformed || o2;
    }
    _setCursorFromEvent(e24, t2) {
      if (!t2) return void this.setCursor(this.defaultCursor);
      let n2 = t2.hoverCursor || this.hoverCursor, r2 = at(this._activeObject) ? this._activeObject : null, i2 = (!r2 || t2.group !== r2) && t2.findControl(this.getViewportPoint(e24));
      if (i2) {
        let { control: n3, coord: r3 } = i2;
        this.setCursor(n3.cursorStyleHandler(e24, n3, t2, r3));
      } else {
        if (t2.subTargetCheck) {
          let { subTargets: t3 } = this.findTarget(e24);
          t3.concat().reverse().forEach((e25) => {
            n2 = e25.hoverCursor || n2;
          });
        }
        this.setCursor(n2);
      }
    }
    handleMultiSelection(e24, t2) {
      let n2 = this._activeObject, r2 = at(n2);
      if (n2 && this._isSelectionKeyPressed(e24) && this.selection && t2 && t2.selectable && (n2 !== t2 || r2) && (r2 || !t2.isDescendantOf(n2) && !n2.isDescendantOf(t2)) && !t2.onSelect({ e: e24 }) && !n2.getActiveControl()) {
        if (r2) {
          let r3 = n2.getObjects(), i2 = [];
          if (t2 === n2) {
            let n3 = this.getScenePoint(e24), a2 = this.searchPossibleTargets(r3, n3);
            if (a2.target ? (t2 = a2.target, i2 = a2.subTargets) : (a2 = this.searchPossibleTargets(this._objects, n3), t2 = a2.target, i2 = a2.subTargets), !t2 || !t2.selectable) return false;
          }
          t2.group === n2 ? (n2.remove(t2), this._hoveredTarget = t2, this._hoveredTargets = i2, n2.size() === 1 && this._setActiveObject(n2.item(0), e24)) : (n2.multiSelectAdd(t2), this._hoveredTarget = n2, this._hoveredTargets = i2), this._fireSelectionEvents(r3, e24);
        } else {
          n2.isEditing && n2.exitEditing();
          let r3 = new (M.getClass(`ActiveSelection`))([], { canvas: this });
          r3.multiSelectAdd(n2, t2), this._hoveredTarget = r3, this._setActiveObject(r3, e24), this._fireSelectionEvents([n2], e24);
        }
        return true;
      }
      return false;
    }
    handleSelection(e24) {
      if (!this.selection || !this._groupSelector) return false;
      let { x: t2, y: n2, deltaX: r2, deltaY: i2 } = this._groupSelector, a2 = new N(t2, n2), o2 = a2.add(new N(r2, i2)), s2 = a2.min(o2), c2 = a2.max(o2).subtract(s2), l2 = this.collectObjects({ left: s2.x, top: s2.y, width: c2.x, height: c2.y }, { includeIntersecting: !this.selectionFullyContained }), u2 = a2.eq(o2) ? l2[0] ? [l2[0]] : [] : l2.length > 1 ? l2.filter((t3) => !t3.onSelect({ e: e24 })).reverse() : l2;
      if (u2.length === 1) this.setActiveObject(u2[0], e24);
      else if (u2.length > 1) {
        let t3 = M.getClass(`ActiveSelection`);
        this.setActiveObject(new t3(u2, { canvas: this }), e24);
      }
      return this._groupSelector = null, true;
    }
    toCanvasElement(e24 = 1, t2) {
      let { upper: n2 } = this.elements;
      n2.ctx = void 0;
      let r2 = super.toCanvasElement(e24, t2);
      return n2.ctx = n2.el.getContext(`2d`), r2;
    }
    clear() {
      this.textEditingManager.clear(), super.clear();
    }
    destroy() {
      this.removeListeners(), this.textEditingManager.dispose(), super.destroy();
    }
  };
  var go = { x1: 0, y1: 0, x2: 0, y2: 0 };
  var _o = { ...go, r1: 0, r2: 0 };
  var vo = (e24, t2) => isNaN(e24) && typeof t2 == `number` ? t2 : e24;
  function yo(e24) {
    return e24 && /%$/.test(e24) && Number.isFinite(parseFloat(e24));
  }
  function bo(e24, t2) {
    return Vn(0, vo(typeof e24 == `number` ? e24 : typeof e24 == `string` ? parseFloat(e24) / (yo(e24) ? 100 : 1) : NaN, t2), 1);
  }
  var xo = /\s*;\s*/;
  var So = /\s*:\s*/;
  function Co(e24, t2) {
    let n2, r2, i2 = e24.getAttribute(`style`);
    if (i2) {
      let e25 = i2.split(xo);
      e25[e25.length - 1] === `` && e25.pop();
      for (let t3 = e25.length; t3--; ) {
        let [i3, a3] = e25[t3].split(So).map((e26) => e26.trim());
        i3 === `stop-color` ? n2 = a3 : i3 === `stop-opacity` && (r2 = a3);
      }
    }
    n2 = n2 || e24.getAttribute(`stop-color`) || `rgb(0,0,0)`, r2 = vo(parseFloat(r2 || e24.getAttribute(`stop-opacity`) || ``), 1);
    let a2 = new G(n2);
    return a2.setAlpha(a2.getAlpha() * r2 * t2), { offset: bo(e24.getAttribute(`offset`), 0), color: a2.toRgba() };
  }
  function wo(e24, t2) {
    let n2 = [], r2 = e24.getElementsByTagName(`stop`), i2 = bo(t2, 1);
    for (let e25 = r2.length; e25--; ) n2.push(Co(r2[e25], i2));
    return n2;
  }
  function To(e24) {
    return e24.nodeName === `linearGradient` || e24.nodeName === `LINEARGRADIENT` ? `linear` : `radial`;
  }
  function Eo(e24) {
    return e24.getAttribute(`gradientUnits`) === `userSpaceOnUse` ? `pixels` : `percentage`;
  }
  function Do(e24, t2) {
    return e24.getAttribute(t2);
  }
  function Oo(e24, t2) {
    return function(e25, { width: t3, height: n2, gradientUnits: r2 }) {
      let i2;
      return Object.entries(e25).reduce((e26, [a2, o2]) => {
        if (o2 === `Infinity`) i2 = 1;
        else if (o2 === `-Infinity`) i2 = 0;
        else {
          let e27 = typeof o2 == `string`;
          i2 = e27 ? parseFloat(o2) : o2, e27 && yo(o2) && (i2 *= 0.01, r2 === `pixels` && (a2 !== `x1` && a2 !== `x2` && a2 !== `r2` || (i2 *= t3), a2 !== `y1` && a2 !== `y2` || (i2 *= n2)));
        }
        return e26[a2] = i2, e26;
      }, {});
    }(To(e24) === `linear` ? function(e25) {
      return { x1: Do(e25, `x1`) || 0, y1: Do(e25, `y1`) || 0, x2: Do(e25, `x2`) || `100%`, y2: Do(e25, `y2`) || 0 };
    }(e24) : function(e25) {
      return { x1: Do(e25, `fx`) || Do(e25, `cx`) || `50%`, y1: Do(e25, `fy`) || Do(e25, `cy`) || `50%`, r1: 0, x2: Do(e25, `cx`) || `50%`, y2: Do(e25, `cy`) || `50%`, r2: Do(e25, `r`) || `50%` };
    }(e24), { ...t2, gradientUnits: Eo(e24) });
  }
  var ko = class {
    constructor(e24) {
      let { type: t2 = `linear`, gradientUnits: n2 = `pixels`, coords: r2 = {}, colorStops: i2 = [], offsetX: a2 = 0, offsetY: o2 = 0, gradientTransform: s2, id: c2 } = e24 || {};
      Object.assign(this, { type: t2, gradientUnits: n2, coords: { ...t2 === `radial` ? _o : go, ...r2 }, colorStops: i2, offsetX: a2, offsetY: o2, gradientTransform: s2, id: c2 ? `${c2}_${je()}` : je() });
    }
    addColorStop(e24) {
      for (let t2 in e24) this.colorStops.push({ offset: parseFloat(t2), color: e24[t2] });
      return this;
    }
    toObject(e24) {
      return { ...et(this, e24), type: this.type, coords: { ...this.coords }, colorStops: this.colorStops.map((e25) => ({ ...e25 })), offsetX: this.offsetX, offsetY: this.offsetY, gradientUnits: this.gradientUnits, gradientTransform: this.gradientTransform ? [...this.gradientTransform] : void 0 };
    }
    toSVG(e24, { additionalTransform: t2 } = {}) {
      let n2 = [], r2 = this.gradientTransform ? this.gradientTransform.concat() : T.concat(), i2 = this.gradientUnits === `pixels` ? `userSpaceOnUse` : `objectBoundingBox`, a2 = this.colorStops.map((e25) => ({ ...e25 })).sort((e25, t3) => e25.offset - t3.offset), o2 = -this.offsetX, s2 = -this.offsetY;
      var c2;
      i2 === `objectBoundingBox` ? (o2 /= e24.width, s2 /= e24.height) : (o2 += e24.width / 2, s2 += e24.height / 2), (c2 = e24) && typeof c2._renderPathCommands == `function` && this.gradientUnits !== `percentage` && (o2 -= e24.pathOffset.x, s2 -= e24.pathOffset.y), r2[4] -= o2, r2[5] -= s2;
      let l2 = [`id="SVGID_${U(String(this.id))}"`, `gradientUnits="${i2}"`, `gradientTransform="${t2 ? t2 + ` ` : ``}${nt(r2)}"`, ``].join(` `), u2 = (e25) => parseFloat(String(e25));
      if (this.type === `linear`) {
        let { x1: e25, y1: t3, x2: r3, y2: i3 } = this.coords, a3 = u2(e25), o3 = u2(t3), s3 = u2(r3), c3 = u2(i3);
        n2.push(`<linearGradient `, l2, ` x1="`, a3, `" y1="`, o3, `" x2="`, s3, `" y2="`, c3, `">
`);
      } else if (this.type === `radial`) {
        let { x1: e25, y1: t3, x2: r3, y2: i3, r1: o3, r2: s3 } = this.coords, c3 = u2(e25), d2 = u2(t3), f2 = u2(r3), p2 = u2(i3), m = u2(o3), h2 = u2(s3), g2 = m > h2;
        n2.push(`<radialGradient `, l2, ` cx="`, g2 ? c3 : f2, `" cy="`, g2 ? d2 : p2, `" r="`, g2 ? m : h2, `" fx="`, g2 ? f2 : c3, `" fy="`, g2 ? p2 : d2, `">
`), g2 && (a2.reverse(), a2.forEach((e26) => {
          e26.offset = 1 - e26.offset;
        }));
        let _2 = Math.min(m, h2);
        if (_2 > 0) {
          let e26 = _2 / Math.max(m, h2);
          a2.forEach((t4) => {
            t4.offset += e26 * (1 - t4.offset);
          });
        }
      }
      return a2.forEach(({ color: e25, offset: t3 }) => {
        let r3 = String(e25), i3 = nn(r3) ? r3 : new G(r3).toRgba();
        n2.push(`<stop offset="${100 * t3}%" style="stop-color:${U(i3)};"/>
`);
      }), n2.push(this.type === `linear` ? `</linearGradient>` : `</radialGradient>`, `
`), n2.join(``);
    }
    toLive(e24) {
      let { x1: t2, y1: n2, x2: r2, y2: i2, r1: a2, r2: o2 } = this.coords, s2 = this.type === `linear` ? e24.createLinearGradient(t2, n2, r2, i2) : e24.createRadialGradient(t2, n2, a2, r2, i2, o2);
      return this.colorStops.forEach(({ color: e25, offset: t3 }) => {
        s2.addColorStop(t3, e25);
      }), s2;
    }
    static async fromObject(e24) {
      let { colorStops: t2, gradientTransform: n2 } = e24;
      return new this({ ...e24, colorStops: t2 ? t2.map((e25) => ({ ...e25 })) : void 0, gradientTransform: n2 ? [...n2] : void 0 });
    }
    static fromElement(e24, t2, n2) {
      let r2 = Eo(e24), i2 = t2._findCenterFromElement();
      return new this({ id: e24.getAttribute(`id`) || void 0, type: To(e24), coords: Oo(e24, { width: n2.viewBoxWidth || n2.width, height: n2.viewBoxHeight || n2.height }), colorStops: wo(e24, n2.opacity), gradientUnits: r2, gradientTransform: Ki(e24.getAttribute(`gradientTransform`) || ``), ...r2 === `pixels` ? { offsetX: t2.width / 2 - i2.x, offsetY: t2.height / 2 - i2.y } : { offsetX: 0, offsetY: 0 } });
    }
  };
  i(ko, `type`, `Gradient`), M.setClass(ko, `gradient`), M.setClass(ko, `linear`), M.setClass(ko, `radial`);
  var Ao = class {
    get type() {
      return `pattern`;
    }
    set type(e24) {
      s(`warn`, `Setting type has no effect`, e24);
    }
    constructor(e24) {
      i(this, `repeat`, `repeat`), i(this, `offsetX`, 0), i(this, `offsetY`, 0), i(this, `crossOrigin`, ``), this.id = je(), Object.assign(this, e24);
    }
    isImageSource() {
      return !!this.source && typeof this.source.src == `string`;
    }
    isCanvasSource() {
      return !!this.source && !!this.source.toDataURL;
    }
    sourceToString() {
      return this.isImageSource() ? this.source.src : this.isCanvasSource() ? this.source.toDataURL() : ``;
    }
    toLive(e24) {
      return this.source && (!this.isImageSource() || this.source.complete && this.source.naturalWidth !== 0 && this.source.naturalHeight !== 0) ? e24.createPattern(this.source, this.repeat) : null;
    }
    toObject(e24 = []) {
      let { repeat: t2, crossOrigin: n2 } = this;
      return { ...et(this, e24), type: `pattern`, source: this.sourceToString(), repeat: t2, crossOrigin: n2, offsetX: B(this.offsetX, o.NUM_FRACTION_DIGITS), offsetY: B(this.offsetY, o.NUM_FRACTION_DIGITS), patternTransform: this.patternTransform ? [...this.patternTransform] : null };
    }
    toSVG({ width: e24, height: t2 }) {
      let { source: n2, repeat: r2, id: i2 } = this, a2 = vo(this.offsetX / e24, 0), o2 = vo(this.offsetY / t2, 0), s2 = r2 === `repeat-y` || r2 === `no-repeat` ? 1 + Math.abs(a2 || 0) : vo(n2.width / e24, 0), c2 = r2 === `repeat-x` || r2 === `no-repeat` ? 1 + Math.abs(o2 || 0) : vo(n2.height / t2, 0);
      return [`<pattern id="SVGID_${U(i2)}" x="${a2}" y="${o2}" width="${s2}" height="${c2}">`, `<image x="0" y="0" width="${n2.width}" height="${n2.height}" xlink:href="${U(this.sourceToString())}"></image>`, `</pattern>`, ``].join(`
`);
    }
    static async fromObject({ type: e24, source: t2, patternTransform: n2, ...r2 }, i2) {
      let a2 = await Ze(t2, { ...i2, crossOrigin: r2.crossOrigin });
      return new this({ ...r2, patternTransform: n2 && n2.slice(0), source: a2 });
    }
  };
  i(Ao, `type`, `Pattern`), M.setClass(Ao), M.setClass(Ao, `pattern`);
  var Mo = class e13 extends J {
    constructor(t2, { path: n2, left: r2, top: i2, ...a2 } = {}) {
      super(), Object.assign(this, e13.ownDefaults), this.setOptions(a2), this._setPath(t2 || [], true), typeof r2 == `number` && this.set(`left`, r2), typeof i2 == `number` && this.set(`top`, i2);
    }
    _setPath(e24, t2) {
      this.path = ba(Array.isArray(e24) ? e24 : La(e24)), this.setBoundingBox(t2);
    }
    _findCenterFromElement() {
      let e24 = this._calcBoundsFromPath();
      return new N(e24.left + e24.width / 2, e24.top + e24.height / 2);
    }
    _renderPathCommands(e24) {
      let t2 = -this.pathOffset.x, n2 = -this.pathOffset.y;
      e24.beginPath();
      for (let r2 of this.path) switch (r2[0]) {
        case `L`:
          e24.lineTo(r2[1] + t2, r2[2] + n2);
          break;
        case `M`:
          e24.moveTo(r2[1] + t2, r2[2] + n2);
          break;
        case `C`:
          e24.bezierCurveTo(r2[1] + t2, r2[2] + n2, r2[3] + t2, r2[4] + n2, r2[5] + t2, r2[6] + n2);
          break;
        case `Q`:
          e24.quadraticCurveTo(r2[1] + t2, r2[2] + n2, r2[3] + t2, r2[4] + n2);
          break;
        case `Z`:
          e24.closePath();
      }
    }
    _render(e24) {
      this._renderPathCommands(e24), this._renderPaintInOrder(e24);
    }
    toString() {
      return `#<Path (${this.complexity()}): { "top": ${this.top}, "left": ${this.left} }>`;
    }
    toObject(e24 = []) {
      return { ...super.toObject(e24), path: this.path.map((e25) => e25.slice()) };
    }
    toDatalessObject(e24 = []) {
      let t2 = this.toObject(e24);
      return this.sourcePath && (delete t2.path, t2.sourcePath = this.sourcePath), t2;
    }
    _toSVG() {
      return [`<path `, `COMMON_PARTS`, `d="${Va(this.path, o.NUM_FRACTION_DIGITS)}" stroke-linecap="round" />
`];
    }
    _getOffsetTransform() {
      let e24 = o.NUM_FRACTION_DIGITS;
      return ` translate(${B(-this.pathOffset.x, e24)}, ${B(-this.pathOffset.y, e24)})`;
    }
    toClipPathSVG(e24) {
      let t2 = this._getOffsetTransform();
      return `	` + this._createBaseClipPathSVGMarkup(this._toSVG(), { reviver: e24, additionalTransform: t2 });
    }
    toSVG(e24) {
      let t2 = this._getOffsetTransform();
      return this._createBaseSVGMarkup(this._toSVG(), { reviver: e24, additionalTransform: t2 });
    }
    complexity() {
      return this.path.length;
    }
    setDimensions() {
      this.setBoundingBox();
    }
    setBoundingBox(e24) {
      let { width: t2, height: n2, pathOffset: r2 } = this._calcDimensions();
      this.set({ width: t2, height: n2, pathOffset: r2 }), e24 && this.setPositionByOrigin(r2, `center`, `center`);
    }
    _calcBoundsFromPath() {
      let e24 = [], t2 = 0, n2 = 0, r2 = 0, i2 = 0;
      for (let a2 of this.path) switch (a2[0]) {
        case `L`:
          r2 = a2[1], i2 = a2[2], e24.push({ x: t2, y: n2 }, { x: r2, y: i2 });
          break;
        case `M`:
          r2 = a2[1], i2 = a2[2], t2 = r2, n2 = i2;
          break;
        case `C`:
          e24.push(...va(r2, i2, a2[1], a2[2], a2[3], a2[4], a2[5], a2[6])), r2 = a2[5], i2 = a2[6];
          break;
        case `Q`:
          e24.push(...va(r2, i2, a2[1], a2[2], a2[1], a2[2], a2[3], a2[4])), r2 = a2[3], i2 = a2[4];
          break;
        case `Z`:
          r2 = t2, i2 = n2;
      }
      return wt(e24);
    }
    _calcDimensions() {
      let e24 = this._calcBoundsFromPath();
      return { ...e24, pathOffset: new N(e24.left + e24.width / 2, e24.top + e24.height / 2) };
    }
    static fromObject(e24) {
      return this._fromObject(e24, { extraParam: `path` });
    }
    static async fromElement(e24, t2, n2) {
      let { d: r2, ...i2 } = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return new this(r2, { ...i2, ...t2, left: void 0, top: void 0 });
    }
  };
  i(Mo, `type`, `Path`), i(Mo, `cacheProperties`, [...Un, `path`, `fillRule`]), i(Mo, `ATTRIBUTE_NAMES`, [...ki, `d`]), M.setClass(Mo), M.setSVGClass(Mo);
  var Po = [`radius`, `startAngle`, `endAngle`, `counterClockwise`];
  var Fo = class e14 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e14.ownDefaults };
    }
    constructor(t2) {
      super(), Object.assign(this, e14.ownDefaults), this.setOptions(t2);
    }
    _set(e24, t2) {
      return super._set(e24, t2), e24 === `radius` && this.setRadius(t2), this;
    }
    _render(e24) {
      e24.beginPath(), e24.arc(0, 0, this.radius, I(this.startAngle), I(this.endAngle), this.counterClockwise), this._renderPaintInOrder(e24);
    }
    getRadiusX() {
      return this.get(`radius`) * this.get(de);
    }
    getRadiusY() {
      return this.get(`radius`) * this.get(fe);
    }
    setRadius(e24) {
      this.radius = e24, this.set({ width: 2 * e24, height: 2 * e24 });
    }
    toObject(e24 = []) {
      return super.toObject([...Po, ...e24]);
    }
    _toSVG() {
      let { radius: e24, startAngle: t2, endAngle: n2 } = this, r2 = (n2 - t2) % 360;
      if (r2 === 0) return [`<circle `, `COMMON_PARTS`, `cx="0" cy="0" `, `r="`, `${U(e24)}`, `" />
`];
      {
        let i2 = I(t2), a2 = I(n2), o2 = Se(i2) * e24, s2 = Ce(i2) * e24, c2 = Se(a2) * e24, l2 = Ce(a2) * e24;
        return [`<path d="M ${o2} ${s2} A ${e24} ${e24} 0 ${+(r2 > 180)} ${+!this.counterClockwise} ${c2} ${l2}" `, `COMMON_PARTS`, ` />
`];
      }
    }
    static async fromElement(e24, t2, n2) {
      let { left: r2 = 0, top: i2 = 0, radius: a2 = 0, ...o2 } = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return new this({ ...o2, radius: a2, left: r2 - a2, top: i2 - a2 });
    }
    static fromObject(e24) {
      return super._fromObject(e24);
    }
  };
  i(Fo, `type`, `Circle`), i(Fo, `cacheProperties`, [...Un, ...Po]), i(Fo, `ownDefaults`, { radius: 0, startAngle: 0, endAngle: 360, counterClockwise: false }), i(Fo, `ATTRIBUTE_NAMES`, [`cx`, `cy`, `r`, ...ki]), M.setClass(Fo), M.setSVGClass(Fo);
  var zo = [`x1`, `x2`, `y1`, `y2`];
  var Bo = class e15 extends J {
    constructor([t2, n2, r2, i2] = [0, 0, 0, 0], a2 = {}) {
      super(), Object.assign(this, e15.ownDefaults), this.setOptions(a2), this.x1 = t2, this.x2 = r2, this.y1 = n2, this.y2 = i2, this._setWidthHeight();
      let { left: o2, top: s2 } = a2;
      typeof o2 == `number` && this.set(`left`, o2), typeof s2 == `number` && this.set(`top`, s2);
    }
    _setWidthHeight() {
      let { x1: e24, y1: t2, x2: n2, y2: r2 } = this;
      this.width = Math.abs(n2 - e24), this.height = Math.abs(r2 - t2);
      let { left: i2, top: a2, width: o2, height: s2 } = wt([{ x: e24, y: t2 }, { x: n2, y: r2 }]), c2 = new N(i2 + o2 / 2, a2 + s2 / 2);
      this.setPositionByOrigin(c2, E, E);
    }
    _set(e24, t2) {
      return super._set(e24, t2), zo.includes(e24) && this._setWidthHeight(), this;
    }
    _render(e24) {
      e24.beginPath();
      let t2 = this.calcLinePoints();
      e24.moveTo(t2.x1, t2.y1), e24.lineTo(t2.x2, t2.y2), e24.lineWidth = this.strokeWidth;
      let n2 = e24.strokeStyle;
      var r2;
      V(this.stroke) ? e24.strokeStyle = this.stroke.toLive(e24) : e24.strokeStyle = (r2 = this.stroke) == null ? e24.fillStyle : r2, this.stroke && this._renderStroke(e24), e24.strokeStyle = n2;
    }
    _findCenterFromElement() {
      return new N((this.x1 + this.x2) / 2, (this.y1 + this.y2) / 2);
    }
    toObject(e24 = []) {
      return { ...super.toObject(e24), ...this.calcLinePoints() };
    }
    _getNonTransformedDimensions() {
      let e24 = super._getNonTransformedDimensions();
      return this.strokeLineCap === `butt` && (this.width === 0 && (e24.y -= this.strokeWidth), this.height === 0 && (e24.x -= this.strokeWidth)), e24;
    }
    calcLinePoints() {
      let { x1: e24, x2: t2, y1: n2, y2: r2, width: i2, height: a2 } = this, o2 = e24 <= t2 ? -0.5 : 0.5, s2 = n2 <= r2 ? -0.5 : 0.5;
      return { x1: o2 * i2, x2: o2 * -i2, y1: s2 * a2, y2: s2 * -a2 };
    }
    _toSVG() {
      let { x1: e24, x2: t2, y1: n2, y2: r2 } = this.calcLinePoints();
      return [`<line `, `COMMON_PARTS`, `x1="${e24}" y1="${n2}" x2="${t2}" y2="${r2}" />
`];
    }
    static async fromElement(e24, t2, n2) {
      let { x1: r2 = 0, y1: i2 = 0, x2: a2 = 0, y2: o2 = 0, ...s2 } = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return new this([r2, i2, a2, o2], s2);
    }
    static fromObject({ x1: e24, y1: t2, x2: n2, y2: r2, ...i2 }) {
      return this._fromObject({ ...i2, points: [e24, t2, n2, r2] }, { extraParam: `points` });
    }
  };
  i(Bo, `type`, `Line`), i(Bo, `cacheProperties`, [...Un, ...zo]), i(Bo, `ATTRIBUTE_NAMES`, ki.concat(zo)), M.setClass(Bo), M.setSVGClass(Bo);
  var Vo = class e16 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e16.ownDefaults };
    }
    constructor(t2) {
      super(), Object.assign(this, e16.ownDefaults), this.setOptions(t2);
    }
    _render(e24) {
      let t2 = this.width / 2, n2 = this.height / 2;
      e24.beginPath(), e24.moveTo(-t2, n2), e24.lineTo(0, -n2), e24.lineTo(t2, n2), e24.closePath(), this._renderPaintInOrder(e24);
    }
    _toSVG() {
      let e24 = this.width / 2, t2 = this.height / 2;
      return [`<polygon `, `COMMON_PARTS`, `points="`, `${-e24} ${t2},0 ${-t2},${e24} ${t2}`, `" />`];
    }
  };
  i(Vo, `type`, `Triangle`), i(Vo, `ownDefaults`, { width: 100, height: 100 }), M.setClass(Vo), M.setSVGClass(Vo);
  var Ho = [`rx`, `ry`];
  var Uo = class e17 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e17.ownDefaults };
    }
    constructor(t2) {
      super(), Object.assign(this, e17.ownDefaults), this.setOptions(t2);
    }
    _set(e24, t2) {
      switch (super._set(e24, t2), e24) {
        case `rx`:
          this.rx = t2, this.set(`width`, 2 * t2);
          break;
        case `ry`:
          this.ry = t2, this.set(`height`, 2 * t2);
      }
      return this;
    }
    getRx() {
      return this.get(`rx`) * this.get(de);
    }
    getRy() {
      return this.get(`ry`) * this.get(fe);
    }
    toObject(e24 = []) {
      return super.toObject([...Ho, ...e24]);
    }
    _toSVG() {
      return [`<ellipse `, `COMMON_PARTS`, `cx="0" cy="0" rx="${U(this.rx)}" ry="${U(this.ry)}" />
`];
    }
    _render(e24) {
      e24.beginPath(), e24.save(), e24.transform(1, 0, 0, this.ry / this.rx, 0, 0), e24.arc(0, 0, this.rx, 0, w, false), e24.restore(), this._renderPaintInOrder(e24);
    }
    static async fromElement(e24, t2, n2) {
      let r2 = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return r2.left = (r2.left || 0) - r2.rx, r2.top = (r2.top || 0) - r2.ry, new this(r2);
    }
  };
  i(Uo, `type`, `Ellipse`), i(Uo, `cacheProperties`, [...Un, ...Ho]), i(Uo, `ownDefaults`, { rx: 0, ry: 0 }), i(Uo, `ATTRIBUTE_NAMES`, [...ki, `cx`, `cy`, `rx`, `ry`]), M.setClass(Uo), M.setSVGClass(Uo);
  var Wo = { exactBoundingBox: false };
  var Go = class e18 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e18.ownDefaults };
    }
    constructor(t2 = [], n2 = {}) {
      super(), i(this, `strokeDiff`, void 0), Object.assign(this, e18.ownDefaults), this.setOptions(n2), this.points = t2;
      let { left: r2, top: a2 } = n2;
      this.initialized = true, this.setBoundingBox(true), typeof r2 == `number` && this.set(`left`, r2), typeof a2 == `number` && this.set(`top`, a2);
    }
    isOpen() {
      return true;
    }
    _projectStrokeOnPoints(e24) {
      return wi(this.points, e24, this.isOpen());
    }
    _calcDimensions(e24) {
      e24 = { scaleX: this.scaleX, scaleY: this.scaleY, skewX: this.skewX, skewY: this.skewY, strokeLineCap: this.strokeLineCap, strokeLineJoin: this.strokeLineJoin, strokeMiterLimit: this.strokeMiterLimit, strokeUniform: this.strokeUniform, strokeWidth: this.strokeWidth, ...e24 || {} };
      let t2 = this.exactBoundingBox ? this._projectStrokeOnPoints(e24).map((e25) => e25.projectedPoint) : this.points;
      if (t2.length === 0) return { left: 0, top: 0, width: 0, height: 0, pathOffset: new N(), strokeOffset: new N(), strokeDiff: new N() };
      let n2 = wt(t2), r2 = Ye({ ...e24, scaleX: 1, scaleY: 1 }), i2 = wt(this.points.map((e25) => L(e25, r2, true))), a2 = new N(this.scaleX, this.scaleY), o2 = n2.left + n2.width / 2, s2 = n2.top + n2.height / 2;
      return this.exactBoundingBox && (o2 -= s2 * Math.tan(I(this.skewX)), s2 -= o2 * Math.tan(I(this.skewY))), { ...n2, pathOffset: new N(o2, s2), strokeOffset: new N(i2.left, i2.top).subtract(new N(n2.left, n2.top)).multiply(a2), strokeDiff: new N(n2.width, n2.height).subtract(new N(i2.width, i2.height)).multiply(a2) };
    }
    _findCenterFromElement() {
      let e24 = wt(this.points);
      return new N(e24.left + e24.width / 2, e24.top + e24.height / 2);
    }
    setDimensions() {
      this.setBoundingBox();
    }
    setBoundingBox(e24) {
      let { left: t2, top: n2, width: r2, height: i2, pathOffset: a2, strokeOffset: o2, strokeDiff: s2 } = this._calcDimensions();
      this.set({ width: r2, height: i2, pathOffset: a2, strokeOffset: o2, strokeDiff: s2 }), e24 && this.setPositionByOrigin(new N(t2 + r2 / 2, n2 + i2 / 2), `center`, `center`);
    }
    isStrokeAccountedForInDimensions() {
      return this.exactBoundingBox;
    }
    _getNonTransformedDimensions() {
      return this.exactBoundingBox ? new N(this.width, this.height) : super._getNonTransformedDimensions();
    }
    _getTransformedDimensions(e24 = {}) {
      if (this.exactBoundingBox) {
        let a2;
        if (Object.keys(e24).some((e25) => this.strokeUniform || this.constructor.layoutProperties.includes(e25))) {
          var t2, n2;
          let { width: r3, height: i3 } = this._calcDimensions(e24);
          a2 = new N((t2 = e24.width) == null ? r3 : t2, (n2 = e24.height) == null ? i3 : n2);
        } else {
          var r2, i2;
          a2 = new N((r2 = e24.width) == null ? this.width : r2, (i2 = e24.height) == null ? this.height : i2);
        }
        return a2.multiply(new N(e24.scaleX || this.scaleX, e24.scaleY || this.scaleY));
      }
      return super._getTransformedDimensions(e24);
    }
    _set(e24, t2) {
      let n2 = this.initialized && this[e24] !== t2, r2 = super._set(e24, t2);
      return this.exactBoundingBox && n2 && ((e24 === `scaleX` || e24 === `scaleY`) && this.strokeUniform && this.constructor.layoutProperties.includes(`strokeUniform`) || this.constructor.layoutProperties.includes(e24)) && this.setDimensions(), r2;
    }
    toObject(e24 = []) {
      return { ...super.toObject(e24), points: this.points.map(({ x: e25, y: t2 }) => ({ x: e25, y: t2 })) };
    }
    _toSVG() {
      let e24 = this.pathOffset.x, t2 = this.pathOffset.y, n2 = o.NUM_FRACTION_DIGITS, r2 = this.points.map(({ x: r3, y: i2 }) => `${B(r3 - e24, n2)},${B(i2 - t2, n2)}`).join(` `);
      return [`<${U(this.constructor.type).toLowerCase()} `, `COMMON_PARTS`, `points="${r2}" />
`];
    }
    _render(e24) {
      let t2 = this.points.length, n2 = this.pathOffset.x, r2 = this.pathOffset.y;
      if (t2 && !isNaN(this.points[t2 - 1].y)) {
        e24.beginPath(), e24.moveTo(this.points[0].x - n2, this.points[0].y - r2);
        for (let i2 = 0; i2 < t2; i2++) {
          let t3 = this.points[i2];
          e24.lineTo(t3.x - n2, t3.y - r2);
        }
        !this.isOpen() && e24.closePath(), this._renderPaintInOrder(e24);
      }
    }
    complexity() {
      return this.points.length;
    }
    static async fromElement(e24, t2, n2) {
      let r2 = function(e25) {
        if (!e25) return [];
        let t3 = e25.replace(/,/g, ` `).trim().split(/\s+/), n3 = [];
        for (let e26 = 0; e26 < t3.length; e26 += 2) n3.push({ x: parseFloat(t3[e26]), y: parseFloat(t3[e26 + 1]) });
        return n3;
      }(e24.getAttribute(`points`)), { left: i2, top: a2, ...o2 } = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return new this(r2, { ...o2, ...t2 });
    }
    static fromObject(e24) {
      return this._fromObject(e24, { extraParam: `points` });
    }
  };
  i(Go, `ownDefaults`, Wo), i(Go, `type`, `Polyline`), i(Go, `layoutProperties`, [pe, me, `strokeLineCap`, `strokeLineJoin`, `strokeMiterLimit`, `strokeWidth`, `strokeUniform`, `points`]), i(Go, `cacheProperties`, [...Un, `points`]), i(Go, `ATTRIBUTE_NAMES`, [...ki]), M.setClass(Go), M.setSVGClass(Go);
  var Ko = class extends Go {
    isOpen() {
      return false;
    }
  };
  i(Ko, `ownDefaults`, Wo), i(Ko, `type`, `Polygon`), M.setClass(Ko), M.setSVGClass(Ko);
  var qo = class extends J {
    isEmptyStyles(e24) {
      if (!this.styles || e24 !== void 0 && !this.styles[e24]) return true;
      let t2 = e24 === void 0 ? this.styles : { line: this.styles[e24] };
      for (let e25 in t2) for (let n2 in t2[e25]) for (let r2 in t2[e25][n2]) return false;
      return true;
    }
    styleHas(e24, t2) {
      if (!this.styles || t2 !== void 0 && !this.styles[t2]) return false;
      let n2 = t2 === void 0 ? this.styles : { 0: this.styles[t2] };
      for (let t3 in n2) for (let r2 in n2[t3]) if (n2[t3][r2][e24] !== void 0) return true;
      return false;
    }
    cleanStyle(e24) {
      if (!this.styles) return false;
      let t2 = this.styles, n2, r2, i2 = 0, a2 = true, o2 = 0;
      for (let o3 in t2) {
        n2 = 0;
        for (let s2 in t2[o3]) {
          let c2 = t2[o3][s2] || {};
          i2++, c2[e24] === void 0 ? a2 = false : (r2 ? c2[e24] !== r2 && (a2 = false) : r2 = c2[e24], c2[e24] === this[e24] && delete c2[e24]), Object.keys(c2).length === 0 ? delete t2[o3][s2] : n2++;
        }
        n2 === 0 && delete t2[o3];
      }
      for (let e25 = 0; e25 < this._textLines.length; e25++) o2 += this._textLines[e25].length;
      a2 && i2 === o2 && (this[e24] = r2, this.removeStyle(e24));
    }
    removeStyle(e24) {
      if (!this.styles) return;
      let t2 = this.styles, n2, r2, i2;
      for (r2 in t2) {
        for (i2 in n2 = t2[r2], n2) delete n2[i2][e24], Object.keys(n2[i2]).length === 0 && delete n2[i2];
        Object.keys(n2).length === 0 && delete t2[r2];
      }
    }
    _extendStyles(e24, t2) {
      let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e24);
      this._getLineStyle(n2) || this._setLineStyle(n2);
      let i2 = tt({ ...this._getStyleDeclaration(n2, r2), ...t2 }, (e25) => e25 !== void 0);
      this._setStyleDeclaration(n2, r2, i2);
    }
    getSelectionStyles(e24, t2, n2) {
      let r2 = [];
      for (let i2 = e24; i2 < (t2 || e24); i2++) r2.push(this.getStyleAtPosition(i2, n2));
      return r2;
    }
    getStyleAtPosition(e24, t2) {
      let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e24);
      return t2 ? this.getCompleteStyleDeclaration(n2, r2) : this._getStyleDeclaration(n2, r2);
    }
    setSelectionStyles(e24, t2, n2) {
      for (let r2 = t2; r2 < (n2 || t2); r2++) this._extendStyles(r2, e24);
      this._forceClearCache = true;
    }
    _getStyleDeclaration(e24, t2) {
      var n2;
      let r2 = this.styles && this.styles[e24];
      return r2 && (n2 = r2[t2]) != null ? n2 : {};
    }
    getCompleteStyleDeclaration(e24, t2) {
      return { ...et(this, this.constructor._styleProperties), ...this._getStyleDeclaration(e24, t2) };
    }
    _setStyleDeclaration(e24, t2, n2) {
      this.styles[e24][t2] = n2;
    }
    _deleteStyleDeclaration(e24, t2) {
      delete this.styles[e24][t2];
    }
    _getLineStyle(e24) {
      return !!this.styles[e24];
    }
    _setLineStyle(e24) {
      this.styles[e24] = {};
    }
    _deleteLineStyle(e24) {
      delete this.styles[e24];
    }
  };
  i(qo, `_styleProperties`, wn);
  var Jo = /  +/g;
  var Yo = /"/g;
  function Xo(e24, t2, n2, r2, i2) {
    return `		${((e25, { left: t3, top: n3, width: r3, height: i3 }, a2 = o.NUM_FRACTION_DIGITS) => {
      let s2 = hn(j, e25, false), [c2, l2, u2, d2] = [t3, n3, r3, i3].map((e26) => B(e26, a2));
      return `<rect ${s2} x="${c2}" y="${l2}" width="${u2}" height="${d2}"></rect>`;
    })(e24, { left: t2, top: n2, width: r2, height: i2 })}
`;
  }
  var Zo;
  var Q = class e19 extends qo {
    static getDefaults() {
      return { ...super.getDefaults(), ...e19.ownDefaults };
    }
    constructor(t2, n2) {
      super(), i(this, `__charBounds`, []), Object.assign(this, e19.ownDefaults), this.setOptions(n2), this.styles || (this.styles = {}), this.text = t2, this.initialized = true, this.path && this.setPathInfo(), this.initDimensions(), this.setCoords();
    }
    setPathInfo() {
      let e24 = this.path;
      e24 && (e24.segmentsInfo = ja(e24.path));
    }
    _splitText() {
      let e24 = this._splitTextIntoLines(this.text);
      return this.textLines = e24.lines, this._textLines = e24.graphemeLines, this._unwrappedTextLines = e24._unwrappedLines, this._text = e24.graphemeText, e24;
    }
    initDimensions() {
      this._splitText(), this._clearCache(), this.dirty = true, this.path ? (this.width = this.path.width, this.height = this.path.height) : (this.width = this.calcTextWidth() || this.cursorWidth || this.MIN_TEXT_WIDTH, this.height = this.calcTextHeight()), this.textAlign.includes(`justify`) && this.enlargeSpaces();
    }
    enlargeSpaces() {
      let e24, t2, n2, r2, i2, a2, o2;
      for (let s2 = 0, c2 = this._textLines.length; s2 < c2; s2++) if ((this.textAlign === `justify` || s2 !== c2 - 1 && !this.isEndOfWrapping(s2)) && (r2 = 0, i2 = this._textLines[s2], t2 = this.getLineWidth(s2), t2 < this.width && (o2 = this.textLines[s2].match(this._reSpacesAndTabs)))) {
        n2 = o2.length, e24 = (this.width - t2) / n2;
        for (let t3 = 0; t3 <= i2.length; t3++) a2 = this.__charBounds[s2][t3], this._reSpaceAndTab.test(i2[t3]) ? (a2.width += e24, a2.kernedWidth += e24, a2.left += r2, r2 += e24) : a2.left += r2;
      }
    }
    isEndOfWrapping(e24) {
      return e24 === this._textLines.length - 1;
    }
    missingNewlineOffset(e24) {
      return 1;
    }
    get2DCursorLocation(e24, t2) {
      let n2 = t2 ? this._unwrappedTextLines : this._textLines, r2;
      for (r2 = 0; r2 < n2.length; r2++) {
        if (e24 <= n2[r2].length) return { lineIndex: r2, charIndex: e24 };
        e24 -= n2[r2].length + this.missingNewlineOffset(r2, t2);
      }
      return { lineIndex: r2 - 1, charIndex: n2[r2 - 1].length < e24 ? n2[r2 - 1].length : e24 };
    }
    toString() {
      return `#<Text (${this.complexity()}): { "text": "${this.text}", "fontFamily": "${this.fontFamily}" }>`;
    }
    _getCacheCanvasDimensions() {
      let e24 = super._getCacheCanvasDimensions(), t2 = this.fontSize;
      return e24.width += t2 * e24.zoomX, e24.height += t2 * e24.zoomY, e24;
    }
    _render(e24) {
      let t2 = this.path;
      t2 && !t2.isNotVisible() && t2._render(e24), this._setTextStyles(e24), this._renderTextLinesBackground(e24), this._renderTextDecoration(e24, `underline`), this._renderText(e24), this._renderTextDecoration(e24, `overline`), this._renderTextDecoration(e24, `linethrough`);
    }
    _renderText(e24) {
      this.paintFirst === `stroke` ? (this._renderTextStroke(e24), this._renderTextFill(e24)) : (this._renderTextFill(e24), this._renderTextStroke(e24));
    }
    _setTextStyles(e24, t2, n2) {
      if (e24.textBaseline = `alphabetic`, this.path) switch (this.pathAlign) {
        case E:
          e24.textBaseline = `middle`;
          break;
        case `ascender`:
          e24.textBaseline = `top`;
          break;
        case `descender`:
          e24.textBaseline = O;
      }
      e24.font = this._getFontDeclaration(t2, n2);
    }
    calcTextWidth() {
      let e24 = this.getLineWidth(0);
      for (let t2 = 1, n2 = this._textLines.length; t2 < n2; t2++) {
        let n3 = this.getLineWidth(t2);
        n3 > e24 && (e24 = n3);
      }
      return e24;
    }
    _renderTextLine(e24, t2, n2, r2, i2, a2) {
      this._renderChars(e24, t2, n2, r2, i2, a2);
    }
    _renderTextLinesBackground(e24) {
      if (!this.textBackgroundColor && !this.styleHas(`textBackgroundColor`)) return;
      let t2 = e24.fillStyle, n2 = this._getLeftOffset(), r2 = this._getTopOffset();
      for (let t3 = 0, i2 = this._textLines.length; t3 < i2; t3++) {
        let i3 = this.getHeightOfLine(t3);
        if (!this.textBackgroundColor && !this.styleHas(`textBackgroundColor`, t3)) {
          r2 += i3;
          continue;
        }
        let a2 = this._textLines[t3].length, o2 = this._getLineLeftOffset(t3), s2, c2, l2 = 0, u2 = 0, d2 = this.getValueOfPropertyAt(t3, 0, `textBackgroundColor`), f2 = this.getHeightOfLineImpl(t3);
        for (let i4 = 0; i4 < a2; i4++) {
          let a3 = this.__charBounds[t3][i4];
          c2 = this.getValueOfPropertyAt(t3, i4, `textBackgroundColor`), this.path ? (e24.save(), e24.translate(a3.renderLeft, a3.renderTop), e24.rotate(a3.angle), e24.fillStyle = c2, c2 && e24.fillRect(-a3.width / 2, -f2 * (1 - this._fontSizeFraction), a3.width, f2), e24.restore()) : c2 === d2 ? l2 += a3.kernedWidth : (s2 = n2 + o2 + u2, this.direction === `rtl` && (s2 = this.width - s2 - l2), e24.fillStyle = d2, d2 && e24.fillRect(s2, r2, l2, f2), u2 = a3.left, l2 = a3.width, d2 = c2);
        }
        c2 && !this.path && (s2 = n2 + o2 + u2, this.direction === `rtl` && (s2 = this.width - s2 - l2), e24.fillStyle = c2, e24.fillRect(s2, r2, l2, f2)), r2 += i3;
      }
      e24.fillStyle = t2, this._removeShadow(e24);
    }
    _measureChar(e24, t2, n2, r2) {
      let i2 = y.getFontCache(t2), a2 = this._getFontDeclaration(t2), o2 = n2 ? n2 + e24 : e24, s2 = n2 && a2 === this._getFontDeclaration(r2), c2 = t2.fontSize / this.CACHE_FONT_SIZE, l2, u2, d2, f2;
      if (n2 && i2.has(n2) && (d2 = i2.get(n2)), i2.has(e24) && (f2 = l2 = i2.get(e24)), s2 && i2.has(o2) && (u2 = i2.get(o2), f2 = u2 - d2), l2 === void 0 || d2 === void 0 || u2 === void 0) {
        let r3 = (Zo || (Zo = F({ width: 0, height: 0 }).getContext(`2d`)), Zo);
        this._setTextStyles(r3, t2, true), l2 === void 0 && (f2 = l2 = r3.measureText(e24).width, i2.set(e24, l2)), d2 === void 0 && s2 && n2 && (d2 = r3.measureText(n2).width, i2.set(n2, d2)), s2 && u2 === void 0 && (u2 = r3.measureText(o2).width, i2.set(o2, u2), f2 = u2 - d2);
      }
      return { width: l2 * c2, kernedWidth: f2 * c2 };
    }
    getHeightOfChar(e24, t2) {
      return this.getValueOfPropertyAt(e24, t2, `fontSize`);
    }
    measureLine(e24) {
      let t2 = this._measureLine(e24);
      return this.charSpacing !== 0 && (t2.width -= this._getWidthOfCharSpacing()), t2.width < 0 && (t2.width = 0), t2;
    }
    _measureLine(e24) {
      let t2, n2, r2 = 0, i2 = this.pathSide === k, a2 = this.path, o2 = this._textLines[e24], s2 = o2.length, c2 = Array(s2);
      this.__charBounds[e24] = c2;
      for (let i3 = 0; i3 < s2; i3++) {
        let a3 = o2[i3];
        n2 = this._getGraphemeBox(a3, e24, i3, t2), c2[i3] = n2, r2 += n2.kernedWidth, t2 = a3;
      }
      if (c2[s2] = { left: n2 ? n2.left + n2.width : 0, width: 0, kernedWidth: 0, height: this.fontSize, deltaY: 0 }, a2 && a2.segmentsInfo) {
        let e25 = 0, t3 = a2.segmentsInfo[a2.segmentsInfo.length - 1].length;
        switch (this.textAlign) {
          case D:
            e25 = i2 ? t3 - r2 : 0;
            break;
          case E:
            e25 = (t3 - r2) / 2;
            break;
          case k:
            e25 = i2 ? 0 : t3 - r2;
        }
        e25 += this.pathStartOffset * (i2 ? -1 : 1);
        for (let r3 = i2 ? s2 - 1 : 0; i2 ? r3 >= 0 : r3 < s2; i2 ? r3-- : r3++) n2 = c2[r3], e25 > t3 ? e25 %= t3 : e25 < 0 && (e25 += t3), this._setGraphemeOnPath(e25, n2), e25 += n2.kernedWidth;
      }
      return { width: r2, numOfSpaces: 0 };
    }
    _setGraphemeOnPath(e24, t2) {
      let n2 = e24 + t2.kernedWidth / 2, r2 = this.path, i2 = Ma(r2.path, n2, r2.segmentsInfo);
      t2.renderLeft = i2.x - r2.pathOffset.x, t2.renderTop = i2.y - r2.pathOffset.y, t2.angle = i2.angle + (this.pathSide === `right` ? Math.PI : 0);
    }
    _getGraphemeBox(e24, t2, n2, r2, i2) {
      let a2 = this.getCompleteStyleDeclaration(t2, n2), o2 = r2 ? this.getCompleteStyleDeclaration(t2, n2 - 1) : {}, s2 = this._measureChar(e24, a2, r2, o2), c2, l2 = s2.kernedWidth, u2 = s2.width;
      this.charSpacing !== 0 && (c2 = this._getWidthOfCharSpacing(), u2 += c2, l2 += c2);
      let d2 = { width: u2, left: 0, height: a2.fontSize, kernedWidth: l2, deltaY: a2.deltaY };
      if (n2 > 0 && !i2) {
        let e25 = this.__charBounds[t2][n2 - 1];
        d2.left = e25.left + e25.width + s2.kernedWidth - s2.width;
      }
      return d2;
    }
    getHeightOfLineImpl(e24) {
      let t2 = this.__lineHeights;
      if (t2[e24]) return t2[e24];
      let n2 = this.getHeightOfChar(e24, 0);
      for (let t3 = 1, r2 = this._textLines[e24].length; t3 < r2; t3++) n2 = Math.max(this.getHeightOfChar(e24, t3), n2);
      return t2[e24] = n2 * this._fontSizeMult;
    }
    getHeightOfLine(e24) {
      return this.getHeightOfLineImpl(e24) * this.lineHeight;
    }
    calcTextHeight() {
      let e24 = 0;
      for (let t2 = 0, n2 = this._textLines.length; t2 < n2; t2++) e24 += t2 === n2 - 1 ? this.getHeightOfLineImpl(t2) : this.getHeightOfLine(t2);
      return e24;
    }
    _getLeftOffset() {
      return this.direction === `ltr` ? -this.width / 2 : this.width / 2;
    }
    _getTopOffset() {
      return -this.height / 2;
    }
    _renderTextCommon(e24, t2) {
      e24.save();
      let n2 = 0, r2 = this._getLeftOffset(), i2 = this._getTopOffset();
      for (let a2 = 0, o2 = this._textLines.length; a2 < o2; a2++) this._renderTextLine(t2, e24, this._textLines[a2], r2 + this._getLineLeftOffset(a2), i2 + n2 + this.getHeightOfLineImpl(a2), a2), n2 += this.getHeightOfLine(a2);
      e24.restore();
    }
    _renderTextFill(e24) {
      (this.fill || this.styleHas(`fill`)) && this._renderTextCommon(e24, `fillText`);
    }
    _renderTextStroke(e24) {
      (this.stroke && this.strokeWidth !== 0 || !this.isEmptyStyles()) && (this.shadow && !this.shadow.affectStroke && this._removeShadow(e24), e24.save(), this._setLineDash(e24, this.strokeDashArray), e24.beginPath(), this._renderTextCommon(e24, `strokeText`), e24.closePath(), e24.restore());
    }
    _renderChars(e24, t2, n2, r2, i2, a2) {
      let o2 = this.textAlign.includes(En), s2 = this.path, c2 = !o2 && this.charSpacing === 0 && this.isEmptyStyles(a2) && !s2, l2 = this.direction === `ltr`, u2 = this.direction === `ltr` ? 1 : -1, d2 = t2.direction, f2, p2, m, h2, g2, _2 = ``, v2 = 0;
      if (t2.save(), d2 !== this.direction && (t2.canvas.setAttribute(`dir`, l2 ? `ltr` : `rtl`), t2.direction = l2 ? `ltr` : `rtl`, t2.textAlign = l2 ? D : k), i2 -= this.getHeightOfLineImpl(a2) * this._fontSizeFraction, c2) return this._renderChar(e24, t2, a2, 0, n2.join(``), r2, i2), void t2.restore();
      for (let c3 = 0, l3 = n2.length - 1; c3 <= l3; c3++) h2 = c3 === l3 || this.charSpacing || s2, _2 += n2[c3], m = this.__charBounds[a2][c3], v2 === 0 ? (r2 += u2 * (m.kernedWidth - m.width), v2 += m.width) : v2 += m.kernedWidth, o2 && !h2 && this._reSpaceAndTab.test(n2[c3]) && (h2 = true), h2 || (f2 = f2 || this.getCompleteStyleDeclaration(a2, c3), p2 = this.getCompleteStyleDeclaration(a2, c3 + 1), h2 = Ei(f2, p2, false)), h2 && (s2 ? (t2.save(), t2.translate(m.renderLeft, m.renderTop), t2.rotate(m.angle), this._renderChar(e24, t2, a2, c3, _2, -v2 / 2, 0), t2.restore()) : (g2 = r2, this._renderChar(e24, t2, a2, c3, _2, g2, i2)), _2 = ``, f2 = p2, r2 += u2 * v2, v2 = 0);
      t2.restore();
    }
    _applyPatternGradientTransformText(e24) {
      let t2 = this.width + this.strokeWidth, n2 = this.height + this.strokeWidth, r2 = F({ width: t2, height: n2 }), i2 = r2.getContext(`2d`);
      return r2.width = t2, r2.height = n2, i2.beginPath(), i2.moveTo(0, 0), i2.lineTo(t2, 0), i2.lineTo(t2, n2), i2.lineTo(0, n2), i2.closePath(), i2.translate(t2 / 2, n2 / 2), i2.fillStyle = e24.toLive(i2), this._applyPatternGradientTransform(i2, e24), i2.fill(), i2.createPattern(r2, `no-repeat`);
    }
    handleFiller(e24, t2, n2) {
      let r2, i2;
      return V(n2) ? n2.gradientUnits === `percentage` || n2.gradientTransform || n2.patternTransform ? (r2 = -this.width / 2, i2 = -this.height / 2, e24.translate(r2, i2), e24[t2] = this._applyPatternGradientTransformText(n2), { offsetX: r2, offsetY: i2 }) : (e24[t2] = n2.toLive(e24), this._applyPatternGradientTransform(e24, n2)) : (e24[t2] = n2, { offsetX: 0, offsetY: 0 });
    }
    _setStrokeStyles(e24, { stroke: t2, strokeWidth: n2 }) {
      return e24.lineWidth = n2, e24.lineCap = this.strokeLineCap, e24.lineDashOffset = this.strokeDashOffset, e24.lineJoin = this.strokeLineJoin, e24.miterLimit = this.strokeMiterLimit, this.handleFiller(e24, `strokeStyle`, t2);
    }
    _setFillStyles(e24, { fill: t2 }) {
      return this.handleFiller(e24, `fillStyle`, t2);
    }
    _renderChar(e24, t2, n2, r2, i2, a2, o2) {
      let s2 = this._getStyleDeclaration(n2, r2), c2 = this.getCompleteStyleDeclaration(n2, r2), l2 = e24 === `fillText` && c2.fill, u2 = e24 === `strokeText` && c2.stroke && c2.strokeWidth;
      if (u2 || l2) {
        if (t2.save(), t2.font = this._getFontDeclaration(c2), s2.textBackgroundColor && this._removeShadow(t2), s2.deltaY && (o2 += s2.deltaY), l2) {
          let e25 = this._setFillStyles(t2, c2);
          t2.fillText(i2, a2 - e25.offsetX, o2 - e25.offsetY);
        }
        if (u2) {
          let e25 = this._setStrokeStyles(t2, c2);
          t2.strokeText(i2, a2 - e25.offsetX, o2 - e25.offsetY);
        }
        t2.restore();
      }
    }
    setSuperscript(e24, t2) {
      this._setScript(e24, t2, this.superscript);
    }
    setSubscript(e24, t2) {
      this._setScript(e24, t2, this.subscript);
    }
    _setScript(e24, t2, n2) {
      let r2 = this.get2DCursorLocation(e24, true), i2 = this.getValueOfPropertyAt(r2.lineIndex, r2.charIndex, `fontSize`), a2 = this.getValueOfPropertyAt(r2.lineIndex, r2.charIndex, `deltaY`), o2 = { fontSize: i2 * n2.size, deltaY: a2 + i2 * n2.baseline };
      this.setSelectionStyles(o2, e24, t2);
    }
    _getLineLeftOffset(e24) {
      let t2 = this.getLineWidth(e24), n2 = this.width - t2, r2 = this.textAlign, i2 = this.direction, a2 = this.isEndOfWrapping(e24), o2 = 0;
      return r2 === `justify` || r2 === `justify-center` && !a2 || r2 === `justify-right` && !a2 || r2 === `justify-left` && !a2 ? 0 : (r2 === `center` && (o2 = n2 / 2), r2 === `right` && (o2 = n2), r2 === `justify-center` && (o2 = n2 / 2), r2 === `justify-right` && (o2 = n2), i2 === `rtl` && (r2 === `right` || r2 === `justify-right` ? o2 = 0 : r2 === `left` || r2 === `justify-left` ? o2 = -n2 : r2 !== `center` && r2 !== `justify-center` || (o2 = -n2 / 2)), o2);
    }
    _clearCache() {
      this._forceClearCache = false, this.__lineWidths = [], this.__lineHeights = [], this.__charBounds = [];
    }
    getLineWidth(e24) {
      if (this.__lineWidths[e24] !== void 0) return this.__lineWidths[e24];
      let { width: t2 } = this.measureLine(e24);
      return this.__lineWidths[e24] = t2, t2;
    }
    _getWidthOfCharSpacing() {
      return this.charSpacing === 0 ? 0 : this.fontSize * this.charSpacing / 1e3;
    }
    getValueOfPropertyAt(e24, t2, n2) {
      var r2;
      return (r2 = this._getStyleDeclaration(e24, t2)[n2]) == null ? this[n2] : r2;
    }
    _renderTextDecoration(e24, t2) {
      if (!this[t2] && !this.styleHas(t2)) return;
      let n2 = this._getTopOffset(), r2 = this._getLeftOffset(), i2 = this.path, a2 = this._getWidthOfCharSpacing(), o2 = t2 === `linethrough` ? 0.5 : +(t2 === `overline`), s2 = this.offsets[t2];
      for (let c2 = 0, l2 = this._textLines.length; c2 < l2; c2++) {
        let l3 = this.getHeightOfLine(c2);
        if (!this[t2] && !this.styleHas(t2, c2)) {
          n2 += l3;
          continue;
        }
        let u2 = this._textLines[c2], d2 = l3 / this.lineHeight, f2 = this._getLineLeftOffset(c2), p2, m = 0, h2 = 0, g2 = this.getValueOfPropertyAt(c2, 0, t2), _2 = this.getValueOfPropertyAt(c2, 0, j), v2 = this.getValueOfPropertyAt(c2, 0, `textDecorationColor`) || _2, y2 = this.getValueOfPropertyAt(c2, 0, vn), b2 = g2, x2 = v2, S2 = y2, C2 = n2 + d2 * (1 - this._fontSizeFraction), w2 = this.getHeightOfChar(c2, 0), ee2 = this.getValueOfPropertyAt(c2, 0, `deltaY`);
        for (let n3 = 0, a3 = u2.length; n3 < a3; n3++) {
          let a4 = this.__charBounds[c2][n3];
          b2 = this.getValueOfPropertyAt(c2, n3, t2), p2 = this.getValueOfPropertyAt(c2, n3, j), x2 = this.getValueOfPropertyAt(c2, n3, `textDecorationColor`) || p2, S2 = this.getValueOfPropertyAt(c2, n3, vn);
          let l4 = this.getHeightOfChar(c2, n3), u3 = this.getValueOfPropertyAt(c2, n3, `deltaY`);
          if (i2 && b2 && p2) {
            let t3 = this.fontSize * S2 / 1e3;
            e24.save(), e24.fillStyle = x2, e24.translate(a4.renderLeft, a4.renderTop), e24.rotate(a4.angle), e24.fillRect(-a4.kernedWidth / 2, s2 * l4 + u3 - o2 * t3, a4.kernedWidth, t3), e24.restore();
          } else if ((b2 !== g2 || p2 !== _2 || x2 !== v2 || l4 !== w2 || S2 !== y2 || u3 !== ee2) && h2 > 0) {
            let t3 = this.fontSize * y2 / 1e3, n4 = r2 + f2 + m;
            this.direction === `rtl` && (n4 = this.width - n4 - h2), g2 && v2 && y2 && (e24.fillStyle = v2, e24.fillRect(n4, C2 + s2 * w2 + ee2 - o2 * t3, h2, t3)), m = a4.left, h2 = a4.width, g2 = b2, v2 = x2, y2 = S2, _2 = p2, w2 = l4, ee2 = u3;
          } else h2 += a4.kernedWidth;
        }
        let T2 = r2 + f2 + m;
        this.direction === `rtl` && (T2 = this.width - T2 - h2), e24.fillStyle = x2;
        let E2 = this.fontSize * S2 / 1e3;
        b2 && x2 && S2 && e24.fillRect(T2, C2 + s2 * w2 + ee2 - o2 * E2, h2 - a2, E2), n2 += l3;
      }
      this._removeShadow(e24);
    }
    _getFontDeclaration({ fontFamily: t2 = this.fontFamily, fontStyle: n2 = this.fontStyle, fontWeight: r2 = this.fontWeight, fontSize: i2 = this.fontSize } = {}, a2) {
      let o2 = t2.includes(`'`) || t2.includes(`"`) || t2.includes(`,`) || e19.genericFonts.includes(t2.toLowerCase()) ? t2 : `"${t2}"`;
      return [n2, r2, `${a2 ? this.CACHE_FONT_SIZE : i2}px`, o2].join(` `);
    }
    render(e24) {
      this.visible && (this.canvas && this.canvas.skipOffscreen && !this.group && !this.isOnScreen() || (this._forceClearCache && this.initDimensions(), super.render(e24)));
    }
    graphemeSplit(e24) {
      return gt(e24);
    }
    _splitTextIntoLines(e24) {
      let t2 = e24.split(this._reNewline), n2 = Array(t2.length), r2 = [`
`], i2 = [];
      for (let e25 = 0; e25 < t2.length; e25++) n2[e25] = this.graphemeSplit(t2[e25]), i2 = i2.concat(n2[e25], r2);
      return i2.pop(), { _unwrappedLines: n2, lines: t2, graphemeText: i2, graphemeLines: n2 };
    }
    toObject(e24 = []) {
      return { ...super.toObject([...Cn, ...e24]), styles: Di(this.styles, this.text), ...this.path ? { path: this.path.toObject() } : {} };
    }
    set(e24, t2) {
      let { textLayoutProperties: n2 } = this.constructor;
      super.set(e24, t2);
      let r2 = false, i2 = false;
      if (typeof e24 == `object`) for (let t3 in e24) t3 === `path` && this.setPathInfo(), r2 = r2 || n2.includes(t3), i2 = i2 || t3 === `path`;
      else r2 = n2.includes(e24), i2 = e24 === `path`;
      return i2 && this.setPathInfo(), r2 && this.initialized && (this.initDimensions(), this.setCoords()), this;
    }
    complexity() {
      return 1;
    }
    static async fromElement(t2, n2, r2) {
      let i2 = Zi(t2, e19.ATTRIBUTE_NAMES, r2), { textAnchor: a2 = D, textDecoration: o2 = ``, dx: s2 = 0, dy: c2 = 0, top: l2 = 0, left: u2 = 0, fontSize: d2 = 16, strokeWidth: f2 = 1, ...p2 } = { ...n2, ...i2 }, m = new this(on(t2.textContent || ``).trim(), { left: u2 + s2, top: l2 + c2, underline: o2.includes(`underline`), overline: o2.includes(`overline`), linethrough: o2.includes(`line-through`), strokeWidth: 0, fontSize: d2, ...p2 }), h2 = m.getScaledHeight() / m.height, g2 = ((m.height + m.strokeWidth) * m.lineHeight - m.height) * h2, _2 = m.getScaledHeight() + g2, v2 = 0;
      return a2 === `center` && (v2 = m.getScaledWidth() / 2), a2 === `right` && (v2 = m.getScaledWidth()), m.set({ left: m.left - v2, top: m.top - (_2 - m.fontSize * (0.07 + m._fontSizeFraction)) / m.lineHeight, strokeWidth: f2 }), m;
    }
    static fromObject(e24) {
      return this._fromObject({ ...e24, styles: Oi(e24.styles || {}, e24.text) }, { extraParam: `text` });
    }
  };
  i(Q, `textLayoutProperties`, Sn), i(Q, `cacheProperties`, [...Un, ...Cn]), i(Q, `ownDefaults`, Tn), i(Q, `type`, `Text`), i(Q, `genericFonts`, [`serif`, `sans-serif`, `monospace`, `cursive`, `fantasy`, `system-ui`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`, `math`, `emoji`, `fangsong`]), i(Q, `ATTRIBUTE_NAMES`, ki.concat(`x`, `y`, `dx`, `dy`, `font-family`, `font-style`, `font-weight`, `font-size`, `letter-spacing`, `text-decoration`, `text-decoration-thickness`, `text-decoration-color`, `text-anchor`)), vi(Q, [class extends gn {
    _toSVG() {
      let e24 = this._getSVGLeftTopOffsets(), t2 = this._getSVGTextAndBg(e24.textTop, e24.textLeft);
      return this._wrapSVGTextAndBg(t2);
    }
    toSVG(e24) {
      let t2 = this._createBaseSVGMarkup(this._toSVG(), { reviver: e24, noStyle: true, withShadow: true }), n2 = this.path;
      return n2 ? t2 + n2._createBaseSVGMarkup(n2._toSVG(), { reviver: e24, withShadow: true, additionalTransform: nt(this.calcOwnMatrix()) }) : t2;
    }
    _getSVGLeftTopOffsets() {
      return { textLeft: -this.width / 2, textTop: -this.height / 2, lineTop: this.getHeightOfLine(0) };
    }
    _wrapSVGTextAndBg({ textBgRects: e24, textSpans: t2 }) {
      let n2 = this.getSvgTextDecoration(this);
      return [e24.join(``), `		<text xml:space="preserve" `, `font-family="${U(this.fontFamily.replace(Yo, `'`))}" `, `font-size="${U(this.fontSize)}" `, this.fontStyle ? `font-style="${U(this.fontStyle)}" ` : ``, this.fontWeight ? `font-weight="${U(this.fontWeight)}" ` : ``, n2 ? `text-decoration="${n2}" ` : ``, this.direction === `rtl` ? `direction="rtl" ` : ``, `style="`, this.getSvgStyles(true), `"`, this.addPaintOrder(), ` >`, t2.join(``), `</text>
`];
    }
    _getSVGTextAndBg(e24, t2) {
      let n2 = [], r2 = [], i2, a2 = e24;
      this.backgroundColor && r2.push(Xo(this.backgroundColor, -this.width / 2, -this.height / 2, this.width, this.height));
      for (let e25 = 0, o2 = this._textLines.length; e25 < o2; e25++) i2 = this._getLineLeftOffset(e25), this.direction === `rtl` && (i2 += this.width), (this.textBackgroundColor || this.styleHas(`textBackgroundColor`, e25)) && this._setSVGTextLineBg(r2, e25, t2 + i2, a2), this._setSVGTextLineText(n2, e25, t2 + i2, a2), a2 += this.getHeightOfLine(e25);
      return { textSpans: n2, textBgRects: r2 };
    }
    _createTextCharSpan(e24, t2, n2, r2, i2) {
      let a2 = o.NUM_FRACTION_DIGITS, s2 = this.getSvgSpanStyles(t2, e24 !== e24.trim() || !!e24.match(Jo)), c2 = s2 ? `style="${s2}"` : ``, l2 = t2.deltaY, u2 = l2 ? ` dy="${B(l2, a2)}" ` : ``, { angle: d2, renderLeft: f2, renderTop: p2, width: m } = i2, h2 = ``;
      if (f2 !== void 0) {
        let e25 = m / 2;
        d2 && (h2 = ` rotate="${B(Ie(d2), a2)}"`);
        let t3 = We({ angle: Ie(d2) });
        t3[4] = f2, t3[5] = p2;
        let i3 = new N(-e25, 0).transform(t3);
        n2 = i3.x, r2 = i3.y;
      }
      return `<tspan x="${B(n2, a2)}" y="${B(r2, a2)}" ${u2}${h2}${c2}>${U(e24)}</tspan>`;
    }
    _setSVGTextLineText(e24, t2, n2, r2) {
      let i2 = this.getHeightOfLine(t2), a2 = this.textAlign.includes(En), o2 = this._textLines[t2], s2, c2, l2, u2, d2, f2 = ``, p2 = 0;
      r2 += i2 * (1 - this._fontSizeFraction) / this.lineHeight;
      for (let i3 = 0, m = o2.length - 1; i3 <= m; i3++) d2 = i3 === m || this.charSpacing || this.path, f2 += o2[i3], l2 = this.__charBounds[t2][i3], p2 === 0 ? (n2 += l2.kernedWidth - l2.width, p2 += l2.width) : p2 += l2.kernedWidth, a2 && !d2 && this._reSpaceAndTab.test(o2[i3]) && (d2 = true), d2 || (s2 = s2 || this.getCompleteStyleDeclaration(t2, i3), c2 = this.getCompleteStyleDeclaration(t2, i3 + 1), d2 = Ei(s2, c2, true)), d2 && (u2 = this._getStyleDeclaration(t2, i3), e24.push(this._createTextCharSpan(f2, u2, n2, r2, l2)), f2 = ``, s2 = c2, this.direction === `rtl` ? n2 -= p2 : n2 += p2, p2 = 0);
    }
    _setSVGTextLineBg(e24, t2, n2, r2) {
      let i2 = this._textLines[t2], a2 = this.getHeightOfLine(t2) / this.lineHeight, o2, s2 = 0, c2 = 0, l2 = this.getValueOfPropertyAt(t2, 0, `textBackgroundColor`);
      for (let u2 = 0; u2 < i2.length; u2++) {
        let { left: i3, width: d2, kernedWidth: f2 } = this.__charBounds[t2][u2];
        o2 = this.getValueOfPropertyAt(t2, u2, `textBackgroundColor`), o2 === l2 ? s2 += f2 : (l2 && e24.push(Xo(l2, n2 + c2, r2, s2, a2)), c2 = i3, s2 = d2, l2 = o2);
      }
      o2 && e24.push(Xo(l2, n2 + c2, r2, s2, a2));
    }
    getSvgStyles(e24) {
      let t2 = nn(this.textDecorationColor) ? ` text-decoration-color: ${U(this[yn])};` : ``;
      return `${super.getSvgStyles(e24)} text-decoration-thickness: ${B(this.textDecorationThickness * this.getObjectScaling().y / 10, o.NUM_FRACTION_DIGITS)}%;${t2} white-space: pre;`;
    }
    getSvgSpanStyles(e24, t2) {
      let { fontFamily: n2, strokeWidth: r2, stroke: i2, fill: a2, fontSize: s2, fontStyle: c2, fontWeight: l2, textDecorationThickness: u2, textDecorationColor: d2, linethrough: f2, overline: p2, underline: m } = e24, h2 = this.getSvgTextDecoration({ underline: m == null ? this.underline : m, overline: p2 == null ? this.overline : p2, linethrough: f2 == null ? this.linethrough : f2 }), g2 = u2 || this.textDecorationThickness, _2 = d2 || this.textDecorationColor, v2 = rn(r2), y2 = an(n2), b2 = rn(s2), x2 = an(c2), S2 = rn(l2) || an(l2), C2 = an(_2);
      return [i2 ? hn(he, i2) : ``, v2 ? `stroke-width: ${U(v2)}; ` : ``, y2 ? `font-family: ${y2.includes(`'`) || y2.includes(`"`) ? U(y2) : `'${U(y2)}'`}; ` : ``, b2 ? `font-size: ${U(b2)}px; ` : ``, x2 ? `font-style: ${U(x2)}; ` : ``, S2 ? `font-weight: ${U(S2)}; ` : ``, h2 ? `text-decoration: ${h2}; text-decoration-thickness: ${B(g2 * this.getObjectScaling().y / 10, o.NUM_FRACTION_DIGITS)}%;${C2 ? ` text-decoration-color: ${U(C2)};` : ``} ` : ``, a2 ? hn(j, a2) : ``, t2 ? `white-space: pre; ` : ``].join(``);
    }
    getSvgTextDecoration(e24) {
      return [`overline`, `underline`, `line-through`].filter((t2) => e24[t2.replace(`-`, ``)]).join(` `);
    }
  }]), M.setClass(Q), M.setSVGClass(Q);
  var Qo = class {
    constructor(e24) {
      i(this, `target`, void 0), i(this, `__mouseDownInPlace`, false), i(this, `__dragStartFired`, false), i(this, `__isDraggingOver`, false), i(this, `__dragStartSelection`, void 0), i(this, `__dragImageDisposer`, void 0), i(this, `_dispose`, void 0), this.target = e24;
      let t2 = [this.target.on(`dragenter`, this.dragEnterHandler.bind(this)), this.target.on(`dragover`, this.dragOverHandler.bind(this)), this.target.on(`dragleave`, this.dragLeaveHandler.bind(this)), this.target.on(`dragend`, this.dragEndHandler.bind(this)), this.target.on(`drop`, this.dropHandler.bind(this))];
      this._dispose = () => {
        t2.forEach((e25) => e25()), this._dispose = void 0;
      };
    }
    isPointerOverSelection(e24) {
      let t2 = this.target, n2 = t2.getSelectionStartFromPointer(e24);
      return t2.isEditing && n2 >= t2.selectionStart && n2 <= t2.selectionEnd && t2.selectionStart < t2.selectionEnd;
    }
    start(e24) {
      return this.__mouseDownInPlace = this.isPointerOverSelection(e24);
    }
    isActive() {
      return this.__mouseDownInPlace;
    }
    end(e24) {
      let t2 = this.isActive();
      return t2 && !this.__dragStartFired && (this.target.setCursorByClick(e24), this.target.initDelayedCursor(true)), this.__mouseDownInPlace = false, this.__dragStartFired = false, this.__isDraggingOver = false, t2;
    }
    getDragStartSelection() {
      return this.__dragStartSelection;
    }
    setDragImage(e24, { selectionStart: t2, selectionEnd: n2 }) {
      var r2;
      let i2 = this.target, a2 = i2.canvas, o2 = new N(i2.flipX ? -1 : 1, i2.flipY ? -1 : 1), s2 = i2._getCursorBoundaries(t2), c2 = new N(s2.left + s2.leftOffset, s2.top + s2.topOffset).multiply(o2).transform(i2.calcTransformMatrix()), l2 = a2.getScenePoint(e24).subtract(c2), u2 = i2.getCanvasRetinaScaling(), d2 = i2.getBoundingRect(), f2 = c2.subtract(new N(d2.left, d2.top)), p2 = a2.viewportTransform, m = f2.add(l2).transform(p2, true), h2 = i2.backgroundColor, g2 = Ti(i2.styles);
      i2.backgroundColor = ``;
      let _2 = { stroke: `transparent`, fill: `transparent`, textBackgroundColor: `transparent` };
      i2.setSelectionStyles(_2, 0, t2), i2.setSelectionStyles(_2, n2, i2.text.length), i2.dirty = true;
      let v2 = i2.toCanvasElement({ enableRetinaScaling: a2.enableRetinaScaling, viewportTransform: true });
      i2.backgroundColor = h2, i2.styles = g2, i2.dirty = true, Ka(v2, { position: `fixed`, left: -v2.width + `px`, border: te, width: v2.width / u2 + `px`, height: v2.height / u2 + `px` }), this.__dragImageDisposer && this.__dragImageDisposer(), this.__dragImageDisposer = () => {
        v2.remove();
      }, H(e24.target || this.target.hiddenTextarea).body.appendChild(v2), (r2 = e24.dataTransfer) == null || r2.setDragImage(v2, m.x, m.y);
    }
    onDragStart(e24) {
      this.__dragStartFired = true;
      let t2 = this.target, n2 = this.isActive();
      if (n2 && e24.dataTransfer) {
        let n3 = this.__dragStartSelection = { selectionStart: t2.selectionStart, selectionEnd: t2.selectionEnd }, r2 = t2._text.slice(n3.selectionStart, n3.selectionEnd).join(``), i2 = { text: t2.text, value: r2, ...n3 };
        e24.dataTransfer.setData(`text/plain`, r2), e24.dataTransfer.setData(`application/fabric`, JSON.stringify({ value: r2, styles: t2.getSelectionStyles(n3.selectionStart, n3.selectionEnd, true) })), e24.dataTransfer.effectAllowed = `copyMove`, this.setDragImage(e24, i2);
      }
      return t2.abortCursorAnimation(), n2;
    }
    canDrop(e24) {
      if (this.target.editable && !this.target.getActiveControl() && !e24.defaultPrevented) {
        if (this.isActive() && this.__dragStartSelection) {
          let t2 = this.target.getSelectionStartFromPointer(e24), n2 = this.__dragStartSelection;
          return t2 < n2.selectionStart || t2 > n2.selectionEnd;
        }
        return true;
      }
      return false;
    }
    targetCanDrop(e24) {
      return this.target.canDrop(e24);
    }
    dragEnterHandler({ e: e24 }) {
      let t2 = this.targetCanDrop(e24);
      !this.__isDraggingOver && t2 && (this.__isDraggingOver = true);
    }
    dragOverHandler(e24) {
      let { e: t2 } = e24, n2 = this.targetCanDrop(t2);
      !this.__isDraggingOver && n2 ? this.__isDraggingOver = true : this.__isDraggingOver && !n2 && (this.__isDraggingOver = false), this.__isDraggingOver && (t2.preventDefault(), e24.canDrop = true, e24.dropTarget = this.target);
    }
    dragLeaveHandler() {
      (this.__isDraggingOver || this.isActive()) && (this.__isDraggingOver = false);
    }
    dropHandler(e24) {
      var t2;
      let { e: n2 } = e24, r2 = n2.defaultPrevented;
      this.__isDraggingOver = false, n2.preventDefault();
      let i2 = (t2 = n2.dataTransfer) == null ? void 0 : t2.getData(`text/plain`);
      if (i2 && !r2) {
        let t3 = this.target, r3 = t3.canvas, a2 = t3.getSelectionStartFromPointer(n2), { styles: o2 } = n2.dataTransfer.types.includes(`application/fabric`) ? JSON.parse(n2.dataTransfer.getData(`application/fabric`)) : {}, s2 = i2[Math.max(0, i2.length - 1)];
        if (this.__dragStartSelection) {
          let e25 = this.__dragStartSelection.selectionStart, n3 = this.__dragStartSelection.selectionEnd;
          a2 > e25 && a2 <= n3 ? a2 = e25 : a2 > n3 && (a2 -= n3 - e25), t3.removeChars(e25, n3), delete this.__dragStartSelection;
        }
        t3._reNewline.test(s2) && (t3._reNewline.test(t3._text[a2]) || a2 === t3._text.length) && (i2 = i2.trimEnd()), e24.didDrop = true, e24.dropTarget = t3, t3.insertChars(i2, o2, a2), r3.setActiveObject(t3), t3.enterEditing(n2), t3.selectionStart = Math.min(a2 + 0, t3._text.length), t3.selectionEnd = Math.min(t3.selectionStart + i2.length, t3._text.length), t3.hiddenTextarea.value = t3.text, t3._updateTextarea(), t3.hiddenTextarea.focus(), t3.fire(le, { index: a2 + 0, action: `drop` }), r3.fire(`text:changed`, { target: t3 }), r3.contextTopDirty = true, r3.requestRenderAll();
      }
    }
    dragEndHandler({ e: e24 }) {
      if (this.isActive() && this.__dragStartFired && this.__dragStartSelection) {
        var t2;
        let n2 = this.target, r2 = this.target.canvas, { selectionStart: i2, selectionEnd: a2 } = this.__dragStartSelection, o2 = ((t2 = e24.dataTransfer) == null ? void 0 : t2.dropEffect) || `none`;
        o2 === `none` ? (n2.selectionStart = i2, n2.selectionEnd = a2, n2._updateTextarea(), n2.hiddenTextarea.focus()) : (n2.clearContextTop(), o2 === `move` && (n2.removeChars(i2, a2), n2.selectionStart = n2.selectionEnd = i2, n2.hiddenTextarea && (n2.hiddenTextarea.value = n2.text), n2._updateTextarea(), n2.fire(le, { index: i2, action: `dragend` }), r2.fire(`text:changed`, { target: n2 }), r2.requestRenderAll()), n2.exitEditing());
      }
      this.__dragImageDisposer && this.__dragImageDisposer(), delete this.__dragImageDisposer, delete this.__dragStartSelection, this.__isDraggingOver = false;
    }
    dispose() {
      this._dispose && this._dispose();
    }
  };
  var $o = /[ \n\.,;!\?\-]/;
  var es = class extends Q {
    constructor(...e24) {
      super(...e24), i(this, `_currentCursorOpacity`, 1);
    }
    initBehavior() {
      this._tick = this._tick.bind(this), this._onTickComplete = this._onTickComplete.bind(this), this.updateSelectionOnMouseMove = this.updateSelectionOnMouseMove.bind(this);
    }
    onDeselect(e24) {
      return this.isEditing && this.exitEditing(), this.selected = false, super.onDeselect(e24);
    }
    _animateCursor({ toValue: e24, duration: t2, delay: n2, onComplete: r2 }) {
      return Mr({ startValue: this._currentCursorOpacity, endValue: e24, duration: t2, delay: n2, onComplete: r2, abort: () => !this.canvas || this.selectionStart !== this.selectionEnd, onChange: (e25) => {
        this._currentCursorOpacity = e25, this.renderCursorOrSelection();
      } });
    }
    _tick(e24) {
      this._currentTickState = this._animateCursor({ toValue: 0, duration: this.cursorDuration / 2, delay: Math.max(e24 || 0, 100), onComplete: this._onTickComplete });
    }
    _onTickComplete() {
      var e24;
      (e24 = this._currentTickCompleteState) == null || e24.abort(), this._currentTickCompleteState = this._animateCursor({ toValue: 1, duration: this.cursorDuration, onComplete: this._tick });
    }
    initDelayedCursor(e24) {
      this.abortCursorAnimation(), this._tick(e24 ? 0 : this.cursorDelay);
    }
    abortCursorAnimation() {
      let e24 = false;
      [this._currentTickState, this._currentTickCompleteState].forEach((t2) => {
        t2 && !t2.isDone() && (e24 = true, t2.abort());
      }), this._currentCursorOpacity = 1, e24 && this.clearContextTop();
    }
    restartCursorIfNeeded() {
      [this._currentTickState, this._currentTickCompleteState].some((e24) => !e24 || e24.isDone()) && this.initDelayedCursor();
    }
    selectAll() {
      return this.selectionStart = 0, this.selectionEnd = this._text.length, this._fireSelectionChanged(), this._updateTextarea(), this;
    }
    cmdAll() {
      this.selectAll(), this.renderCursorOrSelection();
    }
    getSelectedText() {
      return this._text.slice(this.selectionStart, this.selectionEnd).join(``);
    }
    findWordBoundaryLeft(e24) {
      let t2 = 0, n2 = e24 - 1;
      if (this._reSpace.test(this._text[n2])) for (; this._reSpace.test(this._text[n2]); ) t2++, n2--;
      for (; /\S/.test(this._text[n2]) && n2 > -1; ) t2++, n2--;
      return e24 - t2;
    }
    findWordBoundaryRight(e24) {
      let t2 = 0, n2 = e24;
      if (this._reSpace.test(this._text[n2])) for (; this._reSpace.test(this._text[n2]); ) t2++, n2++;
      for (; /\S/.test(this._text[n2]) && n2 < this._text.length; ) t2++, n2++;
      return e24 + t2;
    }
    findLineBoundaryLeft(e24) {
      let t2 = 0, n2 = e24 - 1;
      for (; !/\n/.test(this._text[n2]) && n2 > -1; ) t2++, n2--;
      return e24 - t2;
    }
    findLineBoundaryRight(e24) {
      let t2 = 0, n2 = e24;
      for (; !/\n/.test(this._text[n2]) && n2 < this._text.length; ) t2++, n2++;
      return e24 + t2;
    }
    searchWordBoundary(e24, t2) {
      let n2 = this._text, r2 = e24 > 0 && this._reSpace.test(n2[e24]) && (t2 === -1 || !ne.test(n2[e24 - 1])) ? e24 - 1 : e24, i2 = n2[r2];
      for (; r2 > 0 && r2 < n2.length && !$o.test(i2); ) r2 += t2, i2 = n2[r2];
      return t2 === -1 && $o.test(i2) && r2++, r2;
    }
    selectWord(e24) {
      var t2;
      e24 = (t2 = e24) == null ? this.selectionStart : t2;
      let n2 = this.searchWordBoundary(e24, -1), r2 = Math.max(n2, this.searchWordBoundary(e24, 1));
      this.selectionStart = n2, this.selectionEnd = r2, this._fireSelectionChanged(), this._updateTextarea(), this.renderCursorOrSelection();
    }
    selectLine(e24) {
      var t2;
      e24 = (t2 = e24) == null ? this.selectionStart : t2;
      let n2 = this.findLineBoundaryLeft(e24), r2 = this.findLineBoundaryRight(e24);
      this.selectionStart = n2, this.selectionEnd = r2, this._fireSelectionChanged(), this._updateTextarea();
    }
    enterEditing(e24) {
      !this.isEditing && this.editable && (this.enterEditingImpl(), this.fire(`editing:entered`, e24 ? { e: e24 } : void 0), this._fireSelectionChanged(), this.canvas && (this.canvas.fire(`text:editing:entered`, { target: this, e: e24 }), this.canvas.requestRenderAll()));
    }
    enterEditingImpl() {
      this.canvas && (this.canvas.calcOffset(), this.canvas.textEditingManager.exitTextEditing()), this.isEditing = true, this.initHiddenTextarea(), this.hiddenTextarea.focus(), this.hiddenTextarea.value = this.text, this._updateTextarea(), this._saveEditingProps(), this._setEditingProps(), this._textBeforeEdit = this.text, this._tick();
    }
    updateSelectionOnMouseMove(e24) {
      if (this.getActiveControl()) return;
      let t2 = this.hiddenTextarea;
      H(t2).activeElement !== t2 && t2.focus();
      let n2 = this.getSelectionStartFromPointer(e24), r2 = this.selectionStart, i2 = this.selectionEnd;
      (n2 === this.__selectionStartOnMouseDown && r2 !== i2 || r2 !== n2 && i2 !== n2) && (n2 > this.__selectionStartOnMouseDown ? (this.selectionStart = this.__selectionStartOnMouseDown, this.selectionEnd = n2) : (this.selectionStart = n2, this.selectionEnd = this.__selectionStartOnMouseDown), this.selectionStart === r2 && this.selectionEnd === i2 || (this._fireSelectionChanged(), this._updateTextarea(), this.renderCursorOrSelection()));
    }
    _setEditingProps() {
      this.hoverCursor = `text`, this.canvas && (this.canvas.defaultCursor = this.canvas.moveCursor = `text`), this.borderColor = this.editingBorderColor, this.hasControls = this.selectable = false, this.lockMovementX = this.lockMovementY = true;
    }
    fromStringToGraphemeSelection(e24, t2, n2) {
      let r2 = n2.slice(0, e24), i2 = this.graphemeSplit(r2).length;
      if (e24 === t2) return { selectionStart: i2, selectionEnd: i2 };
      let a2 = n2.slice(e24, t2);
      return { selectionStart: i2, selectionEnd: i2 + this.graphemeSplit(a2).length };
    }
    fromGraphemeToStringSelection(e24, t2, n2) {
      let r2 = n2.slice(0, e24).join(``).length;
      return e24 === t2 ? { selectionStart: r2, selectionEnd: r2 } : { selectionStart: r2, selectionEnd: r2 + n2.slice(e24, t2).join(``).length };
    }
    _updateTextarea() {
      if (this.cursorOffsetCache = {}, this.hiddenTextarea) {
        if (!this.inCompositionMode) {
          let e24 = this.fromGraphemeToStringSelection(this.selectionStart, this.selectionEnd, this._text);
          this.hiddenTextarea.selectionStart = e24.selectionStart, this.hiddenTextarea.selectionEnd = e24.selectionEnd;
        }
        this.updateTextareaPosition();
      }
    }
    updateFromTextArea() {
      let { hiddenTextarea: e24, direction: t2, textAlign: n2, inCompositionMode: r2 } = this;
      if (!e24) return;
      let i2 = n2 === `justify` ? t2 === `ltr` ? D : k : n2.replace(`justify-`, ``), a2 = this.getPositionByOrigin(i2, `top`);
      this.cursorOffsetCache = {}, this.text = e24.value, this.set(`dirty`, true), this.initDimensions(), this.setPositionByOrigin(a2, i2, `top`), this.setCoords();
      let o2 = this.fromStringToGraphemeSelection(e24.selectionStart, e24.selectionEnd, e24.value);
      this.selectionEnd = this.selectionStart = o2.selectionEnd, r2 || (this.selectionStart = o2.selectionStart), this.updateTextareaPosition();
    }
    updateTextareaPosition() {
      if (this.selectionStart === this.selectionEnd) {
        let e24 = this._calcTextareaPosition();
        this.hiddenTextarea.style.left = e24.left, this.hiddenTextarea.style.top = e24.top;
      }
    }
    _calcTextareaPosition() {
      if (!this.canvas) return { left: `1px`, top: `1px` };
      let e24 = this.inCompositionMode ? this.compositionStart : this.selectionStart, t2 = this._getCursorBoundaries(e24), n2 = this.get2DCursorLocation(e24), r2 = n2.lineIndex, i2 = n2.charIndex, a2 = this.getValueOfPropertyAt(r2, i2, `fontSize`) * this.lineHeight, o2 = t2.leftOffset, s2 = this.getCanvasRetinaScaling(), c2 = this.canvas.upperCanvasEl, l2 = c2.width / s2, u2 = c2.height / s2, d2 = l2 - a2, f2 = u2 - a2, p2 = new N(t2.left + o2, t2.top + t2.topOffset + a2).transform(this.calcTransformMatrix()).transform(this.canvas.viewportTransform).multiply(new N(c2.clientWidth / l2, c2.clientHeight / u2));
      return p2.x < 0 && (p2.x = 0), p2.x > d2 && (p2.x = d2), p2.y < 0 && (p2.y = 0), p2.y > f2 && (p2.y = f2), p2.x += this.canvas._offset.left, p2.y += this.canvas._offset.top, { left: `${p2.x}px`, top: `${p2.y}px`, fontSize: `${a2}px`, charHeight: a2 };
    }
    _saveEditingProps() {
      this._savedProps = { hasControls: this.hasControls, borderColor: this.borderColor, lockMovementX: this.lockMovementX, lockMovementY: this.lockMovementY, hoverCursor: this.hoverCursor, selectable: this.selectable, defaultCursor: this.canvas && this.canvas.defaultCursor, moveCursor: this.canvas && this.canvas.moveCursor };
    }
    _restoreEditingProps() {
      this._savedProps && (this.hoverCursor = this._savedProps.hoverCursor, this.hasControls = this._savedProps.hasControls, this.borderColor = this._savedProps.borderColor, this.selectable = this._savedProps.selectable, this.lockMovementX = this._savedProps.lockMovementX, this.lockMovementY = this._savedProps.lockMovementY, this.canvas && (this.canvas.defaultCursor = this._savedProps.defaultCursor || this.canvas.defaultCursor, this.canvas.moveCursor = this._savedProps.moveCursor || this.canvas.moveCursor), delete this._savedProps);
    }
    exitEditingImpl() {
      let e24 = this.hiddenTextarea;
      this.selected = false, this.isEditing = false, e24 && (e24.blur && e24.blur(), e24.parentNode && e24.parentNode.removeChild(e24)), this.hiddenTextarea = null, this.abortCursorAnimation(), this.selectionStart !== this.selectionEnd && this.clearContextTop(), this.selectionEnd = this.selectionStart, this._restoreEditingProps(), this._forceClearCache && (this.initDimensions(), this.setCoords());
    }
    exitEditing() {
      let e24 = this._textBeforeEdit !== this.text;
      return this.exitEditingImpl(), this.fire(`editing:exited`), e24 && this.fire(`modified`), this.canvas && (this.canvas.fire(`text:editing:exited`, { target: this }), e24 && this.canvas.fire(`object:modified`, { target: this })), this;
    }
    _removeExtraneousStyles() {
      for (let e24 in this.styles) this._textLines[e24] || delete this.styles[e24];
    }
    removeStyleFromTo(e24, t2) {
      let { lineIndex: n2, charIndex: r2 } = this.get2DCursorLocation(e24, true), { lineIndex: i2, charIndex: a2 } = this.get2DCursorLocation(t2, true);
      if (n2 !== i2) {
        if (this.styles[n2]) for (let e25 = r2; e25 < this._unwrappedTextLines[n2].length; e25++) delete this.styles[n2][e25];
        if (this.styles[i2]) for (let e25 = a2; e25 < this._unwrappedTextLines[i2].length; e25++) {
          let t3 = this.styles[i2][e25];
          t3 && (this.styles[n2] || (this.styles[n2] = {}), this.styles[n2][r2 + e25 - a2] = t3);
        }
        for (let e25 = n2 + 1; e25 <= i2; e25++) delete this.styles[e25];
        this.shiftLineStyles(i2, n2 - i2);
      } else if (this.styles[n2]) {
        let e25 = this.styles[n2], t3 = a2 - r2;
        for (let t4 = r2; t4 < a2; t4++) delete e25[t4];
        for (let r3 in this.styles[n2]) {
          let n3 = parseInt(r3, 10);
          n3 >= a2 && (e25[n3 - t3] = e25[r3], delete e25[r3]);
        }
      }
    }
    shiftLineStyles(e24, t2) {
      let n2 = Object.assign({}, this.styles);
      for (let r2 in this.styles) {
        let i2 = parseInt(r2, 10);
        i2 > e24 && (this.styles[i2 + t2] = n2[i2], n2[i2 - t2] || delete this.styles[i2]);
      }
    }
    insertNewlineStyleObject(e24, t2, n2, r2) {
      let i2 = {}, a2 = this._unwrappedTextLines[e24].length, o2 = a2 === t2, s2 = false;
      n2 || (n2 = 1), this.shiftLineStyles(e24, n2);
      let c2 = this.styles[e24] ? this.styles[e24][t2 === 0 ? t2 : t2 - 1] : void 0;
      for (let n3 in this.styles[e24]) {
        let r3 = parseInt(n3, 10);
        r3 >= t2 && (s2 = true, i2[r3 - t2] = this.styles[e24][n3], o2 && t2 === 0 || delete this.styles[e24][n3]);
      }
      let l2 = false;
      for (s2 && !o2 && (this.styles[e24 + n2] = i2, l2 = true), (l2 || a2 > t2) && n2--; n2 > 0; ) r2 && r2[n2 - 1] ? this.styles[e24 + n2] = { 0: { ...r2[n2 - 1] } } : c2 ? this.styles[e24 + n2] = { 0: { ...c2 } } : delete this.styles[e24 + n2], n2--;
      this._forceClearCache = true;
    }
    insertCharStyleObject(e24, t2, n2, r2) {
      this.styles || (this.styles = {});
      let i2 = this.styles[e24], a2 = i2 ? { ...i2 } : {};
      n2 || (n2 = 1);
      for (let e25 in a2) {
        let r3 = parseInt(e25, 10);
        r3 >= t2 && (i2[r3 + n2] = a2[r3], a2[r3 - n2] || delete i2[r3]);
      }
      if (this._forceClearCache = true, r2) {
        for (; n2--; ) Object.keys(r2[n2]).length && (this.styles[e24] || (this.styles[e24] = {}), this.styles[e24][t2 + n2] = { ...r2[n2] });
        return;
      }
      if (!i2) return;
      let o2 = i2[t2 ? t2 - 1 : 1];
      for (; o2 && n2--; ) this.styles[e24][t2 + n2] = { ...o2 };
    }
    insertNewStyleBlock(e24, t2, n2) {
      let r2 = this.get2DCursorLocation(t2, true), i2 = [0], a2, o2 = 0;
      for (let t3 = 0; t3 < e24.length; t3++) e24[t3] === `
` ? (o2++, i2[o2] = 0) : i2[o2]++;
      for (i2[0] > 0 && (this.insertCharStyleObject(r2.lineIndex, r2.charIndex, i2[0], n2), n2 = n2 && n2.slice(i2[0] + 1)), o2 && this.insertNewlineStyleObject(r2.lineIndex, r2.charIndex + i2[0], o2), a2 = 1; a2 < o2; a2++) i2[a2] > 0 ? this.insertCharStyleObject(r2.lineIndex + a2, 0, i2[a2], n2) : n2 && this.styles[r2.lineIndex + a2] && n2[0] && (this.styles[r2.lineIndex + a2][0] = n2[0]), n2 = n2 && n2.slice(i2[a2] + 1);
      i2[a2] > 0 && this.insertCharStyleObject(r2.lineIndex + a2, 0, i2[a2], n2);
    }
    removeChars(e24, t2 = e24 + 1) {
      this.removeStyleFromTo(e24, t2), this._text.splice(e24, t2 - e24), this.text = this._text.join(``), this.set(`dirty`, true), this.initDimensions(), this.setCoords(), this._removeExtraneousStyles();
    }
    insertChars(e24, t2, n2, r2 = n2) {
      r2 > n2 && this.removeStyleFromTo(n2, r2);
      let i2 = this.graphemeSplit(e24);
      this.insertNewStyleBlock(i2, n2, t2), this._text = [...this._text.slice(0, n2), ...i2, ...this._text.slice(r2)], this.text = this._text.join(``), this.set(`dirty`, true), this.initDimensions(), this.setCoords(), this._removeExtraneousStyles();
    }
    setSelectionStartEndWithShift(e24, t2, n2) {
      n2 <= e24 ? (t2 === e24 ? this._selectionDirection = D : this._selectionDirection === `right` && (this._selectionDirection = D, this.selectionEnd = e24), this.selectionStart = n2) : n2 > e24 && n2 < t2 ? this._selectionDirection === `right` ? this.selectionEnd = n2 : this.selectionStart = n2 : (t2 === e24 ? this._selectionDirection = k : this._selectionDirection === `left` && (this._selectionDirection = k, this.selectionStart = t2), this.selectionEnd = n2);
    }
  };
  var ts = class extends es {
    initHiddenTextarea() {
      let e24 = this.canvas && H(this.canvas.getElement()) || g(), t2 = e24.createElement(`textarea`);
      Object.entries({ autocapitalize: `off`, autocorrect: `off`, autocomplete: `off`, spellcheck: `false`, "data-fabric": `textarea`, wrap: `off`, name: `fabricTextarea` }).map(([e25, n3]) => t2.setAttribute(e25, n3));
      let { top: n2, left: r2, fontSize: i2 } = this._calcTextareaPosition();
      t2.style.cssText = `position: absolute; top: ${n2}; left: ${r2}; z-index: -999; opacity: 0; width: 1px; height: 1px; font-size: 1px; padding-top: ${i2};`, (this.hiddenTextareaContainer || e24.body).appendChild(t2), Object.entries({ blur: `blur`, keydown: `onKeyDown`, keyup: `onKeyUp`, input: `onInput`, copy: `copy`, cut: `copy`, paste: `paste`, compositionstart: `onCompositionStart`, compositionupdate: `onCompositionUpdate`, compositionend: `onCompositionEnd` }).map(([e25, n3]) => t2.addEventListener(e25, this[n3].bind(this))), this.hiddenTextarea = t2;
    }
    blur() {
      this.abortCursorAnimation();
    }
    onKeyDown(e24) {
      if (!this.isEditing) return;
      let t2 = this.direction === `rtl` ? this.keysMapRtl : this.keysMap;
      if (e24.keyCode in t2) this[t2[e24.keyCode]](e24);
      else {
        if (!(e24.keyCode in this.ctrlKeysMapDown) || !e24.ctrlKey && !e24.metaKey) return;
        this[this.ctrlKeysMapDown[e24.keyCode]](e24);
      }
      e24.stopImmediatePropagation(), e24.preventDefault(), e24.keyCode >= 33 && e24.keyCode <= 40 ? (this.inCompositionMode = false, this.clearContextTop(), this.renderCursorOrSelection()) : this.canvas && this.canvas.requestRenderAll();
    }
    onKeyUp(e24) {
      !this.isEditing || this._copyDone || this.inCompositionMode ? this._copyDone = false : e24.keyCode in this.ctrlKeysMapUp && (e24.ctrlKey || e24.metaKey) && (this[this.ctrlKeysMapUp[e24.keyCode]](e24), e24.stopImmediatePropagation(), e24.preventDefault(), this.canvas && this.canvas.requestRenderAll());
    }
    onInput(e24) {
      let t2 = this.fromPaste, { value: n2, selectionStart: r2, selectionEnd: i2 } = this.hiddenTextarea;
      if (this.fromPaste = false, e24 && e24.stopPropagation(), !this.isEditing) return;
      let a2 = () => {
        this.updateFromTextArea(), this.fire(le), this.canvas && (this.canvas.fire(`text:changed`, { target: this }), this.canvas.requestRenderAll());
      };
      if (this.hiddenTextarea.value === ``) return this.styles = {}, void a2();
      let s2 = this._splitTextIntoLines(n2).graphemeText, c2 = this._text.length, l2 = s2.length, u2 = this.selectionStart, d2 = this.selectionEnd, f2 = u2 !== d2, p2, m, g2, _2, v2 = l2 - c2, y2 = this.fromStringToGraphemeSelection(r2, i2, n2), b2 = u2 > y2.selectionStart;
      f2 ? (m = this._text.slice(u2, d2), v2 += d2 - u2) : l2 < c2 && (m = b2 ? this._text.slice(d2 + v2, d2) : this._text.slice(u2, u2 - v2));
      let x2 = s2.slice(y2.selectionEnd - v2, y2.selectionEnd);
      if (m && m.length && (x2.length && (p2 = this.getSelectionStyles(u2, u2 + 1, false), p2 = x2.map(() => p2[0])), f2 ? (g2 = u2, _2 = d2) : b2 ? (g2 = d2 - m.length, _2 = d2) : (g2 = d2, _2 = d2 + m.length), this.removeStyleFromTo(g2, _2)), x2.length) {
        let { copyPasteData: e25 } = h();
        t2 && x2.join(``) === e25.copiedText && !o.disableStyleCopyPaste && (p2 = e25.copiedTextStyle), this.insertNewStyleBlock(x2, u2, p2);
      }
      a2();
    }
    onCompositionStart() {
      this.inCompositionMode = true;
    }
    onCompositionEnd() {
      this.inCompositionMode = false;
    }
    onCompositionUpdate({ target: e24 }) {
      let { selectionStart: t2, selectionEnd: n2 } = e24;
      this.compositionStart = t2, this.compositionEnd = n2, this.updateTextareaPosition();
    }
    copy() {
      if (this.selectionStart === this.selectionEnd) return;
      let { copyPasteData: e24 } = h();
      e24.copiedText = this.getSelectedText(), o.disableStyleCopyPaste ? e24.copiedTextStyle = void 0 : e24.copiedTextStyle = this.getSelectionStyles(this.selectionStart, this.selectionEnd, true), this._copyDone = true;
    }
    paste() {
      this.fromPaste = true;
    }
    _getWidthBeforeCursor(e24, t2) {
      let n2, r2 = this._getLineLeftOffset(e24);
      return t2 > 0 && (n2 = this.__charBounds[e24][t2 - 1], r2 += n2.left + n2.width), r2;
    }
    getDownCursorOffset(e24, t2) {
      let n2 = this._getSelectionForOffset(e24, t2), r2 = this.get2DCursorLocation(n2), i2 = r2.lineIndex;
      if (i2 === this._textLines.length - 1 || e24.metaKey || e24.keyCode === 34) return this._text.length - n2;
      let a2 = r2.charIndex, o2 = this._getWidthBeforeCursor(i2, a2), s2 = this._getIndexOnLine(i2 + 1, o2);
      return this._textLines[i2].slice(a2).length + s2 + 1 + this.missingNewlineOffset(i2);
    }
    _getSelectionForOffset(e24, t2) {
      return e24.shiftKey && this.selectionStart !== this.selectionEnd && t2 ? this.selectionEnd : this.selectionStart;
    }
    getUpCursorOffset(e24, t2) {
      let n2 = this._getSelectionForOffset(e24, t2), r2 = this.get2DCursorLocation(n2), i2 = r2.lineIndex;
      if (i2 === 0 || e24.metaKey || e24.keyCode === 33) return -n2;
      let a2 = r2.charIndex, o2 = this._getWidthBeforeCursor(i2, a2), s2 = this._getIndexOnLine(i2 - 1, o2), c2 = this._textLines[i2].slice(0, a2), l2 = this.missingNewlineOffset(i2 - 1);
      return -this._textLines[i2 - 1].length + s2 - c2.length + (1 - l2);
    }
    _getIndexOnLine(e24, t2) {
      let n2 = this._textLines[e24], r2, i2, a2 = this._getLineLeftOffset(e24), o2 = 0;
      for (let s2 = 0, c2 = n2.length; s2 < c2; s2++) if (r2 = this.__charBounds[e24][s2].width, a2 += r2, a2 > t2) {
        i2 = true;
        let e25 = a2 - r2, n3 = a2, c3 = Math.abs(e25 - t2);
        o2 = Math.abs(n3 - t2) < c3 ? s2 : s2 - 1;
        break;
      }
      return i2 || (o2 = n2.length - 1), o2;
    }
    moveCursorDown(e24) {
      this.selectionStart >= this._text.length && this.selectionEnd >= this._text.length || this._moveCursorUpOrDown(`Down`, e24);
    }
    moveCursorUp(e24) {
      this.selectionStart === 0 && this.selectionEnd === 0 || this._moveCursorUpOrDown(`Up`, e24);
    }
    _moveCursorUpOrDown(e24, t2) {
      let n2 = this[`get${e24}CursorOffset`](t2, this._selectionDirection === k);
      if (t2.shiftKey ? this.moveCursorWithShift(n2) : this.moveCursorWithoutShift(n2), n2 !== 0) {
        let e25 = this.text.length;
        this.selectionStart = Vn(0, this.selectionStart, e25), this.selectionEnd = Vn(0, this.selectionEnd, e25), this.abortCursorAnimation(), this.initDelayedCursor(), this._fireSelectionChanged(), this._updateTextarea();
      }
    }
    moveCursorWithShift(e24) {
      let t2 = this._selectionDirection === `left` ? this.selectionStart + e24 : this.selectionEnd + e24;
      return this.setSelectionStartEndWithShift(this.selectionStart, this.selectionEnd, t2), e24 !== 0;
    }
    moveCursorWithoutShift(e24) {
      return e24 < 0 ? (this.selectionStart += e24, this.selectionEnd = this.selectionStart) : (this.selectionEnd += e24, this.selectionStart = this.selectionEnd), e24 !== 0;
    }
    moveCursorLeft(e24) {
      this.selectionStart === 0 && this.selectionEnd === 0 || this._moveCursorLeftOrRight(`Left`, e24);
    }
    _move(e24, t2, n2) {
      let r2;
      if (e24.altKey) r2 = this[`findWordBoundary${n2}`](this[t2]);
      else {
        if (!e24.metaKey && e24.keyCode !== 35 && e24.keyCode !== 36) return this[t2] += n2 === `Left` ? -1 : 1, true;
        r2 = this[`findLineBoundary${n2}`](this[t2]);
      }
      return r2 !== void 0 && this[t2] !== r2 && (this[t2] = r2, true);
    }
    _moveLeft(e24, t2) {
      return this._move(e24, t2, `Left`);
    }
    _moveRight(e24, t2) {
      return this._move(e24, t2, `Right`);
    }
    moveCursorLeftWithoutShift(e24) {
      let t2 = true;
      return this._selectionDirection = D, this.selectionEnd === this.selectionStart && this.selectionStart !== 0 && (t2 = this._moveLeft(e24, `selectionStart`)), this.selectionEnd = this.selectionStart, t2;
    }
    moveCursorLeftWithShift(e24) {
      return this._selectionDirection === `right` && this.selectionStart !== this.selectionEnd ? this._moveLeft(e24, `selectionEnd`) : this.selectionStart === 0 ? void 0 : (this._selectionDirection = D, this._moveLeft(e24, `selectionStart`));
    }
    moveCursorRight(e24) {
      this.selectionStart >= this._text.length && this.selectionEnd >= this._text.length || this._moveCursorLeftOrRight(`Right`, e24);
    }
    _moveCursorLeftOrRight(e24, t2) {
      let n2 = `moveCursor${e24}${t2.shiftKey ? `WithShift` : `WithoutShift`}`;
      this._currentCursorOpacity = 1, this[n2](t2) && (this.abortCursorAnimation(), this.initDelayedCursor(), this._fireSelectionChanged(), this._updateTextarea());
    }
    moveCursorRightWithShift(e24) {
      return this._selectionDirection === `left` && this.selectionStart !== this.selectionEnd ? this._moveRight(e24, `selectionStart`) : this.selectionEnd === this._text.length ? void 0 : (this._selectionDirection = k, this._moveRight(e24, `selectionEnd`));
    }
    moveCursorRightWithoutShift(e24) {
      let t2 = true;
      return this._selectionDirection = k, this.selectionStart === this.selectionEnd ? (t2 = this._moveRight(e24, `selectionStart`), this.selectionEnd = this.selectionStart) : this.selectionStart = this.selectionEnd, t2;
    }
  };
  var ns = (e24) => !!e24.button;
  var rs = class extends ts {
    constructor(...e24) {
      super(...e24), i(this, `draggableTextDelegate`, void 0);
    }
    initBehavior() {
      this.on(`mousedown`, this._mouseDownHandler), this.on(`mouseup`, this.mouseUpHandler), this.on(`mousedblclick`, this.doubleClickHandler), this.on(`mousetripleclick`, this.tripleClickHandler), this.draggableTextDelegate = new Qo(this), super.initBehavior();
    }
    shouldStartDragging() {
      return this.draggableTextDelegate.isActive();
    }
    onDragStart(e24) {
      return this.draggableTextDelegate.onDragStart(e24);
    }
    canDrop(e24) {
      return this.draggableTextDelegate.canDrop(e24);
    }
    doubleClickHandler(e24) {
      this.isEditing && (this.selectWord(this.getSelectionStartFromPointer(e24.e)), this.renderCursorOrSelection());
    }
    tripleClickHandler(e24) {
      this.isEditing && (this.selectLine(this.getSelectionStartFromPointer(e24.e)), this.renderCursorOrSelection());
    }
    _mouseDownHandler({ e: e24, alreadySelected: t2 }) {
      this.canvas && this.editable && !ns(e24) && !this.getActiveControl() && (this.draggableTextDelegate.start(e24) || (this.canvas.textEditingManager.register(this), t2 && (this.inCompositionMode = false, this.setCursorByClick(e24)), this.isEditing && (this.__selectionStartOnMouseDown = this.selectionStart, this.selectionStart === this.selectionEnd && this.abortCursorAnimation(), this.renderCursorOrSelection()), this.selected || (this.selected = t2 || this.isEditing)));
    }
    mouseUpHandler({ e: e24, transform: t2 }) {
      let n2 = this.draggableTextDelegate.end(e24);
      if (this.canvas) {
        this.canvas.textEditingManager.unregister(this);
        let e25 = this.canvas._activeObject;
        if (e25 && e25 !== this) return;
      }
      !this.editable || this.group && !this.group.interactive || t2 && t2.actionPerformed || ns(e24) || n2 || this.selected && !this.getActiveControl() && (this.enterEditing(e24), this.selectionStart === this.selectionEnd ? this.initDelayedCursor(true) : this.renderCursorOrSelection());
    }
    setCursorByClick(e24) {
      let t2 = this.getSelectionStartFromPointer(e24), n2 = this.selectionStart, r2 = this.selectionEnd;
      e24.shiftKey ? this.setSelectionStartEndWithShift(n2, r2, t2) : (this.selectionStart = t2, this.selectionEnd = t2), this.isEditing && (this._fireSelectionChanged(), this._updateTextarea());
    }
    getSelectionStartFromPointer(e24) {
      let t2 = this.canvas.getScenePoint(e24).transform(R(this.calcTransformMatrix())).add(new N(-this._getLeftOffset(), -this._getTopOffset())), n2 = 0, r2 = 0, i2 = 0;
      for (let e25 = 0; e25 < this._textLines.length && n2 <= t2.y; e25++) n2 += this.getHeightOfLine(e25), i2 = e25, e25 > 0 && (r2 += this._textLines[e25 - 1].length + this.missingNewlineOffset(e25 - 1));
      let a2 = Math.abs(this._getLineLeftOffset(i2)), o2 = this._textLines[i2].length, s2 = this.__charBounds[i2];
      for (let e25 = 0; e25 < o2; e25++) {
        let n3 = a2 + s2[e25].kernedWidth;
        if (t2.x <= n3) {
          Math.abs(t2.x - n3) <= Math.abs(t2.x - a2) && r2++;
          break;
        }
        a2 = n3, r2++;
      }
      return Math.min(this.flipX ? o2 - r2 : r2, this._text.length);
    }
  };
  var is = `moveCursorUp`;
  var as = `moveCursorDown`;
  var os = `moveCursorLeft`;
  var ss = `moveCursorRight`;
  var cs = `exitEditing`;
  var ls = (e24, t2) => {
    let n2 = t2.getRetinaScaling();
    e24.setTransform(n2, 0, 0, n2, 0, 0);
    let r2 = t2.viewportTransform;
    e24.transform(r2[0], r2[1], r2[2], r2[3], r2[4], r2[5]);
  };
  var us = { selectionStart: 0, selectionEnd: 0, selectionColor: `rgba(17,119,255,0.3)`, isEditing: false, editable: true, editingBorderColor: `rgba(102,153,255,0.25)`, cursorWidth: 2, cursorColor: ``, cursorDelay: 1e3, cursorDuration: 600, caching: true, hiddenTextareaContainer: null, keysMap: { 9: cs, 27: cs, 33: is, 34: as, 35: ss, 36: os, 37: os, 38: is, 39: ss, 40: as }, keysMapRtl: { 9: cs, 27: cs, 33: is, 34: as, 35: os, 36: ss, 37: ss, 38: is, 39: os, 40: as }, ctrlKeysMapDown: { 65: `cmdAll` }, ctrlKeysMapUp: { 67: `copy`, 88: `cut` }, _selectionDirection: null, _reSpace: /\s|\r?\n/, inCompositionMode: false };
  var ds = class e20 extends rs {
    static getDefaults() {
      return { ...super.getDefaults(), ...e20.ownDefaults };
    }
    get type() {
      let e24 = super.type;
      return e24 === `itext` ? `i-text` : e24;
    }
    constructor(t2, n2) {
      super(t2, { ...e20.ownDefaults, ...n2 }), this.initBehavior();
    }
    _set(e24, t2) {
      return this.isEditing && this._savedProps && e24 in this._savedProps ? (this._savedProps[e24] = t2, this) : (e24 === `canvas` && (this.canvas instanceof ho && this.canvas.textEditingManager.remove(this), t2 instanceof ho && t2.textEditingManager.add(this)), super._set(e24, t2));
    }
    setSelectionStart(e24) {
      e24 = Math.max(e24, 0), this._updateAndFire(`selectionStart`, e24);
    }
    setSelectionEnd(e24) {
      e24 = Math.min(e24, this.text.length), this._updateAndFire(`selectionEnd`, e24);
    }
    _updateAndFire(e24, t2) {
      this[e24] !== t2 && (this._fireSelectionChanged(), this[e24] = t2), this._updateTextarea();
    }
    _fireSelectionChanged() {
      this.fire(`selection:changed`), this.canvas && this.canvas.fire(`text:selection:changed`, { target: this });
    }
    initDimensions() {
      this.isEditing && this.initDelayedCursor(), super.initDimensions();
    }
    getSelectionStyles(e24 = this.selectionStart || 0, t2 = this.selectionEnd, n2) {
      return super.getSelectionStyles(e24, t2, n2);
    }
    setSelectionStyles(e24, t2 = this.selectionStart || 0, n2 = this.selectionEnd) {
      return super.setSelectionStyles(e24, t2, n2);
    }
    get2DCursorLocation(e24 = this.selectionStart, t2) {
      return super.get2DCursorLocation(e24, t2);
    }
    render(e24) {
      super.render(e24), this.cursorOffsetCache = {}, this.renderCursorOrSelection();
    }
    toCanvasElement(e24) {
      let t2 = this.isEditing;
      this.isEditing = false;
      let n2 = super.toCanvasElement(e24);
      return this.isEditing = t2, n2;
    }
    renderCursorOrSelection() {
      if (!this.isEditing || !this.canvas) return;
      let e24 = this.clearContextTop(true);
      if (!e24) return;
      let t2 = this._getCursorBoundaries(), n2 = this.findAncestorsWithClipPath(), r2 = n2.length > 0, i2, a2 = e24;
      if (r2) {
        i2 = F(e24.canvas), a2 = i2.getContext(`2d`), ls(a2, this.canvas);
        let t3 = this.calcTransformMatrix();
        a2.transform(t3[0], t3[1], t3[2], t3[3], t3[4], t3[5]);
      }
      if (this.selectionStart !== this.selectionEnd || this.inCompositionMode ? this.renderSelection(a2, t2) : this.renderCursor(a2, t2), r2) for (let t3 of n2) {
        let n3 = t3.clipPath, r3 = F(e24.canvas), i3 = r3.getContext(`2d`);
        if (ls(i3, this.canvas), !n3.absolutePositioned) {
          let e25 = t3.calcTransformMatrix();
          i3.transform(e25[0], e25[1], e25[2], e25[3], e25[4], e25[5]);
        }
        n3.transform(i3), n3.drawObject(i3, true, {}), this.drawClipPathOnCache(a2, n3, r3);
      }
      r2 && (e24.setTransform(1, 0, 0, 1, 0, 0), e24.drawImage(i2, 0, 0)), this.canvas.contextTopDirty = true, e24.restore();
    }
    findAncestorsWithClipPath() {
      let e24 = [], t2 = this;
      for (; t2; ) t2.clipPath && e24.push(t2), t2 = t2.parent;
      return e24;
    }
    _getCursorBoundaries(e24 = this.selectionStart, t2) {
      let n2 = this._getLeftOffset(), r2 = this._getTopOffset(), i2 = this._getCursorBoundariesOffsets(e24, t2);
      return { left: n2, top: r2, leftOffset: i2.left, topOffset: i2.top };
    }
    _getCursorBoundariesOffsets(e24, t2) {
      return t2 ? this.__getCursorBoundariesOffsets(e24) : this.cursorOffsetCache && `top` in this.cursorOffsetCache ? this.cursorOffsetCache : this.cursorOffsetCache = this.__getCursorBoundariesOffsets(e24);
    }
    __getCursorBoundariesOffsets(e24) {
      let t2 = 0, n2 = 0, { charIndex: r2, lineIndex: i2 } = this.get2DCursorLocation(e24), { textAlign: a2, direction: o2 } = this;
      for (let e25 = 0; e25 < i2; e25++) t2 += this.getHeightOfLine(e25);
      let s2 = this._getLineLeftOffset(i2), c2 = this.__charBounds[i2][r2];
      c2 && (n2 = c2.left), this.charSpacing !== 0 && r2 === this._textLines[i2].length && (n2 -= this._getWidthOfCharSpacing());
      let l2 = s2 + (n2 > 0 ? n2 : 0);
      return o2 === `rtl` && (a2 === `right` || a2 === `justify` || a2 === `justify-right` ? l2 *= -1 : a2 === `left` || a2 === `justify-left` ? l2 = s2 - (n2 > 0 ? n2 : 0) : a2 !== `center` && a2 !== `justify-center` || (l2 = s2 - (n2 > 0 ? n2 : 0))), { top: t2, left: l2 };
    }
    renderCursorAt(e24) {
      this._renderCursor(this.canvas.contextTop, this._getCursorBoundaries(e24, true), e24);
    }
    renderCursor(e24, t2) {
      this._renderCursor(e24, t2, this.selectionStart);
    }
    getCursorRenderingData(e24 = this.selectionStart, t2 = this._getCursorBoundaries(e24)) {
      let n2 = this.get2DCursorLocation(e24), r2 = n2.lineIndex, i2 = n2.charIndex > 0 ? n2.charIndex - 1 : 0, a2 = this.getValueOfPropertyAt(r2, i2, `fontSize`), o2 = this.getObjectScaling().x * this.canvas.getZoom(), s2 = this.cursorWidth / o2, c2 = this.getValueOfPropertyAt(r2, i2, `deltaY`), l2 = t2.topOffset + (1 - this._fontSizeFraction) * this.getHeightOfLine(r2) / this.lineHeight - a2 * (1 - this._fontSizeFraction);
      return { color: this.cursorColor || this.getValueOfPropertyAt(r2, i2, `fill`), opacity: this._currentCursorOpacity, left: t2.left + t2.leftOffset - s2 / 2, top: l2 + t2.top + c2, width: s2, height: a2 };
    }
    _renderCursor(e24, t2, n2) {
      let { color: r2, opacity: i2, left: a2, top: o2, width: s2, height: c2 } = this.getCursorRenderingData(n2, t2);
      e24.fillStyle = r2, e24.globalAlpha = i2, e24.fillRect(a2, o2, s2, c2);
    }
    renderSelection(e24, t2) {
      let n2 = { selectionStart: this.inCompositionMode ? this.hiddenTextarea.selectionStart : this.selectionStart, selectionEnd: this.inCompositionMode ? this.hiddenTextarea.selectionEnd : this.selectionEnd };
      this._renderSelection(e24, n2, t2);
    }
    renderDragSourceEffect() {
      let e24 = this.draggableTextDelegate.getDragStartSelection();
      this._renderSelection(this.canvas.contextTop, e24, this._getCursorBoundaries(e24.selectionStart, true));
    }
    renderDropTargetEffect(e24) {
      let t2 = this.getSelectionStartFromPointer(e24);
      this.renderCursorAt(t2);
    }
    _renderSelection(e24, t2, n2) {
      let { textAlign: r2, direction: i2 } = this, a2 = t2.selectionStart, o2 = t2.selectionEnd, s2 = r2.includes(En), c2 = this.get2DCursorLocation(a2), l2 = this.get2DCursorLocation(o2), u2 = c2.lineIndex, d2 = l2.lineIndex, f2 = c2.charIndex < 0 ? 0 : c2.charIndex, p2 = l2.charIndex < 0 ? 0 : l2.charIndex;
      for (let t3 = u2; t3 <= d2; t3++) {
        let a3 = this._getLineLeftOffset(t3) || 0, o3 = this.getHeightOfLine(t3), c3 = 0, l3 = 0;
        if (t3 === u2 && (c3 = this.__charBounds[u2][f2].left), t3 >= u2 && t3 < d2) l3 = s2 && !this.isEndOfWrapping(t3) ? this.width : this.getLineWidth(t3) || 5;
        else if (t3 === d2) if (p2 === 0) l3 = this.__charBounds[d2][p2].left;
        else {
          let e25 = this._getWidthOfCharSpacing();
          l3 = this.__charBounds[d2][p2 - 1].left + this.__charBounds[d2][p2 - 1].width - e25;
        }
        let m = o3;
        (this.lineHeight < 1 || t3 === d2 && this.lineHeight > 1) && (o3 /= this.lineHeight);
        let h2 = n2.left + a3 + c3, g2 = o3, _2 = 0, v2 = l3 - c3;
        this.inCompositionMode ? (e24.fillStyle = this.compositionColor || `black`, g2 = 1, _2 = o3) : e24.fillStyle = this.selectionColor, i2 === `rtl` && (r2 === `right` || r2 === `justify` || r2 === `justify-right` ? h2 = this.width - h2 - v2 : r2 === `left` || r2 === `justify-left` ? h2 = n2.left + a3 - l3 : r2 !== `center` && r2 !== `justify-center` || (h2 = n2.left + a3 - l3)), e24.fillRect(h2, n2.top + n2.topOffset + _2, v2, g2), n2.topOffset += m;
      }
    }
    getCurrentCharFontSize() {
      let e24 = this._getCurrentCharIndex();
      return this.getValueOfPropertyAt(e24.l, e24.c, `fontSize`);
    }
    getCurrentCharColor() {
      let e24 = this._getCurrentCharIndex();
      return this.getValueOfPropertyAt(e24.l, e24.c, j);
    }
    _getCurrentCharIndex() {
      let e24 = this.get2DCursorLocation(this.selectionStart, true), t2 = e24.charIndex > 0 ? e24.charIndex - 1 : 0;
      return { l: e24.lineIndex, c: t2 };
    }
    dispose() {
      this.exitEditingImpl(), this.draggableTextDelegate.dispose(), super.dispose();
    }
  };
  i(ds, `ownDefaults`, us), i(ds, `type`, `IText`), M.setClass(ds), M.setClass(ds, `i-text`);
  var fs = class e21 extends ds {
    static getDefaults() {
      return { ...super.getDefaults(), ...e21.ownDefaults };
    }
    constructor(t2, n2) {
      super(t2, { ...e21.ownDefaults, ...n2 });
    }
    static createControls() {
      return { controls: gi() };
    }
    initDimensions() {
      this.initialized && (this.isEditing && this.initDelayedCursor(), this._clearCache(), this.dynamicMinWidth = 0, this._styleMap = this._generateStyleMap(this._splitText()), this.dynamicMinWidth > this.width && this._set(`width`, this.dynamicMinWidth), this.textAlign.includes(`justify`) && this.enlargeSpaces(), this.height = this.calcTextHeight());
    }
    _generateStyleMap(e24) {
      let t2 = 0, n2 = 0, r2 = 0, i2 = {};
      for (let a2 = 0; a2 < e24.graphemeLines.length; a2++) e24.graphemeText[r2] === `
` && a2 > 0 ? (n2 = 0, r2++, t2++) : !this.splitByGrapheme && this._reSpaceAndTab.test(e24.graphemeText[r2]) && a2 > 0 && (n2++, r2++), i2[a2] = { line: t2, offset: n2 }, r2 += e24.graphemeLines[a2].length, n2 += e24.graphemeLines[a2].length;
      return i2;
    }
    styleHas(e24, t2) {
      if (this._styleMap && !this.isWrapping) {
        let e25 = this._styleMap[t2];
        e25 && (t2 = e25.line);
      }
      return super.styleHas(e24, t2);
    }
    isEmptyStyles(e24) {
      if (!this.styles) return true;
      let t2, n2, r2 = 0, i2 = false, a2 = this._styleMap[e24], o2 = this._styleMap[e24 + 1];
      a2 && (e24 = a2.line, r2 = a2.offset), o2 && (t2 = o2.line, i2 = t2 === e24, n2 = o2.offset);
      let s2 = e24 === void 0 ? this.styles : { line: this.styles[e24] };
      for (let e25 in s2) for (let t3 in s2[e25]) {
        let a3 = parseInt(t3, 10);
        if (a3 >= r2 && (!i2 || a3 < n2)) for (let n3 in s2[e25][t3]) return false;
      }
      return true;
    }
    _getStyleDeclaration(e24, t2) {
      if (this._styleMap && !this.isWrapping) {
        let n2 = this._styleMap[e24];
        if (!n2) return {};
        e24 = n2.line, t2 = n2.offset + t2;
      }
      return super._getStyleDeclaration(e24, t2);
    }
    _setStyleDeclaration(e24, t2, n2) {
      let r2 = this._styleMap[e24];
      super._setStyleDeclaration(r2.line, r2.offset + t2, n2);
    }
    _deleteStyleDeclaration(e24, t2) {
      let n2 = this._styleMap[e24];
      super._deleteStyleDeclaration(n2.line, n2.offset + t2);
    }
    _getLineStyle(e24) {
      let t2 = this._styleMap[e24];
      return !!this.styles[t2.line];
    }
    _setLineStyle(e24) {
      let t2 = this._styleMap[e24];
      super._setLineStyle(t2.line);
    }
    _wrapText(e24, t2) {
      this.isWrapping = true;
      let n2 = this.getGraphemeDataForRender(e24), r2 = [];
      for (let e25 = 0; e25 < n2.wordsData.length; e25++) r2.push(...this._wrapLine(e25, t2, n2));
      return this.isWrapping = false, r2;
    }
    getGraphemeDataForRender(e24) {
      let t2 = this.splitByGrapheme, n2 = t2 ? `` : ` `, r2 = 0;
      return { wordsData: e24.map((e25, i2) => {
        let a2 = 0, o2 = t2 ? this.graphemeSplit(e25) : this.wordSplit(e25);
        return o2.length === 0 ? [{ word: [], width: 0 }] : o2.map((e26) => {
          let o3 = t2 ? [e26] : this.graphemeSplit(e26), s2 = this._measureWord(o3, i2, a2);
          return r2 = Math.max(s2, r2), a2 += o3.length + n2.length, { word: o3, width: s2 };
        });
      }), largestWordWidth: r2 };
    }
    _measureWord(e24, t2, n2 = 0) {
      let r2, i2 = 0;
      for (let a2 = 0, o2 = e24.length; a2 < o2; a2++) i2 += this._getGraphemeBox(e24[a2], t2, a2 + n2, r2, true).kernedWidth, r2 = e24[a2];
      return i2;
    }
    wordSplit(e24) {
      return e24.split(this._wordJoiners);
    }
    _wrapLine(e24, t2, { largestWordWidth: n2, wordsData: r2 }, i2 = 0) {
      let a2 = this._getWidthOfCharSpacing(), o2 = this.splitByGrapheme, s2 = [], c2 = o2 ? `` : ` `, l2 = 0, u2 = [], d2 = 0, f2 = 0, p2 = true;
      t2 -= i2;
      let m = Math.max(t2, n2, this.dynamicMinWidth), h2 = r2[e24], g2;
      for (g2 = 0; g2 < h2.length; g2++) {
        let { word: t3, width: n3 } = h2[g2];
        d2 += t3.length, l2 += f2 + n3 - a2, l2 > m && !p2 ? (s2.push(u2), u2 = [], l2 = n3, p2 = true) : l2 += a2, p2 || o2 || u2.push(c2), u2 = u2.concat(t3), f2 = o2 ? 0 : this._measureWord([c2], e24, d2), d2++, p2 = false;
      }
      return g2 && s2.push(u2), n2 + i2 > this.dynamicMinWidth && (this.dynamicMinWidth = n2 - a2 + i2), s2;
    }
    isEndOfWrapping(e24) {
      return !this._styleMap[e24 + 1] || this._styleMap[e24 + 1].line !== this._styleMap[e24].line;
    }
    missingNewlineOffset(e24, t2) {
      return this.splitByGrapheme && !t2 ? +!!this.isEndOfWrapping(e24) : 1;
    }
    _splitTextIntoLines(e24) {
      let t2 = super._splitTextIntoLines(e24), n2 = this._wrapText(t2.lines, this.width), r2 = Array(n2.length);
      for (let e25 = 0; e25 < n2.length; e25++) r2[e25] = n2[e25].join(``);
      return t2.lines = r2, t2.graphemeLines = n2, t2;
    }
    getMinWidth() {
      return Math.max(this.minWidth, this.dynamicMinWidth);
    }
    _removeExtraneousStyles() {
      let e24 = /* @__PURE__ */ new Map();
      for (let t2 in this._styleMap) {
        let n2 = parseInt(t2, 10);
        if (this._textLines[n2]) {
          let n3 = this._styleMap[t2].line;
          e24.set(`${n3}`, true);
        }
      }
      for (let t2 in this.styles) e24.has(t2) || delete this.styles[t2];
    }
    toObject(e24 = []) {
      return super.toObject([`minWidth`, `splitByGrapheme`, ...e24]);
    }
  };
  i(fs, `type`, `Textbox`), i(fs, `textLayoutProperties`, [...ds.textLayoutProperties, `width`]), i(fs, `ownDefaults`, { minWidth: 20, dynamicMinWidth: 2, lockScalingFlip: true, noScaleCache: false, _wordJoiners: /[ \t\r]/, splitByGrapheme: false }), M.setClass(fs);
  var ps = class extends ra {
    shouldPerformLayout(e24) {
      return !!e24.target.clipPath && super.shouldPerformLayout(e24);
    }
    shouldLayoutClipPath() {
      return false;
    }
    calcLayoutResult(e24, t2) {
      let { target: n2 } = e24, { clipPath: r2, group: i2 } = n2;
      if (!r2 || !this.shouldPerformLayout(e24)) return;
      let { width: a2, height: o2 } = wt(na(n2, r2)), s2 = new N(a2, o2);
      if (r2.absolutePositioned) return { center: Mt(r2.getRelativeCenterPoint(), void 0, i2 ? i2.calcTransformMatrix() : void 0), size: s2 };
      {
        let i3 = r2.getRelativeCenterPoint().transform(n2.calcOwnMatrix(), true);
        if (this.shouldPerformLayout(e24)) {
          let { center: n3 = new N(), correction: r3 = new N() } = this.calcBoundingBox(t2, e24) || {};
          return { center: n3.add(i3), correction: r3.subtract(i3), size: s2 };
        }
        return { center: n2.getRelativeCenterPoint().add(i3), size: s2 };
      }
    }
  };
  i(ps, `type`, `clip-path`), M.setClass(ps);
  var ms = class extends ra {
    getInitialSize({ target: e24 }, { size: t2 }) {
      return new N(e24.width || t2.x, e24.height || t2.y);
    }
  };
  i(ms, `type`, `fixed`), M.setClass(ms);
  var hs = class extends oa {
    subscribeTargets(e24) {
      let t2 = e24.target;
      e24.targets.reduce((e25, t3) => (t3.parent && e25.add(t3.parent), e25), /* @__PURE__ */ new Set()).forEach((e25) => {
        e25.layoutManager.subscribeTargets({ target: e25, targets: [t2] });
      });
    }
    unsubscribeTargets(e24) {
      let t2 = e24.target, n2 = t2.getObjects();
      e24.targets.reduce((e25, t3) => (t3.parent && e25.add(t3.parent), e25), /* @__PURE__ */ new Set()).forEach((e25) => {
        !n2.some((t3) => t3.parent === e25) && e25.layoutManager.unsubscribeTargets({ target: e25, targets: [t2] });
      });
    }
  };
  var gs = class e22 extends ca {
    static getDefaults() {
      return { ...super.getDefaults(), ...e22.ownDefaults };
    }
    constructor(t2 = [], n2 = {}) {
      super(), Object.assign(this, e22.ownDefaults), this.setOptions(n2);
      let { left: r2, top: i2, layoutManager: a2 } = n2;
      this.groupInit(t2, { left: r2, top: i2, layoutManager: a2 == null ? new hs() : a2 });
    }
    _shouldSetNestedCoords() {
      return true;
    }
    __objectSelectionMonitor() {
    }
    multiSelectAdd(...e24) {
      this.multiSelectionStacking === `selection-order` ? this.add(...e24) : e24.forEach((e25) => {
        let t2 = this._objects.findIndex((t3) => t3.isInFrontOf(e25)), n2 = t2 === -1 ? this.size() : t2;
        this.insertAt(n2, e25);
      });
    }
    canEnterGroup(e24) {
      return this.getObjects().some((t2) => t2.isDescendantOf(e24) || e24.isDescendantOf(t2)) ? (s(`error`, `ActiveSelection: circular object trees are not supported, this call has no effect`), false) : super.canEnterGroup(e24);
    }
    enterGroup(e24, t2) {
      e24.parent && e24.parent === e24.group ? e24.parent._exitGroup(e24) : e24.group && e24.parent !== e24.group && e24.group.remove(e24), this._enterGroup(e24, t2);
    }
    exitGroup(e24, t2) {
      this._exitGroup(e24, t2), e24.parent && e24.parent._enterGroup(e24, true);
    }
    _onAfterObjectsChange(e24, t2) {
      super._onAfterObjectsChange(e24, t2);
      let n2 = /* @__PURE__ */ new Set();
      t2.forEach((e25) => {
        let { parent: t3 } = e25;
        t3 && n2.add(t3);
      }), e24 === `removed` ? n2.forEach((e25) => {
        e25._onAfterObjectsChange(ta, t2);
      }) : n2.forEach((e25) => {
        e25._set(`dirty`, true);
      });
    }
    onDeselect() {
      return this.removeAll(), false;
    }
    toString() {
      return `#<ActiveSelection: (${this.complexity()})>`;
    }
    shouldCache() {
      return false;
    }
    isOnACache() {
      return false;
    }
    _renderControls(e24, t2, n2) {
      e24.save(), e24.globalAlpha = this.isMoving ? this.borderOpacityWhenMoving : 1;
      let r2 = { hasControls: false, ...n2, forActiveSelection: true };
      for (let t3 = 0; t3 < this._objects.length; t3++) this._objects[t3]._renderControls(e24, r2);
      super._renderControls(e24, t2), e24.restore();
    }
  };
  i(gs, `type`, `ActiveSelection`), i(gs, `ownDefaults`, { multiSelectionStacking: `canvas-stacking` }), M.setClass(gs), M.setClass(gs, `activeSelection`);
  var _s = class {
    constructor() {
      i(this, `resources`, {});
    }
    applyFilters(e24, t2, n2, r2, i2) {
      let a2 = i2.getContext(`2d`, { willReadFrequently: true, desynchronized: true });
      if (!a2) return;
      a2.drawImage(t2, 0, 0, n2, r2);
      let o2 = { sourceWidth: n2, sourceHeight: r2, imageData: a2.getImageData(0, 0, n2, r2), originalEl: t2, originalImageData: a2.getImageData(0, 0, n2, r2), canvasEl: i2, ctx: a2, filterBackend: this };
      e24.forEach((e25) => {
        e25.applyTo(o2);
      });
      let { imageData: s2 } = o2;
      return s2.width === n2 && s2.height === r2 || (i2.width = s2.width, i2.height = s2.height), a2.putImageData(s2, 0, 0), o2;
    }
  };
  var vs = class {
    constructor({ tileSize: e24 = o.textureSize } = {}) {
      i(this, `aPosition`, new Float32Array([0, 0, 0, 1, 1, 0, 1, 1])), i(this, `resources`, {}), this.tileSize = e24, this.setupGLContext(e24, e24), this.captureGPUInfo();
    }
    setupGLContext(e24, t2) {
      this.dispose(), this.createWebGLCanvas(e24, t2);
    }
    createWebGLCanvas(e24, t2) {
      let n2 = F({ width: e24, height: t2 }), r2 = n2.getContext(`webgl`, { alpha: true, premultipliedAlpha: false, depth: false, stencil: false, antialias: false });
      r2 && (r2.clearColor(0, 0, 0, 0), this.canvas = n2, this.gl = r2);
    }
    applyFilters(e24, t2, n2, r2, i2, a2) {
      let o2 = this.gl, s2 = i2.getContext(`2d`);
      if (!o2 || !s2) return;
      let c2;
      a2 && (c2 = this.getCachedTexture(a2, t2));
      let l2 = { originalWidth: t2.width || t2.naturalWidth || 0, originalHeight: t2.height || t2.naturalHeight || 0, sourceWidth: n2, sourceHeight: r2, destinationWidth: n2, destinationHeight: r2, context: o2, sourceTexture: this.createTexture(o2, n2, r2, c2 ? void 0 : t2), targetTexture: this.createTexture(o2, n2, r2), originalTexture: c2 || this.createTexture(o2, n2, r2, c2 ? void 0 : t2), passes: e24.length, webgl: true, aPosition: this.aPosition, programCache: this.programCache, pass: 0, filterBackend: this, targetCanvas: i2 }, u2 = o2.createFramebuffer();
      return o2.bindFramebuffer(o2.FRAMEBUFFER, u2), e24.forEach((e25) => {
        e25 && e25.applyTo(l2);
      }), function(e25) {
        let t3 = e25.targetCanvas, n3 = t3.width, r3 = t3.height, i3 = e25.destinationWidth, a3 = e25.destinationHeight;
        n3 === i3 && r3 === a3 || (t3.width = i3, t3.height = a3);
      }(l2), this.copyGLTo2D(o2, l2), o2.bindTexture(o2.TEXTURE_2D, null), o2.deleteTexture(l2.sourceTexture), o2.deleteTexture(l2.targetTexture), o2.deleteFramebuffer(u2), s2.setTransform(1, 0, 0, 1, 0, 0), l2;
    }
    dispose() {
      this.canvas && (this.canvas = null, this.gl = null), this.clearWebGLCaches();
    }
    clearWebGLCaches() {
      this.programCache = {}, this.textureCache = {};
    }
    createTexture(e24, t2, n2, r2, i2) {
      let { NEAREST: a2, TEXTURE_2D: o2, RGBA: s2, UNSIGNED_BYTE: c2, CLAMP_TO_EDGE: l2, TEXTURE_MAG_FILTER: u2, TEXTURE_MIN_FILTER: d2, TEXTURE_WRAP_S: f2, TEXTURE_WRAP_T: p2 } = e24, m = e24.createTexture();
      return e24.bindTexture(o2, m), e24.texParameteri(o2, u2, i2 || a2), e24.texParameteri(o2, d2, i2 || a2), e24.texParameteri(o2, f2, l2), e24.texParameteri(o2, p2, l2), r2 ? e24.texImage2D(o2, 0, s2, s2, c2, r2) : e24.texImage2D(o2, 0, s2, t2, n2, 0, s2, c2, null), m;
    }
    getCachedTexture(e24, t2, n2) {
      let { textureCache: r2 } = this;
      if (r2[e24]) return r2[e24];
      {
        let i2 = this.createTexture(this.gl, t2.width, t2.height, t2, n2);
        return i2 && (r2[e24] = i2), i2;
      }
    }
    evictCachesForKey(e24) {
      this.textureCache[e24] && (this.gl.deleteTexture(this.textureCache[e24]), delete this.textureCache[e24]);
    }
    copyGLTo2D(e24, t2) {
      let n2 = e24.canvas, r2 = t2.targetCanvas, i2 = r2.getContext(`2d`);
      if (!i2) return;
      i2.translate(0, r2.height), i2.scale(1, -1);
      let a2 = n2.height - r2.height;
      i2.drawImage(n2, 0, a2, r2.width, r2.height, 0, 0, r2.width, r2.height);
    }
    copyGLTo2DPutImageData(e24, t2) {
      let n2 = t2.targetCanvas.getContext(`2d`), r2 = t2.destinationWidth, i2 = t2.destinationHeight, a2 = r2 * i2 * 4;
      if (!n2) return;
      let o2 = new Uint8Array(this.imageBuffer, 0, a2), s2 = new Uint8ClampedArray(this.imageBuffer, 0, a2);
      e24.readPixels(0, 0, r2, i2, e24.RGBA, e24.UNSIGNED_BYTE, o2);
      let c2 = new ImageData(s2, r2, i2);
      n2.putImageData(c2, 0, 0);
    }
    captureGPUInfo() {
      if (this.gpuInfo) return this.gpuInfo;
      let e24 = this.gl, t2 = { renderer: ``, vendor: `` };
      if (!e24) return t2;
      let n2 = e24.getExtension(`WEBGL_debug_renderer_info`);
      if (n2) {
        let r2 = e24.getParameter(n2.UNMASKED_RENDERER_WEBGL), i2 = e24.getParameter(n2.UNMASKED_VENDOR_WEBGL);
        r2 && (t2.renderer = r2.toLowerCase()), i2 && (t2.vendor = i2.toLowerCase());
      }
      return this.gpuInfo = t2, t2;
    }
  };
  var ys;
  function bs() {
    let { WebGLProbe: e24 } = h();
    return e24.queryWebGL(P()), o.enableGLFiltering && e24.isSupported(o.textureSize) ? new vs({ tileSize: o.textureSize }) : new _s();
  }
  function xs(e24 = true) {
    return !ys && e24 && (ys = bs()), ys;
  }
  var Cs = [`cropX`, `cropY`];
  var ws = class e23 extends J {
    static getDefaults() {
      return { ...super.getDefaults(), ...e23.ownDefaults };
    }
    constructor(t2, n2) {
      super(), i(this, `_lastScaleX`, 1), i(this, `_lastScaleY`, 1), i(this, `_filterScalingX`, 1), i(this, `_filterScalingY`, 1), this.filters = [], Object.assign(this, e23.ownDefaults), this.setOptions(n2), this.cacheKey = `texture${je()}`, this.setElement(typeof t2 == `string` ? (this.canvas && H(this.canvas.getElement()) || g()).getElementById(t2) : t2, n2);
    }
    getElement() {
      return this._element;
    }
    setElement(e24, t2 = {}) {
      this.removeTexture(this.cacheKey), this.removeTexture(`${this.cacheKey}_filtered`), this._element = e24, this._originalElement = e24, this._setWidthHeight(t2), this.filters.length !== 0 && this.applyFilters(), this.resizeFilter && this.applyResizeFilters();
    }
    removeTexture(e24) {
      let t2 = xs(false);
      t2 instanceof vs && t2.evictCachesForKey(e24);
    }
    dispose() {
      super.dispose(), this.removeTexture(this.cacheKey), this.removeTexture(`${this.cacheKey}_filtered`), this._cacheContext = null, [`_originalElement`, `_element`, `_filteredEl`, `_cacheCanvas`].forEach((e24) => {
        let t2 = this[e24];
        t2 && h().dispose(t2), this[e24] = void 0;
      });
    }
    getCrossOrigin() {
      return this._originalElement && (this._originalElement.crossOrigin || null);
    }
    getOriginalSize() {
      let e24 = this.getElement();
      return e24 ? { width: e24.naturalWidth || e24.width, height: e24.naturalHeight || e24.height } : { width: 0, height: 0 };
    }
    _stroke(e24) {
      if (!this.stroke || this.strokeWidth === 0) return;
      let t2 = this.width / 2, n2 = this.height / 2;
      e24.beginPath(), e24.moveTo(-t2, -n2), e24.lineTo(t2, -n2), e24.lineTo(t2, n2), e24.lineTo(-t2, n2), e24.lineTo(-t2, -n2), e24.closePath();
    }
    toObject(e24 = []) {
      let t2 = [];
      return this.filters.forEach((e25) => {
        e25 && t2.push(e25.toObject());
      }), { ...super.toObject([...Cs, ...e24]), src: this.getSrc(), crossOrigin: this.getCrossOrigin(), filters: t2, ...this.resizeFilter ? { resizeFilter: this.resizeFilter.toObject() } : {} };
    }
    hasCrop() {
      return !!this.cropX || !!this.cropY || this.width < this._element.width || this.height < this._element.height;
    }
    _toSVG() {
      let e24 = [], t2 = this._element, n2 = -this.width / 2, r2 = -this.height / 2, i2 = [], a2 = [], o2 = ``, s2 = ``;
      if (!t2) return [];
      if (this.hasCrop()) {
        let e25 = je();
        i2.push(`<clipPath id="imageCrop_` + e25 + `">
`, `	<rect x="` + n2 + `" y="` + r2 + `" width="` + U(this.width) + `" height="` + U(this.height) + `" />
`, `</clipPath>
`), o2 = ` clip-path="url(#imageCrop_` + e25 + `)" `;
      }
      if (this.imageSmoothing || (s2 = ` image-rendering="optimizeSpeed"`), e24.push(`	<image `, `COMMON_PARTS`, `xlink:href="${U(this.getSrc(true))}" x="${n2 - this.cropX}" y="${r2 - this.cropY}" width="${t2.width || t2.naturalWidth}" height="${t2.height || t2.naturalHeight}"${s2}${o2}></image>
`), this.stroke || this.strokeDashArray) {
        let e25 = this.fill;
        this.fill = null, a2 = [`	<rect x="${n2}" y="${r2}" width="${U(this.width)}" height="${U(this.height)}" style="${this.getSvgStyles()}" />
`], this.fill = e25;
      }
      return i2 = this.paintFirst === `fill` ? i2.concat(e24, a2) : i2.concat(a2, e24), i2;
    }
    getSrc(e24) {
      let t2 = e24 ? this._element : this._originalElement;
      return t2 ? t2.toDataURL ? t2.toDataURL() : this.srcFromAttribute ? t2.getAttribute(`src`) || `` : t2.src : this.src || ``;
    }
    getSvgSrc(e24) {
      return this.getSrc(e24);
    }
    setSrc(e24, { crossOrigin: t2, signal: n2 } = {}) {
      return Ze(e24, { crossOrigin: t2, signal: n2 }).then((e25) => {
        t2 !== void 0 && this.set({ crossOrigin: t2 }), this.setElement(e25);
      });
    }
    toString() {
      return `#<Image: { src: "${this.getSrc()}" }>`;
    }
    applyResizeFilters() {
      let e24 = this.resizeFilter, t2 = this.minimumScaleTrigger, n2 = this.getTotalObjectScaling(), r2 = n2.x, i2 = n2.y, a2 = this._filteredEl || this._originalElement;
      if (this.group && this.set(`dirty`, true), !e24 || r2 > t2 && i2 > t2) return this._element = a2, this._filterScalingX = 1, this._filterScalingY = 1, this._lastScaleX = r2, void (this._lastScaleY = i2);
      let o2 = F(a2), { width: s2, height: c2 } = a2;
      this._element = o2, this._lastScaleX = e24.scaleX = r2, this._lastScaleY = e24.scaleY = i2, xs().applyFilters([e24], a2, s2, c2, this._element), this._filterScalingX = o2.width / this._originalElement.width, this._filterScalingY = o2.height / this._originalElement.height;
    }
    applyFilters(e24 = this.filters || []) {
      if (e24 = e24.filter((e25) => e25 && !e25.isNeutralState()), this.set(`dirty`, true), this.removeTexture(`${this.cacheKey}_filtered`), e24.length === 0) return this._element = this._originalElement, this._filteredEl = void 0, this._filterScalingX = 1, void (this._filterScalingY = 1);
      let t2 = this._originalElement, n2 = t2.naturalWidth || t2.width, r2 = t2.naturalHeight || t2.height;
      if (this._element === this._originalElement) {
        let e25 = F({ width: n2, height: r2 });
        this._element = e25, this._filteredEl = e25;
      } else this._filteredEl && (this._element = this._filteredEl, this._filteredEl.getContext(`2d`).clearRect(0, 0, n2, r2), this._lastScaleX = 1, this._lastScaleY = 1);
      xs().applyFilters(e24, this._originalElement, n2, r2, this._element, this.cacheKey), this._originalElement.width === this._element.width && this._originalElement.height === this._element.height || (this._filterScalingX = this._element.width / this._originalElement.width, this._filterScalingY = this._element.height / this._originalElement.height);
    }
    _render(e24) {
      e24.imageSmoothingEnabled = this.imageSmoothing, true !== this.isMoving && this.resizeFilter && this._needsResize() && this.applyResizeFilters(), this._stroke(e24), this._renderPaintInOrder(e24);
    }
    drawCacheOnCanvas(e24) {
      e24.imageSmoothingEnabled = this.imageSmoothing, super.drawCacheOnCanvas(e24);
    }
    shouldCache() {
      return this.needsItsOwnCache();
    }
    _renderFill(e24) {
      let t2 = this._element;
      if (!t2) return;
      let n2 = this._filterScalingX, r2 = this._filterScalingY, i2 = this.width, a2 = this.height, o2 = Math.max(this.cropX, 0), s2 = Math.max(this.cropY, 0), c2 = t2.naturalWidth || t2.width, l2 = t2.naturalHeight || t2.height, u2 = o2 * n2, d2 = s2 * r2, f2 = Math.min(i2 * n2, c2 - u2), p2 = Math.min(a2 * r2, l2 - d2), m = -i2 / 2, h2 = -a2 / 2, g2 = Math.min(i2, c2 / n2 - o2), _2 = Math.min(a2, l2 / r2 - s2);
      t2 && e24.drawImage(t2, u2, d2, f2, p2, m, h2, g2, _2);
    }
    _needsResize() {
      let e24 = this.getTotalObjectScaling();
      return e24.x !== this._lastScaleX || e24.y !== this._lastScaleY;
    }
    _resetWidthHeight() {
      this.set(this.getOriginalSize());
    }
    _setWidthHeight({ width: e24, height: t2 } = {}) {
      let n2 = this.getOriginalSize();
      this.width = e24 || n2.width, this.height = t2 || n2.height;
    }
    parsePreserveAspectRatioAttribute() {
      let e24 = mn(this.preserveAspectRatio || ``), t2 = this.width, n2 = this.height, r2 = { width: t2, height: n2 }, i2, a2 = this._element.width, o2 = this._element.height, s2 = 1, c2 = 1, l2 = 0, u2 = 0, d2 = 0, f2 = 0;
      return !e24 || e24.alignX === `none` && e24.alignY === `none` ? (s2 = t2 / a2, c2 = n2 / o2) : (e24.meetOrSlice === `meet` && (s2 = c2 = ua(this._element, r2), i2 = (t2 - a2 * s2) / 2, e24.alignX === `Min` && (l2 = -i2), e24.alignX === `Max` && (l2 = i2), i2 = (n2 - o2 * c2) / 2, e24.alignY === `Min` && (u2 = -i2), e24.alignY === `Max` && (u2 = i2)), e24.meetOrSlice === `slice` && (s2 = c2 = da(this._element, r2), i2 = a2 - t2 / s2, e24.alignX === `Mid` && (d2 = i2 / 2), e24.alignX === `Max` && (d2 = i2), i2 = o2 - n2 / c2, e24.alignY === `Mid` && (f2 = i2 / 2), e24.alignY === `Max` && (f2 = i2), a2 = t2 / s2, o2 = n2 / c2)), { width: a2, height: o2, scaleX: s2, scaleY: c2, offsetLeft: l2, offsetTop: u2, cropX: d2, cropY: f2 };
    }
    static fromObject({ filters: e24, resizeFilter: t2, src: n2, crossOrigin: r2, type: i2, ...a2 }, o2) {
      return Promise.all([Ze(n2, { ...o2, crossOrigin: r2 }), e24 && Qe(e24, o2), t2 ? Qe([t2], o2) : [], $e(a2, o2)]).then(([e25, t3 = [], [r3], i3 = {}]) => new this(e25, { ...a2, src: n2, filters: t3, resizeFilter: r3, ...i3 }));
    }
    static fromURL(e24, { crossOrigin: t2 = null, signal: n2 } = {}, r2) {
      return Ze(e24, { crossOrigin: t2, signal: n2 }).then((e25) => new this(e25, r2));
    }
    static async fromElement(e24, t2 = {}, n2) {
      let r2 = Zi(e24, this.ATTRIBUTE_NAMES, n2);
      return this.fromURL(r2[`xlink:href`] || r2.href, t2, r2).catch((e25) => (s(`log`, `Unable to parse Image`, e25), null));
    }
  };
  i(ws, `type`, `Image`), i(ws, `cacheProperties`, [...Un, ...Cs]), i(ws, `ownDefaults`, { strokeWidth: 0, srcFromAttribute: false, minimumScaleTrigger: 0.5, cropX: 0, cropY: 0, imageSmoothing: true }), i(ws, `ATTRIBUTE_NAMES`, [...ki, `x`, `y`, `width`, `height`, `preserveAspectRatio`, `xlink:href`, `href`, `crossOrigin`, `image-rendering`]), M.setClass(ws), M.setSVGClass(ws);
  var Ds = _n([`pattern`, `defs`, `symbol`, `metadata`, `clipPath`, `mask`, `desc`]);
  var zs = (e24) => e24.webgl !== void 0;
  var Vs = `precision highp float`;
  var Hs = `
    ${Vs};
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vTexCoord);
    }`;
  var Us = new RegExp(Vs, `g`);
  var $ = class {
    get type() {
      return this.constructor.type;
    }
    constructor({ type: e24, ...t2 } = {}) {
      Object.assign(this, this.constructor.defaults, t2);
    }
    getFragmentSource() {
      return Hs;
    }
    getVertexSource() {
      return `
    attribute vec2 aPosition;
    varying vec2 vTexCoord;
    void main() {
      vTexCoord = aPosition;
      gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    }`;
    }
    createProgram(e24, t2 = this.getFragmentSource(), n2 = this.getVertexSource()) {
      let { WebGLProbe: { GLPrecision: r2 = `highp` } } = h();
      r2 !== `highp` && (t2 = t2.replace(Us, Vs.replace(`highp`, r2)));
      let i2 = e24.createShader(e24.VERTEX_SHADER), a2 = e24.createShader(e24.FRAGMENT_SHADER), o2 = e24.createProgram();
      if (!i2 || !a2 || !o2) throw new c(`Vertex, fragment shader or program creation error`);
      if (e24.shaderSource(i2, n2), e24.compileShader(i2), !e24.getShaderParameter(i2, e24.COMPILE_STATUS)) throw new c(`Vertex shader compile error for ${this.type}: ${e24.getShaderInfoLog(i2)}`);
      if (e24.shaderSource(a2, t2), e24.compileShader(a2), !e24.getShaderParameter(a2, e24.COMPILE_STATUS)) throw new c(`Fragment shader compile error for ${this.type}: ${e24.getShaderInfoLog(a2)}`);
      if (e24.attachShader(o2, i2), e24.attachShader(o2, a2), e24.linkProgram(o2), !e24.getProgramParameter(o2, e24.LINK_STATUS)) throw new c(`Shader link error for "${this.type}" ${e24.getProgramInfoLog(o2)}`);
      let s2 = this.getUniformLocations(e24, o2) || {};
      return s2.uStepW = e24.getUniformLocation(o2, `uStepW`), s2.uStepH = e24.getUniformLocation(o2, `uStepH`), { program: o2, attributeLocations: this.getAttributeLocations(e24, o2), uniformLocations: s2 };
    }
    getAttributeLocations(e24, t2) {
      return { aPosition: e24.getAttribLocation(t2, `aPosition`) };
    }
    getUniformLocations(e24, t2) {
      let n2 = this.constructor.uniformLocations, r2 = {};
      for (let i2 = 0; i2 < n2.length; i2++) r2[n2[i2]] = e24.getUniformLocation(t2, n2[i2]);
      return r2;
    }
    sendAttributeData(e24, t2, n2) {
      let r2 = t2.aPosition, i2 = e24.createBuffer();
      e24.bindBuffer(e24.ARRAY_BUFFER, i2), e24.enableVertexAttribArray(r2), e24.vertexAttribPointer(r2, 2, e24.FLOAT, false, 0, 0), e24.bufferData(e24.ARRAY_BUFFER, n2, e24.STATIC_DRAW);
    }
    _setupFrameBuffer(e24) {
      let t2 = e24.context;
      if (e24.passes > 1) {
        let n2 = e24.destinationWidth, r2 = e24.destinationHeight;
        e24.sourceWidth === n2 && e24.sourceHeight === r2 || (t2.deleteTexture(e24.targetTexture), e24.targetTexture = e24.filterBackend.createTexture(t2, n2, r2)), t2.framebufferTexture2D(t2.FRAMEBUFFER, t2.COLOR_ATTACHMENT0, t2.TEXTURE_2D, e24.targetTexture, 0);
      } else t2.bindFramebuffer(t2.FRAMEBUFFER, null), t2.finish();
    }
    _swapTextures(e24) {
      e24.passes--, e24.pass++;
      let t2 = e24.targetTexture;
      e24.targetTexture = e24.sourceTexture, e24.sourceTexture = t2;
    }
    isNeutralState(e24) {
      return false;
    }
    applyTo(e24) {
      zs(e24) ? (this._setupFrameBuffer(e24), this.applyToWebGL(e24), this._swapTextures(e24)) : this.applyTo2d(e24);
    }
    applyTo2d(e24) {
    }
    getCacheKey() {
      return this.type;
    }
    retrieveShader(e24) {
      let t2 = this.getCacheKey();
      return e24.programCache[t2] || (e24.programCache[t2] = this.createProgram(e24.context)), e24.programCache[t2];
    }
    applyToWebGL(e24) {
      let t2 = e24.context, n2 = this.retrieveShader(e24);
      e24.pass === 0 && e24.originalTexture ? t2.bindTexture(t2.TEXTURE_2D, e24.originalTexture) : t2.bindTexture(t2.TEXTURE_2D, e24.sourceTexture), t2.useProgram(n2.program), this.sendAttributeData(t2, n2.attributeLocations, e24.aPosition), t2.uniform1f(n2.uniformLocations.uStepW, 1 / e24.sourceWidth), t2.uniform1f(n2.uniformLocations.uStepH, 1 / e24.sourceHeight), this.sendUniformData(t2, n2.uniformLocations), t2.viewport(0, 0, e24.destinationWidth, e24.destinationHeight), t2.drawArrays(t2.TRIANGLE_STRIP, 0, 4);
    }
    bindAdditionalTexture(e24, t2, n2) {
      e24.activeTexture(n2), e24.bindTexture(e24.TEXTURE_2D, t2), e24.activeTexture(e24.TEXTURE0);
    }
    unbindAdditionalTexture(e24, t2) {
      e24.activeTexture(t2), e24.bindTexture(e24.TEXTURE_2D, null), e24.activeTexture(e24.TEXTURE0);
    }
    sendUniformData(e24, t2) {
    }
    createHelpLayer(e24) {
      if (!e24.helpLayer) {
        let { sourceWidth: t2, sourceHeight: n2 } = e24;
        e24.helpLayer = F({ width: t2, height: n2 });
      }
    }
    toObject() {
      let e24 = Object.keys(this.constructor.defaults || {});
      return { type: this.type, ...e24.reduce((e25, t2) => (e25[t2] = this[t2], e25), {}) };
    }
    toJSON() {
      return this.toObject();
    }
    static async fromObject({ type: e24, ...t2 }, n2) {
      return new this(t2);
    }
  };
  i($, `type`, `BaseFilter`), i($, `uniformLocations`, []);
  var Ws = { multiply: `gl_FragColor.rgb *= uColor.rgb;
`, screen: `gl_FragColor.rgb = 1.0 - (1.0 - gl_FragColor.rgb) * (1.0 - uColor.rgb);
`, add: `gl_FragColor.rgb += uColor.rgb;
`, difference: `gl_FragColor.rgb = abs(gl_FragColor.rgb - uColor.rgb);
`, subtract: `gl_FragColor.rgb -= uColor.rgb;
`, lighten: `gl_FragColor.rgb = max(gl_FragColor.rgb, uColor.rgb);
`, darken: `gl_FragColor.rgb = min(gl_FragColor.rgb, uColor.rgb);
`, exclusion: `gl_FragColor.rgb += uColor.rgb - 2.0 * (uColor.rgb * gl_FragColor.rgb);
`, overlay: `
    if (uColor.r < 0.5) {
      gl_FragColor.r *= 2.0 * uColor.r;
    } else {
      gl_FragColor.r = 1.0 - 2.0 * (1.0 - gl_FragColor.r) * (1.0 - uColor.r);
    }
    if (uColor.g < 0.5) {
      gl_FragColor.g *= 2.0 * uColor.g;
    } else {
      gl_FragColor.g = 1.0 - 2.0 * (1.0 - gl_FragColor.g) * (1.0 - uColor.g);
    }
    if (uColor.b < 0.5) {
      gl_FragColor.b *= 2.0 * uColor.b;
    } else {
      gl_FragColor.b = 1.0 - 2.0 * (1.0 - gl_FragColor.b) * (1.0 - uColor.b);
    }
    `, tint: `
    gl_FragColor.rgb *= (1.0 - uColor.a);
    gl_FragColor.rgb += uColor.rgb;
    ` };
  var Gs = class extends $ {
    getCacheKey() {
      return `${this.type}_${this.mode}`;
    }
    getFragmentSource() {
      return `
      precision highp float;
      uniform sampler2D uTexture;
      uniform vec4 uColor;
      varying vec2 vTexCoord;
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        gl_FragColor = color;
        if (color.a > 0.0) {
          ${Ws[this.mode]}
        }
      }
      `;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = new G(this.color).getSource(), n2 = this.alpha, r2 = t2[0] * n2, i2 = t2[1] * n2, a2 = t2[2] * n2, o2 = 1 - n2;
      for (let t3 = 0; t3 < e24.length; t3 += 4) {
        let n3 = e24[t3], s2 = e24[t3 + 1], c2 = e24[t3 + 2], l2, u2, d2;
        switch (this.mode) {
          case `multiply`:
            l2 = n3 * r2 / 255, u2 = s2 * i2 / 255, d2 = c2 * a2 / 255;
            break;
          case `screen`:
            l2 = 255 - (255 - n3) * (255 - r2) / 255, u2 = 255 - (255 - s2) * (255 - i2) / 255, d2 = 255 - (255 - c2) * (255 - a2) / 255;
            break;
          case `add`:
            l2 = n3 + r2, u2 = s2 + i2, d2 = c2 + a2;
            break;
          case `difference`:
            l2 = Math.abs(n3 - r2), u2 = Math.abs(s2 - i2), d2 = Math.abs(c2 - a2);
            break;
          case `subtract`:
            l2 = n3 - r2, u2 = s2 - i2, d2 = c2 - a2;
            break;
          case `darken`:
            l2 = Math.min(n3, r2), u2 = Math.min(s2, i2), d2 = Math.min(c2, a2);
            break;
          case `lighten`:
            l2 = Math.max(n3, r2), u2 = Math.max(s2, i2), d2 = Math.max(c2, a2);
            break;
          case `overlay`:
            l2 = r2 < 128 ? 2 * n3 * r2 / 255 : 255 - 2 * (255 - n3) * (255 - r2) / 255, u2 = i2 < 128 ? 2 * s2 * i2 / 255 : 255 - 2 * (255 - s2) * (255 - i2) / 255, d2 = a2 < 128 ? 2 * c2 * a2 / 255 : 255 - 2 * (255 - c2) * (255 - a2) / 255;
            break;
          case `exclusion`:
            l2 = r2 + n3 - 2 * r2 * n3 / 255, u2 = i2 + s2 - 2 * i2 * s2 / 255, d2 = a2 + c2 - 2 * a2 * c2 / 255;
            break;
          case `tint`:
            l2 = r2 + n3 * o2, u2 = i2 + s2 * o2, d2 = a2 + c2 * o2;
        }
        e24[t3] = l2, e24[t3 + 1] = u2, e24[t3 + 2] = d2;
      }
    }
    sendUniformData(e24, t2) {
      let n2 = new G(this.color).getSource();
      n2[0] = this.alpha * n2[0] / 255, n2[1] = this.alpha * n2[1] / 255, n2[2] = this.alpha * n2[2] / 255, n2[3] = this.alpha, e24.uniform4fv(t2.uColor, n2);
    }
  };
  i(Gs, `defaults`, { color: `#F95C63`, mode: `multiply`, alpha: 1 }), i(Gs, `type`, `BlendColor`), i(Gs, `uniformLocations`, [`uColor`]), M.setClass(Gs);
  var Ks = { multiply: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform sampler2D uImage;
    uniform vec4 uColor;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      vec4 color2 = texture2D(uImage, vTexCoord2);
      color.rgba *= color2.rgba;
      gl_FragColor = color;
    }
    `, mask: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform sampler2D uImage;
    uniform vec4 uColor;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      vec4 color2 = texture2D(uImage, vTexCoord2);
      color.a = color2.a;
      gl_FragColor = color;
    }
    ` };
  var qs = class extends $ {
    getCacheKey() {
      return `${this.type}_${this.mode}`;
    }
    getFragmentSource() {
      return Ks[this.mode];
    }
    getVertexSource() {
      return `
    attribute vec2 aPosition;
    varying vec2 vTexCoord;
    varying vec2 vTexCoord2;
    uniform mat3 uTransformMatrix;
    void main() {
      vTexCoord = aPosition;
      vTexCoord2 = (uTransformMatrix * vec3(aPosition, 1.0)).xy;
      gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
    }
    `;
    }
    applyToWebGL(e24) {
      let t2 = e24.context, n2 = this.createTexture(e24.filterBackend, this.image);
      this.bindAdditionalTexture(t2, n2, t2.TEXTURE1), super.applyToWebGL(e24), this.unbindAdditionalTexture(t2, t2.TEXTURE1);
    }
    createTexture(e24, t2) {
      return e24.getCachedTexture(t2.cacheKey, t2.getElement());
    }
    calculateMatrix() {
      let e24 = this.image, { width: t2, height: n2 } = e24.getElement();
      return [1 / e24.scaleX, 0, 0, 0, 1 / e24.scaleY, 0, -e24.left / t2, -e24.top / n2, 1];
    }
    applyTo2d({ imageData: { data: e24, width: t2, height: n2 }, filterBackend: { resources: r2 } }) {
      let i2 = this.image;
      r2.blendImage || (r2.blendImage = P());
      let a2 = r2.blendImage, o2 = a2.getContext(`2d`);
      a2.width !== t2 || a2.height !== n2 ? (a2.width = t2, a2.height = n2) : o2.clearRect(0, 0, t2, n2), o2.setTransform(i2.scaleX, 0, 0, i2.scaleY, i2.left, i2.top), o2.drawImage(i2.getElement(), 0, 0, t2, n2);
      let s2 = o2.getImageData(0, 0, t2, n2).data;
      for (let t3 = 0; t3 < e24.length; t3 += 4) {
        let n3 = e24[t3], r3 = e24[t3 + 1], i3 = e24[t3 + 2], a3 = e24[t3 + 3], o3 = s2[t3], c2 = s2[t3 + 1], l2 = s2[t3 + 2], u2 = s2[t3 + 3];
        switch (this.mode) {
          case `multiply`:
            e24[t3] = n3 * o3 / 255, e24[t3 + 1] = r3 * c2 / 255, e24[t3 + 2] = i3 * l2 / 255, e24[t3 + 3] = a3 * u2 / 255;
            break;
          case `mask`:
            e24[t3 + 3] = u2;
        }
      }
    }
    sendUniformData(e24, t2) {
      let n2 = this.calculateMatrix();
      e24.uniform1i(t2.uImage, 1), e24.uniformMatrix3fv(t2.uTransformMatrix, false, n2);
    }
    toObject() {
      return { ...super.toObject(), image: this.image && this.image.toObject() };
    }
    static async fromObject({ type: e24, image: t2, ...n2 }, r2) {
      return ws.fromObject(t2, r2).then((e25) => new this({ ...n2, image: e25 }));
    }
  };
  i(qs, `type`, `BlendImage`), i(qs, `defaults`, { mode: `multiply`, alpha: 1 }), i(qs, `uniformLocations`, [`uTransformMatrix`, `uImage`]), M.setClass(qs);
  var Js = class extends $ {
    getFragmentSource() {
      return `
    precision highp float;
    uniform sampler2D uTexture;
    uniform vec2 uDelta;
    varying vec2 vTexCoord;
    const float nSamples = 15.0;
    vec3 v3offset = vec3(12.9898, 78.233, 151.7182);
    float random(vec3 scale) {
      /* use the fragment position for a different seed per-pixel */
      return fract(sin(dot(gl_FragCoord.xyz, scale)) * 43758.5453);
    }
    void main() {
      vec4 color = vec4(0.0);
      float totalC = 0.0;
      float totalA = 0.0;
      float offset = random(v3offset);
      for (float t = -nSamples; t <= nSamples; t++) {
        float percent = (t + offset - 0.5) / nSamples;
        vec4 sample = texture2D(uTexture, vTexCoord + uDelta * percent);
        float weight = 1.0 - abs(percent);
        float alpha = weight * sample.a;
        color.rgb += sample.rgb * alpha;
        color.a += alpha;
        totalA += weight;
        totalC += alpha;
      }
      gl_FragColor.rgb = color.rgb / totalC;
      gl_FragColor.a = color.a / totalA;
    }
  `;
    }
    applyTo(e24) {
      zs(e24) ? (this.aspectRatio = e24.sourceWidth / e24.sourceHeight, e24.passes++, this._setupFrameBuffer(e24), this.horizontal = true, this.applyToWebGL(e24), this._swapTextures(e24), this._setupFrameBuffer(e24), this.horizontal = false, this.applyToWebGL(e24), this._swapTextures(e24)) : this.applyTo2d(e24);
    }
    applyTo2d({ imageData: { data: e24, width: t2, height: n2 } }) {
      this.aspectRatio = t2 / n2, this.horizontal = true;
      let r2 = this.getBlurValue() * t2, i2 = new Uint8ClampedArray(e24), a2 = 4 * t2;
      for (let t3 = 0; t3 < e24.length; t3 += 4) {
        let n3 = 0, o2 = 0, s2 = 0, c2 = 0, l2 = 0, u2 = t3 - t3 % a2, d2 = u2 + a2;
        for (let i3 = -14; i3 < 15; i3++) {
          let a3 = i3 / 15, f2 = 4 * Math.floor(r2 * a3), p2 = 1 - Math.abs(a3), m = t3 + f2;
          m < u2 ? m = u2 : m > d2 && (m = d2);
          let h2 = e24[m + 3] * p2;
          n3 += e24[m] * h2, o2 += e24[m + 1] * h2, s2 += e24[m + 2] * h2, c2 += h2, l2 += p2;
        }
        i2[t3] = n3 / c2, i2[t3 + 1] = o2 / c2, i2[t3 + 2] = s2 / c2, i2[t3 + 3] = c2 / l2;
      }
      this.horizontal = false, r2 = this.getBlurValue() * n2;
      for (let t3 = 0; t3 < i2.length; t3 += 4) {
        let n3 = 0, o2 = 0, s2 = 0, c2 = 0, l2 = 0, u2 = t3 % a2, d2 = i2.length - a2 + u2;
        for (let e25 = -14; e25 < 15; e25++) {
          let f2 = e25 / 15, p2 = Math.floor(r2 * f2) * a2, m = 1 - Math.abs(f2), h2 = t3 + p2;
          h2 < u2 ? h2 = u2 : h2 > d2 && (h2 = d2);
          let g2 = i2[h2 + 3] * m;
          n3 += i2[h2] * g2, o2 += i2[h2 + 1] * g2, s2 += i2[h2 + 2] * g2, c2 += g2, l2 += m;
        }
        e24[t3] = n3 / c2, e24[t3 + 1] = o2 / c2, e24[t3 + 2] = s2 / c2, e24[t3 + 3] = c2 / l2;
      }
    }
    sendUniformData(e24, t2) {
      let n2 = this.chooseRightDelta();
      e24.uniform2fv(t2.uDelta, n2);
    }
    isNeutralState() {
      return this.blur === 0;
    }
    getBlurValue() {
      let e24 = 1, { horizontal: t2, aspectRatio: n2 } = this;
      return t2 ? n2 > 1 && (e24 = 1 / n2) : n2 < 1 && (e24 = n2), e24 * this.blur * 0.12;
    }
    chooseRightDelta() {
      let e24 = this.getBlurValue();
      return this.horizontal ? [e24, 0] : [0, e24];
    }
  };
  i(Js, `type`, `Blur`), i(Js, `defaults`, { blur: 0 }), i(Js, `uniformLocations`, [`uDelta`]), M.setClass(Js);
  var Ys = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uBrightness;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color.rgb += uBrightness;
    gl_FragColor = color;
  }
`;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = Math.round(255 * this.brightness);
      for (let n2 = 0; n2 < e24.length; n2 += 4) e24[n2] += t2, e24[n2 + 1] += t2, e24[n2 + 2] += t2;
    }
    isNeutralState() {
      return this.brightness === 0;
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uBrightness, this.brightness);
    }
  };
  i(Ys, `type`, `Brightness`), i(Ys, `defaults`, { brightness: 0 }), i(Ys, `uniformLocations`, [`uBrightness`]), M.setClass(Ys);
  var Xs = { matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0], colorsOnly: true };
  var Zs = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  varying vec2 vTexCoord;
  uniform mat4 uColorMatrix;
  uniform vec4 uConstants;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color *= uColorMatrix;
    color += uConstants;
    gl_FragColor = color;
  }`;
    }
    applyTo2d(e24) {
      let t2 = e24.imageData.data, n2 = this.matrix, r2 = this.colorsOnly;
      for (let e25 = 0; e25 < t2.length; e25 += 4) {
        let i2 = t2[e25], a2 = t2[e25 + 1], o2 = t2[e25 + 2];
        if (t2[e25] = i2 * n2[0] + a2 * n2[1] + o2 * n2[2] + 255 * n2[4], t2[e25 + 1] = i2 * n2[5] + a2 * n2[6] + o2 * n2[7] + 255 * n2[9], t2[e25 + 2] = i2 * n2[10] + a2 * n2[11] + o2 * n2[12] + 255 * n2[14], !r2) {
          let r3 = t2[e25 + 3];
          t2[e25] += r3 * n2[3], t2[e25 + 1] += r3 * n2[8], t2[e25 + 2] += r3 * n2[13], t2[e25 + 3] = i2 * n2[15] + a2 * n2[16] + o2 * n2[17] + r3 * n2[18] + 255 * n2[19];
        }
      }
    }
    sendUniformData(e24, t2) {
      let n2 = this.matrix, r2 = [n2[0], n2[1], n2[2], n2[3], n2[5], n2[6], n2[7], n2[8], n2[10], n2[11], n2[12], n2[13], n2[15], n2[16], n2[17], n2[18]], i2 = [n2[4], n2[9], n2[14], n2[19]];
      e24.uniformMatrix4fv(t2.uColorMatrix, false, r2), e24.uniform4fv(t2.uConstants, i2);
    }
    toObject() {
      return { ...super.toObject(), matrix: [...this.matrix] };
    }
  };
  function Qs(e24, t2) {
    var n2;
    let r2 = (i(n2 = class extends Zs {
      toObject() {
        return { type: this.type, colorsOnly: this.colorsOnly };
      }
    }, `type`, e24), i(n2, `defaults`, { colorsOnly: false, matrix: t2 }), n2);
    return M.setClass(r2, e24), r2;
  }
  i(Zs, `type`, `ColorMatrix`), i(Zs, `defaults`, Xs), i(Zs, `uniformLocations`, [`uColorMatrix`, `uConstants`]), M.setClass(Zs);
  var $s = Qs(`Brownie`, [0.5997, 0.34553, -0.27082, 0, 0.186, -0.0377, 0.86095, 0.15059, 0, -0.1449, 0.24113, -0.07441, 0.44972, 0, -0.02965, 0, 0, 0, 1, 0]);
  var ec = Qs(`Vintage`, [0.62793, 0.32021, -0.03965, 0, 0.03784, 0.02578, 0.64411, 0.03259, 0, 0.02926, 0.0466, -0.08512, 0.52416, 0, 0.02023, 0, 0, 0, 1, 0]);
  var tc = Qs(`Kodachrome`, [1.12855, -0.39673, -0.03992, 0, 0.24991, -0.16404, 1.08352, -0.05498, 0, 0.09698, -0.16786, -0.56034, 1.60148, 0, 0.13972, 0, 0, 0, 1, 0]);
  var nc = Qs(`Technicolor`, [1.91252, -0.85453, -0.09155, 0, 0.04624, -0.30878, 1.76589, -0.10601, 0, -0.27589, -0.2311, -0.75018, 1.84759, 0, 0.12137, 0, 0, 0, 1, 0]);
  var rc = Qs(`Polaroid`, [1.438, -0.062, -0.062, 0, 0, -0.122, 1.378, -0.122, 0, 0, -0.016, -0.016, 1.483, 0, 0, 0, 0, 0, 1, 0]);
  var ic = Qs(`Sepia`, [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0]);
  var ac = Qs(`BlackWhite`, [1.5, 1.5, 1.5, 0, -1, 1.5, 1.5, 1.5, 0, -1, 1.5, 1.5, 1.5, 0, -1, 0, 0, 0, 1, 0]);
  var oc = class extends $ {
    constructor(e24 = {}) {
      super(e24), this.subFilters = e24.subFilters || [];
    }
    applyTo(e24) {
      zs(e24) && (e24.passes += this.subFilters.length - 1), this.subFilters.forEach((t2) => {
        t2.applyTo(e24);
      });
    }
    toObject() {
      return { type: this.type, subFilters: this.subFilters.map((e24) => e24.toObject()) };
    }
    isNeutralState() {
      return !this.subFilters.some((e24) => !e24.isNeutralState());
    }
    static fromObject(e24, t2) {
      return Promise.all((e24.subFilters || []).map((e25) => M.getClass(e25.type).fromObject(e25, t2))).then((e25) => new this({ subFilters: e25 }));
    }
  };
  i(oc, `type`, `Composed`), M.setClass(oc);
  var sc = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uContrast;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float contrastF = 1.015 * (uContrast + 1.0) / (1.0 * (1.015 - uContrast));
    color.rgb = contrastF * (color.rgb - 0.5) + 0.5;
    gl_FragColor = color;
  }`;
    }
    isNeutralState() {
      return this.contrast === 0;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = Math.floor(255 * this.contrast), n2 = 259 * (t2 + 255) / (255 * (259 - t2));
      for (let t3 = 0; t3 < e24.length; t3 += 4) e24[t3] = n2 * (e24[t3] - 128) + 128, e24[t3 + 1] = n2 * (e24[t3 + 1] - 128) + 128, e24[t3 + 2] = n2 * (e24[t3 + 2] - 128) + 128;
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uContrast, this.contrast);
    }
  };
  i(sc, `type`, `Contrast`), i(sc, `defaults`, { contrast: 0 }), i(sc, `uniformLocations`, [`uContrast`]), M.setClass(sc);
  var cc = { Convolute_3_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[9];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 3.0; h+=1.0) {
        for (float w = 0.0; w < 3.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 1), uStepH * (h - 1));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 3.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_3_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[9];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 3.0; h+=1.0) {
        for (float w = 0.0; w < 3.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 1.0), uStepH * (h - 1.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 3.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_5_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[25];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 5.0; h+=1.0) {
        for (float w = 0.0; w < 5.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 2.0), uStepH * (h - 2.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 5.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_5_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[25];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 5.0; h+=1.0) {
        for (float w = 0.0; w < 5.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 2.0), uStepH * (h - 2.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 5.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_7_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[49];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 7.0; h+=1.0) {
        for (float w = 0.0; w < 7.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 3.0), uStepH * (h - 3.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 7.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_7_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[49];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 7.0; h+=1.0) {
        for (float w = 0.0; w < 7.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 3.0), uStepH * (h - 3.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 7.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    `, Convolute_9_1: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[81];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 0);
      for (float h = 0.0; h < 9.0; h+=1.0) {
        for (float w = 0.0; w < 9.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 4.0), uStepH * (h - 4.0));
          color += texture2D(uTexture, vTexCoord + matrixPos) * uMatrix[int(h * 9.0 + w)];
        }
      }
      gl_FragColor = color;
    }
    `, Convolute_9_0: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform float uMatrix[81];
    uniform float uStepW;
    uniform float uStepH;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = vec4(0, 0, 0, 1);
      for (float h = 0.0; h < 9.0; h+=1.0) {
        for (float w = 0.0; w < 9.0; w+=1.0) {
          vec2 matrixPos = vec2(uStepW * (w - 4.0), uStepH * (h - 4.0));
          color.rgb += texture2D(uTexture, vTexCoord + matrixPos).rgb * uMatrix[int(h * 9.0 + w)];
        }
      }
      float alpha = texture2D(uTexture, vTexCoord).a;
      gl_FragColor = color;
      gl_FragColor.a = alpha;
    }
    ` };
  var lc = class extends $ {
    getCacheKey() {
      return `${this.type}_${Math.sqrt(this.matrix.length)}_${+!!this.opaque}`;
    }
    getFragmentSource() {
      return cc[this.getCacheKey()];
    }
    applyTo2d(e24) {
      let t2 = e24.imageData, n2 = t2.data, r2 = this.matrix, i2 = Math.round(Math.sqrt(r2.length)), a2 = Math.floor(i2 / 2), o2 = t2.width, s2 = t2.height, c2 = e24.ctx.createImageData(o2, s2), l2 = c2.data, u2 = +!!this.opaque, d2, f2, p2, m, h2, g2, _2, v2, y2, b2, x2, S2, C2;
      for (x2 = 0; x2 < s2; x2++) for (b2 = 0; b2 < o2; b2++) {
        for (h2 = 4 * (x2 * o2 + b2), d2 = 0, f2 = 0, p2 = 0, m = 0, C2 = 0; C2 < i2; C2++) for (S2 = 0; S2 < i2; S2++) _2 = x2 + C2 - a2, g2 = b2 + S2 - a2, _2 < 0 || _2 >= s2 || g2 < 0 || g2 >= o2 || (v2 = 4 * (_2 * o2 + g2), y2 = r2[C2 * i2 + S2], d2 += n2[v2] * y2, f2 += n2[v2 + 1] * y2, p2 += n2[v2 + 2] * y2, u2 || (m += n2[v2 + 3] * y2));
        l2[h2] = d2, l2[h2 + 1] = f2, l2[h2 + 2] = p2, l2[h2 + 3] = u2 ? n2[h2 + 3] : m;
      }
      e24.imageData = c2;
    }
    sendUniformData(e24, t2) {
      e24.uniform1fv(t2.uMatrix, this.matrix);
    }
    toObject() {
      return { ...super.toObject(), opaque: this.opaque, matrix: [...this.matrix] };
    }
  };
  i(lc, `type`, `Convolute`), i(lc, `defaults`, { opaque: false, matrix: [0, 0, 0, 0, 1, 0, 0, 0, 0] }), i(lc, `uniformLocations`, [`uMatrix`, `uOpaque`, `uHalfSize`, `uSize`]), M.setClass(lc);
  var uc = `Gamma`;
  var dc = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform vec3 uGamma;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    vec3 correction = (1.0 / uGamma);
    color.r = pow(color.r, correction.r);
    color.g = pow(color.g, correction.g);
    color.b = pow(color.b, correction.b);
    gl_FragColor = color;
    gl_FragColor.rgb *= color.a;
  }
`;
    }
    constructor(e24 = {}) {
      super(e24), this.gamma = e24.gamma || this.constructor.defaults.gamma.concat();
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = this.gamma, n2 = 1 / t2[0], r2 = 1 / t2[1], i2 = 1 / t2[2];
      this.rgbValues || (this.rgbValues = { r: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256) });
      let a2 = this.rgbValues;
      for (let e25 = 0; e25 < 256; e25++) a2.r[e25] = 255 * (e25 / 255) ** n2, a2.g[e25] = 255 * (e25 / 255) ** r2, a2.b[e25] = 255 * (e25 / 255) ** i2;
      for (let t3 = 0; t3 < e24.length; t3 += 4) e24[t3] = a2.r[e24[t3]], e24[t3 + 1] = a2.g[e24[t3 + 1]], e24[t3 + 2] = a2.b[e24[t3 + 2]];
    }
    sendUniformData(e24, t2) {
      e24.uniform3fv(t2.uGamma, this.gamma);
    }
    isNeutralState() {
      let { gamma: e24 } = this;
      return e24[0] === 1 && e24[1] === 1 && e24[2] === 1;
    }
    toObject() {
      return { type: uc, gamma: this.gamma.concat() };
    }
  };
  i(dc, `type`, uc), i(dc, `defaults`, { gamma: [1, 1, 1] }), i(dc, `uniformLocations`, [`uGamma`]), M.setClass(dc);
  var fc = { average: `
    precision highp float;
    uniform sampler2D uTexture;
    varying vec2 vTexCoord;
    void main() {
      vec4 color = texture2D(uTexture, vTexCoord);
      float average = (color.r + color.b + color.g) / 3.0;
      gl_FragColor = vec4(average, average, average, color.a);
    }
    `, lightness: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform int uMode;
    varying vec2 vTexCoord;
    void main() {
      vec4 col = texture2D(uTexture, vTexCoord);
      float average = (max(max(col.r, col.g),col.b) + min(min(col.r, col.g),col.b)) / 2.0;
      gl_FragColor = vec4(average, average, average, col.a);
    }
    `, luminosity: `
    precision highp float;
    uniform sampler2D uTexture;
    uniform int uMode;
    varying vec2 vTexCoord;
    void main() {
      vec4 col = texture2D(uTexture, vTexCoord);
      float average = 0.21 * col.r + 0.72 * col.g + 0.07 * col.b;
      gl_FragColor = vec4(average, average, average, col.a);
    }
    ` };
  var pc = class extends $ {
    applyTo2d({ imageData: { data: e24 } }) {
      for (let t2, n2 = 0; n2 < e24.length; n2 += 4) {
        let r2 = e24[n2], i2 = e24[n2 + 1], a2 = e24[n2 + 2];
        switch (this.mode) {
          case `average`:
            t2 = (r2 + i2 + a2) / 3;
            break;
          case `lightness`:
            t2 = (Math.min(r2, i2, a2) + Math.max(r2, i2, a2)) / 2;
            break;
          case `luminosity`:
            t2 = 0.21 * r2 + 0.72 * i2 + 0.07 * a2;
        }
        e24[n2 + 2] = e24[n2 + 1] = e24[n2] = t2;
      }
    }
    getCacheKey() {
      return `${this.type}_${this.mode}`;
    }
    getFragmentSource() {
      return fc[this.mode];
    }
    sendUniformData(e24, t2) {
      e24.uniform1i(t2.uMode, 1);
    }
    isNeutralState() {
      return false;
    }
  };
  i(pc, `type`, `Grayscale`), i(pc, `defaults`, { mode: `average` }), i(pc, `uniformLocations`, [`uMode`]), M.setClass(pc);
  var mc = { ...Xs, rotation: 0 };
  var hc = class extends Zs {
    calculateMatrix() {
      let e24 = this.rotation * Math.PI, t2 = Se(e24), n2 = Ce(e24), r2 = 1 / 3, i2 = Math.sqrt(r2) * n2, a2 = 1 - t2;
      this.matrix = [t2 + a2 / 3, r2 * a2 - i2, r2 * a2 + i2, 0, 0, r2 * a2 + i2, t2 + r2 * a2, r2 * a2 - i2, 0, 0, r2 * a2 - i2, r2 * a2 + i2, t2 + r2 * a2, 0, 0, 0, 0, 0, 1, 0];
    }
    isNeutralState() {
      return this.rotation === 0;
    }
    applyTo(e24) {
      this.calculateMatrix(), super.applyTo(e24);
    }
    toObject() {
      return { type: this.type, rotation: this.rotation };
    }
  };
  i(hc, `type`, `HueRotation`), i(hc, `defaults`, mc), M.setClass(hc);
  var gc = class extends $ {
    applyTo2d({ imageData: { data: e24 } }) {
      for (let t2 = 0; t2 < e24.length; t2 += 4) e24[t2] = 255 - e24[t2], e24[t2 + 1] = 255 - e24[t2 + 1], e24[t2 + 2] = 255 - e24[t2 + 2], this.alpha && (e24[t2 + 3] = 255 - e24[t2 + 3]);
    }
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform int uInvert;
  uniform int uAlpha;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    if (uInvert == 1) {
      if (uAlpha == 1) {
        gl_FragColor = vec4(1.0 - color.r,1.0 -color.g,1.0 -color.b,1.0 -color.a);
      } else {
        gl_FragColor = vec4(1.0 - color.r,1.0 -color.g,1.0 -color.b,color.a);
      }
    } else {
      gl_FragColor = color;
    }
  }
`;
    }
    isNeutralState() {
      return !this.invert;
    }
    sendUniformData(e24, t2) {
      e24.uniform1i(t2.uInvert, Number(this.invert)), e24.uniform1i(t2.uAlpha, Number(this.alpha));
    }
  };
  i(gc, `type`, `Invert`), i(gc, `defaults`, { alpha: false, invert: true }), i(gc, `uniformLocations`, [`uInvert`, `uAlpha`]), M.setClass(gc);
  var _c = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uStepH;
  uniform float uNoise;
  uniform float uSeed;
  varying vec2 vTexCoord;
  float rand(vec2 co, float seed, float vScale) {
    return fract(sin(dot(co.xy * vScale ,vec2(12.9898 , 78.233))) * 43758.5453 * (seed + 0.01) / 2.0);
  }
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    color.rgb += (0.5 - rand(vTexCoord, uSeed, 0.1 / uStepH)) * uNoise;
    gl_FragColor = color;
  }
`;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = this.noise;
      for (let n2 = 0; n2 < e24.length; n2 += 4) {
        let r2 = (0.5 - Math.random()) * t2;
        e24[n2] += r2, e24[n2 + 1] += r2, e24[n2 + 2] += r2;
      }
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uNoise, this.noise / 255), e24.uniform1f(t2.uSeed, Math.random());
    }
    isNeutralState() {
      return this.noise === 0;
    }
  };
  i(_c, `type`, `Noise`), i(_c, `defaults`, { noise: 0 }), i(_c, `uniformLocations`, [`uNoise`, `uSeed`]), M.setClass(_c);
  var vc = class extends $ {
    applyTo2d({ imageData: { data: e24, width: t2, height: n2 } }) {
      for (let r2 = 0; r2 < n2; r2 += this.blocksize) for (let i2 = 0; i2 < t2; i2 += this.blocksize) {
        let a2 = 4 * r2 * t2 + 4 * i2, o2 = e24[a2], s2 = e24[a2 + 1], c2 = e24[a2 + 2], l2 = e24[a2 + 3];
        for (let a3 = r2; a3 < Math.min(r2 + this.blocksize, n2); a3++) for (let n3 = i2; n3 < Math.min(i2 + this.blocksize, t2); n3++) {
          let r3 = 4 * a3 * t2 + 4 * n3;
          e24[r3] = o2, e24[r3 + 1] = s2, e24[r3 + 2] = c2, e24[r3 + 3] = l2;
        }
      }
    }
    isNeutralState() {
      return this.blocksize === 1;
    }
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uBlocksize;
  uniform float uStepW;
  uniform float uStepH;
  varying vec2 vTexCoord;
  void main() {
    float blockW = uBlocksize * uStepW;
    float blockH = uBlocksize * uStepH;
    int posX = int(vTexCoord.x / blockW);
    int posY = int(vTexCoord.y / blockH);
    float fposX = float(posX);
    float fposY = float(posY);
    vec2 squareCoords = vec2(fposX * blockW, fposY * blockH);
    vec4 color = texture2D(uTexture, squareCoords);
    gl_FragColor = color;
  }
`;
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uBlocksize, this.blocksize);
    }
  };
  i(vc, `type`, `Pixelate`), i(vc, `defaults`, { blocksize: 4 }), i(vc, `uniformLocations`, [`uBlocksize`]), M.setClass(vc);
  var yc = class extends $ {
    getFragmentSource() {
      return `
precision highp float;
uniform sampler2D uTexture;
uniform vec4 uLow;
uniform vec4 uHigh;
varying vec2 vTexCoord;
void main() {
  gl_FragColor = texture2D(uTexture, vTexCoord);
  if(all(greaterThan(gl_FragColor.rgb,uLow.rgb)) && all(greaterThan(uHigh.rgb,gl_FragColor.rgb))) {
    gl_FragColor.a = 0.0;
  }
}
`;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = 255 * this.distance, n2 = new G(this.color).getSource(), r2 = [n2[0] - t2, n2[1] - t2, n2[2] - t2], i2 = [n2[0] + t2, n2[1] + t2, n2[2] + t2];
      for (let t3 = 0; t3 < e24.length; t3 += 4) {
        let n3 = e24[t3], a2 = e24[t3 + 1], o2 = e24[t3 + 2];
        n3 > r2[0] && a2 > r2[1] && o2 > r2[2] && n3 < i2[0] && a2 < i2[1] && o2 < i2[2] && (e24[t3 + 3] = 0);
      }
    }
    sendUniformData(e24, t2) {
      let n2 = new G(this.color).getSource(), r2 = this.distance, i2 = [0 + n2[0] / 255 - r2, 0 + n2[1] / 255 - r2, 0 + n2[2] / 255 - r2, 1], a2 = [n2[0] / 255 + r2, n2[1] / 255 + r2, n2[2] / 255 + r2, 1];
      e24.uniform4fv(t2.uLow, i2), e24.uniform4fv(t2.uHigh, a2);
    }
  };
  i(yc, `type`, `RemoveColor`), i(yc, `defaults`, { color: `#FFFFFF`, distance: 0.02, useAlpha: false }), i(yc, `uniformLocations`, [`uLow`, `uHigh`]), M.setClass(yc);
  var bc = class extends $ {
    sendUniformData(e24, t2) {
      e24.uniform2fv(t2.uDelta, this.horizontal ? [1 / this.width, 0] : [0, 1 / this.height]), e24.uniform1fv(t2.uTaps, this.taps);
    }
    getFilterWindow() {
      let e24 = this.tempScale;
      return Math.ceil(this.lanczosLobes / e24);
    }
    getCacheKey() {
      let e24 = this.getFilterWindow();
      return `${this.type}_${e24}`;
    }
    getFragmentSource() {
      let e24 = this.getFilterWindow();
      return this.generateShader(e24);
    }
    getTaps() {
      let e24 = this.lanczosCreate(this.lanczosLobes), t2 = this.tempScale, n2 = this.getFilterWindow(), r2 = Array(n2);
      for (let i2 = 1; i2 <= n2; i2++) r2[i2 - 1] = e24(i2 * t2);
      return r2;
    }
    generateShader(e24) {
      let t2 = Array(e24);
      for (let n2 = 1; n2 <= e24; n2++) t2[n2 - 1] = `${n2}.0 * uDelta`;
      return `
      precision highp float;
      uniform sampler2D uTexture;
      uniform vec2 uDelta;
      varying vec2 vTexCoord;
      uniform float uTaps[${e24}];
      void main() {
        vec4 color = texture2D(uTexture, vTexCoord);
        float sum = 1.0;
        ${t2.map((e25, t3) => `
              color += texture2D(uTexture, vTexCoord + ${e25}) * uTaps[${t3}] + texture2D(uTexture, vTexCoord - ${e25}) * uTaps[${t3}];
              sum += 2.0 * uTaps[${t3}];
            `).join(`
`)}
        gl_FragColor = color / sum;
      }
    `;
    }
    applyToForWebgl(e24) {
      e24.passes++, this.width = e24.sourceWidth, this.horizontal = true, this.dW = Math.round(this.width * this.scaleX), this.dH = e24.sourceHeight, this.tempScale = this.dW / this.width, this.taps = this.getTaps(), e24.destinationWidth = this.dW, super.applyTo(e24), e24.sourceWidth = e24.destinationWidth, this.height = e24.sourceHeight, this.horizontal = false, this.dH = Math.round(this.height * this.scaleY), this.tempScale = this.dH / this.height, this.taps = this.getTaps(), e24.destinationHeight = this.dH, super.applyTo(e24), e24.sourceHeight = e24.destinationHeight;
    }
    applyTo(e24) {
      zs(e24) ? this.applyToForWebgl(e24) : this.applyTo2d(e24);
    }
    isNeutralState() {
      return this.scaleX === 1 && this.scaleY === 1;
    }
    lanczosCreate(e24) {
      return (t2) => {
        if (t2 >= e24 || t2 <= -e24) return 0;
        if (t2 < 11920929e-14 && t2 > -11920929e-14) return 1;
        let n2 = (t2 *= Math.PI) / e24;
        return Math.sin(t2) / t2 * Math.sin(n2) / n2;
      };
    }
    applyTo2d(e24) {
      let t2 = e24.imageData, n2 = this.scaleX, r2 = this.scaleY;
      this.rcpScaleX = 1 / n2, this.rcpScaleY = 1 / r2;
      let i2 = t2.width, a2 = t2.height, o2 = Math.round(i2 * n2), s2 = Math.round(a2 * r2), c2;
      c2 = this.resizeType === `sliceHack` ? this.sliceByTwo(e24, i2, a2, o2, s2) : this.resizeType === `hermite` ? this.hermiteFastResize(e24, i2, a2, o2, s2) : this.resizeType === `bilinear` ? this.bilinearFiltering(e24, i2, a2, o2, s2) : this.resizeType === `lanczos` ? this.lanczosResize(e24, i2, a2, o2, s2) : new ImageData(o2, s2), e24.imageData = c2;
    }
    sliceByTwo(e24, t2, n2, r2, i2) {
      let a2 = e24.imageData, o2 = 0.5, s2 = false, c2 = false, l2 = t2 * o2, u2 = n2 * o2, d2 = e24.filterBackend.resources, f2 = 0, p2 = 0, m = t2, h2 = 0;
      d2.sliceByTwo || (d2.sliceByTwo = P());
      let g2 = d2.sliceByTwo;
      (g2.width < 1.5 * t2 || g2.height < n2) && (g2.width = 1.5 * t2, g2.height = n2);
      let _2 = g2.getContext(`2d`);
      for (_2.clearRect(0, 0, 1.5 * t2, n2), _2.putImageData(a2, 0, 0), r2 = Math.floor(r2), i2 = Math.floor(i2); !s2 || !c2; ) t2 = l2, n2 = u2, r2 < Math.floor(l2 * o2) ? l2 = Math.floor(l2 * o2) : (l2 = r2, s2 = true), i2 < Math.floor(u2 * o2) ? u2 = Math.floor(u2 * o2) : (u2 = i2, c2 = true), _2.drawImage(g2, f2, p2, t2, n2, m, h2, l2, u2), f2 = m, p2 = h2, h2 += u2;
      return _2.getImageData(f2, p2, r2, i2);
    }
    lanczosResize(e24, t2, n2, r2, i2) {
      let a2 = e24.imageData.data, o2 = e24.ctx.createImageData(r2, i2), s2 = o2.data, c2 = this.lanczosCreate(this.lanczosLobes), l2 = this.rcpScaleX, u2 = this.rcpScaleY, d2 = 2 / this.rcpScaleX, f2 = 2 / this.rcpScaleY, p2 = Math.ceil(l2 * this.lanczosLobes / 2), m = Math.ceil(u2 * this.lanczosLobes / 2), h2 = {}, g2 = { x: 0, y: 0 }, _2 = { x: 0, y: 0 };
      return function e25(v2) {
        let y2, b2, x2, S2, C2, w2, ee2, T2, E2, D2, O2;
        for (g2.x = (v2 + 0.5) * l2, _2.x = Math.floor(g2.x), y2 = 0; y2 < i2; y2++) {
          for (g2.y = (y2 + 0.5) * u2, _2.y = Math.floor(g2.y), C2 = 0, w2 = 0, ee2 = 0, T2 = 0, E2 = 0, b2 = _2.x - p2; b2 <= _2.x + p2; b2++) if (!(b2 < 0 || b2 >= t2)) {
            D2 = Math.floor(1e3 * Math.abs(b2 - g2.x)), h2[D2] || (h2[D2] = {});
            for (let e26 = _2.y - m; e26 <= _2.y + m; e26++) e26 < 0 || e26 >= n2 || (O2 = Math.floor(1e3 * Math.abs(e26 - g2.y)), h2[D2][O2] || (h2[D2][O2] = c2(Math.sqrt((D2 * d2) ** 2 + (O2 * f2) ** 2) / 1e3)), x2 = h2[D2][O2], x2 > 0 && (S2 = 4 * (e26 * t2 + b2), C2 += x2, w2 += x2 * a2[S2], ee2 += x2 * a2[S2 + 1], T2 += x2 * a2[S2 + 2], E2 += x2 * a2[S2 + 3]));
          }
          S2 = 4 * (y2 * r2 + v2), s2[S2] = w2 / C2, s2[S2 + 1] = ee2 / C2, s2[S2 + 2] = T2 / C2, s2[S2 + 3] = E2 / C2;
        }
        return ++v2 < r2 ? e25(v2) : o2;
      }(0);
    }
    bilinearFiltering(e24, t2, n2, r2, i2) {
      let a2, o2, s2, c2, l2, u2, d2, f2, p2, m, h2, g2, _2, v2 = 0, y2 = this.rcpScaleX, b2 = this.rcpScaleY, x2 = 4 * (t2 - 1), S2 = e24.imageData.data, C2 = e24.ctx.createImageData(r2, i2), w2 = C2.data;
      for (d2 = 0; d2 < i2; d2++) for (f2 = 0; f2 < r2; f2++) for (l2 = Math.floor(y2 * f2), u2 = Math.floor(b2 * d2), p2 = y2 * f2 - l2, m = b2 * d2 - u2, _2 = 4 * (u2 * t2 + l2), h2 = 0; h2 < 4; h2++) a2 = S2[_2 + h2], o2 = S2[_2 + 4 + h2], s2 = S2[_2 + x2 + h2], c2 = S2[_2 + x2 + 4 + h2], g2 = a2 * (1 - p2) * (1 - m) + o2 * p2 * (1 - m) + s2 * m * (1 - p2) + c2 * p2 * m, w2[v2++] = g2;
      return C2;
    }
    hermiteFastResize(e24, t2, n2, r2, i2) {
      let a2 = this.rcpScaleX, o2 = this.rcpScaleY, s2 = Math.ceil(a2 / 2), c2 = Math.ceil(o2 / 2), l2 = e24.imageData.data, u2 = e24.ctx.createImageData(r2, i2), d2 = u2.data;
      for (let e25 = 0; e25 < i2; e25++) for (let n3 = 0; n3 < r2; n3++) {
        let i3 = 4 * (n3 + e25 * r2), u3, f2 = 0, p2 = 0, m = 0, h2 = 0, g2 = 0, _2 = 0, v2 = (e25 + 0.5) * o2;
        for (let r3 = Math.floor(e25 * o2); r3 < (e25 + 1) * o2; r3++) {
          let e26 = Math.abs(v2 - (r3 + 0.5)) / c2, i4 = (n3 + 0.5) * a2, o3 = e26 * e26;
          for (let e27 = Math.floor(n3 * a2); e27 < (n3 + 1) * a2; e27++) {
            let n4 = Math.abs(i4 - (e27 + 0.5)) / s2, a3 = Math.sqrt(o3 + n4 * n4);
            a3 > 1 && a3 < -1 || (u3 = 2 * a3 * a3 * a3 - 3 * a3 * a3 + 1, u3 > 0 && (n4 = 4 * (e27 + r3 * t2), _2 += u3 * l2[n4 + 3], p2 += u3, l2[n4 + 3] < 255 && (u3 = u3 * l2[n4 + 3] / 250), m += u3 * l2[n4], h2 += u3 * l2[n4 + 1], g2 += u3 * l2[n4 + 2], f2 += u3));
          }
        }
        d2[i3] = m / f2, d2[i3 + 1] = h2 / f2, d2[i3 + 2] = g2 / f2, d2[i3 + 3] = _2 / p2;
      }
      return u2;
    }
  };
  i(bc, `type`, `Resize`), i(bc, `defaults`, { resizeType: `hermite`, scaleX: 1, scaleY: 1, lanczosLobes: 3 }), i(bc, `uniformLocations`, [`uDelta`, `uTaps`]), M.setClass(bc);
  var xc = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uSaturation;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float rgMax = max(color.r, color.g);
    float rgbMax = max(rgMax, color.b);
    color.r += rgbMax != color.r ? (rgbMax - color.r) * uSaturation : 0.00;
    color.g += rgbMax != color.g ? (rgbMax - color.g) * uSaturation : 0.00;
    color.b += rgbMax != color.b ? (rgbMax - color.b) * uSaturation : 0.00;
    gl_FragColor = color;
  }
`;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = -this.saturation;
      for (let n2 = 0; n2 < e24.length; n2 += 4) {
        let r2 = e24[n2], i2 = e24[n2 + 1], a2 = e24[n2 + 2], o2 = Math.max(r2, i2, a2);
        e24[n2] += o2 === r2 ? 0 : (o2 - r2) * t2, e24[n2 + 1] += o2 === i2 ? 0 : (o2 - i2) * t2, e24[n2 + 2] += o2 === a2 ? 0 : (o2 - a2) * t2;
      }
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uSaturation, -this.saturation);
    }
    isNeutralState() {
      return this.saturation === 0;
    }
  };
  i(xc, `type`, `Saturation`), i(xc, `defaults`, { saturation: 0 }), i(xc, `uniformLocations`, [`uSaturation`]), M.setClass(xc);
  var Sc = class extends $ {
    getFragmentSource() {
      return `
  precision highp float;
  uniform sampler2D uTexture;
  uniform float uVibrance;
  varying vec2 vTexCoord;
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float max = max(color.r, max(color.g, color.b));
    float avg = (color.r + color.g + color.b) / 3.0;
    float amt = (abs(max - avg) * 2.0) * uVibrance;
    color.r += max != color.r ? (max - color.r) * amt : 0.00;
    color.g += max != color.g ? (max - color.g) * amt : 0.00;
    color.b += max != color.b ? (max - color.b) * amt : 0.00;
    gl_FragColor = color;
  }
`;
    }
    applyTo2d({ imageData: { data: e24 } }) {
      let t2 = -this.vibrance;
      for (let n2 = 0; n2 < e24.length; n2 += 4) {
        let r2 = e24[n2], i2 = e24[n2 + 1], a2 = e24[n2 + 2], o2 = Math.max(r2, i2, a2), s2 = (r2 + i2 + a2) / 3, c2 = 2 * Math.abs(o2 - s2) / 255 * t2;
        e24[n2] += o2 === r2 ? 0 : (o2 - r2) * c2, e24[n2 + 1] += o2 === i2 ? 0 : (o2 - i2) * c2, e24[n2 + 2] += o2 === a2 ? 0 : (o2 - a2) * c2;
      }
    }
    sendUniformData(e24, t2) {
      e24.uniform1f(t2.uVibrance, -this.vibrance);
    }
    isNeutralState() {
      return this.vibrance === 0;
    }
  };
  i(Sc, `type`, `Vibrance`), i(Sc, `defaults`, { vibrance: 0 }), i(Sc, `uniformLocations`, [`uVibrance`]), M.setClass(Sc);
  var Cc = t({ BaseFilter: () => $, BlackWhite: () => ac, BlendColor: () => Gs, BlendImage: () => qs, Blur: () => Js, Brightness: () => Ys, Brownie: () => $s, ColorMatrix: () => Zs, Composed: () => oc, Contrast: () => sc, Convolute: () => lc, Gamma: () => dc, Grayscale: () => pc, HueRotation: () => hc, Invert: () => gc, Kodachrome: () => tc, Noise: () => _c, Pixelate: () => vc, Polaroid: () => rc, RemoveColor: () => yc, Resize: () => bc, Saturation: () => xc, Sepia: () => ic, Technicolor: () => nc, Vibrance: () => Sc, Vintage: () => ec });

  // shared/drawing-layers.js
  var DRAWING_LAYERS_VERSION = 1;
  var MAX_DRAWING_LAYERS = 64;
  var MAX_LAYER_NAME_LENGTH = 120;
  var MAX_LAYER_ID_LENGTH = 128;
  var MAX_OBJECT_ID_LENGTH = 512;
  var LAYER_COLORS = Object.freeze([
    "#4f8ef7",
    "#ff4757",
    "#ffa502",
    "#2ed573",
    "#a55eea",
    "#00d2d3",
    "#ff6b81",
    "#ffd32a"
  ]);
  var DEFAULT_LAYER_NAME = "\uB4DC\uB85C\uC789 1";
  function isPlainRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function isLayerId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_LAYER_ID_LENGTH;
  }
  function setAssignment(map, objectId, layerId) {
    Object.defineProperty(map, objectId, {
      value: layerId,
      enumerable: true,
      writable: true,
      configurable: true
    });
  }
  function isObjectId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_OBJECT_ID_LENGTH;
  }
  function normalizeName(value, fallback) {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (trimmed.length === 0) return fallback;
    return trimmed.slice(0, MAX_LAYER_NAME_LENGTH);
  }
  function normalizeColor(value, index) {
    return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : LAYER_COLORS[index % LAYER_COLORS.length];
  }
  function makeLayer(options = {}, index = 0) {
    const origin = typeof options.origin === "string" && options.origin.length > 0 && options.origin.length <= MAX_LAYER_ID_LENGTH ? options.origin : null;
    return {
      ...origin === null ? {} : { origin },
      id: isLayerId(options.id) ? options.id : `drawing-layer-${index + 1}`,
      name: normalizeName(options.name, `\uB4DC\uB85C\uC789 ${index + 1}`),
      // 저장된 값이 boolean 이 아니면 **보이고 잠기지 않은 쪽**이 안전한 기본이다.
      // 반대로 두면 파일이 조금 상했을 때 그림이 통째로 사라진 것처럼 보인다.
      visible: options.visible !== false,
      locked: options.locked === true,
      color: normalizeColor(options.color, index)
    };
  }
  function createDefaultDrawingLayers() {
    const layer = makeLayer({ name: DEFAULT_LAYER_NAME }, 0);
    return {
      version: DRAWING_LAYERS_VERSION,
      layers: [layer],
      activeLayerId: layer.id,
      baseLayerId: layer.id,
      assignments: {}
    };
  }
  function normalizeDrawingLayers(value) {
    if (!isPlainRecord(value) || value.version !== DRAWING_LAYERS_VERSION) {
      return createDefaultDrawingLayers();
    }
    const seenIds = /* @__PURE__ */ new Set();
    const layers = [];
    for (const candidate of Array.isArray(value.layers) ? value.layers : []) {
      if (layers.length >= MAX_DRAWING_LAYERS) break;
      if (!isPlainRecord(candidate) || !isLayerId(candidate.id) || seenIds.has(candidate.id)) {
        continue;
      }
      seenIds.add(candidate.id);
      layers.push(makeLayer(candidate, layers.length));
    }
    if (layers.length === 0) return createDefaultDrawingLayers();
    const assignments = {};
    if (isPlainRecord(value.assignments)) {
      for (const [objectId, layerId] of Object.entries(value.assignments)) {
        if (isObjectId(objectId) && seenIds.has(layerId)) setAssignment(assignments, objectId, layerId);
      }
    }
    return {
      version: DRAWING_LAYERS_VERSION,
      layers,
      activeLayerId: seenIds.has(value.activeLayerId) ? value.activeLayerId : layers[0].id,
      // 기준이 사라졌으면 **맨 아래** 레이어를 기준으로 삼는다. 배정 없는 그림은
      // 원래 가장 오래된 것이므로 아래쪽이 자연스럽고, 위에 새로 넣은 레이어로
      // 딸려 올라가지 않는다.
      baseLayerId: seenIds.has(value.baseLayerId) ? value.baseLayerId : layers[layers.length - 1].id,
      assignments
    };
  }
  function layerIdForObject(state, objectId) {
    const assigned = state?.assignments?.[objectId];
    if (isLayerId(assigned) && state.layers.some((layer) => layer.id === assigned)) return assigned;
    return state?.baseLayerId ?? state?.layers?.[0]?.id ?? null;
  }
  function findLayer(state, layerId) {
    return state?.layers?.find((layer) => layer.id === layerId) || null;
  }
  function isObjectVisible(state, objectId) {
    const layer = findLayer(state, layerIdForObject(state, objectId));
    return layer ? layer.visible !== false : true;
  }

  // renderer/scripts/modules/review-drawing-freeze.js
  async function composite(baseDataUrl, keyframe, drawingLayers) {
    if (!keyframe?.objects?.length) return baseDataUrl;
    const layers = normalizeDrawingLayers(drawingLayers);
    const ranks = new Map(layers.layers.map((layer, index) => [layer.id, layers.layers.length - index - 1]));
    const records = keyframe.objects.filter((record) => isObjectVisible(layers, record.id)).sort((a2, b2) => (ranks.get(layerIdForObject(layers, a2.id)) ?? 0) - (ranks.get(layerIdForObject(layers, b2.id)) ?? 0));
    if (!records.length) return baseDataUrl;
    const background = new Image();
    background.src = baseDataUrl;
    await background.decode();
    const width = background.naturalWidth;
    const height = background.naturalHeight;
    const canvas = new yt(document.createElement("canvas"), {
      width,
      height,
      enableRetinaScaling: false,
      renderOnAddRemove: false
    });
    try {
      canvas.setViewportTransform([width / keyframe.sourceWidth, 0, 0, height / keyframe.sourceHeight, 0, 0]);
      for (const record of records) {
        const drawing = new Mo(record.renderGeometry?.pathData || record.pathData, {
          fill: record.style.color,
          fillRule: record.renderGeometry?.fillRule || "nonzero",
          opacity: record.style.opacity,
          stroke: null,
          strokeWidth: 0
        });
        drawing.set(record.transform);
        canvas.add(drawing);
      }
      canvas.renderAll();
      const output = document.createElement("canvas");
      output.width = width;
      output.height = height;
      const context = output.getContext("2d");
      context.drawImage(background, 0, 0);
      context.drawImage(canvas.lowerCanvasEl, 0, 0);
      return output.toDataURL("image/png");
    } finally {
      await canvas.dispose();
    }
  }
  window.BAEReviewDrawingFreeze = Object.freeze({ composite });
})();
