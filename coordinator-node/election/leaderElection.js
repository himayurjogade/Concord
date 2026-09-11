const { rpc } = require('../rpc');

class LeaderElection {
  constructor({ nodeId, peers, getVersion, onBecomeLeader, onBecomeFollower }) {
    this.nodeId = nodeId;
    this.peers = peers;
    this.getVersion = getVersion;

    this.role = 'follower';
    this.term = 0;
    this.votedFor = null;
    this.leaderId = null;

    this.onBecomeLeader = onBecomeLeader || (() => {});
    this.onBecomeFollower = onBecomeFollower || (() => {});
    this.timer = null;
  }

  // randomised so nodes do not all become candidates at the same instant
  randomTimeout() {
    return 1500 + Math.floor(Math.random() * 1500);
  }

  start() {
    this.resetTimer();
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
  }

  resetTimer() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startElection(), this.randomTimeout());
  }

  async startElection() {
    if (this.role === 'dead') return;

    this.role = 'candidate';
    this.term += 1;
    this.votedFor = this.nodeId;
    const term = this.term;

    let votes = 1;
    const majority = Math.floor((this.peers.length + 1) / 2) + 1;

    console.log(`[election] ${this.nodeId} candidate, term ${term}, needs ${majority} votes`);

    await Promise.all(
      this.peers.map(async (peer) => {
        try {
          const reply = await rpc(peer.url, 'requestVote', {
            term,
            candidateId: this.nodeId,
            version: this.getVersion(),
          });

          if (reply.term > this.term) {
            this.term = reply.term;
            this.role = 'follower';
            this.votedFor = null;
          }
          if (reply.granted) votes += 1;
        } catch {
          // unreachable peer casts no vote
        }
      })
    );

    if (this.role === 'candidate' && this.term === term && votes >= majority) {
      this.becomeLeader(votes);
    } else {
      console.log(`[election] ${this.nodeId} lost term ${term} with ${votes} votes`);
      this.role = 'follower';
      this.resetTimer();
    }
  }

  becomeLeader(votes) {
    this.role = 'leader';
    this.leaderId = this.nodeId;
    clearTimeout(this.timer);
    console.log(`[election] ${this.nodeId} is leader of term ${this.term} with ${votes} votes`);
    this.onBecomeLeader();
  }

  handleVoteRequest({ term, candidateId, version = 0 }) {
    if (term < this.term) {
      return { term: this.term, granted: false, reason: 'stale term' };
    }

    if (term > this.term) {
      this.term = term;
      this.votedFor = null;
      if (this.role !== 'dead') this.role = 'follower';
      this.onBecomeFollower();
    }

    if (this.votedFor !== null && this.votedFor !== candidateId) {
      return { term: this.term, granted: false, reason: `already voted for ${this.votedFor}` };
    }

    // refusing a stale candidate stops its snapshot from erasing committed edits
    if (version < this.getVersion()) {
      return { term: this.term, granted: false, reason: 'candidate log is behind' };
    }

    this.votedFor = candidateId;
    this.resetTimer();
    return { term: this.term, granted: true };
  }

  handleBeacon({ term, leaderId }) {
    if (term < this.term) {
      return { ok: false, term: this.term, reason: 'stale leader' };
    }

    if (term > this.term || this.role === 'candidate') {
      this.term = term;
      this.votedFor = null;
    }

    if (this.role !== 'dead') this.role = 'follower';
    this.leaderId = leaderId;
    this.resetTimer();
    return { ok: true, term: this.term };
  }
}

module.exports = LeaderElection;
