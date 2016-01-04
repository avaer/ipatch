'use strict';

const Immutable = require('immutable');
const immutablediff = require('immutablediff');
const immutablepatch = require('immutablepatch');

const HISTORY_DEPTH = 100;

class File {
  constructor(state) {
    this.state = Immutable.fromJS(state);
    this.history = [];
    this.baseVersion = 0;
    this.guid = _makeGuid();
  }

  get() {
    return this.state;
  }

  push(newState) {
    const oldState = this.state;
    this.history.push(oldState);
    this.state = newState;

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
    const patch = new UpdatePatch({guid, baseVersion, diff, onaccept, onreject});

    this.push(newState);

    return patch;
  }

  undo(n) {
    n = Number(n);
    n = n > 0 ? n : 1;

    // XXX
  }

  redo(n) {
    n = Number(n);
    n = n > 0 ? n : 1;

    // XXX
  }

  apply(patch) {
    const type = patch.type;

    switch (type) {
      case 'update': return this.applyUpdate(patch);
      case 'full': return this.applyFull(patch);
      default: throw new Error('invalid patch json');
    }
  }
  applyUpdate(patch) {
    if (patch.baseVersion === this.baseVersion) {
      const oldState = this.state;
      const newState = immutablepatch(oldState, patch.diff);

      this.push(newState);

      return null;
    } else {
      // XXX
    }
  }
  applyFull(patch) {
    this.state = patch.data;
    this.history = []; // XXX should sync histories with the server
    this.baseVersion = patch.fullVersion;

    return null;
  }

  toJSON() {
    // XXX for initial download from the server
  }
}
File.fromJSON = json => {
  // XXX for initial download from the server
};

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
    this.diff = Immutable.fromJS(opts.diff);
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
    this.fullVersion = opts.fullVersion;
    this.data = Immutable.fromJS(opts.data);
  }

  toJSON() {
    return {
      type: 'full',
      guid: this.guid,
      fullVersion: this.fullVersion,
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

    return new File(json);
  }
};

module.exports = ipatch;
