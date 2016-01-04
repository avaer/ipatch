'use strict';

const Immutable = require('immutable');
const immutablediff = require('immutablediff');
const immutablepatch = require('immutablepatch');

const HISTORY_DEPTH = 100;

class File {
  constructor(state) {
    this.state = state;
    this.history = [];
    this.baseVersion = 0;
    this.guid = _makeGuid();
  }

  get() {
    return this.state;
  }

  pushHistory(state) {
    this.history.push(state);

    const historiesToDrop = Math.max(HISTORY_DEPTH - this.history.length, 0);
    if (historiesToDrop > 0) {
      this.history.splice(0, historiesToDrop);
      this.baseVersion += historiesToDrop;
	}
  }

  update(fn) {
    const oldState = this.state;
    const newState = fn(oldState);

    const guid = this.guid;
    const baseVersion = this.baseVersion;
    const diff = immutablediff(oldState, newState);
    const onaccept = () => {
      return null;
    };
    const onreject = (patch) => {
      this.apply(patch);

      return this.update(fn);
    };
    const patch = new Patch({guid, baseVersion, diff, onaccept, onreject});

    this.state = newState;
    this.pushHistory(oldState);

    return patch;
  }

  apply(patch) {
    // XXX finish this
  }
}

class Patch {
  constructor(opts) {
    this.onaccept = opts.onaccept;
    this.onreject = opts.onreject;
  }

  accept() {
    return this.onaccept();
  }
  reject(patch) {
    return this.onreject(patch);
  }
}
Patch.fromJSON = json => {
  const type = json.type;

  switch (type) {
    case 'update': return new UpdatePatch(json);
    case 'full': return new FullPatch(json);
    default: throw new Error('invalid patch json');
  }
};

class UpdatePatch extends Patch {
  constructor(opts) {
    super(opts);

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.diff = opts.diff;
  }

  toJSON() {
    return {
      type: 'update',
      guid: this.guid,
      baseVersion: this.baseVersion,
      diff: this.diff.toJSON()
    };
  }
}

class FullPatch extends Patch {
  constructor(opts) {
    super(opts);

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.data = opts.data;
  }

  toJSON() {
    return {
      type: 'full',
      guid: this.guid,
      data: this.baseVersion,
      data: this.data.toJSON()
    };
  }
}

function _makeGuid() {
  return Math.random().toString(36).substring(7);
}

const ipatch = {
  file(json) {
    json = json || {};

    const state = Immutable.fromJS(json);
    return new File(state);
  }
};

module.exports = ipatch;
