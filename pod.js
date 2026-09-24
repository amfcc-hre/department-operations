(function(){
  "use strict";
  var client=null,timer=null;
  function el(id){return document.getElementById(id);}
  function esc(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");}
  function dateLabel(iso){var date=new Date(iso+"T12:00:00");return date.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"});}
  function dutyNames(items){return Array.isArray(items)&&items.length?items.join(", "):"Not entered";}
  function renderGateDuty(duty,workDate){
    var rows=(duty.gate_assignments||[]).filter(function(row){return row.duty_date===workDate;});
    var slots=[
      {code:"22_00",label:"8:00 pm to 12:00 am"},
      {code:"00_02",label:"12:00 am to 2:00 am"},
      {code:"02_04",label:"2:00 am to 4:00 am"}
    ];
    el("gate-duty-slots").innerHTML=slots.map(function(slot){
      var row=rows.find(function(item){return item.slot_code===slot.code;});
      return '<article><span>'+esc(slot.label)+'</span><strong>'+esc(row?row.student_name:"Not entered")+'</strong></article>';
    }).join("");
  }
  function taskCard(session,task){
    var groups=(session.groups||[]).filter(function(group){return Number(group.headcount||0)>0;});
    var members=session.department_members||[];
    return '<article class="task-card '+esc(session.status)+'"><h3>'+esc(task.title)+'</h3><p class="department">'+esc(session.department)+'</p><p class="location"><strong>Location:</strong> '+esc(task.location||"Location not entered")+'</p><div class="manpower">'+(groups.length?'<div><strong>Student groups</strong><div class="tags">'+groups.map(function(group){return '<span class="tag">'+Number(group.headcount)+' '+esc(group.label)+'</span>';}).join("")+'</div></div>':"")+(members.length?'<div><strong>Department members</strong><div class="tags">'+members.map(function(name){return '<span class="tag member">'+esc(name)+'</span>';}).join("")+'</div></div>':"")+(!groups.length&&!members.length?'<span class="tag">Manpower not published</span>':"")+'</div></article>';
  }
  function render(data){
    el("board-date").textContent=dateLabel(data.work_date);
    el("mode-pill").textContent=(data.base_mode==="holiday"?"Holiday Mode":"School Term Mode")+(data.conference_mode?" + Conference":"");
    var duty=data.duty||{};
    el("pod-name").textContent=duty.prefect_on_duty||"Not entered";
    el("senior-pod-name").textContent=duty.senior_prefect_on_duty||"Not entered";
    el("bell-ringer-name").textContent=duty.bell_ringer||"Not entered";
    el("kitchen-duty-names").textContent=dutyNames(duty.kitchen_people);
    el("kitchen-duty-department").textContent=duty.kitchen_department||"Department not entered";
    el("toilet-duty-names").textContent=dutyNames(duty.toilet_people);
    el("toilet-duty-department").textContent=duty.toilet_department||"Department not entered";
    renderGateDuty(duty,data.work_date);
    var sessions=data.sessions||[],taskTotal=sessions.reduce(function(sum,session){return sum+(session.tasks||[]).length;},0);
    el("task-count").textContent=taskTotal+" task"+(taskTotal===1?"":"s");
    var order=[],bySlot={};
    sessions.forEach(function(session){if(!bySlot[session.slot_code]){bySlot[session.slot_code]={name:session.session,sessions:[]};order.push(session.slot_code);}bySlot[session.slot_code].sessions.push(session);});
    el("session-board").innerHTML=order.length?order.map(function(code){var column=bySlot[code];var cards=column.sessions.map(function(session){return (session.tasks||[]).map(function(task){return taskCard(session,task);}).join("");}).join("");return '<section class="session-column"><header><strong>'+esc(column.name)+'</strong><span>'+column.sessions.length+' department'+(column.sessions.length===1?"":"s")+'</span></header><div class="task-list">'+cards+'</div></section>';}).join(""):'<div class="empty">No approved tasks are published for today.</div>';
    el("updated-time").textContent="Updated "+new Date(data.refreshed_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    el("live-pill").textContent="Live";el("live-pill").className="pill live";
  }
  async function load(){
    try{var response=await client.rpc("pod_live_board");if(response.error)throw response.error;if(!response.data||response.data.status!=="success")throw new Error((response.data||{}).message||"Live plan unavailable.");render(response.data);}
    catch(error){el("live-pill").textContent="Connection issue";el("live-pill").className="pill";el("updated-time").textContent=error.message||"Could not refresh";}
  }
  document.addEventListener("DOMContentLoaded",function(){
    if(!window.APP_CONFIG||!window.APP_CONFIG.SUPABASE_URL||!window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY||!window.supabase){el("session-board").innerHTML='<div class="empty">The live board is not configured.</div>';return;}
    client=window.supabase.createClient(window.APP_CONFIG.SUPABASE_URL,window.APP_CONFIG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    el("refresh-button").addEventListener("click",load);load();clearInterval(timer);timer=setInterval(load,15000);
  });
})();
