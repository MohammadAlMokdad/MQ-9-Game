// Tiny pub/sub bus so scoring, radio, audio and HUD don't have to know about each other.
export class Events {
  constructor() {
    this.map = new Map();
  }

  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
  }

  emit(name, data) {
    const list = this.map.get(name);
    if (!list) return;
    for (const fn of list) fn(data);
  }
}
