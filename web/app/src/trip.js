// Trip & records tracking, computed in the app from the decoder data (no OBD). Persisted in localStorage.
const KEY = 'w204.stats.v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };

export class Trips {
  constructor() {
    const d = load();
    this.rec = { vmax: 0, rpmMax: 0, trips: 0, km: 0, longestKm: 0, ...d.rec };
    this.service = d.service || { nextKm: null };     // next oil service, set by the user
    this.last = d.last || null;                       // summary of the last finished trip
    this.trip = null; this.t = 0; this.offSince = null;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ rec: this.rec, service: this.service, last: this.last })); } catch (e) {} }

  tick(v, now = performance.now() / 1000) {
    const dt = this.t ? Math.min(2, now - this.t) : 0; this.t = now;
    if (v.engine) {
      this.offSince = null;
      if (!this.trip) this.trip = { start: Date.now(), km: 0, moving: 0, vmax: 0, rpmMax: 0, odo0: v.odometer };
      const T = this.trip, sp = v.speed || 0;
      T.km += sp * dt / 3600; if (sp > 2) T.moving += dt;
      if (v.odometer && T.odo0 && v.odometer - T.odo0 > T.km + 1) T.km = v.odometer - T.odo0;   // odometer wins on long trips
      T.vmax = Math.max(T.vmax, sp); T.rpmMax = Math.max(T.rpmMax, v.rpm || 0);
      this.rec.vmax = Math.max(this.rec.vmax, sp); this.rec.rpmMax = Math.max(this.rec.rpmMax, v.rpm || 0);
    } else if (this.trip) {
      this.offSince ??= now;
      if (now - this.offSince > 30) this.end();      // engine off for 30 s: trip finished
    }
    this.odometer = v.odometer || this.odometer;
  }
  end() {
    const T = this.trip; this.trip = null; if (!T) return;
    if (T.km > 0.2) {
      this.rec.trips++; this.rec.km += T.km; this.rec.longestKm = Math.max(this.rec.longestKm, T.km);
      this.last = { end: Date.now(), km: T.km, min: (Date.now() - T.start) / 60000, vmax: T.vmax, avg: T.moving ? T.km / (T.moving / 3600) : 0 };
    }
    this.save();
  }
  view() {
    const T = this.trip, now = Date.now();
    const cur = T ? { min: (now - T.start) / 60000, km: T.km, avg: T.moving ? T.km / (T.moving / 3600) : 0, vmax: T.vmax, rpmMax: T.rpmMax } : null;
    const left = this.service.nextKm && this.odometer ? this.service.nextKm - this.odometer : null;
    return { cur, last: this.last, rec: this.rec, odometer: this.odometer, service: { ...this.service, left } };
  }
  setService(nextKm) { this.service.nextKm = nextKm; this.save(); }
  resetStats() { this.rec = { vmax: 0, rpmMax: 0, trips: 0, km: 0, longestKm: 0 }; this.last = null; this.trip = null; this.save(); }
}
