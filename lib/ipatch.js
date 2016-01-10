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
      this.history.push(this.state);
      this.historyIndex = -1;
      this.state = newState;
    });
  }
  _replace(opts) {
    this._updateState(() => {
      this.state = opts.state != null ? opts.state : this.state;
      this.history = opts.history != null ? opts.history : this.history;
      this.historyIndex = -1;
      this.baseVersion = opts.baseVersion != null ? opts.baseVersion : this.baseVersion;
    });
  }
  _trimHistory() {
    const historiesToDrop = Math.max(HISTORY_DEPTH - this.history.length, 0);
    if (historiesToDrop > 0) {
      this.history.splice(0, historiesToDrop);
      this.baseVersion += historiesToDrop;
	}
  }

  _getState(baseVersion) {
    baseVersion === undefined && (baseVersion = this.baseVersion);

    const allStates = this.history.concat(this.state);

    return allStates[baseVersion - this.baseVersion];
  }

  _getStates(baseVersion) {
    baseVersion === undefined && (baseVersion = this.baseVersion);

    const allStates = this.history.concat(this.state);
    const forwardStates = (baseVersion === this.baseVersion) ? allStates : allStates.slice(baseVersion - this.baseVersion);

    return forwardStates;
  }
}


class MasterFile extends File {
  constructor(opts) {
    super(opts);
  }

  _makeFullPatch() {
    const guid = this.guid;
    const baseVersion = this.baseVersion;
    const states = this._getStates();
    const baseState = states[0];
    const diffs = _historyToDiffs(states[0], states.slice(1));

    return new FullPatch({guid, baseVersion, baseState, diffs});
  }
  _makeForwardPatch(baseVersion) {
    const guid = this.guid;
    const states = this._getStates(baseVersion);
    const diffs = _historyToDiffs(states[0], states.slice(1));

    return new ForwardPatch({guid, baseVersion, diffs});
  }
  _makeRetryPatch() {
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
      return this._makeForwardPatch(patch.baseVersion);
    } else if (patch.baseVersion < this.baseVersion) {
      return this._makeFullPatch();
    } else {
      return this._makeRetryPatch();
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

  _makeHandlers(opts) {
    const retryOld = opts.retryOld;
    const retryNew = opts.retryNew;

    const onaccept = patch => {
      if (patch) {
        const updated = this.merge(patch);

        if (updated) {
          return retryNew();
        } else {
          return retryOld();
        }
      } else {
        return null;
      }
	};
    const onreject = () => {
      return retryNew();
    }

    return {onaccept, onreject};
  }

  update(fn) {
    const oldState = this.state;
    const newState = fn(oldState);

    const guid = this.guid;
    const baseVersion = this.baseVersion;
    const diff = immutablediff(oldState, newState);
    const handlers = this._makeHandlers({
      retryOld: () => patch,
      retryNew: () => this.update(fn)
	});
    const onaccept = handlers.onaccept;
    const onreject = handlers.onreject;
    const patch = new UpdatePatch({guid, baseVersion, diff, onaccept, onreject});

    this.push(newState);

    return patch;
  }

  sync() {
    const guid = this.guid;
    const retry = () => patch;
    const handlers = this._makeHandlers({
      retryOld: retry,
      retryNew: retry
	});
    const onaccept = handlers.onaccept;
    const onreject = handlers.onreject;
    const patch = new SyncPatch({guid, onaccept, onreject});

    return patch;
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
    if (patch.baseVersion > this.baseVersion && patch.baseVersion < (this.baseVersion + this.history.length)) {
      const initialState = this._getState(patch.baseVersion);
      const patchHistory = _diffsToHistory(initialState, patch.diffs);
      const patchOverlap = patch.baseVersion - this.baseVersion;
      const states = (this._getStates().slice(0, patchOverlap)).concat(patchHistory.slice(patchOverlap));
      const state = states.slice(-1)[0];
      const history = states.slice(0, -1);

      this._replace({states, history});

      return true;
    } else {
      return false;
    }
  }
  _applyFull(patch) {
    const patchHistory = _diffsToHistory(patch.baseState, patch.diffs);
    const states = [patch.baseState].concat(patchHistory);
    const state = states.slice(-1)[0];
    const history = states.slice(0, -1);
    const baseVersion = patch.baseVersion;

    this._replace({state, history, baseVersion});

    return true;
  }
  _applyRetry(patch) {
    return false;
  }

  merge(patch) {
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
      diffs: this.diffs.map(diff => diff.toJSON())
    };
  }
}

class FullPatch extends Patch {
  constructor(opts) {
    super({type: 'full'});

    this.guid = opts.guid;
    this.baseVersion = opts.baseVersion;
    this.baseState = Immutable.fromJS(opts.baseState);
    this.diffs = Immutable.fromJS(opts.diffs).toArray();
  }

  toJSON() {
    return {
      type: this.type,
      guid: this.guid,
      baseVersion: this.baseVersion,
      baseState: this.baseState.toJSON(),
      diffs: this.diffs.map(diff => diff.toJSON())
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

function _historyToDiffs(initialState, history) {
  let state = initialState;

  const diffs = history.map((entry, i, a) => {
    const oldState = state;
    const newState = entry;
    const diff = immutablediff(oldState, newState);

    state = entry;

    return diff;
  });
  return diffs;
}

function _diffsToHistory(initialState, diffs) {
  let state = initialState;

  const history = diffs.map((diff, i, a) => {
    const oldState = state;
    const newState = immutablepatch(oldState, diff);

    state = newState;

    return newState;
  });
  return history;
}

const ipatch = {
  MasterFile,
  SlaveFile,
  Patch
};

module.exports = ipatch;
