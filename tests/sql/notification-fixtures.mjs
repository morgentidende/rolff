// Synthetic setup and message path through unchanged owner/service RPCs, including v3 policy gates.
// No grants, trigger changes, fixture approval wrapper or direct message/delivery inserts.
// Receive times now require at least one window. A window three weekdays away (UTC) is
// "closed right now" without depending on the minute the test runs.
export function closedWindows(now=new Date()){const today=((now.getUTCDay()+6)%7)+1;return JSON.stringify([{weekday:((today+2)%7)+1,start_minute:0,end_minute:60}]);}
export async function notificationFixture(db,sender,recipient){
 const rows=async(sql,p=[])=>(await db.query(sql,p)).rows;
 const owner=(uid,sql,p=[])=>db.transaction(async tx=>{await tx.query('set local role authenticated');await tx.query("select set_config('request.jwt.sub',$1,true)",[uid]);return(await tx.query(sql,p)).rows;});
 const service=(sql,p=[])=>db.transaction(async tx=>{await tx.query('set local role service_role');return(await tx.query(sql,p)).rows;});
 const conv=(await owner(sender,"select create_conversation('Synthetic notifications') id"))[0].id;
 const token=(await owner(sender,"select * from create_invitation($1,'parent')",[conv]))[0].token;
 await owner(recipient,'select accept_invitation($1)',[token]);
 const digest=async text=>(await rows("select encode(extensions.digest($1,'sha256'),'hex') h",[text]))[0].h;
 const snapshot=async()=>(await service('select recipient_filter_snapshot($1,$2) s',[conv,sender]))[0].s;
 const issue=async(text,revision)=>(await service("select issue_reply_approval_v3($1,$2,$3,'synthetic','mock-no-model-call',$4,null) id",[sender,conv,await digest(text),revision]))[0].id;
 const commit=async(id,text,key)=>(await service('select * from commit_message_reply($1,$2,$3,$4,$5,null)',[id,sender,conv,text,key]))[0];
 let sequence=0;
 const message=async()=>{const text=`Synthetic notification message ${++sequence}`;await service('select * from prepare_send($1,$2,$3)',[sender,conv,text]);const p=await snapshot();return(await commit(await issue(text,p.revision),text,`synthetic-notification-${sequence}`)).message_id;};
 const window=async(enabled=true)=>{const s=(await owner(recipient,'select get_my_receive_settings(null) s'))[0].s;await owner(recipient,"select save_my_receive_settings($1,$3::jsonb,'fixed','UTC',null,$2)",[enabled,s.revision,enabled?closedWindows():'[]']);};
 return{conv,owner,service,message,window,snapshot,issue,commit,digest};
}
