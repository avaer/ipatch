const ipatch = require('../lib/ipatch');
const MasterFile = ipatch.MasterFile;
const SlaveFile = ipatch.SlaveFile;

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
