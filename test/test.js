const ipatch = require('../lib/ipatch');
const MasterFile = ipatch.MasterFile;
const SlaveFile = ipatch.SlaveFile;
const Patch = ipatch.Patch;

const Immutable = require('immutable');
const expect = require('expect.js');

describe('basic', () => {
  it('should construct', () => {
    const mf = new MasterFile();
    expect(mf).to.be.a(MasterFile);

    const sf = new SlaveFile();
    expect(sf).to.be.a(SlaveFile);
  });

  it('should start empty', () => {
    const mf = new MasterFile();
    expect(mf.get()).to.be.an(Immutable.Map);
    expect(Immutable.is(mf.get(), new Immutable.Map())).to.be.true;

    const sf = new SlaveFile();
    expect(sf.get()).to.be.an(Immutable.Map);
    expect(Immutable.is(sf.get(), new Immutable.Map())).to.be.true;
  });
});

describe('sync', () => {
  it('should sync empty file', () => {
    const mf = new MasterFile();
    expect(Immutable.is(mf.get(), new Immutable.Map())).to.be.true;

    const sf = new SlaveFile();
    const req = sf.sync();
    expect(req).to.be.a(Patch);
    expect(Immutable.is(sf.get(), new Immutable.Map())).to.be.true;

    const reqJson = req.toJSON();
    expect(reqJson).to.be.an(Object);

    const req2 = Patch.fromJSON(reqJson);
    expect(req2).to.be.a(Patch);

    const res = mf.apply(req2);
    expect(res).to.be.a(Patch);
    expect(Immutable.is(mf.get(), new Immutable.Map())).to.be.true;

    const resJson = res.toJSON();
    expect(resJson).to.be.an(Object);

    const res2 = Patch.fromJSON(resJson);
    expect(res2).to.be.a(Patch);

    const result = req.accept(res2);
    expect(result).to.be.null;
    expect(Immutable.is(sf.get(), new Immutable.Map())).to.be.true;
  });

  it('should sync basic change', () => {
    const mf = new MasterFile();
    expect(Immutable.is(mf.get(), new Immutable.Map())).to.be.true;

    const sf = new SlaveFile();
    const syncReq = sf.sync();
    syncReq.accept(mf.apply(syncReq));
    expect(Immutable.is(sf.get(), new Immutable.Map())).to.be.true;

    const updateReq = sf.update(oldState => {
      expect(Immutable.is(sf.get(), new Immutable.Map())).to.be.true;

      return oldState.set('lol', 'woot');
	});
    expect(updateReq).to.be.a(Patch);
    expect(sf.get('lol')).to.equal('woot');

    const updateRes = mf.apply(Patch.fromJSON(updateReq.toJSON()));
    expect(updateRes).to.be.null;
    expect(mf.get('lol')).to.equal('woot');

    updateReq.accept(updateRes);
    expect(sf.get('lol')).to.equal('woot');
  });
});
