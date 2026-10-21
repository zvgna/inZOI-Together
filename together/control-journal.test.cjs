const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createControlJournal}=require('./control-journal.cjs');

test('ownership and dispatch survive reopening the journal',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'together-journal-')),filename=path.join(directory,'control.json');
  try {
    const first=await createControlJournal(filename);
    await first.writeOwnership({actor:22,previous:false,epoch:'example'});
    await first.writeCommand('example:command','dispatched');
    const second=await createControlJournal(filename);
    assert.equal((await second.readOwnership()).previous,false);
    assert.equal(await second.readCommand('example:command'),'dispatched');
    await second.writeOwnership(null);
    assert.equal(await (await createControlJournal(filename)).readOwnership(),null);
  } finally {await fs.unlink(filename);await fs.rmdir(directory);}
});
