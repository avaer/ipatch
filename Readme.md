## ipatch

Immutable.js synchronization between client and server with realtime multi-client support.

#### Overview

_ipatch_ is a smart Immutable.js-based differ/patcher that generates JSON-serializable patches of your Immutable updates. It supports optimistic updates, change propagation, and eventually-consistent conflict resolution between multiple clients. It doesn't include any transport mechanism, but it will work anywhere you have a way to move JSON between client and server.

It's designed to play nice with React and Flux, with a focus on multi-user web interfaces.

#### How it works

Download an object:

```
import {MasterFile, SlaveFile, Patch} from 'ipatch';

const masterFile = MasterFile.new({lol: 'troll'});
const slaveFile = new SlaveFile();

const req = slaveFile.sync(); // create a request for the initial patch
const reqJson = req.toJSON(); // serialize the request

// ...send reqJson to the server...

const res = masterFile.apply(Patch.fromJSON(reqJson)); // handle the request, get back another patch
const resJson = res.toJSON(); // serialize the response

// ...send resJson back to the client...

req.accept(Patch.fromJSON(resJson)); // accept the server's response
slaveFile.get('lol'); // 'troll'

```

Change an object and sync it to the server:

```
// ...continued from above...

const updateReq = slaveFile.update(({lol}) => {lol: lol + 'ercopter'}); // create a request for the update
const updateReqJson = updateReq.toJSON();

slaveFile.get('lol'); // 'trollercopter'; we optimistically have the update

// ...send updateReqJson to the server...

const updateRes = masterFile.apply(Patch.fromJSON(updateReqJson)); // handle the request, get back another patch
const updateResJson = updateRes.toJSON();

masterFile.get('lol'); // 'trollercopter'; server accepted the update

// ...send updateResJson back to the client...

updateReq.accept(Patch.fromJSON(updateResJson)); // accept the server's response

```

#### Caveats

In terms of ACID, _ipatch_ synchronization is Atomic, Isolated, and Durable (if you persist somewhere), but only eventually Consistent.

This means as long as you follow the protocol, all clients will eventually see a consistent view of your updates, but locally you might see your update "rebased" on top of others until it's accepted. Therefore _ipatch_ works great for situations where responsiveness is important (like React/Flux rendering) and best-effort eventual consistency is acceptable.
