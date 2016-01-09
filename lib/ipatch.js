'use strict';

const events = require('events');
const EventEmitter = events.EventEmitter;
const Immutable = require('immutable');
const immutablediff = require('immutablediff');
const immutablepatch = require('immutablepatch');

const HISTORY_DEPTH = 100;

class File extends EventEmitter {
  constructor(opts) {
    opts = opts || {};

    super();

    this.state = Immutable.fromJS(opts.state != null ? opts.state : {});
    this.history = opts.history != null ? opts.history : [];
    this.historyIndex = -1;
    this.baseVersion = opts.baseVersion != null ? opts.baseVersion : 0;
    this.guid = _makeGuid();
  }

  get() {
    return this.state;
  }

  _getVersion() {
    const baseVersion = this.baseVersion;

    if (baseVersion !== -1) {
      return baseVersion + this.history.length;
    } else {
      return baseVersion;
    }
  }

  _updateState(fn) {
    const oldState = this.state;
    const oldVersion = this._getVersion();

    fn();

    this._trimHistory();

    const newState = this.state;
    const newVersion = this._getVersion();

    if (oldState !== newState || oldVersion !== newVersion) {
      this.emit('change', {
        old: {
          state: oldState,
          version: oldVersion
        },
        new: {
          state: newState,
          version: newVersion
        }
      });
    }
  }
  _push(newState) {
    this._updateState(() => {
      this.history.push(oldState);
      this.historyIndex = -1;
      this.state = newState;
    });
  }
  _replace(opts) {
    this._updateState(() => {
      this.state = newState;
      this.history = opts.history;
      this.historyIndex = -1;
      this.baseVersion = opts.baseVersion;
    });
  }
  _trimHistory() {
    const historiesToDrop = Math.max(HISTORY_DEPTH - this.history.length, 0);
    if (historiesToDrop > 0) {
      this.history.splice(0, historiesToDrop);
      this.baseVersion += historiesToDrop;
	}
  }

  _getPastDiffs(baseVersion) {
    baseVersion === undefined && (baseVersion = this.baseVersion);

    const history = this.history.slice(baseVersion - this.baseVersion);
    const diffs = history.map((entry, i, a) => {
      const oldState = i === 0 ? this.state : a[i - 1];
      const newState = entry;
      const diff = immutablediff(oldState, newState);
      return diff;
    });
    return diffs;
  }
  _getFutureHistories(baseVersion, diffs) {
    let state = baseVersion === this.baseVersion ? this.state : this.history[baseVersion - this.baseVersion - 1];
    const histories = diffs.map((diff, i, a) => {
      const oldState = state;
      const newState = immutablepatch(oldState, diff);

      state = newState;

      return newState;
    });
    return histories;
  }
}


class MasterFile extends File {
  constructor(opts) {
    super(opts);
  }

  _makeFullPatch(patch) {
    const guid = this.guid;
    const baseVersion = this.baseVersion;
    const diffs = this._getPastDiffs();
    const data = this.state;

    return new FullPatch({guid, baseVersion, diffs, data});
  }
  _makeForwardPatch(patch) {
    const guid = this.guid;
    const baseVersion = patch.baseVersion;
    const diffs = this._getPastDiffs(baseVersion);

    return new ForwardPatch({guid, baseVersion, diffs});
  }
  _makeRetryPatch(patch) {
    const guid = this.guid;
    return RetryPatch({guid});
  }

  _applySync(patch) {
    return this._makeFullPatch(patch);
  }
  _applyUpdate(patch) {
    if (patch.baseVersion === this.baseVersion) {
      const oldState = this.state;
      const newState = immutablepatch(oldState, patch.diff);

      this._push(newState);

      return null;
    } else if (patch.baseVersion >= this.baseVersion && patch.baseVersion < this.baseVersion + this.history.length) {
      return this._makeForwardPatch(patch);
    } else if (patch.baseVersion < this.baseVersion) {
      return this._makeFullPatch(patch);
    } else {
      return this._makeRetryPatch(patch);
    }
  }

  apply(patch) {
    const type = patch.type;

    switch (type) {
      case 'sync': return this._applySync(patch);
      case 'update': return this._applyUpdate(patch);
      default: throw new Error('invalid master file patch');
    }
  }

  toJSON() {
    const state = this.state.toJSON();
    const history = this.history.map(history => history.toJSON());
    const baseVersion = this.baseVersion;

    return {
      state,
      history,
      baseVersion
    };
  }
}
MasterFile.fromJSON = json => {
  return new MasterFile(json);
};

class SlaveFile extends File {
  constructor() {
    super({baseVersion: -1});
  }

  update(fn) {
    const oldState = this.state;
    const newState = fn(oldState);

    const guid = this.guid;
    const baseVersion = this.baseVersion;
    const diff = immutablediff(oldState, newState);
    const onaccept = () => {
      if (patch) {
        const updated = this.apply(patch);

        if (updated) {
          return this.update(fn);
        } else {
          return patch;
        }
      } else {
        return null;
      }
    };
    const onreject = () => {
      return this.update(fn);
    };
    const patch = new UpdatePatch({guid, baseVersion, diff, onaccept, onreject});

    this.push(newState);

    return patch;
  }

  sync() {
    const guid = this.guid;
    return new SyncPatch({guid});
  }

  undo(n) {
    n = Number(n);
    n = n > 0 ? n : 1;

    const newHistoryIndex = (this.historyIndex === -1) ? (this.history.length - 1 - n) : (this.historyIndex - n);
    if (newHistoryIndex >= 0) {
      const newState = this.history[newHistoryIndex];

      return this.update(() => {
        return newState;
      });
    } else {
      return null;
    }
  }

  redo(n) {
    n = Number(n);
    n = n > 0 ? n : 1;

    const newHistoryIndex = (this.historyIndex === -1) ? (this.history.length - 1 + n) : (this.historyIndex + n);
    if (newHistoryIndex < this.history.length) {
      const newState = this.history[newHistoryIndex];

      return this.update(() => {
        return newState;
      });
    } else {
      return null;
    }
  }

  _applyForward(patch) {
    if (patch.baseVersion > this.baseVersion) {
      const histories = this._getFutureHistories(this.baseVersion, path.diffs);
      histories.forEach(history => {
        this._push(history);
      });

      return true;
    } else {
      return false;
    }
  }
  _applyFull(patch) {
    const state = patch.data;
    const history = path.history.toArray(); // XXX apply the diffs here
    const baseVersion = patch.baseVersion;

    this._replace({state, history, baseVersion});

    return true;
  }
  _applyRetry(patch) {
    return false;
  }

  apply(patch) {
    const type = patch.type;

    switch (type) {
      case 'forward': return this._applyForward(patch);
      case 'full': return this._applyFull(patch);
      case 'retry': return this._applyRetry(patch);
      default: throw new Error('invalid slave file patch');
    }
  }
}

class Patch {
  constructor(opts) {
    this.type = opts.type;
  }
}
Patch.fromJSON = json => {
  const type = json.type;

  switch (type) {
    case 'sync': return new SyncPatch(json);
    case 'update': return new UpdatePatch(json);
    case 'forward': return new ForwardPatch(json);
    case 'full': return new FullPatch(json);
    case 'retry': return new RetryPatch(json);
    default: throw new Error('invalid patch json');
  }
};

class SyncPatch extends Patch {
  constructor(opts) {
    super({type: 'sync'});

    this.guid = opts.guid;
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid
    };
  }
}

class UpdatePatch extends Patch {
  constructor(opts) {
    super({type: 'update'});

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.diff = Immutable.fromJS(opts.diff);
    this.onaccept = opts.onaccept;
    this.onreject = opts.onreject;
  }

  accept(patch) {
    return this.onaccept(patch);
  }
  reject() {
    return this.onreject();
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid,
      baseVersion: this.baseVersion,
      diff: this.diff.toJSON()
    };
  }
}

class ForwardPatch extends Patch {
  constructor(opts) {
    super({type: 'forward'});

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.diffs = Immutable.fromJS(opts.diffs).toArray();
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid,
      baseVersion: this.baseVersion,
      diffs: this.diffs.toJSON()
    };
  }
}

class FullPatch extends Patch {
  constructor(opts) {
    super({type: 'full'});

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.data = Immutable.fromJS(opts.data);
    this.diffs = Immutable.fromJS(opts.diffs).toArray();
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid,
      baseVersion: this.baseVersion,
      data: this.data.toJSON(),
      diffs: this.diffs.toJSON()
    };
  }
}

class RetryPatch extends Patch {
  constructor(opts) {
    super({type: 'retry'});

    this.guid = opts.guid;
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid
    };
  }
}

function _makeGuid() {
  return Math.random().toString(36).substring(7);
}

const ipatch = {
  MasterFile,
  SlaveFile,
  Patch
};

module.exports = ipatch;
