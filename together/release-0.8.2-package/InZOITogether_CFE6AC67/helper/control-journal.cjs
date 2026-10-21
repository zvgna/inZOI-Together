const fs=require('node:fs/promises');
const path=require('node:path');

async function createControlJournal(filename) {
  let state={ownership:null,commands:{}};
  try {
    state=JSON.parse(await fs.readFile(filename,'utf8'));
    if (!state || typeof state.commands !== 'object' || !Object.hasOwn(state,'ownership')) throw new Error('Invalid control journal');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function commit(next) {
    await fs.mkdir(path.dirname(filename),{recursive:true});
    const temporary=filename+'.tmp';
    const handle=await fs.open(temporary,'w',0o600);
    try { await handle.writeFile(JSON.stringify(next));await handle.sync(); } finally {await handle.close();}
    await fs.rename(temporary,filename);
    state=next;
  }
  return {
    readOwnership:async()=>state.ownership && {...state.ownership},
    writeOwnership:async ownership=>commit({...state,ownership}),
    readCommand:async key=>state.commands[key] || null,
    writeCommand:async(key,value)=>commit({...state,commands:{...state.commands,[key]:value}})
  };
}
module.exports={createControlJournal};
