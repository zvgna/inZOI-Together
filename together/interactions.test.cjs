const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createActions}=require('./actions.cjs');
function client(slot,actions,options={}){
  const elements={},config=new Map();let executing=false,calls=0,cancellations=0;
  const context={slot,generation:1,connected:true};const actor={slot};
  const sandbox={window:{},document:{getElementById(id){return elements[id]||(elements[id]={textContent:'',addEventListener(){}});}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'ui/interactions.js'),'utf8'),sandbox);
  const controller=sandbox.window.createTogetherInteractions({context:()=>({...context}),data:v=>v&&Object.hasOwn(v,'data')?v.data:v,value:v=>v.value,
    cfg:async(mode,key,value)=>{if(mode==='save')config.set(key,value);return {value:config.get(key)};},
    game:async(command)=>{
      if(command==='interaction.cancel'){executing=false;cancellations++;return {success:true,data:null};}
      if(command==='interaction.list_available'){if(options.onList)options.onList();if(options.listGate)await options.listGate;return {interactions:[{enabled:true,interaction_bag_id:'Co_Friendship_G04_Start'}]};}
      if(command==='interaction.get_current')return {playing:executing,interaction_bag_id:executing?'Co_Friendship_G04_Start':null};
      assert.equal(command,'interaction.execute');calls++;executing=true;return {success:true,data:null};
    },
    request:async(method,route,data)=>{
      if(route==='/actions')return {events:actions.list()};
      const parts=route.split('/');return parts[3]==='resolve'?actions.resolve(actor,parts[2],data):actions.acknowledge(actor,parts[2],data);
    }});
  return {controller,finish(){executing=false;},disconnect(){context.generation++;context.connected=false;},calls:()=>calls,cancellations:()=>cancellations};
}
test('two UI clients dispatch once and wait for observed completion',async()=>{
  const actions=createActions();const event=actions.request({slot:2,character:{id:123}},{slot:1,character:{id:456}},'greet');
  const host=client(1,actions),guest=client(2,actions);
  await host.controller.poll();assert.equal(event.state,'queued');assert.equal(host.calls(),1);
  await host.controller.poll();await host.controller.poll();assert.equal(host.calls(),1);
  await guest.controller.poll();await guest.controller.poll();assert.equal(guest.calls(),1);
  host.finish();await host.controller.poll();assert.equal(event.state,'queued');
  guest.finish();await guest.controller.poll();assert.equal(event.state,'completed');
  await host.controller.poll();assert.equal(host.controller.held(),false);
});
test('peer failure cancels only the dispatched social interaction',async()=>{
  const actions=createActions();const event=actions.request({slot:1,character:{id:1}},{slot:2,character:{id:2}},'greet');
  const host=client(1,actions);await host.controller.poll();await host.controller.poll();
  actions.acknowledge({slot:2},event.id,{state:'failed',reason:'Peer unavailable'});
  await host.controller.poll();await host.controller.poll();assert.equal(host.cancellations(),1);assert.equal(host.controller.held(),false);
});
test('a delayed availability response cannot dispatch an action after disconnect',async()=>{
  let release,listed;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{listed=resolve;});
  const actions=createActions();actions.request({slot:1,character:{id:1}},{slot:2,character:{id:2}},'greet');
  const host=client(1,actions,{listGate:gate,onList:listed});const polling=host.controller.poll();
  await started;host.disconnect();release();await polling;assert.equal(host.calls(),0);
});
