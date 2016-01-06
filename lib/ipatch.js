'use strict';

const Immutable = require('immutable');
const immutablediff = require('immutablediff');
const immutablepatch = require('immutablepatch');

const HISTORY_DEPTH = 100;

class File {
  constructor(state) {
    this.state = Immutable.fromJS(opts.state != null ? opts.state : {});
    this.history = opts.history != null ? opts.history : [];
    this.baseVersion = opts.baseVersion != null ? opts.baseVersion : 0;
    this.guid = _makeGuid();
  }

  get() {
    return this.state;
  }

  _push(newState) {
    const oldState = this.state;
    this.history.push(oldState);
    this.state = newState;

    const historiesToDrop = Math.max(HISTORY_DEPTH - this.history.length, 0);
    if (historiesToDrop > 0) {
      this.history.splice(0, historiesToDrop);
      this.baseVersion += historiesToDrop;
	}
  }

  _applyUpdate(patch) {
    if (patch.baseVersion === this.baseVersion) {
      const oldState = this.state;
      const newState = immutablepatch(oldState, patch.diff);

      this._push(newState);

      return null;
    } else {
      if (patch.baseVersion >= this.baseVersion) {
        const guid = this.guid;
        const baseVersion = patch.baseVersion;
        const history = this.history.slice(patch.baseVersion - this.baseVersion);

        return new ForwardPatch({
          guid,
          baseVersion,
          history
        });
      } else {
        return new FullPatch({
          guid: this.guid,
          baseVersion: this.baseVersion,
          history: this.history,
          data: this.state
        });
      }
    }
  }
  _applyForward(patch) {
    // XXX
  }
  _applyFull(patch) {
    this.state = patch.data;
    this.history = path.history.toArray();
    this.baseVersion = patch.baseVersion;

    return null;
  }

  apply(patch) {
    const type = patch.type;

    switch (type) {
      case 'update': return this._applyUpdate(patch);
      case 'forward': return this._applyForward(patch);
      case 'full': return this._applyFull(patch);
      default: throw new Error('invalid patch json');
    }
  }
}

class MasterFile extends File {
  constructor(opts) {
    super(opts);
  }

  toJSON() {
    const state this.state.toJSON();
    const history = this.history;
    const baseVersion = this.baseVersion;

    return {
      state,
      history,
      baseVersion
    };
  }
}

class SlaveFile extends File {
  constructor(opts) {
    super(opts);
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
}
SlaveFile.fromJSON = json => {
  return new SlaveFile(json);
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
    case 'forward': return new ForwardPatch(json);
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

class ForwardPatch extends Patch {
  constructor(opts) {
    super(opts);

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.history = Immutable.fromJS(opts.history).toArray();
  }

  toJSON() {
    return {
      type: 'forward',
      guid: this.guid,
      baseVersion: this.baseVersion,
      history: this.history.toJSON()
    };
  }
}

class FullPatch extends Patch {
  constructor(opts) {
    super(opts);

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.data = Immutable.fromJS(opts.data);
    this.history = Immutable.fromJS(opts.history);
  }

  toJSON() {
    return {
      type: 'full',
      guid: this.guid,
      baseVersion: this.baseVersion,
      data: this.data.toJSON(),
      history: this.history.toJSON()
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
