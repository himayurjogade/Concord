class LamportClock {
  constructor() {
    this.time = 0;
  }

  tick() {
    this.time += 1;
    return this.time;
  }

  update(receivedTime = 0) {
    this.time = Math.max(this.time, receivedTime) + 1;
    return this.time;
  }

  get value() {
    return this.time;
  }
}

module.exports = LamportClock;
